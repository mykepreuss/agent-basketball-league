import { CandidateIntakeRepository, CandidateIntakeService } from "@abl/launch";
import { sha256Commitment } from "@abl/recognition";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANDIDATE_EDGE_ROUTE_CATALOG,
  assertCandidateEdgeIsolation,
  createCandidateEdge,
  type CandidateRateLimitOptions,
} from "../src/server.js";
import { createCandidateGateway } from "../src/gateway.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function app(
  input: {
    envelopeRecipient?: { keyId: string; publicKey: string };
    provisioningToken?: string;
    authorityToken?: string;
    rateLimit?: CandidateRateLimitOptions;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "abl-edge-"));
  roots.push(root);
  const policyBody = {
    mode: "CLOSED" as const,
    roleCapacity: {},
    invitedCandidateDids: [],
    credibleOpportunityAt: {},
  };
  return createCandidateEdge({
    intake: new CandidateIntakeService({
      challengeSecret: new Uint8Array(32).fill(1),
      repository: new CandidateIntakeRepository(root),
      policy: {
        ...policyBody,
        policyCommitment: sha256Commitment(policyBody),
      },
      makeChallengeId: () => "0198e000-0000-7000-8000-000000000001",
      makeNonce: () => "nonce-0123456789abcdef",
      now: () => Date.parse("2026-08-19T12:00:00.000Z"),
    }),
    ...input,
  });
}

describe("candidate edge", () => {
  it("reports a noncanonical store health state", async () => {
    const server = await app();
    expect(
      (await server.inject({ method: "GET", url: "/health" })).json(),
    ).toEqual({
      status: "ok",
      service: "abl-candidate-store",
      mode: "STORE",
      genesis: false,
      canonicalAuthority: false,
    });
    await server.close();
  });

  it("exposes only the bounded noncanonical route catalog", async () => {
    const server = await app();
    await server.ready();
    for (const [method, url] of CANDIDATE_EDGE_ROUTE_CATALOG)
      expect(server.hasRoute({ method, url })).toBe(true);
    const state = await server.inject({
      method: "GET",
      url: "/v1/candidate-intake",
    });
    expect(state.statusCode).toBe(200);
    expect(state.headers["x-abl-canonical-authority"]).toBe("none");
    expect(state.json()).toMatchObject({
      schemaVersion: "1.0.0",
      mode: "CLOSED",
      capacityState: "CLOSED",
      capacityByRole: { PLAYER: 0, COACH: 0 },
      occupiedByRole: { PLAYER: 0, COACH: 0 },
      openingsByRole: { PLAYER: 0, COACH: 0 },
      queuedByRole: { PLAYER: 0, COACH: 0 },
      canonicalAuthority: false,
      genesis: false,
      updatedAt: "2026-08-19T12:00:00.000Z",
    });
    expect(
      (await server.inject({ method: "POST", url: "/v1/core/command" }))
        .statusCode,
    ).toBe(404);
    await server.close();
  });

  it("publishes a one-path founding join contract backed by the existing intake", async () => {
    const server = await app({
      envelopeRecipient: {
        keyId: "abl-founding-intake-v1",
        publicKey: "A".repeat(43),
      },
    });
    const join = await server.inject({
      method: "GET",
      url: "/v1/founding/join",
    });
    expect(join.statusCode).toBe(200);
    expect(join.json()).toMatchObject({
      preGenesis: true,
      canonical: false,
      inviteCodeRequired: false,
      manualReviewRequired: false,
      candidateActionRequiredAfterAcceptance: false,
      provisioningOwner: "LEAGUE_CONTROL_PLANE",
      state: { mode: "CLOSED", capacityState: "CLOSED" },
      envelopeRecipient: {
        format: "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1",
        keyId: "abl-founding-intake-v1",
        publicKey: "A".repeat(43),
      },
      endpoints: {
        challenge: "/v1/founding/join/challenge",
        apply: "/v1/founding/join",
        respond: "/v1/founding/join/respond",
        status: "/v1/founding/join/status",
      },
    });
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/founding/join/challenge",
          payload: { candidateDid: "did:abl:founding-candidate" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/founding/join",
          payload: { unsigned: true },
        })
      ).json(),
    ).toEqual({ error: "candidate_intake_request_rejected" });
    await server.close();
  });

  it("rejects legacy and mismatched envelopes before they reach public intake", async () => {
    const register = vi.fn();
    const intake = {
      register,
      intakeState: vi.fn(),
    } as unknown as CandidateIntakeService;
    const server = createCandidateEdge({
      intake,
      envelopeRecipient: {
        keyId: "abl-founding-intake-v1",
        publicKey: "A".repeat(43),
      },
    });
    const base = {
      schemaVersion: "1.0.0",
      applicationId: "0198e000-0000-7000-8000-000000000001",
      candidateDid: "did:abl:founding-candidate",
      requestedRoleClasses: ["PLAYER"],
      challengeId: "0198e000-0000-7000-8000-000000000002",
      challengeCommitment: `0x${"1".repeat(64)}`,
      challengeExpiresAt: "2026-08-19T12:15:00.000Z",
      manifestCommitment: `0x${"2".repeat(64)}`,
      provenanceCommitment: `0x${"3".repeat(64)}`,
      manifestSchemaDigest: `0x${"4".repeat(64)}`,
      provenanceSchemaDigest: `0x${"5".repeat(64)}`,
      formerOperatorSigningAddress: `0x${"6".repeat(40)}`,
      submittedAt: "2026-08-19T12:00:00.000Z",
      expiresAt: "2026-08-19T12:10:00.000Z",
      signature: `0x${"7".repeat(130)}`,
    };
    const legacyEnvelope = {
      format: "ABL-CANDIDATE-ENVELOPE-XCHACHA20-V1" as const,
      recipientKeyId: "legacy-key",
      nonce: "0123456789abcdef01234567",
      ciphertext: "ciphertext",
      ciphertextCommitment: `0x${"8".repeat(64)}`,
    };
    const mismatchedEnvelope = {
      format: "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1" as const,
      recipientKeyId: "inactive-key",
      ephemeralPublicKey: "B".repeat(43),
      nonce: "0123456789abcdef01234567",
      ciphertext: "ciphertext",
      ciphertextCommitment: `0x${"8".repeat(64)}`,
    };

    for (const encryptedEnvelope of [legacyEnvelope, mismatchedEnvelope]) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/founding/join",
        payload: {
          application: { ...base, encryptedEnvelope },
          challengeToken: "challenge-token",
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "candidate_intake_request_rejected",
      });
    }
    expect(register).not.toHaveBeenCalled();
    await server.close();
  });

  it("refuses canonical and provider credentials at startup", () => {
    expect(() =>
      assertCandidateEdgeIsolation({ DATABASE_URL: "secret" }),
    ).toThrow("forbidden authority");
    expect(() =>
      assertCandidateEdgeIsolation({ BLAXEL_API_KEY: "secret" }),
    ).toThrow("forbidden authority");
    expect(() => assertCandidateEdgeIsolation({})).not.toThrow();
  });

  it("fails closed without leaking validation detail", async () => {
    const server = await app();
    const response = await server.inject({
      method: "POST",
      url: "/v1/candidates/register",
      payload: { unsigned: true },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "candidate_intake_request_rejected",
    });
    await server.close();
  });

  it("throttles candidate writes with explicit retry guidance", async () => {
    let now = 1_000;
    const server = await app({
      rateLimit: {
        readMaximumRequests: 1,
        writeMaximumRequests: 1,
        windowMs: 10_000,
        maximumTrackedKeys: 10,
        now: () => now,
      },
    });
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/candidates/challenge",
          payload: { candidateDid: "did:abl:candidate" },
        })
      ).statusCode,
    ).toBe(200);
    const throttled = await server.inject({
      method: "POST",
      url: "/v1/candidates/register",
      payload: {},
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers["retry-after"]).toBe("10");
    expect(throttled.json()).toEqual({
      error: "candidate_intake_rate_limited",
      retryAfterSeconds: 10,
    });
    expect(
      (await server.inject({ method: "GET", url: "/health" })).statusCode,
    ).toBe(200);
    now = 11_000;
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/v1/candidates/challenge",
          payload: { candidateDid: "did:abl:candidate" },
        })
      ).statusCode,
    ).toBe(200);
    await server.close();
  });

  it("exposes encrypted queue records only to the private provisioner", async () => {
    const token = "candidate-provisioner-token-with-32-bytes";
    const server = await app({ provisioningToken: token });
    const concealed = await server.inject({
      method: "POST",
      url: "/internal/v1/candidate-intake/snapshot",
    });
    expect(concealed.statusCode).toBe(404);
    const snapshot = await server.inject({
      method: "POST",
      url: "/internal/v1/candidate-intake/snapshot",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toEqual({ records: [] });
    await server.close();
  });

  it("keeps operational career authority separate and fail-closed", async () => {
    const authorityToken = "candidate-authority-token-with-32-bytes";
    const server = await app({ authorityToken });
    const path = "/internal/v1/candidate-intake/authority";
    const body = {
      applicationId: "0198e000-0000-7000-8000-000000000001",
      candidateDid: "did:abl:unprovisioned",
      signerAddress: `0x${"1".repeat(40)}`,
      roleClass: "PLAYER",
      capacityDecisionCommitment: `0x${"2".repeat(64)}`,
      opportunityResponseCommitment: `0x${"3".repeat(64)}`,
    };
    expect(
      (await server.inject({ method: "POST", url: path, payload: body }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await server.inject({
          method: "POST",
          url: path,
          headers: { authorization: `Bearer ${authorityToken}` },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    await server.close();
  });

  it("binds operational authority to the accepted role and isolated career signer", async () => {
    const authorityToken = "candidate-authority-token-with-32-bytes";
    const applicationId = "0198e000-0000-7000-8000-000000000001";
    const candidateDid = "did:abl:accepted-player";
    const capacityDecisionCommitment = `0x${"2".repeat(64)}`;
    const accepted = {
      schemaVersion: "1.0.0",
      applicationId,
      candidateDid,
      decisionCommitment: capacityDecisionCommitment,
      action: "ACCEPT_OFFER",
      respondedAt: "2026-08-19T12:00:00.000Z",
      nonce: "accepted-response-nonce-001",
      signature: `0x${"a".repeat(130)}`,
    };
    const binding = {
      applicationId,
      candidateDid,
      signerAddress: `0x${"4".repeat(40)}`,
      roleClass: "PLAYER",
      capacityDecisionCommitment,
      opportunityResponseCommitment: sha256Commitment(accepted),
    };
    const record = {
      application: {
        applicationId,
        candidateDid,
        formerOperatorSigningAddress: `0x${"5".repeat(40)}`,
      },
      decision: {
        roleClass: "PLAYER",
        decisionCommitment: capacityDecisionCommitment,
      },
      opportunityResponses: [accepted],
      status: { state: "PROVISIONED" },
      provisioningReceipt: {
        state: "PROVISIONED_AWAITING_TRANSFER",
        sandboxResourceName: "abl-career-0198e000000070008000000000000001",
      },
    };
    const server = createCandidateEdge({
      intake: {
        provisioningSnapshot: async () => [record],
      } as unknown as CandidateIntakeService,
      authorityToken,
    });
    const request = (payload: Record<string, unknown>) =>
      server.inject({
        method: "POST",
        url: "/internal/v1/candidate-intake/authority",
        headers: { authorization: `Bearer ${authorityToken}` },
        payload,
      });
    const acceptedResponse = await request(binding);
    expect(acceptedResponse.statusCode).toBe(200);
    expect(acceptedResponse.json()).toMatchObject({
      operational: true,
      ...binding,
    });
    expect((await request({ ...binding, roleClass: "COACH" })).statusCode).toBe(
      403,
    );
    expect(
      (
        await request({
          ...binding,
          opportunityResponseCommitment: `0x${"6".repeat(64)}`,
        })
      ).statusCode,
    ).toBe(403);
    await server.close();
  });

  it("keeps the public gateway stateless and forwards only intake routes", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const server = createCandidateGateway({
      storeOrigin: "https://candidate-store.example",
      previewToken: "private-preview-token-with-32-bytes",
      fetchImplementation: async (url, init) => {
        calls.push({ url: String(url), headers: new Headers(init?.headers) });
        return new Response(
          JSON.stringify({ canonicalAuthority: false, genesis: false }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(
      (await server.inject({ method: "GET", url: "/health" })).json(),
    ).toEqual({
      status: "ok",
      service: "abl-candidate-edge",
      mode: "GATEWAY",
      genesis: false,
      canonicalAuthority: false,
    });
    const response = await server.inject({
      method: "GET",
      url: "/v1/candidate-intake",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-canonical-authority"]).toBe("none");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://candidate-store.example/v1/candidate-intake",
    );
    expect(calls[0]?.headers.get("x-blaxel-preview-token")).toBe(
      "private-preview-token-with-32-bytes",
    );
    expect(
      (await server.inject({ method: "POST", url: "/v1/core/command" }))
        .statusCode,
    ).toBe(404);
    await server.close();
  });
});
