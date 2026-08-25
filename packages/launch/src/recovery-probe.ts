import type { ProjectionOutboxStore } from "@abl/database";
import {
  createCanonicalEvent,
  recoverCanonicalEventSigner,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";

const aggregateType = "recovery-probe";
const aggregateId = "0198e000-0000-7000-8000-000000000101";
const eventId = "0198e000-0000-7000-8000-000000000102";
const idempotencyKey = "0198e000-0000-7000-8000-000000000103";
const outboxTopic = "private.recovery-probe";

export async function seedPersistentRecoveryProbe(input: {
  store: ProjectionOutboxStore;
  domain: TypedDataDomain;
  identity: SigningIdentity;
  occurredAt: string;
}) {
  const payload = {
    classification: "PRE_GENESIS_EXPERIMENT",
    purpose: "PERSISTENT_RECOVERY_VERIFICATION",
    canonicalHistoryClaim: false,
    genesis: false,
  } as const;
  const event = createCanonicalEvent({
    eventId,
    actorDid: "did:abl:recovery-probe",
    nonce: "persistent-recovery-probe-1",
    idempotencyKey,
    aggregateType,
    aggregateId,
    aggregateVersion: 1n,
    eventType: "RecoveryProbeRecorded",
    previousEventHash: null,
    payload,
    stateRoot: sha256Commitment({ aggregateId, payload }),
    schemaDigest: sha256Commitment("RecoveryProbeRecorded:1.0.0"),
    timestamp: input.occurredAt,
  });
  const signature = await signCanonicalEvent(
    input.identity,
    input.domain,
    event,
  );
  const recoveredSigner = await recoverCanonicalEventSigner(
    input.domain,
    event,
    signature,
  );
  if (recoveredSigner.toLowerCase() !== input.identity.address.toLowerCase())
    throw new Error("Recovery-probe signature did not recover its signer");

  const result = await input.store.append({
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({
      eventHash: event.eventHash,
      signatures: [signature],
    }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: event.aggregateVersion - 1n,
    competitionId: "pre-genesis-recovery",
    seasonId: "pre-genesis",
    eventType: event.eventType,
    previousEventHash: event.previousEventHash,
    eventHash: event.eventHash,
    payloadSchemaDigest: event.schemaDigest,
    payloadCommitment: event.payloadCommitment,
    payload: event.payload,
    stateRoot: event.stateRoot,
    signatures: [signature],
    occurredAt: new Date(event.timestamp),
    outboxTopic,
  });
  const [events, pendingOutbox] = await Promise.all([
    input.store.readAggregate(aggregateType, aggregateId),
    input.store.pendingProjectionEvents(100, outboxTopic),
  ]);
  const matchingEvents = events.filter(
    (candidate) => candidate.eventId === event.eventId,
  );
  const matchingOutbox = pendingOutbox.filter(
    (candidate) => candidate.eventId === event.eventId,
  );
  if (matchingEvents.length !== 1 || matchingOutbox.length !== 1)
    throw new Error("Recovery probe did not persist one event and outbox row");

  return {
    version: 1,
    evidenceClass: "PERSISTENT_RECOVERY_PROBE",
    classification: payload.classification,
    eventId: event.eventId,
    eventHash: event.eventHash,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: result.aggregateVersion.toString(),
    duplicate: result.duplicate,
    eventCount: matchingEvents.length,
    outboxCount: matchingOutbox.length,
    outboxTopic,
    signatureVerified: true,
    canonicalHistoryClaim: false,
    genesis: false,
    secretValuesRecorded: false,
  } as const;
}
