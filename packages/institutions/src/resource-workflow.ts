import { sha256Commitment } from "@abl/recognition";
import { ResourceScheduleSchema, UuidV7Schema } from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

export const RESOURCE_SCHEDULE_AGGREGATE_TYPE = "resource-schedule";
export const RESOURCE_SCHEDULE_EVENT_TYPE = "ResourceSchedulePublished";
export const RESOURCE_SCHEDULE_ROLES = [
  "PLAYER",
  "COACH",
  "REFEREE",
  "REPLAY",
] as const;

export const ResourceSchedulePublicationPayloadSchema = z.strictObject({
  schedule: ResourceScheduleSchema,
  ratificationProposalId: UuidV7Schema,
});

export type ResourceSchedule = z.infer<typeof ResourceScheduleSchema>;
export type ResourceSchedulePublicationPayload = z.infer<
  typeof ResourceSchedulePublicationPayloadSchema
>;

export interface ResourceScheduleWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface ResourceScheduleSnapshot {
  scheduleId: string;
  version: number;
  lastTransitionAt: string;
  schedule: ResourceSchedule;
  ratificationProposalId: string;
}

export interface ResourceScheduleRatification {
  proposalId: string;
  proposalClass: string;
  tier?: "PREMIER" | "DEVELOPMENT";
  executableChangeDigest: string | null;
  passed: boolean;
  closeEventId: string;
}

export interface ResourceScheduleRatificationReader {
  resourceScheduleRatification(
    proposalId: string,
  ): Promise<ResourceScheduleRatification | null>;
}

export class ResourceScheduleAuthorizationError extends Error {
  public override readonly name = "ResourceScheduleAuthorizationError";
}

export class ResourceScheduleValidationError extends Error {
  public override readonly name = "ResourceScheduleValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ResourceScheduleValidationError(
      "Resource schedule timestamp is not canonical",
    );
  return parsed;
}

function ratifiableSchedule(schedule: ResourceSchedule) {
  const { ratificationEventId: _ratificationEventId, ...proposal } = schedule;
  return proposal;
}

export function resourceScheduleExecutableDigest(
  schedule: ResourceSchedule,
): Hex {
  return sha256Commitment({
    format: "ABL-RESOURCE-SCHEDULE-EXECUTABLE-V1",
    schedule: ratifiableSchedule(ResourceScheduleSchema.parse(schedule)),
  });
}

export const RESOURCE_SCHEDULE_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-resource-schedule-workflow",
  version: 1,
  aggregateType: RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  eventType: RESOURCE_SCHEDULE_EVENT_TYPE,
  requiredRoles: RESOURCE_SCHEDULE_ROLES,
  ratificationClass: "CONSTITUTIONAL",
  ratificationDigest: "ABL-RESOURCE-SCHEDULE-EXECUTABLE-V1",
});

function validateScheduleShape(schedule: ResourceSchedule): void {
  const roles = Object.keys(schedule.gameDayRoleUnits);
  if (
    roles.length !== RESOURCE_SCHEDULE_ROLES.length ||
    RESOURCE_SCHEDULE_ROLES.some((role) => !(role in schedule.gameDayRoleUnits))
  ) {
    throw new ResourceScheduleValidationError(
      "Resource schedule must define exactly every autonomous game role",
    );
  }
  const conversionKeys = schedule.conversionFactors.map(
    ({ provider, modelRevision }) => `${provider}\u0000${modelRevision}`,
  );
  if (
    schedule.conversionFactors.length === 0 ||
    schedule.conversionFactors.some(
      ({ provider, modelRevision, unitsPerThousandTokens }) =>
        provider.trim() !== provider ||
        provider.length === 0 ||
        modelRevision.trim() !== modelRevision ||
        modelRevision.length === 0 ||
        !Number.isFinite(unitsPerThousandTokens),
    ) ||
    new Set(conversionKeys).size !== conversionKeys.length
  ) {
    throw new ResourceScheduleValidationError(
      "Resource conversion factors must be finite, unique, and nonempty",
    );
  }
}

export function parseResourceSchedulePublicationPayload(
  payload: unknown,
): ResourceSchedulePublicationPayload {
  const parsed = ResourceSchedulePublicationPayloadSchema.parse(payload);
  validateScheduleShape(parsed.schedule);
  return parsed;
}

export function resourceScheduleStateRoot(
  snapshot: ResourceScheduleSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-RESOURCE-SCHEDULE-STATE-V1",
    ...snapshot,
  });
}

export function applyResourceScheduleTransition(
  current: ResourceScheduleSnapshot | null,
  event: ResourceScheduleWorkflowEvent,
  payload: ResourceSchedulePublicationPayload,
): ResourceScheduleSnapshot {
  if (event.eventType !== RESOURCE_SCHEDULE_EVENT_TYPE)
    throw new ResourceScheduleValidationError(
      "Resource schedule event type is not recognized",
    );
  const parsed = parseResourceSchedulePublicationPayload(payload);
  const publishedAt = canonicalInstant(event.timestamp);
  const effectiveAt = canonicalInstant(parsed.schedule.effectiveAt);
  const expectedVersion = (current?.version ?? 0) + 1;
  if (
    event.aggregateId !== parsed.schedule.scheduleId ||
    event.aggregateVersion !== BigInt(expectedVersion) ||
    parsed.schedule.version !== expectedVersion ||
    effectiveAt < publishedAt ||
    (current !== null &&
      (parsed.schedule.scheduleId !== current.scheduleId ||
        publishedAt < canonicalInstant(current.lastTransitionAt) ||
        effectiveAt <= canonicalInstant(current.schedule.effectiveAt)))
  ) {
    throw new ResourceScheduleValidationError(
      "Resource schedule identity, version, or effective time is invalid",
    );
  }
  return {
    scheduleId: parsed.schedule.scheduleId,
    version: parsed.schedule.version,
    lastTransitionAt: event.timestamp,
    schedule: structuredClone(parsed.schedule),
    ratificationProposalId: parsed.ratificationProposalId,
  };
}

export async function requireResourceScheduleRatification(
  payload: ResourceSchedulePublicationPayload,
  reader: ResourceScheduleRatificationReader,
): Promise<ResourceScheduleRatification> {
  const ratification = await reader.resourceScheduleRatification(
    payload.ratificationProposalId,
  );
  if (
    ratification === null ||
    ratification.proposalId !== payload.ratificationProposalId ||
    ratification.proposalClass !== "CONSTITUTIONAL" ||
    !ratification.passed ||
    ratification.closeEventId !== payload.schedule.ratificationEventId ||
    ratification.executableChangeDigest !==
      resourceScheduleExecutableDigest(payload.schedule)
  ) {
    throw new ResourceScheduleAuthorizationError(
      "Resource schedule lacks an exact passed constitutional ratification",
    );
  }
  return ratification;
}
