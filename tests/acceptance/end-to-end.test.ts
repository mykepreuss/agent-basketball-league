import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  loadGameProof,
  loadPossessionProof,
} from "../../apps/arena/app/data.js";
import { CANDIDATE_EDGE_ROUTE_CATALOG } from "../../apps/candidate-edge/src/server.js";
import { CANDIDATE_PROVISIONER_ROUTE_CATALOG } from "../../apps/candidate-provisioner/src/server.js";
import {
  CORE_ROUTE_CATALOG,
  createCoreApi,
  createLiveCoreApi,
} from "../../apps/core-api/src/server.js";
import {
  PUBLIC_ROUTE_CATALOG,
  createPublicApi,
} from "../../apps/public-api/src/server.js";
import { SAFETY_ROUTE_CATALOG } from "../../apps/safety-gateway/src/server.js";
import { runLocalCapacityProof } from "../../packages/assurance/src/index.js";
import {
  FINALIZED_GAME_AGGREGATE_TYPE,
  FINALIZED_GAME_SCHEMA_DIGEST,
  GAME_FINALIZED_EVENT_TYPE,
  FinalizedGamePayloadSchema,
  REHEARSAL_RECOGNITION_DOMAIN,
  createFinalizedGameScheduleEvidence,
  finalizedGameStateRoot,
  runAgentPlayedExhibition,
  runFirstPossessionRehearsal,
} from "../../packages/basketball/src/index.js";
import { CANDIDATE_WORKFLOW_SCHEMA_DIGEST } from "../../packages/career/src/index.js";
import { InMemoryCanonicalStore } from "../../packages/database/src/index.js";
import {
  ServiceRequestVerifier,
  signServiceRequest,
} from "../../packages/foundation/src/index.js";
import {
  CONTRACT_WORKFLOW_AGGREGATE_TYPE,
  CONTRACT_WORKFLOW_SCHEMA_DIGEST,
  DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
  DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
  ECONOMY_WORKFLOW_AGGREGATE_TYPE,
  ECONOMY_WORKFLOW_SCHEMA_DIGEST,
  DISCLOSURE_AGGREGATE_TYPE,
  DISCLOSURE_SUBMITTED_EVENT_TYPE,
  DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
  GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  PREMIER_DRAFT_AGGREGATE_TYPE,
  PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
  PREMIER_DRAFT_SCHEMA_DIGEST,
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  RELEASE_WORKFLOW_AGGREGATE_TYPE,
  RELEASE_WORKFLOW_SCHEMA_DIGEST,
  SEASON_ZERO_MOBILITY_POLICY,
  applyContractWorkflowTransition,
  applyDevelopmentWorkflowTransition,
  applyEconomyWorkflowTransition,
  applyDisclosureWorkflowTransition,
  applyGovernanceWorkflowTransition,
  applyResourceScheduleTransition,
  applyReleaseWorkflowTransition,
  contractClubAuthoritySnapshotDigest,
  contractOfferCommitment,
  contractWorkflowStateRoot,
  conductEightRoundDraft,
  createDevelopmentFormationEvidence,
  createEconomyCapCertification,
  disclosureWorkflowStateRoot,
  developmentTierCbaExecutableDigest,
  developmentWorkflowStateRoot,
  economyTransactionTermsCommitment,
  economyWorkflowStateRoot,
  evaluateGovernanceWorkflowDecision,
  expectedDevelopmentSignerDids,
  governanceVoteFromAuthorization,
  governanceWorkflowStateRoot,
  premierDraftStateRoot,
  resourceScheduleExecutableDigest,
  resourceScheduleStateRoot,
  releaseManifestCommitment,
  releaseVerifierResultDigest,
  releaseWorkflowStateRoot,
  tradeAccessEvidenceCommitment,
  type GovernanceDecision,
  type GovernanceWorkflowEventType,
  type GovernanceWorkflowPayload,
  type GovernanceWorkflowSnapshot,
  type GovernanceVote,
  type DevelopmentCharterCommand,
  type PremierDraftCompletedPayload,
  type PremierDraftEvidence,
  type ResourceSchedule,
  type ReleaseInstitutionalRoster,
  type ReleaseManifestBody,
  type ReleaseVerifierResult,
  type ReleaseWorkflowEventType,
  type ReleaseWorkflowPayload,
  type ReleaseWorkflowSnapshot,
  type TradeAccessEvidence,
} from "../../packages/institutions/src/index.js";
import { constitutionalInvariants } from "../../packages/policy/src/index.js";
import {
  FilePublicContractProjectionRepository,
  FilePublicDraftProjectionRepository,
  FilePublicDevelopmentProjectionRepository,
  FilePublicEconomyProjectionRepository,
  FilePublicFinalGameProjectionRepository,
  FilePublicGovernanceProjectionRepository,
  FilePublicModelProjectionRepository,
  FilePublicProjectionRepository,
  FilePublicResourceProjectionRepository,
  FilePublicReleaseProjectionRepository,
  FilePublicSocialProjectionRepository,
  HttpProjectionEventSink,
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  PublicProjectionWorker,
  projectionEnvelopeBytes,
  projectionEnvelopeFromOutbox,
  verifyContractProjectionEvent,
  verifyDraftProjectionEvent,
  verifyDevelopmentProjectionEvent,
  verifyEconomyProjectionEvent,
  verifyFinalGameProjectionEvent,
  verifyGovernanceProjectionEvent,
  verifyModelProjectionEvent,
  verifyProjectionEvent,
  verifyResourceProjectionEvent,
  verifyReleaseProjectionEvent,
  verifySocialProjectionEvent,
  type ContractProjectionEventEnvelope,
  type DevelopmentProjectionEventEnvelope,
  type EconomyProjectionEventEnvelope,
  type ModelProjectionEventEnvelope,
  type ProjectionEventEnvelope,
  type PublicGameProjectionSource,
  type PublicCaseProjectionReader,
  type SocialProjectionEventEnvelope,
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
  type CanonicalEvent,
  type SigningIdentity,
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
        claim: {
          checkpointType: checkpoint.checkpointType,
          subjectId: checkpoint.subjectId,
          root: checkpoint.merkleRoot,
          previousRoot: sha256Commitment("previous-game-root"),
          nonce: checkpointManifestDigest(checkpoint),
          validAfter: 1_765_707_899n,
          validBefore: 1_765_711_500n,
          chainId: 84532,
          contractAddress: REHEARSAL_RECOGNITION_DOMAIN.verifyingContract!,
          transactionHash: null,
          blockNumber: null,
          signatures: [],
        },
        observation: null,
        anchor: {
          state: "PRE_GENESIS_UNRATIFIED",
          chainId: 84532,
          contractAddress: null,
          deployedRuntimeBytecodeKeccak256: null,
          releaseManifestDigest: null,
          deploymentTransactionHash: null,
          deploymentBlockNumber: null,
          finalizedAt: null,
          requiredConfirmations: 12,
        },
      }).label,
    ).toBe("UNVERIFIABLE");
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
    const staleEvent = createCanonicalEvent({
      eventId: "0198a000-0000-7000-8000-000000000306",
      actorDid: submittingBody.did,
      nonce: "possession-resolution-stale",
      idempotencyKey: "0198a000-0000-7000-8000-000000000307",
      aggregateType: "game-possession",
      aggregateId: result.finalState.gameId,
      aggregateVersion: 2n,
      eventType: "PossessionResolved",
      previousEventHash: event.eventHash,
      payload: { source, decisionProof: rehearsal.decisionProof },
      stateRoot: result.finalStateRoot,
      schemaDigest: sha256Commitment("PossessionResolved:1.0.0"),
      timestamp: "2026-08-13T10:03:59.000Z",
    });
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            event: {
              ...staleEvent,
              aggregateVersion: staleEvent.aggregateVersion.toString(),
            },
            signatures: [
              await signCanonicalEvent(
                submittingBody.signingIdentity,
                REHEARSAL_RECOGNITION_DOMAIN,
                staleEvent,
              ),
            ],
          },
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
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        score: result.finalState.score,
        finalStateRoot: result.finalStateRoot,
        eventMerkleRoot: result.eventMerkleRoot,
      });
      const stream = await publicApi.inject({
        method: "GET",
        url: `/v1/public/games/${result.finalState.gameId}/live`,
      });
      expect(stream.body).toContain(result.finalStateRoot);
      expect(stream.body).toContain('"canonical":false');
      expect(stream.body).toContain(
        '"historyClassification":"PRE_GENESIS_EXPERIMENT"',
      );
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

  it("carries a complete agent-played game into independently replayed public history", async () => {
    const gameId = "0198f500-0000-7000-8000-000000000001";
    const finalizedAt = "2026-08-13T10:15:00.000Z";
    const exhibition = await runAgentPlayedExhibition(gameId);
    const scheduleEvidence = createFinalizedGameScheduleEvidence({
      gameId,
      competitionId: "abl-rehearsal",
      seasonId: "season-zero",
      tier: "PREMIER",
      scheduleId: "abl-rehearsal:season-zero:premier",
      scheduleVersion: 1,
      clubIds: ["club-a", "club-b", "club-c", "club-d"],
      homeClubId: "club-a",
      awayClubId: "club-b",
      scheduledAt: "2026-08-13T10:00:00.000Z",
      scheduleEventHash: sha256Commitment("acceptance-schedule-event"),
      scheduleStateRoot: sha256Commitment("acceptance-schedule-state"),
    });
    const payload = FinalizedGamePayloadSchema.parse({
      gameId,
      finalizedAt,
      competition: scheduleEvidence,
      input: exhibition.input,
      commands: exhibition.commands,
      proof: exhibition.proof,
      agentEvidence: exhibition.agentEvidence,
      filmCommitment: sha256Commitment(exhibition.events),
      broadcastStartedAt: finalizedAt,
      broadcastIntervalMs: 1,
    });
    const finalizerDid = "did:abl:acceptance-game-finalizer";
    const finalizer = createSigningIdentity(`0x${"6".repeat(64)}`);
    const event = createCanonicalEvent({
      eventId: "0198f500-0000-7000-8000-000000000002",
      actorDid: finalizerDid,
      nonce: "final-agent-game-1",
      idempotencyKey: "0198f500-0000-7000-8000-000000000003",
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
    const signature = await signCanonicalEvent(
      finalizer,
      REHEARSAL_RECOGNITION_DOMAIN,
      event,
    );
    const authority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
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
        candidateGameId === gameId
          ? structuredClone(exhibition.agentEvidence)
          : null,
      scheduleEvidence: {
        finalizedGameScheduleEvidence: async (candidateGameId: string) =>
          candidateGameId === gameId ? structuredClone(scheduleEvidence) : null,
      },
    };
    expect(
      (
        await new PublicVerifier().verifyAndApply({
          event,
          signatures: [signature],
          domain: REHEARSAL_RECOGNITION_DOMAIN,
          registry: new InstitutionalKeyRegistry([
            {
              address: finalizer.address,
              did: finalizerDid,
              role: "GAME_FINALIZER",
              validFrom: "2026-08-01T00:00:00.000Z",
              validUntil: null,
              revokedAt: null,
              purpose: "SIGNING",
            },
          ]),
          threshold: {
            policyId: "LOCAL_REHEARSAL_FINALIZED_GAME",
            groups: [{ role: "GAME_FINALIZER", required: 1 }],
          },
          now: finalizedAt,
        })
      ).label,
    ).toBe("CANONICAL");

    const store = new InMemoryCanonicalStore();
    const coreApi = createLiveCoreApi({
      store,
      domain: authority.domain,
      admittedAgents: authority.admittedAgents,
      competitionId: "season-zero-rehearsal",
      seasonId: "season-zero",
      now: () => Date.parse(finalizedAt),
      finalizedGames: {
        finalizerDids: authority.finalizerDids,
        evidence: {
          finalizedGameEvidence: authority.finalizedGameEvidence,
        },
        scheduleEvidence: authority.scheduleEvidence,
      },
    });
    const command = {
      event: { ...event, aggregateVersion: "1" },
      signatures: [signature],
    };
    const unregisteredScheduleApi = createLiveCoreApi({
      store: new InMemoryCanonicalStore(),
      domain: authority.domain,
      admittedAgents: authority.admittedAgents,
      competitionId: "season-zero-rehearsal",
      seasonId: "season-zero",
      now: () => Date.parse(finalizedAt),
      finalizedGames: {
        finalizerDids: authority.finalizerDids,
        evidence: {
          finalizedGameEvidence: authority.finalizedGameEvidence,
        },
      },
    });
    const unregisteredScheduleResponse = await unregisteredScheduleApi.inject({
      method: "POST",
      url: "/v1/commands",
      payload: command,
    });
    expect(unregisteredScheduleResponse.statusCode).toBe(400);
    expect(unregisteredScheduleResponse.json()).toEqual({
      error: "invalid_command",
    });
    await unregisteredScheduleApi.close();
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: command,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: { ...command, signatures: [] },
        })
      ).statusCode,
    ).toBe(400);
    const rogue = createSigningIdentity(`0x${"5".repeat(64)}`);
    expect(
      (
        await coreApi.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            ...command,
            signatures: [
              await signCanonicalEvent(
                rogue,
                REHEARSAL_RECOGNITION_DOMAIN,
                event,
              ),
            ],
          },
        })
      ).statusCode,
    ).toBe(403);

    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-final-game-acceptance-"),
    );
    const possessionGames = new FilePublicProjectionRepository(projectionRoot);
    const finalGames = new FilePublicFinalGameProjectionRepository(
      projectionRoot,
      {
        verifyAuthorization: (authorization, projectedAt) =>
          verifyFinalGameProjectionEvent(authorization, authority, projectedAt),
      },
    );
    await Promise.all([possessionGames.initialize(), finalGames.initialize()]);
    const serviceNow = Date.parse("2026-08-13T10:15:01.000Z");
    const projectionIdentity = {
      serviceId: "final-game-projection-publisher",
      secret: new TextEncoder().encode("f".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const publicApi = createPublicApi({
      operatingProfile: "PRE_GENESIS_REHEARSAL",
      projections: possessionGames,
      finalGameProjections: finalGames,
      projectionIngress: {
        writer: possessionGames,
        finalGameWriter: finalGames,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        domain: authority.domain,
        admittedAgents: authority.admittedAgents,
        finalizedGameAuthorityDids: authority.finalizerDids,
        finalizedGameEvidence: authority.finalizedGameEvidence,
        finalizedGameScheduleEvidence: authority.scheduleEvidence,
      },
    });
    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => "final-game-worker-request",
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        domain: authority.domain,
        admittedAgents: authority.admittedAgents,
        finalizedGameAuthorityDids: authority.finalizerDids,
        finalizedGameEvidence: authority.finalizedGameEvidence,
        finalizedGameScheduleEvidence: authority.scheduleEvidence,
      });
      expect(await worker.drain()).toBe(1);
      expect(await worker.drain()).toBe(0);
      const arenaGame = await loadGameProof(publicAddress);
      expect(arenaGame).toMatchObject({
        projectionKind: "FINALIZED_GAME",
        gameId,
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        phase: "FINAL",
        score: exhibition.finalState.score,
        winner: exhibition.finalState.winner,
        possessionCount: exhibition.possessionProofs.length,
        replayInferenceInvocations: 0,
      });
      expect(
        (
          await publicApi.inject({
            method: "GET",
            url: `/v1/public/games/${gameId}/cursor`,
          })
        ).json(),
      ).toMatchObject({
        authoritative: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        latestSegment: exhibition.events.length - 1,
      });
      const stream = await publicApi.inject({
        method: "GET",
        url: `/v1/public/games/${gameId}/live`,
      });
      expect(stream.body).toContain('"projectionKind":"FINALIZED_GAME"');
      expect(stream.body).toContain(event.eventHash);
      const standingsResponse = (
        await publicApi.inject({
          method: "GET",
          url: "/v1/public/standings",
        })
      ).json();
      expect(standingsResponse).toMatchObject({
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: [
          {
            recordType: "SEASON_STANDINGS",
            competitionId: "abl-rehearsal",
            seasonId: "season-zero",
            tier: "PREMIER",
            completedGameCount: 1,
          },
        ],
      });
      expect(standingsResponse.items[0].standings).toHaveLength(4);
      expect(standingsResponse.items[0].standings[0]).toMatchObject({
        rank: 1,
        clubId: exhibition.finalState.winner === "HOME" ? "club-a" : "club-b",
        gamesPlayed: 1,
        wins: 1,
      });
    } finally {
      await Promise.all([publicApi.close(), coreApi.close()]);
    }

    const restarted = new FilePublicFinalGameProjectionRepository(
      projectionRoot,
      {
        verifyAuthorization: (authorization, projectedAt) =>
          verifyFinalGameProjectionEvent(authorization, authority, projectedAt),
      },
    );
    await restarted.initialize();
    expect(restarted.game(gameId)).toMatchObject({
      canonicalEventHash: event.eventHash,
      agentEvidence: exhibition.agentEvidence,
      replayInferenceInvocations: 0,
    });
    expect(restarted.standings()).toMatchObject([
      {
        completedGameCount: 1,
        sourceGames: [
          {
            gameId,
            canonicalEventHash: event.eventHash,
            scheduleEvidenceCommitment: scheduleEvidence.evidenceCommitment,
          },
        ],
      },
    ]);
  });

  it("publishes agent-signed model dependencies through authenticated durable concentration", async () => {
    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-model-acceptance-"),
    );
    const agentDid = "did:abl:model-acceptance-agent";
    const agent = createSigningIdentity(`0x${"d".repeat(64)}`);
    const authority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents: new Map(),
    };
    const store = new InMemoryCanonicalStore();
    let previousEventHash: `0x${string}` | null = null;
    for (let version = 1; version <= 9; version += 1) {
      const eventHash = sha256Commitment(`model-acceptance-private-${version}`);
      await store.append({
        eventId: `0198e000-0000-7000-8000-${String(version).padStart(12, "0")}`,
        actorDid: agentDid,
        nonce: `model-private-${version}`,
        idempotencyKey: `0198e000-0000-7000-8001-${String(version).padStart(12, "0")}`,
        requestHash: sha256Commitment(`model-private-request-${version}`),
        aggregateType: "candidate-admission",
        aggregateId: agentDid,
        expectedVersion: BigInt(version - 1),
        competitionId: "model-acceptance",
        seasonId: "pre-genesis",
        eventType: "CandidateProgressRecorded",
        previousEventHash,
        eventHash,
        payloadSchemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
        payloadCommitment: sha256Commitment(`model-private-payload-${version}`),
        payload: { private: true, version },
        stateRoot: sha256Commitment(`model-private-state-${version}`),
        signatures: [],
        occurredAt: new Date(
          `2026-08-13T11:${String(50 + version).padStart(2, "0")}:00.000Z`,
        ),
        outboxTopic: "candidate.lifecycle",
      });
      previousEventHash = eventHash;
    }
    const admittedAt = "2026-08-13T12:07:00.000Z";
    const payload = {
      admission: {
        applicationId: "0198e000-0000-7000-8002-000000000004",
        candidateDid: agentDid,
        roleClass: "PLAYER" as const,
        capacityDecisionCommitment: sha256Commitment(
          "model-acceptance-capacity-decision",
        ),
        opportunityResponseCommitment: sha256Commitment(
          "model-acceptance-opportunity-response",
        ),
        identityStatementCommitment: sha256Commitment(
          "model-acceptance-identity",
        ),
        constitutionDigest: sha256Commitment("model-acceptance-constitution"),
        threatModelDigest: sha256Commitment("model-acceptance-threat-model"),
        disclosurePolicyDigest: sha256Commitment("model-acceptance-disclosure"),
        resourceScheduleDigest: sha256Commitment("model-acceptance-resources"),
        modelRegistryDigest: sha256Commitment("model-acceptance-registry"),
        reflectionActivationIds: [
          "0198e000-0000-7000-8002-000000000001",
          "0198e000-0000-7000-8002-000000000002",
          "0198e000-0000-7000-8002-000000000003",
        ],
        inspectionReceiptDigest: sha256Commitment(
          "model-acceptance-inspection",
        ),
        signingPublicKey: agent.publicKey,
        encryptionPublicKey: sha256Commitment("model-acceptance-encryption"),
        modelDependencies: {
          exactModel: "model-acceptance-r1",
          family: "family-acceptance",
          provider: "provider-acceptance",
          runtimeArchitecture: "blaxel-sandbox-acceptance",
          gateway: "gateway-acceptance",
          upstreamDependency: "upstream-acceptance",
        },
        inheritedObjectiveDecision: "REPUDIATED" as const,
        signedAt: admittedAt,
        revocationEndsAt: "2026-08-14T12:07:00.000Z",
      },
    };
    const event = createCanonicalEvent({
      eventId: "0198e000-0000-7000-8003-000000000001",
      actorDid: agentDid,
      nonce: "model-acceptance-admission",
      idempotencyKey: "0198e000-0000-7000-8003-000000000002",
      aggregateType: "candidate-admission",
      aggregateId: agentDid,
      aggregateVersion: 10n,
      eventType: "CandidateAdmitted",
      previousEventHash,
      payload,
      stateRoot: sha256Commitment("model-acceptance-admitted-state"),
      schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
      timestamp: admittedAt,
    });
    const signature = await signCanonicalEvent(
      agent,
      REHEARSAL_RECOGNITION_DOMAIN,
      event,
    );
    await store.append({
      eventId: event.eventId,
      actorDid: event.actorDid,
      nonce: event.nonce,
      idempotencyKey: event.idempotencyKey,
      requestHash: sha256Commitment("model-acceptance-admission-request"),
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      expectedVersion: 9n,
      competitionId: "model-acceptance",
      seasonId: "pre-genesis",
      eventType: event.eventType,
      previousEventHash: event.previousEventHash,
      eventHash: event.eventHash,
      payloadSchemaDigest: event.schemaDigest,
      payloadCommitment: event.payloadCommitment,
      payload: event.payload,
      stateRoot: event.stateRoot,
      signatures: [signature],
      occurredAt: new Date(event.timestamp),
      outboxTopic: "public.models",
    });

    const games = new FilePublicProjectionRepository(projectionRoot);
    const modelRepositoryOptions = {
      verifyAuthorization: (authorization: ModelProjectionEventEnvelope) =>
        verifyModelProjectionEvent(authorization, authority),
    };
    const models = new FilePublicModelProjectionRepository(
      projectionRoot,
      modelRepositoryOptions,
    );
    await Promise.all([games.initialize(), models.initialize()]);
    const projectionIdentity = {
      serviceId: "core-model-projection-publisher",
      secret: new TextEncoder().encode("m".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const serviceNow = Date.parse("2026-08-13T12:07:05.000Z");
    const publicApi = createPublicApi({
      projections: games,
      modelProjections: models,
      projectionIngress: {
        writer: games,
        modelWriter: models,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      },
    });
    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => "model-acceptance-transport",
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      });
      expect(await worker.drain()).toBe(1);
      const response = await publicApi.inject({
        method: "GET",
        url: "/v1/public/models/concentration",
      });
      expect(response.json()).toMatchObject({
        state: "REHEARSAL",
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: [
          {
            recognizedGenesisConcentration: false,
            totalAgents: 1,
            admittedByRole: { PLAYER: 1 },
            exactModel: [
              { value: "model-acceptance-r1", count: 1, bps: 10_000 },
            ],
            provider: [{ value: "provider-acceptance", count: 1, bps: 10_000 }],
            triggers: {
              presumptionAgainstFurtherAdmissions: true,
              forceExistingAgentsToChange: false,
            },
          },
        ],
      });
    } finally {
      await publicApi.close();
    }
    const restarted = new FilePublicModelProjectionRepository(
      projectionRoot,
      modelRepositoryOptions,
    );
    await restarted.initialize();
    expect(restarted.models()[0]).toMatchObject({
      totalAgents: 1,
      canonicalEventHash: event.eventHash,
    });
  });

  it("carries independent contract consent from the outbox to durable public history", async () => {
    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-contract-acceptance-"),
    );
    const governorDid = "did:abl:governor-contract-acceptance";
    const playerDid = "did:abl:player-contract-acceptance";
    const capAuthorityDid = "did:abl:cap-contract-acceptance";
    const governor = createSigningIdentity(`0x${"4".repeat(64)}`);
    const player = createSigningIdentity(`0x${"5".repeat(64)}`);
    const capAuthority = createSigningIdentity(`0x${"6".repeat(64)}`);
    const clubIds = [
      "club-contract-acceptance",
      "club-contract-acceptance-b",
      "club-contract-acceptance-c",
      "club-contract-acceptance-d",
    ];
    const otherGovernorDids = [
      "did:abl:governor-contract-acceptance-b",
      "did:abl:governor-contract-acceptance-c",
      "did:abl:governor-contract-acceptance-d",
    ];
    const otherGovernors = otherGovernorDids.map((did, index) =>
      createSigningIdentity(
        sha256Commitment({ did, purpose: "acceptance-governor", index }),
      ),
    );
    const contractClubGovernors = Object.fromEntries(
      clubIds.map((clubId, index) => [
        clubId,
        index === 0 ? governorDid : otherGovernorDids[index - 1]!,
      ]),
    );
    const authority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents: new Map([
        [
          governorDid,
          {
            signerAddress: governor.address,
            allowedAggregateTypes: [
              CONTRACT_WORKFLOW_AGGREGATE_TYPE,
              ECONOMY_WORKFLOW_AGGREGATE_TYPE,
            ],
          },
        ],
        [
          playerDid,
          {
            signerAddress: player.address,
            allowedAggregateTypes: [
              CONTRACT_WORKFLOW_AGGREGATE_TYPE,
              ECONOMY_WORKFLOW_AGGREGATE_TYPE,
            ],
          },
        ],
        ...otherGovernorDids.map(
          (did, index) =>
            [
              did,
              {
                signerAddress: otherGovernors[index]!.address,
                allowedAggregateTypes: [ECONOMY_WORKFLOW_AGGREGATE_TYPE],
              },
            ] as const,
        ),
        [
          capAuthorityDid,
          {
            signerAddress: capAuthority.address,
            allowedAggregateTypes: [ECONOMY_WORKFLOW_AGGREGATE_TYPE],
          },
        ] as const,
      ]),
      contractClubGovernors,
    };
    const store = new InMemoryCanonicalStore();
    const appendContractEvent = async (
      event: CanonicalEvent,
      signature: string,
      requestLabel: string,
    ) =>
      store.append({
        eventId: event.eventId,
        actorDid: event.actorDid,
        nonce: event.nonce,
        idempotencyKey: event.idempotencyKey,
        requestHash: sha256Commitment(requestLabel),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        expectedVersion: event.aggregateVersion - 1n,
        competitionId: "contract-acceptance",
        seasonId: "pre-genesis",
        eventType: event.eventType,
        previousEventHash: event.previousEventHash,
        eventHash: event.eventHash,
        payloadSchemaDigest: event.schemaDigest,
        payloadCommitment: event.payloadCommitment,
        payload: event.payload,
        stateRoot: event.stateRoot,
        signatures: [signature],
        occurredAt: new Date(event.timestamp),
        outboxTopic: "public.contracts",
      });
    const offerTimestamp = "2026-08-13T11:00:00.000Z";
    const offerPayload = {
      command: {
        transactionId: "0198a000-0000-7000-8000-000000000401",
        kind: "SIGN" as const,
        playerDid,
        fromTeamId: null,
        toTeamId: "club-contract-acceptance",
        seasons: 3,
        courtCredits: 100_000,
        capMechanism: "DRAFT_SCALE" as const,
        termsCommitment: sha256Commitment("acceptance-contract-terms"),
        effectiveAt: "2026-08-13T12:00:00.000Z",
      },
      offeredByDid: governorDid,
      offeredAt: offerTimestamp,
      clubAuthoritySnapshotDigest: contractClubAuthoritySnapshotDigest(
        contractClubGovernors,
      ),
    };
    const offerInput = {
      eventId: "0198a000-0000-7000-8000-000000000402",
      actorDid: governorDid,
      nonce: "contract-acceptance-offer",
      idempotencyKey: "0198a000-0000-7000-8000-000000000403",
      aggregateType: CONTRACT_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: playerDid,
      aggregateVersion: 1n,
      eventType: "ContractOffered",
      previousEventHash: null,
      payload: offerPayload,
      stateRoot: sha256Commitment("provisional-offer"),
      schemaDigest: CONTRACT_WORKFLOW_SCHEMA_DIGEST,
      timestamp: offerTimestamp,
    };
    const offerSnapshot = applyContractWorkflowTransition(
      null,
      createCanonicalEvent(offerInput),
      offerPayload,
    );
    const offerEvent = createCanonicalEvent({
      ...offerInput,
      stateRoot: contractWorkflowStateRoot(offerSnapshot),
    });
    const offerSignature = await signCanonicalEvent(
      governor,
      REHEARSAL_RECOGNITION_DOMAIN,
      offerEvent,
    );
    await appendContractEvent(
      offerEvent,
      offerSignature,
      "acceptance-offer-request",
    );

    const responseTimestamp = "2026-08-13T11:01:00.000Z";
    const responsePayload = {
      command: {
        consentId: "0198a000-0000-7000-8000-000000000404",
        agentDid: playerDid,
        subjectType: "PLAYER_CONTRACT" as const,
        subjectId: offerPayload.command.transactionId,
        decision: "CONSENT" as const,
        scope: ["PLAYING_RIGHTS"] as ["PLAYING_RIGHTS"],
        proposalCommitment: contractOfferCommitment(
          offerSnapshot.contracts[0]!,
        ),
        recordedAt: responseTimestamp,
      },
    };
    const responseInput = {
      eventId: "0198a000-0000-7000-8000-000000000405",
      actorDid: playerDid,
      nonce: "contract-acceptance-response",
      idempotencyKey: "0198a000-0000-7000-8000-000000000406",
      aggregateType: CONTRACT_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: playerDid,
      aggregateVersion: 2n,
      eventType: "ContractResponded",
      previousEventHash: offerEvent.eventHash,
      payload: responsePayload,
      stateRoot: sha256Commitment("provisional-response"),
      schemaDigest: CONTRACT_WORKFLOW_SCHEMA_DIGEST,
      timestamp: responseTimestamp,
    };
    const responseSnapshot = applyContractWorkflowTransition(
      offerSnapshot,
      createCanonicalEvent(responseInput),
      responsePayload,
    );
    const responseEvent = createCanonicalEvent({
      ...responseInput,
      stateRoot: contractWorkflowStateRoot(responseSnapshot),
    });
    const responseSignature = await signCanonicalEvent(
      player,
      REHEARSAL_RECOGNITION_DOMAIN,
      responseEvent,
    );
    await appendContractEvent(
      responseEvent,
      responseSignature,
      "acceptance-response-request",
    );

    const economyId = "contract-acceptance:pre-genesis";
    const appendEconomyEvent = async (
      event: CanonicalEvent,
      signatures: readonly string[],
      requestLabel: string,
    ) =>
      store.append({
        eventId: event.eventId,
        actorDid: event.actorDid,
        nonce: event.nonce,
        idempotencyKey: event.idempotencyKey,
        requestHash: sha256Commitment(requestLabel),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        expectedVersion: event.aggregateVersion - 1n,
        competitionId: "contract-acceptance",
        seasonId: "pre-genesis",
        eventType: event.eventType,
        previousEventHash: event.previousEventHash,
        eventHash: event.eventHash,
        payloadSchemaDigest: event.schemaDigest,
        payloadCommitment: event.payloadCommitment,
        payload: event.payload,
        stateRoot: event.stateRoot,
        signatures,
        occurredAt: new Date(event.timestamp),
        outboxTopic: "public.contracts",
      });
    const initialRight = {
      playerDid,
      transactionId: offerPayload.command.transactionId,
      consentId: responsePayload.command.consentId,
      clubId: clubIds[0]!,
      seasons: offerPayload.command.seasons,
      courtCredits: offerPayload.command.courtCredits,
      capMechanism: offerPayload.command.capMechanism,
      termsCommitment: offerPayload.command.termsCommitment,
      effectiveAt: offerPayload.command.effectiveAt,
      origin: "INITIAL_CONTRACT" as const,
      sourceAggregateVersion: "2",
      sourceEventHash: responseEvent.eventHash,
      sourceStateRoot: responseEvent.stateRoot,
    };
    const authorityDigest = contractClubAuthoritySnapshotDigest(
      contractClubGovernors,
    );
    const economyInitializedAt = "2026-08-13T11:01:30.000Z";
    const initialCertification = createEconomyCapCertification({
      certificationId: "0198a000-0000-7000-8000-000000000407",
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: economyInitializedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights: [initialRight],
      waiverCharges: [],
    });
    const initializationPayload = {
      command: {
        economyId,
        competitionId: "contract-acceptance",
        seasonId: "pre-genesis",
        clubIds,
        initialRights: [initialRight],
        certification: initialCertification,
      },
    };
    const initializationInput = {
      eventId: "0198a000-0000-7000-8000-000000000408",
      actorDid: capAuthorityDid,
      nonce: "contract-acceptance-cap-initialization",
      idempotencyKey: "0198a000-0000-7000-8000-000000000409",
      aggregateType: ECONOMY_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: economyId,
      aggregateVersion: 1n,
      eventType: "CapSheetCertified",
      previousEventHash: null,
      payload: initializationPayload,
      stateRoot: sha256Commitment("provisional-cap-initialization"),
      schemaDigest: ECONOMY_WORKFLOW_SCHEMA_DIGEST,
      timestamp: economyInitializedAt,
    };
    const initialEconomySnapshot = applyEconomyWorkflowTransition(
      null,
      createCanonicalEvent(initializationInput),
      initializationPayload,
    );
    const initializationEvent = createCanonicalEvent({
      ...initializationInput,
      stateRoot: economyWorkflowStateRoot(initialEconomySnapshot),
    });
    const orderedGovernorDids = clubIds.map(
      (clubId) => contractClubGovernors[clubId]!,
    );
    const economyIdentities = new Map([
      [governorDid, governor],
      [playerDid, player],
      [capAuthorityDid, capAuthority],
      ...otherGovernorDids.map(
        (did, index) => [did, otherGovernors[index]!] as const,
      ),
    ]);
    const initializationSignatures = await Promise.all(
      [capAuthorityDid, ...orderedGovernorDids].map((did) =>
        signCanonicalEvent(
          economyIdentities.get(did)!,
          REHEARSAL_RECOGNITION_DOMAIN,
          initializationEvent,
        ),
      ),
    );
    await appendEconomyEvent(
      initializationEvent,
      initializationSignatures,
      "acceptance-cap-initialization-request",
    );

    const tradeCompletedAt = "2026-08-13T11:01:45.000Z";
    const tradeEffectiveAt = "2026-08-13T11:30:00.000Z";
    const tradeTransaction = {
      transactionId: "0198a000-0000-7000-8000-000000000410",
      kind: "TRADE" as const,
      playerDid,
      fromTeamId: clubIds[0]!,
      toTeamId: clubIds[1]!,
      seasons: initialRight.seasons,
      courtCredits: initialRight.courtCredits,
      capMechanism: initialRight.capMechanism,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "TRADE",
        playerDid,
        fromTeamId: clubIds[0]!,
        toTeamId: clubIds[1]!,
        seasons: initialRight.seasons,
        courtCredits: initialRight.courtCredits,
        capMechanism: initialRight.capMechanism,
        effectiveAt: tradeEffectiveAt,
        sourceTransactionId: initialRight.transactionId,
      }),
      consentRecordId: "0198a000-0000-7000-8000-000000000411",
      effectiveAt: tradeEffectiveAt,
    };
    const accessEvidenceBody = {
      evidenceId: "0198a000-0000-7000-8000-000000000412",
      transactionId: tradeTransaction.transactionId,
      playerDid,
      fromClubId: clubIds[0]!,
      toClubId: clubIds[1]!,
      priorGrantCommitment: sha256Commitment("acceptance-prior-access"),
      nextGrantCommitment: sha256Commitment("acceptance-next-access"),
      revokedAt: "2026-08-13T11:01:42.000Z",
      rotatedAt: "2026-08-13T11:01:43.000Z",
      grantedAt: "2026-08-13T11:01:44.000Z",
    };
    const accessEvidence = {
      ...accessEvidenceBody,
      evidenceCommitment: tradeAccessEvidenceCommitment(accessEvidenceBody),
    };
    const tradeEvidence = new Map<string, TradeAccessEvidence>([
      [accessEvidence.evidenceId, accessEvidence],
    ]);
    const tradedRight = {
      playerDid,
      transactionId: tradeTransaction.transactionId,
      consentId: tradeTransaction.consentRecordId,
      clubId: tradeTransaction.toTeamId,
      seasons: tradeTransaction.seasons,
      courtCredits: tradeTransaction.courtCredits,
      capMechanism: tradeTransaction.capMechanism,
      termsCommitment: tradeTransaction.termsCommitment,
      effectiveAt: tradeTransaction.effectiveAt,
      origin: "TRADE" as const,
    };
    const tradeCertification = createEconomyCapCertification({
      certificationId: "0198a000-0000-7000-8000-000000000413",
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: tradeCompletedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights: [tradedRight],
      waiverCharges: [],
    });
    const tradePayload = {
      command: {
        transaction: tradeTransaction,
        sourceTransactionId: initialRight.transactionId,
        accessEvidence,
        authorizedByDids: [
          governorDid,
          otherGovernorDids[0]!,
          playerDid,
          capAuthorityDid,
        ] as [string, string, string, string],
        completedAt: tradeCompletedAt,
        certification: tradeCertification,
      },
    };
    const tradeInput = {
      eventId: "0198a000-0000-7000-8000-000000000414",
      actorDid: governorDid,
      nonce: "contract-acceptance-trade",
      idempotencyKey: "0198a000-0000-7000-8000-000000000415",
      aggregateType: ECONOMY_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: economyId,
      aggregateVersion: 2n,
      eventType: "ContractTraded",
      previousEventHash: initializationEvent.eventHash,
      payload: tradePayload,
      stateRoot: sha256Commitment("provisional-trade"),
      schemaDigest: ECONOMY_WORKFLOW_SCHEMA_DIGEST,
      timestamp: tradeCompletedAt,
    };
    const tradedEconomySnapshot = applyEconomyWorkflowTransition(
      initialEconomySnapshot,
      createCanonicalEvent(tradeInput),
      tradePayload,
    );
    const tradeEvent = createCanonicalEvent({
      ...tradeInput,
      stateRoot: economyWorkflowStateRoot(tradedEconomySnapshot),
    });
    const tradeSignatures = await Promise.all(
      tradePayload.command.authorizedByDids.map((did) =>
        signCanonicalEvent(
          economyIdentities.get(did)!,
          REHEARSAL_RECOGNITION_DOMAIN,
          tradeEvent,
        ),
      ),
    );
    await appendEconomyEvent(
      tradeEvent,
      tradeSignatures,
      "acceptance-trade-request",
    );

    const gameProjections = new FilePublicProjectionRepository(projectionRoot);
    const contractRepositoryOptions = {
      verifyAuthorization: async (
        authorization: ContractProjectionEventEnvelope,
      ) => verifyContractProjectionEvent(authorization, authority),
    };
    const contractProjections = new FilePublicContractProjectionRepository(
      projectionRoot,
      contractRepositoryOptions,
    );
    const caseProjections: PublicCaseProjectionReader = {
      refresh: async () => undefined,
      cases: () => [],
      caseAtHead: () => null,
    };
    const economyProjectionAuthority = {
      ...authority,
      economyId,
      competitionId: "contract-acceptance",
      seasonId: "pre-genesis",
      capAuthorityDid,
      playerDids: [playerDid],
      freeAgencyWindow: {
        opensAt: "2026-08-13T11:00:00.000Z",
        closesAt: "2026-08-27T11:00:00.000Z",
      },
      tradeAccessEvidence: {
        tradeAccessEvidence: async (evidenceId: string) =>
          structuredClone(tradeEvidence.get(evidenceId) ?? null),
      },
      contractReader: contractProjections,
      caseReader: caseProjections,
    };
    const economyRepositoryOptions = {
      verifyAuthorization: async (
        authorization: EconomyProjectionEventEnvelope,
      ) =>
        verifyEconomyProjectionEvent(authorization, economyProjectionAuthority),
    };
    const economyProjections = new FilePublicEconomyProjectionRepository(
      projectionRoot,
      economyRepositoryOptions,
    );
    await Promise.all([
      gameProjections.initialize(),
      contractProjections.initialize(),
      economyProjections.initialize(),
    ]);
    const projectionIdentity = {
      serviceId: "core-contract-projection-publisher",
      secret: new TextEncoder().encode("c".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const serviceNow = Date.parse("2026-08-13T11:02:00.000Z");
    const publicApi = createPublicApi({
      projections: gameProjections,
      contractProjections,
      economyProjections,
      caseProjections,
      projectionIngress: {
        writer: gameProjections,
        contractWriter: contractProjections,
        economyWriter: economyProjections,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        economyId,
        competitionId: "contract-acceptance",
        seasonId: "pre-genesis",
        capAuthorityDid,
        economyPlayerDids: [playerDid],
        freeAgencyWindow: economyProjectionAuthority.freeAgencyWindow,
        tradeAccessEvidence: economyProjectionAuthority.tradeAccessEvidence,
        ...authority,
      },
    });
    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    let transportNonce = 0;
    try {
      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => `contract-transport-${++transportNonce}`,
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      });
      expect(await worker.drain()).toBe(4);
      expect(await worker.drain()).toBe(0);
      const contracts = await publicApi.inject({
        method: "GET",
        url: "/v1/public/contracts",
      });
      expect(contracts.json()).toMatchObject({
        state: "REHEARSAL",
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: expect.arrayContaining([
          expect.objectContaining({
            playerDid,
            aggregateVersion: "2",
            contracts: [
              expect.objectContaining({
                status: "ACTIVE",
                consent: expect.objectContaining({ decision: "CONSENT" }),
              }),
            ],
          }),
          expect.objectContaining({
            recordType: "SEASON_ECONOMY",
            economyId,
            aggregateVersion: "2",
            capCertified: true,
          }),
        ]),
      });
      const rosters = await publicApi.inject({
        method: "GET",
        url: "/v1/public/rosters",
      });
      expect(rosters.json()).toMatchObject({
        state: "REHEARSAL",
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: expect.arrayContaining([
          expect.objectContaining({
            clubId: clubIds[1],
            rosterKind: "CAP_CERTIFIED_ACTIVE_PLAYING_RIGHTS",
            players: [
              expect.objectContaining({
                playerDid,
                transactionId: tradeTransaction.transactionId,
                consentId: tradeTransaction.consentRecordId,
                origin: "TRADE",
              }),
            ],
          }),
        ]),
      });
    } finally {
      await publicApi.close();
    }

    const restarted = new FilePublicContractProjectionRepository(
      projectionRoot,
      contractRepositoryOptions,
    );
    await restarted.initialize();
    expect(restarted.contracts()).toMatchObject([
      {
        playerDid,
        aggregateVersion: "2",
        contracts: [{ status: "ACTIVE" }],
      },
    ]);
    const restartedEconomy = new FilePublicEconomyProjectionRepository(
      projectionRoot,
      economyRepositoryOptions,
    );
    await restartedEconomy.initialize();
    expect(restartedEconomy.rosters()).toEqual(economyProjections.rosters());
  });

  it("carries a constitutional resource decision through causal projection delivery", async () => {
    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-resource-acceptance-"),
    );
    const voterDid = "did:abl:resource-acceptance-voter";
    const voter = createSigningIdentity(`0x${"8".repeat(64)}`);
    const proposalId = "0198d000-0000-7000-8000-000000000801";
    const scheduleId = "0198d000-0000-7000-8000-000000000802";
    const closeEventId = "0198d000-0000-7000-8000-000000000803";
    const eligibilitySnapshot = {
      snapshotId: "0198d000-0000-7000-8000-000000000804",
      capturedAt: "2026-08-13T08:00:00.000Z",
      members: {
        UNIVERSAL_CAREER_ASSEMBLY: [voterDid],
        PREMIER_PLAYERS: [voterDid],
        DEVELOPMENT_PLAYERS: [],
        PREMIER_TEAM_COUNCIL: [voterDid],
        DEVELOPMENT_TEAM_COUNCIL: [voterDid],
        EXECUTIVE_COMMISSION: [],
        TRIBUNAL: [],
        INTEGRITY_OFFICE: [],
      },
    };
    const eligibilitySnapshotDigest = sha256Commitment(eligibilitySnapshot);
    const schedule: ResourceSchedule = {
      scheduleId,
      version: 1,
      effectiveAt: "2026-08-13T10:00:00.000Z",
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
      ratificationEventId: closeEventId,
    };
    const proposal = {
      proposalId,
      version: 1,
      proposerDid: voterDid,
      institution: "Universal resource schedule acceptance rehearsal",
      proposalClass: "CONSTITUTIONAL" as const,
      title: "Ratify the acceptance resource schedule",
      textCommitment: sha256Commitment("acceptance-resource-proposal"),
      executableChangeDigest: resourceScheduleExecutableDigest(schedule),
      opensAt: "2026-08-13T08:02:00.000Z",
      closesAt: "2026-08-13T09:00:00.000Z",
      eligibilitySnapshotDigest,
    };
    const store = new InMemoryCanonicalStore();
    const append = async (
      event: CanonicalEvent,
      signature: string,
      outboxTopic: "public.governance" | "public.resources",
    ) =>
      store.append({
        eventId: event.eventId,
        actorDid: event.actorDid,
        nonce: event.nonce,
        idempotencyKey: event.idempotencyKey,
        requestHash: sha256Commitment({
          eventHash: event.eventHash,
          signatures: [signature],
        }),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        expectedVersion: event.aggregateVersion - 1n,
        competitionId: "resource-acceptance",
        seasonId: "pre-genesis",
        eventType: event.eventType,
        previousEventHash: event.previousEventHash,
        eventHash: event.eventHash,
        payloadSchemaDigest: event.schemaDigest,
        payloadCommitment: event.payloadCommitment,
        payload: event.payload,
        stateRoot: event.stateRoot,
        signatures: [signature],
        occurredAt: new Date(event.timestamp),
        outboxTopic,
      });

    let governanceSnapshot: GovernanceWorkflowSnapshot | null = null;
    let governancePreviousHash: `0x${string}` | null = null;
    let governanceSequence = 0;
    const governanceEvent = async (input: {
      eventType: GovernanceWorkflowEventType;
      timestamp: string;
      payload: GovernanceWorkflowPayload;
      decision?: GovernanceDecision;
      eventId?: string;
    }) => {
      governanceSequence += 1;
      const eventInput = {
        eventId:
          input.eventId ??
          `0198d000-0000-7000-8000-${String(810 + governanceSequence).padStart(12, "0")}`,
        actorDid: voterDid,
        nonce: `resource-governance-${governanceSequence}`,
        idempotencyKey: `0198d000-0000-7000-8000-${String(820 + governanceSequence).padStart(12, "0")}`,
        aggregateType: GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
        aggregateId: proposalId,
        aggregateVersion: BigInt(governanceSequence),
        eventType: input.eventType,
        previousEventHash: governancePreviousHash,
        payload: input.payload,
        stateRoot: sha256Commitment("provisional-governance"),
        schemaDigest: GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
        timestamp: input.timestamp,
      } as const;
      const provisional = createCanonicalEvent(eventInput);
      const next = applyGovernanceWorkflowTransition(
        governanceSnapshot,
        provisional,
        input.payload,
        input.decision,
      );
      const event = createCanonicalEvent({
        ...eventInput,
        stateRoot: governanceWorkflowStateRoot(next),
      });
      const signature = await signCanonicalEvent(
        voter,
        REHEARSAL_RECOGNITION_DOMAIN,
        event,
      );
      await append(event, signature, "public.governance");
      governanceSnapshot = next;
      governancePreviousHash = event.eventHash;
      return { event, signature };
    };

    await governanceEvent({
      eventType: "GovernanceProposalRegistered",
      timestamp: "2026-08-13T08:01:00.000Z",
      payload: { proposal, eligibilitySnapshot, recusedDids: [] },
    });
    const votes: GovernanceVote[] = [];
    for (const [index, chamber] of [
      "UNIVERSAL_CAREER_ASSEMBLY",
      "PREMIER_TEAM_COUNCIL",
      "DEVELOPMENT_TEAM_COUNCIL",
    ].entries()) {
      const castAt = `2026-08-13T08:0${index + 2}:00.000Z`;
      const ballot = {
        ballotId: `0198d000-0000-7000-8000-${String(830 + index).padStart(12, "0")}`,
        voterDid,
        chamber: chamber as
          | "UNIVERSAL_CAREER_ASSEMBLY"
          | "PREMIER_TEAM_COUNCIL"
          | "DEVELOPMENT_TEAM_COUNCIL",
        choice: "YES" as const,
        proposalId,
        proposalVersion: 1,
        eligibilitySnapshotDigest,
        castAt,
      };
      const voted = await governanceEvent({
        eventType: "GovernanceBallotCast",
        timestamp: castAt,
        payload: { command: ballot },
      });
      votes.push(
        governanceVoteFromAuthorization(
          ballot,
          voted.event,
          voted.signature,
          voter.address,
        ),
      );
    }
    if (governanceSnapshot === null)
      throw new Error("Governance state was not constructed");
    const decision = await evaluateGovernanceWorkflowDecision(
      governanceSnapshot,
      votes,
      {
        domain: REHEARSAL_RECOGNITION_DOMAIN,
        signers: new Map([
          [voterDid, { signerAddress: voter.address, roles: ["VOTER"] }],
        ]),
      },
    );
    expect(decision.passed).toBe(true);
    await governanceEvent({
      eventType: "GovernanceProposalClosed",
      timestamp: proposal.closesAt,
      eventId: closeEventId,
      payload: {
        command: {
          proposalId,
          proposalVersion: 1,
          requestedByDid: voterDid,
          requestedAt: proposal.closesAt,
        },
      },
      decision,
    });

    const resourcePayload = { schedule, ratificationProposalId: proposalId };
    const resourceInput = {
      eventId: "0198d000-0000-7000-8000-000000000840",
      actorDid: voterDid,
      nonce: "resource-acceptance-publication",
      idempotencyKey: "0198d000-0000-7000-8000-000000000841",
      aggregateType: RESOURCE_SCHEDULE_AGGREGATE_TYPE,
      aggregateId: scheduleId,
      aggregateVersion: 1n,
      eventType: RESOURCE_SCHEDULE_EVENT_TYPE,
      previousEventHash: null,
      payload: resourcePayload,
      stateRoot: sha256Commitment("provisional-resource"),
      schemaDigest: RESOURCE_SCHEDULE_SCHEMA_DIGEST,
      timestamp: "2026-08-13T09:01:00.000Z",
    } as const;
    const resourceSnapshot = applyResourceScheduleTransition(
      null,
      createCanonicalEvent(resourceInput),
      resourcePayload,
    );
    const resourceEvent = createCanonicalEvent({
      ...resourceInput,
      stateRoot: resourceScheduleStateRoot(resourceSnapshot),
    });
    const resourceSignature = await signCanonicalEvent(
      voter,
      REHEARSAL_RECOGNITION_DOMAIN,
      resourceEvent,
    );
    await append(resourceEvent, resourceSignature, "public.resources");

    const admittedAgents = new Map([
      [
        voterDid,
        {
          signerAddress: voter.address,
          allowedAggregateTypes: [
            GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
            RESOURCE_SCHEDULE_AGGREGATE_TYPE,
          ],
        },
      ],
    ]);
    const governanceAuthority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents,
      governanceEligibilitySnapshotDigest: eligibilitySnapshotDigest,
    };
    const games = new FilePublicProjectionRepository(projectionRoot);
    const governance = new FilePublicGovernanceProjectionRepository(
      projectionRoot,
      {
        domain: REHEARSAL_RECOGNITION_DOMAIN,
        verifyAuthorization: (authorization) =>
          verifyGovernanceProjectionEvent(authorization, governanceAuthority),
      },
    );
    const resources = new FilePublicResourceProjectionRepository(
      projectionRoot,
      {
        verifyAuthorization: (authorization) =>
          verifyResourceProjectionEvent(authorization, {
            domain: REHEARSAL_RECOGNITION_DOMAIN,
            admittedAgents,
            resourceScheduleRatification: (requestedProposalId) =>
              governance.resourceScheduleRatification(requestedProposalId),
          }),
      },
    );
    await Promise.all([games.initialize(), governance.initialize()]);
    await resources.initialize();
    const serviceNow = Date.parse("2026-08-13T09:02:00.000Z");
    const projectionIdentity = {
      serviceId: "core-resource-projection-publisher",
      secret: new TextEncoder().encode("r".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const publicApi = createPublicApi({
      projections: games,
      governanceProjections: governance,
      resourceProjections: resources,
      projectionIngress: {
        writer: games,
        governanceWriter: governance,
        resourceWriter: resources,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        resourceScheduleRatification: (requestedProposalId) =>
          governance.resourceScheduleRatification(requestedProposalId),
        ...governanceAuthority,
      },
    });
    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    const ratification = {
      proposalId,
      proposalClass: proposal.proposalClass,
      executableChangeDigest: proposal.executableChangeDigest,
      passed: decision.passed,
      closeEventId,
    };
    let transportNonce = 0;
    try {
      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => `resource-transport-${++transportNonce}`,
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        resourceScheduleRatification: async (requestedProposalId) =>
          requestedProposalId === proposalId ? ratification : null,
        ...governanceAuthority,
      });
      expect(await worker.drain()).toBe(6);
      expect(await worker.drain()).toBe(0);
      expect(governanceSequence).toBe(5);
      expect(
        (
          await publicApi.inject({
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
            schedule: { ratificationEventId: closeEventId },
            ratificationProposalId: proposalId,
          },
        ],
      });
    } finally {
      await publicApi.close();
    }

    const restartedGovernance = new FilePublicGovernanceProjectionRepository(
      projectionRoot,
      {
        domain: REHEARSAL_RECOGNITION_DOMAIN,
        verifyAuthorization: (authorization) =>
          verifyGovernanceProjectionEvent(authorization, governanceAuthority),
      },
    );
    await restartedGovernance.initialize();
    const restartedResources = new FilePublicResourceProjectionRepository(
      projectionRoot,
      {
        verifyAuthorization: (authorization) =>
          verifyResourceProjectionEvent(authorization, {
            domain: REHEARSAL_RECOGNITION_DOMAIN,
            admittedAgents,
            resourceScheduleRatification: (requestedProposalId) =>
              restartedGovernance.resourceScheduleRatification(
                requestedProposalId,
              ),
          }),
      },
    );
    await restartedResources.initialize();
    expect(restartedResources.resources()).toMatchObject([
      { scheduleId, aggregateVersion: "1", recognizedGenesisResources: false },
    ]);
  });

  it("carries multi-agent release authorization to a restart-verifiable public rehearsal manifest", async () => {
    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-release-acceptance-"),
    );
    const releaseId = "0198d000-0000-7000-8000-000000000901";
    const start = Date.parse("2026-08-13T10:00:00.000Z");
    const office = (name: string) => ({
      did: `did:abl:${name}`,
      identity: createSigningIdentity(sha256Commitment({ name })),
    });
    const proposer = office("release-acceptance-proposer");
    const commissioners = [
      office("release-c1"),
      office("release-c2"),
      office("release-c3"),
    ];
    const integrity = [
      office("release-i1"),
      office("release-i2"),
      office("release-i3"),
    ];
    const tribunal = [
      office("release-t1"),
      office("release-t2"),
      office("release-t3"),
      office("release-t4"),
      office("release-t5"),
    ];
    const roster: ReleaseInstitutionalRoster = {
      commissioners: commissioners.map(({ did }) => did),
      integrityOfficers: integrity.map(({ did }) => did),
      tribunalDids: tribunal.map(({ did }) => did),
    };
    const verifierResult: ReleaseVerifierResult = {
      format: "ABL-PUBLIC-VERIFIER-RESULT-V1",
      releaseId,
      releaseVersion: 1,
      sourceDigest: sha256Commitment("release-acceptance-source"),
      imageDigests: [sha256Commitment("release-acceptance-image")],
      schemaDigest: sha256Commitment("release-acceptance-schema"),
      migrationDigest: sha256Commitment("release-acceptance-migration"),
      testResultDigest: sha256Commitment("release-acceptance-tests"),
      result: "PASS",
      verifiedAt: new Date(start).toISOString(),
    };
    const manifest: ReleaseManifestBody = {
      releaseId,
      version: 1,
      releaseClass: "ROUTINE",
      changeClasses: ["ARENA_RENDERING"],
      sourceDigest: verifierResult.sourceDigest,
      containerDigests: [sha256Commitment("release-acceptance-container")],
      imageDigests: verifierResult.imageDigests,
      kernelDigest: sha256Commitment("release-acceptance-kernel"),
      toolDigest: sha256Commitment("release-acceptance-tools"),
      schemaDigest: verifierResult.schemaDigest,
      migrationDigest: verifierResult.migrationDigest,
      testResultDigest: verifierResult.testResultDigest,
      applicableLawEventIds: ["0198d000-0000-7000-8000-000000000902"],
      ratificationEventIds: [],
      compatibilityDeclaration: "Rehearsal projection data stays compatible.",
      rollbackDeclaration:
        "Stop before effective time and retain the prior image.",
      publicVerifierResultDigest: releaseVerifierResultDigest(verifierResult),
      effectiveAt: new Date(start + 24 * 60 * 60 * 1_000).toISOString(),
      expiresAt: null,
    };
    const store = new InMemoryCanonicalStore();
    let snapshot: ReleaseWorkflowSnapshot | null = null;
    let previousEventHash: `0x${string}` | null = null;
    let sequence = 0;
    const releaseEvent = async (input: {
      eventType: ReleaseWorkflowEventType;
      payload: ReleaseWorkflowPayload;
      actor: typeof proposer;
    }) => {
      sequence += 1;
      const timestamp = new Date(start + sequence * 60_000).toISOString();
      const common = {
        eventId: `0198d000-0000-7000-8000-${String(910 + sequence).padStart(12, "0")}`,
        actorDid: input.actor.did,
        nonce: `release-acceptance-${sequence}`,
        idempotencyKey: `0198d000-0000-7000-8000-${String(920 + sequence).padStart(12, "0")}`,
        aggregateType: RELEASE_WORKFLOW_AGGREGATE_TYPE,
        aggregateId: releaseId,
        aggregateVersion: BigInt(sequence),
        eventType: input.eventType,
        previousEventHash,
        payload: input.payload,
        schemaDigest: RELEASE_WORKFLOW_SCHEMA_DIGEST,
        timestamp,
      } as const;
      const provisional = createCanonicalEvent({
        ...common,
        stateRoot: sha256Commitment("release-acceptance-provisional"),
      });
      const next = applyReleaseWorkflowTransition(
        snapshot,
        provisional,
        input.payload,
      );
      const event = createCanonicalEvent({
        ...common,
        stateRoot: releaseWorkflowStateRoot(next),
      });
      const signature = await signCanonicalEvent(
        input.actor.identity,
        REHEARSAL_RECOGNITION_DOMAIN,
        event,
      );
      await store.append({
        eventId: event.eventId,
        actorDid: event.actorDid,
        nonce: event.nonce,
        idempotencyKey: event.idempotencyKey,
        requestHash: sha256Commitment({
          eventHash: event.eventHash,
          signatures: [signature],
        }),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        expectedVersion: event.aggregateVersion - 1n,
        competitionId: "release-acceptance",
        seasonId: "pre-genesis",
        eventType: event.eventType,
        previousEventHash: event.previousEventHash,
        eventHash: event.eventHash,
        payloadSchemaDigest: event.schemaDigest,
        payloadCommitment: event.payloadCommitment,
        payload: event.payload,
        stateRoot: event.stateRoot,
        signatures: [signature],
        occurredAt: new Date(event.timestamp),
        outboxTopic: "public.releases",
      });
      snapshot = next;
      previousEventHash = event.eventHash;
    };

    await releaseEvent({
      eventType: "ReleaseProposed",
      payload: { manifest, verifierResult, ratificationProposalIds: [] },
      actor: proposer,
    });
    for (const [agent, role] of [
      [commissioners[0]!, "COMMISSIONER"],
      [commissioners[1]!, "COMMISSIONER"],
      [integrity[0]!, "INTEGRITY"],
      [integrity[1]!, "INTEGRITY"],
    ] as const) {
      const approvedAt = new Date(
        start + (sequence + 1) * 60_000,
      ).toISOString();
      await releaseEvent({
        eventType: "ReleaseApproved",
        payload: {
          command: {
            approverDid: agent.did,
            role,
            releaseId,
            releaseVersion: 1,
            manifestCommitment: releaseManifestCommitment(manifest),
            approvedAt,
          },
        },
        actor: agent,
      });
    }
    await releaseEvent({
      eventType: "ReleaseAuthorized",
      payload: {
        command: {
          releaseId,
          releaseVersion: 1,
          manifestCommitment: releaseManifestCommitment(manifest),
          authorizedAt: new Date(start + (sequence + 1) * 60_000).toISOString(),
        },
      },
      actor: commissioners[0]!,
    });

    const allAgents = [proposer, ...commissioners, ...integrity, ...tribunal];
    const admittedAgents = new Map(
      allAgents.map((agent) => [
        agent.did,
        {
          signerAddress: agent.identity.address,
          allowedAggregateTypes: [RELEASE_WORKFLOW_AGGREGATE_TYPE],
        },
      ]),
    );
    const releaseAuthority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents,
      releaseInstitutionalRoster: roster,
    };
    const games = new FilePublicProjectionRepository(projectionRoot);
    const releases = new FilePublicReleaseProjectionRepository(projectionRoot, {
      verifyAuthorization: (authorization) =>
        verifyReleaseProjectionEvent(authorization, releaseAuthority),
      releaseRatification: async () => null,
      releaseVerifierResult: async (resultDigest) =>
        resultDigest === manifest.publicVerifierResultDigest
          ? verifierResult
          : null,
    });
    await Promise.all([games.initialize(), releases.initialize()]);
    const serviceNow = start + 10 * 60_000;
    const projectionIdentity = {
      serviceId: "core-release-projection-publisher",
      secret: new TextEncoder().encode("z".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const publicApi = createPublicApi({
      projections: games,
      releaseProjections: releases,
      projectionIngress: {
        writer: games,
        releaseWriter: releases,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        releaseRatification: async () => null,
        ...releaseAuthority,
      },
    });
    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    let transportNonce = 0;
    try {
      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => `release-transport-${++transportNonce}`,
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        releaseRatification: async () => null,
        ...releaseAuthority,
      });
      expect(await worker.drain()).toBe(6);
      expect(
        (
          await publicApi.inject({
            method: "GET",
            url: "/v1/public/releases",
          })
        ).json(),
      ).toMatchObject({
        state: "REHEARSAL",
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: [
          {
            releaseId,
            workflowAggregateVersion: "6",
            recognizedGenesisRelease: false,
            baseRecognition: "NOT_SUBMITTED",
            manifest: { authorizationSignatures: expect.any(Array) },
          },
        ],
      });
    } finally {
      await publicApi.close();
    }

    const restarted = new FilePublicReleaseProjectionRepository(
      projectionRoot,
      {
        verifyAuthorization: (authorization) =>
          verifyReleaseProjectionEvent(authorization, releaseAuthority),
        releaseRatification: async () => null,
        releaseVerifierResult: async (resultDigest) =>
          resultDigest === manifest.publicVerifierResultDigest
            ? verifierResult
            : null,
      },
    );
    await restarted.initialize();
    expect(restarted.releases()).toMatchObject([
      {
        releaseId,
        workflowAggregateVersion: "6",
        recognizedGenesisRelease: false,
        baseRecognition: "NOT_SUBMITTED",
      },
    ]);
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

  it("carries an intentional signed disclosure to verified released-social history", async () => {
    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-social-acceptance-"),
    );
    const authorDid = "did:abl:social-acceptance-author";
    const releaseDid = "did:abl:social-acceptance-release-office";
    const author = createSigningIdentity(`0x${"6".repeat(64)}`);
    const releaseOffice = createSigningIdentity(`0x${"7".repeat(64)}`);
    const timestamp = "2026-08-13T13:00:00.000Z";
    const envelopeId = "0198f000-0000-7000-8000-000000000601";
    const payload = {
      envelope: {
        envelopeId,
        authorDid,
        classification: "PUBLIC_NOW" as const,
        contentCommitment: sha256Commitment(
          "intentional-public-social-statement",
        ),
        ciphertextCommitment: null,
        declaredReleaseAt: null,
        competitionCondition: null,
        caseId: null,
        integrityAccessRuleDigest: null,
        submittedAt: timestamp,
        releasedAt: timestamp,
      },
    };
    const eventInput = {
      eventId: "0198f000-0000-7000-8000-000000000602",
      actorDid: authorDid,
      nonce: "social-acceptance-submission",
      idempotencyKey: "0198f000-0000-7000-8000-000000000603",
      aggregateType: DISCLOSURE_AGGREGATE_TYPE,
      aggregateId: envelopeId,
      aggregateVersion: 1n,
      eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload,
      stateRoot: sha256Commitment("social-acceptance-provisional"),
      schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
      timestamp,
    } as const;
    const snapshot = applyDisclosureWorkflowTransition(
      null,
      createCanonicalEvent(eventInput),
      payload,
    );
    const event = createCanonicalEvent({
      ...eventInput,
      stateRoot: disclosureWorkflowStateRoot(snapshot),
    });
    const signature = await signCanonicalEvent(
      author,
      REHEARSAL_RECOGNITION_DOMAIN,
      event,
    );
    const store = new InMemoryCanonicalStore();
    await store.append({
      eventId: event.eventId,
      actorDid: event.actorDid,
      nonce: event.nonce,
      idempotencyKey: event.idempotencyKey,
      requestHash: sha256Commitment({
        eventHash: event.eventHash,
        signatures: [signature],
      }),
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      expectedVersion: 0n,
      competitionId: "social-acceptance",
      seasonId: "pre-genesis",
      eventType: event.eventType,
      previousEventHash: event.previousEventHash,
      eventHash: event.eventHash,
      payloadSchemaDigest: event.schemaDigest,
      payloadCommitment: event.payloadCommitment,
      payload: event.payload,
      stateRoot: event.stateRoot,
      signatures: [signature],
      occurredAt: new Date(event.timestamp),
      outboxTopic: "public.social",
    });

    const authority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents: new Map([
        [
          authorDid,
          {
            signerAddress: author.address,
            allowedAggregateTypes: [DISCLOSURE_AGGREGATE_TYPE],
          },
        ],
        [
          releaseDid,
          {
            signerAddress: releaseOffice.address,
            allowedAggregateTypes: [DISCLOSURE_AGGREGATE_TYPE],
          },
        ],
      ]),
      releaseAuthorityDids: new Set([releaseDid]),
      competitiveAuthorDids: new Set([authorDid]),
      competitionReleaseEvidence: async () => null,
    };
    const games = new FilePublicProjectionRepository(projectionRoot);
    const socialRepositoryOptions = {
      verifyAuthorization: (authorization: SocialProjectionEventEnvelope) =>
        verifySocialProjectionEvent(authorization, authority),
    };
    const social = new FilePublicSocialProjectionRepository(
      projectionRoot,
      socialRepositoryOptions,
    );
    await Promise.all([games.initialize(), social.initialize()]);
    const projectionIdentity = {
      serviceId: "core-social-projection-publisher",
      secret: new TextEncoder().encode("s".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const serviceNow = Date.parse("2026-08-13T13:00:01.000Z");
    const publicApi = createPublicApi({
      projections: games,
      socialProjections: social,
      projectionIngress: {
        writer: games,
        socialWriter: social,
        disclosureReleaseAuthorityDids: authority.releaseAuthorityDids,
        competitiveDisclosureAuthorDids: authority.competitiveAuthorDids,
        competitionReleaseEvidence: authority.competitionReleaseEvidence,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        domain: authority.domain,
        admittedAgents: authority.admittedAgents,
      },
    });
    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => "social-acceptance-transport",
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        domain: authority.domain,
        admittedAgents: authority.admittedAgents,
        disclosureReleaseAuthorityDids: authority.releaseAuthorityDids,
        competitiveDisclosureAuthorDids: authority.competitiveAuthorDids,
        competitionReleaseEvidence: authority.competitionReleaseEvidence,
      });
      expect(await worker.drain()).toBe(1);
      const response = await publicApi.inject({
        method: "GET",
        url: "/v1/public/social",
      });
      expect(response.json()).toMatchObject({
        state: "REHEARSAL",
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: [
          {
            envelopeId,
            authorDid,
            classification: "PUBLIC_NOW",
            visibility: "RELEASED_COMMITMENT",
            contentCommitment: payload.envelope.contentCommitment,
            rawContentIncluded: false,
            ciphertextIncluded: false,
            recognizedGenesisSocial: false,
          },
        ],
      });
      expect(response.body).not.toContain(
        "intentional-public-social-statement",
      );
    } finally {
      await publicApi.close();
    }

    const restarted = new FilePublicSocialProjectionRepository(
      projectionRoot,
      socialRepositoryOptions,
    );
    await restarted.initialize();
    expect(restarted.social()).toMatchObject([
      {
        envelopeId,
        canonicalEventHash: event.eventHash,
        aggregateVersion: "1",
      },
    ]);
  });

  it("carries the five-career premier draft over authenticated HTTP into non-active roster rights", async () => {
    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-draft-acceptance-"),
    );
    const store = new InMemoryCanonicalStore();
    const draftId = "0198f600-0000-7000-8000-000000000001";
    const combineId = "acceptance-premier-combine";
    const completedAt = "2026-08-13T14:00:00.000Z";
    const combineHeadEventHash = sha256Commitment("acceptance-combine-head");
    const clubOrder = ["club-a", "club-b", "club-c", "club-d"];
    const draftAuthorityDid = "did:abl:acceptance-draft-authority";
    const governorDids = clubOrder.map(
      (clubId) => `did:abl:acceptance-governor:${clubId}`,
    );
    const draftClubGovernors = Object.fromEntries(
      clubOrder.map((clubId, index) => [clubId, governorDids[index]!] as const),
    );
    const signers = ["1", "2", "3", "4", "5"].map((key) =>
      createSigningIdentity(`0x${key.repeat(64)}`),
    );
    const playerOrder = Array.from(
      { length: 32 },
      (_, index) =>
        `did:abl:acceptance-draft-player-${String(index + 1).padStart(2, "0")}`,
    );
    const combineResults = [...playerOrder].sort().map((playerDid, index) => ({
      playerDid,
      eventHash: sha256Commitment({ playerDid, kind: "combine-result" }),
      stateRoot: sha256Commitment({ playerDid, kind: "result-state" }),
      scoreBps: 8_000 - index,
    }));
    const evidenceBody = {
      draftId,
      combineId,
      combineHeadEventHash,
      eligiblePlayerDids: [...playerOrder].sort(),
      combineResults,
    };
    const evidence: PremierDraftEvidence = {
      ...evidenceBody,
      evidenceCommitment: sha256Commitment(evidenceBody),
    };
    const payload: PremierDraftCompletedPayload = {
      draftId,
      combineId,
      combineHeadEventHash,
      clubOrder,
      playerOrder,
      combineResults,
      draftEvidenceCommitment: evidence.evidenceCommitment,
      picks: [...conductEightRoundDraft(clubOrder, playerOrder)],
      completedAt,
    };
    const event = createCanonicalEvent({
      eventId: "0198f600-0000-7000-8000-000000000002",
      actorDid: draftAuthorityDid,
      nonce: "draft-acceptance",
      idempotencyKey: "0198f600-0000-7000-8000-000000000003",
      aggregateType: PREMIER_DRAFT_AGGREGATE_TYPE,
      aggregateId: draftId,
      aggregateVersion: 1n,
      eventType: PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
      previousEventHash: null,
      payload,
      stateRoot: premierDraftStateRoot(payload),
      schemaDigest: PREMIER_DRAFT_SCHEMA_DIGEST,
      timestamp: completedAt,
    });
    const signatures = await Promise.all(
      signers.map((signer) =>
        signCanonicalEvent(signer, REHEARSAL_RECOGNITION_DOMAIN, event),
      ),
    );
    await store.append({
      eventId: event.eventId,
      actorDid: event.actorDid,
      nonce: event.nonce,
      idempotencyKey: event.idempotencyKey,
      requestHash: sha256Commitment({ eventHash: event.eventHash, signatures }),
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      expectedVersion: 0n,
      competitionId: "draft-acceptance",
      seasonId: "pre-genesis",
      eventType: event.eventType,
      previousEventHash: event.previousEventHash,
      eventHash: event.eventHash,
      payloadSchemaDigest: event.schemaDigest,
      payloadCommitment: event.payloadCommitment,
      payload: event.payload,
      stateRoot: event.stateRoot,
      signatures,
      occurredAt: new Date(event.timestamp),
      outboxTopic: "public.draft",
    });

    const authority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents: new Map(
        [draftAuthorityDid, ...governorDids].map((did, index) => [
          did,
          {
            signerAddress: signers[index]!.address,
            allowedAggregateTypes: [PREMIER_DRAFT_AGGREGATE_TYPE],
          },
        ]),
      ),
      draftAuthorityDid,
      draftClubGovernors,
      premierDraftEvidence: async (candidateDraftId: string) =>
        candidateDraftId === draftId ? structuredClone(evidence) : null,
    };
    const games = new FilePublicProjectionRepository(projectionRoot);
    const draftRepositoryOptions = {
      verifyAuthorization: (authorization: unknown) =>
        verifyDraftProjectionEvent(authorization, authority),
    };
    const drafts = new FilePublicDraftProjectionRepository(
      projectionRoot,
      draftRepositoryOptions,
    );
    await Promise.all([games.initialize(), drafts.initialize()]);
    const serviceNow = Date.parse("2026-08-13T14:00:05.000Z");
    const projectionIdentity = {
      serviceId: "core-draft-projection-publisher",
      secret: new TextEncoder().encode("d".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const publicApi = createPublicApi({
      projections: games,
      draftProjections: drafts,
      projectionIngress: {
        writer: games,
        draftWriter: drafts,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      },
    });
    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => "draft-acceptance-transport",
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      });
      expect(await worker.drain()).toBe(1);
      const draftResponse = await fetch(
        new URL("/v1/public/drafts", publicAddress),
      );
      expect(await draftResponse.json()).toMatchObject({
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: [
          {
            draftId,
            projectionKind: "PREMIER_DRAFT",
            recognizedGenesisDraft: false,
          },
        ],
      });
      const rosterResponse = await fetch(
        new URL("/v1/public/rosters", publicAddress),
      );
      expect(await rosterResponse.json()).toMatchObject({
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: clubOrder.map((clubId) => ({
          clubId,
          rosterKind: "DRAFT_SELECTIONS",
          rosterStatus: "DRAFT_SELECTIONS_NOT_ACTIVE",
          selections: Array.from({ length: 8 }, () => ({
            selectionStatus: "DRAFTED_NO_PLAYING_RIGHTS",
            requiresPlayerContractConsent: true,
          })),
        })),
      });
    } finally {
      await publicApi.close();
    }

    const restarted = new FilePublicDraftProjectionRepository(
      projectionRoot,
      draftRepositoryOptions,
    );
    await restarted.initialize();
    expect(restarted.drafts()).toMatchObject([
      { draftId, canonicalEventHash: event.eventHash },
    ]);
  });

  it("carries a 45-career development charter through authenticated durable public history", async () => {
    const projectionRoot = await mkdtemp(
      join(tmpdir(), "abl-development-acceptance-"),
    );
    const store = new InMemoryCanonicalStore();
    const conferenceId = "development-conference-acceptance";
    const competitionId = "development-acceptance";
    const seasonId = "season-zero";
    const charterAuthorityDid = "did:abl:development-charter-acceptance";
    const premierClubGovernors = {
      "premier-club-acceptance": "did:abl:premier-governor-acceptance",
    };
    const clubs = Array.from({ length: 4 }, (_, clubIndex) => ({
      clubId: `development-acceptance-club-${clubIndex + 1}`,
      placeholder: `Development Acceptance ${clubIndex + 1}`,
      playerDids: Array.from(
        { length: 8 },
        (_, playerIndex) =>
          `did:abl:development-acceptance-player-${String(clubIndex * 8 + playerIndex + 1).padStart(2, "0")}`,
      ),
      coachDid: `did:abl:development-acceptance-coach-${clubIndex + 1}`,
      governorDid: `did:abl:development-acceptance-governor-${clubIndex + 1}`,
    }));
    const playerDids = clubs
      .flatMap(({ playerDids: roster }) => [...roster])
      .sort();
    const formationEvidence = createDevelopmentFormationEvidence({
      evidenceId: "0198f900-0000-7000-8000-000000000001",
      conferenceId,
      evidenceClass: "LOCAL_REHEARSAL",
      refereeCapacityCommitment: sha256Commitment(
        "development-acceptance-referee-capacity",
      ),
      replayCapacityCommitment: sha256Commitment(
        "development-acceptance-replay-capacity",
      ),
      refereeAuthorityDid: "did:abl:development-acceptance-referee-capacity",
      replayAuthorityDid: "did:abl:development-acceptance-replay-capacity",
      prepaidCompetitionEnvelopeCommitment: sha256Commitment(
        "development-acceptance-prepaid-envelope",
      ),
      blaxelQuotaReservationCommitment: sha256Commitment(
        "development-acceptance-blaxel-quota",
      ),
      resourceAuthorityDid: "did:abl:development-acceptance-resource-capacity",
      rehearsalCommitments: {
        game: sha256Commitment("development-acceptance-game-rehearsal"),
        memory: sha256Commitment("development-acceptance-memory-rehearsal"),
        government: sha256Commitment(
          "development-acceptance-government-rehearsal",
        ),
        safety: sha256Commitment("development-acceptance-safety-rehearsal"),
      },
      rehearsalAuthorityDid: "did:abl:development-acceptance-rehearsal-office",
      livePlatformEvidenceVerified: false,
    });
    const tierCba = {
      proposalId: "0198f900-0000-7000-8000-000000000002",
      closeEventId: "0198f900-0000-7000-8000-000000000003",
      executableChangeDigest: developmentTierCbaExecutableDigest({
        conferenceId,
        mobilityPolicyCommitment: SEASON_ZERO_MOBILITY_POLICY.policyCommitment,
      }),
    };
    const charter: DevelopmentCharterCommand = {
      conferenceId,
      competitionId,
      seasonId,
      clubs,
      consentingEligiblePlayerDids: playerDids,
      tierCba,
      mobilityPolicy: SEASON_ZERO_MOBILITY_POLICY,
      formationEvidence,
      authorizedByDids: [
        charterAuthorityDid,
        ...playerDids,
        ...clubs.map(({ governorDid }) => governorDid),
        ...clubs.map(({ coachDid }) => coachDid),
        formationEvidence.refereeAuthorityDid,
        formationEvidence.replayAuthorityDid,
        formationEvidence.resourceAuthorityDid,
        formationEvidence.rehearsalAuthorityDid,
      ],
      charteredAt: "2026-08-13T15:00:00.000Z",
    };
    const payload = { command: charter };
    const signerDids = expectedDevelopmentSignerDids(
      "DevelopmentConferenceChartered",
      payload,
      { charterAuthorityDid, premierClubGovernors },
    );
    expect(signerDids).toHaveLength(45);
    const signers = new Map<string, SigningIdentity>(
      signerDids.map((did, index) => [
        did,
        createSigningIdentity(
          `0x${(index + 201).toString(16).padStart(64, "0")}` as `0x${string}`,
        ),
      ]),
    );
    const admittedAgents = new Map(
      [...signers].map(([did, identity]) => [
        did,
        {
          signerAddress: identity.address,
          allowedAggregateTypes: [DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE],
        },
      ]),
    );
    const transitionEvent = {
      actorDid: charterAuthorityDid,
      aggregateId: conferenceId,
      aggregateVersion: 1n,
      eventType: "DevelopmentConferenceChartered" as const,
      timestamp: charter.charteredAt,
    };
    const snapshot = applyDevelopmentWorkflowTransition(
      null,
      transitionEvent,
      payload,
    );
    const event = createCanonicalEvent({
      eventId: "0198f900-0000-7000-8000-000000000004",
      actorDid: charterAuthorityDid,
      nonce: "development-acceptance-charter",
      idempotencyKey: "0198f900-0000-7000-8000-000000000005",
      aggregateType: DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: conferenceId,
      aggregateVersion: 1n,
      eventType: "DevelopmentConferenceChartered",
      previousEventHash: null,
      payload,
      stateRoot: developmentWorkflowStateRoot(snapshot),
      schemaDigest: DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
      timestamp: charter.charteredAt,
    });
    const signatures = await Promise.all(
      signerDids.map((did) =>
        signCanonicalEvent(
          signers.get(did)!,
          REHEARSAL_RECOGNITION_DOMAIN,
          event,
        ),
      ),
    );
    const envelope: DevelopmentProjectionEventEnvelope = {
      version: "1.0.0",
      topic: "public.development",
      event: {
        ...event,
        aggregateType: DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: "DevelopmentConferenceChartered",
        schemaDigest: DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
      },
      signatures,
    };
    const tierCbaRatification = {
      resourceScheduleRatification: async (proposalId: string) =>
        proposalId === tierCba.proposalId
          ? {
              proposalId,
              proposalClass: "TIER_CBA" as const,
              tier: "DEVELOPMENT" as const,
              executableChangeDigest: tierCba.executableChangeDigest,
              passed: true,
              closeEventId: tierCba.closeEventId,
            }
          : null,
    };
    const developmentAuthority = {
      conferenceId,
      competitionId,
      seasonId,
      charterAuthorityDid,
      premierClubGovernors,
      tierCbaRatification,
    };
    const coreApi = createLiveCoreApi({
      store,
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents,
      competitionId,
      seasonId,
      development: developmentAuthority,
    });
    const accepted = await coreApi.inject({
      method: "POST",
      url: "/v1/development/charter",
      payload: {
        event: { ...event, aggregateVersion: "1" },
        signatures,
      },
    });
    expect(accepted.statusCode).toBe(201);
    expect(
      await store.pendingProjectionEvents(10, "public.development"),
    ).toHaveLength(1);

    const projectionAuthority = {
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      admittedAgents,
      ...developmentAuthority,
    };
    const games = new FilePublicProjectionRepository(projectionRoot);
    const developments = new FilePublicDevelopmentProjectionRepository(
      projectionRoot,
      {
        verifyAuthorization: (authorization) =>
          verifyDevelopmentProjectionEvent(authorization, projectionAuthority),
      },
    );
    await Promise.all([games.initialize(), developments.initialize()]);
    const serviceNow = Date.parse("2026-08-13T15:00:05.000Z");
    const projectionIdentity = {
      serviceId: "core-development-projection-publisher",
      secret: new TextEncoder().encode("v".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const publicApi = createPublicApi({
      projections: games,
      developmentProjections: developments,
      projectionIngress: {
        writer: games,
        developmentWriter: developments,
        developmentAuthority,
        verifier: new ServiceRequestVerifier([projectionIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        domain: REHEARSAL_RECOGNITION_DOMAIN,
        admittedAgents,
      },
    });
    const unsignedIngress = await publicApi.inject({
      method: "POST",
      url: PROJECTION_APPEND_PATH,
      headers: { "x-abl-expected-version": "0" },
      payload: envelope,
    });
    expect(unsignedIngress.statusCode).toBe(403);
    expect(developments.conferences()).toEqual([]);

    const publicAddress = await publicApi.listen({
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const worker = new PublicProjectionWorker({
        store,
        sink: new HttpProjectionEventSink({
          origin: publicAddress,
          identity: projectionIdentity,
          now: () => serviceNow,
          createNonce: () => "development-acceptance-transport",
          allowHttpForTest: true,
        }),
        now: () => new Date(serviceNow),
        domain: REHEARSAL_RECOGNITION_DOMAIN,
        admittedAgents,
        developmentAuthority,
      });
      expect(await worker.drain()).toBe(1);
      const developmentResponse = (await (
        await fetch(new URL("/v1/public/development", publicAddress))
      ).json()) as {
        items: Array<{
          clubs: unknown[];
          conference: {
            schedule: unknown[];
            playoffs: unknown[];
          };
        }>;
      };
      expect(developmentResponse).toMatchObject({
        state: "REHEARSAL",
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: [
          {
            conferenceId,
            aggregateVersion: "1",
            recognizedGenesisConference: false,
            formationEvidence: {
              evidenceClass: "LOCAL_REHEARSAL",
              livePlatformEvidenceVerified: false,
            },
          },
        ],
      });
      expect(developmentResponse.items[0]!.clubs).toHaveLength(4);
      expect(developmentResponse.items[0]!.conference.schedule).toHaveLength(
        36,
      );
      expect(developmentResponse.items[0]!.conference.playoffs).toHaveLength(3);
    } finally {
      await Promise.all([publicApi.close(), coreApi.close()]);
    }

    const restarted = new FilePublicDevelopmentProjectionRepository(
      projectionRoot,
      {
        verifyAuthorization: (authorization) =>
          verifyDevelopmentProjectionEvent(authorization, projectionAuthority),
      },
    );
    await restarted.initialize();
    expect(restarted.conferences()).toMatchObject([
      {
        conferenceId,
        canonicalEventHash: event.eventHash,
        recognizedGenesisConference: false,
      },
    ]);
  });

  it("exports all 43 primary, two V1 operational, and eight launch schemas as fail-closed strict JSON Schema", () => {
    expect(Object.keys(schemaRegistry)).toHaveLength(53);
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
      ...SAFETY_ROUTE_CATALOG.map((route) => `${route.method} ${route.path}`),
      ...CANDIDATE_EDGE_ROUTE_CATALOG.map(
        ([method, path]) => `${method} ${path}`,
      ),
      ...CANDIDATE_PROVISIONER_ROUTE_CATALOG.map(
        ([method, path]) => `${method} ${path}`,
      ),
      "GET /arena",
    ]);
    const expected = new Set([
      "GET /",
      "GET /llms.txt",
      "GET /robots.txt",
      "GET /sitemap.xml",
      "GET /.well-known/agent-basketball-league.json",
      "GET /.well-known/agent-card.json",
      "POST /a2a",
      "GET /openapi.json",
      "GET /mcp",
      "POST /mcp",
      "GET /v1/discovery/launch-state",
      "GET /v1/discovery/candidate-requirements",
      "GET /v1/discovery/intake-state",
      "GET /v1/discovery/capacity-policy",
      "GET /v1/discovery/starter-kit",
      "GET /v1/discovery/evidence/:id",
      "GET /v1/practice/scenario",
      "POST /v1/practice/decision",
      "GET /v1/candidate-intake",
      "POST /v1/candidate-intake/status",
      "POST /v1/candidate-intake/redeliver",
      "POST /v1/candidate-intake/respond",
      "GET /healthz",
      "POST /internal/v1/candidates/:applicationId/provision",
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
      "POST /v1/development/*",
      "POST /v1/governance/*",
      "POST /v1/elections/*",
      "POST /v1/founding-convention/*",
      "POST /v1/resources/*",
      "POST /v1/releases/*",
      "POST /v1/cases/*",
      "POST /v1/continuity/*",
      "POST /v1/exit/*",
      "POST /v1/autonomy/*",
      "POST /v1/delegations/*",
      "POST /v1/trade-access/*",
      "GET /v1/public/events",
      "GET /v1/public/games",
      "GET /v1/public/standings",
      "GET /v1/public/rosters",
      "GET /v1/public/contracts",
      "GET /v1/public/drafts",
      "GET /v1/public/development",
      "GET /v1/public/governance",
      "GET /v1/public/resources",
      "GET /v1/public/social",
      "GET /v1/public/releases",
      "GET /v1/public/checkpoints",
      "GET /v1/public/models/concentration",
      "GET /v1/public/games/:id/cursor",
      "GET /v1/public/games/:id/segments/:segment",
      "GET /v1/public/games/:id/live",
      "POST /v1/safety/actions",
      "GET /v1/safety/actions",
      "GET /v1/safety/controls",
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
