import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSigningIdentity } from "@abl/recognition";
import {
  FileSafetyLedger,
  SAFETY_DOMAIN_NAME,
  SAFETY_DOMAIN_VERSION,
  signSafetyAction,
} from "@abl/safety";
import type { TypedDataDomain } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { createSafetyGateway } from "../src/server.js";

const domain: TypedDataDomain = {
  name: SAFETY_DOMAIN_NAME,
  version: SAFETY_DOMAIN_VERSION,
  chainId: 84532,
  verifyingContract: "0x2222222222222222222222222222222222222222",
};
const start = Date.parse("2026-08-13T10:00:00.000Z");
const custodian = createSigningIdentity(`0x${"5".repeat(64)}`);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function ledger(): Promise<FileSafetyLedger> {
  const root = await mkdtemp(join(tmpdir(), "abl-safety-api-"));
  roots.push(root);
  return new FileSafetyLedger(root, {
    domain,
    custodianPublicKeys: new Set([custodian.publicKey]),
  });
}

async function signedAction() {
  return signSafetyAction(custodian, domain, {
    actionId: "0198e000-0000-7000-8000-000000000201",
    category: "ISOLATE_RUNTIME",
    targetResourceId: "runtime:player-17",
    reasonCode: "ACTIVE_COMPROMISE",
    issuedAt: new Date(start).toISOString(),
    expiresAt: new Date(start + 60 * 60 * 1_000).toISOString(),
  });
}

describe("separate fixed safety gateway", () => {
  it("publishes signed actions and fixed control state without a command route", async () => {
    const now = { value: start };
    const app = createSafetyGateway({
      ledger: await ledger(),
      now: () => now.value,
    });
    const action = await signedAction();
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/safety/actions",
      payload: action,
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.headers["x-abl-boundary"]).toBe("fixed-safety-only");
    expect(accepted.json()).toMatchObject({
      accepted: true,
      publiclyLogged: true,
      admittedCommandGatewayCalled: false,
      recognizedStateMutated: false,
      livePlatformExecutionVerified: false,
      control: {
        targetResourceId: "runtime:player-17",
        runtimeIsolated: true,
      },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/safety/actions",
          payload: action,
        })
      ).json(),
    ).toMatchObject({ duplicate: true });
    expect(
      (await app.inject({ method: "GET", url: "/v1/safety/actions" })).json(),
    ).toMatchObject({
      public: true,
      actions: [{ status: "ACTIVE", action }],
      admittedCommandGatewayAvailable: false,
      recognizedStateMutationAvailable: false,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/safety/controls?targetResourceId=runtime%3Aplayer-17",
        })
      ).json(),
    ).toMatchObject({
      control: { runtimeIsolated: true, schedulerPaused: false },
    });
    expect(
      (await app.inject({ method: "POST", url: "/v1/commands", payload: {} }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/safety/actions",
          payload: { ...action, freeText: "message an agent" },
        })
      ).statusCode,
    ).toBe(400);

    now.value = Date.parse(action.expiresAt);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/safety/controls?targetResourceId=runtime%3Aplayer-17",
        })
      ).json(),
    ).toMatchObject({
      control: { runtimeIsolated: false, activeActionIds: [] },
    });
    await app.close();
  });
});
