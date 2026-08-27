import postgres, { type Sql, type TransactionSql } from "postgres";

import { sha256Commitment } from "@abl/recognition";

import {
  ScheduledGameStateSchema,
  type ScheduledGameState,
} from "./lifecycle.js";

export class CompetitionGameStore {
  readonly #sql: Sql;
  readonly #leaseOwner: string;

  public constructor(input: { databaseUrl: string; leaseOwner: string }) {
    const url = new URL(input.databaseUrl);
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      url.searchParams.get("sslmode") !== "require"
    )
      throw new Error("Competition director requires direct TLS PostgreSQL");
    this.#sql = postgres(input.databaseUrl, {
      max: 3,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    this.#leaseOwner = input.leaseOwner;
  }

  public async read(gameId: string): Promise<ScheduledGameState | null> {
    const rows = await this.#sql<Array<{ snapshot: unknown }>>`
      SELECT snapshot
      FROM game_session_snapshots
      WHERE game_id = ${gameId}
      ORDER BY version DESC
      LIMIT 1
    `;
    return rows[0] === undefined
      ? null
      : ScheduledGameStateSchema.parse(rows[0].snapshot);
  }

  public async listActive(): Promise<ScheduledGameState[]> {
    const rows = await this.#sql<Array<{ snapshot: unknown }>>`
      SELECT snapshot
      FROM (
        SELECT DISTINCT ON (game_id) game_id, state, snapshot, version
        FROM game_session_snapshots
        ORDER BY game_id, version DESC
      ) latest
      WHERE state NOT IN ('POSTPONED', 'COMPLETED')
      ORDER BY game_id
    `;
    return rows.map(({ snapshot }) => ScheduledGameStateSchema.parse(snapshot));
  }

  public async create(game: ScheduledGameState): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtextextended(${game.gameId}, 0))
      `;
      const existing = await transaction`
        SELECT 1 FROM game_session_snapshots WHERE game_id = ${game.gameId} LIMIT 1
      `;
      if (existing.length > 0) throw new Error("Game already exists");
      await this.#insert(transaction, game);
    });
  }

  public async update(
    gameId: string,
    expectedVersion: number,
    transition: (
      game: ScheduledGameState,
    ) => Promise<ScheduledGameState> | ScheduledGameState,
  ): Promise<ScheduledGameState> {
    return this.#sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtextextended(${gameId}, 0))
      `;
      const rows = await transaction<Array<{ snapshot: unknown }>>`
        SELECT snapshot
        FROM game_session_snapshots
        WHERE game_id = ${gameId}
        ORDER BY version DESC
        LIMIT 1
        FOR UPDATE
      `;
      if (rows[0] === undefined) throw new Error("Game not found");
      const current = ScheduledGameStateSchema.parse(rows[0].snapshot);
      if (current.version !== expectedVersion)
        throw new Error("Game version conflict");
      const next = ScheduledGameStateSchema.parse(await transition(current));
      if (next.version !== current.version + 1)
        throw new Error("Game transition must advance exactly one version");
      await this.#insert(transaction, next);
      return next;
    });
  }

  async #insert(
    sql: Sql | TransactionSql,
    game: ScheduledGameState,
  ): Promise<void> {
    await sql`
      INSERT INTO game_session_snapshots (
        game_id, version, state, snapshot, state_root,
        director_lease_owner, source_event_hash, updated_at
      ) VALUES (
        ${game.gameId},
        ${game.version},
        ${game.state},
        ${sql.json(game as never)},
        ${game.stateRoot},
        ${this.#leaseOwner},
        ${sha256Commitment({
          gameId: game.gameId,
          version: game.version,
          stateRoot: game.stateRoot,
        })},
        ${game.updatedAt}
      )
    `;
    await sql`DELETE FROM participant_commitments WHERE game_id = ${game.gameId}`;
    await sql`DELETE FROM readiness_leases WHERE game_id = ${game.gameId}`;
    for (const participant of game.participants) {
      if (participant.participation !== null)
        await sql`
          INSERT INTO participant_commitments (
            game_id, career_did, role, response, selected,
            response_commitment, responded_at, source_event_hash
          ) VALUES (
            ${game.gameId}, ${participant.careerDid}, ${participant.role},
            ${participant.participation.response}, ${participant.active},
            ${participant.participation.responseCommitment},
            ${participant.participation.respondedAt},
            ${sha256Commitment(participant.participation)}
          )
        `;
      if (participant.readinessLease !== null)
        await sql`
          INSERT INTO readiness_leases (
            lease_id, game_id, career_did, runner_id, role, state,
            heartbeat_commitment, issued_at, expires_at, source_event_hash
          ) VALUES (
            ${participant.readinessLease.leaseId}, ${game.gameId},
            ${participant.careerDid}, ${participant.readinessLease.runnerId},
            ${participant.role}, ${participant.readinessLease.state},
            ${participant.readinessLease.heartbeatCommitment},
            ${participant.readinessLease.issuedAt},
            ${participant.readinessLease.expiresAt},
            ${participant.readinessLease.sourceEventHash}
          )
        `;
    }
  }

  public async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }
}
