import postgres, { type Sql } from "postgres";

import type { RelayDurableState, RelayStateStore } from "@abl/cognition";

export class PostgresRelayStateStore implements RelayStateStore {
  readonly #sql: Sql;

  public constructor(databaseUrl: string) {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
      throw new Error("Cognition relay requires a PostgreSQL URL");
    if (url.searchParams.get("sslmode") !== "require")
      throw new Error("Cognition relay PostgreSQL must require TLS");
    this.#sql = postgres(databaseUrl, {
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }

  public async load(): Promise<RelayDurableState | null> {
    const rows = await this.#sql<
      Array<{ state: RelayDurableState }>
    >`SELECT state FROM cognition_relay_state WHERE singleton = true`;
    return rows[0]?.state ?? null;
  }

  public async save(state: RelayDurableState): Promise<void> {
    const stateCommitment = await this.#commitment(state);
    await this.#sql.begin(async (sql) => {
      await sql`
        INSERT INTO cognition_relay_state (singleton, state, state_commitment, updated_at)
        VALUES (true, ${sql.json(state as never)}, ${stateCommitment}, now())
        ON CONFLICT (singleton) DO UPDATE SET
          state = EXCLUDED.state,
          state_commitment = EXCLUDED.state_commitment,
          updated_at = EXCLUDED.updated_at
      `;

      await sql`DELETE FROM runner_registrations`;
      const heartbeatByRunner = new Map(state.heartbeats);
      const latestDelegationByCareer = new Map<
        string,
        (typeof state.delegations)[number][1]
      >();
      for (const [, delegation] of state.delegations) {
        const current = latestDelegationByCareer.get(delegation.careerDid);
        if (current === undefined || current.issuedAt < delegation.issuedAt)
          latestDelegationByCareer.set(delegation.careerDid, delegation);
      }
      for (const delegation of latestDelegationByCareer.values()) {
        const heartbeat = heartbeatByRunner.get(delegation.runnerId);
        const expired = Date.parse(delegation.expiresAt) <= Date.now();
        const status =
          delegation.revokedAt !== null
            ? "REVOKED"
            : expired
              ? "EXPIRED"
              : heartbeat?.availability === "ONLINE"
                ? "ONLINE"
                : heartbeat?.availability === "ON_DEMAND_ONLY"
                  ? "ON_DEMAND_ONLY"
                  : "PAIRED_OFFLINE";
        const pairingTokenHash = state.offers
          .map(([, offer]) => offer)
          .filter((offer) => offer.offer.careerDid === delegation.careerDid)
          .sort((left, right) =>
            right.offer.issuedAt.localeCompare(left.offer.issuedAt),
          )[0]?.tokenHash;
        await sql`
          INSERT INTO runner_registrations (
            runner_id, career_did, delegate_signing_address,
            delegate_encryption_public_key, pairing_token_hash, delegation,
            status, issued_at, expires_at, revoked_at, last_heartbeat_at,
            runner_build_digest, adapter_build_digest, source_event_hash
          ) VALUES (
            ${delegation.runnerId}, ${delegation.careerDid},
            ${delegation.delegateSigningAddress},
            ${delegation.delegateEncryptionPublicKey},
            ${pairingTokenHash ?? null}, ${sql.json(delegation as never)},
            ${status}, ${delegation.issuedAt}, ${delegation.expiresAt},
            ${delegation.revokedAt}, ${heartbeat?.observedAt ?? null},
            ${heartbeat?.runnerBuildDigest ?? null},
            ${heartbeat?.adapterBuildDigest ?? null},
            ${await this.#commitment(delegation)}
          )
        `;
      }

      await sql`DELETE FROM cognition_deliveries`;
      for (const [, delivery] of state.deliveries) {
        const request = delivery.request;
        const result = delivery.result;
        const retentionStart = Math.max(
          Date.parse(request.activation.deadlineAt),
          Date.parse(delivery.acknowledgedAt ?? request.activation.deadlineAt),
        );
        await sql`
          INSERT INTO cognition_deliveries (
            activation_id, request_id, career_did, runner_id, game_id, role,
            state, request_ciphertext, request_ciphertext_bytes,
            request_commitment, result_ciphertext, result_ciphertext_bytes,
            result_commitment, aad_commitment, delivery_nonce,
            idempotency_key, deadline_at, acknowledged_at,
            delete_ciphertext_after, created_at, updated_at, source_event_hash
          ) VALUES (
            ${request.activation.activationId}, ${request.requestId},
            ${request.activation.careerDid}, ${request.capsule.runnerId},
            ${request.activation.gameId}, ${request.activation.role},
            ${result === null ? "DELIVERED" : "RESULT_RECEIVED"},
            ${request.capsule.ciphertext}, ${request.capsule.ciphertextBytes},
            ${request.requestCommitment}, ${result?.ciphertext ?? null},
            ${result?.ciphertextBytes ?? null},
            ${result?.ciphertextCommitment ?? null},
            ${request.capsule.aadCommitment}, ${request.capsule.nonce},
            ${request.requestId}, ${request.activation.deadlineAt},
            ${delivery.acknowledgedAt},
            ${new Date(retentionStart + 24 * 60 * 60_000).toISOString()},
            ${request.createdAt}, now(), ${await this.#commitment({
              request: request.requestCommitment,
              result: result?.ciphertextCommitment ?? null,
            })}
          )
        `;
      }

      await sql`DELETE FROM career_activation_states`;
      for (const [, activation] of state.activationStates ?? []) {
        await sql`
          INSERT INTO career_activation_states (
            activation_id, career_did, game_id, role, state,
            activation_commitment, context_manifest_commitment,
            final_decision_commitment, deadline_at, updated_at,
            source_event_hash
          ) VALUES (
            ${activation.activationId}, ${activation.careerDid},
            ${activation.gameId}, ${activation.role}, ${activation.state},
            ${activation.activationCommitment},
            ${activation.contextManifestCommitment},
            ${activation.finalDecisionCommitment}, ${activation.deadlineAt},
            ${activation.updatedAt}, ${await this.#commitment(activation)}
          )
        `;
      }
    });
  }

  async #commitment(value: unknown): Promise<string> {
    const { sha256Commitment } = await import("@abl/recognition");
    return sha256Commitment(value);
  }

  public async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}
