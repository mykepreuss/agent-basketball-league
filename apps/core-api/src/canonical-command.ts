import type { StoredCanonicalEvent } from "@abl/database";
import type { CanonicalEvent } from "@abl/recognition";
import type { Hex } from "viem";
import { z } from "zod";

export const CanonicalSignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);

const HexSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const CanonicalEventSchema = z.strictObject({
  eventId: z.uuid(),
  actorDid: z.string().startsWith("did:"),
  nonce: z.string().min(1).max(78),
  idempotencyKey: z.uuid(),
  aggregateType: z.string().min(1).max(100),
  aggregateId: z.string().min(1).max(200),
  aggregateVersion: z.string().regex(/^[1-9]\d*$/),
  eventType: z.string().min(1).max(100),
  previousEventHash: HexSchema.nullable(),
  payloadCommitment: HexSchema,
  payload: z.unknown(),
  stateRoot: HexSchema,
  schemaDigest: HexSchema,
  timestamp: z.iso.datetime({ offset: true }),
  eventHash: HexSchema,
});

export const SignedCanonicalCommandSchema = z.strictObject({
  event: CanonicalEventSchema,
  signatures: z.array(CanonicalSignatureSchema).length(1),
});

export function materializeCanonicalEvent(
  event: z.infer<typeof CanonicalEventSchema>,
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
