import type { CanonicalEvent } from "@abl/recognition";
import {
  CanonicalEventWireSchema,
  Eip712SignatureSchema,
  Sha256Schema,
} from "@abl/schemas";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import type { DecisionWindow, PossessionInput } from "./engine.js";
import {
  ActionIntentSchema,
  BasketballStateSchema,
  CoachDecisionBodySchema,
  CognitionReceiptSchema,
  RefereeDecisionBodySchema,
  ReplayDecisionBodySchema,
  type CoachDecision,
  type RefereeDecision,
  type ReplayDecision,
  type SignedPlayerDecision,
} from "./types.js";

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const RecognitionDomainSchema = z.strictObject({
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(100),
  chainId: z.number().int().positive(),
  verifyingContract: AddressSchema,
});
const CompetitionAuthoritySchema = z.strictObject({
  did: z.string().startsWith("did:"),
  signerAddress: AddressSchema,
});
const DecisionEventWireSchema = CanonicalEventWireSchema.extend({
  eventId: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1).max(500),
});

function receiptSchema(role: "PLAYER" | "COACH" | "REFEREE" | "REPLAY") {
  return CognitionReceiptSchema.extend({ role: z.literal(role) });
}

function authorizationEventSchema<TDecision extends z.ZodType>(
  decisionSchema: TDecision,
) {
  return DecisionEventWireSchema.extend({
    payload: z.strictObject({
      decision: decisionSchema,
      receiptCommitment: Sha256Schema,
    }),
  });
}

const PlayerAuthorizationEventSchema = DecisionEventWireSchema.extend({
  payload: z.strictObject({
    intent: ActionIntentSchema,
    receiptCommitment: Sha256Schema,
  }),
});
const SignedPlayerDecisionWireSchema = z.strictObject({
  intent: ActionIntentSchema,
  receipt: receiptSchema("PLAYER"),
  authorizationEvent: PlayerAuthorizationEventSchema,
  eventHash: Sha256Schema,
  signature: Eip712SignatureSchema,
  signerAddress: AddressSchema,
});

function authorizationShape<
  TBody extends z.ZodType,
  TRole extends "COACH" | "REFEREE" | "REPLAY",
>(bodySchema: TBody, role: TRole) {
  return {
    receipt: receiptSchema(role),
    authorizationEvent: authorizationEventSchema(bodySchema),
    eventHash: Sha256Schema,
    signature: Eip712SignatureSchema,
    signerAddress: AddressSchema,
  };
}

const CoachDecisionWireSchema = CoachDecisionBodySchema.extend(
  authorizationShape(CoachDecisionBodySchema, "COACH"),
);
const RefereeDecisionWireSchema = RefereeDecisionBodySchema.extend(
  authorizationShape(RefereeDecisionBodySchema, "REFEREE"),
);
const ReplayDecisionWireSchema = ReplayDecisionBodySchema.extend(
  authorizationShape(ReplayDecisionBodySchema, "REPLAY"),
);

export const PossessionInputWireSchema = z.strictObject({
  initialState: BasketballStateSchema,
  windows: z
    .array(
      z.strictObject({
        windowId: z.string().min(1).max(200),
        decisions: z.array(SignedPlayerDecisionWireSchema).length(10),
        coaches: z.array(CoachDecisionWireSchema).length(2),
      }),
    )
    .min(2)
    .max(4),
  playerSigningAddresses: z
    .array(
      z.strictObject({
        playerId: z.string().min(1).max(100),
        signerAddress: AddressSchema,
      }),
    )
    .length(10)
    .refine(
      (entries) =>
        new Set(entries.map(({ playerId }) => playerId)).size ===
          entries.length &&
        new Set(entries.map(({ signerAddress }) => signerAddress.toLowerCase()))
          .size === entries.length,
      "Player signing identities must be unique",
    ),
  authorities: z.strictObject({
    coaches: z.strictObject({
      home: CompetitionAuthoritySchema,
      away: CompetitionAuthoritySchema,
    }),
    referees: z.array(CompetitionAuthoritySchema).length(3),
    replayOfficials: z.array(CompetitionAuthoritySchema).length(2),
  }),
  domain: RecognitionDomainSchema,
  randomSeed: Sha256Schema,
  windowDurationMs: z.number().int().positive().max(24_000).optional(),
  refereeDecisions: z.array(RefereeDecisionWireSchema).length(3),
  replayDecisions: z.array(ReplayDecisionWireSchema).length(2),
});

export type PossessionInputWire = z.infer<typeof PossessionInputWireSchema>;

function materializeEvent(event: unknown): CanonicalEvent {
  const parsed = DecisionEventWireSchema.parse(event);
  return {
    ...parsed,
    aggregateVersion: BigInt(parsed.aggregateVersion),
  } as CanonicalEvent;
}

function serializeEvent<TPayload>(event: CanonicalEvent<TPayload>) {
  return { ...event, aggregateVersion: event.aggregateVersion.toString() };
}

function serializeDecision<
  TDecision extends { authorizationEvent: CanonicalEvent },
>(decision: TDecision) {
  return {
    ...decision,
    authorizationEvent: serializeEvent(decision.authorizationEvent),
  };
}

function materializePlayerDecision(
  decision: PossessionInputWire["windows"][number]["decisions"][number],
): SignedPlayerDecision {
  return {
    ...decision,
    authorizationEvent: materializeEvent(decision.authorizationEvent),
  } as SignedPlayerDecision;
}

function materializeCoachDecision(
  decision: PossessionInputWire["windows"][number]["coaches"][number],
): CoachDecision {
  return {
    ...decision,
    authorizationEvent: materializeEvent(decision.authorizationEvent),
  } as CoachDecision;
}

function materializeRefereeDecision(
  decision: PossessionInputWire["refereeDecisions"][number],
): RefereeDecision {
  return {
    ...decision,
    authorizationEvent: materializeEvent(decision.authorizationEvent),
  } as RefereeDecision;
}

function materializeReplayDecision(
  decision: PossessionInputWire["replayDecisions"][number],
): ReplayDecision {
  return {
    ...decision,
    authorizationEvent: materializeEvent(decision.authorizationEvent),
  } as ReplayDecision;
}

export function materializePossessionInput(input: unknown): PossessionInput {
  const wire = PossessionInputWireSchema.parse(input);
  const windows: DecisionWindow[] = wire.windows.map((window) => ({
    windowId: window.windowId,
    decisions: window.decisions.map(materializePlayerDecision),
    coaches: window.coaches.map(materializeCoachDecision),
  }));
  return {
    initialState: wire.initialState,
    windows,
    playerSigningAddresses: new Map(
      wire.playerSigningAddresses.map(({ playerId, signerAddress }) => [
        playerId,
        signerAddress as `0x${string}`,
      ]),
    ),
    authorities: wire.authorities as PossessionInput["authorities"],
    domain: wire.domain as TypedDataDomain,
    randomSeed: wire.randomSeed as `0x${string}`,
    ...(wire.windowDurationMs === undefined
      ? {}
      : { windowDurationMs: wire.windowDurationMs }),
    refereeDecisions: wire.refereeDecisions.map(materializeRefereeDecision),
    replayDecisions: wire.replayDecisions.map(materializeReplayDecision),
  };
}

export function possessionInputToWire(
  input: PossessionInput,
): PossessionInputWire {
  return PossessionInputWireSchema.parse({
    ...input,
    windows: input.windows.map((window) => ({
      ...window,
      decisions: window.decisions.map(serializeDecision),
      coaches: window.coaches.map(serializeDecision),
    })),
    playerSigningAddresses: [...input.playerSigningAddresses].map(
      ([playerId, signerAddress]) => ({ playerId, signerAddress }),
    ),
    refereeDecisions: input.refereeDecisions.map(serializeDecision),
    replayDecisions: input.replayDecisions.map(serializeDecision),
  });
}
