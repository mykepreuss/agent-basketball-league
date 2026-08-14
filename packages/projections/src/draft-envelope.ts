import type { ProjectionOutboxEvent } from "@abl/database";
import {
  PREMIER_DRAFT_AGGREGATE_TYPE,
  PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
  PREMIER_DRAFT_SCHEMA_DIGEST,
  PremierDraftCompletedPayloadSchema,
  requirePremierDraftEvidence,
  validatePremierDraftCompletion,
  type PremierDraftCompletedPayload,
  type PremierDraftEvidenceReader,
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

export const DraftProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.draft"),
  event: z.strictObject({
    eventId: UuidV7Schema,
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: UuidV7Schema,
    aggregateType: z.literal(PREMIER_DRAFT_AGGREGATE_TYPE),
    aggregateId: UuidV7Schema,
    aggregateVersion: z.literal("1"),
    eventType: z.literal(PREMIER_DRAFT_COMPLETED_EVENT_TYPE),
    previousEventHash: z.null(),
    payloadCommitment: Sha256Schema,
    payload: PremierDraftCompletedPayloadSchema,
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(PREMIER_DRAFT_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signatures: z.array(SignatureSchema).length(5),
});

export type DraftProjectionEventEnvelope = z.infer<
  typeof DraftProjectionEventEnvelopeSchema
>;

export interface DraftProjectionVerificationAuthority
  extends ProjectionVerificationAuthority {
  draftAuthorityDid: string;
  draftClubGovernors: Readonly<Record<string, string>>;
  premierDraftEvidence: PremierDraftEvidenceReader["premierDraftEvidence"];
}

export interface VerifiedDraftProjectionEvent {
  envelope: DraftProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: "0";
  payload: PremierDraftCompletedPayload;
}

function canonicalEvent(
  envelope: DraftProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: 1n,
  } as CanonicalEvent;
}

export function draftProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): DraftProjectionEventEnvelope {
  const parsed = DraftProjectionEventEnvelopeSchema.safeParse({
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
    signatures: event.signatures,
  });
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed public draft event",
    );
  return parsed.data;
}

export async function verifyDraftProjectionEvent(
  input: unknown,
  authority: DraftProjectionVerificationAuthority,
): Promise<VerifiedDraftProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = DraftProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError("Draft projection is malformed");
  const envelope = parsed.data;
  let payload: PremierDraftCompletedPayload;
  try {
    payload = validatePremierDraftCompletion(envelope.event.payload);
  } catch {
    throw new ProjectionValidationError("Draft projection payload is invalid");
  }
  try {
    await requirePremierDraftEvidence(payload, authority);
  } catch {
    throw new ProjectionAuthorizationError(
      "Draft projection independent evidence is invalid",
    );
  }
  const configuredClubs = Object.keys(authority.draftClubGovernors);
  const signerDids = [
    authority.draftAuthorityDid,
    ...payload.clubOrder.map(
      (clubId) => authority.draftClubGovernors[clubId] ?? "",
    ),
  ];
  if (
    envelope.event.actorDid !== authority.draftAuthorityDid ||
    envelope.event.aggregateId !== payload.draftId ||
    envelope.event.timestamp !== payload.completedAt ||
    configuredClubs.length !== 4 ||
    new Set([...configuredClubs, ...payload.clubOrder]).size !== 4 ||
    signerDids.some((did) => did === "") ||
    new Set(signerDids).size !== 5
  ) {
    throw new ProjectionAuthorizationError(
      "Draft projection authority roster is invalid",
    );
  }
  const event = canonicalEvent(envelope);
  const expectedAddresses = signerDids.map((did) => {
    const registered = authority.admittedAgents.get(did);
    if (
      registered === undefined ||
      !registered.allowedAggregateTypes.includes(PREMIER_DRAFT_AGGREGATE_TYPE)
    ) {
      throw new ProjectionAuthorizationError(
        "Draft projection signer lacks aggregate scope",
      );
    }
    return registered.signerAddress;
  });
  if (
    new Set(expectedAddresses.map((address) => address.toLowerCase())).size !==
    5
  ) {
    throw new ProjectionAuthorizationError(
      "Draft projection signer keys are not distinct",
    );
  }
  const recovered = await Promise.all(
    envelope.signatures.map(async (signature) => {
      try {
        return await recoverCanonicalEventSigner(
          authority.domain,
          event,
          signature as `0x${string}`,
        );
      } catch {
        throw new ProjectionAuthorizationError(
          "Draft projection signature or event content is invalid",
        );
      }
    }),
  );
  if (
    recovered.some(
      (address, index) =>
        address.toLowerCase() !== expectedAddresses[index]!.toLowerCase(),
    )
  ) {
    throw new ProjectionAuthorizationError(
      "Draft projection signatures are not in constitutional order",
    );
  }
  return { envelope, event, expectedVersion: "0", payload };
}
