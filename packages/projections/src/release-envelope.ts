import type { ProjectionOutboxEvent } from "@abl/database";
import {
  RELEASE_WORKFLOW_AGGREGATE_TYPE,
  RELEASE_WORKFLOW_EVENT_TYPES,
  RELEASE_WORKFLOW_SCHEMA_DIGEST,
  ReleaseApprovalPayloadSchema,
  ReleaseStayPayloadSchema,
  ReleaseWorkflowAuthorizationError,
  ReleaseWorkflowValidationError,
  isReleaseWorkflowEventType,
  parseReleaseWorkflowPayload,
  releaseInstitutionalDids,
  releaseRoleDids,
  validateReleaseInstitutionalRoster,
  type ReleaseInstitutionalRoster,
  type ReleaseWorkflowEventType,
  type ReleaseWorkflowPayload,
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

export const ReleaseProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.releases"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(RELEASE_WORKFLOW_AGGREGATE_TYPE),
    aggregateId: z.uuid(),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum(RELEASE_WORKFLOW_EVENT_TYPES),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(RELEASE_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signatures: z.array(SignatureSchema).min(1).max(5),
});

export type ReleaseProjectionEventEnvelope = z.infer<
  typeof ReleaseProjectionEventEnvelopeSchema
>;

export interface ReleaseProjectionVerificationAuthority
  extends ProjectionVerificationAuthority {
  releaseInstitutionalRoster: ReleaseInstitutionalRoster;
}

export interface VerifiedReleaseProjectionEvent {
  envelope: ReleaseProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: ReleaseWorkflowPayload;
  signerAddresses: readonly `0x${string}`[];
}

function canonicalEvent(
  envelope: ReleaseProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

export function releaseProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): ReleaseProjectionEventEnvelope {
  if (
    event.topic !== "public.releases" ||
    event.aggregateType !== RELEASE_WORKFLOW_AGGREGATE_TYPE ||
    !isReleaseWorkflowEventType(event.eventType)
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible release event",
    );
  }
  const parsed = ReleaseProjectionEventEnvelopeSchema.safeParse({
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
      "Outbox release event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

function requireRegisteredActor(
  authority: ReleaseProjectionVerificationAuthority,
  actorDid: string,
) {
  const registered = authority.admittedAgents.get(actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(RELEASE_WORKFLOW_AGGREGATE_TYPE)
  ) {
    throw new ProjectionAuthorizationError(
      "Release projection actor is not admitted for this aggregate",
    );
  }
  return registered;
}

function requireSameAddressSet(
  expected: readonly string[],
  actual: readonly string[],
): void {
  const normalizedExpected = expected.map((address) => address.toLowerCase());
  const normalizedActual = actual.map((address) => address.toLowerCase());
  if (
    new Set(normalizedExpected).size !== normalizedExpected.length ||
    new Set(normalizedActual).size !== normalizedActual.length ||
    normalizedExpected.length !== normalizedActual.length ||
    normalizedExpected.some((address) => !normalizedActual.includes(address))
  ) {
    throw new ProjectionAuthorizationError(
      "Release projection signatures do not match the declared agents",
    );
  }
}

export async function verifyReleaseProjectionEvent(
  input: unknown,
  authority: ReleaseProjectionVerificationAuthority,
): Promise<VerifiedReleaseProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  validateReleaseInstitutionalRoster(authority.releaseInstitutionalRoster);
  const officeAddresses = [
    ...releaseInstitutionalDids(authority.releaseInstitutionalRoster),
  ].map((did) =>
    requireRegisteredActor(authority, did).signerAddress.toLowerCase(),
  );
  if (new Set(officeAddresses).size !== officeAddresses.length)
    throw new ProjectionAuthorizationError(
      "Release institutional roster aliases a signing key",
    );
  const parsed = ReleaseProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Release projection envelope is malformed",
    );
  const envelope = parsed.data;
  const event = canonicalEvent(envelope);
  let payload: ReleaseWorkflowPayload;
  try {
    payload = parseReleaseWorkflowPayload(
      event.eventType as ReleaseWorkflowEventType,
      event.payload,
    );
  } catch (error) {
    if (
      error instanceof ReleaseWorkflowValidationError ||
      error instanceof ReleaseWorkflowAuthorizationError ||
      error instanceof z.ZodError
    ) {
      throw new ProjectionValidationError(
        "Release projection payload is malformed",
      );
    }
    throw error;
  }
  let signerAddresses: `0x${string}`[];
  try {
    signerAddresses = await Promise.all(
      envelope.signatures.map((signature) =>
        recoverCanonicalEventSigner(
          authority.domain,
          event,
          signature as `0x${string}`,
        ),
      ),
    );
  } catch {
    throw new ProjectionAuthorizationError(
      "Release projection signature or content is invalid",
    );
  }
  if (event.eventType === "ReleaseStayed") {
    const command = ReleaseStayPayloadSchema.parse(payload).command;
    if (
      command.participatingTribunalDids.some(
        (did) =>
          !authority.releaseInstitutionalRoster.tribunalDids.includes(did),
      ) ||
      command.recusedTribunalDids.some(
        (did) =>
          !authority.releaseInstitutionalRoster.tribunalDids.includes(did),
      )
    ) {
      throw new ProjectionAuthorizationError(
        "Release stay signer or recusal is outside the Tribunal",
      );
    }
    const expected = command.participatingTribunalDids.map(
      (did) => requireRegisteredActor(authority, did).signerAddress,
    );
    requireSameAddressSet(expected, signerAddresses);
  } else {
    const registered = requireRegisteredActor(authority, event.actorDid);
    requireSameAddressSet([registered.signerAddress], signerAddresses);
    if (event.eventType === "ReleaseApproved") {
      const command = ReleaseApprovalPayloadSchema.parse(payload).command;
      if (
        !releaseRoleDids(
          authority.releaseInstitutionalRoster,
          command.role,
        ).includes(event.actorDid)
      ) {
        throw new ProjectionAuthorizationError(
          "Release projection approver lacks the declared role",
        );
      }
    }
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
    signerAddresses,
  };
}
