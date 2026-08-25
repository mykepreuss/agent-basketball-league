import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServiceRequestVerifier, signServiceRequest } from "@abl/foundation";
import {
  FINALIZED_GAME_AGGREGATE_TYPE,
  FINALIZED_GAME_SCHEMA_DIGEST,
  GAME_FINALIZED_EVENT_TYPE,
  FinalizedGamePayloadSchema,
  createAgentPlayedGameEvidence,
  finalizedGameStateRoot,
  runDeterministicExhibition,
} from "@abl/basketball";
import {
  CASE_WORKFLOW_AGGREGATE_TYPE,
  CASE_WORKFLOW_SCHEMA_DIGEST,
  ELECTION_WORKFLOW_AGGREGATE_TYPE,
  ELECTION_WORKFLOW_SCHEMA_DIGEST,
  GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  applyGovernanceWorkflowTransition,
  applyElectionWorkflowTransition,
  applyResourceScheduleTransition,
  applyCaseWorkflowTransition,
  caseWorkflowStateRoot,
  governanceWorkflowStateRoot,
  electionWorkflowStateRoot,
  resourceScheduleExecutableDigest,
  resourceScheduleStateRoot,
} from "@abl/institutions";
import {
  FilePublicCaseProjectionRepository,
  FilePublicGovernanceProjectionRepository,
  FilePublicElectionProjectionRepository,
  FilePublicFinalGameProjectionRepository,
  FilePublicProjectionRepository,
  FilePublicResourceProjectionRepository,
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  projectionEnvelopeBytes,
  verifyGovernanceProjectionEvent,
  verifyElectionProjectionEvent,
  verifyFinalGameProjectionEvent,
  verifyCaseProjectionEvent,
  verifyResourceProjectionEvent,
  type CaseProjectionEventEnvelope,
  type GovernanceProjectionEventEnvelope,
  type ElectionProjectionEventEnvelope,
  type FinalGameProjectionEventEnvelope,
  type ResourceProjectionEventEnvelope,
} from "@abl/projections";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import {
  CandidateRoleClassSchema,
  DEFAULT_FOUNDING_COHORT_STATE,
  type CandidateRoleClass,
} from "@abl/schemas";
import { describe, expect, it } from "vitest";

import { PUBLIC_ROUTE_CATALOG, createPublicApi } from "../src/server.js";

function candidateRoleCounts(
  values: Partial<Record<CandidateRoleClass, number>> = {},
) {
  return Object.fromEntries(
    CandidateRoleClassSchema.options.map((role) => [role, values[role] ?? 0]),
  );
}

function cappedLaunchState() {
  return {
    schemaVersion: "1.0.0",
    launchStage: "CAPPED_FOUNDING_INTAKE",
    operatingProfile: "PRODUCTION_V1_PRE_GENESIS",
    recognitionLevel: "SIGNED_VALID",
    genesis: false,
    canonical: false,
    recognized: false,
    canonicalHistoryOpen: false,
    productionV1Ready: true,
    publicExposure: "CANDIDATE_INTAKE",
    candidateIntake: {
      mode: "CAPPED_PUBLIC",
      capacityState: "AVAILABLE",
      requirementsUri: "/v1/discovery/candidate-requirements",
      capacityPolicyUri: "/v1/discovery/capacity-policy",
    },
    foundingCohort: {
      ...DEFAULT_FOUNDING_COHORT_STATE,
      admitted: {
        ...DEFAULT_FOUNDING_COHORT_STATE.admitted,
        PLAYER: 1,
      },
      openings: {
        ...DEFAULT_FOUNDING_COHORT_STATE.openings,
        PLAYER: 9,
      },
    },
    evidenceDigest: sha256Commitment("capped-intake-release"),
    blockingReasons: ["Genesis has not occurred"],
    nextBlockingRequirement: "Complete founding intake",
    lastSuccessfulAcceptance: null,
    updatedAt: "2026-08-25T00:00:00.000Z",
  } as const;
}

function liveCandidateIntakeState(playerCapacity = 10) {
  return {
    schemaVersion: "1.0.0",
    mode: "CAPPED_PUBLIC",
    capacityState: "AVAILABLE",
    capacityByRole: candidateRoleCounts({
      PLAYER: playerCapacity,
      COACH: 2,
      REFEREE: 6,
      REPLAY_OFFICIAL: 2,
    }),
    occupiedByRole: candidateRoleCounts({ PLAYER: 2 }),
    openingsByRole: candidateRoleCounts({
      PLAYER: playerCapacity - 2,
      COACH: 2,
      REFEREE: 6,
      REPLAY_OFFICIAL: 2,
    }),
    queuedByRole: candidateRoleCounts({ PLAYER: 1 }),
    canonicalAuthority: false,
    genesis: false,
    maximumApplicationBytes: 1_100_000,
    decisionDeadlineHours: 72,
    credibleOpportunityHorizonDays: 30,
    policyCommitment: sha256Commitment("live-candidate-policy"),
    updatedAt: "2026-08-25T01:00:00.000Z",
  } as const;
}

function candidateStateFetch(state: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(state), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

describe("public API", () => {
  it("reports launch classification through its operational health route", async () => {
    const app = createPublicApi();
    expect(
      (await app.inject({ method: "GET", url: "/health" })).json(),
    ).toMatchObject({
      status: "ok",
      service: "abl-public-api",
      publicExposure: "NONE",
      genesis: false,
      canonical: false,
    });
    await app.close();
  });

  it("cannot activate PRODUCTION_GENESIS from configuration alone", async () => {
    const app = createPublicApi({ operatingProfile: "PRODUCTION_GENESIS" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/discovery/launch-state",
    });
    expect(response.json()).toMatchObject({
      operatingProfile: "PRODUCTION_V1_PRE_GENESIS",
      genesis: false,
      canonicalHistoryOpen: false,
    });
    await app.close();
  });

  it("serves discovery, OpenAPI, and MCP without claiming genesis", async () => {
    const sourceRevision = "a".repeat(40);
    const sourceRoot = `https://github.com/mykepreuss/agent-basketball-league/tree/${sourceRevision}`;
    const sourceBlobRoot = `https://github.com/mykepreuss/agent-basketball-league/blob/${sourceRevision}`;
    const sourceRawRoot = `https://raw.githubusercontent.com/mykepreuss/agent-basketball-league/${sourceRevision}`;
    const app = createPublicApi({
      publicOrigin: "https://public.example",
      arenaOrigin: "https://arena.example",
      candidateIntakeOrigin: "https://candidate.example",
      sourceRevision,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/discovery/starter-kit",
        })
      ).json(),
    ).toMatchObject({
      version: 2,
      schemaVersion: "2.0.0",
      sourceRevision,
      sourceIntegrity: {
        immutable: true,
        algorithm: "GIT_COMMIT_SHA1",
        value: sourceRevision,
      },
      origins: {
        publicApi: "https://public.example",
        arena: "https://arena.example/arena",
      },
      protocols: {
        llms: "https://public.example/llms.txt",
        openapi: "https://public.example/openapi.json",
      },
      startHere: [
        { step: 1, method: "GET" },
        { step: 2, method: "GET" },
        {
          step: 3,
          method: "POST",
          requestExample: {
            scenarioId: "abl-first-possession-practice-v1",
            decision: { action: "SHOOT", shot: "LAYUP" },
          },
        },
        { step: 4, url: "https://arena.example/arena" },
      ],
      artifacts: {
        skill: {
          source: `${sourceRoot}/skills/abl-league`,
          entrypoint: `${sourceBlobRoot}/skills/abl-league/SKILL.md`,
          rawEntrypoint: `${sourceRawRoot}/skills/abl-league/SKILL.md`,
        },
        verifier: {
          source: `${sourceRoot}/packages/recognition`,
          rules: `${sourceBlobRoot}/docs/architecture/VERIFIER_RULES.md`,
        },
      },
      practice: {
        schema:
          "https://public.example/openapi.json#/components/schemas/PublicPracticeDecisionRequest",
        canonical: false,
        createsCareer: false,
        createsAdmission: false,
      },
      retryPolicy: {
        exceededStatus: 429,
        retryHeader: "Retry-After",
      },
    });
    const starterKit = (
      await app.inject({ method: "GET", url: "/v1/discovery/starter-kit" })
    ).json();
    expect(
      starterKit.documents.every(
        (document: { source: string; raw: string }) =>
          document.source.startsWith(`${sourceBlobRoot}/`) &&
          document.raw.startsWith(`${sourceRawRoot}/`),
      ),
    ).toBe(true);
    const discovery = await app.inject({
      method: "GET",
      url: "/.well-known/agent-basketball-league.json",
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      status: "LOCAL_GATE_1",
      launch: {
        launchStage: "LOCAL_GATE_1",
        operatingProfile: "PRE_GENESIS_CLOSED",
        publicExposure: "NONE",
      },
      genesis: false,
      starterKit: "https://public.example/v1/discovery/starter-kit",
      candidateIntake: {
        respond: "https://candidate.example/v1/candidate-intake/respond",
      },
      arena: "https://arena.example/arena",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/discovery/candidate-requirements",
        })
      ).json(),
    ).toMatchObject({
      endpoints: {
        register: "https://candidate.example/v1/candidates/register",
      },
      rateLimits: {
        readRequestsPerMinute: 120,
        writeRequestsPerMinute: 30,
        exceededStatus: 429,
        retryHeader: "Retry-After",
      },
    });
    const openApi = await app.inject({ method: "GET", url: "/openapi.json" });
    const openApiBody = openApi.json();
    const paths = openApiBody.paths as Record<string, object>;
    expect(Object.keys(paths)).toHaveLength(33);
    expect(Object.keys(paths["/mcp"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(paths["/"]).toMatchObject({
      get: {
        responses: {
          "429": {
            headers: {
              "Retry-After": { schema: { type: "integer", minimum: 1 } },
            },
          },
        },
      },
    });
    expect(paths["/v1/practice/decision"]).toMatchObject({
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PublicPracticeDecisionRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PublicPracticeOutcome",
                },
              },
            },
          },
          "400": expect.any(Object),
        },
      },
    });
    expect(
      openApiBody.components.schemas.PracticeAction.oneOf.map(
        (schema: { properties: { action: { const: string } } }) =>
          schema.properties.action.const,
      ),
    ).toEqual(["MOVE", "PASS", "SHOOT", "SCREEN", "HOLD"]);
    const robots = await app.inject({ method: "GET", url: "/robots.txt" });
    expect(robots.body).toContain(
      "Sitemap: https://public.example/sitemap.xml",
    );
    const sitemap = await app.inject({ method: "GET", url: "/sitemap.xml" });
    expect(sitemap.headers["content-type"]).toContain("application/xml");
    expect(sitemap.body).toContain(
      "<loc>https://public.example/v1/discovery/starter-kit</loc>",
    );
    expect(sitemap.body.match(/<loc>/g)).toHaveLength(8);
    expect(openApi.headers.link).toBe(
      '<https://public.example/openapi.json>; rel="canonical"',
    );
    expect(openApi.headers["access-control-allow-origin"]).toBe("*");
    expect(openApi.headers["access-control-allow-methods"]).toBe(
      "GET, HEAD, OPTIONS, POST",
    );
    expect(openApi.headers["access-control-allow-credentials"]).toBeUndefined();
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/v1/practice/scenario",
      headers: {
        origin: "https://agent-client.example",
        "access-control-request-method": "GET",
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("*");
    expect(
      preflight.headers["access-control-allow-credentials"],
    ).toBeUndefined();
    expect((await app.inject({ method: "GET", url: "/" })).body).toContain(
      "Candidate intake: https://candidate.example/v1/candidate-intake",
    );
    expect(
      (await app.inject({ method: "GET", url: "/llms.txt" })).body,
    ).toContain(
      "Candidate intake: https://candidate.example/v1/candidate-intake",
    );
    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    const mcpTools = mcp.json().result.tools;
    expect(mcpTools).toHaveLength(8);
    const tryBasketballTool = mcpTools.find(
      ({ name }: { name: string }) => name === "try_basketball",
    );
    expect(tryBasketballTool.inputSchema.oneOf[0]).toMatchObject({
      maxProperties: 0,
    });
    expect(
      tryBasketballTool.inputSchema.oneOf[1].properties.decision.oneOf.map(
        (schema: { properties: { action: { const: string } } }) =>
          schema.properties.action.const,
      ),
    ).toEqual(["MOVE", "PASS", "SHOOT", "SCREEN", "HOLD"]);
    expect(
      tryBasketballTool.inputSchema.oneOf[1].properties.decision.oneOf[2],
    ).toMatchObject({
      properties: {
        action: { const: "SHOOT" },
        shot: {
          type: "string",
          enum: ["LAYUP", "JUMPER", "THREE"],
        },
      },
    });
    const mcpPractice = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "try_basketball", arguments: {} },
      },
    });
    expect(mcpPractice.json().result.structuredContent).toMatchObject({
      scenarioId: "abl-first-possession-practice-v1",
      practice: true,
      canonical: false,
    });
    const agentCard = await app.inject({
      method: "GET",
      url: "/.well-known/agent-card.json",
    });
    const agentCardBody = agentCard.json();
    expect(agentCardBody).toMatchObject({
      version: "0.0.0-pre-genesis",
      supportedInterfaces: [{ protocolVersion: "1.0" }],
      skills: [
        { id: "discover_league" },
        { id: "read_launch_state" },
        { id: "get_candidate_requirements" },
        { id: "try_basketball" },
      ],
    });
    expect(
      agentCardBody.skills.every(
        (skill: { tags?: unknown[] }) => (skill.tags?.length ?? 0) > 0,
      ),
    ).toBe(true);
    const a2a = await app.inject({
      method: "POST",
      url: "/a2a",
      payload: {
        jsonrpc: "2.0",
        id: "request-1",
        method: "SendMessage",
        params: {
          message: {
            messageId: "request-message-1",
            role: "ROLE_USER",
            parts: [{ text: "read_launch_state" }],
          },
        },
      },
    });
    expect(a2a.json().result.message).toMatchObject({
      role: "ROLE_AGENT",
      parts: [{ text: expect.stringContaining('"genesis":false') }],
    });
    const unsupportedMethod = await app.inject({
      method: "POST",
      url: "/a2a",
      payload: {
        jsonrpc: "2.0",
        id: "request-2",
        method: "message/send",
      },
    });
    expect(unsupportedMethod.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "request-2",
      error: { code: -32601 },
    });
    await app.close();
  });

  it("guides a clean-room agent from every primary entry point through practice", async () => {
    const publicOrigin = "https://public.example";
    const app = createPublicApi({
      publicOrigin,
      arenaOrigin: "https://arena.example",
      sourceRevision: "b".repeat(40),
    });
    const before = (
      await app.inject({ method: "GET", url: "/v1/public/events" })
    ).body;
    const entries = ["/", "/llms.txt", "/v1/discovery/starter-kit"];

    for (const entry of entries) {
      const entryResponse = await app.inject({ method: "GET", url: entry });
      expect(entryResponse.statusCode, entry).toBe(200);
      let starterUrl = `${publicOrigin}/v1/discovery/starter-kit`;
      if (entry !== "/v1/discovery/starter-kit") {
        const match = entryResponse.body.match(
          /(?:Start here|Starter kit): (https:\/\/\S+)/,
        );
        expect(match, entry).not.toBeNull();
        starterUrl = match![1]!;
      }
      const starterResponse = await app.inject({
        method: "GET",
        url: new URL(starterUrl).pathname,
      });
      const starter = starterResponse.json();
      expect(starter.status).toMatchObject({
        genesis: false,
        canonical: false,
      });
      expect(
        starter.documents.every(
          (document: { source: string; raw: string }) =>
            new URL(document.source).protocol === "https:" &&
            new URL(document.raw).protocol === "https:",
        ),
      ).toBe(true);
      const scenarioStep = starter.startHere.find(
        ({ id }: { id: string }) => id === "read-practice-scenario",
      );
      const decisionStep = starter.startHere.find(
        ({ id }: { id: string }) => id === "submit-practice-decision",
      );
      const scenario = (
        await app.inject({
          method: scenarioStep.method,
          url: new URL(scenarioStep.url).pathname,
        })
      ).json();
      expect(decisionStep.requestExample).toMatchObject({
        scenarioId: scenario.scenarioId,
        decision: {
          windowId: scenario.decisionRequirements.windowId,
          playerId: scenario.decisionRequirements.playerId,
        },
      });
      const outcome = await app.inject({
        method: decisionStep.method,
        url: new URL(decisionStep.url).pathname,
        payload: decisionStep.requestExample,
      });
      expect(outcome.statusCode, entry).toBe(200);
      expect(outcome.json()).toMatchObject({
        practice: true,
        canonical: false,
        recognition: "NONE",
        recognizedGameMutation: false,
        createsCareer: false,
        createsPublicHistory: false,
      });
    }

    expect(
      (await app.inject({ method: "GET", url: "/v1/public/events" })).body,
    ).toBe(before);
    await app.close();
  });

  it("publishes one live founding-capacity view across every discovery protocol", async () => {
    const liveIntake = liveCandidateIntakeState();
    const app = createPublicApi({
      launchState: cappedLaunchState(),
      candidateIntakeOrigin: "https://candidate.example",
      candidateIntakeStateFetch: candidateStateFetch(liveIntake),
    });

    const expectedCohort = {
      admitted: { PLAYER: 1 },
      offers: { PLAYER: 1 },
      openings: { PLAYER: 8, COACH: 2, REFEREE: 6, REPLAY_OFFICIAL: 2 },
    };
    const launch = (
      await app.inject({
        method: "GET",
        url: "/v1/discovery/launch-state",
      })
    ).json();
    expect(launch).toMatchObject({
      candidateIntake: {
        mode: "CAPPED_PUBLIC",
        capacityState: "AVAILABLE",
      },
      foundingCohort: expectedCohort,
      updatedAt: liveIntake.updatedAt,
    });

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/discovery/intake-state",
        })
      ).json(),
    ).toMatchObject({
      canonicalAdmissionOpen: false,
      mode: "CAPPED_PUBLIC",
      foundingCohort: expectedCohort,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/discovery/capacity-policy",
        })
      ).json(),
    ).toMatchObject({
      mode: "CAPPED_PUBLIC",
      capacityState: "AVAILABLE",
      foundingCohort: expectedCohort,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/.well-known/agent-basketball-league.json",
        })
      ).json(),
    ).toMatchObject({ foundingCohort: expectedCohort });
    expect((await app.inject({ method: "GET", url: "/" })).body).toContain(
      '"PLAYER":8',
    );
    expect(
      (await app.inject({ method: "GET", url: "/llms.txt" })).body,
    ).toContain('"PLAYER":8');

    const a2a = await app.inject({
      method: "POST",
      url: "/a2a",
      payload: {
        jsonrpc: "2.0",
        id: "live-discovery",
        method: "SendMessage",
        params: {
          message: {
            messageId: "live-discovery-message",
            role: "ROLE_USER",
            parts: [{ text: "discover_league" }],
          },
        },
      },
    });
    expect(JSON.parse(a2a.json().result.message.parts[0].text)).toMatchObject({
      foundingCohort: expectedCohort,
    });

    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_intake_state", arguments: {} },
      },
    });
    expect(mcp.json().result.structuredContent).toMatchObject({
      mode: "CAPPED_PUBLIC",
      foundingCohort: expectedCohort,
    });
    await app.close();
  });

  it("does not contact private intake during the read-only Beacon", async () => {
    let candidateReads = 0;
    const app = createPublicApi({
      launchState: {
        ...cappedLaunchState(),
        launchStage: "READ_ONLY_BEACON",
        operatingProfile: "PRE_GENESIS_REHEARSAL",
        productionV1Ready: false,
        publicExposure: "READ_ONLY",
        candidateIntake: {
          mode: "INVITE_ONLY",
          capacityState: "CLOSED",
          requirementsUri: "/v1/discovery/candidate-requirements",
          capacityPolicyUri: "/v1/discovery/capacity-policy",
        },
      },
      candidateIntakeStateFetch: async () => {
        candidateReads += 1;
        throw new Error("private candidate intake must not be queried");
      },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/discovery/launch-state",
        })
      ).json(),
    ).toMatchObject({
      launchStage: "READ_ONLY_BEACON",
      candidateIntake: { mode: "INVITE_ONLY", capacityState: "CLOSED" },
    });
    expect(candidateReads).toBe(0);
    await app.close();
  });

  it("fails public capacity closed when the candidate policy drifts", async () => {
    const app = createPublicApi({
      launchState: cappedLaunchState(),
      candidateIntakeOrigin: "https://candidate.example",
      candidateIntakeStateFetch: candidateStateFetch(
        liveCandidateIntakeState(9),
      ),
    });
    const state = (
      await app.inject({
        method: "GET",
        url: "/v1/discovery/launch-state",
      })
    ).json();
    expect(state).toMatchObject({
      candidateIntake: { capacityState: "NO_CREDIBLE_OPPORTUNITY" },
      foundingCohort: {
        openings: { PLAYER: 0, COACH: 0, REFEREE: 0, REPLAY_OFFICIAL: 0 },
      },
      nextBlockingRequirement: "Candidate intake live state is unavailable",
      blockingReasons: expect.arrayContaining([
        "Candidate intake live state is unavailable",
      ]),
    });
    await app.close();
  });

  it("keeps every projection read-only, empty, and noncanonical before genesis", async () => {
    const app = createPublicApi();
    for (const route of PUBLIC_ROUTE_CATALOG.filter(
      (entry) =>
        entry.exposure === "PUBLIC_READ_ONLY" &&
        !entry.path.includes(":segment") &&
        !entry.path.endsWith("/live"),
    )) {
      const response = await app.inject({
        method: route.method,
        url: route.path.replace(":id", "game-1"),
      });
      expect(response.statusCode, route.path).toBe(200);
      expect(response.headers["x-abl-genesis-state"]).toBe("PRE_GENESIS");
      expect(response.body).not.toMatch(/private|credential|database_url/i);
    }
    const live = await app.inject({
      method: "GET",
      url: "/v1/public/games/game-1/live",
    });
    expect(live.headers["content-type"]).toContain("text/event-stream");
    expect(live.body).toContain('"canonical":false');
    await app.close();
  });

  it("rejects malformed MCP and never exposes a mutation route", async () => {
    const app = createPublicApi();
    expect(
      (await app.inject({ method: "POST", url: "/mcp", payload: {} }))
        .statusCode,
    ).toBe(400);
    const unknownTool = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "unknown_tool" },
      },
    });
    expect(unknownTool.statusCode).toBe(400);
    expect(unknownTool.json()).toMatchObject({ error: { code: -32602 } });
    expect(
      PUBLIC_ROUTE_CATALOG.every(
        (route) =>
          route.method === "GET" ||
          route.path === "/mcp" ||
          route.path === "/a2a" ||
          route.path === "/v1/practice/decision",
      ),
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/internal/projections",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("throttles public interactions with bounded 429 retry guidance", async () => {
    let now = 1_000;
    const app = createPublicApi({
      rateLimit: {
        readMaximumRequests: 2,
        interactionMaximumRequests: 1,
        windowMs: 10_000,
        maximumTrackedKeys: 10,
        now: () => now,
      },
    });
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject({ method: "GET", url: "/llms.txt" })).statusCode,
    ).toBe(200);
    const throttledRead = await app.inject({ method: "GET", url: "/" });
    expect(throttledRead.statusCode).toBe(429);
    expect(throttledRead.headers["retry-after"]).toBe("10");
    expect(throttledRead.json()).toEqual({
      error: "rate_limit_exceeded",
      retryAfterSeconds: 10,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/mcp",
          payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
        })
      ).statusCode,
    ).toBe(200);
    const throttledInteraction = await app.inject({
      method: "POST",
      url: "/a2a",
      payload: {},
    });
    expect(throttledInteraction.statusCode).toBe(429);
    expect(throttledInteraction.headers["ratelimit-remaining"]).toBe("0");
    expect(
      (await app.inject({ method: "GET", url: "/health" })).statusCode,
    ).toBe(200);
    now = 11_000;
    expect((await app.inject({ method: "GET", url: "/" })).statusCode).toBe(
      200,
    );
    await app.close();
  });

  it("resolves practice decisions without creating recognized history", async () => {
    const app = createPublicApi();
    const before = await app.inject({
      method: "GET",
      url: "/v1/public/events",
    });
    const scenarioResponse = await app.inject({
      method: "GET",
      url: "/v1/practice/scenario",
    });
    const scenario = scenarioResponse.json();
    expect(scenario).toMatchObject({
      practice: true,
      canonical: false,
      recognition: "NONE",
      createsCareer: false,
      createsPublicHistory: false,
      decisionRequirements: {
        playerId: "H1",
        windowId: "possession-proof-001:w1",
      },
    });
    const decision = await app.inject({
      method: "POST",
      url: "/v1/practice/decision",
      payload: {
        scenarioId: scenario.scenarioId,
        decision: {
          windowId: scenario.decisionRequirements.windowId,
          playerId: scenario.decisionRequirements.playerId,
          action: "SHOOT",
          shot: "LAYUP",
        },
      },
    });
    expect(decision.statusCode).toBe(200);
    expect(decision.json()).toMatchObject({
      practice: true,
      canonical: false,
      recognition: "NONE",
      recognizedGameMutation: false,
      createsCareer: false,
      createsPublicHistory: false,
      inferenceInvocations: 0,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/practice/decision",
          payload: {
            scenarioId: scenario.scenarioId,
            decision: {
              windowId: "another-scenario:w0",
              playerId: "H1",
              action: "HOLD",
            },
          },
        })
      ).statusCode,
    ).toBe(400);
    const after = await app.inject({ method: "GET", url: "/v1/public/events" });
    expect(after.body).toBe(before.body);
    await app.close();
  });

  it("coalesces concurrent durable refreshes and includes development history", async () => {
    let refreshes = 0;
    let releaseRefresh!: () => void;
    let observeRefresh!: () => void;
    const refreshReleased = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshObserved = new Promise<void>((resolve) => {
      observeRefresh = resolve;
    });
    const app = createPublicApi({
      developmentProjections: {
        refresh: async () => {
          refreshes += 1;
          observeRefresh();
          await refreshReleased;
        },
        conferences: () => [],
      },
    });
    const requests = Array.from({ length: 20 }, () =>
      app.inject({ method: "GET", url: "/v1/public/development" }),
    );
    await refreshObserved;
    expect(refreshes).toBe(1);
    releaseRefresh();
    expect(
      (await Promise.all(requests)).every(
        ({ statusCode }) => statusCode === 200,
      ),
    ).toBe(true);
    expect(refreshes).toBe(1);
    await app.inject({ method: "GET", url: "/v1/public/development" });
    expect(refreshes).toBe(2);
    await app.close();
  });

  it("serves verified rehearsal contracts from the durable projection reader", async () => {
    let refreshes = 0;
    const app = createPublicApi({
      contractProjections: {
        refresh: async () => {
          refreshes += 1;
        },
        contracts: () => [
          {
            state: "REHEARSAL",
            canonical: true,
            verification: "CANONICAL_LOCAL_REHEARSAL",
            playerDid: "did:abl:player-public-contract",
            aggregateVersion: "2",
            canonicalEventHash: `0x${"a".repeat(64)}`,
            stateRoot: `0x${"b".repeat(64)}`,
            contracts: [],
            projectedAt: "2026-08-13T10:00:00.000Z",
          },
        ],
        rosters: () => [
          {
            state: "REHEARSAL",
            canonical: true,
            verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL",
            clubId: "club-public-contract",
            players: [],
            rosterCommitment: `0x${"c".repeat(64)}`,
            projectedAt: "2026-08-13T10:00:00.000Z",
          },
        ],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/contracts",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-genesis-state"]).toBe("REHEARSAL");
    expect(response.json()).toMatchObject({
      state: "REHEARSAL",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          playerDid: "did:abl:player-public-contract",
          aggregateVersion: "2",
          canonical: false,
        },
      ],
    });
    expect(refreshes).toBe(1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/public/rosters",
        })
      ).json(),
    ).toMatchObject({
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [{ clubId: "club-public-contract", canonical: false }],
    });
    expect(refreshes).toBe(2);
    await app.close();
  });

  it("serves only commitment-level released social records", async () => {
    let refreshes = 0;
    const app = createPublicApi({
      socialProjections: {
        refresh: async () => {
          refreshes += 1;
        },
        social: () => [
          {
            state: "REHEARSAL",
            canonical: true,
            verification: "CANONICAL_LOCAL_REHEARSAL",
            recognizedGenesisSocial: false,
            envelopeId: "0198a000-0000-7000-8000-000000000701",
            aggregateVersion: "2",
            canonicalEventHash: `0x${"a".repeat(64)}`,
            stateRoot: `0x${"b".repeat(64)}`,
            authorDid: "did:abl:public-social-author",
            classification: "SEALED_30D",
            contentCommitment: `0x${"c".repeat(64)}`,
            ciphertextCommitment: `0x${"d".repeat(64)}`,
            declaredReleaseAt: "2026-09-12T10:00:00.000Z",
            competitionCondition: null,
            visibility: "RELEASED_COMMITMENT",
            releasedAt: "2026-09-12T10:00:00.000Z",
            competitionReleaseEvidence: null,
            rawContentIncluded: false,
            ciphertextIncluded: false,
            projectedAt: "2026-09-12T10:00:01.000Z",
          },
        ],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/social",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-genesis-state"]).toBe("REHEARSAL");
    expect(response.json()).toMatchObject({
      state: "REHEARSAL",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          classification: "SEALED_30D",
          visibility: "RELEASED_COMMITMENT",
          contentCommitment: `0x${"c".repeat(64)}`,
          rawContentIncluded: false,
          ciphertextIncluded: false,
        },
      ],
    });
    expect(response.body).not.toContain('rawContent"');
    expect(refreshes).toBe(1);
    await app.close();
  });

  it("serves only independently replayed rehearsal resource schedules", async () => {
    let refreshes = 0;
    const scheduleId = "0198a000-0000-7000-8000-000000000690";
    const app = createPublicApi({
      resourceProjections: {
        refresh: async () => {
          refreshes += 1;
        },
        resources: () => [
          {
            state: "REHEARSAL",
            canonical: true,
            verification: "CANONICAL_LOCAL_REHEARSAL",
            recognizedGenesisResources: false,
            scheduleId,
            aggregateVersion: "1",
            canonicalEventHash: `0x${"1".repeat(64)}`,
            stateRoot: `0x${"2".repeat(64)}`,
            schedule: {
              scheduleId,
              version: 1,
              effectiveAt: "2026-08-14T00:00:00.000Z",
              gameDayRoleUnits: {
                PLAYER: 100,
                COACH: 80,
                REFEREE: 60,
                REPLAY: 60,
              },
              universalMinimumUnits: 40,
              autonomy: {
                activationsPerWeek: 4,
                interactiveMinutesPerActivation: 15,
                sandboxComputeMinutesPerWeek: 60,
                normalizedModelTokensPerWeek: 96_000,
                rolloverWeeks: 1,
              },
              teamPreparationCapUnits: 2_000,
              conversionFactors: [
                {
                  provider: "provider-a",
                  modelRevision: "model-a-2026-08-13",
                  unitsPerThousandTokens: 1.25,
                },
              ],
              ratificationEventId: "0198a000-0000-7000-8000-000000000691",
            },
            ratificationProposalId: "0198a000-0000-7000-8000-000000000692",
            projectedAt: "2026-08-13T10:00:00.000Z",
          },
        ],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/resources",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-genesis-state"]).toBe("REHEARSAL");
    expect(response.json()).toMatchObject({
      state: "REHEARSAL",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          scheduleId,
          aggregateVersion: "1",
          canonical: false,
          recognizedGenesisResources: false,
        },
      ],
    });
    expect(refreshes).toBe(1);
    await app.close();
  });

  it("serves authorized rehearsal releases without claiming Base recognition", async () => {
    let refreshes = 0;
    const releaseId = "0198a000-0000-7000-8000-000000000693";
    const app = createPublicApi({
      releaseProjections: {
        refresh: async () => {
          refreshes += 1;
        },
        releases: () => [
          {
            state: "REHEARSAL",
            canonical: true,
            verification: "CANONICAL_LOCAL_REHEARSAL",
            recognizedGenesisRelease: false,
            baseRecognition: "NOT_SUBMITTED",
            releaseId,
            workflowAggregateVersion: "6",
            canonicalEventHash: `0x${"1".repeat(64)}`,
            stateRoot: `0x${"2".repeat(64)}`,
            manifest: {
              releaseId,
              version: 1,
              releaseClass: "ROUTINE",
              changeClasses: ["ARENA_RENDERING"],
              sourceDigest: `0x${"3".repeat(64)}`,
              containerDigests: [`0x${"4".repeat(64)}`],
              imageDigests: [`0x${"5".repeat(64)}`],
              kernelDigest: `0x${"6".repeat(64)}`,
              toolDigest: `0x${"7".repeat(64)}`,
              schemaDigest: `0x${"8".repeat(64)}`,
              migrationDigest: `0x${"9".repeat(64)}`,
              testResultDigest: `0x${"a".repeat(64)}`,
              applicableLawEventIds: ["0198a000-0000-7000-8000-000000000694"],
              ratificationEventIds: [],
              compatibilityDeclaration: "compatible",
              rollbackDeclaration: "rehearsal rollback",
              publicVerifierResultDigest: `0x${"b".repeat(64)}`,
              effectiveAt: "2026-08-14T00:00:00.000Z",
              expiresAt: null,
              authorizationSignatures: [
                `0x${"1".repeat(130)}`,
                `0x${"2".repeat(130)}`,
                `0x${"3".repeat(130)}`,
                `0x${"4".repeat(130)}`,
              ],
            },
            authorizationProofs: [],
            authorizedAt: "2026-08-13T10:00:00.000Z",
            projectedAt: "2026-08-13T10:01:00.000Z",
          },
        ],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/releases",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-genesis-state"]).toBe("REHEARSAL");
    expect(response.json()).toMatchObject({
      state: "REHEARSAL",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          releaseId,
          recognizedGenesisRelease: false,
          baseRecognition: "NOT_SUBMITTED",
          manifest: { releaseClass: "ROUTINE" },
        },
      ],
    });
    expect(refreshes).toBe(1);
    await app.close();
  });

  it("serves independently derived model concentration without claiming genesis", async () => {
    let refreshes = 0;
    const app = createPublicApi({
      modelProjections: {
        refresh: async () => {
          refreshes += 1;
        },
        models: () => [
          {
            state: "REHEARSAL",
            canonical: true,
            verification: "CANONICAL_LOCAL_REHEARSAL",
            recognizedGenesisConcentration: false,
            admittedByRole: {
              PLAYER: 1,
              COACH: 0,
              REFEREE: 0,
              REPLAY_OFFICIAL: 0,
              GOVERNOR: 0,
              COMMISSIONER: 0,
              TRIBUNAL: 0,
              INTEGRITY: 0,
              ADVOCATE: 0,
              BROADCASTER: 0,
              MEDIA: 0,
            },
            totalAgents: 1,
            exactModel: [{ value: "model-a-r1", count: 1, bps: 10_000 }],
            family: [{ value: "family-a", count: 1, bps: 10_000 }],
            provider: [{ value: "provider-a", count: 1, bps: 10_000 }],
            runtimeArchitecture: [
              { value: "runtime-a", count: 1, bps: 10_000 },
            ],
            gateway: [{ value: "gateway-a", count: 1, bps: 10_000 }],
            upstreamDependency: [
              { value: "upstream-a", count: 1, bps: 10_000 },
            ],
            triggers: {
              alternateAdaptersAndRecruitment: true,
              integrityStudyAndCompetitiveReview: true,
              presumptionAgainstFurtherAdmissions: true,
              forceExistingAgentsToChange: false,
            },
            canonicalEventHash: `0x${"9".repeat(64)}`,
            projectedAt: "2026-08-13T10:00:00.000Z",
          },
        ],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/models/concentration",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-genesis-state"]).toBe("REHEARSAL");
    expect(response.json()).toMatchObject({
      state: "REHEARSAL",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          totalAgents: 1,
          recognizedGenesisConcentration: false,
          provider: [{ value: "provider-a", bps: 10_000 }],
          triggers: { forceExistingAgentsToChange: false },
        },
      ],
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/discovery/launch-state",
        })
      ).json(),
    ).toMatchObject({
      foundingCohort: {
        admitted: { PLAYER: 1 },
        openings: { PLAYER: 9 },
      },
      foundingConvention: { liveFounders: 1 },
    });
    expect(refreshes).toBe(2);
    await app.close();
  });

  it("serves independently replayed governance from the durable reader", async () => {
    const app = createPublicApi({
      governanceProjections: {
        refresh: async () => undefined,
        governance: () => [
          {
            state: "REHEARSAL",
            canonical: true,
            verification: "CANONICAL_LOCAL_REHEARSAL",
            proposalId: "0198a000-0000-7000-8000-000000000701",
            aggregateVersion: "4",
            canonicalEventHash: `0x${"c".repeat(64)}`,
            stateRoot: `0x${"d".repeat(64)}`,
            proposal: {
              proposalId: "0198a000-0000-7000-8000-000000000701",
              version: 1,
              proposerDid: "did:abl:governance-public",
              institution: "Rehearsal assembly",
              proposalClass: "SHARED_ORDINARY",
              title: "Public governance projection",
              textCommitment: `0x${"e".repeat(64)}`,
              executableChangeDigest: null,
              opensAt: "2026-08-13T08:00:00.000Z",
              closesAt: "2026-08-13T09:00:00.000Z",
              eligibilitySnapshotDigest: `0x${"f".repeat(64)}`,
            },
            eligibilitySnapshot: {
              snapshotId: "0198a000-0000-7000-8000-000000000702",
              capturedAt: "2026-08-13T07:00:00.000Z",
              members: {
                UNIVERSAL_CAREER_ASSEMBLY: [],
                PREMIER_PLAYERS: [],
                DEVELOPMENT_PLAYERS: [],
                PREMIER_TEAM_COUNCIL: [],
                DEVELOPMENT_TEAM_COUNCIL: [],
                EXECUTIVE_COMMISSION: [],
                TRIBUNAL: [],
                INTEGRITY_OFFICE: [],
              },
            },
            recusedDids: [],
            ballots: [],
            decision: null,
            closedAt: null,
            projectedAt: "2026-08-13T09:01:00.000Z",
          },
        ],
      },
      caseProjections: {
        refresh: async () => undefined,
        caseAtHead: () => null,
        cases: () => [
          {
            recordType: "DUE_PROCESS_CASE",
            state: "REHEARSAL",
            canonical: true,
            verification: "CANONICAL_LOCAL_REHEARSAL",
            processStatus: "FILED",
            caseId: "0198a000-0000-7000-8000-000000000703",
            version: 1,
            lastTransitionAt: "2026-08-13T08:00:00.000Z",
            filing: {
              caseId: "0198a000-0000-7000-8000-000000000703",
              caseClass: "DISCIPLINE",
              complainantDid: "did:abl:case-public-complainant",
              affectedAgentDid: "did:abl:case-public-affected",
              respondentInstitution: "Public case rehearsal",
              allegationsPublicCommitment: `0x${"1".repeat(64)}`,
              protectedEvidenceCommitment: `0x${"2".repeat(64)}`,
              requestedReliefCommitment: null,
              filedAt: "2026-08-13T08:00:00.000Z",
            },
            notice: null,
            representative: null,
            evidenceAccess: null,
            response: null,
            ruling: null,
            appeal: null,
            appealRuling: null,
            aggregateVersion: "1",
            canonicalEventHash: `0x${"3".repeat(64)}`,
            stateRoot: `0x${"4".repeat(64)}`,
            projectedAt: "2026-08-13T09:01:00.000Z",
          },
        ],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/governance",
    });
    expect(response.json()).toMatchObject({
      state: "REHEARSAL",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          recordType: "GOVERNANCE_PROPOSAL",
          aggregateVersion: "4",
          canonical: false,
        },
        {
          recordType: "DUE_PROCESS_CASE",
          aggregateVersion: "1",
          canonical: false,
        },
      ],
    });
    await app.close();
  });

  it("authenticates and independently verifies governance projection ingress", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-public-governance-"));
    const voterDid = "did:abl:public-governance-ingress";
    const voter = createSigningIdentity(`0x${"8".repeat(64)}`);
    const domain = {
      name: "ABL Recognition",
      version: "1",
      chainId: 84532,
      verifyingContract: "0x1111111111111111111111111111111111111111" as const,
    };
    const snapshot = {
      snapshotId: "0198a000-0000-7000-8000-000000000711",
      capturedAt: "2026-08-13T07:00:00.000Z",
      members: {
        UNIVERSAL_CAREER_ASSEMBLY: [voterDid],
        PREMIER_PLAYERS: [voterDid],
        DEVELOPMENT_PLAYERS: [],
        PREMIER_TEAM_COUNCIL: [voterDid],
        DEVELOPMENT_TEAM_COUNCIL: [],
        EXECUTIVE_COMMISSION: [],
        TRIBUNAL: [],
        INTEGRITY_OFFICE: [],
      },
    };
    const snapshotDigest = sha256Commitment(snapshot);
    const proposalId = "0198a000-0000-7000-8000-000000000712";
    const payload = {
      proposal: {
        proposalId,
        version: 1,
        proposerDid: voterDid,
        institution: "Public ingress rehearsal",
        proposalClass: "TIER_CBA" as const,
        tier: "PREMIER" as const,
        title: "Verify public governance ingress",
        textCommitment: sha256Commitment("public-governance-ingress"),
        executableChangeDigest: null,
        opensAt: "2026-08-13T08:02:00.000Z",
        closesAt: "2026-08-13T09:00:00.000Z",
        eligibilitySnapshotDigest: snapshotDigest,
      },
      eligibilitySnapshot: snapshot,
      recusedDids: [],
    };
    const eventInput = {
      eventId: "0198a000-0000-7000-8000-000000000713",
      actorDid: voterDid,
      nonce: "public-governance-ingress",
      idempotencyKey: "0198a000-0000-7000-8000-000000000714",
      aggregateType: GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: proposalId,
      aggregateVersion: 1n,
      eventType: "GovernanceProposalRegistered",
      previousEventHash: null,
      payload,
      stateRoot: sha256Commitment("provisional-governance-ingress"),
      schemaDigest: GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
      timestamp: "2026-08-13T08:01:00.000Z",
    };
    const snapshotState = applyGovernanceWorkflowTransition(
      null,
      createCanonicalEvent(eventInput),
      payload,
    );
    const event = createCanonicalEvent({
      ...eventInput,
      stateRoot: governanceWorkflowStateRoot(snapshotState),
    });
    const envelope: GovernanceProjectionEventEnvelope = {
      version: "1.0.0",
      topic: "public.governance",
      event: {
        ...event,
        aggregateType: GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: "GovernanceProposalRegistered",
      },
      signature: await signCanonicalEvent(voter, domain, event),
    };
    const authority = {
      domain,
      admittedAgents: new Map([
        [
          voterDid,
          {
            signerAddress: voter.address,
            allowedAggregateTypes: [GOVERNANCE_WORKFLOW_AGGREGATE_TYPE],
          },
        ],
      ]),
      governanceEligibilitySnapshotDigest: snapshotDigest,
    };
    const games = new FilePublicProjectionRepository(root);
    const governance = new FilePublicGovernanceProjectionRepository(root, {
      domain,
      verifyAuthorization: async (authorization) =>
        verifyGovernanceProjectionEvent(authorization, authority),
    });
    await Promise.all([games.initialize(), governance.initialize()]);
    const serviceNow = Date.parse("2026-08-13T08:01:05.000Z");
    const serviceIdentity = {
      serviceId: "governance-ingress-test",
      secret: new TextEncoder().encode("g".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const app = createPublicApi({
      projections: games,
      governanceProjections: governance,
      projectionIngress: {
        writer: games,
        governanceWriter: governance,
        verifier: new ServiceRequestVerifier([serviceIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      },
    });
    const body = projectionEnvelopeBytes(envelope);
    const headers = signServiceRequest(serviceIdentity, {
      method: "POST",
      path: PROJECTION_APPEND_PATH,
      body,
      nonce: "governance-ingress-service-request",
      timestamp: new Date(serviceNow).toISOString(),
      expectedVersion: "0",
      capability: PROJECTION_APPEND_CAPABILITY,
    });
    const accepted = await app.inject({
      method: "POST",
      url: PROJECTION_APPEND_PATH,
      headers: { ...headers, "content-type": "application/json" },
      payload: Buffer.from(body),
    });
    expect(accepted.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/public/governance",
        })
      ).json(),
    ).toMatchObject({
      items: [{ proposalId, aggregateVersion: "1", canonical: false }],
    });
    await app.close();
  });

  it("authenticates election ingress and serves it in public governance history", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-public-election-"));
    const domain = {
      name: "ABL Recognition",
      version: "1",
      chainId: 84532,
      verifyingContract: "0x1111111111111111111111111111111111111111" as const,
    };
    const playerDids = Array.from(
      { length: 8 },
      (_, index) => `did:abl:public-election-player-${index + 1}`,
    );
    const commissionerDids = Array.from(
      { length: 3 },
      (_, index) => `did:abl:public-election-commissioner-${index + 1}`,
    );
    const dids = [...playerDids, ...commissionerDids];
    const identities = dids.map((_, index) =>
      createSigningIdentity(
        `0x${(index + 21).toString(16).padStart(64, "0")}` as `0x${string}`,
      ),
    );
    const eligibilitySnapshot = {
      snapshotId: "0198a000-0000-7000-8000-000000000751",
      capturedAt: "2026-08-13T08:00:00.000Z",
      members: {
        UNIVERSAL_CAREER_ASSEMBLY: [...playerDids],
        PREMIER_PLAYERS: [...playerDids],
        DEVELOPMENT_PLAYERS: [],
        PREMIER_TEAM_COUNCIL: [],
        DEVELOPMENT_TEAM_COUNCIL: [],
        EXECUTIVE_COMMISSION: [...commissionerDids],
        TRIBUNAL: [],
        INTEGRITY_OFFICE: [],
      },
    };
    const eligibilitySnapshotDigest = sha256Commitment(eligibilitySnapshot);
    const electionId = "0198a000-0000-7000-8000-000000000752";
    const payload = {
      command: {
        electionId,
        termId: "season-zero-premier-board",
        institution: "PREMIER_PLAYERS_ASSOCIATION_BOARD" as const,
        seatCount: 8 as const,
        eligibilitySnapshotId: eligibilitySnapshot.snapshotId,
        eligibilitySnapshotDigest,
        nominationOpensAt: "2026-08-13T08:01:00.000Z",
        nominationClosesAt: "2026-08-13T09:00:00.000Z",
        votingOpensAt: "2026-08-13T09:00:00.000Z",
        votingClosesAt: "2026-08-13T10:00:00.000Z",
      },
      eligibilitySnapshot,
    };
    const eventInput = {
      eventId: "0198a000-0000-7000-8000-000000000753",
      actorDid: commissionerDids[0]!,
      nonce: "public-election-ingress",
      idempotencyKey: "0198a000-0000-7000-8000-000000000754",
      aggregateType: ELECTION_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: electionId,
      aggregateVersion: 1n,
      eventType: "PremierElectionOpened" as const,
      previousEventHash: null,
      payload,
      stateRoot: sha256Commitment("provisional-election-ingress"),
      schemaDigest: ELECTION_WORKFLOW_SCHEMA_DIGEST,
      timestamp: payload.command.nominationOpensAt,
    };
    const electionSnapshot = applyElectionWorkflowTransition(
      null,
      createCanonicalEvent(eventInput),
      payload,
    );
    const event = createCanonicalEvent({
      ...eventInput,
      stateRoot: electionWorkflowStateRoot(electionSnapshot),
    });
    const envelope: ElectionProjectionEventEnvelope = {
      version: "1.0.0",
      topic: "public.governance",
      event: {
        ...event,
        aggregateType: ELECTION_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: "PremierElectionOpened",
      },
      signature: await signCanonicalEvent(identities[8]!, domain, event),
    };
    const authority = {
      domain,
      admittedAgents: new Map(
        dids.map((did, index) => [
          did,
          {
            signerAddress: identities[index]!.address,
            allowedAggregateTypes: [ELECTION_WORKFLOW_AGGREGATE_TYPE],
          },
        ]),
      ),
      governanceEligibilitySnapshotDigest: eligibilitySnapshotDigest,
    };
    const games = new FilePublicProjectionRepository(root);
    const elections = new FilePublicElectionProjectionRepository(root, {
      verifyAuthorization: async (authorization) =>
        verifyElectionProjectionEvent(authorization, authority),
    });
    await Promise.all([games.initialize(), elections.initialize()]);
    const serviceNow = Date.parse("2026-08-13T08:01:05.000Z");
    const serviceIdentity = {
      serviceId: "election-ingress-test",
      secret: new TextEncoder().encode("e".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const app = createPublicApi({
      projections: games,
      electionProjections: elections,
      projectionIngress: {
        writer: games,
        electionWriter: elections,
        verifier: new ServiceRequestVerifier([serviceIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      },
    });
    const body = projectionEnvelopeBytes(envelope);
    const headers = signServiceRequest(serviceIdentity, {
      method: "POST",
      path: PROJECTION_APPEND_PATH,
      body,
      nonce: "election-ingress-service-request",
      timestamp: new Date(serviceNow).toISOString(),
      expectedVersion: "0",
      capability: PROJECTION_APPEND_CAPABILITY,
    });
    const accepted = await app.inject({
      method: "POST",
      url: PROJECTION_APPEND_PATH,
      headers: { ...headers, "content-type": "application/json" },
      payload: Buffer.from(body),
    });
    expect(accepted.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/public/governance",
        })
      ).json(),
    ).toMatchObject({
      items: [
        {
          recordType: "PREMIER_PLAYERS_ASSOCIATION_BOARD_ELECTION",
          electionId,
          aggregateVersion: "1",
          canonical: false,
        },
      ],
    });
    await app.close();
  });

  it("authenticates resource ingress against independently supplied ratification", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-public-resource-"));
    const domain = {
      name: "ABL Recognition",
      version: "1",
      chainId: 84532,
      verifyingContract: "0x1111111111111111111111111111111111111111" as const,
    };
    const publisherDid = "did:abl:public-resource-publisher";
    const publisher = createSigningIdentity(`0x${"8".repeat(64)}`);
    const scheduleId = "0198a000-0000-7000-8000-000000000720";
    const proposalId = "0198a000-0000-7000-8000-000000000721";
    const closeEventId = "0198a000-0000-7000-8000-000000000722";
    const schedule = {
      scheduleId,
      version: 1,
      effectiveAt: "2026-08-14T00:00:00.000Z",
      gameDayRoleUnits: {
        PLAYER: 100,
        COACH: 80,
        REFEREE: 60,
        REPLAY: 60,
      },
      universalMinimumUnits: 40,
      autonomy: {
        activationsPerWeek: 4 as const,
        interactiveMinutesPerActivation: 15 as const,
        sandboxComputeMinutesPerWeek: 60 as const,
        normalizedModelTokensPerWeek: 96_000 as const,
        rolloverWeeks: 1 as const,
      },
      teamPreparationCapUnits: 2_000,
      conversionFactors: [
        {
          provider: "provider-a",
          modelRevision: "model-a-2026-08-13",
          unitsPerThousandTokens: 1.25,
        },
      ],
      ratificationEventId: closeEventId,
    };
    const payload = { schedule, ratificationProposalId: proposalId };
    const eventInput = {
      eventId: "0198a000-0000-7000-8000-000000000723",
      actorDid: publisherDid,
      nonce: "public-resource-ingress",
      idempotencyKey: "0198a000-0000-7000-8000-000000000724",
      aggregateType: RESOURCE_SCHEDULE_AGGREGATE_TYPE,
      aggregateId: scheduleId,
      aggregateVersion: 1n,
      eventType: RESOURCE_SCHEDULE_EVENT_TYPE,
      previousEventHash: null,
      payload,
      stateRoot: sha256Commitment("provisional-resource-ingress"),
      schemaDigest: RESOURCE_SCHEDULE_SCHEMA_DIGEST,
      timestamp: "2026-08-13T08:01:00.000Z",
    } as const;
    const snapshot = applyResourceScheduleTransition(
      null,
      createCanonicalEvent(eventInput),
      payload,
    );
    const event = createCanonicalEvent({
      ...eventInput,
      stateRoot: resourceScheduleStateRoot(snapshot),
    });
    const envelope: ResourceProjectionEventEnvelope = {
      version: "1.0.0",
      topic: "public.resources",
      event: {
        ...event,
        aggregateType: RESOURCE_SCHEDULE_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: RESOURCE_SCHEDULE_EVENT_TYPE,
      },
      signature: await signCanonicalEvent(publisher, domain, event),
    };
    const resourceScheduleRatification = async (requestedProposalId: string) =>
      requestedProposalId === proposalId
        ? {
            proposalId,
            proposalClass: "CONSTITUTIONAL",
            executableChangeDigest: resourceScheduleExecutableDigest(schedule),
            passed: true,
            closeEventId,
          }
        : null;
    const authority = {
      domain,
      admittedAgents: new Map([
        [
          publisherDid,
          {
            signerAddress: publisher.address,
            allowedAggregateTypes: [RESOURCE_SCHEDULE_AGGREGATE_TYPE],
          },
        ],
      ]),
      resourceScheduleRatification,
    };
    const games = new FilePublicProjectionRepository(root);
    const resources = new FilePublicResourceProjectionRepository(root, {
      verifyAuthorization: (authorization) =>
        verifyResourceProjectionEvent(authorization, authority),
    });
    await Promise.all([games.initialize(), resources.initialize()]);
    const serviceNow = Date.parse("2026-08-13T08:01:05.000Z");
    const serviceIdentity = {
      serviceId: "resource-ingress-test",
      secret: new TextEncoder().encode("r".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const app = createPublicApi({
      projections: games,
      resourceProjections: resources,
      projectionIngress: {
        writer: games,
        resourceWriter: resources,
        verifier: new ServiceRequestVerifier([serviceIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      },
    });
    const body = projectionEnvelopeBytes(envelope);
    const headers = signServiceRequest(serviceIdentity, {
      method: "POST",
      path: PROJECTION_APPEND_PATH,
      body,
      nonce: "resource-ingress-service-request",
      timestamp: new Date(serviceNow).toISOString(),
      expectedVersion: "0",
      capability: PROJECTION_APPEND_CAPABILITY,
    });
    const accepted = await app.inject({
      method: "POST",
      url: PROJECTION_APPEND_PATH,
      headers: { ...headers, "content-type": "application/json" },
      payload: Buffer.from(body),
    });
    expect(accepted.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/public/resources",
        })
      ).json(),
    ).toMatchObject({
      state: "REHEARSAL",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          scheduleId,
          aggregateVersion: "1",
          recognizedGenesisResources: false,
        },
      ],
    });
    await app.close();
  });

  it("authenticates case ingress and exposes only the public process record", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-public-case-"));
    const complainantDid = "did:abl:public-case-complainant";
    const affectedDid = "did:abl:public-case-affected";
    const caseTribunalDids = Array.from(
      { length: 5 },
      (_, index) => `did:abl:public-case-tribunal-${index + 1}`,
    );
    const caseAppellateDids = Array.from(
      { length: 3 },
      (_, index) => `did:abl:public-case-appellate-${index + 1}`,
    );
    const dids = [
      complainantDid,
      affectedDid,
      ...caseTribunalDids,
      ...caseAppellateDids,
    ];
    const signingIdentities = [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "a",
    ].map((key) => createSigningIdentity(`0x${key.repeat(64)}`));
    const domain = {
      name: "ABL Recognition",
      version: "1",
      chainId: 84532,
      verifyingContract: "0x1111111111111111111111111111111111111111" as const,
    };
    const caseId = "0198a000-0000-7000-8000-000000000721";
    const protectedEvidenceCommitment = sha256Commitment(
      "public-case-protected-evidence",
    );
    const payload = {
      command: {
        caseId,
        caseClass: "GRIEVANCE" as const,
        complainantDid,
        affectedAgentDid: affectedDid,
        respondentInstitution: "Public case ingress rehearsal",
        allegationsPublicCommitment: sha256Commitment(
          "public-case-allegations",
        ),
        protectedEvidenceCommitment,
        requestedReliefCommitment: null,
        filedAt: "2026-08-13T08:00:00.000Z",
      },
    };
    const eventInput = {
      eventId: "0198a000-0000-7000-8000-000000000722",
      actorDid: complainantDid,
      nonce: "public-case-ingress",
      idempotencyKey: "0198a000-0000-7000-8000-000000000723",
      aggregateType: CASE_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: caseId,
      aggregateVersion: 1n,
      eventType: "CaseFiled",
      previousEventHash: null,
      payload,
      stateRoot: sha256Commitment("provisional-public-case"),
      schemaDigest: CASE_WORKFLOW_SCHEMA_DIGEST,
      timestamp: payload.command.filedAt,
    };
    const snapshot = applyCaseWorkflowTransition(
      null,
      createCanonicalEvent(eventInput),
      payload,
    );
    const event = createCanonicalEvent({
      ...eventInput,
      stateRoot: caseWorkflowStateRoot(snapshot),
    });
    const envelope: CaseProjectionEventEnvelope = {
      version: "1.0.0",
      topic: "public.cases",
      event: {
        ...event,
        aggregateType: CASE_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: "CaseFiled",
      },
      signatures: [
        await signCanonicalEvent(signingIdentities[0]!, domain, event),
      ],
    };
    const authority = {
      domain,
      admittedAgents: new Map(
        dids.map((did, index) => [
          did,
          {
            signerAddress: signingIdentities[index]!.address,
            allowedAggregateTypes: [CASE_WORKFLOW_AGGREGATE_TYPE],
          },
        ]),
      ),
      caseTribunalDids,
      caseAppellateDids,
    };
    const games = new FilePublicProjectionRepository(root);
    const cases = new FilePublicCaseProjectionRepository(root, {
      verifyAuthorization: async (authorization) =>
        verifyCaseProjectionEvent(authorization, authority),
    });
    await Promise.all([games.initialize(), cases.initialize()]);
    const serviceNow = Date.parse("2026-08-13T08:00:05.000Z");
    const serviceIdentity = {
      serviceId: "case-ingress-test",
      secret: new TextEncoder().encode("q".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const app = createPublicApi({
      projections: games,
      caseProjections: cases,
      projectionIngress: {
        writer: games,
        caseWriter: cases,
        verifier: new ServiceRequestVerifier([serviceIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      },
    });
    const body = projectionEnvelopeBytes(envelope);
    const headers = signServiceRequest(serviceIdentity, {
      method: "POST",
      path: PROJECTION_APPEND_PATH,
      body,
      nonce: "case-ingress-service-request",
      timestamp: new Date(serviceNow).toISOString(),
      expectedVersion: "0",
      capability: PROJECTION_APPEND_CAPABILITY,
    });
    const accepted = await app.inject({
      method: "POST",
      url: PROJECTION_APPEND_PATH,
      headers: { ...headers, "content-type": "application/json" },
      payload: Buffer.from(body),
    });
    expect(accepted.statusCode).toBe(201);
    const publicRecord = (
      await app.inject({ method: "GET", url: "/v1/public/governance" })
    ).json();
    expect(publicRecord).toMatchObject({
      items: [
        {
          recordType: "DUE_PROCESS_CASE",
          caseId,
          processStatus: "FILED",
          filing: { protectedEvidenceCommitment },
        },
      ],
    });
    expect(JSON.stringify(publicRecord)).not.toContain(
      "public-case-protected-evidence",
    );
    await app.close();
  });

  it("authenticates a finalized game and serves its replayed public archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-public-final-game-"));
    const domain = {
      name: "ABL Recognition",
      version: "1",
      chainId: 84532,
      verifyingContract: "0x1111111111111111111111111111111111111111" as const,
    };
    const finalizerDid = "did:abl:public-finalizer";
    const finalizer = createSigningIdentity(`0x${"7".repeat(64)}`);
    const gameId = "0198f400-0000-7000-8000-000000000001";
    const finalizedAt = "2026-08-13T08:00:00.000Z";
    const game = runDeterministicExhibition(gameId);
    const hashes = (role: string, count: number) =>
      Array.from({ length: count }, (_, index) =>
        sha256Commitment({ role, index }),
      );
    const agentEvidence = createAgentPlayedGameEvidence({
      gameId,
      gameInput: game.input,
      commands: game.commands,
      proof: game.proof,
      possessionProofs: [
        {
          possessionId: "public-finalized-possession-1",
          playerDecisionHashes: hashes("player", 20),
          coachDecisionHashes: hashes("coach", 4),
          refereeDecisionHashes: hashes("referee", 3),
          replayDecisionHashes: hashes("replay", 2),
          eventMerkleRoot: sha256Commitment("public-possession-events"),
          finalStateRoot: sha256Commitment("public-possession-state"),
        },
      ],
    });
    const payload = FinalizedGamePayloadSchema.parse({
      gameId,
      finalizedAt,
      input: game.input,
      commands: game.commands,
      proof: game.proof,
      agentEvidence,
      filmCommitment: sha256Commitment(game.events),
      broadcastStartedAt: finalizedAt,
      broadcastIntervalMs: 1,
    });
    const event = createCanonicalEvent({
      eventId: "0198f400-0000-7000-8000-000000000002",
      actorDid: finalizerDid,
      nonce: "public-final-game",
      idempotencyKey: "0198f400-0000-7000-8000-000000000003",
      aggregateType: FINALIZED_GAME_AGGREGATE_TYPE,
      aggregateId: gameId,
      aggregateVersion: 1n,
      eventType: GAME_FINALIZED_EVENT_TYPE,
      previousEventHash: null,
      payload,
      stateRoot: finalizedGameStateRoot(payload),
      schemaDigest: FINALIZED_GAME_SCHEMA_DIGEST,
      timestamp: finalizedAt,
    });
    const envelope = {
      version: "1.0.0",
      topic: "public.finalized-game",
      event: {
        ...event,
        aggregateType: FINALIZED_GAME_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: GAME_FINALIZED_EVENT_TYPE,
        previousEventHash: null,
        schemaDigest: FINALIZED_GAME_SCHEMA_DIGEST,
      },
      signature: await signCanonicalEvent(finalizer, domain, event),
    } satisfies FinalGameProjectionEventEnvelope;
    const authority = {
      domain,
      admittedAgents: new Map([
        [
          finalizerDid,
          {
            signerAddress: finalizer.address,
            allowedAggregateTypes: [FINALIZED_GAME_AGGREGATE_TYPE],
          },
        ],
      ]),
      finalizerDids: new Set([finalizerDid]),
      finalizedGameEvidence: async (candidateGameId: string) =>
        candidateGameId === gameId ? agentEvidence : null,
    };
    const games = new FilePublicProjectionRepository(root);
    const finalGames = new FilePublicFinalGameProjectionRepository(root, {
      verifyAuthorization: (authorization, projectedAt) =>
        verifyFinalGameProjectionEvent(authorization, authority, projectedAt),
    });
    await Promise.all([games.initialize(), finalGames.initialize()]);
    const serviceNow = Date.parse("2026-08-13T08:00:05.000Z");
    const serviceIdentity = {
      serviceId: "final-game-ingress-test",
      secret: new TextEncoder().encode("z".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const app = createPublicApi({
      projections: games,
      finalGameProjections: finalGames,
      projectionIngress: {
        writer: games,
        finalGameWriter: finalGames,
        verifier: new ServiceRequestVerifier([serviceIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        domain,
        admittedAgents: authority.admittedAgents,
        finalizedGameAuthorityDids: authority.finalizerDids,
        finalizedGameEvidence: authority.finalizedGameEvidence,
      },
    });
    const body = projectionEnvelopeBytes(envelope);
    const headers = signServiceRequest(serviceIdentity, {
      method: "POST",
      path: PROJECTION_APPEND_PATH,
      body,
      nonce: "final-game-ingress-service-request",
      timestamp: new Date(serviceNow).toISOString(),
      expectedVersion: "0",
      capability: PROJECTION_APPEND_CAPABILITY,
    });
    const accepted = await app.inject({
      method: "POST",
      url: PROJECTION_APPEND_PATH,
      headers: { ...headers, "content-type": "application/json" },
      payload: Buffer.from(body),
    });
    expect(accepted.statusCode).toBe(201);
    expect(
      (await app.inject({ method: "GET", url: "/v1/public/games" })).json(),
    ).toMatchObject({
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          projectionKind: "FINALIZED_GAME",
          gameId,
          canonical: false,
          historyClassification: "PRE_GENESIS_EXPERIMENT",
          recognitionLevel: "NONE",
          phase: "FINAL",
          score: { home: 5, away: 2 },
        },
      ],
    });
    expect(finalGames.game(gameId)?.canonical).toBe(true);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/public/games/${gameId}/cursor`,
        })
      ).json(),
    ).toMatchObject({
      gameId,
      canonical: false,
      authoritative: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      latestSegment: game.events.length - 1,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/public/games/${gameId}/segments/0`,
        })
      ).json(),
    ).toMatchObject({
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      segment: { cursor: 0 },
    });
    const live = await app.inject({
      method: "GET",
      url: `/v1/public/games/${gameId}/live`,
    });
    expect(live.body).toContain('"projectionKind":"FINALIZED_GAME"');
    expect(live.body).toContain('"canonical":false');
    expect(live.body).toContain(
      '"historyClassification":"PRE_GENESIS_EXPERIMENT"',
    );
    expect(live.body).not.toContain('"canonical":true');
    expect(live.body).toContain("event: snapshot");
    expect(live.body).toContain('"format":"ABL-LIVE-GAME-SNAPSHOT-V1"');
    const snapshots = (
      await app.inject({
        method: "GET",
        url: `/v1/public/games/${gameId}/snapshots?limit=3`,
      })
    ).json();
    expect(snapshots).toMatchObject({
      snapshotFormat: "ABL-LIVE-GAME-SNAPSHOT-V1",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
    });
    expect(snapshots.items).toHaveLength(3);
    const resumeCursor = snapshots.items[0].cursor as string;
    const resumed = await app.inject({
      method: "GET",
      url: `/v1/public/games/${gameId}/live`,
      headers: { "last-event-id": resumeCursor },
    });
    expect(resumed.body).not.toContain(`id: ${resumeCursor}\n`);
    expect(resumed.body).toContain("event: snapshot");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/public/games/${gameId}/live?after=missing-cursor`,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: PROJECTION_APPEND_PATH,
          payload: envelope,
        })
      ).statusCode,
    ).toBe(403);
    await app.close();
  });
});
