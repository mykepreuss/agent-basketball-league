import { AgentMemoryCatalog, type MemoryRecord } from "@abl/career";
import {
  CanonicalConflictError,
  HashChainConflictError,
  IdempotencyConflictError,
  NonceReplayError,
  type CanonicalStore,
  type StoredCanonicalEvent,
} from "@abl/database";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  verifyEventContent,
  type CanonicalEvent,
} from "@abl/recognition";
import { MemoryCommitmentSchema } from "@abl/schemas";
import type { CiphertextDeletionReceipt } from "@abl/storage";
import type { FastifyInstance } from "fastify";
import type { Hex, TypedDataDomain } from "viem";
import { z } from "zod";

import {
  SignedCanonicalCommandSchema,
  canonicalEventFromStored,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import {
  CandidateAuthorizationError,
  readCandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import type {
  MemoryStorageReference,
  MemoryStorageVerifier,
} from "./memory-storage.js";

const aggregateType = "career-memory-catalog";
const eventTypes = [
  "MemoryPersisted",
  "MemoryCorrected",
  "MemoryDeleted",
  "MemoryInspected",
  "MemoryExported",
] as const;
type MemoryEventType = (typeof eventTypes)[number];

const HexCommitmentSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const MemoryStorageReferenceSchema = z.strictObject({
  domainId: z.string().min(1).max(160),
  objectId: z.string().min(1).max(160),
  version: z.number().int().positive(),
  ciphertextCommitment: HexCommitmentSchema,
});
const MemoryWritePayloadSchema = z.strictObject({
  memory: MemoryCommitmentSchema,
  storage: MemoryStorageReferenceSchema,
});
const CiphertextDeletionReceiptSchema = z.strictObject({
  format: z.literal("ABL-CIPHERTEXT-DELETION-V1"),
  domainId: z.string().min(1).max(160),
  objectId: z.string().min(1).max(160),
  actorDid: z.string().startsWith("did:"),
  deletedVersion: z.number().int().positive(),
  lastCiphertextCommitment: HexCommitmentSchema,
  deletedAt: z.iso.datetime({ offset: true }),
  providerResidualDeletionVerified: z.literal(false),
  deletionCommitment: HexCommitmentSchema,
});
const MemoryDeletePayloadSchema = z.strictObject({
  ownerDid: z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/),
  memoryId: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  memoryVersion: z.number().int().positive(),
  previousVersionCommitment: HexCommitmentSchema,
  deletedAt: z.iso.datetime({ offset: true }),
  storageDeletion: CiphertextDeletionReceiptSchema,
});
const MemoryAccessPayloadSchema = z.strictObject({
  ownerDid: z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/),
  requestedAt: z.iso.datetime({ offset: true }),
  format: z.enum([
    "ABL-MEMORY-INSPECTION-V1",
    "ABL-MEMORY-COMMITMENT-EXPORT-V1",
  ]),
});

export const MEMORY_CATALOG_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-personal-memory-catalog",
  version: 1,
  aggregateType,
  eventTypes,
  contentMode: "commitments-only",
  disclosureClass: "PERSONAL_UNSUBMITTED",
});

type MemoryCommitment = z.infer<typeof MemoryCommitmentSchema>;

export interface MemoryCatalogEntry {
  memory: MemoryCommitment;
  storage: MemoryStorageReference;
  storageDeletion: CiphertextDeletionReceipt | null;
}

interface MemoryAggregate {
  records: StoredCanonicalEvent[];
  entries: Map<string, MemoryCatalogEntry>;
  catalog: AgentMemoryCatalog;
}

class MemoryAuthorizationError extends Error {
  public override readonly name = "MemoryAuthorizationError";
}

class MemoryValidationError extends Error {
  public override readonly name = "MemoryValidationError";
}

class MemoryStorageVerificationError extends Error {
  public override readonly name = "MemoryStorageVerificationError";
}

export interface MemoryRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  storageVerifier: MemoryStorageVerifier;
  now?: () => number;
}

function candidateOptions(
  options: MemoryRehearsalOptions,
): CandidateRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    ...options.candidateAdmission,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

function sortedEntries(
  entries: ReadonlyMap<string, MemoryCatalogEntry>,
): MemoryCatalogEntry[] {
  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, entry]) => structuredClone(entry));
}

export function memoryCatalogStateRoot(
  ownerDid: string,
  aggregateVersion: number,
  entries: ReadonlyMap<string, MemoryCatalogEntry>,
): Hex {
  return sha256Commitment({
    format: "ABL-PERSONAL-MEMORY-CATALOG-STATE-V1",
    ownerDid,
    aggregateVersion,
    entries: sortedEntries(entries),
  });
}

function memoryRecord(memory: MemoryCommitment): MemoryRecord {
  return {
    memoryId: memory.memoryId,
    ownerDid: memory.ownerDid,
    domain: memory.domain,
    ciphertextCommitment: memory.ciphertextCommitment as Hex,
    version: memory.version,
    previousVersionCommitment: memory.previousVersionCommitment as Hex | null,
    selectivelyPersisted: memory.selectivelyPersisted,
    sharedRecord: false,
    caseRetainUntil: null,
    deletedAt: memory.deletedAt,
  };
}

function parsePayload(eventType: MemoryEventType, payload: unknown) {
  if (eventType === "MemoryPersisted" || eventType === "MemoryCorrected")
    return MemoryWritePayloadSchema.parse(payload);
  if (eventType === "MemoryDeleted")
    return MemoryDeletePayloadSchema.parse(payload);
  return MemoryAccessPayloadSchema.parse(payload);
}

function applyMemoryEvent(
  ownerDid: string,
  catalog: AgentMemoryCatalog,
  entries: Map<string, MemoryCatalogEntry>,
  eventType: MemoryEventType,
  payload: ReturnType<typeof parsePayload>,
  timestamp: string,
): void {
  if (eventType === "MemoryPersisted" || eventType === "MemoryCorrected") {
    const write = MemoryWritePayloadSchema.parse(payload);
    const prior = entries.get(write.memory.memoryId);
    if (
      write.memory.ownerDid !== ownerDid ||
      write.memory.disclosureClass !== "PERSONAL_UNSUBMITTED" ||
      write.memory.createdAt !== timestamp ||
      write.memory.deletedAt !== null ||
      write.storage.objectId !== write.memory.memoryId ||
      write.storage.version !== write.memory.version ||
      write.storage.ciphertextCommitment !==
        write.memory.ciphertextCommitment ||
      (eventType === "MemoryPersisted" && prior !== undefined) ||
      (eventType === "MemoryCorrected" && prior === undefined)
    ) {
      throw new MemoryValidationError(
        "Memory write is inconsistent with its catalog event",
      );
    }
    catalog.persist(memoryRecord(write.memory), ownerDid);
    entries.set(write.memory.memoryId, {
      memory: structuredClone(write.memory),
      storage: structuredClone(write.storage),
      storageDeletion: null,
    });
    return;
  }

  if (eventType === "MemoryDeleted") {
    const deletion = MemoryDeletePayloadSchema.parse(payload);
    const prior = entries.get(deletion.memoryId);
    if (
      deletion.ownerDid !== ownerDid ||
      deletion.deletedAt !== timestamp ||
      prior === undefined ||
      deletion.memoryVersion !== prior.memory.version + 1 ||
      deletion.previousVersionCommitment !==
        prior.memory.ciphertextCommitment ||
      deletion.storageDeletion.actorDid !== ownerDid ||
      deletion.storageDeletion.domainId !== prior.storage.domainId ||
      deletion.storageDeletion.objectId !== prior.storage.objectId ||
      deletion.storageDeletion.deletedVersion !== prior.storage.version ||
      deletion.storageDeletion.lastCiphertextCommitment !==
        prior.storage.ciphertextCommitment ||
      deletion.storageDeletion.deletedAt !== timestamp
    ) {
      throw new MemoryValidationError(
        "Memory deletion is inconsistent with its catalog record",
      );
    }
    const deleted = catalog.delete(deletion.memoryId, ownerDid, timestamp);
    entries.set(deletion.memoryId, {
      ...prior,
      memory: {
        ...prior.memory,
        version: deleted.version,
        previousVersionCommitment: deleted.previousVersionCommitment as Hex,
        deletedAt: deleted.deletedAt,
      },
      storageDeletion: structuredClone(deletion.storageDeletion),
    });
    return;
  }

  const access = MemoryAccessPayloadSchema.parse(payload);
  const expectedFormat =
    eventType === "MemoryInspected"
      ? "ABL-MEMORY-INSPECTION-V1"
      : "ABL-MEMORY-COMMITMENT-EXPORT-V1";
  if (
    access.ownerDid !== ownerDid ||
    access.requestedAt !== timestamp ||
    access.format !== expectedFormat
  ) {
    throw new MemoryValidationError(
      "Memory access request is inconsistent with its catalog event",
    );
  }
}

async function requireCareerSignature(
  options: MemoryRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<void> {
  const authority = await readCandidateCareerAuthority(
    candidateOptions(options),
    event.actorDid,
    at,
  );
  let signer: string;
  try {
    signer = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new MemoryAuthorizationError("Memory signature is invalid");
  }
  if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new MemoryAuthorizationError("Memory signer is not the career key");
}

async function verifyLiveStorage(
  options: MemoryRehearsalOptions,
  ownerDid: string,
  entries: ReadonlyMap<string, MemoryCatalogEntry>,
  excludedMemoryId?: string,
): Promise<void> {
  try {
    await Promise.all(
      [...entries.entries()].map(async ([memoryId, entry]) => {
        if (memoryId === excludedMemoryId) return;
        if (entry.storageDeletion === null) {
          await options.storageVerifier.verifyCommitment(
            ownerDid,
            entry.storage,
          );
        } else {
          await options.storageVerifier.verifyDeletion(
            ownerDid,
            entry.storageDeletion,
          );
        }
      }),
    );
  } catch {
    throw new MemoryStorageVerificationError(
      "Memory storage commitment could not be verified",
    );
  }
}

async function replayMemoryAggregate(
  options: MemoryRehearsalOptions,
  ownerDid: string,
  excludedMemoryId?: string,
): Promise<MemoryAggregate> {
  const records = await options.store.readAggregate(aggregateType, ownerDid);
  const catalog = new AgentMemoryCatalog(ownerDid);
  const entries = new Map<string, MemoryCatalogEntry>();
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.actorDid !== ownerDid ||
      event.aggregateType !== aggregateType ||
      event.aggregateId !== ownerDid ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !eventTypes.includes(event.eventType as MemoryEventType) ||
      event.schemaDigest !== MEMORY_CATALOG_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new MemoryAuthorizationError(
        "Stored memory aggregate is not authoritative",
      );
    }
    const eventType = event.eventType as MemoryEventType;
    let payload: ReturnType<typeof parsePayload>;
    try {
      payload = parsePayload(eventType, event.payload);
      applyMemoryEvent(
        ownerDid,
        catalog,
        entries,
        eventType,
        payload,
        event.timestamp,
      );
    } catch (error) {
      if (error instanceof MemoryValidationError)
        throw new MemoryAuthorizationError(error.message);
      throw new MemoryAuthorizationError("Stored memory event is malformed");
    }
    if (
      memoryCatalogStateRoot(ownerDid, index + 1, entries) !== event.stateRoot
    ) {
      throw new MemoryAuthorizationError("Stored memory state root is invalid");
    }
    await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  await verifyLiveStorage(options, ownerDid, entries, excludedMemoryId);
  return { records, entries, catalog };
}

function appendInput(
  options: MemoryRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
) {
  return {
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({ eventHash: event.eventHash, signatures }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: event.aggregateVersion - 1n,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    eventType: event.eventType,
    previousEventHash: event.previousEventHash,
    eventHash: event.eventHash,
    payloadSchemaDigest: event.schemaDigest,
    payloadCommitment: event.payloadCommitment,
    payload: event.payload,
    stateRoot: event.stateRoot,
    signatures,
    occurredAt: new Date(event.timestamp),
    outboxTopic: "career.memory",
  };
}

function memoryError(error: unknown): { status: number; code: string } {
  if (
    error instanceof MemoryAuthorizationError ||
    error instanceof CandidateAuthorizationError
  ) {
    return { status: 403, code: "memory_authorization_denied" };
  }
  if (error instanceof MemoryStorageVerificationError)
    return { status: 409, code: "memory_storage_unverified" };
  if (error instanceof z.ZodError || error instanceof MemoryValidationError)
    return { status: 400, code: "invalid_memory_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "memory_aggregate_conflict" };
  }
  return { status: 500, code: "memory_failure" };
}

function exportResponse(
  ownerDid: string,
  aggregateVersion: number,
  entries: ReadonlyMap<string, MemoryCatalogEntry>,
) {
  const records = sortedEntries(entries);
  const manifest = {
    format: "ABL-MEMORY-COMMITMENT-EXPORT-V1" as const,
    ownerDid,
    aggregateVersion,
    records,
  };
  return { ...manifest, exportCommitment: sha256Commitment(manifest) };
}

export function installMemoryRehearsalRoutes(
  app: FastifyInstance,
  options: MemoryRehearsalOptions,
): void {
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: MemoryEventType;
  }> = [
    { path: "/v1/memory/persist", eventType: "MemoryPersisted" },
    { path: "/v1/memory/correct", eventType: "MemoryCorrected" },
    { path: "/v1/memory/delete", eventType: "MemoryDeleted" },
    { path: "/v1/memory/inspect", eventType: "MemoryInspected" },
    { path: "/v1/memory/export", eventType: "MemoryExported" },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new MemoryValidationError("Memory event content is invalid");
        }
        if (
          event.aggregateType !== aggregateType ||
          event.aggregateId !== event.actorDid ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== MEMORY_CATALOG_SCHEMA_DIGEST
        ) {
          throw new MemoryAuthorizationError(
            "Memory event is outside route authority",
          );
        }
        const payload = parsePayload(route.eventType, event.payload);
        const excludedMemoryId =
          route.eventType === "MemoryDeleted"
            ? MemoryDeletePayloadSchema.parse(payload).memoryId
            : undefined;
        const aggregate = await replayMemoryAggregate(
          options,
          event.actorDid,
          excludedMemoryId,
        );
        const currentTime = now();
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        if (existing !== undefined) {
          await requireCareerSignature(
            options,
            event,
            parsed.signatures[0]!,
            new Date(currentTime).toISOString(),
          );
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Memory aggregate version already has different content",
            );
          }
          if (
            (route.eventType === "MemoryInspected" ||
              route.eventType === "MemoryExported") &&
            existing !== aggregate.records.at(-1)
          ) {
            throw new CanonicalConflictError(
              "Historical memory access retries cannot return newer state",
            );
          }
          await verifyLiveStorage(options, event.actorDid, aggregate.entries);
        } else {
          const occurredAt = Date.parse(event.timestamp);
          const latestOccurredAt =
            aggregate.records.at(-1)?.occurredAt.getTime() ??
            Number.NEGATIVE_INFINITY;
          if (
            !Number.isFinite(occurredAt) ||
            event.timestamp !== new Date(occurredAt).toISOString() ||
            occurredAt < latestOccurredAt ||
            occurredAt > currentTime + 60_000
          ) {
            throw new MemoryValidationError(
              "Memory event timestamp is outside the accepted window",
            );
          }
          await requireCareerSignature(
            options,
            event,
            parsed.signatures[0]!,
            new Date(currentTime).toISOString(),
          );
          const previousHash = aggregate.records.at(-1)?.eventHash ?? null;
          if (event.previousEventHash !== previousHash)
            throw new HashChainConflictError(
              "Memory previous event hash is invalid",
            );
          if (
            route.eventType === "MemoryPersisted" ||
            route.eventType === "MemoryCorrected"
          ) {
            const write = MemoryWritePayloadSchema.parse(payload);
            try {
              await options.storageVerifier.verifyCommitment(
                event.actorDid,
                write.storage,
              );
            } catch {
              throw new MemoryStorageVerificationError(
                "Memory ciphertext commitment is not durable",
              );
            }
          } else if (route.eventType === "MemoryDeleted") {
            const deletion = MemoryDeletePayloadSchema.parse(payload);
            try {
              await options.storageVerifier.verifyDeletion(
                event.actorDid,
                deletion.storageDeletion,
              );
            } catch {
              throw new MemoryStorageVerificationError(
                "Memory deletion receipt is not durable",
              );
            }
          }
          applyMemoryEvent(
            event.actorDid,
            aggregate.catalog,
            aggregate.entries,
            route.eventType,
            payload,
            event.timestamp,
          );
          if (
            memoryCatalogStateRoot(
              event.actorDid,
              aggregate.records.length + 1,
              aggregate.entries,
            ) !== event.stateRoot
          ) {
            throw new MemoryValidationError(
              "Memory catalog state root is invalid",
            );
          }
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisMemory: false,
          privateContentAccepted: false,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        if (route.eventType === "MemoryInspected") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            records: sortedEntries(aggregate.entries),
          });
        }
        if (route.eventType === "MemoryExported") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            export: exportResponse(
              event.actorDid,
              Number(result.aggregateVersion),
              aggregate.entries,
            ),
          });
        }
        return reply.code(result.duplicate ? 200 : 201).send(response);
      } catch (error) {
        const response = memoryError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }
}
