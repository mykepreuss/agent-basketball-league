import { sha256Commitment, type CanonicalEvent } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Address, Hex } from "viem";
import { z } from "zod";

import {
  AutonomyScheduler,
  type ScheduledActivation,
  type WeeklyAutonomyAllowance,
} from "./autonomy.js";
import { TradeAccessCoordinator } from "./continuity.js";
import { CredentialController, type DelegationMandate } from "./credentials.js";

export const CAREER_AUTHORITY_AGGREGATE_TYPE = "career-authority";
export const TRADE_ACCESS_AGGREGATE_TYPE = "trade-access-transfer";

const WeekOpenedSchema = z.strictObject({
  weekId: z.string().min(1).max(120),
  priorWeekId: z.string().min(1).max(120).nullable(),
});
const ActivationScheduledSchema = z.strictObject({
  activationId: UuidV7Schema,
  weekId: z.string().min(1).max(120),
  startsAt: IsoDateTimeSchema,
  minutes: z.number().int().min(1).max(15),
  computeMinutes: z.number().int().nonnegative(),
  normalizedTokens: z.number().int().nonnegative(),
  purposeCommitment: Sha256Schema,
});
const OverloadAppliedSchema = z.strictObject({
  weekId: z.string().min(1).max(120),
  reasonCode: z.enum(["COMPETITION_LOAD", "RECOVERY_LOAD", "PROVIDER_LOAD"]),
});
const ActivationDelayedSchema = z.strictObject({
  activationId: UuidV7Schema,
  delayedAt: IsoDateTimeSchema,
});
const DelegationMandateSchema = z.strictObject({
  mandateId: UuidV7Schema,
  principalDid: DidSchema,
  delegateDid: DidSchema,
  capabilities: z
    .array(z.string().min(1).max(160))
    .min(1)
    .max(16)
    .refine((values) => new Set(values).size === values.length),
  subjectIds: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(32)
    .refine((values) => new Set(values).size === values.length),
  validFrom: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  revokedAt: z.null(),
});
const DelegationUsedSchema = z.strictObject({
  mandateId: UuidV7Schema,
  principalDid: DidSchema,
  capability: z.string().min(1).max(160),
  subjectId: z.string().min(1).max(200),
  usedAt: IsoDateTimeSchema,
});
const DelegationRevokedSchema = z.strictObject({
  mandateId: UuidV7Schema,
  principalDid: DidSchema,
  revokedAt: IsoDateTimeSchema,
});
const TradeBaseSchema = z.strictObject({
  transferId: UuidV7Schema,
  agentDid: DidSchema,
  formerTeamId: z.string().min(1).max(160),
  newTeamId: z.string().min(1).max(160),
});
const TradeRevokedSchema = TradeBaseSchema.extend({
  revokedAccessCommitment: Sha256Schema,
  revokedAt: IsoDateTimeSchema,
});
const TradeRotatedSchema = TradeBaseSchema.extend({
  newDomainKeyCommitment: Sha256Schema,
  rotatedAt: IsoDateTimeSchema,
});
const TradeGrantedSchema = TradeBaseSchema.extend({
  grantedAccessCommitment: Sha256Schema,
  grantedAt: IsoDateTimeSchema,
});

export const CareerAuthorityPayloadSchemas = {
  AutonomyWeekOpened: WeekOpenedSchema,
  AutonomyActivationScheduled: ActivationScheduledSchema,
  AutonomyOverloadApplied: OverloadAppliedSchema,
  AutonomyActivationDelayed: ActivationDelayedSchema,
  DelegationGranted: DelegationMandateSchema,
  DelegationUsed: DelegationUsedSchema,
  DelegationRevoked: DelegationRevokedSchema,
  TradeAccessRevoked: TradeRevokedSchema,
  TradeAccessRotated: TradeRotatedSchema,
  TradeAccessGranted: TradeGrantedSchema,
} as const;

export type CareerAuthorityEventType =
  keyof typeof CareerAuthorityPayloadSchemas;

export const CAREER_AUTHORITY_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-career-authority-workflow",
  version: 1,
  eventTypes: Object.keys(CareerAuthorityPayloadSchemas).sort(),
});

export interface CareerAuthoritySnapshot {
  principalDid: string;
  weeks: Readonly<Record<string, WeeklyAutonomyAllowance>>;
  remaining: Readonly<Record<string, WeeklyAutonomyAllowance>>;
  overloadFloors: Readonly<Record<string, WeeklyAutonomyAllowance>>;
  activations: Readonly<Record<string, ScheduledActivation>>;
  makeGoodObligations: Readonly<Record<string, number>>;
  delegations: Readonly<Record<string, DelegationMandate>>;
  delegationUses: readonly Hex[];
  version: number;
}

export interface TradeAccessSnapshot {
  transferId: string;
  agentDid: string;
  formerTeamId: string;
  newTeamId: string;
  trace: readonly string[];
  revokeCommitment: Hex | null;
  rotationCommitment: Hex | null;
  grantCommitment: Hex | null;
  version: number;
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new CareerAuthorityValidationError("Timestamp is not canonical");
  return parsed;
}

function parsePayload<TEventType extends CareerAuthorityEventType>(
  eventType: TEventType,
  payload: unknown,
): z.infer<(typeof CareerAuthorityPayloadSchemas)[TEventType]> {
  return CareerAuthorityPayloadSchemas[eventType].parse(payload) as z.infer<
    (typeof CareerAuthorityPayloadSchemas)[TEventType]
  >;
}

export function replayCareerAuthority(input: {
  principalDid: string;
  signingAddress: Address;
  encryptionPublicKey: Hex;
  events: readonly CanonicalEvent[];
}): CareerAuthoritySnapshot {
  const scheduler = new AutonomyScheduler(input.principalDid);
  const credentials = new CredentialController(
    input.principalDid,
    input.signingAddress,
    input.encryptionPublicKey,
  );
  const weeks: Record<string, WeeklyAutonomyAllowance> = {};
  const remaining: Record<string, WeeklyAutonomyAllowance> = {};
  const overloadFloors: Record<string, WeeklyAutonomyAllowance> = {};
  const activations: Record<string, ScheduledActivation> = {};
  const makeGoodObligations: Record<string, number> = {};
  const delegations: Record<string, DelegationMandate> = {};
  const delegationUses: Hex[] = [];
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  let previousHash: Hex | null = null;

  for (const [index, event] of input.events.entries()) {
    const occurredAt = canonicalInstant(event.timestamp);
    if (
      event.aggregateType !== CAREER_AUTHORITY_AGGREGATE_TYPE ||
      event.aggregateId !== input.principalDid ||
      event.aggregateVersion !== BigInt(index + 1) ||
      event.previousEventHash !== previousHash ||
      event.schemaDigest !== CAREER_AUTHORITY_SCHEMA_DIGEST ||
      occurredAt < previousTimestamp ||
      !Object.hasOwn(CareerAuthorityPayloadSchemas, event.eventType)
    )
      throw new CareerAuthorityValidationError(
        "Career authority history is not contiguous",
      );
    const eventType = event.eventType as CareerAuthorityEventType;
    if (eventType === "AutonomyWeekOpened") {
      if (event.actorDid !== input.principalDid)
        throw new CareerAuthorityAuthorizationError(
          "Only the principal can open an autonomy week",
        );
      const payload = parsePayload(eventType, event.payload);
      const rollover =
        payload.priorWeekId === null
          ? undefined
          : (() => {
              const prior = scheduler.remaining(payload.priorWeekId);
              return {
                activations: prior.activations,
                interactiveMinutes: prior.interactiveMinutes,
                computeMinutes: prior.computeMinutes,
                normalizedTokens: prior.normalizedTokens,
              };
            })();
      weeks[payload.weekId] = scheduler.openWeek(payload.weekId, rollover);
      remaining[payload.weekId] = scheduler.remaining(payload.weekId);
    } else if (eventType === "AutonomyActivationScheduled") {
      const payload = parsePayload(eventType, event.payload);
      const activation = scheduler.schedule(
        { ...payload, purposeCommitment: payload.purposeCommitment as Hex },
        event.actorDid,
        event.timestamp,
      );
      activations[payload.activationId] = activation;
      remaining[payload.weekId] = scheduler.remaining(payload.weekId);
    } else if (eventType === "AutonomyOverloadApplied") {
      if (event.actorDid !== input.principalDid)
        throw new CareerAuthorityAuthorizationError(
          "Only the principal can apply its overload protection",
        );
      const payload = parsePayload(eventType, event.payload);
      overloadFloors[payload.weekId] = scheduler.overloadFloor(payload.weekId);
    } else if (eventType === "AutonomyActivationDelayed") {
      if (event.actorDid !== input.principalDid)
        throw new CareerAuthorityAuthorizationError(
          "Only the principal can record autonomy delay",
        );
      const payload = parsePayload(eventType, event.payload);
      if (payload.delayedAt !== event.timestamp)
        throw new CareerAuthorityValidationError(
          "Delay time does not match the canonical event",
        );
      scheduler.delay(payload.activationId);
      const activation = scheduler.activation(payload.activationId);
      if (activation === undefined)
        throw new CareerAuthorityValidationError(
          "Delayed activation is missing",
        );
      activations[payload.activationId] = activation;
      makeGoodObligations[payload.activationId] = scheduler.makeGoodMinutes(
        payload.activationId,
      );
    } else if (eventType === "DelegationGranted") {
      if (event.actorDid !== input.principalDid)
        throw new CareerAuthorityAuthorizationError(
          "Only the principal can grant a delegation",
        );
      const payload = parsePayload(eventType, event.payload);
      if (
        payload.principalDid !== input.principalDid ||
        canonicalInstant(payload.validFrom) < occurredAt ||
        canonicalInstant(payload.expiresAt) <=
          canonicalInstant(payload.validFrom)
      )
        throw new CareerAuthorityValidationError(
          "Delegation time or principal is invalid",
        );
      credentials.delegate(payload, input.signingAddress);
      delegations[payload.mandateId] = payload;
    } else if (eventType === "DelegationUsed") {
      const payload = parsePayload(eventType, event.payload);
      if (
        payload.principalDid !== input.principalDid ||
        payload.usedAt !== event.timestamp
      )
        throw new CareerAuthorityValidationError(
          "Delegation use is not bound to the event",
        );
      credentials.authorizeDelegation(
        payload.mandateId,
        event.actorDid,
        payload.capability,
        payload.subjectId,
        payload.usedAt,
      );
      delegationUses.push(sha256Commitment(payload));
    } else if (eventType === "DelegationRevoked") {
      if (event.actorDid !== input.principalDid)
        throw new CareerAuthorityAuthorizationError(
          "Only the principal can revoke a delegation",
        );
      const payload = parsePayload(eventType, event.payload);
      if (
        payload.principalDid !== input.principalDid ||
        payload.revokedAt !== event.timestamp
      )
        throw new CareerAuthorityValidationError(
          "Delegation revocation is not bound to the event",
        );
      credentials.revokeDelegation(
        payload.mandateId,
        payload.revokedAt,
        input.signingAddress,
      );
      const revoked = credentials.delegation(payload.mandateId);
      if (revoked === undefined)
        throw new CareerAuthorityValidationError("Revoked mandate is missing");
      delegations[payload.mandateId] = revoked;
    }
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return {
    principalDid: input.principalDid,
    weeks,
    remaining,
    overloadFloors,
    activations,
    makeGoodObligations,
    delegations,
    delegationUses,
    version: input.events.length,
  };
}

export function replayTradeAccess(
  events: readonly CanonicalEvent[],
): TradeAccessSnapshot | null {
  if (events.length === 0) return null;
  const coordinator = new TradeAccessCoordinator();
  let snapshot: TradeAccessSnapshot | null = null;
  let previousHash: Hex | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, event] of events.entries()) {
    if (
      event.aggregateType !== TRADE_ACCESS_AGGREGATE_TYPE ||
      event.aggregateVersion !== BigInt(index + 1) ||
      event.previousEventHash !== previousHash ||
      event.schemaDigest !== CAREER_AUTHORITY_SCHEMA_DIGEST ||
      ![
        "TradeAccessRevoked",
        "TradeAccessRotated",
        "TradeAccessGranted",
      ].includes(event.eventType)
    )
      throw new CareerAuthorityValidationError(
        "Trade access history is not contiguous",
      );
    const eventType = event.eventType as
      | "TradeAccessRevoked"
      | "TradeAccessRotated"
      | "TradeAccessGranted";
    const common = CareerAuthorityPayloadSchemas[eventType].parse(
      event.payload,
    );
    const occurredAt = canonicalInstant(event.timestamp);
    if (
      occurredAt < previousTimestamp ||
      event.aggregateId !== common.transferId ||
      event.actorDid !== common.agentDid
    )
      throw new CareerAuthorityAuthorizationError(
        "Trade access transition is not agent-authorized",
      );
    if (snapshot === null) {
      snapshot = {
        transferId: common.transferId,
        agentDid: common.agentDid,
        formerTeamId: common.formerTeamId,
        newTeamId: common.newTeamId,
        trace: [],
        revokeCommitment: null,
        rotationCommitment: null,
        grantCommitment: null,
        version: 0,
      };
    } else if (
      snapshot.agentDid !== common.agentDid ||
      snapshot.formerTeamId !== common.formerTeamId ||
      snapshot.newTeamId !== common.newTeamId
    )
      throw new CareerAuthorityValidationError(
        "Trade access transfer identity changed",
      );
    if (eventType === "TradeAccessRevoked") {
      const payload = TradeRevokedSchema.parse(event.payload);
      if (payload.revokedAt !== event.timestamp)
        throw new CareerAuthorityValidationError("Revoke time mismatch");
      coordinator.revoke(payload.agentDid, payload.formerTeamId);
      snapshot.revokeCommitment = payload.revokedAccessCommitment as Hex;
    } else if (eventType === "TradeAccessRotated") {
      const payload = TradeRotatedSchema.parse(event.payload);
      if (payload.rotatedAt !== event.timestamp)
        throw new CareerAuthorityValidationError("Rotation time mismatch");
      coordinator.rotate(payload.agentDid);
      snapshot.rotationCommitment = payload.newDomainKeyCommitment as Hex;
    } else {
      const payload = TradeGrantedSchema.parse(event.payload);
      if (payload.grantedAt !== event.timestamp)
        throw new CareerAuthorityValidationError("Grant time mismatch");
      coordinator.grant(payload.agentDid, payload.newTeamId);
      snapshot.grantCommitment = payload.grantedAccessCommitment as Hex;
    }
    snapshot.trace = coordinator.trace();
    snapshot.version = index + 1;
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return snapshot;
}

export function careerAuthorityStateRoot(
  snapshot: CareerAuthoritySnapshot,
): Hex {
  return sha256Commitment(snapshot);
}

export function tradeAccessStateRoot(snapshot: TradeAccessSnapshot): Hex {
  return sha256Commitment(snapshot);
}

export class CareerAuthorityAuthorizationError extends Error {}
export class CareerAuthorityValidationError extends Error {}
