import { readFile } from "node:fs/promises";

import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";

import {
  CanonicalConflictError,
  HashChainConflictError,
  IdempotencyConflictError,
  InMemoryCanonicalStore,
  NonceReplayError,
  type AppendCanonicalEventInput,
} from "../src/index.js";

const hash = (character: string): string => `0x${character.repeat(64)}`;

function event(
  overrides: Partial<AppendCanonicalEventInput> = {},
): AppendCanonicalEventInput {
  return {
    eventId: uuidv7(),
    actorDid: "did:abl:agent-a",
    nonce: "1",
    idempotencyKey: crypto.randomUUID(),
    requestHash: hash("1"),
    aggregateType: "game",
    aggregateId: "game-a",
    expectedVersion: 0n,
    competitionId: "premier",
    seasonId: "season-zero",
    eventType: "GameCreated",
    previousEventHash: null,
    eventHash: hash("2"),
    payloadSchemaDigest: hash("3"),
    payloadCommitment: hash("4"),
    payload: { gameId: "game-a" },
    stateRoot: hash("5"),
    signatures: [hash("6")],
    occurredAt: new Date("2026-08-12T23:45:00-07:00"),
    outboxTopic: "canonical.game",
    ...overrides,
  };
}

describe("canonical event and outbox transaction contract", () => {
  it("appends an event and outbox record at the same aggregate version", async () => {
    const store = new InMemoryCanonicalStore();
    const input = event();
    const result = await store.append(input);

    expect(result).toEqual({
      eventId: input.eventId,
      eventHash: input.eventHash,
      aggregateVersion: 1n,
      duplicate: false,
    });
    expect(store.events).toHaveLength(1);
    expect(store.outboxEvents).toEqual([
      { eventId: input.eventId, topic: "canonical.game" },
    ]);
    await expect(store.readAggregate("game", "game-a")).resolves.toMatchObject([
      {
        eventId: input.eventId,
        actorDid: input.actorDid,
        aggregateVersion: 1n,
        eventHash: input.eventHash,
        payload: input.payload,
      },
    ]);
    await expect(store.readAggregate("game", "absent")).resolves.toEqual([]);
    expect(await store.pendingProjectionEvents()).toMatchObject([
      {
        outboxId: 1n,
        eventId: input.eventId,
        aggregateVersion: 1n,
        eventHash: input.eventHash,
      },
    ]);
    await store.markProjected(1n, new Date());
    expect(await store.pendingProjectionEvents()).toEqual([]);
  });

  it("returns the original result for an exact idempotent retry", async () => {
    const store = new InMemoryCanonicalStore();
    const input = event();
    await store.append(input);
    await expect(store.append(input)).resolves.toMatchObject({
      eventId: input.eventId,
      duplicate: true,
    });
    expect(store.events).toHaveLength(1);
    expect(store.outboxEvents).toHaveLength(1);
  });

  it("rejects key reuse with different content and nonce replay", async () => {
    const store = new InMemoryCanonicalStore();
    const first = event();
    await store.append(first);
    await expect(
      store.append({ ...first, requestHash: hash("a") }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(
      store.append(
        event({
          nonce: first.nonce,
          expectedVersion: 1n,
          previousEventHash: first.eventHash,
          eventHash: hash("7"),
        }),
      ),
    ).rejects.toBeInstanceOf(NonceReplayError);
  });

  it("fails closed on aggregate version or hash-chain mismatch", async () => {
    const store = new InMemoryCanonicalStore();
    const first = event();
    await store.append(first);
    await expect(
      store.append(event({ nonce: "2", expectedVersion: 0n })),
    ).rejects.toBeInstanceOf(CanonicalConflictError);
    await expect(
      store.append(
        event({
          nonce: "3",
          expectedVersion: 1n,
          previousEventHash: hash("f"),
        }),
      ),
    ).rejects.toBeInstanceOf(HashChainConflictError);
  });

  it("does not impose a global sequence across independent aggregates", async () => {
    const store = new InMemoryCanonicalStore();
    const [a, b] = await Promise.all([
      store.append(
        event({ aggregateId: "game-a", nonce: "10", eventHash: hash("a") }),
      ),
      store.append(
        event({ aggregateId: "game-b", nonce: "11", eventHash: hash("b") }),
      ),
    ]);
    expect(a.aggregateVersion).toBe(1n);
    expect(b.aggregateVersion).toBe(1n);
  });

  it("filters pending outbox work by consumer topic without head-of-line blocking", async () => {
    const store = new InMemoryCanonicalStore();
    await store.append(event({ outboxTopic: "candidate.lifecycle" }));
    const game = event({
      aggregateId: "game-b",
      nonce: "2",
      eventHash: hash("9"),
      outboxTopic: "public.game",
    });
    await store.append(game);
    await expect(
      store.pendingProjectionEvents(100, "public.game"),
    ).resolves.toMatchObject([{ eventId: game.eventId, topic: "public.game" }]);
    await expect(store.pendingProjectionEvents()).resolves.toHaveLength(2);
  });
});

describe("Postgres migration", () => {
  it("uses time plus competition/season subpartitioning and atomic-support tables", async () => {
    const sql = await readFile(
      new URL("../drizzle/0000_foundation.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain('PARTITION BY RANGE ("occurred_at")');
    expect(sql).toContain('PARTITION BY HASH ("competition_id", "season_id")');
    expect(sql).toContain('CREATE TABLE "canonical_outbox"');
    expect(sql).toContain('CREATE TABLE "command_idempotency"');
    expect(sql).toContain('CREATE TABLE "actor_nonces"');
    expect(sql).not.toMatch(/global_event_sequence|CREATE SEQUENCE.*event/i);
  });
});
