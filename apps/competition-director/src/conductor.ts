import { sha256Commitment } from "@abl/recognition";

import {
  failConductorStep,
  completeScheduledGame,
  recordConductedPossession,
  reserveConductorStep,
  type FoundingGameRuntime,
  type ScheduledGameState,
} from "./lifecycle.js";

export interface ConductorStore {
  listActive(): Promise<ScheduledGameState[]>;
  update(
    gameId: string,
    expectedVersion: number,
    transition: (
      game: ScheduledGameState,
    ) => Promise<ScheduledGameState> | ScheduledGameState,
  ): Promise<ScheduledGameState>;
}

export interface ConductedPossession {
  stepId: string;
  possessionId: string;
  authoritativeStateRoot: `0x${string}`;
  eventMerkleRoot: `0x${string}`;
  canonicalEventHash: `0x${string}`;
  recordedAt: string;
  basketballRuntime: FoundingGameRuntime;
  activationOutcomes: Array<{
    activationId: string;
    careerDid: string;
    completed: boolean;
    activationCommitment: `0x${string}`;
    recordedAt: string;
  }>;
}

export interface GameStepExecutor {
  conductPossession(input: {
    game: ScheduledGameState;
    stepId: string;
    sequence: number;
  }): Promise<ConductedPossession>;
  finalizeGame(input: { game: ScheduledGameState; stepId: string }): Promise<{
    stepId: string;
    gameBundleCommitment: `0x${string}`;
    liveStateRoot: `0x${string}`;
    replayStateRoot: `0x${string}`;
    finalizedEventHash: `0x${string}`;
    finalizedAt: string;
  }>;
}

/**
 * Claims and executes at most one authoritative possession per active game.
 * The durable step ID is stable across retries, so a restarted director can
 * safely recover an expired lease without duplicating inference or history.
 */
export class CompetitionConductor {
  readonly #store: ConductorStore;
  readonly #executor: GameStepExecutor;
  #running = false;
  #lastPassAt: string | null = null;
  #lastErrorCommitment: `0x${string}` | null = null;

  public constructor(input: {
    store: ConductorStore;
    executor: GameStepExecutor;
  }) {
    this.#store = input.store;
    this.#executor = input.executor;
  }

  public status() {
    return {
      running: this.#running,
      lastPassAt: this.#lastPassAt,
      lastErrorCommitment: this.#lastErrorCommitment,
    };
  }

  public async runPass(now: string): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      for (const listed of await this.#store.listActive()) {
        if (listed.state !== "IN_PROGRESS" && listed.state !== "FINALIZING")
          continue;
        if (
          listed.conductorLease !== null &&
          Date.parse(listed.conductorLease.expiresAt) > Date.parse(now)
        )
          continue;
        const reserved = await this.#store.update(
          listed.gameId,
          listed.version,
          (current) => reserveConductorStep({ game: current, reservedAt: now }),
        );
        const lease = reserved.conductorLease;
        if (lease === null) throw new Error("Conductor reservation was lost");
        try {
          if (lease.kind === "FINALIZATION") {
            const result = await this.#executor.finalizeGame({
              game: reserved,
              stepId: lease.stepId,
            });
            if (result.stepId !== lease.stepId)
              throw new Error("Executor returned another conductor step");
            await this.#store.update(
              reserved.gameId,
              reserved.version,
              (current) =>
                completeScheduledGame({
                  game: current,
                  stepId: result.stepId,
                  gameBundleCommitment: result.gameBundleCommitment,
                  liveStateRoot: result.liveStateRoot,
                  replayStateRoot: result.replayStateRoot,
                  finalizedEventHash: result.finalizedEventHash,
                  finalizedAt: result.finalizedAt,
                }),
            );
          } else {
            const result = await this.#executor.conductPossession({
              game: reserved,
              stepId: lease.stepId,
              sequence: lease.sequence,
            });
            if (result.stepId !== lease.stepId)
              throw new Error("Executor returned another conductor step");
            await this.#store.update(
              reserved.gameId,
              reserved.version,
              (current) =>
                recordConductedPossession({
                  game: current,
                  stepId: result.stepId,
                  possessionId: result.possessionId,
                  authoritativeStateRoot: result.authoritativeStateRoot,
                  eventMerkleRoot: result.eventMerkleRoot,
                  canonicalEventHash: result.canonicalEventHash,
                  recordedAt: result.recordedAt,
                  basketballRuntime: result.basketballRuntime,
                  activationOutcomes: result.activationOutcomes,
                }),
            );
          }
        } catch (error) {
          const failedAt = now;
          const commitment = sha256Commitment({
            classification: "CONDUCTOR_STEP_FAILED",
            gameId: reserved.gameId,
            stepId: lease.stepId,
            name: error instanceof Error ? error.name : "UnknownError",
          });
          await this.#store.update(
            reserved.gameId,
            reserved.version,
            (current) =>
              failConductorStep({
                game: current,
                stepId: lease.stepId,
                failedAt,
                errorCommitment: commitment,
              }),
          );
          this.#lastErrorCommitment = commitment;
        }
      }
      this.#lastPassAt = now;
    } finally {
      this.#running = false;
    }
  }
}
