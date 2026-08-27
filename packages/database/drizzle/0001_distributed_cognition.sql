CREATE TABLE "cognition_relay_state" (
  "singleton" boolean PRIMARY KEY CHECK ("singleton" = true),
  "state" jsonb NOT NULL,
  "state_commitment" varchar(66) NOT NULL CHECK ("state_commitment" ~ '^0x[0-9a-f]{64}$'),
  "updated_at" timestamptz NOT NULL
);

CREATE TABLE "runner_registrations" (
  "runner_id" text PRIMARY KEY,
  "career_did" text NOT NULL,
  "delegate_signing_address" varchar(42) NOT NULL CHECK ("delegate_signing_address" ~ '^0x[0-9a-fA-F]{40}$'),
  "delegate_encryption_public_key" varchar(66) NOT NULL CHECK ("delegate_encryption_public_key" ~ '^0x[0-9a-f]{64}$'),
  "pairing_token_hash" varchar(66) CHECK ("pairing_token_hash" IS NULL OR "pairing_token_hash" ~ '^0x[0-9a-f]{64}$'),
  "delegation" jsonb NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('PAIRED_OFFLINE', 'ON_DEMAND_ONLY', 'ONLINE', 'REVOKED', 'EXPIRED')),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "last_heartbeat_at" timestamptz,
  "runner_build_digest" varchar(66) CHECK ("runner_build_digest" IS NULL OR "runner_build_digest" ~ '^0x[0-9a-f]{64}$'),
  "adapter_build_digest" varchar(66) CHECK ("adapter_build_digest" IS NULL OR "adapter_build_digest" ~ '^0x[0-9a-f]{64}$'),
  "source_event_hash" varchar(66) NOT NULL CHECK ("source_event_hash" ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT "runner_registrations_career_unique" UNIQUE ("career_did")
);
CREATE INDEX "runner_registrations_lease_idx" ON "runner_registrations" ("status", "expires_at");

CREATE TABLE "cognition_deliveries" (
  "activation_id" text PRIMARY KEY,
  "request_id" uuid NOT NULL,
  "career_did" text NOT NULL,
  "runner_id" text NOT NULL,
  "game_id" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('PLAYER', 'COACH', 'REFEREE', 'REPLAY')),
  "state" text NOT NULL CHECK ("state" IN ('RECEIVED', 'CONTEXT_ASSEMBLED', 'SEALED_FOR_RUNNER', 'DELIVERED', 'RESULT_RECEIVED', 'VALIDATED', 'CAREER_SIGNED', 'FALLBACK_SIGNED', 'EXPIRED', 'REJECTED')),
  "request_ciphertext" text NOT NULL,
  "request_ciphertext_bytes" integer NOT NULL CHECK ("request_ciphertext_bytes" BETWEEN 1 AND 262144),
  "request_commitment" varchar(66) NOT NULL CHECK ("request_commitment" ~ '^0x[0-9a-f]{64}$'),
  "result_ciphertext" text,
  "result_ciphertext_bytes" integer CHECK ("result_ciphertext_bytes" IS NULL OR "result_ciphertext_bytes" BETWEEN 1 AND 65536),
  "result_commitment" varchar(66) CHECK ("result_commitment" IS NULL OR "result_commitment" ~ '^0x[0-9a-f]{64}$'),
  "aad_commitment" varchar(66) NOT NULL CHECK ("aad_commitment" ~ '^0x[0-9a-f]{64}$'),
  "delivery_nonce" varchar(78) NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "deadline_at" timestamptz NOT NULL,
  "acknowledged_at" timestamptz,
  "delete_ciphertext_after" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source_event_hash" varchar(66) NOT NULL CHECK ("source_event_hash" ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT "cognition_deliveries_request_unique" UNIQUE ("request_id"),
  CONSTRAINT "cognition_deliveries_idempotency_unique" UNIQUE ("idempotency_key")
);
CREATE INDEX "cognition_deliveries_runner_pending_idx" ON "cognition_deliveries" ("runner_id", "state", "deadline_at");
CREATE INDEX "cognition_deliveries_retention_idx" ON "cognition_deliveries" ("delete_ciphertext_after");

CREATE TABLE "career_activation_states" (
  "activation_id" text PRIMARY KEY,
  "career_did" text NOT NULL,
  "game_id" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('PLAYER', 'COACH', 'REFEREE', 'REPLAY')),
  "state" text NOT NULL CHECK ("state" IN ('RECEIVED', 'CONTEXT_ASSEMBLED', 'SEALED_FOR_RUNNER', 'DELIVERED', 'RESULT_RECEIVED', 'VALIDATED', 'CAREER_SIGNED', 'FALLBACK_SIGNED', 'EXPIRED', 'REJECTED')),
  "activation_commitment" varchar(66) NOT NULL CHECK ("activation_commitment" ~ '^0x[0-9a-f]{64}$'),
  "context_manifest_commitment" varchar(66) CHECK ("context_manifest_commitment" IS NULL OR "context_manifest_commitment" ~ '^0x[0-9a-f]{64}$'),
  "final_decision_commitment" varchar(66) CHECK ("final_decision_commitment" IS NULL OR "final_decision_commitment" ~ '^0x[0-9a-f]{64}$'),
  "deadline_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "source_event_hash" varchar(66) NOT NULL CHECK ("source_event_hash" ~ '^0x[0-9a-f]{64}$')
);
CREATE INDEX "career_activation_states_game_idx" ON "career_activation_states" ("game_id", "state", "deadline_at");

CREATE TABLE "game_session_snapshots" (
  "game_id" text NOT NULL,
  "version" bigint NOT NULL CHECK ("version" > 0),
  "state" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "state_root" varchar(66) NOT NULL CHECK ("state_root" ~ '^0x[0-9a-f]{64}$'),
  "director_lease_owner" text NOT NULL,
  "source_event_hash" varchar(66) NOT NULL CHECK ("source_event_hash" ~ '^0x[0-9a-f]{64}$'),
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "game_session_snapshots_pk" PRIMARY KEY ("game_id", "version")
);

CREATE TABLE "participant_commitments" (
  "game_id" text NOT NULL,
  "career_did" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('PLAYER', 'COACH', 'REFEREE', 'REPLAY')),
  "response" text NOT NULL CHECK ("response" IN ('ACCEPT', 'DECLINE', 'REFUSE')),
  "selected" boolean NOT NULL DEFAULT false,
  "response_commitment" varchar(66) NOT NULL CHECK ("response_commitment" ~ '^0x[0-9a-f]{64}$'),
  "responded_at" timestamptz NOT NULL,
  "source_event_hash" varchar(66) NOT NULL CHECK ("source_event_hash" ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT "participant_commitments_pk" PRIMARY KEY ("game_id", "career_did")
);

CREATE TABLE "readiness_leases" (
  "lease_id" uuid PRIMARY KEY,
  "game_id" text NOT NULL,
  "career_did" text NOT NULL,
  "runner_id" text NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('PLAYER', 'COACH', 'REFEREE', 'REPLAY')),
  "state" text NOT NULL CHECK ("state" IN ('READY', 'ON_DEMAND_ONLY', 'OFFLINE', 'REVOKED')),
  "heartbeat_commitment" varchar(66) NOT NULL CHECK ("heartbeat_commitment" ~ '^0x[0-9a-f]{64}$'),
  "issued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "source_event_hash" varchar(66) NOT NULL CHECK ("source_event_hash" ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT "readiness_leases_game_career_unique" UNIQUE ("game_id", "career_did")
);
CREATE INDEX "readiness_leases_game_state_idx" ON "readiness_leases" ("game_id", "state", "expires_at");

COMMENT ON TABLE "runner_registrations" IS 'Rebuildable runner and delegation projection. Canonical authority remains in signed ABL events.';
COMMENT ON TABLE "cognition_relay_state" IS 'Atomic restart journal for ciphertext-only relay transport state. It carries no canonical authority.';
COMMENT ON TABLE "cognition_deliveries" IS 'Ciphertext-only transient delivery projection. Plaintext context and participant credentials are prohibited.';
COMMENT ON TABLE "career_activation_states" IS 'Commitment-only restart projection for every career activation, including deterministic fallbacks without a paired runner.';
COMMENT ON TABLE "game_session_snapshots" IS 'Restartable competition state derived from signed events. It cannot independently create recognized history.';
COMMENT ON TABLE "participant_commitments" IS 'Rebuildable signed schedule response projection.';
COMMENT ON TABLE "readiness_leases" IS 'Rebuildable runner readiness projection with a 120-second online lease.';
