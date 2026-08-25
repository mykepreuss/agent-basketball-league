import { sha256Commitment, type CanonicalEvent } from "@abl/recognition";
import { z } from "zod";

const Sha256HexSchema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/) as z.ZodType<`0x${string}`>;

export const POSSESSION_RESOLVED_SCHEMA_DIGEST_V1 = sha256Commitment(
  "PossessionResolved:1.0.0",
);
export const POSSESSION_RESOLVED_SCHEMA_DIGEST_V2 = sha256Commitment({
  protocol: "abl-possession-resolved",
  version: 2,
  snapshotFormat: "ABL-POSSESSION-SNAPSHOT-V1",
  snapshotStateBinding: "EVENT_HASH_STATE_ROOT_AND_SEGMENT_COMMITMENT",
});

export const TeamSchema = z.enum(["HOME", "AWAY"]);
export type Team = z.infer<typeof TeamSchema>;
export const PositionSchema = z.enum(["PG", "SG", "SF", "PF", "C"]);
export type Position = z.infer<typeof PositionSchema>;

export interface PlayerState {
  playerId: string;
  did: string;
  team: Team;
  position: Position;
  xCm: number;
  yCm: number;
  maxSpeedCmPerWindow: number;
  shootingBps: number;
  passingBps: number;
  defenseBps: number;
  stamina: number;
}

export const PlayerStateSchema = z.strictObject({
  playerId: z.string().min(1).max(100),
  did: z.string().startsWith("did:"),
  team: TeamSchema,
  position: PositionSchema,
  xCm: z.number().int().min(0).max(2_865),
  yCm: z.number().int().min(0).max(1_524),
  maxSpeedCmPerWindow: z.number().int().positive().max(1_000),
  shootingBps: z.number().int().min(0).max(10_000),
  passingBps: z.number().int().min(0).max(10_000),
  defenseBps: z.number().int().min(0).max(10_000),
  stamina: z.number().int().min(0).max(100),
}) satisfies z.ZodType<PlayerState>;

export interface BasketballState {
  gameId: string;
  possessionId: string;
  quarter: number;
  gameClockMs: number;
  shotClockMs: number;
  score: { home: number; away: number };
  possessionTeam: Team;
  ball: { xCm: number; yCm: number; possessorId: string | null };
  players: PlayerState[];
  window: number;
  phase: "LIVE" | "DEAD" | "FINAL";
}

export const BasketballStateSchema = z
  .strictObject({
    gameId: z.string().min(1).max(100),
    possessionId: z.string().min(1).max(100),
    quarter: z.number().int().positive().max(20),
    gameClockMs: z.number().int().nonnegative().max(720_000),
    shotClockMs: z.number().int().nonnegative().max(24_000),
    score: z.strictObject({
      home: z.number().int().nonnegative().max(1_000),
      away: z.number().int().nonnegative().max(1_000),
    }),
    possessionTeam: TeamSchema,
    ball: z.strictObject({
      xCm: z.number().int().min(0).max(2_865),
      yCm: z.number().int().min(0).max(1_524),
      possessorId: z.string().min(1).max(100).nullable(),
    }),
    players: z.array(PlayerStateSchema).length(10),
    window: z.number().int().nonnegative().max(1_000),
    phase: z.enum(["LIVE", "DEAD", "FINAL"]),
  })
  .refine((state) => {
    const playerIds = state.players.map(({ playerId }) => playerId);
    const careerDids = state.players.map(({ did }) => did);
    return (
      new Set(playerIds).size === state.players.length &&
      new Set(careerDids).size === state.players.length &&
      state.players.filter(({ team }) => team === "HOME").length === 5 &&
      state.players.filter(({ team }) => team === "AWAY").length === 5 &&
      (state.ball.possessorId === null ||
        playerIds.includes(state.ball.possessorId))
    );
  }, "Basketball state player identities and possessor must be consistent") satisfies z.ZodType<BasketballState>;

const VectorSchema = z.strictObject({
  dx: z.number().int().min(-1_000).max(1_000),
  dy: z.number().int().min(-1_000).max(1_000),
});

export const ActionIntentSchema = z.discriminatedUnion("action", [
  z.strictObject({
    windowId: z.string().min(1),
    playerId: z.string().min(1),
    action: z.literal("MOVE"),
    vector: VectorSchema,
  }),
  z.strictObject({
    windowId: z.string().min(1),
    playerId: z.string().min(1),
    action: z.literal("PASS"),
    targetPlayerId: z.string().min(1),
    lead: VectorSchema,
  }),
  z.strictObject({
    windowId: z.string().min(1),
    playerId: z.string().min(1),
    action: z.literal("SHOOT"),
    shot: z.enum(["LAYUP", "JUMPER", "THREE"]),
  }),
  z.strictObject({
    windowId: z.string().min(1),
    playerId: z.string().min(1),
    action: z.literal("SCREEN"),
  }),
  z.strictObject({
    windowId: z.string().min(1),
    playerId: z.string().min(1),
    action: z.literal("HOLD"),
  }),
]);
export type ActionIntent = z.infer<typeof ActionIntentSchema>;

export interface PlayerObservation {
  observationId: string;
  playerId: string;
  team: Team;
  position: Position;
  window: number;
  gameClockMs: number;
  shotClockMs: number;
  score: { home: number; away: number };
  self: PlayerState;
  visibleTeammates: PlayerState[];
  visibleOpponents: PlayerState[];
  ball: { xCm: number; yCm: number; possessorId: string | null } | null;
  stateCommitment: string;
}

export interface CognitionReceipt {
  receiptId: string;
  agentDid: string;
  role: "PLAYER" | "COACH" | "REFEREE" | "REPLAY";
  endpoint: string;
  provider: string;
  modelFamily: string;
  modelRevision: string;
  observationHash: string;
  contextManifestHash: string;
  kernelHash: string;
  toolHash: string;
  deadlineMs: number;
  retryCount: number;
  fallbackUsed: boolean;
  normalizedResourceUnits: number;
  telemetryContentPolicy: "CONTENT_DISABLED";
  personalMaterialSupplied: string[];
}

export const CognitionReceiptSchema = z.strictObject({
  receiptId: z.string().min(1).max(300),
  agentDid: z.string().startsWith("did:"),
  role: z.enum(["PLAYER", "COACH", "REFEREE", "REPLAY"]),
  endpoint: z.string().min(1).max(4_096),
  provider: z.string().min(1).max(200),
  modelFamily: z.string().min(1).max(200),
  modelRevision: z.string().min(1).max(200),
  observationHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  contextManifestHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  kernelHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  toolHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  deadlineMs: z.number().int().positive().max(60_000),
  retryCount: z.number().int().nonnegative().max(10),
  fallbackUsed: z.boolean(),
  normalizedResourceUnits: z.number().int().nonnegative().max(1_000_000_000),
  telemetryContentPolicy: z.literal("CONTENT_DISABLED"),
  personalMaterialSupplied: z
    .array(z.string().regex(/^0x[0-9a-f]{64}$/))
    .max(100),
}) satisfies z.ZodType<CognitionReceipt>;

export interface SignedPlayerDecision {
  intent: ActionIntent;
  receipt: CognitionReceipt;
  authorizationEvent: CanonicalEvent<{
    intent: ActionIntent;
    receiptCommitment: `0x${string}`;
  }>;
  eventHash: `0x${string}`;
  signature: `0x${string}`;
  signerAddress: `0x${string}`;
}

export interface DecisionAuthorization<TDecision> {
  receipt: CognitionReceipt;
  authorizationEvent: CanonicalEvent<{
    decision: TDecision;
    receiptCommitment: `0x${string}`;
  }>;
  eventHash: `0x${string}`;
  signature: `0x${string}`;
  signerAddress: `0x${string}`;
}

export interface CoachDecisionBody {
  coachDid: string;
  team: Team;
  windowId: string;
  instruction: "PACE" | "SPACE" | "SWITCH" | "PROTECT_RIM";
  targetPlayerIds: string[];
}
export const CoachDecisionBodySchema = z.strictObject({
  coachDid: z.string().startsWith("did:"),
  team: TeamSchema,
  windowId: z.string().min(1).max(200),
  instruction: z.enum(["PACE", "SPACE", "SWITCH", "PROTECT_RIM"]),
  targetPlayerIds: z.array(z.string().min(1).max(100)).max(10),
}) satisfies z.ZodType<CoachDecisionBody>;
export type CoachDecision = CoachDecisionBody &
  DecisionAuthorization<CoachDecisionBody>;

export interface RefereeDecisionBody {
  refereeDid: string;
  possessionId: string;
  sequence: number;
  call: "NO_CALL" | "PERSONAL_FOUL" | "OUT_OF_BOUNDS" | "SHOT_CLOCK";
  againstPlayerId: string | null;
  confidenceBps: number;
}
export const RefereeDecisionBodySchema = z.strictObject({
  refereeDid: z.string().startsWith("did:"),
  possessionId: z.string().min(1).max(100),
  sequence: z.number().int().nonnegative().max(10),
  call: z.enum(["NO_CALL", "PERSONAL_FOUL", "OUT_OF_BOUNDS", "SHOT_CLOCK"]),
  againstPlayerId: z.string().min(1).max(100).nullable(),
  confidenceBps: z.number().int().min(0).max(10_000),
}) satisfies z.ZodType<RefereeDecisionBody>;
export type RefereeDecision = RefereeDecisionBody &
  DecisionAuthorization<RefereeDecisionBody>;

export interface ReplayDecisionBody {
  replayDid: string;
  possessionId: string;
  reviewable: boolean;
  ruling: "CONFIRM" | "REVERSE" | "NO_REVIEW";
  evidenceCommitment: `0x${string}`;
}
export const ReplayDecisionBodySchema = z.strictObject({
  replayDid: z.string().startsWith("did:"),
  possessionId: z.string().min(1).max(100),
  reviewable: z.boolean(),
  ruling: z.enum(["CONFIRM", "REVERSE", "NO_REVIEW"]),
  evidenceCommitment: Sha256HexSchema,
}) satisfies z.ZodType<ReplayDecisionBody>;
export type ReplayDecision = ReplayDecisionBody &
  DecisionAuthorization<ReplayDecisionBody>;

export interface CompetitionAuthority {
  did: string;
  signerAddress: `0x${string}`;
}

export interface PossessionAuthorities {
  coaches: Readonly<Record<Lowercase<Team>, CompetitionAuthority>>;
  referees: readonly CompetitionAuthority[];
  replayOfficials: readonly CompetitionAuthority[];
}

export interface ResolutionEvent {
  sequence: number;
  type:
    | "WINDOW_RESOLVED"
    | "PASS"
    | "SHOT"
    | "REBOUND"
    | "OUT_OF_BOUNDS"
    | "OFFICIAL_RULING"
    | "POSSESSION_FINAL";
  data: Record<string, string | number | boolean | null>;
  stateRoot: `0x${string}`;
  eventHash: `0x${string}`;
}

export interface PublicPossessionSegment {
  sequence: number;
  previousSegmentHash: `0x${string}` | null;
  eventHashes: `0x${string}`[];
  stateRoot: `0x${string}`;
  payloadCommitment: `0x${string}`;
  segmentHash: `0x${string}`;
}

export interface PublicPossessionSnapshot {
  format: "ABL-POSSESSION-SNAPSHOT-V1";
  sequence: number;
  eventType: ResolutionEvent["type"];
  eventData: ResolutionEvent["data"];
  eventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  gameId: string;
  possessionId: string;
  period: number;
  gameClockMs: number;
  shotClockMs: number;
  score: { home: number; away: number };
  possessionTeam: Team;
  phase: BasketballState["phase"];
  ball: BasketballState["ball"];
  players: Array<
    Pick<PlayerState, "playerId" | "team" | "position" | "xCm" | "yCm">
  >;
}
