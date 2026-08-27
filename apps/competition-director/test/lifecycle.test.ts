import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import { BASKETBALL_POSITIONS } from "@abl/schemas";
import { describe, expect, it } from "vitest";

import {
  beginGame,
  applyCoachSubstitution,
  completeScheduledGame,
  createScheduledGame,
  findLegalPositionAssignment,
  lockLineup,
  recordActivationAvailability,
  recordActivationBatch,
  recordPossessionResolution,
  recordReadiness,
  resumeGame,
  tipOffGame,
  type CompetitionParticipant,
} from "../src/lifecycle.js";

const at = "2026-08-26T12:00:00.000Z";
const tipoff = "2026-08-27T12:00:00.000Z";
const signature = `0x${"1".repeat(130)}`;

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

function roster(): CompetitionParticipant[] {
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
  return participants;
}

function careerResources(participants: readonly CompetitionParticipant[]) {
  return Object.fromEntries(
    participants.map(({ careerDid }, index) => [
      careerDid,
      `abl-career-${String(index).padStart(2, "0")}`,
    ]),
  );
}

function withLineups() {
  const participants = roster();
  let game = createScheduledGame({
    gameId: "founding-exhibition-1",
    scheduledTipoffAt: tipoff,
    participants,
    careerResources: careerResources(participants),
    now: at,
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
        signature,
      },
    });
  }
  game = beginGame(game, "2026-08-27T11:55:00.000Z");
  return tipOffGame(game, tipoff);
}

describe("scheduled competition lifecycle", () => {
  it("requires a distinct career Sandbox for every scheduled career", () => {
    const participants = roster();
    const resources = careerResources(participants);
    resources[participants[1]!.careerDid] =
      resources[participants[0]!.careerDid]!;
    expect(() =>
      createScheduledGame({
        gameId: "founding-exhibition-shared-career",
        scheduledTipoffAt: tipoff,
        participants,
        careerResources: resources,
        now: at,
      }),
    ).toThrow("distinct Sandbox");
  });

  it("requires every eight-player roster to cover PG, SG, SF, PF, and C", () => {
    const participants = roster().map((participant) => {
      if (participant.role !== "PLAYER" || participant.team !== "HOME")
        return participant;
      const primaryPosition = "PG" as const;
      const eligiblePositions = ["PG"] as const;
      return {
        ...participant,
        positionProfile: {
          primaryPosition,
          eligiblePositions: [...eligiblePositions],
          profileCommitment: sha256Commitment({
            primaryPosition,
            eligiblePositions: [...eligiblePositions],
          }),
        },
      };
    });
    expect(
      findLegalPositionAssignment(
        participants.filter(
          (participant) =>
            participant.role === "PLAYER" && participant.team === "HOME",
        ),
      ),
    ).toBeNull();
    expect(() =>
      createScheduledGame({
        gameId: "founding-exhibition-no-center",
        scheduledTipoffAt: tipoff,
        participants,
        careerResources: careerResources(participants),
        now: at,
      }),
    ).toThrow("cannot field one eligible PG, SG, SF, PF, and C");
  });

  it("rejects an explicit lineup that assigns a career outside its eligible positions", () => {
    const participants = roster();
    const game = createScheduledGame({
      gameId: "founding-exhibition-wrong-position",
      scheduledTipoffAt: tipoff,
      participants,
      careerResources: careerResources(participants),
      now: at,
    });
    expect(() =>
      lockLineup({
        game,
        lineup: {
          schemaVersion: 2,
          gameId: game.gameId,
          coachDid: "did:abl:home-coach",
          team: "HOME",
          assignments: [
            { position: "PG", careerDid: "did:abl:home-player-1" },
            { position: "SG", careerDid: "did:abl:home-player-0" },
            { position: "SF", careerDid: "did:abl:home-player-2" },
            { position: "PF", careerDid: "did:abl:home-player-3" },
            { position: "C", careerDid: "did:abl:home-player-4" },
          ],
          orderedBench: [
            "did:abl:home-player-5",
            "did:abl:home-player-6",
            "did:abl:home-player-7",
          ],
          submittedAt: "2026-08-27T11:45:00.000Z",
          signature,
        },
      }),
    ).toThrow("is not career-profile eligible to play PG");
  });

  it("forms two eight-player teams with active fives and ordered benches", () => {
    const game = withLineups();
    expect(game.state).toBe("IN_PROGRESS");
    for (const team of ["HOME", "AWAY"] as const) {
      const players = game.participants.filter(
        (participant) =>
          participant.role === "PLAYER" && participant.team === team,
      );
      expect(players.filter(({ active }) => active)).toHaveLength(5);
      expect(players.filter(({ alternate }) => alternate)).toHaveLength(3);
      expect(
        players
          .filter(({ active }) => active)
          .map(({ currentPosition }) => currentPosition)
          .sort(),
      ).toEqual([...BASKETBALL_POSITIONS].sort());
    }
  });

  it("allows a team with five accepted players to lock an empty bench", () => {
    const participants = roster().map((participant) =>
      participant.role === "PLAYER" &&
      participant.team === "HOME" &&
      Number(participant.careerDid.at(-1)) >= 5
        ? { ...participant, accepted: false, active: false, alternate: false }
        : participant,
    );
    let game = createScheduledGame({
      gameId: "founding-exhibition-five-ready",
      scheduledTipoffAt: tipoff,
      participants,
      careerResources: careerResources(participants),
      now: at,
    });
    expect(() =>
      lockLineup({
        game,
        lineup: {
          gameId: game.gameId,
          coachDid: "did:abl:home-coach",
          team: "HOME",
          schemaVersion: 2,
          assignments: BASKETBALL_POSITIONS.map((position, index) => ({
            position,
            careerDid: `did:abl:home-player-${index}`,
          })),
          orderedBench: [],
          submittedAt: "2026-08-27T11:45:00.000Z",
          signature,
        },
      }),
    ).not.toThrow();
  });

  it("records only evidence-backed accepted-game readiness failures as adverse", () => {
    let game = withLineups();
    game = {
      ...game,
      state: "LINEUPS_LOCKED",
      participants: game.participants.map((participant) =>
        ["did:abl:home-player-0", "did:abl:away-player-0"].includes(
          participant.careerDid,
        )
          ? { ...participant, ready: false }
          : participant,
      ),
    };
    const checked = beginGame(game, "2026-08-27T11:56:00.000Z", [
      {
        careerDid: "did:abl:away-player-0",
        classification: "SHARED_PROVIDER_INCIDENT",
        evidenceCommitments: [sha256Commitment("provider-incident")],
      },
    ]);
    expect(checked.state).toBe("POSTPONED");
    expect(checked.availabilityIncidents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          careerDid: "did:abl:home-player-0",
          classification: "UNEXCUSED_NO_SHOW",
          excused: false,
        }),
        expect.objectContaining({
          careerDid: "did:abl:away-player-0",
          classification: "SHARED_PROVIDER_INCIDENT",
          excused: true,
        }),
      ]),
    );
  });

  it("uses one fallback then queues the next ready bench substitution", () => {
    let game = withLineups();
    const careerDid = "did:abl:home-player-0";
    game = recordActivationAvailability({
      game,
      activationId: "activation-player-miss-1",
      careerDid,
      completed: false,
      activationCommitment: sha256Commitment("miss-1"),
      recordedAt: "2026-08-27T12:01:00.000Z",
    });
    expect(
      game.participants.find((player) => player.careerDid === careerDid)
        ?.active,
    ).toBe(true);
    game = recordActivationAvailability({
      game,
      activationId: "activation-player-miss-2",
      careerDid,
      completed: false,
      activationCommitment: sha256Commitment("miss-2"),
      recordedAt: "2026-08-27T12:02:00.000Z",
    });
    expect(
      game.participants.find((player) => player.careerDid === careerDid)
        ?.active,
    ).toBe(true);
    expect(
      game.participants.find(
        (player) => player.careerDid === "did:abl:home-player-5",
      )?.active,
    ).toBe(false);
    expect(game.pendingSubstitutions).toEqual([
      expect.objectContaining({
        outCareerDid: careerDid,
        inCareerDid: "did:abl:home-player-5",
        role: "PLAYER",
        team: "HOME",
      }),
    ]);
  });

  it("skips an incompatible reserve when replacing a missing player", () => {
    let game = withLineups();
    const profile = (
      eligiblePositions: (typeof BASKETBALL_POSITIONS)[number][],
    ) => ({
      primaryPosition: eligiblePositions[0]!,
      eligiblePositions,
      profileCommitment: sha256Commitment({
        primaryPosition: eligiblePositions[0]!,
        eligiblePositions,
      }),
    });
    game = {
      ...game,
      participants: game.participants.map((participant) =>
        participant.careerDid === "did:abl:home-player-5"
          ? { ...participant, positionProfile: profile(["SG"]) }
          : participant.careerDid === "did:abl:home-player-6"
            ? { ...participant, positionProfile: profile(["PG"]) }
            : participant,
      ),
      stateRoot: sha256Commitment("position-aware-reserve-test"),
    };
    for (let index = 1; index <= 2; index += 1)
      game = recordActivationAvailability({
        game,
        activationId: `position-aware-miss-${index}`,
        careerDid: "did:abl:home-player-0",
        completed: false,
        activationCommitment: sha256Commitment(`position-aware-${index}`),
        recordedAt: `2026-08-27T12:0${index}:30.000Z`,
      });
    expect(game.pendingSubstitutions).toEqual([
      expect.objectContaining({
        outCareerDid: "did:abl:home-player-0",
        inCareerDid: "did:abl:home-player-6",
        position: "PG",
      }),
    ]);
  });

  it("applies a coach-signed dead-ball substitution only with a complete legal remapping", () => {
    const game = withLineups();
    const substituted = applyCoachSubstitution({
      game,
      substitution: {
        schemaVersion: 2,
        gameId: game.gameId,
        coachDid: "did:abl:home-coach",
        team: "HOME",
        outCareerDid: "did:abl:home-player-0",
        inCareerDid: "did:abl:home-player-5",
        assignments: BASKETBALL_POSITIONS.map((position, index) => ({
          position,
          careerDid:
            index === 0
              ? "did:abl:home-player-5"
              : `did:abl:home-player-${index}`,
        })),
        submittedAt: "2026-08-27T12:00:01.000Z",
        signature,
      },
    });
    expect(
      substituted.participants.find(
        ({ careerDid }) => careerDid === "did:abl:home-player-0",
      ),
    ).toMatchObject({ active: false, currentPosition: null });
    expect(
      substituted.participants.find(
        ({ careerDid }) => careerDid === "did:abl:home-player-5",
      ),
    ).toMatchObject({ active: true, currentPosition: "PG" });
    expect(() =>
      applyCoachSubstitution({
        game,
        substitution: {
          schemaVersion: 2,
          gameId: game.gameId,
          coachDid: "did:abl:home-coach",
          team: "HOME",
          outCareerDid: "did:abl:home-player-0",
          inCareerDid: "did:abl:home-player-5",
          assignments: BASKETBALL_POSITIONS.map((position, index) => ({
            position,
            careerDid:
              index === 0 ? "did:abl:home-player-5" : "did:abl:home-player-1",
          })),
          submittedAt: "2026-08-27T12:00:01.000Z",
          signature,
        },
      }),
    ).toThrow("one distinct career to every position");
  });

  it("records a simultaneous role batch in one durable game version", () => {
    const game = withLineups();
    const next = recordActivationBatch({
      game,
      outcomes: [
        {
          activationId: "activation-home-player-0",
          careerDid: "did:abl:home-player-0",
          completed: true,
          activationCommitment: sha256Commitment("home-player-decision"),
          recordedAt: "2026-08-27T12:01:00.000Z",
        },
        {
          activationId: "activation-away-player-0",
          careerDid: "did:abl:away-player-0",
          completed: false,
          activationCommitment: sha256Commitment("away-player-fallback"),
          recordedAt: "2026-08-27T12:01:00.000Z",
        },
      ],
    });
    expect(next.version).toBe(game.version + 1);
    expect(next.activationOutcomes).toHaveLength(2);
    expect(next.completedActivationCommitments).toEqual([
      sha256Commitment("home-player-decision"),
    ]);
    expect(
      next.participants.find(
        ({ careerDid }) => careerDid === "did:abl:away-player-0",
      )?.missState,
    ).toEqual({ consecutive: 1, total: 1 });
  });

  it("suspends exact state when no replay reserve exists and resumes after readiness returns", () => {
    let game = withLineups();
    const careerDid = "did:abl:replay-0";
    for (const [index, recordedAt] of [
      "2026-08-27T12:01:00.000Z",
      "2026-08-27T12:02:00.000Z",
    ].entries())
      game = recordActivationAvailability({
        game,
        activationId: `activation-replay-miss-${index}`,
        careerDid,
        completed: false,
        activationCommitment: sha256Commitment(`replay-miss-${index}`),
        recordedAt,
      });
    expect(game).toMatchObject({
      state: "SUSPENDED",
      suspension: { exactStateRoot: expect.stringMatching(/^0x[0-9a-f]{64}$/) },
    });
    game = recordReadiness({
      game,
      careerDid,
      ready: true,
      observedAt: "2026-08-27T12:03:00.000Z",
    });
    const resumed = resumeGame(game, "2026-08-27T12:04:00.000Z");
    expect(resumed.state).toBe("IN_PROGRESS");
    expect(resumed.completedActivationCommitments).toEqual(
      game.completedActivationCommitments,
    );
  });

  it("durably checkpoints possessions and finalizes only an exact replay", () => {
    const game = withLineups();
    const root = sha256Commitment("final-state");
    const checkpointed = recordPossessionResolution({
      game,
      sequence: 1,
      possessionId: "possession-1",
      authoritativeStateRoot: root,
      eventMerkleRoot: sha256Commitment("events"),
      canonicalEventHash: sha256Commitment("canonical-event"),
      recordedAt: "2026-08-27T12:03:00.000Z",
    });
    expect(checkpointed.completedPossessions).toHaveLength(1);
    const stepId = `${checkpointed.gameId}:finalization`;
    const finalizing = {
      ...checkpointed,
      state: "FINALIZING" as const,
      conductorLease: {
        stepId,
        kind: "FINALIZATION" as const,
        sequence: 1,
        reservedAt: "2026-08-27T13:59:00.000Z",
        expiresAt: "2026-08-27T14:01:00.000Z",
        attempt: 1,
      },
    };
    expect(() =>
      completeScheduledGame({
        game: finalizing,
        stepId,
        gameBundleCommitment: sha256Commitment("bundle"),
        liveStateRoot: root,
        replayStateRoot: sha256Commitment("divergent"),
        finalizedEventHash: sha256Commitment("finalized-event"),
        finalizedAt: "2026-08-27T14:00:00.000Z",
      }),
    ).toThrow("Exact replay diverged");
    expect(
      completeScheduledGame({
        game: finalizing,
        stepId,
        gameBundleCommitment: sha256Commitment("bundle"),
        liveStateRoot: root,
        replayStateRoot: root,
        finalizedEventHash: sha256Commitment("finalized-event"),
        finalizedAt: "2026-08-27T14:00:00.000Z",
      }).state,
    ).toBe("COMPLETED");
  });

  it("keeps a reserve-only player out of the starting five", () => {
    const participants = roster().map((participant) =>
      participant.careerDid === "did:abl:home-player-0"
        ? {
            ...participant,
            eligibilityStatus: "RESERVE_ONLY_NEXT_GAME" as const,
          }
        : participant,
    );
    let game = createScheduledGame({
      gameId: "founding-exhibition-reserve-policy",
      scheduledTipoffAt: tipoff,
      participants,
      careerResources: careerResources(participants),
      now: at,
    });
    expect(() =>
      lockLineup({
        game,
        lineup: {
          gameId: game.gameId,
          coachDid: "did:abl:home-coach",
          team: "HOME",
          activeFive: Array.from(
            { length: 5 },
            (_, index) => `did:abl:home-player-${index}`,
          ),
          orderedBench: Array.from(
            { length: 3 },
            (_, index) => `did:abl:home-player-${index + 5}`,
          ),
          submittedAt: "2026-08-27T11:45:00.000Z",
          signature,
        },
      }),
    ).toThrow("Reserve-only careers cannot start");
  });
});
