import type { StoredCanonicalEvent } from "@abl/database";
import type { CanonicalEvent } from "@abl/recognition";
import {
  CanonicalEventWireSchema,
  Eip712SignatureSchema,
  SignedCanonicalAssemblyCommandSchema,
  SignedCanonicalCommandSchema,
  SignedCanonicalMultiCommandSchema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

export const CanonicalSignatureSchema = Eip712SignatureSchema;
export {
  SignedCanonicalAssemblyCommandSchema,
  SignedCanonicalCommandSchema,
  SignedCanonicalMultiCommandSchema,
};

export function materializeCanonicalEvent(
  event: z.infer<typeof CanonicalEventWireSchema>,
): CanonicalEvent {
  return {
    ...event,
    aggregateVersion: BigInt(event.aggregateVersion),
  } as CanonicalEvent;
}

export function canonicalEventFromStored(
  record: StoredCanonicalEvent,
): CanonicalEvent {
  return {
    eventId: record.eventId,
    actorDid: record.actorDid,
    nonce: record.nonce,
    idempotencyKey: record.idempotencyKey,
    aggregateType: record.aggregateType,
    aggregateId: record.aggregateId,
    aggregateVersion: record.aggregateVersion,
    eventType: record.eventType,
    previousEventHash: record.previousEventHash as Hex | null,
    payloadCommitment: record.payloadCommitment as Hex,
    payload: record.payload,
    stateRoot: record.stateRoot as Hex,
    schemaDigest: record.payloadSchemaDigest as Hex,
    timestamp: record.occurredAt.toISOString(),
    eventHash: record.eventHash as Hex,
  };
}
