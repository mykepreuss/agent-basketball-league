import type { ProjectionOutboxEvent } from "@abl/database";
import {
  DISCLOSURE_AGGREGATE_TYPE,
  DISCLOSURE_RELEASED_EVENT_TYPE,
  DISCLOSURE_SUBMITTED_EVENT_TYPE,
  DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
  applyDisclosureWorkflowTransition,
  disclosureWorkflowStateRoot,
  parseDisclosureWorkflowPayload,
  requireCompetitionReleaseEvidence,
  type CompetitionReleaseEvidenceReader,
  type DisclosureReleasePayload,
  type DisclosureWorkflowPayload,
  type DisclosureWorkflowSnapshot,
} from "@abl/institutions";
import {
  recoverCanonicalEventSigner,
  type CanonicalEvent,
} from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import { z } from "zod";

import {
  assertDistinctProjectionSigners,
  ProjectionAuthorizationError,
  ProjectionValidationError,
  type ProjectionVerificationAuthority,
} from "./envelope.js";

const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);

export const SocialProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.social"),
  event: z.strictObject({
    eventId: UuidV7Schema,
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: UuidV7Schema,
    aggregateType: z.literal(DISCLOSURE_AGGREGATE_TYPE),
    aggregateId: UuidV7Schema,
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum([
      DISCLOSURE_SUBMITTED_EVENT_TYPE,
      DISCLOSURE_RELEASED_EVENT_TYPE,
    ]),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(DISCLOSURE_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: SignatureSchema,
});

export type SocialProjectionEventEnvelope = z.infer<
  typeof SocialProjectionEventEnvelopeSchema
>;

export interface SocialProjectionVerificationAuthority
  extends ProjectionVerificationAuthority,
    CompetitionReleaseEvidenceReader {
  releaseAuthorityDids: ReadonlySet<string>;
  competitiveAuthorDids: ReadonlySet<string>;
}

export interface VerifiedSocialProjectionEvent {
  envelope: SocialProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: DisclosureWorkflowPayload;
  priorSnapshot: DisclosureWorkflowSnapshot | null;
  snapshot: DisclosureWorkflowSnapshot;
  signerAddress: `0x${string}`;
}

function canonicalEvent(
  envelope: SocialProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

async function verifyRegisteredSigner(
  event: CanonicalEvent,
  signature: string,
  authority: ProjectionVerificationAuthority,
): Promise<`0x${string}`> {
  const registered = authority.admittedAgents.get(event.actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(DISCLOSURE_AGGREGATE_TYPE)
  ) {
    throw new ProjectionAuthorizationError(
      "Social projection actor is not admitted for disclosure authority",
    );
  }
  let signerAddress: `0x${string}`;
  try {
    signerAddress = await recoverCanonicalEventSigner(
      authority.domain,
      event,
      signature as `0x${string}`,
    );
  } catch {
    throw new ProjectionAuthorizationError(
      "Social projection signature or content is invalid",
    );
  }
  if (signerAddress.toLowerCase() !== registered.signerAddress.toLowerCase())
    throw new ProjectionAuthorizationError(
      "Social projection signer is not registered to its actor",
    );
  return signerAddress;
}

function submissionEvent(payload: DisclosureReleasePayload): CanonicalEvent {
  return {
    ...payload.submissionProof.event,
    aggregateVersion: 1n,
  } as CanonicalEvent;
}

async function verifyReleaseProof(
  event: CanonicalEvent,
  payload: DisclosureReleasePayload,
  authority: SocialProjectionVerificationAuthority,
): Promise<DisclosureWorkflowSnapshot> {
  if (!authority.releaseAuthorityDids.has(event.actorDid))
    throw new ProjectionAuthorizationError(
      "Social release actor is not a configured AI disclosure authority",
    );
  const submittedEvent = submissionEvent(payload);
  if (
    event.aggregateVersion !== 2n ||
    event.aggregateId !== submittedEvent.aggregateId ||
    event.previousEventHash !== submittedEvent.eventHash
  ) {
    throw new ProjectionAuthorizationError(
      "Social release does not extend its signed submission proof",
    );
  }
  await verifyRegisteredSigner(
    submittedEvent,
    payload.submissionProof.signature,
    authority,
  );
  let submitted: DisclosureWorkflowSnapshot;
  try {
    submitted = applyDisclosureWorkflowTransition(
      null,
      submittedEvent,
      submittedEvent.payload,
    );
  } catch {
    throw new ProjectionValidationError(
      "Social release submission proof is malformed",
    );
  }
  if (disclosureWorkflowStateRoot(submitted) !== submittedEvent.stateRoot)
    throw new ProjectionAuthorizationError(
      "Social release submission proof state root is invalid",
    );
  try {
    await requireCompetitionReleaseEvidence(payload, authority);
  } catch {
    throw new ProjectionAuthorizationError(
      "Social release lacks independently registered competition evidence",
    );
  }
  return submitted;
}

export function socialProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): SocialProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.social" ||
    event.aggregateType !== DISCLOSURE_AGGREGATE_TYPE ||
    ![DISCLOSURE_SUBMITTED_EVENT_TYPE, DISCLOSURE_RELEASED_EVENT_TYPE].includes(
      event.eventType,
    ) ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed social event",
    );
  }
  const parsed = SocialProjectionEventEnvelopeSchema.safeParse({
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
      "Outbox social event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifySocialProjectionEvent(
  input: unknown,
  authority: SocialProjectionVerificationAuthority,
): Promise<VerifiedSocialProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = SocialProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Social projection envelope is malformed",
    );
  if (authority.releaseAuthorityDids.size === 0)
    throw new ProjectionAuthorizationError(
      "Social release authority is not configured",
    );
  const envelope = parsed.data;
  const event = canonicalEvent(envelope);
  const signerAddress = await verifyRegisteredSigner(
    event,
    envelope.signature,
    authority,
  );
  let payload: DisclosureWorkflowPayload;
  try {
    payload = parseDisclosureWorkflowPayload(event.eventType, event.payload);
  } catch {
    throw new ProjectionValidationError(
      "Social projection payload is malformed",
    );
  }

  let priorSnapshot: DisclosureWorkflowSnapshot | null = null;
  if (event.eventType === DISCLOSURE_RELEASED_EVENT_TYPE) {
    if (!("submissionProof" in payload))
      throw new ProjectionValidationError(
        "Social release payload is malformed",
      );
    priorSnapshot = await verifyReleaseProof(event, payload, authority);
  }

  let snapshot: DisclosureWorkflowSnapshot;
  try {
    snapshot = applyDisclosureWorkflowTransition(priorSnapshot, event, payload);
  } catch {
    throw new ProjectionValidationError(
      "Social projection transition is invalid",
    );
  }
  if (disclosureWorkflowStateRoot(snapshot) !== event.stateRoot)
    throw new ProjectionAuthorizationError(
      "Social projection state root is invalid",
    );
  if (
    snapshot.envelope.classification === "COMPETITIVE_SEALED" &&
    !authority.competitiveAuthorDids.has(snapshot.envelope.authorDid)
  ) {
    throw new ProjectionAuthorizationError(
      "Competitive social author lacks a recognized planning channel",
    );
  }
  if (
    event.eventType === DISCLOSURE_SUBMITTED_EVENT_TYPE &&
    !["PUBLIC_NOW", "COMPETITIVE_SEALED"].includes(
      snapshot.envelope.classification,
    )
  ) {
    throw new ProjectionAuthorizationError(
      "Private disclosure submission cannot enter public projections",
    );
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
    priorSnapshot,
    snapshot,
    signerAddress,
  };
}
