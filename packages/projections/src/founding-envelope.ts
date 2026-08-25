import type { ProjectionOutboxEvent } from "@abl/database";
import {
  FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
  FOUNDING_BOOTSTRAP_EVENT_TYPES,
  FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST,
  FoundingBootstrapOpenPayloadSchema,
  isFoundingBootstrapEventType,
  parseFoundingBootstrapWorkflowPayload,
  type FoundingBootstrapWorkflowPayload,
} from "@abl/genesis";
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

export const FoundingProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.governance"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(FOUNDING_BOOTSTRAP_AGGREGATE_TYPE),
    aggregateId: z.uuid(),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum(FOUNDING_BOOTSTRAP_EVENT_TYPES),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: SignatureSchema,
});

export type FoundingProjectionEventEnvelope = z.infer<
  typeof FoundingProjectionEventEnvelopeSchema
>;

export interface FoundingProjectionVerificationAuthority
  extends ProjectionVerificationAuthority {
  foundingConventionId: string;
}

export interface VerifiedFoundingProjectionEvent {
  envelope: FoundingProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: FoundingBootstrapWorkflowPayload;
  signerAddress: `0x${string}`;
}

function canonicalEvent(
  envelope: FoundingProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

export function foundingProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): FoundingProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.governance" ||
    event.aggregateType !== FOUNDING_BOOTSTRAP_AGGREGATE_TYPE ||
    !isFoundingBootstrapEventType(event.eventType) ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed founding-convention event",
    );
  }
  const parsed = FoundingProjectionEventEnvelopeSchema.safeParse({
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
  if (!parsed.success) {
    throw new ProjectionValidationError(
      "Founding-convention outbox event cannot be encoded",
    );
  }
  return parsed.data;
}

export async function verifyFoundingProjectionEvent(
  input: unknown,
  authority: FoundingProjectionVerificationAuthority,
): Promise<VerifiedFoundingProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = FoundingProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProjectionValidationError(
      "Founding-convention projection envelope is malformed",
    );
  }
  const envelope = parsed.data;
  if (envelope.event.aggregateId !== authority.foundingConventionId) {
    throw new ProjectionAuthorizationError(
      "Founding-convention projection targets an unauthorized convention",
    );
  }
  const registered = authority.admittedAgents.get(envelope.event.actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(
      FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
    )
  ) {
    throw new ProjectionAuthorizationError(
      "Founding-convention actor is not admitted for this aggregate",
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
      "Founding-convention signature or content is invalid",
    );
  }
  if (signerAddress.toLowerCase() !== registered.signerAddress.toLowerCase()) {
    throw new ProjectionAuthorizationError(
      "Founding-convention signer is not registered to its actor",
    );
  }

  let payload: FoundingBootstrapWorkflowPayload;
  try {
    payload = parseFoundingBootstrapWorkflowPayload(
      envelope.event.eventType,
      envelope.event.payload,
    );
  } catch {
    throw new ProjectionValidationError(
      "Founding-convention projection payload is malformed",
    );
  }
  if (envelope.event.eventType === "FoundingBootstrapOpened") {
    const opened = FoundingBootstrapOpenPayloadSchema.parse(payload);
    const memberAuthorities = opened.snapshot.eligibleFounderDids.map((did) =>
      authority.admittedAgents.get(did),
    );
    if (
      !opened.snapshot.eligibleFounderDids.includes(envelope.event.actorDid) ||
      memberAuthorities.some(
        (member) =>
          member === undefined ||
          !member.allowedAggregateTypes.includes(
            FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
          ),
      ) ||
      new Set(
        memberAuthorities.map((member) => member!.signerAddress.toLowerCase()),
      ).size !== memberAuthorities.length
    ) {
      throw new ProjectionAuthorizationError(
        "Founding-convention eligibility snapshot is unauthorized",
      );
    }
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
    signerAddress,
  };
}
