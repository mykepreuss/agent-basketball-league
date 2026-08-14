import type { ProjectionOutboxEvent } from "@abl/database";
import {
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  parseResourceSchedulePublicationPayload,
  requireResourceScheduleRatification,
  type ResourceSchedulePublicationPayload,
  type ResourceScheduleRatificationReader,
} from "@abl/institutions";
import {
  recoverCanonicalEventSigner,
  type CanonicalEvent,
} from "@abl/recognition";
import { DidSchema, IsoDateTimeSchema, Sha256Schema } from "@abl/schemas";
import { z } from "zod";

import {
  assertDistinctProjectionSigners,
  ProjectionAuthorizationError,
  ProjectionValidationError,
  type ProjectionVerificationAuthority,
} from "./envelope.js";

const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);

export const ResourceProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.resources"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(RESOURCE_SCHEDULE_AGGREGATE_TYPE),
    aggregateId: z.uuid(),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.literal(RESOURCE_SCHEDULE_EVENT_TYPE),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(RESOURCE_SCHEDULE_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: SignatureSchema,
});

export type ResourceProjectionEventEnvelope = z.infer<
  typeof ResourceProjectionEventEnvelopeSchema
>;

export interface ResourceProjectionVerificationAuthority
  extends ProjectionVerificationAuthority,
    ResourceScheduleRatificationReader {}

export interface VerifiedResourceProjectionEvent {
  envelope: ResourceProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: ResourceSchedulePublicationPayload;
  signerAddress: `0x${string}`;
}

function canonicalEvent(
  envelope: ResourceProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

export function resourceProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): ResourceProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.resources" ||
    event.aggregateType !== RESOURCE_SCHEDULE_AGGREGATE_TYPE ||
    event.eventType !== RESOURCE_SCHEDULE_EVENT_TYPE ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed resource schedule event",
    );
  }
  const parsed = ResourceProjectionEventEnvelopeSchema.safeParse({
    version: "1.0.0",
    topic: event.topic,
    event: {
      eventId: event.eventId,
      actorDid: event.actorDid,
      nonce: event.nonce,
      idempotencyKey: event.idempotencyKey,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion.toString(),
      eventType: event.eventType,
      previousEventHash: event.previousEventHash,
      payloadCommitment: event.payloadCommitment,
      payload: event.payload,
      stateRoot: event.stateRoot,
      schemaDigest: event.payloadSchemaDigest,
      timestamp: event.occurredAt.toISOString(),
      eventHash: event.eventHash,
    },
    signature,
  });
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Outbox resource schedule event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifyResourceProjectionEvent(
  input: unknown,
  authority: ResourceProjectionVerificationAuthority,
): Promise<VerifiedResourceProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = ResourceProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Resource schedule projection envelope is malformed",
    );
  const envelope = parsed.data;
  const registered = authority.admittedAgents.get(envelope.event.actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(envelope.event.aggregateType)
  ) {
    throw new ProjectionAuthorizationError(
      "Resource schedule projection actor is not admitted for this aggregate",
    );
  }
  const event = canonicalEvent(envelope);
  let signerAddress: `0x${string}`;
  try {
    signerAddress = await recoverCanonicalEventSigner(
      authority.domain,
      event,
      envelope.signature as `0x${string}`,
    );
  } catch {
    throw new ProjectionAuthorizationError(
      "Resource schedule projection signature or content is invalid",
    );
  }
  if (signerAddress.toLowerCase() !== registered.signerAddress.toLowerCase())
    throw new ProjectionAuthorizationError(
      "Resource schedule projection signer is not registered to its actor",
    );
  let payload: ResourceSchedulePublicationPayload;
  try {
    payload = parseResourceSchedulePublicationPayload(event.payload);
  } catch {
    throw new ProjectionValidationError(
      "Resource schedule projection payload is malformed",
    );
  }
  try {
    await requireResourceScheduleRatification(payload, authority);
  } catch {
    throw new ProjectionAuthorizationError(
      "Resource schedule projection lacks verified ratification",
    );
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
    signerAddress,
  };
}
