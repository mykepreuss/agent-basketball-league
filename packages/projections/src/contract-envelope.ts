import type { ProjectionOutboxEvent } from "@abl/database";
import {
  CONTRACT_WORKFLOW_AGGREGATE_TYPE,
  CONTRACT_WORKFLOW_EVENT_TYPES,
  CONTRACT_WORKFLOW_SCHEMA_DIGEST,
  ContractInspectionPayloadSchema,
  ContractOfferPayloadSchema,
  ContractResponsePayloadSchema,
  type ContractWorkflowEventType,
  type ContractWorkflowPayload,
} from "@abl/institutions";
import {
  recoverCanonicalEventSigner,
  type CanonicalEvent,
} from "@abl/recognition";
import { DidSchema, IsoDateTimeSchema, Sha256Schema } from "@abl/schemas";
import { z } from "zod";

import {
  ProjectionAuthorizationError,
  ProjectionValidationError,
  type ProjectionVerificationAuthority,
} from "./envelope.js";

const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);
export const ContractProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.contracts"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(CONTRACT_WORKFLOW_AGGREGATE_TYPE),
    aggregateId: DidSchema,
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum(CONTRACT_WORKFLOW_EVENT_TYPES),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(CONTRACT_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: SignatureSchema,
});

export type ContractProjectionEventEnvelope = z.infer<
  typeof ContractProjectionEventEnvelopeSchema
>;

export interface VerifiedContractProjectionEvent {
  envelope: ContractProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: ContractWorkflowPayload;
}

function canonicalEvent(
  envelope: ContractProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

function parsePayload(
  eventType: ContractWorkflowEventType,
  payload: unknown,
): ContractWorkflowPayload {
  switch (eventType) {
    case "ContractOffered":
      return ContractOfferPayloadSchema.parse(payload);
    case "ContractResponded":
      return ContractResponsePayloadSchema.parse(payload);
    case "ContractsInspected":
      return ContractInspectionPayloadSchema.parse(payload);
  }
}

export function contractProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): ContractProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.contracts" ||
    event.aggregateType !== CONTRACT_WORKFLOW_AGGREGATE_TYPE ||
    !CONTRACT_WORKFLOW_EVENT_TYPES.includes(
      event.eventType as ContractWorkflowEventType,
    ) ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed public contract event",
    );
  }
  const parsed = ContractProjectionEventEnvelopeSchema.safeParse({
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
      "Outbox contract event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifyContractProjectionEvent(
  input: unknown,
  authority: ProjectionVerificationAuthority,
): Promise<VerifiedContractProjectionEvent> {
  const parsed = ContractProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Contract projection envelope is malformed",
    );
  const envelope = parsed.data;
  const registered = authority.admittedAgents.get(envelope.event.actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(envelope.event.aggregateType)
  ) {
    throw new ProjectionAuthorizationError(
      "Contract projection actor is not admitted for this aggregate",
    );
  }
  const event = canonicalEvent(envelope);
  let signer: `0x${string}`;
  try {
    signer = await recoverCanonicalEventSigner(
      authority.domain,
      event,
      envelope.signature as `0x${string}`,
    );
  } catch {
    throw new ProjectionAuthorizationError(
      "Contract projection signature or content is invalid",
    );
  }
  if (signer.toLowerCase() !== registered.signerAddress.toLowerCase())
    throw new ProjectionAuthorizationError(
      "Contract projection signer is not registered to its actor",
    );

  let payload: ContractWorkflowPayload;
  try {
    payload = parsePayload(envelope.event.eventType, envelope.event.payload);
  } catch {
    throw new ProjectionValidationError(
      "Contract projection payload is malformed",
    );
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
  };
}
