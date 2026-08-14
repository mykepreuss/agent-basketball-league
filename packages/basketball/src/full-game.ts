import { merkleRoot, sha256Commitment } from "@abl/recognition";

import type { Team } from "./types.js";

export const REGULATION_PERIOD_MS = 12 * 60 * 1_000;
export const OVERTIME_PERIOD_MS = 5 * 60 * 1_000;
export const SHOT_CLOCK_MS = 24 * 1_000;

export type GamePhase = "LIVE" | "DEAD" | "FINAL";
export type ViolationKind =
  | "TRAVEL"
  | "DOUBLE_DRIBBLE"
  | "SHOT_CLOCK"
  | "BACKCOURT"
  | "THREE_SECONDS";
export type FoulKind = "PERSONAL" | "SHOOTING" | "TECHNICAL" | "FLAGRANT_2";

export interface FullGameState {
  gameId: string;
  period: number;
  periodKind: "REGULATION" | "OVERTIME";
  gameClockMs: number;
  shotClockMs: number;
  score: Record<Lowercase<Team>, number>;
  possessionTeam: Team;
  phase: GamePhase;
  active: Record<Lowercase<Team>, string[]>;
  bench: Record<Lowercase<Team>, string[]>;
  timeouts: Record<Lowercase<Team>, number>;
  challenges: Record<Lowercase<Team>, number>;
  teamFouls: Record<Lowercase<Team>, number>;
  bonus: Record<Lowercase<Team>, boolean>;
  playerFouls: Record<string, number>;
  ejectedPlayerIds: string[];
  injuredPlayerIds: string[];
  pendingFreeThrows: { team: Team; remaining: number } | null;
  freeThrowLaneActive: boolean;
  restart: { kind: "THROW_IN"; team: Team } | { kind: "JUMP_BALL" } | null;
  protests: Array<{ team: Team; reasonCode: string; eventSequence: number }>;
  winner: Team | null;
}

export type GameCommand =
  | { type: "TICK"; milliseconds: number }
  | { type: "SHOT"; team: Team; playerId: string; points: 2 | 3; made: boolean }
  | { type: "REBOUND"; team: Team; playerId: string }
  | { type: "FREE_THROW"; team: Team; playerId: string; made: boolean }
  | {
      type: "FOUL";
      byTeam: Team;
      playerId: string;
      kind: FoulKind;
      freeThrows: 0 | 1 | 2 | 3;
    }
  | {
      type: "VIOLATION";
      team: Team;
      playerId: string | null;
      kind: ViolationKind;
    }
  | { type: "OUT_OF_BOUNDS"; lastTouchedBy: Team }
  | { type: "THROW_IN"; team: Team; playerId: string }
  | { type: "HELD_BALL" }
  | { type: "JUMP_BALL"; winningTeam: Team }
  | { type: "GOALTENDING"; byTeam: Team; awardedTeam: Team; points: 2 | 3 }
  | { type: "SUBSTITUTE"; team: Team; outPlayerId: string; inPlayerId: string }
  | { type: "TIMEOUT"; team: Team }
  | { type: "INJURY"; team: Team; playerId: string }
  | { type: "CHALLENGE"; team: Team; targetEventSequence: number }
  | {
      type: "REPLAY_RULING";
      targetEventSequence: number;
      ruling: "CONFIRM" | "REVERSE";
    }
  | { type: "PROTEST"; team: Team; reasonCode: string; eventSequence: number }
  | { type: "RESUME" }
  | { type: "END_PERIOD" };

export interface FullGameEvent {
  sequence: number;
  type:
    | GameCommand["type"]
    | "SHOT_CLOCK_EXPIRED"
    | "PLAYER_EJECTED"
    | "GAME_FINAL";
  period: number;
  gameClockMs: number;
  data: Record<string, string | number | boolean | null>;
  previousEventHash: `0x${string}` | null;
  stateRoot: `0x${string}`;
  eventHash: `0x${string}`;
}

export interface FullGameInput {
  gameId: string;
  roster: Record<Lowercase<Team>, readonly string[]>;
  active: Record<Lowercase<Team>, readonly string[]>;
  openingPossession: Team;
}

function side(team: Team): Lowercase<Team> {
  return team.toLowerCase() as Lowercase<Team>;
}

function other(team: Team): Team {
  return team === "HOME" ? "AWAY" : "HOME";
}

function assertDistinct(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`${label} contains duplicates`);
}

const reviewableEventTypes = new Set<FullGameEvent["type"]>([
  "SHOT",
  "SHOT_CLOCK_EXPIRED",
  "OUT_OF_BOUNDS",
  "GOALTENDING",
]);

export class FullGameEngine {
  readonly input: FullGameInput;
  readonly #commands: GameCommand[] = [];
  readonly #events: FullGameEvent[] = [];
  readonly #stateBeforeEvents = new Map<number, FullGameState>();
  #state: FullGameState;
  #pendingChallenge: { team: Team; targetEventSequence: number } | null = null;

  public constructor(input: FullGameInput) {
    const allPlayers = [...input.roster.home, ...input.roster.away];
    assertDistinct(allPlayers, "Game roster");
    for (const team of ["HOME", "AWAY"] as const) {
      const key = side(team);
      assertDistinct(input.active[key], `${team} lineup`);
      if (input.active[key].length !== 5)
        throw new Error("Each team must start exactly five active players");
      if (
        input.active[key].some(
          (playerId) => !input.roster[key].includes(playerId),
        )
      )
        throw new Error("Active player is absent from roster");
    }
    this.input = structuredClone(input);
    this.#state = {
      gameId: input.gameId,
      period: 1,
      periodKind: "REGULATION",
      gameClockMs: REGULATION_PERIOD_MS,
      shotClockMs: SHOT_CLOCK_MS,
      score: { home: 0, away: 0 },
      possessionTeam: input.openingPossession,
      phase: "LIVE",
      active: { home: [...input.active.home], away: [...input.active.away] },
      bench: {
        home: input.roster.home.filter(
          (playerId) => !input.active.home.includes(playerId),
        ),
        away: input.roster.away.filter(
          (playerId) => !input.active.away.includes(playerId),
        ),
      },
      timeouts: { home: 7, away: 7 },
      challenges: { home: 2, away: 2 },
      teamFouls: { home: 0, away: 0 },
      bonus: { home: false, away: false },
      playerFouls: Object.fromEntries(
        allPlayers.map((playerId) => [playerId, 0]),
      ),
      ejectedPlayerIds: [],
      injuredPlayerIds: [],
      pendingFreeThrows: null,
      freeThrowLaneActive: false,
      restart: null,
      protests: [],
      winner: null,
    };
  }

  public apply(command: GameCommand): FullGameEvent[] {
    if ("winner" in (command as unknown as Record<string, unknown>))
      throw new Error("Winner input is forbidden");
    if (this.#state.phase === "FINAL") throw new Error("Game is final");
    const eventCountBefore = this.#events.length;
    const stateBefore = structuredClone(this.#state);
    const pendingChallengeBefore = structuredClone(this.#pendingChallenge);
    try {
      this.#resolve(command);
      this.#commands.push(structuredClone(command));
      for (
        let sequence = eventCountBefore;
        sequence < this.#events.length;
        sequence += 1
      ) {
        this.#stateBeforeEvents.set(sequence, structuredClone(stateBefore));
      }
      return structuredClone(this.#events.slice(eventCountBefore));
    } catch (error) {
      this.#state = stateBefore;
      this.#events.splice(eventCountBefore);
      this.#pendingChallenge = pendingChallengeBefore;
      throw error;
    }
  }

  #resolve(command: GameCommand): void {
    switch (command.type) {
      case "TICK": {
        if (this.#state.phase !== "LIVE")
          throw new Error("Clock runs only while the ball is live");
        if (
          !Number.isInteger(command.milliseconds) ||
          command.milliseconds <= 0
        )
          throw new Error("Clock tick must be a positive integer");
        const elapsed = Math.min(command.milliseconds, this.#state.gameClockMs);
        this.#state.gameClockMs -= elapsed;
        this.#state.shotClockMs = Math.max(
          0,
          this.#state.shotClockMs - elapsed,
        );
        this.#record(command.type, { milliseconds: elapsed });
        if (this.#state.shotClockMs === 0 && this.#state.gameClockMs > 0) {
          const penalized = this.#state.possessionTeam;
          this.#changePossession(other(penalized));
          this.#state.phase = "DEAD";
          this.#state.restart = { kind: "THROW_IN", team: other(penalized) };
          this.#record("SHOT_CLOCK_EXPIRED", { team: penalized });
        }
        return;
      }
      case "SHOT": {
        this.#assertLivePossession(command.team, command.playerId);
        if (command.made) {
          this.#state.score[side(command.team)] += command.points;
          this.#changePossession(other(command.team));
          this.#state.phase = "DEAD";
          this.#state.restart = {
            kind: "THROW_IN",
            team: other(command.team),
          };
        }
        this.#record(command.type, command);
        return;
      }
      case "REBOUND": {
        this.#assertActive(command.team, command.playerId);
        this.#changePossession(command.team);
        this.#state.phase = "LIVE";
        this.#record(command.type, command);
        return;
      }
      case "FREE_THROW": {
        const pending = this.#state.pendingFreeThrows;
        if (
          this.#state.phase !== "DEAD" ||
          !this.#state.freeThrowLaneActive ||
          pending === null ||
          pending.team !== command.team ||
          pending.remaining < 1
        )
          throw new Error("No free throw is pending for this team");
        this.#assertActive(command.team, command.playerId);
        if (command.made) this.#state.score[side(command.team)] += 1;
        pending.remaining -= 1;
        if (pending.remaining === 0) {
          this.#state.pendingFreeThrows = null;
          this.#state.freeThrowLaneActive = false;
          if (command.made) {
            const receivingTeam = other(command.team);
            this.#changePossession(receivingTeam);
            this.#state.restart = {
              kind: "THROW_IN",
              team: receivingTeam,
            };
          }
        }
        this.#record(command.type, command);
        return;
      }
      case "FOUL": {
        if (
          this.#state.phase !== "LIVE" ||
          this.#state.pendingFreeThrows !== null
        ) {
          throw new Error("A foul command requires live play");
        }
        this.#assertActive(command.byTeam, command.playerId);
        const count = (this.#state.playerFouls[command.playerId] ?? 0) + 1;
        this.#state.playerFouls[command.playerId] = count;
        const offended = other(command.byTeam);
        if (command.kind !== "TECHNICAL") {
          const key = side(command.byTeam);
          this.#state.teamFouls[key] += 1;
          this.#state.bonus[side(offended)] = this.#state.teamFouls[key] >= 5;
        }
        const awardedFreeThrows = Math.max(
          command.freeThrows,
          this.#state.bonus[side(offended)] ? 2 : 0,
        );
        if (awardedFreeThrows > 0) {
          this.#state.pendingFreeThrows = {
            team: offended,
            remaining: awardedFreeThrows,
          };
          this.#state.freeThrowLaneActive = true;
          this.#state.restart = null;
        } else {
          this.#changePossession(offended);
          this.#state.restart = { kind: "THROW_IN", team: offended };
        }
        this.#state.phase = "DEAD";
        this.#record(command.type, {
          ...command,
          foulCount: count,
          teamFouls: this.#state.teamFouls[side(command.byTeam)],
          bonus: this.#state.bonus[side(offended)],
          awardedFreeThrows,
        });
        if (count >= 6 || command.kind === "FLAGRANT_2") {
          if (!this.#state.ejectedPlayerIds.includes(command.playerId))
            this.#state.ejectedPlayerIds.push(command.playerId);
          this.#state.active[side(command.byTeam)] = this.#state.active[
            side(command.byTeam)
          ].filter((id) => id !== command.playerId);
          this.#record("PLAYER_EJECTED", {
            team: command.byTeam,
            playerId: command.playerId,
            reason: command.kind,
          });
        }
        return;
      }
      case "VIOLATION": {
        if (command.team !== this.#state.possessionTeam)
          throw new Error("Violation is charged to the possessing team");
        this.#changePossession(other(command.team));
        this.#state.phase = "DEAD";
        this.#state.restart = { kind: "THROW_IN", team: other(command.team) };
        this.#record(command.type, command);
        return;
      }
      case "OUT_OF_BOUNDS": {
        this.#changePossession(other(command.lastTouchedBy));
        this.#state.phase = "DEAD";
        this.#state.restart = {
          kind: "THROW_IN",
          team: other(command.lastTouchedBy),
        };
        this.#record(command.type, command);
        return;
      }
      case "THROW_IN": {
        if (
          this.#state.phase !== "DEAD" ||
          this.#state.pendingFreeThrows !== null ||
          this.#state.restart?.kind !== "THROW_IN" ||
          this.#state.restart.team !== command.team
        ) {
          throw new Error(
            "Throw-in does not match the awarded dead-ball restart",
          );
        }
        this.#assertActive(command.team, command.playerId);
        this.#changePossession(command.team);
        this.#state.restart = null;
        this.#state.phase = "LIVE";
        this.#record(command.type, command);
        return;
      }
      case "HELD_BALL": {
        if (this.#state.phase !== "LIVE")
          throw new Error("Held ball requires live play");
        this.#state.phase = "DEAD";
        this.#state.restart = { kind: "JUMP_BALL" };
        this.#record(command.type, {});
        return;
      }
      case "JUMP_BALL": {
        if (
          this.#state.phase !== "DEAD" ||
          this.#state.pendingFreeThrows !== null ||
          this.#state.restart?.kind !== "JUMP_BALL"
        ) {
          throw new Error("Jump ball is not the awarded dead-ball restart");
        }
        this.#changePossession(command.winningTeam);
        this.#state.restart = null;
        this.#state.phase = "LIVE";
        this.#record(command.type, command);
        return;
      }
      case "GOALTENDING": {
        if (command.byTeam === command.awardedTeam)
          throw new Error(
            "A team cannot receive points for its own goaltending",
          );
        this.#state.score[side(command.awardedTeam)] += command.points;
        this.#changePossession(command.byTeam);
        this.#state.phase = "DEAD";
        this.#state.restart = {
          kind: "THROW_IN",
          team: command.byTeam,
        };
        this.#record(command.type, command);
        return;
      }
      case "SUBSTITUTE": {
        if (this.#state.phase !== "DEAD")
          throw new Error("Substitutions require a dead ball");
        const key = side(command.team);
        const outWasRemovedByEjection =
          this.#state.ejectedPlayerIds.includes(command.outPlayerId) &&
          this.input.roster[key].includes(command.outPlayerId) &&
          this.#state.active[key].length === 4;
        if (
          (!this.#state.active[key].includes(command.outPlayerId) &&
            !outWasRemovedByEjection) ||
          !this.#state.bench[key].includes(command.inPlayerId)
        ) {
          throw new Error("Illegal substitution participants");
        }
        if (
          this.#state.ejectedPlayerIds.includes(command.inPlayerId) ||
          this.#state.injuredPlayerIds.includes(command.inPlayerId)
        ) {
          throw new Error("Unavailable player cannot substitute into the game");
        }
        this.#state.active[key] = outWasRemovedByEjection
          ? [...this.#state.active[key], command.inPlayerId]
          : this.#state.active[key].map((id) =>
              id === command.outPlayerId ? command.inPlayerId : id,
            );
        this.#state.bench[key] = this.#state.bench[key].filter(
          (id) => id !== command.inPlayerId,
        );
        if (!this.#state.ejectedPlayerIds.includes(command.outPlayerId))
          this.#state.bench[key].push(command.outPlayerId);
        this.#record(command.type, command);
        return;
      }
      case "TIMEOUT": {
        const key = side(command.team);
        if (this.#state.timeouts[key] < 1)
          throw new Error("Team has no timeout remaining");
        this.#state.timeouts[key] -= 1;
        this.#state.phase = "DEAD";
        this.#record(command.type, command);
        return;
      }
      case "INJURY": {
        this.#assertActive(command.team, command.playerId);
        if (!this.#state.injuredPlayerIds.includes(command.playerId))
          this.#state.injuredPlayerIds.push(command.playerId);
        this.#state.phase = "DEAD";
        this.#record(command.type, command);
        return;
      }
      case "CHALLENGE": {
        const key = side(command.team);
        const target = this.#events[command.targetEventSequence];
        if (
          this.#state.challenges[key] < 1 ||
          this.#pendingChallenge !== null ||
          command.targetEventSequence !== this.#events.length - 1 ||
          target === undefined ||
          !reviewableEventTypes.has(target.type)
        )
          throw new Error(
            "Challenge is unavailable or does not target the latest reviewable event",
          );
        this.#state.challenges[key] -= 1;
        this.#state.phase = "DEAD";
        this.#pendingChallenge = {
          team: command.team,
          targetEventSequence: command.targetEventSequence,
        };
        this.#record(command.type, command);
        return;
      }
      case "REPLAY_RULING": {
        const pending = this.#pendingChallenge;
        if (
          pending === null ||
          pending.targetEventSequence !== command.targetEventSequence
        )
          throw new Error("Replay does not match the pending challenge");
        if (command.ruling === "REVERSE") {
          const corrected = this.#stateBeforeEvents.get(
            command.targetEventSequence,
          );
          if (corrected === undefined)
            throw new Error("Replay correction state is unavailable");
          const challenges = structuredClone(this.#state.challenges);
          this.#state = structuredClone(corrected);
          this.#state.challenges = challenges;
          this.#state.phase = "DEAD";
        }
        this.#pendingChallenge = null;
        this.#record(command.type, command);
        return;
      }
      case "PROTEST": {
        if (this.#events[command.eventSequence] === undefined)
          throw new Error("Protest targets an unknown event");
        this.#state.protests.push(structuredClone(command));
        this.#record(command.type, command);
        return;
      }
      case "RESUME": {
        if (
          this.#state.phase !== "DEAD" ||
          this.#state.pendingFreeThrows !== null
        )
          throw new Error("Game cannot resume yet");
        if (
          this.#state.active.home.length !== 5 ||
          this.#state.active.away.length !== 5
        )
          throw new Error("Both teams require five active players");
        if (this.#state.restart?.kind === "JUMP_BALL")
          throw new Error("A jump ball must resolve before play resumes");
        if (this.#state.restart?.kind === "THROW_IN")
          this.#changePossession(this.#state.restart.team);
        this.#state.restart = null;
        this.#state.phase = "LIVE";
        this.#record(command.type, {});
        return;
      }
      case "END_PERIOD": {
        if (this.#state.gameClockMs !== 0)
          throw new Error("Period clock has not expired");
        this.#record(command.type, { period: this.#state.period });
        if (this.#state.period < 4) {
          this.#startPeriod(
            this.#state.period + 1,
            "REGULATION",
            REGULATION_PERIOD_MS,
          );
        } else if (this.#state.score.home === this.#state.score.away) {
          this.#startPeriod(
            this.#state.period + 1,
            "OVERTIME",
            OVERTIME_PERIOD_MS,
          );
        } else {
          this.#finalize();
        }
        return;
      }
    }
  }

  #startPeriod(
    period: number,
    kind: FullGameState["periodKind"],
    duration: number,
  ): void {
    this.#state.period = period;
    this.#state.periodKind = kind;
    this.#state.gameClockMs = duration;
    this.#state.shotClockMs = SHOT_CLOCK_MS;
    this.#state.teamFouls = { home: 0, away: 0 };
    this.#state.bonus = { home: false, away: false };
    this.#state.pendingFreeThrows = null;
    this.#state.freeThrowLaneActive = false;
    this.#state.restart = null;
    this.#state.possessionTeam =
      period % 2 === 0
        ? other(this.input.openingPossession)
        : this.input.openingPossession;
    this.#state.phase = "LIVE";
  }

  #finalize(): void {
    this.#state.winner =
      this.#state.score.home > this.#state.score.away ? "HOME" : "AWAY";
    this.#state.phase = "FINAL";
    this.#record("GAME_FINAL", { winner: this.#state.winner, derived: true });
  }

  #changePossession(team: Team): void {
    this.#state.possessionTeam = team;
    this.#state.shotClockMs = Math.min(SHOT_CLOCK_MS, this.#state.gameClockMs);
  }

  #assertActive(team: Team, playerId: string): void {
    if (!this.#state.active[side(team)].includes(playerId))
      throw new Error("Player is not active for the team");
  }

  #assertLivePossession(team: Team, playerId: string): void {
    if (this.#state.phase !== "LIVE" || this.#state.possessionTeam !== team)
      throw new Error("Team does not have a live possession");
    this.#assertActive(team, playerId);
  }

  #record(type: FullGameEvent["type"], data: Record<string, unknown>): void {
    const sequence = this.#events.length;
    const previousEventHash = this.#events.at(-1)?.eventHash ?? null;
    const stateRoot = sha256Commitment(this.#state);
    const normalizedData = structuredClone(data) as FullGameEvent["data"];
    const eventHash = sha256Commitment({
      sequence,
      type,
      period: this.#state.period,
      gameClockMs: this.#state.gameClockMs,
      data: normalizedData,
      previousEventHash,
      stateRoot,
    });
    this.#events.push({
      sequence,
      type,
      period: this.#state.period,
      gameClockMs: this.#state.gameClockMs,
      data: normalizedData,
      previousEventHash,
      stateRoot,
      eventHash,
    });
  }

  public snapshot(): FullGameState {
    return structuredClone(this.#state);
  }

  public events(): readonly FullGameEvent[] {
    return structuredClone(this.#events);
  }

  public commands(): readonly GameCommand[] {
    return structuredClone(this.#commands);
  }

  public proof(): {
    finalStateRoot: `0x${string}`;
    eventMerkleRoot: `0x${string}`;
    finalEventHash: `0x${string}` | null;
    winner: Team | null;
  } {
    return {
      finalStateRoot: sha256Commitment(this.#state),
      eventMerkleRoot: merkleRoot(this.#events.map((event) => event.eventHash)),
      finalEventHash: this.#events.at(-1)?.eventHash ?? null,
      winner: this.#state.winner,
    };
  }
}

export function replayFullGame(
  input: FullGameInput,
  commands: readonly GameCommand[],
  expected: ReturnType<FullGameEngine["proof"]>,
) {
  const replay = new FullGameEngine(input);
  for (const command of commands) replay.apply(command);
  const proof = replay.proof();
  return {
    exact: sha256Commitment(proof) === sha256Commitment(expected),
    proof,
    state: replay.snapshot(),
    events: replay.events(),
    inferenceInvocations: 0 as const,
  };
}
