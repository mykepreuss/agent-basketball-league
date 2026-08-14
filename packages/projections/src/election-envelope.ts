import type { ProjectionOutboxEvent } from "@abl/database";
import {
  ELECTION_WORKFLOW_AGGREGATE_TYPE,
  ELECTION_WORKFLOW_EVENT_TYPES,
  ELECTION_WORKFLOW_SCHEMA_DIGEST,
  PremierElectionOpenPayloadSchema,
  isElectionWorkflowEventType,
  parseElectionWorkflowPayload,
  type ElectionWorkflowPayload,
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

export const ElectionProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.governance"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(ELECTION_WORKFLOW_AGGREGATE_TYPE),
    aggregateId: z.uuid(),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum(ELECTION_WORKFLOW_EVENT_TYPES),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(ELECTION_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: SignatureSchema,
});

export type ElectionProjectionEventEnvelope = z.infer<
  typeof ElectionProjectionEventEnvelopeSchema
>;

export interface ElectionProjectionVerificationAuthority
  extends ProjectionVerificationAuthority {
  governanceEligibilitySnapshotDigest: string;
}

export interface VerifiedElectionProjectionEvent {
  envelope: ElectionProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: ElectionWorkflowPayload;
}

function canonicalEvent(
  envelope: ElectionProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

export function electionProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): ElectionProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.governance" ||
    event.aggregateType !== ELECTION_WORKFLOW_AGGREGATE_TYPE ||
    !isElectionWorkflowEventType(event.eventType) ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed election event",
    );
  }
  const parsed = ElectionProjectionEventEnvelopeSchema.safeParse({
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
      "Outbox election event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifyElectionProjectionEvent(
  input: unknown,
  authority: ElectionProjectionVerificationAuthority,
): Promise<VerifiedElectionProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = ElectionProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Election projection envelope is malformed",
    );
  const envelope = parsed.data;
  const registered = authority.admittedAgents.get(envelope.event.actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(ELECTION_WORKFLOW_AGGREGATE_TYPE)
  ) {
    throw new ProjectionAuthorizationError(
      "Election projection actor is not admitted for this aggregate",
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
      "Election projection signature or content is invalid",
    );
  }
  if (signerAddress.toLowerCase() !== registered.signerAddress.toLowerCase())
    throw new ProjectionAuthorizationError(
      "Election projection signer is not registered to its actor",
    );

  let payload: ElectionWorkflowPayload;
  try {
    payload = parseElectionWorkflowPayload(
      envelope.event.eventType,
      envelope.event.payload,
    );
  } catch {
    throw new ProjectionValidationError(
      "Election projection payload is malformed",
    );
  }
  if (envelope.event.eventType === "PremierElectionOpened") {
    const opened = PremierElectionOpenPayloadSchema.parse(payload);
    const members = new Set([
      ...opened.eligibilitySnapshot.members.PREMIER_PLAYERS,
      ...opened.eligibilitySnapshot.members.EXECUTIVE_COMMISSION,
    ]);
    if (
      sha256Commitment(opened.eligibilitySnapshot) !==
        authority.governanceEligibilitySnapshotDigest ||
      opened.command.eligibilitySnapshotDigest !==
        authority.governanceEligibilitySnapshotDigest ||
      [...members].some((did) => {
        const member = authority.admittedAgents.get(did);
        return (
          member === undefined ||
          !member.allowedAggregateTypes.includes(
            ELECTION_WORKFLOW_AGGREGATE_TYPE,
          )
        );
      })
    ) {
      throw new ProjectionAuthorizationError(
        "Election projection uses an unauthorized eligibility snapshot",
      );
    }
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
  };
}
