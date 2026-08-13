import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServiceRequestVerifier, signServiceRequest } from "@abl/foundation";
import {
  GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  applyGovernanceWorkflowTransition,
  governanceWorkflowStateRoot,
} from "@abl/institutions";
import {
  FilePublicGovernanceProjectionRepository,
  FilePublicProjectionRepository,
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  projectionEnvelopeBytes,
  verifyGovernanceProjectionEvent,
  type GovernanceProjectionEventEnvelope,
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
    expect(Object.keys(paths)).toHaveLength(18);
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
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/governance",
    });
    expect(response.json()).toMatchObject({
      state: "REHEARSAL",
      canonical: true,
      items: [{ aggregateVersion: "4", canonical: true }],
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
});
