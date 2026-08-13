import {
  bigint,
  bigserial,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const aggregateHeads = pgTable(
  "aggregate_heads",
  {
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    version: bigint("version", { mode: "bigint" }).notNull(),
    lastEventHash: varchar("last_event_hash", { length: 66 }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.aggregateType, table.aggregateId] }),
  ],
);

export const eventKeys = pgTable(
  "event_keys",
  {
    eventId: uuid("event_id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateVersion: bigint("aggregate_version", { mode: "bigint" }).notNull(),
    eventHash: varchar("event_hash", { length: 66 }).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    unique("event_keys_aggregate_version_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
    ),
    unique("event_keys_event_hash_unique").on(table.eventHash),
  ],
);

export const recognizedEvents = pgTable(
  "recognized_events",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventKeys.eventId, { onDelete: "restrict" }),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateVersion: bigint("aggregate_version", { mode: "bigint" }).notNull(),
    competitionId: text("competition_id").notNull(),
    seasonId: text("season_id").notNull(),
    eventType: text("event_type").notNull(),
    previousEventHash: varchar("previous_event_hash", { length: 66 }),
    eventHash: varchar("event_hash", { length: 66 }).notNull(),
    payloadSchemaDigest: varchar("payload_schema_digest", {
      length: 66,
    }).notNull(),
    payloadCommitment: varchar("payload_commitment", { length: 66 }).notNull(),
    payload: jsonb("payload").notNull(),
    stateRoot: varchar("state_root", { length: 66 }).notNull(),
    signatures: jsonb("signatures").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.occurredAt, table.eventId] }),
    index("recognized_events_competition_season_time_idx").on(
      table.competitionId,
      table.seasonId,
      table.occurredAt,
    ),
    index("recognized_events_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
      table.aggregateVersion,
    ),
  ],
);

export const outbox = pgTable(
  "canonical_outbox",
  {
    outboxId: bigserial("outbox_id", { mode: "bigint" }).primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => eventKeys.eventId, { onDelete: "restrict" }),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
    attempts: bigint("attempts", { mode: "number" }).notNull().default(0),
  },
  (table) => [
    unique("canonical_outbox_event_unique").on(table.eventId),
    index("canonical_outbox_pending_idx").on(table.publishedAt, table.outboxId),
  ],
);

export const commandIdempotency = pgTable("command_idempotency", {
  idempotencyKey: uuid("idempotency_key").primaryKey(),
  actorDid: text("actor_did").notNull(),
  requestHash: varchar("request_hash", { length: 66 }).notNull(),
  resultEventId: uuid("result_event_id")
    .notNull()
    .references(() => eventKeys.eventId, { onDelete: "restrict" }),
  resultEventHash: varchar("result_event_hash", { length: 66 }).notNull(),
  aggregateVersion: bigint("aggregate_version", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
});

export const actorNonces = pgTable(
  "actor_nonces",
  {
    actorDid: text("actor_did").notNull(),
    nonce: varchar("nonce", { length: 78 }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    usedAt: timestamp("used_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.actorDid, table.nonce] })],
);

export const schema = {
  aggregateHeads,
  eventKeys,
  recognizedEvents,
  outbox,
  commandIdempotency,
  actorNonces,
};
