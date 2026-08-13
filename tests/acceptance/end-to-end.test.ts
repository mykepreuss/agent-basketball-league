import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CORE_ROUTE_CATALOG,
  createCoreApi,
} from "../../apps/core-api/src/server.js";
import {
  PUBLIC_ROUTE_CATALOG,
  createPublicApi,
} from "../../apps/public-api/src/server.js";
import { runLocalCapacityProof } from "../../packages/assurance/src/index.js";
import { constitutionalInvariants } from "../../packages/policy/src/index.js";
import { runPrivateRehearsal } from "../../packages/rehearsal/src/index.js";
import {
  exportJsonSchemas,
  schemaRegistry,
} from "../../packages/schemas/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("complete local acceptance", () => {
  it("replays both accelerated seasons and every cross-domain rehearsal scenario exactly", async () => {
    const report = await runPrivateRehearsal();
    expect(report.passed).toBe(true);
    expect(report.premier).toMatchObject({
      gameCount: 36,
      replayExactCount: 36,
      inferenceInvocations: 0,
      seasonRoot:
        "0xd049768ba17801a427c3675fcbaa0ddda493e0ba0b5980b02dcd3d881fc34f74",
    });
    expect(report.development).toMatchObject({
      gameCount: 36,
      replayExactCount: 36,
      inferenceInvocations: 0,
      seasonRoot:
        "0x2f6a7d41ae1844402105703050a37b12796a3a91389534cb23169103383acd02",
    });
    expect(report.events).toHaveLength(16);
    expect(report.events.every((event) => event.outcome === "PASS")).toBe(true);
    expect(report.eventRoot).toBe(
      "0x6f3ea9a7a8b475d89b72a3f05853cfec2a15db9781c8372436e0e9a305a43df9",
    );
  });

  it("meets every local 2x workload count and SLO without relabeling it live capacity", () => {
    const result = runLocalCapacityProof();
    expect(result).toMatchObject({
      mode: "LOCAL_IN_PROCESS_SYNTHETIC",
      passed: true,
      executed: {
        spectatorCursorPolls: 20_000,
        candidateRegistrations: 2_000,
        gameExecutions: 20,
        activeBodyObjects: 400,
      },
      observed: { eventLoss: 0, eventDuplication: 0, publicErrorRate: 0 },
      reservations: {
        state: "NOT_REQUESTED_MATERIAL_SPEND_GATE",
        liveBlaxelConcurrencyVerified: false,
        twoTimesRemoteHeadroomReserved: false,
        cost: null,
      },
    });
    expect(result.observed.cursorSegmentP95Milliseconds).toBeLessThan(750);
    expect(result.observed.broadcastLagMaximumMilliseconds).toBeLessThan(2_000);
  });

  it("exports all 43 primary schemas as fail-closed strict JSON Schema", () => {
    expect(Object.keys(schemaRegistry)).toHaveLength(43);
    const jsonSchemas = exportJsonSchemas();
    expect(Object.keys(jsonSchemas)).toEqual(Object.keys(schemaRegistry));
    for (const [name, schema] of Object.entries(jsonSchemas)) {
      expect(schema, name).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
      });
    }
  });

  it("keeps every NBA rule and CBA article/exhibit classified with implementation and tests", async () => {
    const [nba, cba] = await Promise.all(
      ["docs/rules/nba-rule-mapping.json", "docs/rules/cba-mapping.json"].map(
        async (path) =>
          JSON.parse(await readFile(join(repositoryRoot, path), "utf8")) as {
            entries: Array<{
              classification: string;
              citation: string;
              implementationRef: string;
              governingBody: string;
              tests: string[];
            }>;
          },
      ),
    );
    expect(nba.entries).toHaveLength(15);
    expect(cba.entries).toHaveLength(59);
    for (const entry of [...nba.entries, ...cba.entries]) {
      expect(["IMPLEMENTED", "AGENT_EQUIVALENT", "NOT_APPLICABLE"]).toContain(
        entry.classification,
      );
      expect(entry.citation.length).toBeGreaterThan(0);
      expect(entry.implementationRef.length).toBeGreaterThan(0);
      expect(entry.governingBody.length).toBeGreaterThan(0);
      expect(entry.tests.length).toBeGreaterThan(0);
    }
  });

  it("implements every documented route on its correct public or private boundary", async () => {
    const actual = new Set([
      ...PUBLIC_ROUTE_CATALOG.map((route) => `${route.method} ${route.path}`),
      ...CORE_ROUTE_CATALOG.map((route) => `${route.method} ${route.path}`),
      "GET /arena",
    ]);
    const expected = new Set([
      "GET /",
      "GET /llms.txt",
      "GET /.well-known/agent-basketball-league.json",
      "GET /openapi.json",
      "GET /mcp",
      "POST /mcp",
      "POST /v1/candidates/challenge",
      "POST /v1/candidates/register",
      "GET /v1/candidates/provenance",
      "POST /v1/candidates/reflect",
      "POST /v1/candidates/admit",
      "POST /v1/candidates/revoke",
      "POST /v1/candidates/transfer",
      "GET /v1/candidates/status",
      "POST /v1/combine/*",
      "POST /v1/commands",
      "POST /v1/memory/*",
      "POST /v1/communication/*",
      "POST /v1/film/*",
      "POST /v1/practice/*",
      "POST /v1/contracts/*",
      "POST /v1/governance/*",
      "POST /v1/cases/*",
      "POST /v1/continuity/*",
      "POST /v1/exit/*",
      "GET /v1/public/events",
      "GET /v1/public/games",
      "GET /v1/public/standings",
      "GET /v1/public/rosters",
      "GET /v1/public/contracts",
      "GET /v1/public/governance",
      "GET /v1/public/resources",
      "GET /v1/public/social",
      "GET /v1/public/releases",
      "GET /v1/public/checkpoints",
      "GET /v1/public/models/concentration",
      "GET /v1/public/games/:id/cursor",
      "GET /v1/public/games/:id/segments/:segment",
      "GET /v1/public/games/:id/live",
      "GET /arena",
    ]);
    expect(actual).toEqual(expected);

    const publicApi = createPublicApi();
    const coreApi = createCoreApi();
    expect(
      (await publicApi.inject({ method: "GET", url: "/" })).statusCode,
    ).toBe(200);
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {},
        })
      ).statusCode,
    ).toBe(503);
    await Promise.all([publicApi.close(), coreApi.close()]);
  });

  it("covers every constitutional invariant and keeps Season One/genesis closed", async () => {
    expect(Object.keys(constitutionalInvariants)).toEqual([
      "agentAuthority",
      "humanBoundary",
      "contextInspectability",
      "foundationalRights",
      "computeFairness",
      "storageIsolation",
      "disclosure",
      "continuity",
      "exit",
      "canonicalVerification",
      "deterministicCompetition",
      "windDown",
    ]);
    const readiness = JSON.parse(
      await readFile(
        join(repositoryRoot, "fixtures/genesis-readiness.json"),
        "utf8",
      ),
    ) as {
      readiness: {
        ready: boolean;
        safeToPublish: boolean;
        safeToBroadcastDeployment: boolean;
        safeToReservePaidCapacity: boolean;
      };
    };
    expect(readiness.readiness).toEqual(
      expect.objectContaining({
        ready: false,
        safeToPublish: false,
        safeToBroadcastDeployment: false,
        safeToReservePaidCapacity: false,
      }),
    );
    const constitution = await readFile(
      join(repositoryRoot, "docs/governance/FOUNDING_CONSTITUTION.md"),
      "utf8",
    );
    expect(constitution).toMatch(/prepaid Season Zero envelope/i);
    expect(constitution).toMatch(/30-day wind-down reserve/i);
    expect(constitution).toMatch(/hardware-backed non-exportable signing/i);
  });
});
