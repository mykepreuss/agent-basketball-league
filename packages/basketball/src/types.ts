import type { CanonicalEvent } from "@abl/recognition";
import { z } from "zod";

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

export interface CoachDecision {
  coachDid: string;
  team: Team;
  windowId: string;
  instruction: "PACE" | "SPACE" | "SWITCH" | "PROTECT_RIM";
  targetPlayerIds: string[];
  receipt: CognitionReceipt;
}

export interface RefereeDecision {
  refereeDid: string;
  sequence: number;
  call: "NO_CALL" | "PERSONAL_FOUL" | "OUT_OF_BOUNDS" | "SHOT_CLOCK";
  againstPlayerId: string | null;
  confidenceBps: number;
  receipt: CognitionReceipt;
}

export interface ReplayDecision {
  replayDid: string;
  reviewable: boolean;
  ruling: "CONFIRM" | "REVERSE" | "NO_REVIEW";
  evidenceCommitment: `0x${string}`;
  receipt: CognitionReceipt;
}

export interface ResolutionEvent {
  sequence: number;
  type:
    | "WINDOW_RESOLVED"
    | "PASS"
    | "SHOT"
    | "REBOUND"
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
