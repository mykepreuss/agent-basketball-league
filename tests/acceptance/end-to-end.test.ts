import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadPossessionProof } from "../../apps/arena/app/data.js";
import {
  CORE_ROUTE_CATALOG,
  createCoreApi,
  createLiveCoreApi,
} from "../../apps/core-api/src/server.js";
import {
  PUBLIC_ROUTE_CATALOG,
  createPublicApi,
} from "../../apps/public-api/src/server.js";
import { runLocalCapacityProof } from "../../packages/assurance/src/index.js";
import {
  REHEARSAL_RECOGNITION_DOMAIN,
  runFirstPossessionRehearsal,
} from "../../packages/basketball/src/index.js";
import { InMemoryCanonicalStore } from "../../packages/database/src/index.js";
import {
  ServiceRequestVerifier,
  signServiceRequest,
} from "../../packages/foundation/src/index.js";
import { constitutionalInvariants } from "../../packages/policy/src/index.js";
import {
  FilePublicProjectionRepository,
  HttpProjectionEventSink,
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  PublicProjectionWorker,
  projectionEnvelopeBytes,
  projectionEnvelopeFromOutbox,
  verifyProjectionEvent,
  type ProjectionEventEnvelope,
  type PublicGameProjectionSource,
} from "../../packages/projections/src/index.js";
import {
  createCanonicalEvent,
  createCheckpointManifest,
  createSigningIdentity,
  checkpointManifestDigest,
  InstitutionalKeyRegistry,
  PublicVerifier,
  sha256Commitment,
  signCanonicalEvent,
  verifyCheckpointClaim,
} from "../../packages/recognition/src/index.js";
import { runPrivateRehearsal } from "../../packages/rehearsal/src/index.js";
import {
  exportJsonSchemas,
  schemaRegistry,
} from "../../packages/schemas/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("complete local acceptance", () => {
  it("carries a signed agent possession through command persistence, projections, public streaming, and arena data", async () => {
    const rehearsal = await runFirstPossessionRehearsal();
    const { result } = rehearsal;
    const finalSegmentHash = result.segments.at(-1)?.segmentHash;
    if (finalSegmentHash === undefined)
      throw new Error("Possession did not produce a public segment");
    const source: PublicGameProjectionSource = {
      gameId: result.finalState.gameId,
      possessionId: result.finalState.possessionId,
      score: result.finalState.score,
      gameClockMs: result.finalState.gameClockMs,
      shotClockMs: result.finalState.shotClockMs,
      players: result.finalState.players.map(
        ({ playerId, team, position, xCm, yCm }) => ({
          playerId,
          team,
          position,
          xCm,
          yCm,
        }),
      ),
      events: result.events.map((event) => ({
        sequence: event.sequence,
        type: event.type,
        label: `${event.type.toLowerCase().replaceAll("_", " ")} resolved`,
        stateRoot: event.stateRoot,
        eventHash: event.eventHash,
      })),
      segments: result.segments,
      finalStateRoot: result.finalStateRoot,
      eventMerkleRoot: result.eventMerkleRoot,
      filmCommitment: result.filmCommitment,
      finalSegmentHash,
    };
    const submittingBody = rehearsal.bodies.get("H1")!;
    const event = createCanonicalEvent({
      eventId: "0198a000-0000-7000-8000-000000000301",
      actorDid: submittingBody.did,
      nonce: "possession-resolution-1",
      idempotencyKey: "0198a000-0000-7000-8000-000000000302",
      aggregateType: "game-possession",
      aggregateId: result.finalState.gameId,
      aggregateVersion: 1n,
      eventType: "PossessionResolved",
      previousEventHash: null,
      payload: { source, decisionProof: rehearsal.decisionProof },
      stateRoot: result.finalStateRoot,
      schemaDigest: sha256Commitment("PossessionResolved:1.0.0"),
      timestamp: "2026-08-13T10:05:00.000Z",
    });
    const signature = await signCanonicalEvent(
      submittingBody.signingIdentity,
      REHEARSAL_RECOGNITION_DOMAIN,
      event,
    );
    const verification = await new PublicVerifier().verifyAndApply({
      event,
      signatures: [signature],
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      registry: new InstitutionalKeyRegistry([
        {
          address: submittingBody.signingIdentity.address,
          did: submittingBody.did,
          role: "CAREER_AGENT",
          validFrom: "2026-08-01T00:00:00.000Z",
          validUntil: null,
          revokedAt: null,
          purpose: "SIGNING",
        },
      ]),
      threshold: {
        policyId: "LOCAL_REHEARSAL_PLAYER_COMMAND",
        groups: [{ role: "CAREER_AGENT", required: 1 }],
      },
      now: event.timestamp,
    });
    expect(verification.label).toBe("CANONICAL");
    const checkpoint = createCheckpointManifest({
      manifestId: "0198a000-0000-7000-8000-000000000303",
      checkpointType: "GAME",
      subjectId: result.finalState.gameId,
      eventHashes: [event.eventHash],
      institutionalKeyRegistryDigest: sha256Commitment({
        did: submittingBody.did,
        address: submittingBody.signingIdentity.address,
      }),
      verifierDigest: sha256Commitment("public-verifier-v1"),
      previousManifestDigest: null,
      createdAt: event.timestamp,
    });
    expect(
      verifyCheckpointClaim({
        manifest: checkpoint,
        manifestDigest: checkpointManifestDigest(checkpoint),
        claimedRoot: checkpoint.merkleRoot,
        transactionHash: sha256Commitment("local-evm-transaction"),
        blockNumber: 1n,
        confirmations: 12,
        requiredConfirmations: 12,
      }).label,
    ).toBe("CANONICAL");
    const store = new InMemoryCanonicalStore();
    const coreApi = createLiveCoreApi({
      store,
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents: new Map([
        [
          submittingBody.did,
          {
            signerAddress: submittingBody.signingIdentity.address,
            allowedAggregateTypes: ["game-possession"],
          },
        ],
      ]),
      competitionId: "season-zero-rehearsal",
      seasonId: "season-zero",
      now: () => Date.parse("2026-08-13T10:05:00.000Z"),
    });
    const command = {
      event: { ...event, aggregateVersion: event.aggregateVersion.toString() },
      signatures: [signature],
    };
    const accepted = await coreApi.inject({
      method: "POST",
      url: "/v1/commands",
      payload: command,
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      accepted: true,
      canonical: true,
      aggregateVersion: "1",
    });
    const rogue = createSigningIdentity(`0x${"9".repeat(64)}`);
    const rogueSignature = await signCanonicalEvent(
      rogue,
      REHEARSAL_RECOGNITION_DOMAIN,
      event,
    );
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: { ...command, signatures: [rogueSignature] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: { event: command.event, signatures: [] },
        })
      ).statusCode,
    ).toBe(400);
    const malformedEvent = createCanonicalEvent({
      eventId: "0198a000-0000-7000-8000-000000000304",
      actorDid: submittingBody.did,
      nonce: "possession-resolution-2",
      idempotencyKey: "0198a000-0000-7000-8000-000000000305",
      aggregateType: "game-possession",
      aggregateId: result.finalState.gameId,
      aggregateVersion: 2n,
      eventType: "PossessionResolved",
      previousEventHash: event.eventHash,
      payload: {
        source: { ...source, score: { home: -1, away: 0 } },
        decisionProof: rehearsal.decisionProof,
      },
      stateRoot: result.finalStateRoot,
      schemaDigest: sha256Commitment("PossessionResolved:1.0.0"),
      timestamp: "2026-08-13T10:05:00.000Z",
    });
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            event: {
              ...malformedEvent,
              aggregateVersion: malformedEvent.aggregateVersion.toString(),
            },
            signatures: [
              await signCanonicalEvent(
                submittingBody.signingIdentity,
                REHEARSAL_RECOGNITION_DOMAIN,
                malformedEvent,
              ),
            ],
          },
        })
      ).statusCode,
    ).toBe(400);
    const privateFieldEvent = createCanonicalEvent({
      eventId: "0198a000-0000-7000-8000-000000000308",
      actorDid: submittingBody.did,
      nonce: "possession-resolution-private-field",
      idempotencyKey: "0198a000-0000-7000-8000-000000000309",
      aggregateType: "game-possession",
      aggregateId: result.finalState.gameId,
      aggregateVersion: 2n,
      eventType: "PossessionResolved",
      previousEventHash: event.eventHash,
      payload: {
        source: { ...source, privateMemory: "must-never-project" },
        decisionProof: rehearsal.decisionProof,
      },
      stateRoot: result.finalStateRoot,
      schemaDigest: sha256Commitment("PossessionResolved:1.0.0"),
      timestamp: "2026-08-13T10:05:00.000Z",
    });
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            event: {
              ...privateFieldEvent,
              aggregateVersion: privateFieldEvent.aggregateVersion.toString(),
            },
            signatures: [
              await signCanonicalEvent(
                submittingBody.signingIdentity,
                REHEARSAL_RECOGNITION_DOMAIN,
                privateFieldEvent,
              ),
            ],
          },
        })
      ).statusCode,
    ).toBe(400);

    const directWriteStore = new InMemoryCanonicalStore();
    await directWriteStore.append({
      ...store.events[0]!,
      signatures: [rogueSignature],
    });
    const rejectedProjectionRoot = await mkdtemp(
      join(tmpdir(), "abl-rejected-projections-"),
    );
    const rejectedProjections = new FilePublicProjectionRepository(
      rejectedProjectionRoot,
    );
    await rejectedProjections.initialize();
    const unauthorizedWorker = new PublicProjectionWorker({
      store: directWriteStore,
      writer: rejectedProjections,
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents: new Map([
        [
          submittingBody.did,
          {
            signerAddress: submittingBody.signingIdentity.address,
            allowedAggregateTypes: ["game-possession"],
          },
        ],
      ]),
    });
    await expect(unauthorizedWorker.drain()).rejects.toThrow("not registered");
    expect(rejectedProjections.games()).toEqual([]);

    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-vertical-projections-"),
    );
    const serviceNow = Date.parse("2026-08-13T10:05:01.000Z");
    const projectionIdentity = {
      serviceId: "core-projection-publisher",
      secret: new TextEncoder().encode("p".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const projectionAuthority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents: new Map([
        [
          submittingBody.did,
          {
            signerAddress: submittingBody.signingIdentity.address,
            allowedAggregateTypes: ["game-possession"],
          },
        ],
      ]),
    };
    const projectionRepositoryOptions = {
      verifyAuthorization: async (
        authorization: ProjectionEventEnvelope,
        projectedAt: string,
      ) =>
        (
          await verifyProjectionEvent(
            authorization,
            projectionAuthority,
            () => new Date(projectedAt),
          )
        ).projection,
    };
    const publicProjections = new FilePublicProjectionRepository(
      projectionRoot,
      projectionRepositoryOptions,
    );
    await publicProjections.initialize();
    const publicApi = createPublicApi({
      projections: publicProjections,
      projectionIngress: {
        writer: publicProjections,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...projectionAuthority,
      },
    });
    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const pending = await store.pendingProjectionEvents();
      const outboxEvent = pending[0];
      if (outboxEvent === undefined)
        throw new Error("Canonical command did not create an outbox event");
      const envelope = projectionEnvelopeFromOutbox(outboxEvent);
      const signedRequest = (
        body: ProjectionEventEnvelope,
        nonce: string,
        expectedVersion = "0",
      ) => {
        const bytes = projectionEnvelopeBytes(body);
        return {
          bytes,
          headers: signServiceRequest(projectionIdentity, {
            method: "POST",
            path: PROJECTION_APPEND_PATH,
            body: bytes,
            nonce,
            timestamp: new Date(serviceNow).toISOString(),
            expectedVersion,
            capability: PROJECTION_APPEND_CAPABILITY,
          }),
        };
      };

      expect(
        (
          await publicApi.inject({
            method: "POST",
            url: PROJECTION_APPEND_PATH,
            payload: Buffer.from(projectionEnvelopeBytes(envelope)),
            headers: { "content-type": "application/json" },
          })
        ).statusCode,
      ).toBe(403);

      const tamperedEnvelope: ProjectionEventEnvelope = {
        ...envelope,
        event: {
          ...envelope.event,
          stateRoot: `0x${"f".repeat(64)}`,
        },
      };
      const tampered = signedRequest(
        tamperedEnvelope,
        "tampered-projection-request",
      );
      expect(
        (
          await publicApi.inject({
            method: "POST",
            url: PROJECTION_APPEND_PATH,
            payload: Buffer.from(tampered.bytes),
            headers: {
              ...tampered.headers,
              "content-type": "application/json",
            },
          })
        ).statusCode,
      ).toBe(403);

      const firstDelivery = signedRequest(envelope, "first-projection-request");
      const acceptedProjection = await publicApi.inject({
        method: "POST",
        url: PROJECTION_APPEND_PATH,
        payload: Buffer.from(firstDelivery.bytes),
        headers: {
          ...firstDelivery.headers,
          "content-type": "application/json",
        },
      });
      expect(acceptedProjection.statusCode).toBe(201);
      expect(
        (
          await publicApi.inject({
            method: "POST",
            url: PROJECTION_APPEND_PATH,
            payload: Buffer.from(firstDelivery.bytes),
            headers: {
              ...firstDelivery.headers,
              "content-type": "application/json",
            },
          })
        ).statusCode,
      ).toBe(409);

      const skippedEvent = createCanonicalEvent({
        ...event,
        eventId: "0198a000-0000-7000-8000-000000000306",
        nonce: "possession-resolution-skipped-version",
        idempotencyKey: "0198a000-0000-7000-8000-000000000307",
        aggregateVersion: 3n,
        previousEventHash: event.eventHash,
      });
      const skippedEnvelope: ProjectionEventEnvelope = {
        version: "1.0.0",
        topic: "public.game",
        event: {
          ...skippedEvent,
          aggregateVersion: skippedEvent.aggregateVersion.toString(),
        },
        signature: await signCanonicalEvent(
          submittingBody.signingIdentity,
          REHEARSAL_RECOGNITION_DOMAIN,
          skippedEvent,
        ),
      };
      const skipped = signedRequest(
        skippedEnvelope,
        "skipped-projection-request",
        "2",
      );
      expect(
        (
          await publicApi.inject({
            method: "POST",
            url: PROJECTION_APPEND_PATH,
            payload: Buffer.from(skipped.bytes),
            headers: {
              ...skipped.headers,
              "content-type": "application/json",
            },
          })
        ).statusCode,
      ).toBe(409);

      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => "worker-idempotent-retry",
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        ...projectionAuthority,
      });
      expect(await worker.drain()).toBe(1);
      expect(await worker.drain()).toBe(0);
      const publicEvents = await publicApi.inject({
        method: "GET",
        url: "/v1/public/events",
      });
      expect(publicEvents.json()).toMatchObject({
        items: [
          {
            authorization: {
              event: { eventHash: event.eventHash },
              signature,
            },
          },
        ],
      });
      const arenaProjection = await loadPossessionProof(publicAddress);
      expect(arenaProjection).toMatchObject({
        gameId: result.finalState.gameId,
        canonical: true,
        score: result.finalState.score,
        finalStateRoot: result.finalStateRoot,
        eventMerkleRoot: result.eventMerkleRoot,
      });
      const stream = await publicApi.inject({
        method: "GET",
        url: `/v1/public/games/${result.finalState.gameId}/live`,
      });
      expect(stream.body).toContain(result.finalStateRoot);
      expect(stream.body).toContain('"canonical":true');
    } finally {
      await Promise.all([publicApi.close(), coreApi.close()]);
    }
    const restarted = new FilePublicProjectionRepository(
      projectionRoot,
      projectionRepositoryOptions,
    );
    await restarted.initialize();
    expect(restarted.game(result.finalState.gameId)?.finalStateRoot).toBe(
      result.finalStateRoot,
    );

    const recordPath = join(projectionRoot, "records", "000000000000.json");
    const forgedRecord = JSON.parse(await readFile(recordPath, "utf8")) as {
      authorization: ProjectionEventEnvelope;
      recordHash: `0x${string}`;
      [key: string]: unknown;
    };
    forgedRecord.authorization.signature = `0x${"c".repeat(130)}`;
    const { recordHash: _recordHash, ...forgedContent } = forgedRecord;
    forgedRecord.recordHash = sha256Commitment(forgedContent);
    await writeFile(recordPath, `${JSON.stringify(forgedRecord)}\n`, "utf8");
    const compromised = new FilePublicProjectionRepository(
      projectionRoot,
      projectionRepositoryOptions,
    );
    await expect(compromised.initialize()).rejects.toThrow(
      "authorization is invalid",
    );
  });

  it("replays both accelerated seasons and every cross-domain rehearsal scenario exactly", async () => {
    const report = await runPrivateRehearsal();
    expect(report.passed).toBe(true);
    expect(report.premier).toMatchObject({
      gameCount: 36,
      replayExactCount: 36,
      inferenceInvocations: 0,
      seasonRoot:
        "0x865030ef4bbd028ee908823c6f611747c1f71f08e0c6cf5d5d1b91ca6454c16c",
    });
    expect(report.development).toMatchObject({
      gameCount: 36,
      replayExactCount: 36,
      inferenceInvocations: 0,
      seasonRoot:
        "0x4c140c709f94f119d834b6ff59c302c09dbcc05831b4b0b3f744fa8a8eacbf69",
    });
    expect(report.events).toHaveLength(16);
    expect(report.events.every((event) => event.outcome === "PASS")).toBe(true);
    expect(report.eventRoot).toBe(
      "0x87b2da9edf0f2b46646d778c7d94447c9aae88af3e809f960242981e558b4f44",
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
