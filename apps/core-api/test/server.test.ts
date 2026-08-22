import {
  FINALIZED_GAME_AGGREGATE_TYPE,
  FINALIZED_GAME_SCHEMA_DIGEST,
  GAME_FINALIZED_EVENT_TYPE,
  FinalizedGamePayloadSchema,
  createAgentPlayedGameEvidence,
  finalizedGameStateRoot,
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
});
