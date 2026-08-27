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
  type FullGameSnapshot,
  type FullGameState,
  type GameCommand,
} from "./full-game.js";
import { TeamSchema } from "./types.js";

export const FINALIZED_GAME_AGGREGATE_TYPE = "finalized-game";
export const GAME_FINALIZED_EVENT_TYPE = "GameFinalized";
export const CAREER_GAME_FINALIZATION_PROPOSAL_AGGREGATE_TYPE =
  "career-game-finalization-proposal";
export const CAREER_GAME_FINALIZATION_PROPOSAL_EVENT_TYPE =
  "CareerGameFinalizationProposed";

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
  authorityEvidence: z
    .strictObject({
      participants: z.strictObject({
        players: z.array(DidSchema).min(10).max(16),
        coaches: z.array(DidSchema).length(2),
        referees: z.array(DidSchema).min(3).max(6),
        replayOfficials: z.array(DidSchema).length(2),
      }),
      decisionRoots: z.strictObject({
        players: Sha256Schema,
        coaches: Sha256Schema,
        referees: Sha256Schema,
        replayOfficials: Sha256Schema,
      }),
    })
    .superRefine(({ participants }, context) => {
      const roleDids = Object.values(participants).flat();
      if (new Set(roleDids).size !== roleDids.length)
        context.addIssue({
          code: "custom",
          message: "Founding exhibition role careers must be distinct",
        });
      for (const [role, dids] of Object.entries(participants)) {
        if (new Set(dids).size !== dids.length)
          context.addIssue({
            code: "custom",
            path: [role],
            message: "Founding exhibition role careers must be distinct",
          });
        if (dids.join("\u0000") !== [...dids].sort().join("\u0000"))
          context.addIssue({
            code: "custom",
            path: [role],
            message: "Founding exhibition role careers must be sorted",
          });
      }
    })
    .optional(),
  possessionProofRoot: Sha256Schema,
  gameProofCommitment: Sha256Schema,
  evidenceCommitment: Sha256Schema,
});

const AgentPlayedPossessionAuthorityDidsSchema = z.strictObject({
  players: z.array(DidSchema).length(20),
  coaches: z.array(DidSchema).length(4),
  referees: z.array(DidSchema).length(3),
  replayOfficials: z.array(DidSchema).length(2),
});

export type AgentPlayedPossessionAuthorityDids = z.infer<
  typeof AgentPlayedPossessionAuthorityDidsSchema
>;

export const AgentPlayedPossessionEvidenceSchema = z.strictObject({
  possessionId: z.string().min(1).max(100),
  playerDecisionHashes: z.array(Sha256Schema).length(20),
  coachDecisionHashes: z.array(Sha256Schema).length(4),
  refereeDecisionHashes: z.array(Sha256Schema).length(3),
  replayDecisionHashes: z.array(Sha256Schema).length(2),
  authorityDids: AgentPlayedPossessionAuthorityDidsSchema.optional(),
  eventMerkleRoot: Sha256Schema,
  finalStateRoot: Sha256Schema,
});

export const FinalizedGameProofSchema = z.strictObject({
  finalStateRoot: Sha256Schema,
  eventMerkleRoot: Sha256Schema,
  finalEventHash: Sha256Schema,
  winner: TeamSchema,
});

export const FinalizedGameScheduleEvidenceSchema = z.strictObject({
  gameId: UuidV7Schema,
  competitionId: z.string().min(1).max(160),
  seasonId: z.string().min(1).max(160),
  tier: z.enum(["PREMIER", "DEVELOPMENT"]),
  scheduleId: z.string().min(1).max(320),
  scheduleVersion: z.number().int().positive(),
  clubIds: z.array(z.string().min(1).max(160)).length(4),
  homeClubId: z.string().min(1).max(160),
  awayClubId: z.string().min(1).max(160),
  scheduledAt: IsoDateTimeSchema,
  scheduleEventHash: Sha256Schema,
  scheduleStateRoot: Sha256Schema,
  evidenceCommitment: Sha256Schema,
});

export type FinalizedGameScheduleEvidence = z.infer<
  typeof FinalizedGameScheduleEvidenceSchema
>;

export interface FinalizedGameScheduleEvidenceReader {
  finalizedGameScheduleEvidence(
    gameId: string,
  ): Promise<FinalizedGameScheduleEvidence | null>;
}

function scheduleEvidenceBody(evidence: FinalizedGameScheduleEvidence) {
  const { evidenceCommitment: _evidenceCommitment, ...body } = evidence;
  return body;
}

function hasValidScheduleClubs(
  evidence: Pick<
    FinalizedGameScheduleEvidence,
    "clubIds" | "homeClubId" | "awayClubId"
  >,
): boolean {
  return (
    evidence.homeClubId !== evidence.awayClubId &&
    new Set(evidence.clubIds).size === 4 &&
    [...evidence.clubIds].sort().join("\u0000") ===
      evidence.clubIds.join("\u0000") &&
    evidence.clubIds.includes(evidence.homeClubId) &&
    evidence.clubIds.includes(evidence.awayClubId)
  );
}

export function finalizedGameScheduleEvidenceCommitment(
  evidence: Omit<FinalizedGameScheduleEvidence, "evidenceCommitment">,
): Hex {
  return sha256Commitment({
    format: "ABL-FINALIZED-GAME-SCHEDULE-EVIDENCE-V1",
    ...evidence,
  });
}

export function createFinalizedGameScheduleEvidence(
  evidence: Omit<FinalizedGameScheduleEvidence, "evidenceCommitment">,
): FinalizedGameScheduleEvidence {
  if (!hasValidScheduleClubs(evidence))
    throw new Error("Scheduled game evidence clubs are invalid");
  return FinalizedGameScheduleEvidenceSchema.parse({
    ...evidence,
    evidenceCommitment: finalizedGameScheduleEvidenceCommitment(evidence),
  });
}

export const FinalizedGameScheduleEvidenceRegistrySchema = z
  .array(FinalizedGameScheduleEvidenceSchema)
  .max(1_000)
  .refine(
    (entries) =>
      new Set(entries.map(({ gameId }) => gameId)).size === entries.length,
    "Finalized game schedule evidence IDs must be unique",
  );

export function createFinalizedGameScheduleEvidenceReader(
  input: unknown,
): FinalizedGameScheduleEvidenceReader {
  const entries = FinalizedGameScheduleEvidenceRegistrySchema.parse(input);
  const scheduleCommitments = new Map<string, Hex>();
  for (const entry of entries) {
    const scheduleKey = [entry.competitionId, entry.seasonId, entry.tier].join(
      "\u0000",
    );
    const scheduleCommitment = sha256Commitment({
      scheduleId: entry.scheduleId,
      scheduleVersion: entry.scheduleVersion,
      clubIds: entry.clubIds,
      scheduleEventHash: entry.scheduleEventHash,
      scheduleStateRoot: entry.scheduleStateRoot,
    });
    const priorScheduleCommitment = scheduleCommitments.get(scheduleKey);
    if (
      !hasValidScheduleClubs(entry) ||
      (priorScheduleCommitment !== undefined &&
        priorScheduleCommitment !== scheduleCommitment) ||
      finalizedGameScheduleEvidenceCommitment(scheduleEvidenceBody(entry)) !==
        entry.evidenceCommitment
    ) {
      throw new Error("Finalized game schedule evidence is invalid");
    }
    scheduleCommitments.set(scheduleKey, scheduleCommitment);
  }
  const evidenceByGame = new Map(
    entries.map((entry) => [entry.gameId, structuredClone(entry)]),
  );
  return {
    finalizedGameScheduleEvidence: async (gameId) =>
      structuredClone(evidenceByGame.get(gameId) ?? null),
  };
}

export const FinalizedGamePayloadSchema = z.strictObject({
  gameId: UuidV7Schema,
  finalizedAt: IsoDateTimeSchema,
  competition: FinalizedGameScheduleEvidenceSchema.nullable().default(null),
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

export const CareerGameFinalizationProposalPayloadSchema = z.strictObject({
  finalizedGame: FinalizedGamePayloadSchema,
  recordedAt: IsoDateTimeSchema,
});

export const CAREER_GAME_FINALIZATION_PROPOSAL_SCHEMA_DIGEST = sha256Commitment(
  {
    protocol: "abl-career-game-finalization-proposal",
    version: 1,
    aggregateType: CAREER_GAME_FINALIZATION_PROPOSAL_AGGREGATE_TYPE,
    eventType: CAREER_GAME_FINALIZATION_PROPOSAL_EVENT_TYPE,
  },
);

export interface FinalizedGameEvidenceReader {
  finalizedGameEvidence(
    gameId: string,
  ): Promise<AgentPlayedGameEvidence | null>;
}

export interface FinalizedGamePossessionEvidenceReader {
  finalizedGamePossessionEvidence(
    gameId: string,
  ): Promise<readonly AgentPlayedPossessionEvidence[] | null>;
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

export type AgentPlayedPossessionEvidence = z.infer<
  typeof AgentPlayedPossessionEvidenceSchema
>;

function requiredAuthorityDids(
  proof: AgentPlayedPossessionEvidence,
): AgentPlayedPossessionAuthorityDids {
  if (proof.authorityDids === undefined)
    throw new Error(
      "Agent-played authority evidence must cover every possession",
    );
  return proof.authorityDids;
}

function createRoleAuthorityEvidence(
  proofs: readonly AgentPlayedPossessionEvidence[],
) {
  const entries = {
    players: proofs.flatMap((proof) => {
      const dids = requiredAuthorityDids(proof).players;
      return proof.playerDecisionHashes.map((eventHash, index) => ({
        actorDid: dids[index]!,
        eventHash,
      }));
    }),
    coaches: proofs.flatMap((proof) => {
      const dids = requiredAuthorityDids(proof).coaches;
      return proof.coachDecisionHashes.map((eventHash, index) => ({
        actorDid: dids[index]!,
        eventHash,
      }));
    }),
    referees: proofs.flatMap((proof) => {
      const dids = requiredAuthorityDids(proof).referees;
      return proof.refereeDecisionHashes.map((eventHash, index) => ({
        actorDid: dids[index]!,
        eventHash,
      }));
    }),
    replayOfficials: proofs.flatMap((proof) => {
      const dids = requiredAuthorityDids(proof).replayOfficials;
      return proof.replayDecisionHashes.map((eventHash, index) => ({
        actorDid: dids[index]!,
        eventHash,
      }));
    }),
  };
  return {
    participants: Object.fromEntries(
      Object.entries(entries).map(([role, decisions]) => [
        role,
        [...new Set(decisions.map(({ actorDid }) => actorDid))].sort(),
      ]),
    ),
    decisionRoots: Object.fromEntries(
      Object.entries(entries).map(([role, decisions]) => [
        role,
        merkleRoot(decisions.map((decision) => sha256Commitment(decision))),
      ]),
    ),
  };
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
  proof: FinalizedGamePayload["proof"] | ReturnType<FullGameEngine["proof"]>;
  possessionProofs: readonly (
    | AgentPlayedPossessionEvidence
    | {
        possessionId: string;
        playerDecisionHashes: readonly Hex[];
        coachDecisionHashes: readonly Hex[];
        refereeDecisionHashes: readonly Hex[];
        replayDecisionHashes: readonly Hex[];
        authorityDids?: AgentPlayedPossessionAuthorityDids;
        eventMerkleRoot: Hex;
        finalStateRoot: Hex;
      }
  )[];
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
  const authorityProofCount = possessionProofs.filter(
    ({ authorityDids }) => authorityDids !== undefined,
  ).length;
  if (
    authorityProofCount !== 0 &&
    authorityProofCount !== possessionProofs.length
  ) {
    throw new Error(
      "Agent-played authority evidence must cover every possession",
    );
  }
  const authorityEvidence =
    authorityProofCount === 0
      ? undefined
      : createRoleAuthorityEvidence(possessionProofs);
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
    ...(authorityEvidence === undefined ? {} : { authorityEvidence }),
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
  snapshots: readonly FullGameSnapshot[];
  state: FullGameState;
} {
  const payload = FinalizedGamePayloadSchema.parse(input);
  if (Date.parse(payload.broadcastStartedAt) > Date.parse(payload.finalizedAt))
    throw new Error("Finalized game broadcast cannot start after finalization");
  if (
    payload.gameId !== payload.input.gameId ||
    payload.gameId !== payload.agentEvidence.gameId ||
    (payload.competition !== null &&
      (payload.competition.gameId !== payload.gameId ||
        !hasValidScheduleClubs(payload.competition) ||
        finalizedGameScheduleEvidenceCommitment(
          scheduleEvidenceBody(payload.competition),
        ) !== payload.competition.evidenceCommitment ||
        Date.parse(payload.competition.scheduledAt) >
          Date.parse(payload.finalizedAt))) ||
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
  return {
    payload,
    events: replay.events,
    snapshots: replay.snapshots,
    state: replay.state,
  };
}

export function replayRoleCompleteFoundingExhibition(input: unknown): {
  payload: FinalizedGamePayload;
  events: readonly FullGameEvent[];
  state: FullGameState;
  authorityEvidence: NonNullable<AgentPlayedGameEvidence["authorityEvidence"]>;
} {
  const replay = replayFinalizedGamePayload(input);
  const authorityEvidence = replay.payload.agentEvidence.authorityEvidence;
  if (authorityEvidence === undefined)
    throw new Error(
      "Founding exhibition lacks role-complete authority evidence",
    );
  return { ...replay, authorityEvidence };
}

export function isRoleCompleteFoundingExhibitionFinalizer(
  payload: FinalizedGamePayload,
  actorDid: string,
): boolean {
  return (
    payload.competition === null &&
    payload.agentEvidence.authorityEvidence?.participants.players.includes(
      actorDid,
    ) === true
  );
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

export async function requireFinalizedGamePossessionEvidence(
  payload: FinalizedGamePayload,
  reader: FinalizedGamePossessionEvidenceReader | undefined,
): Promise<void> {
  const possessionProofs =
    reader === undefined
      ? null
      : await reader.finalizedGamePossessionEvidence(payload.gameId);
  if (possessionProofs === null)
    throw new Error("Finalized game lacks canonical possession evidence");
  const expected = createAgentPlayedGameEvidence({
    gameId: payload.gameId,
    gameInput: payload.input,
    commands: payload.commands,
    proof: payload.proof,
    possessionProofs,
  });
  if (sha256Commitment(expected) !== sha256Commitment(payload.agentEvidence))
    throw new Error(
      "Finalized game evidence does not match canonical possessions",
    );
}

export async function requireFinalizedGameScheduleEvidence(
  payload: FinalizedGamePayload,
  reader: FinalizedGameScheduleEvidenceReader | undefined,
): Promise<void> {
  if (payload.competition === null) return;
  const registered =
    reader === undefined
      ? null
      : await reader.finalizedGameScheduleEvidence(payload.gameId);
  if (
    registered === null ||
    sha256Commitment(registered) !== sha256Commitment(payload.competition)
  ) {
    throw new Error(
      "Finalized league game lacks independently registered schedule evidence",
    );
  }
}

export const FINALIZED_GAME_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-finalized-agent-game",
  version: 2,
  aggregateType: FINALIZED_GAME_AGGREGATE_TYPE,
  eventType: GAME_FINALIZED_EVENT_TYPE,
  exactReplayRequired: true,
  modelInferenceOnReplay: false,
  standingsAuthority: "INDEPENDENT_SCHEDULE_EVIDENCE",
});

export function finalizedGameStateRoot(payload: FinalizedGamePayload): Hex {
  return sha256Commitment({
    format: "ABL-FINALIZED-GAME-STATE-V2",
    gameId: payload.gameId,
    finalizedAt: payload.finalizedAt,
    competition: payload.competition,
    proof: payload.proof,
    agentEvidence: payload.agentEvidence,
    filmCommitment: payload.filmCommitment,
  });
}
