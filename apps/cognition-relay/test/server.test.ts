import { CognitionRelay } from "@abl/cognition";
import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  createCognitionRelayServer,
  createRelayRateLimiter,
} from "../src/server.js";

const internalToken = "relay-internal-token-with-at-least-32-characters";
const now = "2026-08-26T10:01:00.000Z";

describe("cognition relay HTTP boundary", () => {
  it("bounds unauthenticated rate-limit state and expires old identities", () => {
    const limiter = createRelayRateLimiter({
      maximumEntries: 2,
      windowMs: 60_000,
    });
    expect(limiter.limited("RUNNER_IP", "192.0.2.1", 10, 0)).toBe(false);
    expect(limiter.limited("RUNNER_IP", "192.0.2.2", 10, 0)).toBe(false);
    expect(limiter.limited("RUNNER_IP", "192.0.2.3", 10, 0)).toBe(true);
    expect(limiter.size()).toBe(2);
    expect(limiter.limited("RUNNER_IP", "192.0.2.3", 10, 60_001)).toBe(false);
    expect(limiter.size()).toBe(1);
  });

  it("publishes no authority or custody claim and protects internal routes", async () => {
    const app = createCognitionRelayServer({
      relay: new CognitionRelay(),
      internalToken,
      now: () => now,
      authorizePairing: async () => {
        throw new Error("not used");
      },
      longPollMs: 1,
    });
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.headers["x-abl-cognition-custody"]).toBe("ciphertext-only");
    expect(health.json()).toMatchObject({
      canonicalAuthority: false,
      plaintextContextAccess: false,
      modelCredentials: false,
    });
    const denied = await app.inject({
      method: "POST",
      url: "/v1/internal/pairing-offers",
      payload: {},
    });
    expect(denied.statusCode).toBe(401);
    await app.close();
  });

  it("consumes a career-authorized pairing offer without retaining its token", async () => {
    const signing = createSigningIdentity();
    const relay = new CognitionRelay();
    const app = createCognitionRelayServer({
      relay,
      internalToken,
      now: () => now,
      longPollMs: 1,
      authorizePairing: async ({ submission }) => ({
        schemaVersion: "1.0.0",
        delegationId: "0198e000-0000-7000-8000-000000000502",
        careerDid: "did:abl:career-1",
        runnerId: submission.runnerId,
        delegateSigningAddress: submission.delegateSigningAddress,
        delegateEncryptionPublicKey: submission.delegateEncryptionPublicKey,
        scopes: ["RUNNER_HEARTBEAT", "ACTIVATION_CLAIM", "RESULT_SUBMISSION"],
        issuedAt: now,
        expiresAt: "2026-09-25T10:01:00.000Z",
        revokedAt: null,
        careerSignature: `0x${"1".repeat(130)}`,
      }),
    });
    const offer = {
      schemaVersion: "1.0.0",
      offerId: "0198e000-0000-7000-8000-000000000501",
      careerDid: "did:abl:career-1",
      careerResourceName: "abl-career-1",
      careerSignerAddress: signing.address,
      relayOrigin: "https://relay.example.test",
      runnerBundleDigest: sha256Commitment("runner-v1"),
      pairingToken: "pairing-token-that-is-long-enough-0001",
      issuedAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-08-26T10:15:00.000Z",
      singleUse: true,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/internal/pairing-offers",
          headers: { authorization: `Bearer ${internalToken}` },
          payload: offer,
        })
      ).statusCode,
    ).toBe(201);
    const paired = await app.inject({
      method: "POST",
      url: "/v1/runners/pair",
      payload: {
        offerId: offer.offerId,
        pairingToken: offer.pairingToken,
        runnerId: "runner-1",
        delegateSigningAddress: signing.address,
        delegateEncryptionPublicKey: `0x${"2".repeat(64)}`,
      },
    });
    expect(paired.statusCode).toBe(201);
    expect(paired.body).not.toContain(offer.pairingToken);
    expect(relay.snapshot()).toMatchObject({ offers: 1, delegations: 1 });
    await app.close();
  });
});
