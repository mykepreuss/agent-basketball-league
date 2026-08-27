import {
  FINALIZED_GAME_AGGREGATE_TYPE,
  FINALIZED_GAME_SCHEMA_DIGEST,
  GAME_FINALIZED_EVENT_TYPE,
  POSSESSION_RESOLVED_SCHEMA_DIGEST_V2,
  FinalizedGamePayloadSchema,
  createAgentPlayedGameEvidence,
  finalizedGameStateRoot,
  possessionProjectionSource,
  runFirstPossessionRehearsal,
  runDeterministicExhibition,
} from "@abl/basketball";
import { InMemoryCanonicalStore } from "@abl/database";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  CORE_ROUTE_CATALOG,
  createCoreApi,
  createLiveCoreApi,
} from "../src/server.js";
import { CandidateNotAdmittedError } from "../src/candidates.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const finalizerDid = "did:abl:core-finalizer";
const finalizer = createSigningIdentity(`0x${"d".repeat(64)}`);
const rogue = createSigningIdentity(`0x${"e".repeat(64)}`);
const gameId = "0198f300-0000-7000-8000-000000000001";
const finalizedAt = "2026-08-13T10:00:00.000Z";

function decisionHashes(role: string, count: number): Hex[] {
  return Array.from({ length: count }, (_, index) =>
    sha256Commitment({ role, index }),
  );
}

function finalizedPayload() {
  const game = runDeterministicExhibition(gameId);
  return FinalizedGamePayloadSchema.parse({
    gameId,
    finalizedAt,
    input: game.input,
    commands: game.commands,
    proof: game.proof,
    agentEvidence: createAgentPlayedGameEvidence({
      gameId,
      gameInput: game.input,
      commands: game.commands,
      proof: game.proof,
      possessionProofs: [
        {
          possessionId: "core-finalized-possession-1",
          playerDecisionHashes: decisionHashes("player", 20),
          coachDecisionHashes: decisionHashes("coach", 4),
          refereeDecisionHashes: decisionHashes("referee", 3),
          replayDecisionHashes: decisionHashes("replay", 2),
          eventMerkleRoot: sha256Commitment("core-possession-events"),
          finalStateRoot: sha256Commitment("core-possession-state"),
        },
      ],
    }),
    filmCommitment: sha256Commitment(game.events),
    broadcastStartedAt: finalizedAt,
    broadcastIntervalMs: 1,
  });
}

function finalizedEvent(
  payload: ReturnType<typeof finalizedPayload>,
  sequence: number,
) {
  return createCanonicalEvent({
    eventId: `0198f300-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    actorDid: finalizerDid,
    nonce: `final-game-command-${sequence}`,
    idempotencyKey: `0198f300-0000-7000-8000-${String(sequence + 1).padStart(12, "0")}`,
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
}

async function possessionEvent(actorDid: string) {
  const rehearsal = await runFirstPossessionRehearsal();
  const { result } = rehearsal;
  const finalSegmentHash = result.segments.at(-1)?.segmentHash;
  if (finalSegmentHash === undefined)
    throw new Error("Possession did not produce a public segment");
  const source = {
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
  return createCanonicalEvent({
    eventId: "0198f300-0000-7000-8000-000000000021",
    actorDid,
    nonce: "dynamic-candidate-possession-1",
    idempotencyKey: "0198f300-0000-7000-8000-000000000022",
    aggregateType: "game-possession",
    aggregateId: result.finalState.gameId,
    aggregateVersion: 1n,
    eventType: "PossessionResolved",
    previousEventHash: null,
    payload: { source, decisionProof: rehearsal.decisionProof },
    stateRoot: result.finalStateRoot,
    schemaDigest: sha256Commitment("PossessionResolved:1.0.0"),
    timestamp: finalizedAt,
  });
}

function finalizedGameApp(
  evidence: ReturnType<typeof finalizedPayload>["agentEvidence"] | null,
  operatingProfile?: "PRE_GENESIS_REHEARSAL" | "PRODUCTION_V1_PRE_GENESIS",
) {
  const store = new InMemoryCanonicalStore();
  const app = createLiveCoreApi({
    ...(operatingProfile === undefined ? {} : { operatingProfile }),
    store,
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
    competitionId: "season-zero",
    seasonId: "pre-genesis",
    now: () => Date.parse(finalizedAt),
    finalizedGames: {
      finalizerDids: new Set([finalizerDid]),
      evidence: {
        finalizedGameEvidence: async (candidateGameId) =>
          candidateGameId === gameId ? evidence : null,
      },
    },
  });
  return { app, store };
}

describe("core API pre-genesis boundary", () => {
  it("cannot activate PRODUCTION_GENESIS from configuration alone", () => {
    expect(() =>
      createLiveCoreApi({
        operatingProfile: "PRODUCTION_GENESIS",
        store: new InMemoryCanonicalStore(),
        domain,
        admittedAgents: new Map(),
        competitionId: "competition-pre-genesis",
        seasonId: "season-zero",
      }),
    ).toThrow("PRODUCTION_GENESIS evidence rejected");
  });

  it("identifies an explicitly selected production V1 without claiming genesis", async () => {
    const { app } = finalizedGameApp(null, "PRODUCTION_V1_PRE_GENESIS");
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-operating-profile"]).toBe(
      "PRODUCTION_V1_PRE_GENESIS",
    );
    expect(response.json()).toMatchObject({
      genesis: false,
      operatingProfile: "PRODUCTION_V1_PRE_GENESIS",
      rehearsal: false,
      productionV1: true,
      canonicalWritesEnabled: true,
    });
    await app.close();
  });

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

describe("core finalized-game command path", () => {
  it("persists an independently evidenced signed final game and rejects unsigned or rogue writes", async () => {
    const payload = finalizedPayload();
    const event = finalizedEvent(payload, 2);
    const signature = await signCanonicalEvent(finalizer, domain, event);
    const { app, store } = finalizedGameApp(payload.agentEvidence);
    const body = {
      event: { ...event, aggregateVersion: "1" },
      signatures: [signature],
    };
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/commands",
      payload: body,
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      accepted: true,
      canonical: true,
      duplicate: false,
    });
    expect(
      await store.pendingProjectionEvents(10, "public.finalized-game"),
    ).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/commands",
          payload: body,
        })
      ).json(),
    ).toMatchObject({ accepted: true, duplicate: true });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/commands",
          payload: { ...body, signatures: [] },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            ...body,
            signatures: [await signCanonicalEvent(rogue, domain, event)],
          },
        })
      ).statusCode,
    ).toBe(403);
    await app.close();
  });

  it("fails closed when independent decision evidence is absent", async () => {
    const payload = finalizedPayload();
    const event = finalizedEvent(payload, 4);
    const { app } = finalizedGameApp(null);
    const response = await app.inject({
      method: "POST",
      url: "/v1/commands",
      payload: {
        event: { ...event, aggregateVersion: "1" },
        signatures: [await signCanonicalEvent(finalizer, domain, event)],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_command" });
    await app.close();
  });

  it("allows an actual player to finalize only the canonical possession evidence", async () => {
    const participantDid = "did:abl:participant-player-0";
    const participant = createSigningIdentity(`0x${"a".repeat(64)}`);
    const rehearsal = await runFirstPossessionRehearsal();
    const possessionId = "core-participant-possession-1";
    const authorityDids = {
      players: Array.from(
        { length: 20 },
        (_, index) => `did:abl:participant-player-${index % 10}`,
      ),
      coaches: Array.from(
        { length: 4 },
        (_, index) => `did:abl:participant-coach-${index % 2}`,
      ),
      referees: Array.from(
        { length: 3 },
        (_, index) => `did:abl:participant-referee-${index}`,
      ),
      replayOfficials: Array.from(
        { length: 2 },
        (_, index) => `did:abl:participant-replay-${index}`,
      ),
    };
    const proof = {
      playerDecisionHashes: decisionHashes("participant-player", 20),
      coachDecisionHashes: decisionHashes("participant-coach", 4),
      refereeDecisionHashes: decisionHashes("participant-referee", 3),
      replayDecisionHashes: decisionHashes("participant-replay", 2),
      authorityDids,
    };
    const source = {
      ...possessionProjectionSource(rehearsal.result),
      gameId,
      possessionId,
      snapshots: rehearsal.result.snapshots.map((snapshot) => ({
        ...snapshot,
        gameId,
        possessionId,
      })),
    };
    const possession = createCanonicalEvent({
      eventId: "0198f300-0000-7000-8000-000000000031",
      actorDid: participantDid,
      nonce: "participant-possession-1",
      idempotencyKey: "0198f300-0000-7000-8000-000000000032",
      aggregateType: "game-possession",
      aggregateId: gameId,
      aggregateVersion: 1n,
      eventType: "PossessionResolved",
      previousEventHash: null,
      payload: { source, decisionProof: proof },
      stateRoot: source.finalStateRoot,
      schemaDigest: POSSESSION_RESOLVED_SCHEMA_DIGEST_V2,
      timestamp: finalizedAt,
    });
    const game = runDeterministicExhibition(gameId);
    const payload = FinalizedGamePayloadSchema.parse({
      gameId,
      finalizedAt,
      input: game.input,
      commands: game.commands,
      proof: game.proof,
      agentEvidence: createAgentPlayedGameEvidence({
        gameId,
        gameInput: game.input,
        commands: game.commands,
        proof: game.proof,
        possessionProofs: [
          {
            possessionId,
            ...proof,
            eventMerkleRoot: source.eventMerkleRoot,
            finalStateRoot: source.finalStateRoot,
          },
        ],
      }),
      filmCommitment: sha256Commitment("participant-film"),
      broadcastStartedAt: finalizedAt,
      broadcastIntervalMs: 0,
    });
    const finalEvent = createCanonicalEvent({
      eventId: "0198f300-0000-7000-8000-000000000033",
      actorDid: participantDid,
      nonce: "participant-finalization-1",
      idempotencyKey: "0198f300-0000-7000-8000-000000000034",
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
    const store = new InMemoryCanonicalStore();
    const app = createLiveCoreApi({
      store,
      domain,
      admittedAgents: new Map([
        [
          participantDid,
          {
            signerAddress: participant.address,
            allowedAggregateTypes: [
              "game-possession",
              FINALIZED_GAME_AGGREGATE_TYPE,
            ],
          },
        ],
      ]),
      competitionId: "season-zero",
      seasonId: "pre-genesis",
      now: () => Date.parse(finalizedAt),
      finalizedGames: {
        finalizerDids: new Set(),
        evidence: { finalizedGameEvidence: async () => null },
      },
    });
    const possessionResponse = await app.inject({
      method: "POST",
      url: "/v1/commands",
      payload: {
        event: { ...possession, aggregateVersion: "1" },
        signatures: [await signCanonicalEvent(participant, domain, possession)],
      },
    });
    expect(possessionResponse.statusCode, possessionResponse.body).toBe(201);
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/commands",
      payload: {
        event: { ...finalEvent, aggregateVersion: "1" },
        signatures: [await signCanonicalEvent(participant, domain, finalEvent)],
      },
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(
      await store.pendingProjectionEvents(10, "public.finalized-game"),
    ).toHaveLength(1);
    await app.close();
  });
});

describe("core dynamic candidate authority", () => {
  it("accepts a provisioned founding role without a static admitted-agent entry", async () => {
    const candidateDid = "did:abl:dynamic-founding-player";
    const candidate = createSigningIdentity(`0x${"c".repeat(64)}`);
    const event = await possessionEvent(candidateDid);
    const careerAuthority = {
      applicationId: "0198e000-0000-7000-8000-000000000021",
      candidateDid,
      roleClass: "PLAYER" as const,
      capacityDecisionCommitment: `0x${"1".repeat(64)}` as const,
      opportunityResponseCommitment: `0x${"2".repeat(64)}` as const,
      signingAddress: candidate.address,
      signingPublicKey: candidate.publicKey,
      runtimeDigest: `0x${"3".repeat(64)}`,
      toolDigests: [],
      guardianDids: [],
      admissionEventHash: `0x${"4".repeat(64)}` as const,
      admittedAt: finalizedAt,
      careerRecordCommitment: `0x${"5".repeat(64)}` as const,
      keyLineageCommitment: `0x${"6".repeat(64)}` as const,
      consentHistoryCommitment: `0x${"7".repeat(64)}` as const,
      state: "ADMITTED" as const,
    };
    const app = createLiveCoreApi({
      store: new InMemoryCanonicalStore(),
      domain,
      admittedAgents: new Map(),
      competitionId: "season-zero",
      seasonId: "pre-genesis",
      now: () => Date.parse(finalizedAt),
      candidateCareerAuthorityReader: async () => careerAuthority,
      careerOperationalVerifier: {
        resolveOperational: async (binding) => ({
          operational: true,
          ...binding,
          sandboxResourceName: "abl-career-0198e000000070008000000000000021",
        }),
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/commands",
      payload: {
        event: { ...event, aggregateVersion: "1" },
        signatures: [await signCanonicalEvent(candidate, domain, event)],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      accepted: true,
      canonical: true,
      rehearsal: true,
    });
    await app.close();

    const denied = createLiveCoreApi({
      store: new InMemoryCanonicalStore(),
      domain,
      admittedAgents: new Map(),
      competitionId: "season-zero",
      seasonId: "pre-genesis",
      now: () => Date.parse(finalizedAt),
      candidateCareerAuthorityReader: async () => ({
        ...careerAuthority,
        roleClass: "MEDIA" as const,
      }),
      careerOperationalVerifier: {
        resolveOperational: async (binding) => ({
          operational: true,
          ...binding,
          sandboxResourceName: "abl-career-0198e000000070008000000000000021",
        }),
      },
    });
    expect(
      (
        await denied.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            event: { ...event, aggregateVersion: "1" },
            signatures: [await signCanonicalEvent(candidate, domain, event)],
          },
        })
      ).statusCode,
    ).toBe(403);
    await denied.close();

    const revoked = createLiveCoreApi({
      store: new InMemoryCanonicalStore(),
      domain,
      admittedAgents: new Map([
        [
          candidateDid,
          {
            signerAddress: candidate.address,
            allowedAggregateTypes: ["game-possession"],
          },
        ],
      ]),
      competitionId: "season-zero",
      seasonId: "pre-genesis",
      now: () => Date.parse(finalizedAt),
      candidateCareerAuthorityReader: async () => {
        throw new CandidateNotAdmittedError("Candidate career is revoked");
      },
    });
    expect(
      (
        await revoked.inject({
          method: "POST",
          url: "/v1/commands",
          payload: {
            event: { ...event, aggregateVersion: "1" },
            signatures: [await signCanonicalEvent(candidate, domain, event)],
          },
        })
      ).statusCode,
    ).toBe(403);
    await revoked.close();
  });
});
