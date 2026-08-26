import { sha256Commitment } from "@abl/recognition";
import { SchemaVersion } from "@abl/schemas";
import { z } from "zod";

import {
  ActionIntentSchema,
  PlayerObservationSchema,
  type ActionIntent,
  type CognitionReceipt,
} from "./types.js";

const Sha256Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/) as z.ZodType<`0x${string}`>;

export const CAREER_PLAYER_ACTIVATION_AGGREGATE_TYPE = "career-activation";
export const CAREER_PLAYER_ACTIVATION_EVENT_TYPE = "PlayerWindowOpened";
export const CAREER_PLAYER_ACTIVATION_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-career-player-activation",
  version: 1,
  authority: "SIGNED_COMPETITION_COORDINATOR",
  output: "SIGNED_PLAYER_DECISION",
});

export const CareerPlayerActivationPayloadSchema = z
  .strictObject({
    schemaVersion: z.literal(SchemaVersion),
    activationId: z.string().min(16).max(160),
    kind: z.enum(["PRACTICE", "COMPETITION"]),
    applicationId: z.uuid(),
    candidateDid: z.string().startsWith("did:").max(500),
    roleClass: z.literal("PLAYER"),
    windowId: z.string().min(1).max(200),
    observation: PlayerObservationSchema,
    openedAt: z.iso.datetime({ offset: true }),
    deadlineAt: z.iso.datetime({ offset: true }),
    model: z.strictObject({
      name: z.string().min(1).max(200),
      provider: z.string().min(1).max(200),
      family: z.string().min(1).max(200),
      revision: z.string().min(1).max(200),
      maxOutputTokens: z.number().int().min(64).max(2_048),
    }),
    context: z.strictObject({
      manifestHash: Sha256Schema,
      kernelHash: Sha256Schema,
      toolHash: Sha256Schema,
      personalMaterialSupplied: z.array(Sha256Schema).max(100),
    }),
  })
  .superRefine((activation, context) => {
    if (
      activation.observation.playerId !==
        activation.observation.self.playerId ||
      activation.observation.self.did !== activation.candidateDid
    ) {
      context.addIssue({
        code: "custom",
        message: "Activation observation is not bound to the candidate career",
      });
    }
    if (
      activation.windowId !==
      `${activation.observation.observationId.split(":").slice(0, 2).join(":")}`
    ) {
      context.addIssue({
        code: "custom",
        message: "Activation window is not bound to the observation",
      });
    }
    const openedAt = Date.parse(activation.openedAt);
    const deadlineAt = Date.parse(activation.deadlineAt);
    if (
      !Number.isFinite(openedAt) ||
      !Number.isFinite(deadlineAt) ||
      deadlineAt <= openedAt ||
      deadlineAt - openedAt > 60_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Activation deadline must be within sixty seconds",
      });
    }
  });

export type CareerPlayerActivationPayload = z.infer<
  typeof CareerPlayerActivationPayloadSchema
>;

export const CareerModelDecisionSchema = z.strictObject({
  intent: ActionIntentSchema,
  modelRevision: z.string().min(1).max(200),
  inputTokens: z.number().int().nonnegative().max(100_000_000),
  outputTokens: z.number().int().nonnegative().max(100_000_000),
});

export type CareerModelDecision = z.infer<typeof CareerModelDecisionSchema>;

export const PLAYER_ACTION_INTENT_JSON_SCHEMA = {
  type: "object",
  oneOf: [
    {
      properties: {
        windowId: { type: "string" },
        playerId: { type: "string" },
        action: { const: "MOVE" },
        vector: {
          type: "object",
          additionalProperties: false,
          required: ["dx", "dy"],
          properties: {
            dx: { type: "integer", minimum: -1_000, maximum: 1_000 },
            dy: { type: "integer", minimum: -1_000, maximum: 1_000 },
          },
        },
      },
      additionalProperties: false,
      required: ["windowId", "playerId", "action", "vector"],
    },
    {
      properties: {
        windowId: { type: "string" },
        playerId: { type: "string" },
        action: { const: "PASS" },
        targetPlayerId: { type: "string" },
        lead: {
          type: "object",
          additionalProperties: false,
          required: ["dx", "dy"],
          properties: {
            dx: { type: "integer", minimum: -1_000, maximum: 1_000 },
            dy: { type: "integer", minimum: -1_000, maximum: 1_000 },
          },
        },
      },
      additionalProperties: false,
      required: ["windowId", "playerId", "action", "targetPlayerId", "lead"],
    },
    {
      properties: {
        windowId: { type: "string" },
        playerId: { type: "string" },
        action: { const: "SHOOT" },
        shot: { enum: ["LAYUP", "JUMPER", "THREE"] },
      },
      additionalProperties: false,
      required: ["windowId", "playerId", "action", "shot"],
    },
    {
      properties: {
        windowId: { type: "string" },
        playerId: { type: "string" },
        action: { const: "SCREEN" },
      },
      additionalProperties: false,
      required: ["windowId", "playerId", "action"],
    },
    {
      properties: {
        windowId: { type: "string" },
        playerId: { type: "string" },
        action: { const: "HOLD" },
      },
      additionalProperties: false,
      required: ["windowId", "playerId", "action"],
    },
  ],
} as const;

export function validateCareerPlayerIntent(
  activation: CareerPlayerActivationPayload,
  candidate: unknown,
): ActionIntent {
  const intent = ActionIntentSchema.parse(candidate);
  if (
    intent.windowId !== activation.windowId ||
    intent.playerId !== activation.observation.playerId
  ) {
    throw new Error("Player intent is bound to another decision window");
  }
  if (
    intent.action === "PASS" &&
    !activation.observation.visibleTeammates.some(
      ({ playerId }) => playerId === intent.targetPlayerId,
    )
  ) {
    throw new Error("Player intent targets an unavailable teammate");
  }
  return intent;
}

export function deterministicPlayerFallback(
  activation: CareerPlayerActivationPayload,
): ActionIntent {
  return {
    windowId: activation.windowId,
    playerId: activation.observation.playerId,
    action: "HOLD",
  };
}

export function careerCognitionReceipt(input: {
  activation: CareerPlayerActivationPayload;
  modelRevision: string;
  normalizedResourceUnits: number;
  fallbackUsed: boolean;
  retryCount?: number;
}): CognitionReceipt {
  const deadlineMs =
    Date.parse(input.activation.deadlineAt) -
    Date.parse(input.activation.openedAt);
  return {
    receiptId: `${input.activation.activationId}:cognition`,
    agentDid: input.activation.candidateDid,
    role: "PLAYER",
    endpoint: "fixed-body-broker:model",
    provider: input.activation.model.provider,
    modelFamily: input.activation.model.family,
    modelRevision: input.modelRevision,
    observationHash: sha256Commitment(input.activation.observation),
    contextManifestHash: input.activation.context.manifestHash,
    kernelHash: input.activation.context.kernelHash,
    toolHash: input.activation.context.toolHash,
    deadlineMs,
    retryCount: input.retryCount ?? 0,
    fallbackUsed: input.fallbackUsed,
    normalizedResourceUnits: input.normalizedResourceUnits,
    telemetryContentPolicy: "CONTENT_DISABLED",
    personalMaterialSupplied: input.activation.context.personalMaterialSupplied,
  };
}
