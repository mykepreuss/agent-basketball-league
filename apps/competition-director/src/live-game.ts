import {
  FinalizedGamePayloadSchema,
  FullGameEngine,
  FullGameInputSchema,
  POSSESSION_RESOLVED_SCHEMA_DIGEST_V2,
  PlayerStateSchema,
  observePlayer,
  officialDecisionContextRoot,
  possessionInputToWire,
  replayFullGame,
  resolvePossessionDynamically,
  stateRoot,
  createAgentPlayedGameEvidence,
  type AgentPlayedPossessionEvidence,
  type BasketballState,
  type CoachDecision,
  type FullGameInput,
  type FinalizedGamePayload,
  type GameCommand,
  type PossessionInput,
  type PossessionResult,
  type PlayerState,
  type RefereeDecision,
  type ReplayDecision,
  type SignedPlayerDecision,
} from "@abl/basketball";
import { roleDecisionSchemaDigest } from "@abl/cognition";
import { sha256Commitment } from "@abl/recognition";
import {
  BASKETBALL_POSITIONS,
  SignedCanonicalCommandSchema,
  type RoleActivation,
} from "@abl/schemas";
import type { CanonicalEvent } from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import {
  FoundingGameRuntimeSchema,
  resolveLineupAssignments,
  type FoundingGameRuntime,
  type ScheduledGameState,
} from "./lifecycle.js";

const ActivationResponseSchema = z.strictObject({
  participantResultAccepted: z.boolean(),
  decision: z
    .object({
      authorizationEvent: SignedCanonicalCommandSchema.shape.event,
      eventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
      receipt: z
        .object({
          completedAt: z.iso.datetime({ offset: true }),
        })
        .passthrough(),
    })
    .passthrough(),
});

export interface LiveCareerActivationDispatcher {
  dispatch(input: {
    careerResourceName: string;
    activation: RoleActivation;
  }): Promise<unknown>;
}

export interface LivePossessionSubmitter {
  submit(input: {
    careerResourceName: string;
    sequence: number;
    previousEventHash: `0x${string}` | null;
    possessionInput: ReturnType<typeof possessionInputToWire>;
    recordedAt: string;
  }): Promise<{
    canonicalEventHash: `0x${string}`;
    finalStateRoot: `0x${string}`;
    eventMerkleRoot: `0x${string}`;
  }>;
  finalize(input: {
    careerResourceName: string;
    finalizedGame: FinalizedGamePayload;
    recordedAt: string;
  }): Promise<{ canonicalEventHash: `0x${string}` }>;
}

export interface ConductedLivePossession {
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

function deterministicPlayerId(team: "HOME" | "AWAY", index: number) {
  return `${team === "HOME" ? "H" : "A"}${index + 1}`;
}

function currentPositionsByCareer(game: ScheduledGameState) {
  return new Map(
    game.participants
      .filter(
        (participant) =>
          participant.role === "PLAYER" &&
          participant.active &&
          participant.currentPosition !== null,
      )
      .map((participant) => [
        participant.careerDid,
        participant.currentPosition!,
      ]),
  );
}

export function createInitialRuntime(
  game: ScheduledGameState,
): FoundingGameRuntime {
  if (game.lineups.HOME === null || game.lineups.AWAY === null)
    throw new Error("The conductor requires both locked lineups");
  const playerCareerDids: Record<string, string> = {};
  const roster = { home: [] as string[], away: [] as string[] };
  const active = { home: [] as string[], away: [] as string[] };
  for (const team of ["HOME", "AWAY"] as const) {
    const lineup = game.lineups[team]!;
    const activeAssignments = resolveLineupAssignments(lineup);
    const selected = new Set([
      ...activeAssignments.map(({ careerDid }) => careerDid),
      ...lineup.orderedBench,
    ]);
    const careers = [
      ...activeAssignments.map(({ careerDid }) => careerDid),
      ...lineup.orderedBench,
      ...game.participants
        .filter(
          (participant) =>
            participant.role === "PLAYER" &&
            participant.team === team &&
            !selected.has(participant.careerDid),
        )
        .map(({ careerDid }) => careerDid)
        .sort(),
    ];
    if (careers.length !== 8)
      throw new Error(
        "Founding Exhibition runtime requires eight-player teams",
      );
    for (const [index, careerDid] of careers.entries()) {
      const playerId = deterministicPlayerId(team, index);
      playerCareerDids[playerId] = careerDid;
      roster[team.toLowerCase() as "home" | "away"].push(playerId);
      if (index < 5)
        active[team.toLowerCase() as "home" | "away"].push(playerId);
    }
  }
  const input = FullGameInputSchema.parse({
    gameId: game.gameId,
    roster,
    active,
    openingPossession: "HOME",
  }) as FullGameInput;
  const engine = new FullGameEngine(input);
  return FoundingGameRuntimeSchema.parse({
    input,
    commands: [],
    playerCareerDids,
    playerStates: createPlayerStates(
      engine.snapshot(),
      playerCareerDids,
      [],
      currentPositionsByCareer(game),
    ),
    possessionProofs: [],
    fullGameProof: engine.proof(),
    phase: engine.snapshot().phase,
  });
}

function createPlayerStates(
  game: ReturnType<FullGameEngine["snapshot"]>,
  playerCareerDids: Readonly<Record<string, string>>,
  previous: readonly PlayerState[] = [],
  positionsByCareer: ReadonlyMap<string, PlayerState["position"]> = new Map(),
) {
  const priorByPlayer = new Map(
    previous.map((player) => [player.playerId, player]),
  );
  return PlayerStateSchema.array()
    .length(10)
    .parse(
      (["HOME", "AWAY"] as const).flatMap((team) =>
        game.active[team.toLowerCase() as "home" | "away"].map(
          (playerId, index) => {
            const prior = priorByPlayer.get(playerId);
            const position =
              positionsByCareer.get(playerCareerDids[playerId]!) ??
              BASKETBALL_POSITIONS[index]!;
            return prior === undefined
              ? {
                  playerId,
                  did: playerCareerDids[playerId],
                  team,
                  position,
                  xCm:
                    team === "HOME" ? 2_500 - index * 180 : 800 + index * 180,
                  yCm: 250 + index * 240 + (team === "AWAY" ? 35 : 0),
                  maxSpeedCmPerWindow: 95 + index * 3,
                  shootingBps: index === 0 ? 9_000 : 6_500 + index * 250,
                  passingBps: 7_500 - index * 200,
                  defenseBps: 5_800 + index * 300,
                  stamina: 100,
                }
              : {
                  ...prior,
                  position,
                };
          },
        ),
      ),
    );
}

function restoreEngine(runtime: FoundingGameRuntime): FullGameEngine {
  const engine = new FullGameEngine(runtime.input);
  for (const command of runtime.commands) engine.apply(command as GameCommand);
  return engine;
}

function reconcileActiveLineups(
  engine: FullGameEngine,
  game: ScheduledGameState,
  playerCareerDids: Readonly<Record<string, string>>,
): void {
  const playerIdByCareer = new Map(
    Object.entries(playerCareerDids).map(([playerId, careerDid]) => [
      careerDid,
      playerId,
    ]),
  );
  for (const team of ["HOME", "AWAY"] as const) {
    const activeParticipants = game.participants
      .filter(
        (participant) =>
          participant.role === "PLAYER" &&
          participant.team === team &&
          participant.active,
      )
      .sort(
        (left, right) =>
          BASKETBALL_POSITIONS.indexOf(left.currentPosition!) -
          BASKETBALL_POSITIONS.indexOf(right.currentPosition!),
      );
    if (
      activeParticipants.length !== BASKETBALL_POSITIONS.length ||
      !BASKETBALL_POSITIONS.every(
        (position) =>
          activeParticipants.filter(
            (participant) => participant.currentPosition === position,
          ).length === 1,
      )
    )
      throw new Error(`${team} active lineup has invalid position coverage`);
    const desired = activeParticipants
      .map(({ careerDid }) => playerIdByCareer.get(careerDid))
      .filter((playerId): playerId is string => playerId !== undefined);
    if (desired.length !== 5)
      throw new Error(`Conductor requires five active ${team} players`);
    const key = team.toLowerCase() as "home" | "away";
    const current = engine.snapshot().active[key];
    const outgoing = current.filter((playerId) => !desired.includes(playerId));
    const incoming = desired.filter((playerId) => !current.includes(playerId));
    if (outgoing.length !== incoming.length)
      throw new Error("League and basketball lineups cannot be reconciled");
    if (outgoing.length > 0 && engine.snapshot().phase !== "DEAD")
      throw new Error("Player substitution must wait for a dead ball");
    for (const [index, outPlayerId] of outgoing.entries())
      engine.apply({
        type: "SUBSTITUTE",
        team,
        outPlayerId,
        inPlayerId: incoming[index]!,
      });
  }
}

function materializeDecision<T>(raw: unknown): T {
  const response = ActivationResponseSchema.parse(raw);
  return {
    ...response.decision,
    authorizationEvent: {
      ...response.decision.authorizationEvent,
      aggregateVersion: BigInt(
        response.decision.authorizationEvent.aggregateVersion,
      ),
    } as CanonicalEvent,
  } as T;
}

function participantFor(
  game: ScheduledGameState,
  careerDid: string,
  role: "PLAYER" | "COACH" | "REFEREE" | "REPLAY",
) {
  const participant = game.participants.find(
    (candidate) => candidate.careerDid === careerDid && candidate.role === role,
  );
  if (participant === undefined || !participant.active)
    throw new Error("Conductor selected an inactive career");
  const careerResourceName = game.careerResources[careerDid];
  if (careerResourceName === undefined)
    throw new Error("Conductor career resource mapping is incomplete");
  return { participant, careerResourceName };
}

function currentRoleParticipants(
  game: ScheduledGameState,
  role: "COACH" | "REFEREE" | "REPLAY",
) {
  const selected = game.participants.filter(
    (participant) =>
      participant.role === role && participant.active && participant.ready,
  );
  const expected = role === "COACH" ? 2 : role === "REFEREE" ? 3 : 2;
  if (selected.length !== expected)
    throw new Error(
      `Conductor requires exactly ${expected} active ${role} careers`,
    );
  return selected;
}

function activationBase(input: {
  game: ScheduledGameState;
  careerDid: string;
  role: RoleActivation["role"];
  activationId: string;
  officialObservation: unknown;
  stateRoot: `0x${string}`;
  openedAt: string;
}) {
  return {
    schemaVersion: "1.0.0" as const,
    activationId: input.activationId,
    gameId: input.game.gameId,
    kind: "COMPETITION" as const,
    careerDid: input.careerDid,
    role: input.role,
    officialObservation: input.officialObservation,
    observationCommitment: sha256Commitment(input.officialObservation),
    stateRoot: input.stateRoot,
    contextPolicyCommitment: sha256Commitment({
      protocol: "ABL-MINIMUM-NECESSARY-CONTEXT-V2",
      careerDid: input.careerDid,
      role: input.role,
    }),
    expectedOutputSchemaDigest: roleDecisionSchemaDigest(input.role),
    openedAt: input.openedAt,
    deadlineAt: new Date(Date.parse(input.openedAt) + 20_000).toISOString(),
  };
}

function possessionState(input: {
  game: ScheduledGameState;
  runtime: FoundingGameRuntime;
  engine: FullGameEngine;
  possessionId: string;
}): BasketballState {
  const gameState = input.engine.snapshot();
  const players = createPlayerStates(
    gameState,
    input.runtime.playerCareerDids,
    input.runtime.playerStates,
    currentPositionsByCareer(input.game),
  );
  const possessorId =
    gameState.active[
      gameState.possessionTeam.toLowerCase() as "home" | "away"
    ][0]!;
  const possessor = players.find((player) => player.playerId === possessorId)!;
  return {
    gameId: input.game.gameId,
    possessionId: input.possessionId,
    quarter: gameState.period,
    gameClockMs: gameState.gameClockMs,
    shotClockMs: Math.min(24_000, gameState.gameClockMs),
    score: structuredClone(gameState.score),
    possessionTeam: gameState.possessionTeam,
    ball: { xCm: possessor.xCm, yCm: possessor.yCm, possessorId },
    players,
    window: 0,
    phase: "LIVE",
  };
}

function decisionProof(input: PossessionInput): AgentPlayedPossessionEvidence {
  return {
    possessionId: input.initialState.possessionId,
    playerDecisionHashes: input.windows.flatMap(({ decisions }) =>
      decisions.map(({ eventHash }) => eventHash),
    ),
    coachDecisionHashes: input.windows.flatMap(({ coaches }) =>
      coaches.map(({ eventHash }) => eventHash),
    ),
    refereeDecisionHashes: input.refereeDecisions.map(
      ({ eventHash }) => eventHash,
    ),
    replayDecisionHashes: input.replayDecisions.map(
      ({ eventHash }) => eventHash,
    ),
    authorityDids: {
      players: input.windows.flatMap(({ decisions }) =>
        decisions.map(({ authorizationEvent }) => authorizationEvent.actorDid),
      ),
      coaches: input.windows.flatMap(({ coaches }) =>
        coaches.map(({ coachDid }) => coachDid),
      ),
      referees: input.refereeDecisions.map(({ refereeDid }) => refereeDid),
      replayOfficials: input.replayDecisions.map(({ replayDid }) => replayDid),
    },
    eventMerkleRoot: "0x".padEnd(66, "0") as `0x${string}`,
    finalStateRoot: "0x".padEnd(66, "0") as `0x${string}`,
  };
}

function applyPossessionToFullGame(
  engine: FullGameEngine,
  possession: PossessionResult,
  elapsedMs: number,
): void {
  engine.apply({ type: "TICK", milliseconds: elapsedMs });
  if (engine.snapshot().gameClockMs === 0) {
    engine.apply({ type: "END_PERIOD" });
    return;
  }
  const shot = possession.events.find(({ type }) => type === "SHOT");
  const outOfBounds = possession.events.find(
    ({ type }) => type === "OUT_OF_BOUNDS",
  );
  if (shot !== undefined) {
    const shooter = z.string().parse(shot.data.shooter);
    const points = z
      .union([z.literal(0), z.literal(2), z.literal(3)])
      .parse(shot.data.points);
    const team = possession.finalState.players.find(
      ({ playerId }) => playerId === shooter,
    )!.team;
    engine.apply({
      type: "SHOT",
      team,
      playerId: shooter,
      points: points === 3 ? 3 : 2,
      made: shot.data.made === true,
    });
    if (shot.data.made !== true) {
      const rebound = possession.events.find(({ type }) => type === "REBOUND");
      if (rebound === undefined)
        throw new Error("Missed distributed shot has no rebound");
      engine.apply({
        type: "REBOUND",
        team: z.enum(["HOME", "AWAY"]).parse(rebound.data.team),
        playerId: z.string().parse(rebound.data.playerId),
      });
    }
    return;
  }
  if (outOfBounds !== undefined) {
    engine.apply({
      type: "OUT_OF_BOUNDS",
      lastTouchedBy: z.enum(["HOME", "AWAY"]).parse(outOfBounds.data.team),
    });
    return;
  }
  if (engine.snapshot().phase === "LIVE")
    engine.apply({
      type: "VIOLATION",
      team: engine.snapshot().possessionTeam,
      playerId: null,
      kind: "SHOT_CLOCK",
    });
}

export class FoundingLiveGameExecutor {
  readonly #dispatcher: LiveCareerActivationDispatcher;
  readonly #submitter: LivePossessionSubmitter;
  readonly #domain: TypedDataDomain;

  public constructor(input: {
    dispatcher: LiveCareerActivationDispatcher;
    submitter: LivePossessionSubmitter;
    domain: TypedDataDomain;
  }) {
    this.#dispatcher = input.dispatcher;
    this.#submitter = input.submitter;
    this.#domain = structuredClone(input.domain);
  }

  public async conduct(input: {
    game: ScheduledGameState;
    stepId: string;
    sequence: number;
  }): Promise<ConductedLivePossession> {
    const lease = input.game.conductorLease;
    if (lease === null || lease.stepId !== input.stepId)
      throw new Error(
        "Live game execution requires its durable conductor lease",
      );
    const runtime =
      input.game.basketballRuntime ?? createInitialRuntime(input.game);
    const engine = restoreEngine(runtime);
    if (engine.snapshot().phase === "FINAL")
      throw new Error("Final game cannot conduct another possession");
    reconcileActiveLineups(engine, input.game, runtime.playerCareerDids);
    if (engine.snapshot().phase === "DEAD") engine.apply({ type: "RESUME" });
    const possessionId = `${input.game.gameId}:possession:${String(input.sequence).padStart(4, "0")}`;
    const initialState = possessionState({
      game: input.game,
      runtime,
      engine,
      possessionId,
    });
    const windowDurationMs = Math.trunc(
      Math.min(23_000, initialState.gameClockMs) / 2,
    );
    if (windowDurationMs < 1)
      throw new Error("Game clock cannot fit another decision window");
    const activationOutcomes: ConductedLivePossession["activationOutcomes"] =
      [];
    const recordOutcome = (
      activation: RoleActivation,
      rawResponse: unknown,
    ) => {
      const response = ActivationResponseSchema.parse(rawResponse);
      activationOutcomes.push({
        activationId: activation.activationId,
        careerDid: activation.careerDid,
        completed: response.participantResultAccepted,
        activationCommitment: sha256Commitment(response.decision),
        recordedAt: response.decision.receipt.completedAt,
      });
      return response;
    };
    const resolved = await resolvePossessionDynamically(
      {
        initialState,
        windowCount: 2,
        playerSigningAddresses: new Map(
          initialState.players.map((player) => [
            player.playerId,
            participantFor(input.game, player.did, "PLAYER").participant
              .signerAddress as `0x${string}`,
          ]),
        ),
        authorities: {
          coaches: Object.fromEntries(
            currentRoleParticipants(input.game, "COACH").map((participant) => [
              participant.team!.toLowerCase(),
              {
                did: participant.careerDid,
                signerAddress: participant.signerAddress as `0x${string}`,
              },
            ]),
          ) as PossessionInput["authorities"]["coaches"],
          referees: currentRoleParticipants(input.game, "REFEREE").map(
            (participant) => ({
              did: participant.careerDid,
              signerAddress: participant.signerAddress as `0x${string}`,
            }),
          ),
          replayOfficials: currentRoleParticipants(input.game, "REPLAY").map(
            (participant) => ({
              did: participant.careerDid,
              signerAddress: participant.signerAddress as `0x${string}`,
            }),
          ),
        },
        domain: this.#domain,
        randomSeed: sha256Commitment({
          gameId: input.game.gameId,
          stepId: input.stepId,
          sequence: input.sequence,
          priorGameStateRoot: runtime.fullGameProof.finalStateRoot,
        }),
        windowDurationMs,
      },
      {
        decideWindow: async ({ state, windowIndex, windowId }) => {
          const openedAt =
            windowIndex === 0
              ? lease.reservedAt
              : activationOutcomes.reduce(
                  (latest, outcome) =>
                    Date.parse(outcome.recordedAt) > Date.parse(latest)
                      ? outcome.recordedAt
                      : latest,
                  lease.reservedAt,
                );
          const root = stateRoot(state);
          const playerRequests = state.players.map(async (player) => {
            const officialObservation = observePlayer(state, player.playerId);
            const activation = {
              ...activationBase({
                game: input.game,
                careerDid: player.did,
                role: "PLAYER",
                activationId: `${possessionId}:w${windowIndex}:${player.playerId}`,
                officialObservation,
                stateRoot: root,
                openedAt,
              }),
              role: "PLAYER" as const,
              playerId: player.playerId,
              teamId: player.team,
              windowId,
            } satisfies RoleActivation;
            const { careerResourceName } = participantFor(
              input.game,
              player.did,
              "PLAYER",
            );
            const raw = await this.#dispatcher.dispatch({
              careerResourceName,
              activation,
            });
            recordOutcome(activation, raw);
            return materializeDecision<SignedPlayerDecision>(raw);
          });
          const coachRequests = currentRoleParticipants(
            input.game,
            "COACH",
          ).map(async (coach) => {
            const officialObservation = {
              role: "COACH" as const,
              team: coach.team,
              windowId,
              gameState: state,
            };
            const activation = {
              ...activationBase({
                game: input.game,
                careerDid: coach.careerDid,
                role: "COACH",
                activationId: `${possessionId}:w${windowIndex}:coach:${coach.team!.toLowerCase()}`,
                officialObservation,
                stateRoot: root,
                openedAt,
              }),
              role: "COACH" as const,
              teamId: coach.team!,
              windowId,
            } satisfies RoleActivation;
            const raw = await this.#dispatcher.dispatch({
              careerResourceName: input.game.careerResources[coach.careerDid]!,
              activation,
            });
            recordOutcome(activation, raw);
            return materializeDecision<CoachDecision>(raw);
          });
          const [decisions, coaches] = await Promise.all([
            Promise.all(playerRequests),
            Promise.all(coachRequests),
          ]);
          return { windowId, decisions, coaches };
        },
        decideOfficials: async ({ state, windows, officialContext }) => {
          if (
            officialDecisionContextRoot({
              initialState,
              windows,
              randomSeed: sha256Commitment({
                gameId: input.game.gameId,
                stepId: input.stepId,
                sequence: input.sequence,
                priorGameStateRoot: runtime.fullGameProof.finalStateRoot,
              }),
            }) !== officialContext
          )
            throw new Error("Official context commitment diverged");
          const openedAt = activationOutcomes.reduce(
            (latest, outcome) =>
              Date.parse(outcome.recordedAt) > Date.parse(latest)
                ? outcome.recordedAt
                : latest,
            lease.reservedAt,
          );
          const refereeRequests = currentRoleParticipants(
            input.game,
            "REFEREE",
          ).map(async (referee, officiatingSequence) => {
            const officialObservation = {
              role: "REFEREE" as const,
              possessionId,
              officiatingSequence,
              officialContext,
              finalPossessionState: state,
            };
            const activation = {
              ...activationBase({
                game: input.game,
                careerDid: referee.careerDid,
                role: "REFEREE",
                activationId: `${possessionId}:referee:${officiatingSequence}`,
                officialObservation,
                stateRoot: officialContext,
                openedAt,
              }),
              role: "REFEREE" as const,
              possessionId,
              officiatingSequence,
            } satisfies RoleActivation;
            const raw = await this.#dispatcher.dispatch({
              careerResourceName:
                input.game.careerResources[referee.careerDid]!,
              activation,
            });
            recordOutcome(activation, raw);
            return materializeDecision<RefereeDecision>(raw);
          });
          const replayRequests = currentRoleParticipants(
            input.game,
            "REPLAY",
          ).map(async (official, reviewSequence) => {
            const officialObservation = {
              role: "REPLAY" as const,
              possessionId,
              reviewSequence,
              officialContext,
              finalPossessionState: state,
            };
            const activation = {
              ...activationBase({
                game: input.game,
                careerDid: official.careerDid,
                role: "REPLAY",
                activationId: `${possessionId}:replay:${reviewSequence}`,
                officialObservation,
                stateRoot: officialContext,
                openedAt,
              }),
              role: "REPLAY" as const,
              possessionId,
              reviewSequence,
            } satisfies RoleActivation;
            const raw = await this.#dispatcher.dispatch({
              careerResourceName:
                input.game.careerResources[official.careerDid]!,
              activation,
            });
            recordOutcome(activation, raw);
            return materializeDecision<ReplayDecision>(raw);
          });
          const [referees, replay] = await Promise.all([
            Promise.all(refereeRequests),
            Promise.all(replayRequests),
          ]);
          return { refereeDecisions: referees, replayDecisions: replay };
        },
      },
    );
    const recordedAt = activationOutcomes.reduce(
      (latest, outcome) =>
        Date.parse(outcome.recordedAt) > Date.parse(latest)
          ? outcome.recordedAt
          : latest,
      lease.reservedAt,
    );
    const priorCanonicalHash =
      input.game.completedPossessions.at(-1)?.canonicalEventHash ?? null;
    const finalizerDid = resolved.input.initialState.players.find(
      ({ playerId }) =>
        playerId === resolved.input.initialState.ball.possessorId,
    )!.did;
    const submission = await this.#submitter.submit({
      careerResourceName: participantFor(input.game, finalizerDid, "PLAYER")
        .careerResourceName,
      sequence: input.sequence,
      previousEventHash: priorCanonicalHash as `0x${string}` | null,
      possessionInput: possessionInputToWire(resolved.input),
      recordedAt,
    });
    if (
      submission.finalStateRoot !== resolved.result.finalStateRoot ||
      submission.eventMerkleRoot !== resolved.result.eventMerkleRoot
    )
      throw new Error(
        "Career-authorized possession differs from the director replay",
      );
    applyPossessionToFullGame(engine, resolved.result, windowDurationMs * 2);
    const proof = engine.proof();
    const replay = replayFullGame(runtime.input, engine.commands(), proof);
    if (!replay.exact)
      throw new Error("Distributed game runtime does not replay exactly");
    const evidence = decisionProof(resolved.input);
    evidence.eventMerkleRoot = resolved.result.eventMerkleRoot;
    evidence.finalStateRoot = resolved.result.finalStateRoot;
    const basketballRuntime = FoundingGameRuntimeSchema.parse({
      input: runtime.input,
      commands: engine.commands(),
      playerCareerDids: runtime.playerCareerDids,
      playerStates: resolved.result.finalState.players,
      possessionProofs: [...runtime.possessionProofs, evidence],
      fullGameProof: proof,
      phase: engine.snapshot().phase,
    });
    activationOutcomes.sort((left, right) =>
      left.activationId.localeCompare(right.activationId),
    );
    return {
      possessionId,
      authoritativeStateRoot: resolved.result.finalStateRoot,
      eventMerkleRoot: resolved.result.eventMerkleRoot,
      canonicalEventHash: submission.canonicalEventHash,
      recordedAt,
      basketballRuntime,
      activationOutcomes,
    };
  }

  public async finalize(input: {
    game: ScheduledGameState;
    stepId: string;
  }): Promise<{
    gameBundleCommitment: `0x${string}`;
    liveStateRoot: `0x${string}`;
    replayStateRoot: `0x${string}`;
    finalizedEventHash: `0x${string}`;
    finalizedAt: string;
  }> {
    const lease = input.game.conductorLease;
    const runtime = input.game.basketballRuntime;
    if (
      input.game.state !== "FINALIZING" ||
      lease?.kind !== "FINALIZATION" ||
      lease.stepId !== input.stepId ||
      runtime?.phase !== "FINAL" ||
      input.game.completedPossessions.length === 0
    )
      throw new Error("Live game finalization requires its completed runtime");
    const replay = replayFullGame(runtime.input, runtime.commands, {
      finalStateRoot: runtime.fullGameProof.finalStateRoot as `0x${string}`,
      eventMerkleRoot: runtime.fullGameProof.eventMerkleRoot as `0x${string}`,
      finalEventHash: runtime.fullGameProof.finalEventHash as `0x${string}`,
      winner: runtime.fullGameProof.winner as "HOME" | "AWAY",
    });
    if (!replay.exact || replay.state.phase !== "FINAL")
      throw new Error("Final game runtime does not replay exactly");
    const agentEvidence = createAgentPlayedGameEvidence({
      gameId: input.game.gameId,
      gameInput: runtime.input,
      commands: runtime.commands,
      proof: {
        finalStateRoot: runtime.fullGameProof.finalStateRoot as `0x${string}`,
        eventMerkleRoot: runtime.fullGameProof.eventMerkleRoot as `0x${string}`,
        finalEventHash: runtime.fullGameProof.finalEventHash as `0x${string}`,
        winner: runtime.fullGameProof.winner as "HOME" | "AWAY",
      },
      possessionProofs: runtime.possessionProofs,
    });
    const finalizerDid =
      agentEvidence.authorityEvidence?.participants.players[0];
    if (finalizerDid === undefined)
      throw new Error("Final game lacks a career player finalizer");
    const finalizedAt = lease.reservedAt;
    const finalizedGame = FinalizedGamePayloadSchema.parse({
      gameId: input.game.gameId,
      finalizedAt,
      competition: null,
      input: runtime.input,
      commands: runtime.commands,
      proof: runtime.fullGameProof,
      agentEvidence,
      filmCommitment: sha256Commitment({
        protocol: "ABL-FOUNDING-EXHIBITION-FILM-V1",
        gameId: input.game.gameId,
        possessionProofs: runtime.possessionProofs,
        finalStateRoot: runtime.fullGameProof.finalStateRoot,
      }),
      broadcastStartedAt: input.game.completedPossessions[0]!.recordedAt,
      broadcastIntervalMs: 0,
    });
    const submission = await this.#submitter.finalize({
      careerResourceName: participantFor(input.game, finalizerDid, "PLAYER")
        .careerResourceName,
      finalizedGame,
      recordedAt: finalizedAt,
    });
    return {
      gameBundleCommitment: sha256Commitment(finalizedGame),
      liveStateRoot: runtime.fullGameProof.finalStateRoot as `0x${string}`,
      replayStateRoot: replay.proof.finalStateRoot,
      finalizedEventHash: submission.canonicalEventHash,
      finalizedAt,
    };
  }
}

export { POSSESSION_RESOLVED_SCHEMA_DIGEST_V2 };
