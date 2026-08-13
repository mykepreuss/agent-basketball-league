import type { ProjectionOutboxEvent } from "@abl/database";
import {
  canonicalize,
  recoverCanonicalEventSigner,
  type CanonicalEvent,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import type { PublicGameProjection } from "./repository.js";
import {
  validatePossessionResolvedPayload,
  type ProjectionAgentAuthority,
} from "./payload.js";

const HashSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);

export const ProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.game"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: z.string().startsWith("did:").max(512),
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal("game-possession"),
    aggregateId: z.string().min(1).max(200),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.literal("PossessionResolved"),
    previousEventHash: HashSchema.nullable(),
    payloadCommitment: HashSchema,
    payload: z.unknown(),
    stateRoot: HashSchema,
    schemaDigest: HashSchema,
    timestamp: z.iso.datetime({ offset: true }),
    eventHash: HashSchema,
  }),
  signature: SignatureSchema,
});

export type ProjectionEventEnvelope = z.infer<
  typeof ProjectionEventEnvelopeSchema
>;

export interface ProjectionVerificationAuthority {
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<string, ProjectionAgentAuthority>;
}

export interface VerifiedProjectionEvent {
  envelope: ProjectionEventEnvelope;
  expectedVersion: string;
  projection: PublicGameProjection;
}

export class ProjectionAuthorizationError extends Error {
  public override readonly name = "ProjectionAuthorizationError";
}

export class ProjectionValidationError extends Error {
  public override readonly name = "ProjectionValidationError";
}

function canonicalEvent(envelope: ProjectionEventEnvelope): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

export function projectionEnvelopeBytes(input: unknown): Uint8Array {
  return canonicalize(input);
}

export function projectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): ProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.game" ||
    event.aggregateType !== "game-possession" ||
    event.eventType !== "PossessionResolved" ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed public game event",
    );
  }
  const candidate = {
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
  };
  const parsed = ProjectionEventEnvelopeSchema.safeParse(candidate);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Outbox event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifyProjectionEvent(
  input: unknown,
  authority: ProjectionVerificationAuthority,
  now: () => Date = () => new Date(),
): Promise<VerifiedProjectionEvent> {
  const parsed = ProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError("Projection envelope is malformed");
  const envelope = parsed.data;
  const registered = authority.admittedAgents.get(envelope.event.actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(envelope.event.aggregateType)
  ) {
    throw new ProjectionAuthorizationError(
      "Projection actor is not admitted for this aggregate",
    );
  }
  let signer: `0x${string}`;
  try {
    signer = await recoverCanonicalEventSigner(
      authority.domain,
      canonicalEvent(envelope),
      envelope.signature as `0x${string}`,
    );
  } catch {
    throw new ProjectionAuthorizationError(
      "Projection event signature or content is invalid",
    );
  }
  if (signer.toLowerCase() !== registered.signerAddress.toLowerCase())
    throw new ProjectionAuthorizationError(
      "Projection event signer is not registered to its actor",
    );

  let payload: ReturnType<typeof validatePossessionResolvedPayload>;
  try {
    payload = validatePossessionResolvedPayload(
      envelope.event.payload,
      envelope.event.aggregateId,
      envelope.event.stateRoot,
    );
  } catch {
    throw new ProjectionValidationError(
      "Projection event payload is internally inconsistent",
    );
  }
  return {
    envelope,
    expectedVersion: (BigInt(envelope.event.aggregateVersion) - 1n).toString(),
    projection: {
      ...payload.source,
      state: "REHEARSAL",
      canonical: true,
      verification: "CANONICAL_LOCAL_REHEARSAL",
      aggregateVersion: envelope.event.aggregateVersion,
      canonicalEventHash: envelope.event.eventHash as `0x${string}`,
      projectedAt: now().toISOString(),
    },
  };
}
