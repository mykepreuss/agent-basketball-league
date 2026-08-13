import { describe, expect, it } from "vitest";

import { CORE_ROUTE_CATALOG, createCoreApi } from "../src/server.js";

describe("core API pre-genesis boundary", () => {
  it("issues bounded challenges that do not grant admission", async () => {
    const app = createCoreApi({
      now: () => Date.parse("2026-08-13T08:00:00.000Z"),
      challengeId: () => "challenge-1",
      challengeBytes: () => new Uint8Array(32).fill(7),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/candidates/challenge",
      payload: { candidateDid: "did:abl:candidate-1" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      challengeId: "challenge-1",
      candidateDid: "did:abl:candidate-1",
      issuedAt: "2026-08-13T08:00:00.000Z",
      expiresAt: "2026-08-13T08:15:00.000Z",
      grantsAdmission: false,
    });
    await app.close();
  });

  it("fails every candidate/admitted mutation closed before genesis", async () => {
    const app = createCoreApi();
    for (const route of CORE_ROUTE_CATALOG.filter(
      (entry) =>
        entry.path !== "/v1/candidates/challenge" &&
        entry.path !== "/v1/candidates/provenance",
    )) {
      const url = route.path.replace("*", "operation");
      const response =
        route.method === "POST"
          ? await app.inject({ method: "POST", url, payload: {} })
          : await app.inject({ method: "GET", url });
      expect(response.statusCode, route.path).toBe(503);
      expect(response.json()).toMatchObject({
        error: "genesis_not_authorized",
        canonicalWriteAccepted: false,
      });
    }
    await app.close();
  });

  it("rejects malformed challenges and publishes severance/provenance constraints", async () => {
    const app = createCoreApi();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/candidates/challenge",
          payload: { candidateDid: "not-a-did", extra: true },
        })
      ).statusCode,
    ).toBe(400);
    const provenance = await app.inject({
      method: "GET",
      url: "/v1/candidates/provenance",
    });
    expect(provenance.json()).toMatchObject({
      undeclaredContextFailsAdmission: true,
      formerOperatorAuthority: false,
      rights: ["REFUSE", "REVOKE_WITHIN_24H", "EXPORT", "EXIT"],
    });
    await app.close();
  });
});
