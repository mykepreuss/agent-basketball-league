import { signCompetitionAssertion } from "@abl/cognition";
import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import { BASKETBALL_POSITIONS } from "@abl/schemas";
import { describe, expect, it } from "vitest";

import {
  createScheduledGame,
  lockLineup,
  type CompetitionParticipant,
} from "../src/lifecycle.js";
import { CompetitionScheduler, type SchedulerStore } from "../src/scheduler.js";

const createdAt = "2026-08-26T12:00:00.000Z";
const readinessAt = "2026-08-27T11:55:00.000Z";
const tipoffAt = "2026-08-27T12:00:00.000Z";
const lineupSignature = `0x${"1".repeat(130)}`;

describe("persistent competition scheduler", () => {
  it("collects signed T-5 leases and tips off after a director restart", async () => {
    const identities = new Map<
      string,
      ReturnType<typeof createSigningIdentity>
    >();
    const participants: CompetitionParticipant[] = [];
    const add = (input: Omit<CompetitionParticipant, "signerAddress">) => {
      const identity = createSigningIdentity();
      identities.set(input.careerDid, identity);
      participants.push({ ...input, signerAddress: identity.address });
    };
    for (const team of ["HOME", "AWAY"] as const) {
      for (let index = 0; index < 8; index += 1) {
        const primaryPosition = BASKETBALL_POSITIONS[index % 5]!;
        const eligiblePositions =
          index < 5 ? [primaryPosition] : [...BASKETBALL_POSITIONS];
        add({
          careerDid: `did:abl:${team.toLowerCase()}-player-${index}`,
          role: "PLAYER",
          team,
          accepted: true,
          ready: false,
          active: index < 5,
          alternate: index >= 5,
          positionProfile: {
            primaryPosition,
            eligiblePositions,
            profileCommitment: sha256Commitment({
              primaryPosition,
              eligiblePositions,
            }),
          },
          currentPosition: index < 5 ? BASKETBALL_POSITIONS[index]! : null,
          eligibilityStatus: "ELIGIBLE",
          missState: { consecutive: 0, total: 0 },
          participation: null,
          readinessLease: null,
        });
      }
      add({
        careerDid: `did:abl:${team.toLowerCase()}-coach`,
        role: "COACH",
        team,
        accepted: true,
        ready: false,
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
      add({
        careerDid: `did:abl:referee-${index}`,
        role: "REFEREE",
        team: null,
        accepted: true,
        ready: false,
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
      add({
        careerDid: `did:abl:replay-${index}`,
        role: "REPLAY",
        team: null,
        accepted: true,
        ready: false,
        active: true,
        alternate: false,
        positionProfile: null,
        currentPosition: null,
        eligibilityStatus: "ELIGIBLE",
        missState: { consecutive: 0, total: 0 },
        participation: null,
        readinessLease: null,
      });
    const resources = Object.fromEntries(
      participants.map(({ careerDid }, index) => [
        careerDid,
        `abl-career-${String(index).padStart(2, "0")}`,
      ]),
    );
    let game = createScheduledGame({
      gameId: "founding-exhibition-scheduler",
      scheduledTipoffAt: tipoffAt,
      participants,
      careerResources: resources,
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
          signature: lineupSignature,
        },
      });
    }
    const store: SchedulerStore = {
      async listActive() {
        return [game];
      },
      async update(_gameId, expectedVersion, transition) {
        expect(expectedVersion).toBe(game.version);
        game = await transition(game);
        return game;
      },
    };
    const collectReadiness = async (input: {
      gameId: string;
      careerDid: string;
      careerResourceName: string;
    }) => {
      const participant = participants.find(
        ({ careerDid }) => careerDid === input.careerDid,
      )!;
      const identity = identities.get(input.careerDid)!;
      const index = participants.indexOf(participant);
      const unsigned = {
        schemaVersion: "1.0.0" as const,
        leaseId: `0198e000-0000-7000-8000-${String(index + 700).padStart(12, "0")}`,
        gameId: input.gameId,
        careerDid: input.careerDid,
        runnerId: `runner-${index}`,
        role: participant.role,
        state: "READY" as const,
        issuedAt: readinessAt,
        expiresAt: "2026-08-27T11:57:00.000Z",
        heartbeatCommitment: sha256Commitment({
          resource: input.careerResourceName,
          observedAt: readinessAt,
        }),
      };
      return {
        lease: {
          ...unsigned,
          careerSignature: await signCompetitionAssertion(identity.privateKey, {
            kind: "READINESS_LEASE",
            careerDid: input.careerDid,
            subjectCommitment: sha256Commitment(unsigned),
            timestamp: readinessAt,
          }),
        },
        failure: null,
      } as const;
    };
    await new CompetitionScheduler({ store, collectReadiness }).runPass(
      readinessAt,
    );
    expect(game.state).toBe("READY");
    expect(game.participants.every(({ ready }) => ready)).toBe(true);

    await new CompetitionScheduler({ store, collectReadiness }).runPass(
      tipoffAt,
    );
    expect(game.state).toBe("IN_PROGRESS");
  });
});
