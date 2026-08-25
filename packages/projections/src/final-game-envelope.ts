import {
  FINALIZED_GAME_AGGREGATE_TYPE,
  FINALIZED_GAME_SCHEMA_DIGEST,
  GAME_FINALIZED_EVENT_TYPE,
  PacedBroadcast,
  finalizedGameStateRoot,
  replayFinalizedGamePayload,
  requireFinalizedGameEvidence,
  requireFinalizedGameScheduleEvidence,
  type FinalizedGameEvidenceReader,
  type FinalizedGameScheduleEvidenceReader,
} from "@abl/basketball";
import type { ProjectionOutboxEvent } from "@abl/database";
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
import type { PublicFinalizedGameProjection } from "./final-game-repository.js";

const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);

export const FinalGameProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.finalized-game"),
  event: z.strictObject({
    eventId: UuidV7Schema,
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: UuidV7Schema,
    aggregateType: z.literal(FINALIZED_GAME_AGGREGATE_TYPE),
    aggregateId: UuidV7Schema,
    aggregateVersion: z.literal("1"),
    eventType: z.literal(GAME_FINALIZED_EVENT_TYPE),
    previousEventHash: z.null(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(FINALIZED_GAME_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: SignatureSchema,
});

export type FinalGameProjectionEventEnvelope = z.infer<
  typeof FinalGameProjectionEventEnvelopeSchema
>;

export interface FinalGameProjectionVerificationAuthority
  extends ProjectionVerificationAuthority,
    FinalizedGameEvidenceReader {
  finalizerDids: ReadonlySet<string>;
  scheduleEvidence?: FinalizedGameScheduleEvidenceReader;
}

export interface VerifiedFinalGameProjectionEvent {
  envelope: FinalGameProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: "0";
  projection: PublicFinalizedGameProjection;
  signerAddress: `0x${string}`;
}

function canonicalEvent(
  envelope: FinalGameProjectionEventEnvelope,
): CanonicalEvent {
  return { ...envelope.event, aggregateVersion: 1n } as CanonicalEvent;
}

export function finalGameProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): FinalGameProjectionEventEnvelope {
  const signature = event.signatures[0];
  if (
    event.topic !== "public.finalized-game" ||
    event.aggregateType !== FINALIZED_GAME_AGGREGATE_TYPE ||
    event.eventType !== GAME_FINALIZED_EVENT_TYPE ||
    event.aggregateVersion !== 1n ||
    event.previousEventHash !== null ||
    event.signatures.length !== 1 ||
    typeof signature !== "string"
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible finalized game",
    );
  }
  const parsed = FinalGameProjectionEventEnvelopeSchema.safeParse({
    version: "1.0.0",
    topic: event.topic,
    event: {
      eventId: event.eventId,
      actorDid: event.actorDid,
      nonce: event.nonce,
      idempotencyKey: event.idempotencyKey,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: "1",
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
      "Finalized game cannot be encoded for projection",
    );
  return parsed.data;
}

export async function verifyFinalGameProjectionEvent(
  input: unknown,
  authority: FinalGameProjectionVerificationAuthority,
  projectedAt = new Date().toISOString(),
): Promise<VerifiedFinalGameProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = FinalGameProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Finalized game projection envelope is malformed",
    );
  const envelope = parsed.data;
  const event = canonicalEvent(envelope);
  const registered = authority.admittedAgents.get(event.actorDid);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(FINALIZED_GAME_AGGREGATE_TYPE) ||
    !authority.finalizerDids.has(event.actorDid)
  ) {
    throw new ProjectionAuthorizationError(
      "Finalized game actor lacks configured authority",
    );
  }
  let signerAddress: `0x${string}`;
  try {
    signerAddress = await recoverCanonicalEventSigner(
      authority.domain,
      event,
      envelope.signature as `0x${string}`,
    );
  } catch {
    throw new ProjectionAuthorizationError(
      "Finalized game signature or content is invalid",
    );
  }
  if (signerAddress.toLowerCase() !== registered.signerAddress.toLowerCase())
    throw new ProjectionAuthorizationError(
      "Finalized game signer is not registered to its actor",
    );
  let replayed: ReturnType<typeof replayFinalizedGamePayload>;
  try {
    replayed = replayFinalizedGamePayload(event.payload);
    await requireFinalizedGameEvidence(replayed.payload, authority);
    await requireFinalizedGameScheduleEvidence(
      replayed.payload,
      authority.scheduleEvidence,
    );
  } catch {
    throw new ProjectionAuthorizationError(
      "Finalized game replay or independent evidence is invalid",
    );
  }
  if (
    replayed.payload.gameId !== event.aggregateId ||
    replayed.payload.finalizedAt !== event.timestamp ||
    finalizedGameStateRoot(replayed.payload) !== event.stateRoot
  ) {
    throw new ProjectionAuthorizationError(
      "Finalized game event does not bind its replayed state",
    );
  }
  const broadcast = new PacedBroadcast();
  const startedAt = Date.parse(replayed.payload.broadcastStartedAt);
  const projectedAtValue = IsoDateTimeSchema.parse(projectedAt);
  const finalReleaseAt =
    startedAt +
    (replayed.events.length - 1) * replayed.payload.broadcastIntervalMs;
  if (finalReleaseAt > Date.parse(projectedAtValue))
    throw new ProjectionAuthorizationError(
      "Finalized game contains unreleased broadcast segments",
    );
  const segments = replayed.events.map((gameEvent, index) =>
    broadcast.publish(
      gameEvent,
      new Date(
        startedAt + index * replayed.payload.broadcastIntervalMs,
      ).toISOString(),
    ),
  );
  const { state } = replayed;
  return {
    envelope,
    event,
    expectedVersion: "0",
    signerAddress,
    projection: {
      state: "REHEARSAL",
      canonical: true,
      verification: "CANONICAL_LOCAL_REHEARSAL",
      recognizedGenesisGame: false,
      projectionKind: "FINALIZED_GAME",
      gameId: replayed.payload.gameId,
      competition: replayed.payload.competition,
      aggregateVersion: "1",
      canonicalEventHash: event.eventHash as `0x${string}`,
      phase: "FINAL",
      period: state.period,
      periodKind: state.periodKind,
      score: state.score,
      winner: state.winner!,
      commandCount: replayed.payload.commands.length,
      possessionCount: replayed.payload.agentEvidence.possessionCount,
      events: replayed.events,
      snapshots: replayed.snapshots,
      segments,
      finalStateRoot: replayed.payload.proof.finalStateRoot as `0x${string}`,
      eventMerkleRoot: replayed.payload.proof.eventMerkleRoot as `0x${string}`,
      finalEventHash: replayed.payload.proof.finalEventHash as `0x${string}`,
      agentEvidence: replayed.payload.agentEvidence,
      filmCommitment: replayed.payload.filmCommitment as `0x${string}`,
      replayInferenceInvocations: 0,
      projectedAt: projectedAtValue,
    },
  };
}
