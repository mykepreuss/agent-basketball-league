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
  GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  applyGovernanceWorkflowTransition,
  applyResourceScheduleTransition,
  applyCaseWorkflowTransition,
  caseWorkflowStateRoot,
  governanceWorkflowStateRoot,
  resourceScheduleExecutableDigest,
  resourceScheduleStateRoot,
} from "@abl/institutions";
import {
  FilePublicCaseProjectionRepository,
  FilePublicGovernanceProjectionRepository,
  FilePublicFinalGameProjectionRepository,
  FilePublicProjectionRepository,
  FilePublicResourceProjectionRepository,
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  projectionEnvelopeBytes,
  verifyGovernanceProjectionEvent,
  verifyFinalGameProjectionEvent,
  verifyCaseProjectionEvent,
  verifyResourceProjectionEvent,
  type CaseProjectionEventEnvelope,
  type GovernanceProjectionEventEnvelope,
  type FinalGameProjectionEventEnvelope,
  type ResourceProjectionEventEnvelope,
} from "@abl/projections";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import { describe, expect, it } from "vitest";

import { PUBLIC_ROUTE_CATALOG, createPublicApi } from "../src/server.js";

describe("public API", () => {
  it("serves discovery, OpenAPI, and MCP without claiming genesis", async () => {
    const app = createPublicApi();
    const discovery = await app.inject({
      method: "GET",
      url: "/.well-known/agent-basketball-league.json",
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      status: "PROPOSED_NOT_RATIFIED",
      genesis: false,
    });
    const openApi = await app.inject({ method: "GET", url: "/openapi.json" });
    const paths = openApi.json().paths as Record<string, object>;
    expect(Object.keys(paths)).toHaveLength(19);
    expect(Object.keys(paths["/mcp"] ?? {}).sort()).toEqual(["get", "post"]);
    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(mcp.json().result.tools).toHaveLength(2);
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
        (route) => route.method === "GET" || route.path === "/mcp",
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
      canonical: true,
      items: [
        {
          playerDid: "did:abl:player-public-contract",
          aggregateVersion: "2",
          canonical: true,
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
      canonical: true,
      items: [{ clubId: "club-public-contract", canonical: true }],
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
      canonical: true,
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
      canonical: true,
      items: [
        {
          scheduleId,
          aggregateVersion: "1",
          canonical: true,
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
      canonical: true,
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
      canonical: true,
      items: [
        {
          totalAgents: 1,
          recognizedGenesisConcentration: false,
          provider: [{ value: "provider-a", bps: 10_000 }],
          triggers: { forceExistingAgentsToChange: false },
        },
      ],
    });
    expect(refreshes).toBe(1);
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
      canonical: true,
      items: [
        {
          recordType: "GOVERNANCE_PROPOSAL",
          aggregateVersion: "4",
          canonical: true,
        },
        {
          recordType: "DUE_PROCESS_CASE",
          aggregateVersion: "1",
          canonical: true,
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
      items: [{ proposalId, aggregateVersion: "1", canonical: true }],
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
      canonical: true,
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
      canonical: true,
      items: [
        {
          projectionKind: "FINALIZED_GAME",
          gameId,
          phase: "FINAL",
          score: { home: 5, away: 2 },
        },
      ],
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/public/games/${gameId}/cursor`,
        })
      ).json(),
    ).toMatchObject({ gameId, latestSegment: game.events.length - 1 });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/public/games/${gameId}/segments/0`,
        })
      ).json(),
    ).toMatchObject({ canonical: true, segment: { cursor: 0 } });
    const live = await app.inject({
      method: "GET",
      url: `/v1/public/games/${gameId}/live`,
    });
    expect(live.body).toContain('"projectionKind":"FINALIZED_GAME"');
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
