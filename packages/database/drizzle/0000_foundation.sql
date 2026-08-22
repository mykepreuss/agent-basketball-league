CREATE TABLE "aggregate_heads" (
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "version" bigint NOT NULL CHECK ("version" >= 0),
  "last_event_hash" varchar(66),
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "aggregate_heads_pk" PRIMARY KEY ("aggregate_type", "aggregate_id"),
  CONSTRAINT "aggregate_heads_hash_check" CHECK ("last_event_hash" IS NULL OR "last_event_hash" ~ '^0x[0-9a-f]{64}$')
);

CREATE TABLE "event_keys" (
  "event_id" uuid PRIMARY KEY,
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "aggregate_version" bigint NOT NULL CHECK ("aggregate_version" > 0),
  "event_hash" varchar(66) NOT NULL CHECK ("event_hash" ~ '^0x[0-9a-f]{64}$'),
  "occurred_at" timestamptz NOT NULL,
  CONSTRAINT "event_keys_aggregate_version_unique" UNIQUE ("aggregate_type", "aggregate_id", "aggregate_version"),
  CONSTRAINT "event_keys_event_hash_unique" UNIQUE ("event_hash")
);

CREATE TABLE "recognized_events" (
  "event_id" uuid NOT NULL REFERENCES "event_keys"("event_id") ON DELETE RESTRICT,
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "aggregate_version" bigint NOT NULL CHECK ("aggregate_version" > 0),
  "competition_id" text NOT NULL,
  "season_id" text NOT NULL,
  "event_type" text NOT NULL,
  "previous_event_hash" varchar(66) CHECK ("previous_event_hash" IS NULL OR "previous_event_hash" ~ '^0x[0-9a-f]{64}$'),
  "event_hash" varchar(66) NOT NULL CHECK ("event_hash" ~ '^0x[0-9a-f]{64}$'),
  "payload_schema_digest" varchar(66) NOT NULL CHECK ("payload_schema_digest" ~ '^0x[0-9a-f]{64}$'),
  "payload_commitment" varchar(66) NOT NULL CHECK ("payload_commitment" ~ '^0x[0-9a-f]{64}$'),
  "payload" jsonb NOT NULL,
  "state_root" varchar(66) NOT NULL CHECK ("state_root" ~ '^0x[0-9a-f]{64}$'),
  "signatures" jsonb NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  CONSTRAINT "recognized_events_pk" PRIMARY KEY ("occurred_at", "competition_id", "season_id", "event_id")
) PARTITION BY RANGE ("occurred_at");

CREATE TABLE "recognized_events_default"
PARTITION OF "recognized_events" DEFAULT
PARTITION BY HASH ("competition_id", "season_id");

CREATE TABLE "recognized_events_default_h00" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE "recognized_events_default_h01" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE "recognized_events_default_h02" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE "recognized_events_default_h03" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE "recognized_events_default_h04" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE "recognized_events_default_h05" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE "recognized_events_default_h06" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE "recognized_events_default_h07" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE "recognized_events_default_h08" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE "recognized_events_default_h09" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE "recognized_events_default_h10" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE "recognized_events_default_h11" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE "recognized_events_default_h12" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE "recognized_events_default_h13" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE "recognized_events_default_h14" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE "recognized_events_default_h15" PARTITION OF "recognized_events_default" FOR VALUES WITH (MODULUS 16, REMAINDER 15);

CREATE INDEX "recognized_events_competition_season_time_idx"
ON "recognized_events" ("competition_id", "season_id", "occurred_at");
CREATE INDEX "recognized_events_aggregate_idx"
ON "recognized_events" ("aggregate_type", "aggregate_id", "aggregate_version");

CREATE TABLE "canonical_outbox" (
  "outbox_id" bigserial PRIMARY KEY,
  "event_id" uuid NOT NULL REFERENCES "event_keys"("event_id") ON DELETE RESTRICT,
  "topic" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL,
  "published_at" timestamptz,
  "attempts" bigint NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  CONSTRAINT "canonical_outbox_event_unique" UNIQUE ("event_id")
);
CREATE INDEX "canonical_outbox_pending_idx" ON "canonical_outbox" ("published_at", "outbox_id");
CREATE INDEX "canonical_outbox_topic_pending_idx" ON "canonical_outbox" ("topic", "published_at", "outbox_id");

CREATE TABLE "command_idempotency" (
  "idempotency_key" uuid PRIMARY KEY,
  "actor_did" text NOT NULL,
  "request_hash" varchar(66) NOT NULL CHECK ("request_hash" ~ '^0x[0-9a-f]{64}$'),
  "result_event_id" uuid NOT NULL REFERENCES "event_keys"("event_id") ON DELETE RESTRICT,
  "result_event_hash" varchar(66) NOT NULL CHECK ("result_event_hash" ~ '^0x[0-9a-f]{64}$'),
  "aggregate_version" bigint NOT NULL CHECK ("aggregate_version" > 0),
  "created_at" timestamptz NOT NULL
);

CREATE TABLE "actor_nonces" (
  "actor_did" text NOT NULL,
  "nonce" varchar(78) NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "used_at" timestamptz NOT NULL,
  CONSTRAINT "actor_nonces_pk" PRIMARY KEY ("actor_did", "nonce")
);

COMMENT ON TABLE "recognized_events" IS 'Canonical event bodies only. Private content is represented by commitments, never plaintext.';
COMMENT ON TABLE "canonical_outbox" IS 'Inserted in the same serializable transaction as each canonical event; delivery is idempotent.';
