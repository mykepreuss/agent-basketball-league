import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FINALIZED_GAME_AGGREGATE_TYPE,
  FinalizedGamePayloadSchema,
  FINALIZED_GAME_SCHEMA_DIGEST,
  GAME_FINALIZED_EVENT_TYPE,
  createAgentPlayedGameEvidence,
  createFinalizedGameScheduleEvidence,
  finalizedGameStateRoot,
  runDeterministicExhibition,
  type FinalizedGamePayload,
  type FinalizedGameScheduleEvidence,
} from "@abl/basketball";
import { InMemoryCanonicalStore } from "@abl/database";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
} from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  FilePublicFinalGameProjectionRepository,
  FilePublicProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  verifyFinalGameProjectionEvent,
  type FinalGameProjectionEventEnvelope,
  type FinalGameProjectionRecord,
  type FinalGameProjectionVerificationAuthority,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const finalizerDid = "did:abl:game-finalizer";
const finalizer = createSigningIdentity(`0x${"b".repeat(64)}`);
const rogue = createSigningIdentity(`0x${"c".repeat(64)}`);
const participantDid = "did:abl:projection-player-0";
const participant = createSigningIdentity(`0x${"a".repeat(64)}`);
const gameId = "0198f200-0000-7000-8000-000000000001";
const finalizedAt = "2026-08-13T10:00:00.000Z";
const uuid = (sequence: number) =>
  `0198f200-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
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
  scheduledAt: "2026-08-13T09:00:00.000Z",
  scheduleEventHash: sha256Commitment("projection-schedule-event"),
  scheduleStateRoot: sha256Commitment("projection-schedule-state"),
});

function decisionHashes(role: string, count: number): Hex[] {
  return Array.from({ length: count }, (_, index) =>
    sha256Commitment({ role, index }),
  );
}

async function finalizedGame(signer = finalizer) {
  const exhibition = runDeterministicExhibition(gameId);
  const agentEvidence = createAgentPlayedGameEvidence({
    gameId,
    gameInput: exhibition.input,
    commands: exhibition.commands,
    proof: exhibition.proof,
    possessionProofs: [
      {
        possessionId: "projection-finalized-possession-1",
        playerDecisionHashes: decisionHashes("player", 20),
        coachDecisionHashes: decisionHashes("coach", 4),
        refereeDecisionHashes: decisionHashes("referee", 3),
        replayDecisionHashes: decisionHashes("replay", 2),
        eventMerkleRoot: sha256Commitment("projection-possession-events"),
        finalStateRoot: sha256Commitment("projection-possession-state"),
      },
    ],
  });
  const payload = FinalizedGamePayloadSchema.parse({
    gameId,
    finalizedAt,
    competition: scheduleEvidence,
    input: exhibition.input,
    commands: exhibition.commands,
    proof: exhibition.proof,
    agentEvidence,
    filmCommitment: sha256Commitment(exhibition.events),
    broadcastStartedAt: finalizedAt,
    broadcastIntervalMs: 1,
  });
  const event = createCanonicalEvent({
    eventId: uuid(2),
    actorDid: finalizerDid,
    nonce: "finalized-game-1",
    idempotencyKey: uuid(3),
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
    signature: await signCanonicalEvent(signer, domain, event),
  } satisfies FinalGameProjectionEventEnvelope;
  return { payload, event, envelope };
}

async function participantFinalizedGame() {
  const exhibition = runDeterministicExhibition(gameId);
  const possessionProof = {
    possessionId: "projection-participant-possession-1",
    playerDecisionHashes: decisionHashes("participant-player", 20),
    coachDecisionHashes: decisionHashes("participant-coach", 4),
    refereeDecisionHashes: decisionHashes("participant-referee", 3),
    replayDecisionHashes: decisionHashes("participant-replay", 2),
    authorityDids: {
      players: Array.from(
        { length: 20 },
        (_, index) => `did:abl:projection-player-${index % 10}`,
      ),
      coaches: Array.from(
        { length: 4 },
        (_, index) => `did:abl:projection-coach-${index % 2}`,
      ),
      referees: Array.from(
        { length: 3 },
        (_, index) => `did:abl:projection-referee-${index}`,
      ),
      replayOfficials: Array.from(
        { length: 2 },
        (_, index) => `did:abl:projection-replay-${index}`,
      ),
    },
    eventMerkleRoot: sha256Commitment("participant-possession-events"),
    finalStateRoot: sha256Commitment("participant-possession-state"),
  };
  const payload = FinalizedGamePayloadSchema.parse({
    gameId,
    finalizedAt,
    competition: null,
    input: exhibition.input,
    commands: exhibition.commands,
    proof: exhibition.proof,
    agentEvidence: createAgentPlayedGameEvidence({
      gameId,
      gameInput: exhibition.input,
      commands: exhibition.commands,
      proof: exhibition.proof,
      possessionProofs: [possessionProof],
    }),
    filmCommitment: sha256Commitment(exhibition.events),
    broadcastStartedAt: finalizedAt,
    broadcastIntervalMs: 0,
  });
  const event = createCanonicalEvent({
    eventId: uuid(12),
    actorDid: participantDid,
    nonce: "participant-finalized-game-1",
    idempotencyKey: uuid(13),
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
  return {
    payload,
    possessionProof,
    envelope: {
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
      signature: await signCanonicalEvent(participant, domain, event),
    } satisfies FinalGameProjectionEventEnvelope,
  };
}

function authority(
  evidence: FinalizedGamePayload["agentEvidence"] | null,
  schedule: FinalizedGameScheduleEvidence | null = scheduleEvidence,
): FinalGameProjectionVerificationAuthority {
  return {
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
    finalizedGameEvidence: async (candidateGameId) =>
      candidateGameId === gameId ? structuredClone(evidence) : null,
    scheduleEvidence: {
      finalizedGameScheduleEvidence: async (candidateGameId) =>
        candidateGameId === gameId ? structuredClone(schedule) : null,
    },
  };
}

function repository(
  root: string,
  evidence: FinalizedGamePayload["agentEvidence"],
) {
  const verificationAuthority = authority(evidence);
  return new FilePublicFinalGameProjectionRepository(root, {
    verifyAuthorization: (authorization, projectedAt) =>
      verifyFinalGameProjectionEvent(
        authorization,
        verificationAuthority,
        projectedAt,
      ),
    now: () => new Date("2026-08-13T10:00:05.000Z"),
  });
}

async function append(
  store: InMemoryCanonicalStore,
  event: CanonicalEvent,
  signature: string,
): Promise<void> {
  await store.append({
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({ eventHash: event.eventHash, signature }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: 0n,
    competitionId: "season-zero",
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
    outboxTopic: "public.finalized-game",
  });
}

describe("durable finalized game projections", () => {
  it("requires a configured finalizer, exact replay, and independent agent evidence", async () => {
    const finalized = await finalizedGame();
    await expect(
      verifyFinalGameProjectionEvent(
        finalized.envelope,
        authority(finalized.payload.agentEvidence),
      ),
    ).resolves.toMatchObject({
      expectedVersion: "0",
      projection: {
        projectionKind: "FINALIZED_GAME",
        gameId,
        phase: "FINAL",
        winner: "HOME",
        replayInferenceInvocations: 0,
      },
    });
    await expect(
      verifyFinalGameProjectionEvent(finalized.envelope, authority(null)),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
    await expect(
      verifyFinalGameProjectionEvent(
        finalized.envelope,
        authority(finalized.payload.agentEvidence, null),
      ),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
    await expect(
      verifyFinalGameProjectionEvent(
        finalized.envelope,
        authority(finalized.payload.agentEvidence),
        finalizedAt,
      ),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
    const rogueGame = await finalizedGame(rogue);
    await expect(
      verifyFinalGameProjectionEvent(
        rogueGame.envelope,
        authority(rogueGame.payload.agentEvidence),
      ),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const participantGame = await participantFinalizedGame();
    const participantAuthority: FinalGameProjectionVerificationAuthority = {
      domain,
      admittedAgents: new Map([
        [
          participantDid,
          {
            signerAddress: participant.address,
            allowedAggregateTypes: [FINALIZED_GAME_AGGREGATE_TYPE],
          },
        ],
      ]),
      finalizerDids: new Set(),
      finalizedGameEvidence: async () => null,
      possessionEvidence: {
        finalizedGamePossessionEvidence: async () => [
          participantGame.possessionProof,
        ],
      },
    };
    await expect(
      verifyFinalGameProjectionEvent(
        participantGame.envelope,
        participantAuthority,
      ),
    ).resolves.toMatchObject({ projection: { phase: "FINAL" } });
    await expect(
      verifyFinalGameProjectionEvent(participantGame.envelope, {
        ...participantAuthority,
        possessionEvidence: {
          finalizedGamePossessionEvidence: async () => [
            {
              ...participantGame.possessionProof,
              finalStateRoot: sha256Commitment("tampered-possession-state"),
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
  });

  it("persists idempotently, reconstructs after restart, and rejects tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-final-game-projection-"));
    const finalized = await finalizedGame();
    const first = repository(root, finalized.payload.agentEvidence);
    await first.initialize();
    const published = await first.publish(finalized.envelope, "0");
    expect((await first.publish(finalized.envelope, "99")).cursor).toBe(
      published.cursor,
    );
    expect(first.game(gameId)).toMatchObject({
      score: { home: 5, away: 2 },
      commandCount: finalized.payload.commands.length,
      possessionCount: 1,
    });
    expect(first.standings()).toMatchObject([
      {
        recordType: "SEASON_STANDINGS",
        competitionId: "abl-rehearsal",
        seasonId: "season-zero",
        tier: "PREMIER",
        completedGameCount: 1,
        standings: [
          {
            rank: 1,
            clubId: "club-a",
            gamesPlayed: 1,
            wins: 1,
            losses: 0,
            pointsFor: 5,
            pointsAgainst: 2,
            pointDifferential: 3,
          },
          { rank: 2, clubId: "club-c", gamesPlayed: 0 },
          { rank: 3, clubId: "club-d", gamesPlayed: 0 },
          {
            rank: 4,
            clubId: "club-b",
            gamesPlayed: 1,
            wins: 0,
            losses: 1,
            pointDifferential: -3,
          },
        ],
      },
    ]);

    const restarted = repository(root, finalized.payload.agentEvidence);
    await restarted.initialize();
    expect(restarted.games()).toEqual(first.games());
    expect(restarted.standings()).toEqual(first.standings());

    const path = join(root, "final-game-records", "000000000000.json");
    const legacy = JSON.parse(
      await readFile(path, "utf8"),
    ) as FinalGameProjectionRecord;
    delete legacy.projection.snapshots;
    const { recordHash: _legacyRecordHash, ...legacyWithoutHash } = legacy;
    legacy.recordHash = sha256Commitment(legacyWithoutHash);
    await writeFile(path, `${JSON.stringify(legacy)}\n`, "utf8");
    const upgradedLegacy = repository(root, finalized.payload.agentEvidence);
    await upgradedLegacy.initialize();
    expect(upgradedLegacy.game(gameId)?.snapshots).toHaveLength(
      finalized.payload.commands.length + 1,
    );

    const tampered = JSON.parse(
      await readFile(path, "utf8"),
    ) as FinalGameProjectionRecord;
    tampered.projection.score.home = 999;
    const { recordHash: _recordHash, ...withoutHash } = tampered;
    tampered.recordHash = sha256Commitment(withoutHash);
    await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(
      repository(root, finalized.payload.agentEvidence).initialize(),
    ).rejects.toThrow("chain is corrupt");
  });

  it("crosses the canonical outbox through the independently verified worker", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-final-game-worker-"));
    const finalized = await finalizedGame();
    const store = new InMemoryCanonicalStore();
    await append(store, finalized.event, finalized.envelope.signature);
    const finalGames = repository(root, finalized.payload.agentEvidence);
    await finalGames.initialize();
    const possessionGames = new FilePublicProjectionRepository(root, {
      verifyAuthorization: async () => {
        throw new Error("No possession event expected");
      },
    });
    await possessionGames.initialize();
    const verificationAuthority = authority(finalized.payload.agentEvidence);
    const worker = new PublicProjectionWorker({
      store,
      writer: possessionGames,
      finalGameWriter: finalGames,
      domain: verificationAuthority.domain,
      admittedAgents: verificationAuthority.admittedAgents,
      finalizedGameAuthorityDids: verificationAuthority.finalizerDids,
      finalizedGameEvidence: verificationAuthority.finalizedGameEvidence,
      finalizedGameScheduleEvidence: verificationAuthority.scheduleEvidence!,
    });
    expect(await worker.drain()).toBe(1);
    expect(finalGames.game(gameId)).toMatchObject({ phase: "FINAL" });
    expect(
      await store.pendingProjectionEvents(10, "public.finalized-game"),
    ).toEqual([]);
  });
});
