import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import {
  actorNonces,
  aggregateHeads,
  commandIdempotency,
  eventKeys,
  outbox,
  recognizedEvents,
  schema,
} from "./schema.js";

export interface AppendCanonicalEventInput {
  eventId: string;
  actorDid: string;
  nonce: string;
  idempotencyKey: string;
  requestHash: string;
  aggregateType: string;
  aggregateId: string;
  expectedVersion: bigint;
  competitionId: string;
  seasonId: string;
  eventType: string;
  previousEventHash: string | null;
  eventHash: string;
  payloadSchemaDigest: string;
  payloadCommitment: string;
  payload: unknown;
  stateRoot: string;
  signatures: readonly unknown[];
  occurredAt: Date;
  outboxTopic: string;
}

export interface AppendCanonicalEventResult {
  eventId: string;
  eventHash: string;
  aggregateVersion: bigint;
  duplicate: boolean;
}

export interface CanonicalStore {
  append(input: AppendCanonicalEventInput): Promise<AppendCanonicalEventResult>;
}

export class CanonicalConflictError extends Error {
  public override readonly name = "CanonicalConflictError";
}

export class IdempotencyConflictError extends Error {
  public override readonly name = "IdempotencyConflictError";
}

export class NonceReplayError extends Error {
  public override readonly name = "NonceReplayError";
}

export class HashChainConflictError extends Error {
  public override readonly name = "HashChainConflictError";
}

function isRetryableSerializationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  return error.code === "40001" || error.code === "40P01";
}

export class PostgresCanonicalStore implements CanonicalStore {
  readonly #client: Sql;
  readonly #db: PostgresJsDatabase<typeof schema>;
  readonly #maxRetries: number;

  public constructor(connectionUrl: string, maxRetries = 3) {
    this.#client = postgres(connectionUrl, { max: 10, prepare: true });
    this.#db = drizzle(this.#client, { schema });
    this.#maxRetries = maxRetries;
  }

  public async close(): Promise<void> {
    await this.#client.end();
  }

  public async append(
    input: AppendCanonicalEventInput,
  ): Promise<AppendCanonicalEventResult> {
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        return await this.#appendOnce(input);
      } catch (error) {
        if (
          !isRetryableSerializationError(error) ||
          attempt === this.#maxRetries
        )
          throw error;
      }
    }
    throw new Error("Unreachable serialization retry state");
  }

  async #appendOnce(
    input: AppendCanonicalEventInput,
  ): Promise<AppendCanonicalEventResult> {
    return this.#db.transaction(
      async (tx) => {
        const priorIdempotency = await tx
          .select()
          .from(commandIdempotency)
          .where(eq(commandIdempotency.idempotencyKey, input.idempotencyKey))
          .limit(1);
        const prior = priorIdempotency[0];
        if (prior !== undefined) {
          if (
            prior.actorDid !== input.actorDid ||
            prior.requestHash !== input.requestHash
          ) {
            throw new IdempotencyConflictError(
              "Idempotency key was used for different content",
            );
          }
          return {
            eventId: prior.resultEventId,
            eventHash: prior.resultEventHash,
            aggregateVersion: prior.aggregateVersion,
            duplicate: true,
          };
        }

        await tx.execute(
          drizzleSql`select pg_advisory_xact_lock(hashtextextended(${`${input.aggregateType}:${input.aggregateId}`}, 0))`,
        );

        const headRows = await tx
          .select()
          .from(aggregateHeads)
          .where(
            and(
              eq(aggregateHeads.aggregateType, input.aggregateType),
              eq(aggregateHeads.aggregateId, input.aggregateId),
            ),
          )
          .for("update")
          .limit(1);
        const head = headRows[0];
        const actualVersion = head?.version ?? 0n;
        const actualHash = head?.lastEventHash ?? null;

        if (actualVersion !== input.expectedVersion) {
          throw new CanonicalConflictError(
            `Expected aggregate version ${input.expectedVersion}, received ${actualVersion}`,
          );
        }
        if (actualHash !== input.previousEventHash) {
          throw new HashChainConflictError(
            "Previous event hash does not match aggregate head",
          );
        }

        const nextVersion = actualVersion + 1n;
        const nonceInsert = await tx
          .insert(actorNonces)
          .values({
            actorDid: input.actorDid,
            nonce: input.nonce,
            idempotencyKey: input.idempotencyKey,
            usedAt: input.occurredAt,
          })
          .onConflictDoNothing()
          .returning({ actorDid: actorNonces.actorDid });
        if (nonceInsert.length !== 1)
          throw new NonceReplayError("Actor nonce has already been used");

        await tx.insert(eventKeys).values({
          eventId: input.eventId,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          aggregateVersion: nextVersion,
          eventHash: input.eventHash,
          occurredAt: input.occurredAt,
        });
        await tx.insert(recognizedEvents).values({
          eventId: input.eventId,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          aggregateVersion: nextVersion,
          competitionId: input.competitionId,
          seasonId: input.seasonId,
          eventType: input.eventType,
          previousEventHash: input.previousEventHash,
          eventHash: input.eventHash,
          payloadSchemaDigest: input.payloadSchemaDigest,
          payloadCommitment: input.payloadCommitment,
          payload: input.payload,
          stateRoot: input.stateRoot,
          signatures: [...input.signatures],
          occurredAt: input.occurredAt,
        });
        await tx.insert(outbox).values({
          eventId: input.eventId,
          topic: input.outboxTopic,
          payload: {
            eventId: input.eventId,
            eventHash: input.eventHash,
            aggregateVersion: nextVersion.toString(),
          },
          createdAt: input.occurredAt,
          attempts: 0,
        });
        await tx
          .insert(aggregateHeads)
          .values({
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            version: nextVersion,
            lastEventHash: input.eventHash,
            updatedAt: input.occurredAt,
          })
          .onConflictDoUpdate({
            target: [aggregateHeads.aggregateType, aggregateHeads.aggregateId],
            set: {
              version: nextVersion,
              lastEventHash: input.eventHash,
              updatedAt: input.occurredAt,
            },
          });
        await tx.insert(commandIdempotency).values({
          idempotencyKey: input.idempotencyKey,
          actorDid: input.actorDid,
          requestHash: input.requestHash,
          resultEventId: input.eventId,
          resultEventHash: input.eventHash,
          aggregateVersion: nextVersion,
          createdAt: input.occurredAt,
        });

        return {
          eventId: input.eventId,
          eventHash: input.eventHash,
          aggregateVersion: nextVersion,
          duplicate: false,
        };
      },
      {
        isolationLevel: "serializable",
        accessMode: "read write",
        deferrable: false,
      },
    );
  }
}

interface MemoryHead {
  version: bigint;
  hash: string | null;
}

export class InMemoryCanonicalStore implements CanonicalStore {
  readonly #heads = new Map<string, MemoryHead>();
  readonly #idempotency = new Map<
    string,
    AppendCanonicalEventResult & { actorDid: string; requestHash: string }
  >();
  readonly #nonces = new Set<string>();
  readonly events: AppendCanonicalEventInput[] = [];
  readonly outboxEvents: Array<{ eventId: string; topic: string }> = [];

  public async append(
    input: AppendCanonicalEventInput,
  ): Promise<AppendCanonicalEventResult> {
    const prior = this.#idempotency.get(input.idempotencyKey);
    if (prior !== undefined) {
      if (
        prior.actorDid !== input.actorDid ||
        prior.requestHash !== input.requestHash
      ) {
        throw new IdempotencyConflictError(
          "Idempotency key was used for different content",
        );
      }
      return {
        eventId: prior.eventId,
        eventHash: prior.eventHash,
        aggregateVersion: prior.aggregateVersion,
        duplicate: true,
      };
    }

    const aggregateKey = `${input.aggregateType}:${input.aggregateId}`;
    const head = this.#heads.get(aggregateKey) ?? { version: 0n, hash: null };
    if (head.version !== input.expectedVersion)
      throw new CanonicalConflictError("Aggregate version mismatch");
    if (head.hash !== input.previousEventHash)
      throw new HashChainConflictError("Previous event hash mismatch");

    const nonceKey = `${input.actorDid}:${input.nonce}`;
    if (this.#nonces.has(nonceKey))
      throw new NonceReplayError("Actor nonce has already been used");

    const aggregateVersion = head.version + 1n;
    const result = {
      eventId: input.eventId,
      eventHash: input.eventHash,
      aggregateVersion,
      duplicate: false,
    };
    this.#nonces.add(nonceKey);
    this.#heads.set(aggregateKey, {
      version: aggregateVersion,
      hash: input.eventHash,
    });
    this.events.push(structuredClone(input));
    this.outboxEvents.push({
      eventId: input.eventId,
      topic: input.outboxTopic,
    });
    this.#idempotency.set(input.idempotencyKey, {
      ...result,
      actorDid: input.actorDid,
      requestHash: input.requestHash,
    });
    return result;
  }
}
