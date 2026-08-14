import type { ProjectionOutboxEvent } from "@abl/database";
import {
  GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  GOVERNANCE_WORKFLOW_EVENT_TYPES,
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  GovernanceProposalRegistrationPayloadSchema,
  isGovernanceWorkflowEventType,
  parseGovernanceWorkflowPayload,
  type GovernanceWorkflowPayload,
} from "@abl/institutions";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
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

export const GovernanceProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.governance"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(GOVERNANCE_WORKFLOW_AGGREGATE_TYPE),
    aggregateId: z.uuid(),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum(GOVERNANCE_WORKFLOW_EVENT_TYPES),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(GOVERNANCE_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: SignatureSchema,
});

export type GovernanceProjectionEventEnvelope = z.infer<
  typeof GovernanceProjectionEventEnvelopeSchema
>;

export interface GovernanceProjectionVerificationAuthority
  extends ProjectionVerificationAuthority {
  governanceEligibilitySnapshotDigest: string;
}

export interface VerifiedGovernanceProjectionEvent {
  envelope: GovernanceProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: GovernanceWorkflowPayload;
  signerAddress: `0x${string}`;
}

function canonicalEvent(
  envelope: GovernanceProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

export function governanceProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): GovernanceProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.governance" ||
    event.aggregateType !== GOVERNANCE_WORKFLOW_AGGREGATE_TYPE ||
    !isGovernanceWorkflowEventType(event.eventType) ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed public governance event",
    );
  }
  const parsed = GovernanceProjectionEventEnvelopeSchema.safeParse({
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
      "Outbox governance event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifyGovernanceProjectionEvent(
  input: unknown,
  authority: GovernanceProjectionVerificationAuthority,
): Promise<VerifiedGovernanceProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = GovernanceProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Governance projection envelope is malformed",
    );
  const envelope = parsed.data;
  const registered = authority.admittedAgents.get(envelope.event.actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(envelope.event.aggregateType)
  ) {
    throw new ProjectionAuthorizationError(
      "Governance projection actor is not admitted for this aggregate",
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
      "Governance projection signature or content is invalid",
    );
  }
  if (signerAddress.toLowerCase() !== registered.signerAddress.toLowerCase())
    throw new ProjectionAuthorizationError(
      "Governance projection signer is not registered to its actor",
    );

  let payload: GovernanceWorkflowPayload;
  try {
    payload = parseGovernanceWorkflowPayload(
      envelope.event.eventType,
      envelope.event.payload,
    );
  } catch {
    throw new ProjectionValidationError(
      "Governance projection payload is malformed",
    );
  }
  if (envelope.event.eventType === "GovernanceProposalRegistered") {
    const registration =
      GovernanceProposalRegistrationPayloadSchema.parse(payload);
    const snapshotMembers = new Set(
      Object.values(registration.eligibilitySnapshot.members).flat(),
    );
    if (
      sha256Commitment(registration.eligibilitySnapshot) !==
        authority.governanceEligibilitySnapshotDigest ||
      [...snapshotMembers].some((did) => {
        const member = authority.admittedAgents.get(did);
        return (
          member === undefined ||
          !member.allowedAggregateTypes.includes(
            GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
          )
        );
      })
    ) {
      throw new ProjectionAuthorizationError(
        "Governance projection uses an unauthorized eligibility snapshot",
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
