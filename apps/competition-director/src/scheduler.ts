import { recoverCompetitionAssertionSigner } from "@abl/cognition";
import { sha256Commitment } from "@abl/recognition";
import { ReadinessLeaseSchema, type ReadinessLease } from "@abl/schemas";
import type { Hex } from "viem";

import {
  beginGame,
  recordReadiness,
  tipOffGame,
  type ScheduledGameState,
} from "./lifecycle.js";

export type ReadinessCollection =
  | { lease: ReadinessLease; failure: null }
  | {
      lease: null;
      failure: "PARTICIPANT_UNAVAILABLE" | "ABL_SERVICE_FAILURE";
      evidenceCommitment: `0x${string}`;
    };

export interface SchedulerStore {
  listActive(): Promise<ScheduledGameState[]>;
  update(
    gameId: string,
    expectedVersion: number,
    transition: (
      game: ScheduledGameState,
    ) => Promise<ScheduledGameState> | ScheduledGameState,
  ): Promise<ScheduledGameState>;
}

export async function recordVerifiedReadinessLease(input: {
  game: ScheduledGameState;
  lease: ReadinessLease;
  checkedAt: string;
}): Promise<ScheduledGameState> {
  const lease = ReadinessLeaseSchema.parse(input.lease);
  const participant = input.game.participants.find(
    ({ careerDid }) => careerDid === lease.careerDid,
  );
  if (
    participant === undefined ||
    lease.gameId !== input.game.gameId ||
    lease.role !== participant.role
  )
    throw new Error("Readiness lease is bound to another game or career");
  const issued = Date.parse(lease.issuedAt);
  const expires = Date.parse(lease.expiresAt);
  const checked = Date.parse(input.checkedAt);
  if (
    issued < Date.parse(input.game.readinessCheckedAt) ||
    issued > checked ||
    expires <= issued ||
    expires - issued > 120_000 ||
    checked - issued > 120_000
  )
    throw new Error("Readiness lease is outside the 120-second window");
  const { careerSignature: _signature, ...unsigned } = lease;
  const signer = await recoverCompetitionAssertionSigner(
    {
      kind: "READINESS_LEASE",
      careerDid: lease.careerDid,
      subjectCommitment: sha256Commitment(unsigned),
      timestamp: lease.issuedAt,
    },
    lease.careerSignature as Hex,
  );
  if (signer.toLowerCase() !== participant.signerAddress.toLowerCase())
    throw new Error("Readiness lease was not signed by the career");
  return recordReadiness({
    game: input.game,
    careerDid: lease.careerDid,
    ready: lease.state === "READY" && expires >= checked,
    observedAt: input.checkedAt,
    lease: {
      leaseId: lease.leaseId,
      runnerId: lease.runnerId,
      state: lease.state,
      heartbeatCommitment: lease.heartbeatCommitment,
      issuedAt: lease.issuedAt,
      expiresAt: lease.expiresAt,
      sourceEventHash: sha256Commitment(lease),
    },
  });
}

export class CompetitionScheduler {
  readonly #store: SchedulerStore;
  readonly #collectReadiness: (input: {
    gameId: string;
    careerDid: string;
    careerResourceName: string;
  }) => Promise<ReadinessCollection>;
  #lastPassAt: string | null = null;
  #lastError: string | null = null;
  #running = false;

  public constructor(input: {
    store: SchedulerStore;
    collectReadiness: (input: {
      gameId: string;
      careerDid: string;
      careerResourceName: string;
    }) => Promise<ReadinessCollection>;
  }) {
    this.#store = input.store;
    this.#collectReadiness = input.collectReadiness;
  }

  public status() {
    return {
      running: this.#running,
      lastPassAt: this.#lastPassAt,
      lastError: this.#lastError,
    };
  }

  public async runPass(checkedAt: string): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const checked = Date.parse(checkedAt);
      for (const scheduled of await this.#store.listActive()) {
        const dueForReadiness =
          ["COMMITMENTS_OPEN", "LINEUPS_LOCKED"].includes(scheduled.state) &&
          checked >= Date.parse(scheduled.readinessCheckedAt);
        const dueForTipoff =
          scheduled.state === "READY" &&
          checked >= Date.parse(scheduled.scheduledTipoffAt);
        if (!dueForReadiness && !dueForTipoff) continue;
        if (dueForTipoff) {
          await this.#store.update(
            scheduled.gameId,
            scheduled.version,
            (current) => tipOffGame(current, checkedAt),
          );
          continue;
        }
        let game = scheduled;
        const excusedFailures: Array<{
          careerDid: string;
          classification: "ABL_SERVICE_FAILURE";
          evidenceCommitments: readonly `0x${string}`[];
        }> = [];
        for (const participant of game.participants.filter(
          ({ accepted }) => accepted,
        )) {
          const resourceName = game.careerResources[participant.careerDid];
          if (resourceName === undefined)
            throw new Error("Scheduled career resource mapping is incomplete");
          const collection = await this.#collectReadiness({
            gameId: game.gameId,
            careerDid: participant.careerDid,
            careerResourceName: resourceName,
          });
          if (collection.lease !== null) {
            game = await this.#store.update(
              game.gameId,
              game.version,
              (current) =>
                recordVerifiedReadinessLease({
                  game: current,
                  lease: collection.lease,
                  checkedAt,
                }),
            );
          } else {
            game = await this.#store.update(
              game.gameId,
              game.version,
              (current) =>
                recordReadiness({
                  game: current,
                  careerDid: participant.careerDid,
                  ready: false,
                  observedAt: checkedAt,
                  lease: null,
                }),
            );
            if (collection.failure === "ABL_SERVICE_FAILURE")
              excusedFailures.push({
                careerDid: participant.careerDid,
                classification: "ABL_SERVICE_FAILURE",
                evidenceCommitments: [collection.evidenceCommitment],
              });
          }
        }
        await this.#store.update(game.gameId, game.version, (current) =>
          beginGame(current, checkedAt, excusedFailures),
        );
      }
      this.#lastPassAt = checkedAt;
      this.#lastError = null;
    } catch (error) {
      this.#lastError =
        error instanceof Error ? error.message : "scheduler failed";
      throw error;
    } finally {
      this.#running = false;
    }
  }
}
