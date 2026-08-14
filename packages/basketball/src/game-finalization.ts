import { merkleRoot, sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import {
  FullGameEngine,
  replayFullGame,
  type FullGameEvent,
  type FullGameInput,
  type FullGameState,
  type GameCommand,
} from "./full-game.js";
import { TeamSchema } from "./types.js";

export const FINALIZED_GAME_AGGREGATE_TYPE = "finalized-game";
export const GAME_FINALIZED_EVENT_TYPE = "GameFinalized";

export const FinalizedGameAuthorityDidsSchema = z
  .array(DidSchema)
  .min(1)
  .max(256)
  .refine((dids) => new Set(dids).size === dids.length);

export function assertFinalizedGameAuthorityConfiguration(
  admittedAgents: ReadonlyMap<
    string,
    { allowedAggregateTypes: readonly string[] }
  >,
  finalizerDids: ReadonlySet<string>,
): void {
  for (const did of finalizerDids) {
    if (
      !admittedAgents
        .get(did)
        ?.allowedAggregateTypes.includes(FINALIZED_GAME_AGGREGATE_TYPE)
    ) {
      throw new Error(
        "Every finalized-game authority must be admitted with finalized-game scope",
      );
    }
  }
}

const PlayerIdSchema = z.string().min(1).max(100);
const TeamCommandSchema = z.strictObject({ team: TeamSchema });

export const FullGameInputSchema = z.strictObject({
  gameId: UuidV7Schema,
  roster: z.strictObject({
    home: z.array(PlayerIdSchema).min(5).max(20),
    away: z.array(PlayerIdSchema).min(5).max(20),
  }),
  active: z.strictObject({
    home: z.array(PlayerIdSchema).length(5),
    away: z.array(PlayerIdSchema).length(5),
  }),
  openingPossession: TeamSchema,
});

export const GameCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("TICK"),
    milliseconds: z.number().int().positive().max(720_000),
  }),
  TeamCommandSchema.extend({
    type: z.literal("SHOT"),
    playerId: PlayerIdSchema,
    points: z.union([z.literal(2), z.literal(3)]),
    made: z.boolean(),
  }),
  TeamCommandSchema.extend({
    type: z.literal("REBOUND"),
    playerId: PlayerIdSchema,
  }),
  TeamCommandSchema.extend({
    type: z.literal("FREE_THROW"),
    playerId: PlayerIdSchema,
    made: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("FOUL"),
    byTeam: TeamSchema,
    playerId: PlayerIdSchema,
    kind: z.enum(["PERSONAL", "SHOOTING", "TECHNICAL", "FLAGRANT_2"]),
    freeThrows: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
  }),
  TeamCommandSchema.extend({
    type: z.literal("VIOLATION"),
    playerId: PlayerIdSchema.nullable(),
    kind: z.enum([
      "TRAVEL",
      "DOUBLE_DRIBBLE",
      "SHOT_CLOCK",
      "BACKCOURT",
      "THREE_SECONDS",
    ]),
  }),
  z.strictObject({
    type: z.literal("OUT_OF_BOUNDS"),
    lastTouchedBy: TeamSchema,
  }),
  TeamCommandSchema.extend({
    type: z.literal("THROW_IN"),
    playerId: PlayerIdSchema,
  }),
  z.strictObject({ type: z.literal("HELD_BALL") }),
  z.strictObject({
    type: z.literal("JUMP_BALL"),
    winningTeam: TeamSchema,
  }),
  z.strictObject({
    type: z.literal("GOALTENDING"),
    byTeam: TeamSchema,
    awardedTeam: TeamSchema,
    points: z.union([z.literal(2), z.literal(3)]),
  }),
  TeamCommandSchema.extend({
    type: z.literal("SUBSTITUTE"),
    outPlayerId: PlayerIdSchema,
    inPlayerId: PlayerIdSchema,
  }),
  TeamCommandSchema.extend({ type: z.literal("TIMEOUT") }),
  TeamCommandSchema.extend({
    type: z.literal("INJURY"),
    playerId: PlayerIdSchema,
  }),
  TeamCommandSchema.extend({
    type: z.literal("CHALLENGE"),
    targetEventSequence: z.number().int().nonnegative().max(20_000),
  }),
  z.strictObject({
    type: z.literal("REPLAY_RULING"),
    targetEventSequence: z.number().int().nonnegative().max(20_000),
    ruling: z.enum(["CONFIRM", "REVERSE"]),
  }),
  TeamCommandSchema.extend({
    type: z.literal("PROTEST"),
    reasonCode: z.string().min(1).max(100),
    eventSequence: z.number().int().nonnegative().max(20_000),
  }),
  z.strictObject({ type: z.literal("RESUME") }),
  z.strictObject({ type: z.literal("END_PERIOD") }),
]);

export const AgentPlayedGameEvidenceSchema = z.strictObject({
  gameId: UuidV7Schema,
  possessionCount: z.number().int().positive().max(1_000),
  decisionCounts: z.strictObject({
    players: z.number().int().positive().max(100_000),
    coaches: z.number().int().positive().max(100_000),
    referees: z.number().int().positive().max(100_000),
    replayOfficials: z.number().int().positive().max(100_000),
  }),
  decisionRoots: z.strictObject({
    players: Sha256Schema,
    coaches: Sha256Schema,
    referees: Sha256Schema,
    replayOfficials: Sha256Schema,
  }),
  possessionProofRoot: Sha256Schema,
  gameProofCommitment: Sha256Schema,
  evidenceCommitment: Sha256Schema,
});

const AgentPlayedPossessionEvidenceSchema = z.strictObject({
  possessionId: z.string().min(1).max(100),
  playerDecisionHashes: z.array(Sha256Schema).length(20),
  coachDecisionHashes: z.array(Sha256Schema).length(4),
  refereeDecisionHashes: z.array(Sha256Schema).length(3),
  replayDecisionHashes: z.array(Sha256Schema).length(2),
  eventMerkleRoot: Sha256Schema,
  finalStateRoot: Sha256Schema,
});

export const FinalizedGameProofSchema = z.strictObject({
  finalStateRoot: Sha256Schema,
  eventMerkleRoot: Sha256Schema,
  finalEventHash: Sha256Schema,
  winner: TeamSchema,
});

export const FinalizedGamePayloadSchema = z.strictObject({
  gameId: UuidV7Schema,
  finalizedAt: IsoDateTimeSchema,
  input: FullGameInputSchema,
  commands: z.array(GameCommandSchema).min(1).max(10_000),
  proof: FinalizedGameProofSchema,
  agentEvidence: AgentPlayedGameEvidenceSchema,
  filmCommitment: Sha256Schema,
  broadcastStartedAt: IsoDateTimeSchema,
  broadcastIntervalMs: z.number().int().nonnegative().max(60_000),
});

export type AgentPlayedGameEvidence = z.infer<
  typeof AgentPlayedGameEvidenceSchema
>;
export type FinalizedGamePayload = z.infer<typeof FinalizedGamePayloadSchema>;

export interface FinalizedGameEvidenceReader {
  finalizedGameEvidence(
    gameId: string,
  ): Promise<AgentPlayedGameEvidence | null>;
}

export const FinalizedGameEvidenceRegistrySchema = z
  .array(AgentPlayedGameEvidenceSchema)
  .max(1_000)
  .refine(
    (entries) =>
      new Set(entries.map(({ gameId }) => gameId)).size === entries.length,
    "Finalized game evidence IDs must be unique",
  );

function evidenceBody(evidence: AgentPlayedGameEvidence) {
  const { evidenceCommitment: _evidenceCommitment, ...body } = evidence;
  return body;
}

export function createFinalizedGameEvidenceReader(
  input: unknown,
): FinalizedGameEvidenceReader {
  const entries = FinalizedGameEvidenceRegistrySchema.parse(input);
  for (const entry of entries) {
    if (sha256Commitment(evidenceBody(entry)) !== entry.evidenceCommitment)
      throw new Error("Finalized game evidence commitment is invalid");
  }
  const evidenceByGame = new Map(
    entries.map((entry) => [entry.gameId, structuredClone(entry)]),
  );
  return {
    finalizedGameEvidence: async (gameId) =>
      structuredClone(evidenceByGame.get(gameId) ?? null),
  };
}

export function createAgentPlayedGameEvidence(input: {
  gameId: string;
  gameInput: FullGameInput;
  commands: readonly GameCommand[];
  proof: ReturnType<FullGameEngine["proof"]>;
  possessionProofs: readonly {
    possessionId: string;
    playerDecisionHashes: readonly Hex[];
    coachDecisionHashes: readonly Hex[];
    refereeDecisionHashes: readonly Hex[];
    replayDecisionHashes: readonly Hex[];
    eventMerkleRoot: Hex;
    finalStateRoot: Hex;
  }[];
}): AgentPlayedGameEvidence {
  const possessionProofs = z
    .array(AgentPlayedPossessionEvidenceSchema)
    .min(1)
    .max(1_000)
    .refine(
      (proofs) =>
        new Set(proofs.map(({ possessionId }) => possessionId)).size ===
        proofs.length,
      "Agent-played possession evidence IDs must be unique",
    )
    .parse(input.possessionProofs);
  const decisionHashes = {
    players: possessionProofs.flatMap(
      ({ playerDecisionHashes }) => playerDecisionHashes,
    ),
    coaches: possessionProofs.flatMap(
      ({ coachDecisionHashes }) => coachDecisionHashes,
    ),
    referees: possessionProofs.flatMap(
      ({ refereeDecisionHashes }) => refereeDecisionHashes,
    ),
    replayOfficials: possessionProofs.flatMap(
      ({ replayDecisionHashes }) => replayDecisionHashes,
    ),
  };
  if (
    Object.values(decisionHashes).some(
      (hashes) => new Set(hashes).size !== hashes.length,
    )
  ) {
    throw new Error("Agent-played decision evidence hashes must be unique");
  }
  const body = {
    gameId: UuidV7Schema.parse(input.gameId),
    possessionCount: possessionProofs.length,
    decisionCounts: {
      players: decisionHashes.players.length,
      coaches: decisionHashes.coaches.length,
      referees: decisionHashes.referees.length,
      replayOfficials: decisionHashes.replayOfficials.length,
    },
    decisionRoots: {
      players: merkleRoot(decisionHashes.players as Hex[]),
      coaches: merkleRoot(decisionHashes.coaches as Hex[]),
      referees: merkleRoot(decisionHashes.referees as Hex[]),
      replayOfficials: merkleRoot(decisionHashes.replayOfficials as Hex[]),
    },
    possessionProofRoot: merkleRoot(
      possessionProofs.map((proof) => sha256Commitment(proof)),
    ),
    gameProofCommitment: sha256Commitment({
      input: input.gameInput,
      commands: input.commands,
      proof: input.proof,
    }),
  };
  return AgentPlayedGameEvidenceSchema.parse({
    ...body,
    evidenceCommitment: sha256Commitment(body),
  });
}

export function replayFinalizedGamePayload(input: unknown): {
  payload: FinalizedGamePayload;
  events: readonly FullGameEvent[];
  state: FullGameState;
} {
  const payload = FinalizedGamePayloadSchema.parse(input);
  if (Date.parse(payload.broadcastStartedAt) > Date.parse(payload.finalizedAt))
    throw new Error("Finalized game broadcast cannot start after finalization");
  if (
    payload.gameId !== payload.input.gameId ||
    payload.gameId !== payload.agentEvidence.gameId ||
    payload.agentEvidence.decisionCounts.players !==
      payload.agentEvidence.possessionCount * 20 ||
    payload.agentEvidence.decisionCounts.coaches !==
      payload.agentEvidence.possessionCount * 4 ||
    payload.agentEvidence.decisionCounts.referees !==
      payload.agentEvidence.possessionCount * 3 ||
    payload.agentEvidence.decisionCounts.replayOfficials !==
      payload.agentEvidence.possessionCount * 2 ||
    sha256Commitment(evidenceBody(payload.agentEvidence)) !==
      payload.agentEvidence.evidenceCommitment ||
    sha256Commitment({
      input: payload.input,
      commands: payload.commands,
      proof: payload.proof,
    }) !== payload.agentEvidence.gameProofCommitment
  ) {
    throw new Error("Finalized game evidence is internally inconsistent");
  }
  const replay = replayFullGame(
    payload.input as FullGameInput,
    payload.commands as GameCommand[],
    payload.proof as ReturnType<FullGameEngine["proof"]>,
  );
  if (
    replay.state.phase !== "FINAL" ||
    !replay.exact ||
    replay.inferenceInvocations !== 0
  ) {
    throw new Error("Finalized game does not replay exactly to a final state");
  }
  return { payload, events: replay.events, state: replay.state };
}

export async function requireFinalizedGameEvidence(
  payload: FinalizedGamePayload,
  reader: FinalizedGameEvidenceReader,
): Promise<void> {
  const registered = await reader.finalizedGameEvidence(payload.gameId);
  if (
    registered === null ||
    sha256Commitment(registered) !== sha256Commitment(payload.agentEvidence)
  ) {
    throw new Error("Finalized game lacks independently registered evidence");
  }
}

export const FINALIZED_GAME_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-finalized-agent-game",
  version: 1,
  aggregateType: FINALIZED_GAME_AGGREGATE_TYPE,
  eventType: GAME_FINALIZED_EVENT_TYPE,
  exactReplayRequired: true,
  modelInferenceOnReplay: false,
});

export function finalizedGameStateRoot(payload: FinalizedGamePayload): Hex {
  return sha256Commitment({
    format: "ABL-FINALIZED-GAME-STATE-V1",
    gameId: payload.gameId,
    finalizedAt: payload.finalizedAt,
    proof: payload.proof,
    agentEvidence: payload.agentEvidence,
    filmCommitment: payload.filmCommitment,
  });
}
