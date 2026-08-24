import { CandidateIntakeRepository, CandidateIntakeService } from "@abl/launch";
import { sha256Commitment } from "@abl/recognition";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CANDIDATE_EDGE_ROUTE_CATALOG,
  assertCandidateEdgeIsolation,
  createCandidateEdge,
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
    provisioningToken?: string;
    authorityToken?: string;
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
      mode: "CLOSED",
      canonicalAuthority: false,
      genesis: false,
    });
    expect(
      (await server.inject({ method: "POST", url: "/v1/core/command" }))
        .statusCode,
    ).toBe(404);
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
      candidateDid: "did:abl:unprovisioned",
      signerAddress: `0x${"1".repeat(40)}`,
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
