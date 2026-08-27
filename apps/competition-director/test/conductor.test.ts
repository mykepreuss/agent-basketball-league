import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import { FullGameEngine } from "@abl/basketball";
import { BASKETBALL_POSITIONS } from "@abl/schemas";
import { describe, expect, it } from "vitest";

import { CompetitionConductor } from "../src/conductor.js";
import {
  beginGame,
  createScheduledGame,
  lockLineup,
  tipOffGame,
  type CompetitionParticipant,
  type FoundingGameRuntime,
  type ScheduledGameState,
} from "../src/lifecycle.js";

const createdAt = "2026-08-26T12:00:00.000Z";
const tipoffAt = "2026-08-27T12:00:00.000Z";
const gameId = "0198e000-0000-7000-8000-000000000701";

function playerPositionProfile(index: number) {
  const primaryPosition = BASKETBALL_POSITIONS[index % 5]!;
  const eligiblePositions =
    index < 5 ? [primaryPosition] : [...BASKETBALL_POSITIONS];
  return {
    primaryPosition,
    eligiblePositions,
    profileCommitment: sha256Commitment({
      primaryPosition,
      eligiblePositions,
    }),
  };
}

function runtime(input: {
  possessionId: string;
  authoritativeStateRoot: `0x${string}`;
  eventMerkleRoot: `0x${string}`;
}): FoundingGameRuntime {
  const positions = ["PG", "SG", "SF", "PF", "C"] as const;
  const playerCareerDids = Object.fromEntries(
    (["HOME", "AWAY"] as const).flatMap((team) =>
      Array.from({ length: 8 }, (_, index) => [
        `${team === "HOME" ? "H" : "A"}${index + 1}`,
        `did:abl:${team.toLowerCase()}-player-${index}`,
      ]),
    ),
  );
  const gameInput = {
    gameId,
    roster: {
      home: Array.from({ length: 8 }, (_, index) => `H${index + 1}`),
      away: Array.from({ length: 8 }, (_, index) => `A${index + 1}`),
    },
    active: {
      home: Array.from({ length: 5 }, (_, index) => `H${index + 1}`),
      away: Array.from({ length: 5 }, (_, index) => `A${index + 1}`),
    },
    openingPossession: "HOME",
  } as const;
  return {
    input: gameInput,
    commands: [],
    playerCareerDids,
    playerStates: (["HOME", "AWAY"] as const).flatMap((team) =>
      positions.map((position, index) => ({
        playerId: `${team === "HOME" ? "H" : "A"}${index + 1}`,
        did: `did:abl:${team.toLowerCase()}-player-${index}`,
        team,
        position,
        xCm: team === "HOME" ? 2_500 - index * 180 : 800 + index * 180,
        yCm: 250 + index * 240,
        maxSpeedCmPerWindow: 100,
        shootingBps: 7_000,
        passingBps: 7_000,
        defenseBps: 7_000,
        stamina: 100,
      })),
    ),
    possessionProofs: [
      {
        possessionId: input.possessionId,
        playerDecisionHashes: Array.from({ length: 20 }, (_, index) =>
          sha256Commitment(`player-${index}`),
        ),
        coachDecisionHashes: Array.from({ length: 4 }, (_, index) =>
          sha256Commitment(`coach-${index}`),
        ),
        refereeDecisionHashes: Array.from({ length: 3 }, (_, index) =>
          sha256Commitment(`referee-${index}`),
        ),
        replayDecisionHashes: Array.from({ length: 2 }, (_, index) =>
          sha256Commitment(`replay-${index}`),
        ),
        authorityDids: {
          players: Array.from(
            { length: 20 },
            (_, index) => `did:abl:player-${index}`,
          ),
          coaches: Array.from(
            { length: 4 },
            (_, index) => `did:abl:coach-${index}`,
          ),
          referees: Array.from(
            { length: 3 },
            (_, index) => `did:abl:referee-${index}`,
          ),
          replayOfficials: Array.from(
            { length: 2 },
            (_, index) => `did:abl:replay-${index}`,
          ),
        },
        eventMerkleRoot: input.eventMerkleRoot,
        finalStateRoot: input.authoritativeStateRoot,
      },
    ],
    fullGameProof: new FullGameEngine(gameInput).proof(),
    phase: "LIVE",
  };
}

function inProgressGame(): ScheduledGameState {
  const participants: CompetitionParticipant[] = [];
  for (const team of ["HOME", "AWAY"] as const) {
    for (let index = 0; index < 8; index += 1)
      participants.push({
        careerDid: `did:abl:${team.toLowerCase()}-player-${index}`,
        role: "PLAYER",
        team,
        signerAddress: createSigningIdentity().address,
        accepted: true,
        ready: true,
        active: index < 5,
        alternate: index >= 5,
        positionProfile: playerPositionProfile(index),
        currentPosition: index < 5 ? BASKETBALL_POSITIONS[index]! : null,
        eligibilityStatus: "ELIGIBLE",
        missState: { consecutive: 0, total: 0 },
        participation: null,
        readinessLease: null,
      });
    participants.push({
      careerDid: `did:abl:${team.toLowerCase()}-coach`,
      role: "COACH",
      team,
      signerAddress: createSigningIdentity().address,
      accepted: true,
      ready: true,
      active: true,
      alternate: false,
      positionProfile: null,
      currentPosition: null,
      eligibilityStatus: "ELIGIBLE",
      missState: { consecutive: 0, total: 0 },
      participation: null,
      readinessLease: null,
    });
  }
  for (let index = 0; index < 6; index += 1)
    participants.push({
      careerDid: `did:abl:referee-${index}`,
      role: "REFEREE",
      team: null,
      signerAddress: createSigningIdentity().address,
      accepted: true,
      ready: true,
      active: index < 3,
      alternate: index >= 3,
      positionProfile: null,
      currentPosition: null,
      eligibilityStatus: "ELIGIBLE",
      missState: { consecutive: 0, total: 0 },
      participation: null,
      readinessLease: null,
    });
  for (let index = 0; index < 2; index += 1)
    participants.push({
      careerDid: `did:abl:replay-${index}`,
      role: "REPLAY",
      team: null,
      signerAddress: createSigningIdentity().address,
      accepted: true,
      ready: true,
      active: true,
      alternate: false,
      positionProfile: null,
      currentPosition: null,
      eligibilityStatus: "ELIGIBLE",
      missState: { consecutive: 0, total: 0 },
      participation: null,
      readinessLease: null,
    });
  let game = createScheduledGame({
    gameId,
    scheduledTipoffAt: tipoffAt,
    participants,
    careerResources: Object.fromEntries(
      participants.map(({ careerDid }, index) => [
        careerDid,
        `abl-career-${String(index).padStart(2, "0")}`,
      ]),
    ),
    now: createdAt,
  });
  for (const team of ["HOME", "AWAY"] as const) {
    const prefix = `did:abl:${team.toLowerCase()}-player-`;
    game = lockLineup({
      game,
      lineup: {
        gameId: game.gameId,
        coachDid: `did:abl:${team.toLowerCase()}-coach`,
        team,
        schemaVersion: 2,
        assignments: BASKETBALL_POSITIONS.map((position, index) => ({
          position,
          careerDid: `${prefix}${index}`,
        })),
        orderedBench: Array.from(
          { length: 3 },
          (_, index) => `${prefix}${index + 5}`,
        ),
        submittedAt: "2026-08-27T11:45:00.000Z",
        signature: `0x${"1".repeat(130)}`,
      },
    });
  }
  game = beginGame(game, "2026-08-27T11:55:00.000Z");
  return tipOffGame(game, tipoffAt);
}

describe("restartable competition conductor", () => {
  it("reserves one stable step and records it exactly once", async () => {
    let game = inProgressGame();
    const store = {
      async listActive() {
        return [game];
      },
      async update(
        _gameId: string,
        expectedVersion: number,
        transition: (current: ScheduledGameState) => ScheduledGameState,
      ) {
        expect(expectedVersion).toBe(game.version);
        game = await transition(game);
        return game;
      },
    };
    const stepIds: string[] = [];
    const conductor = new CompetitionConductor({
      store,
      executor: {
        async conductPossession({ stepId, sequence }) {
          stepIds.push(stepId);
          return {
            stepId,
            possessionId: `possession-${sequence}`,
            authoritativeStateRoot: sha256Commitment("state"),
            eventMerkleRoot: sha256Commitment("events"),
            canonicalEventHash: sha256Commitment("canonical"),
            recordedAt: "2026-08-27T12:00:30.000Z",
            basketballRuntime: runtime({
              possessionId: `possession-${sequence}`,
              authoritativeStateRoot: sha256Commitment("state"),
              eventMerkleRoot: sha256Commitment("events"),
            }),
            activationOutcomes: [],
          };
        },
        async finalizeGame() {
          throw new Error("not reached");
        },
      },
    });
    await conductor.runPass("2026-08-27T12:00:01.000Z");
    expect(stepIds).toEqual([`${gameId}:possession:1`]);
    expect(game.completedPossessions).toHaveLength(1);
    expect(game.conductorLease).toBeNull();
  });

  it("fails closed with a content-free error and reclaims the same step", async () => {
    let game = inProgressGame();
    const store = {
      async listActive() {
        return [game];
      },
      async update(
        _gameId: string,
        expectedVersion: number,
        transition: (current: ScheduledGameState) => ScheduledGameState,
      ) {
        expect(expectedVersion).toBe(game.version);
        game = await transition(game);
        return game;
      },
    };
    const stepIds: string[] = [];
    const conductor = new CompetitionConductor({
      store,
      executor: {
        async conductPossession({ stepId }) {
          stepIds.push(stepId);
          if (stepIds.length === 1) throw new Error("sensitive upstream text");
          return {
            stepId,
            possessionId: "possession-1",
            authoritativeStateRoot: sha256Commitment("state"),
            eventMerkleRoot: sha256Commitment("events"),
            canonicalEventHash: sha256Commitment("canonical"),
            recordedAt: "2026-08-27T12:01:01.000Z",
            basketballRuntime: runtime({
              possessionId: "possession-1",
              authoritativeStateRoot: sha256Commitment("state"),
              eventMerkleRoot: sha256Commitment("events"),
            }),
            activationOutcomes: [],
          };
        },
        async finalizeGame() {
          throw new Error("not reached");
        },
      },
    });
    await conductor.runPass("2026-08-27T12:00:01.000Z");
    expect(game.lastConductorErrorCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(game.conductorLease).toMatchObject({
      reservedAt: "2026-08-27T12:00:01.000Z",
      expiresAt: "2026-08-27T12:00:01.000Z",
      attempt: 1,
    });
    expect(JSON.stringify(game)).not.toContain("sensitive upstream text");
    await conductor.runPass("2026-08-27T12:01:00.000Z");
    expect(stepIds).toEqual([
      `${gameId}:possession:1`,
      `${gameId}:possession:1`,
    ]);
    expect(game.completedPossessions).toHaveLength(1);
  });

  it("reserves and completes the finalization step after the last possession", async () => {
    const stateRoot = sha256Commitment("final-state");
    const eventRoot = sha256Commitment("final-events");
    let game: ScheduledGameState = {
      ...inProgressGame(),
      state: "FINALIZING",
      completedPossessions: [
        {
          sequence: 1,
          possessionId: "possession-final",
          authoritativeStateRoot: stateRoot,
          eventMerkleRoot: eventRoot,
          canonicalEventHash: sha256Commitment("possession-event"),
          recordedAt: "2026-08-27T12:00:30.000Z",
        },
      ],
      basketballRuntime: {
        ...runtime({
          possessionId: "possession-final",
          authoritativeStateRoot: stateRoot,
          eventMerkleRoot: eventRoot,
        }),
        phase: "FINAL",
      },
      stateRoot: sha256Commitment("finalizing-state"),
    };
    const store = {
      async listActive() {
        return [game];
      },
      async update(
        _gameId: string,
        expectedVersion: number,
        transition: (current: ScheduledGameState) => ScheduledGameState,
      ) {
        expect(expectedVersion).toBe(game.version);
        game = await transition(game);
        return game;
      },
    };
    const finalizedSteps: string[] = [];
    const conductor = new CompetitionConductor({
      store,
      executor: {
        async conductPossession() {
          throw new Error("not reached");
        },
        async finalizeGame({ stepId }) {
          finalizedSteps.push(stepId);
          return {
            stepId,
            gameBundleCommitment: sha256Commitment("bundle"),
            liveStateRoot: stateRoot,
            replayStateRoot: stateRoot,
            finalizedEventHash: sha256Commitment("finalized-event"),
            finalizedAt: "2026-08-27T12:01:00.000Z",
          };
        },
      },
    });
    await conductor.runPass("2026-08-27T12:01:00.000Z");
    expect(finalizedSteps).toEqual([`${gameId}:finalization:1`]);
    expect(game).toMatchObject({
      state: "COMPLETED",
      conductorLease: null,
      finalization: {
        liveStateRoot: stateRoot,
        replayStateRoot: stateRoot,
      },
    });
  });
});
