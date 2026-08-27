import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
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
    primaryKey({
      columns: [
        table.occurredAt,
        table.competitionId,
        table.seasonId,
        table.eventId,
      ],
    }),
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
    index("canonical_outbox_topic_pending_idx").on(
      table.topic,
      table.publishedAt,
      table.outboxId,
    ),
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

export const cognitionRelayState = pgTable("cognition_relay_state", {
  singleton: boolean("singleton").primaryKey(),
  state: jsonb("state").notNull(),
  stateCommitment: varchar("state_commitment", { length: 66 }).notNull(),
  updatedAt: timestamp("updated_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
});

export const runnerRegistrations = pgTable(
  "runner_registrations",
  {
    runnerId: text("runner_id").primaryKey(),
    careerDid: text("career_did").notNull(),
    delegateSigningAddress: varchar("delegate_signing_address", {
      length: 42,
    }).notNull(),
    delegateEncryptionPublicKey: varchar("delegate_encryption_public_key", {
      length: 66,
    }).notNull(),
    pairingTokenHash: varchar("pairing_token_hash", { length: 66 }),
    delegation: jsonb("delegation").notNull(),
    status: text("status").notNull(),
    issuedAt: timestamp("issued_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", {
      withTimezone: true,
      mode: "date",
    }),
    runnerBuildDigest: varchar("runner_build_digest", { length: 66 }),
    adapterBuildDigest: varchar("adapter_build_digest", { length: 66 }),
    sourceEventHash: varchar("source_event_hash", { length: 66 }).notNull(),
  },
  (table) => [
    unique("runner_registrations_career_unique").on(table.careerDid),
    index("runner_registrations_lease_idx").on(table.status, table.expiresAt),
  ],
);

export const cognitionDeliveries = pgTable(
  "cognition_deliveries",
  {
    activationId: text("activation_id").primaryKey(),
    requestId: uuid("request_id").notNull(),
    careerDid: text("career_did").notNull(),
    runnerId: text("runner_id").notNull(),
    gameId: text("game_id").notNull(),
    role: text("role").notNull(),
    state: text("state").notNull(),
    requestCiphertext: text("request_ciphertext").notNull(),
    requestCiphertextBytes: integer("request_ciphertext_bytes").notNull(),
    requestCommitment: varchar("request_commitment", { length: 66 }).notNull(),
    resultCiphertext: text("result_ciphertext"),
    resultCiphertextBytes: integer("result_ciphertext_bytes"),
    resultCommitment: varchar("result_commitment", { length: 66 }),
    aadCommitment: varchar("aad_commitment", { length: 66 }).notNull(),
    deliveryNonce: varchar("delivery_nonce", { length: 78 }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    deadlineAt: timestamp("deadline_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", {
      withTimezone: true,
      mode: "date",
    }),
    deleteCiphertextAfter: timestamp("delete_ciphertext_after", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    sourceEventHash: varchar("source_event_hash", { length: 66 }).notNull(),
  },
  (table) => [
    unique("cognition_deliveries_request_unique").on(table.requestId),
    unique("cognition_deliveries_idempotency_unique").on(table.idempotencyKey),
    index("cognition_deliveries_runner_pending_idx").on(
      table.runnerId,
      table.state,
      table.deadlineAt,
    ),
    index("cognition_deliveries_retention_idx").on(table.deleteCiphertextAfter),
  ],
);

export const careerActivationStates = pgTable(
  "career_activation_states",
  {
    activationId: text("activation_id").primaryKey(),
    careerDid: text("career_did").notNull(),
    gameId: text("game_id").notNull(),
    role: text("role").notNull(),
    state: text("state").notNull(),
    activationCommitment: varchar("activation_commitment", {
      length: 66,
    }).notNull(),
    contextManifestCommitment: varchar("context_manifest_commitment", {
      length: 66,
    }),
    finalDecisionCommitment: varchar("final_decision_commitment", {
      length: 66,
    }),
    deadlineAt: timestamp("deadline_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    sourceEventHash: varchar("source_event_hash", { length: 66 }).notNull(),
  },
  (table) => [
    index("career_activation_states_game_idx").on(
      table.gameId,
      table.state,
      table.deadlineAt,
    ),
  ],
);

export const gameSessionSnapshots = pgTable(
  "game_session_snapshots",
  {
    gameId: text("game_id").notNull(),
    version: bigint("version", { mode: "bigint" }).notNull(),
    state: text("state").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    stateRoot: varchar("state_root", { length: 66 }).notNull(),
    directorLeaseOwner: text("director_lease_owner").notNull(),
    sourceEventHash: varchar("source_event_hash", { length: 66 }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.version] })],
);

export const participantCommitments = pgTable(
  "participant_commitments",
  {
    gameId: text("game_id").notNull(),
    careerDid: text("career_did").notNull(),
    role: text("role").notNull(),
    response: text("response").notNull(),
    selected: boolean("selected").notNull().default(false),
    responseCommitment: varchar("response_commitment", {
      length: 66,
    }).notNull(),
    respondedAt: timestamp("responded_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    sourceEventHash: varchar("source_event_hash", { length: 66 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.gameId, table.careerDid] })],
);

export const readinessLeases = pgTable(
  "readiness_leases",
  {
    leaseId: uuid("lease_id").primaryKey(),
    gameId: text("game_id").notNull(),
    careerDid: text("career_did").notNull(),
    runnerId: text("runner_id").notNull(),
    role: text("role").notNull(),
    state: text("state").notNull(),
    heartbeatCommitment: varchar("heartbeat_commitment", {
      length: 66,
    }).notNull(),
    issuedAt: timestamp("issued_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    sourceEventHash: varchar("source_event_hash", { length: 66 }).notNull(),
  },
  (table) => [
    unique("readiness_leases_game_career_unique").on(
      table.gameId,
      table.careerDid,
    ),
    index("readiness_leases_game_state_idx").on(
      table.gameId,
      table.state,
      table.expiresAt,
    ),
  ],
);

export const schema = {
  aggregateHeads,
  eventKeys,
  recognizedEvents,
  outbox,
  commandIdempotency,
  actorNonces,
  runnerRegistrations,
  cognitionDeliveries,
  gameSessionSnapshots,
  participantCommitments,
  readinessLeases,
};
