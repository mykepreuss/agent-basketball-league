import type { ProjectionOutboxEvent } from "@abl/database";
import {
  CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
  CandidateWorkflowPayloadSchemas,
} from "@abl/career";
import {
  recoverCanonicalEventSigner,
  signingPublicKeyToAddress,
  type CanonicalEvent,
} from "@abl/recognition";
import { DidSchema, IsoDateTimeSchema, Sha256Schema } from "@abl/schemas";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import {
  ProjectionAuthorizationError,
  ProjectionValidationError,
} from "./envelope.js";

const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);
const ModelProjectionEventTypeSchema = z.enum([
  "CandidateAdmitted",
  "CandidateClosed",
]);

export const ModelProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.models"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal("candidate-admission"),
    aggregateId: DidSchema,
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: ModelProjectionEventTypeSchema,
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(CANDIDATE_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: SignatureSchema,
});

export type ModelProjectionEventEnvelope = z.infer<
  typeof ModelProjectionEventEnvelopeSchema
>;

type AdmissionPayload = z.infer<
  (typeof CandidateWorkflowPayloadSchemas)["CandidateAdmitted"]
>;
type RevocationPayload = z.infer<
  (typeof CandidateWorkflowPayloadSchemas)["CandidateClosed"]
>;

export type VerifiedModelProjectionEvent =
  | {
      envelope: ModelProjectionEventEnvelope;
      event: CanonicalEvent;
      expectedVersion: string;
      action: "ADMIT";
      payload: AdmissionPayload;
      signerAddress: `0x${string}`;
    }
  | {
      envelope: ModelProjectionEventEnvelope;
      event: CanonicalEvent;
      expectedVersion: string;
      action: "REVOKE";
      payload: RevocationPayload & { action: "REVOKE" };
      signerAddress: `0x${string}`;
    };

function canonicalEvent(
  envelope: ModelProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

export function modelProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): ModelProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.models" ||
    event.aggregateType !== "candidate-admission" ||
    (event.eventType !== "CandidateAdmitted" &&
      event.eventType !== "CandidateClosed") ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed model dependency event",
    );
  }
  const parsed = ModelProjectionEventEnvelopeSchema.safeParse({
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
      "Outbox model dependency event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifyModelProjectionEvent(
  input: unknown,
  authority: { domain: TypedDataDomain },
): Promise<VerifiedModelProjectionEvent> {
  const parsed = ModelProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Model dependency projection envelope is malformed",
    );
  const envelope = parsed.data;
  if (envelope.event.aggregateId !== envelope.event.actorDid) {
    throw new ProjectionAuthorizationError(
      "Model dependency projection actor does not own the career aggregate",
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
      "Model dependency projection signature or content is invalid",
    );
  }
  const expectedVersion = (event.aggregateVersion - 1n).toString();
  if (event.eventType === "CandidateAdmitted") {
    let payload: AdmissionPayload;
    try {
      payload = CandidateWorkflowPayloadSchemas.CandidateAdmitted.parse(
        event.payload,
      );
    } catch {
      throw new ProjectionValidationError(
        "Model dependency admission payload is malformed",
      );
    }
    let admissionAddress: string;
    try {
      admissionAddress = signingPublicKeyToAddress(
        payload.admission.signingPublicKey as `0x${string}`,
      );
    } catch {
      throw new ProjectionAuthorizationError(
        "Model dependency admission signing key is invalid",
      );
    }
    if (
      event.aggregateVersion < 10n ||
      event.previousEventHash === null ||
      payload.admission.candidateDid !== event.actorDid ||
      payload.admission.signedAt !== event.timestamp ||
      admissionAddress.toLowerCase() !== signer.toLowerCase()
    ) {
      throw new ProjectionAuthorizationError(
        "Model dependency admission does not bind the registered career",
      );
    }
    return {
      envelope,
      event,
      expectedVersion,
      action: "ADMIT",
      payload,
      signerAddress: signer,
    };
  }

  let payload: RevocationPayload;
  try {
    payload = CandidateWorkflowPayloadSchemas.CandidateClosed.parse(
      event.payload,
    );
  } catch {
    throw new ProjectionValidationError(
      "Model dependency revocation payload is malformed",
    );
  }
  if (payload.action !== "REVOKE" || payload.actedAt !== event.timestamp)
    throw new ProjectionAuthorizationError(
      "Model dependency removal is not an admission revocation",
    );
  return {
    envelope,
    event,
    expectedVersion,
    action: "REVOKE",
    payload: { ...payload, action: "REVOKE" },
    signerAddress: signer,
  };
}
