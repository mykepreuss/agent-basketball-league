import type { ProjectionOutboxEvent } from "@abl/database";
import {
  DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
  DEVELOPMENT_WORKFLOW_EVENT_TYPES,
  DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
  DevelopmentCharterPayloadSchema,
  expectedDevelopmentSignerDids,
  parseDevelopmentWorkflowPayload,
  requireDevelopmentWorkflowRatifications,
  developmentWorkflowAuthorizedDids,
  type DevelopmentWorkflowEventType,
  type DevelopmentWorkflowPayload,
  type DevelopmentWorkflowSignerAuthority,
  type ResourceScheduleRatificationReader,
} from "@abl/institutions";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  verifyEventContent,
  type CanonicalEvent,
} from "@abl/recognition";
import { DidSchema, IsoDateTimeSchema, Sha256Schema } from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import {
  assertDistinctProjectionSigners,
  ProjectionAuthorizationError,
  ProjectionValidationError,
  type ProjectionVerificationAuthority,
} from "./envelope.js";

const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);

export const DevelopmentProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.development"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE),
    aggregateId: z.string().min(1).max(100),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum(DEVELOPMENT_WORKFLOW_EVENT_TYPES),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signatures: z.array(SignatureSchema).min(1).max(45),
});

export type DevelopmentProjectionEventEnvelope = z.infer<
  typeof DevelopmentProjectionEventEnvelopeSchema
>;

export interface DevelopmentProjectionVerificationAuthority
  extends ProjectionVerificationAuthority,
    DevelopmentWorkflowSignerAuthority {
  conferenceId: string;
  competitionId: string;
  seasonId: string;
  tierCbaRatification: ResourceScheduleRatificationReader;
}

export interface VerifiedDevelopmentProjectionEvent {
  envelope: DevelopmentProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: DevelopmentWorkflowPayload;
}

function canonicalEvent(
  envelope: DevelopmentProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

function verifyConfiguredConference(
  authority: DevelopmentProjectionVerificationAuthority,
  eventType: DevelopmentWorkflowEventType,
  payload: DevelopmentWorkflowPayload,
): void {
  if (eventType !== "DevelopmentConferenceChartered") return;
  const { command } = DevelopmentCharterPayloadSchema.parse(payload);
  if (
    command.conferenceId !== authority.conferenceId ||
    command.competitionId !== authority.competitionId ||
    command.seasonId !== authority.seasonId
  ) {
    throw new ProjectionAuthorizationError(
      "Development projection is outside the configured conference",
    );
  }
}

async function verifySignatures(
  envelope: DevelopmentProjectionEventEnvelope,
  event: CanonicalEvent,
  payload: DevelopmentWorkflowPayload,
  authority: DevelopmentProjectionVerificationAuthority,
): Promise<void> {
  const signerDids = expectedDevelopmentSignerDids(
    event.eventType as DevelopmentWorkflowEventType,
    payload,
    authority,
  );
  if (
    signerDids.some((did) => typeof did !== "string" || did === "") ||
    new Set(signerDids).size !== signerDids.length ||
    envelope.signatures.length !== signerDids.length ||
    event.actorDid !== signerDids[0] ||
    sha256Commitment(developmentWorkflowAuthorizedDids(payload)) !==
      sha256Commitment(signerDids)
  ) {
    throw new ProjectionAuthorizationError(
      "Development projection lacks its exact ordered careers",
    );
  }
  const signerAuthorities = signerDids.map((did) => {
    const signer = authority.admittedAgents.get(did);
    if (
      signer === undefined ||
      !signer.allowedAggregateTypes.includes(
        DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
      )
    ) {
      throw new ProjectionAuthorizationError(
        "Development projection signer lacks admitted authority",
      );
    }
    return signer;
  });
  const addresses = signerAuthorities.map(({ signerAddress }) =>
    signerAddress.toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length)
    throw new ProjectionAuthorizationError(
      "Development projection signers alias a career key",
    );
  await Promise.all(
    signerAuthorities.map(async ({ signerAddress }, index) => {
      try {
        const recovered = await recoverCanonicalEventSigner(
          authority.domain,
          event,
          envelope.signatures[index] as Hex,
        );
        if (recovered.toLowerCase() !== signerAddress.toLowerCase())
          throw new Error("wrong signer");
      } catch {
        throw new ProjectionAuthorizationError(
          "Development projection signature is invalid",
        );
      }
    }),
  );
}

export function developmentProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): DevelopmentProjectionEventEnvelope {
  if (
    event.topic !== "public.development" ||
    event.aggregateType !== DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE ||
    !DEVELOPMENT_WORKFLOW_EVENT_TYPES.includes(
      event.eventType as DevelopmentWorkflowEventType,
    ) ||
    event.signatures.length === 0 ||
    event.signatures.length > 45
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible development event",
    );
  }
  const parsed = DevelopmentProjectionEventEnvelopeSchema.safeParse({
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
      "Development event cannot be encoded for projection",
    );
  return parsed.data;
}

export async function verifyDevelopmentProjectionEvent(
  input: unknown,
  authority: DevelopmentProjectionVerificationAuthority,
): Promise<VerifiedDevelopmentProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = DevelopmentProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Development projection envelope is malformed",
    );
  const envelope = parsed.data;
  const event = canonicalEvent(envelope);
  if (event.aggregateId !== authority.conferenceId)
    throw new ProjectionAuthorizationError(
      "Development projection substitutes the configured conference",
    );
  try {
    verifyEventContent(event);
  } catch {
    throw new ProjectionAuthorizationError(
      "Development projection event content is invalid",
    );
  }
  let payload: DevelopmentWorkflowPayload;
  try {
    payload = parseDevelopmentWorkflowPayload(
      event.eventType as DevelopmentWorkflowEventType,
      event.payload,
    );
  } catch {
    throw new ProjectionValidationError(
      "Development projection payload is malformed",
    );
  }
  verifyConfiguredConference(
    authority,
    event.eventType as DevelopmentWorkflowEventType,
    payload,
  );
  await verifySignatures(envelope, event, payload, authority);
  try {
    await requireDevelopmentWorkflowRatifications(
      event.eventType as DevelopmentWorkflowEventType,
      payload,
      authority.tierCbaRatification,
    );
  } catch {
    throw new ProjectionAuthorizationError(
      "Development projection lacks its exact tier CBA ratification",
    );
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
  };
}
