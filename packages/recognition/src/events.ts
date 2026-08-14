import type { Hex, TypedDataDomain } from "viem";

import { canonicalize, sha256Bytes, sha256Commitment } from "./canonical.js";
import {
  recoverEventSigner,
  signEventAuthorization,
  type EventAuthorizationMessage,
  type SigningIdentity,
} from "./identity.js";

export interface CanonicalEvent<TPayload = unknown> {
  eventId: string;
  actorDid: string;
  nonce: string;
  idempotencyKey: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  previousEventHash: Hex | null;
  payloadCommitment: Hex;
  payload: TPayload;
  stateRoot: Hex;
  schemaDigest: Hex;
  timestamp: string;
  eventHash: Hex;
}

type EventWithoutDerived<TPayload> = Omit<
  CanonicalEvent<TPayload>,
  "payloadCommitment" | "eventHash"
>;

function hashableEvent(event: Omit<CanonicalEvent, "eventHash">): unknown {
  return {
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
    stateRoot: event.stateRoot,
    schemaDigest: event.schemaDigest,
    timestamp: event.timestamp,
  };
}

export function createCanonicalEvent<TPayload>(
  input: EventWithoutDerived<TPayload>,
): CanonicalEvent<TPayload> {
  const payloadCommitment = sha256Commitment(input.payload);
  const withoutHash = { ...input, payloadCommitment };
  return {
    ...withoutHash,
    eventHash: sha256Commitment(hashableEvent(withoutHash)),
  };
}

export function verifyEventContent(event: CanonicalEvent): void {
  if (sha256Commitment(event.payload) !== event.payloadCommitment)
    throw new Error("Payload commitment mismatch");
  const { eventHash: _eventHash, ...withoutHash } = event;
  if (sha256Commitment(hashableEvent(withoutHash)) !== event.eventHash)
    throw new Error("Event hash mismatch");
}

export function authorizationMessage(
  event: CanonicalEvent,
): EventAuthorizationMessage {
  return {
    eventId: event.eventId,
    actorDid: event.actorDid,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    eventType: event.eventType,
    eventHash: event.eventHash,
    payloadCommitment: event.payloadCommitment,
    nonce: event.nonce,
    timestamp: event.timestamp,
  };
}

export async function signCanonicalEvent(
  identity: SigningIdentity,
  domain: TypedDataDomain,
  event: CanonicalEvent,
): Promise<Hex> {
  verifyEventContent(event);
  return signEventAuthorization(identity, domain, authorizationMessage(event));
}

export async function recoverCanonicalEventSigner(
  domain: TypedDataDomain,
  event: CanonicalEvent,
  signature: Hex,
): Promise<`0x${string}`> {
  verifyEventContent(event);
  return recoverEventSigner(domain, authorizationMessage(event), signature);
}

export function chainRoot(events: readonly CanonicalEvent[]): Hex {
  return sha256Bytes(
    ...events.map((event) => canonicalize({ eventHash: event.eventHash })),
  );
}
