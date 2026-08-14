import { describe, expect, it } from "vitest";
import { sha256Commitment } from "@abl/recognition";

import {
  ELECTION_WORKFLOW_SCHEMA_DIGEST,
  PREMIER_BOARD_ELECTION_INSTITUTION,
  applyElectionWorkflowTransition,
  electionWorkflowStateRoot,
  evaluatePremierElection,
  type ElectionWorkflowEvent,
  type ElectionWorkflowEventType,
  type ElectionWorkflowPayload,
  type ElectionWorkflowSnapshot,
} from "../src/election-workflow.js";

const electionId = "019cc4d0-7867-7000-8000-000000000001";
const snapshotId = "019cc4d0-7867-7000-8000-000000000002";
const premier = Array.from(
  { length: 9 },
  (_, index) => `did:abl:premier-${index + 1}`,
);
const commissioners = Array.from(
  { length: 3 },
  (_, index) => `did:abl:commissioner-${index + 1}`,
);
const snapshot = {
  snapshotId,
  capturedAt: "2026-08-01T00:00:00.000Z",
  members: {
    UNIVERSAL_CAREER_ASSEMBLY: [...premier],
    PREMIER_PLAYERS: [...premier],
    DEVELOPMENT_PLAYERS: [],
    PREMIER_TEAM_COUNCIL: [],
    DEVELOPMENT_TEAM_COUNCIL: [],
    EXECUTIVE_COMMISSION: [...commissioners],
    TRIBUNAL: [],
    INTEGRITY_OFFICE: [],
  },
};

function event(
  version: number,
  eventType: ElectionWorkflowEventType,
  actorDid: string,
  timestamp: string,
): ElectionWorkflowEvent {
  return {
    actorDid,
    aggregateId: electionId,
    aggregateVersion: BigInt(version),
    eventType,
    timestamp,
  };
}

function transition(
  current: ElectionWorkflowSnapshot | null,
  version: number,
  eventType: ElectionWorkflowEventType,
  actorDid: string,
  timestamp: string,
  payload: ElectionWorkflowPayload,
) {
  return applyElectionWorkflowTransition(
    current,
    event(version, eventType, actorDid, timestamp),
    payload,
  );
}

function open(): ElectionWorkflowSnapshot {
  return transition(
    null,
    1,
    "PremierElectionOpened",
    commissioners[0]!,
    "2026-08-02T00:00:00.000Z",
    {
      command: {
        electionId,
        termId: "season-zero-premier-board",
        institution: PREMIER_BOARD_ELECTION_INSTITUTION,
        seatCount: 8,
        eligibilitySnapshotId: snapshotId,
        eligibilitySnapshotDigest: sha256Commitment(snapshot),
        nominationOpensAt: "2026-08-02T00:00:00.000Z",
        nominationClosesAt: "2026-08-03T00:00:00.000Z",
        votingOpensAt: "2026-08-03T00:00:00.000Z",
        votingClosesAt: "2026-08-04T00:00:00.000Z",
      },
      eligibilitySnapshot: snapshot,
    },
  );
}

function nominateEight(current: ElectionWorkflowSnapshot) {
  let next = current;
  for (const [index, candidateDid] of premier.slice(0, 8).entries()) {
    next = transition(
      next,
      index + 2,
      "PremierElectionCandidateDeclared",
      candidateDid!,
      `2026-08-02T${String(index + 1).padStart(2, "0")}:00:00.000Z`,
      {
        command: {
          electionId,
          candidateDid: candidateDid!,
          eligibilitySnapshotDigest: next.election.eligibilitySnapshotDigest,
          declaredAt: `2026-08-02T${String(index + 1).padStart(2, "0")}:00:00.000Z`,
        },
      },
    );
  }
  return next;
}

describe("canonical premier board election workflow", () => {
  it("opens, self-nominates, accepts complete direct rankings, and closes deterministically", () => {
    let state = open();
    expect(ELECTION_WORKFLOW_SCHEMA_DIGEST).toMatch(/^0x[0-9a-f]{64}$/);
    state = nominateEight(state);
    state = transition(
      state,
      10,
      "PremierElectionBallotCast",
      premier[8]!,
      "2026-08-03T01:00:00.000Z",
      {
        command: {
          ballotId: "019cc4d0-7867-7000-8000-000000000003",
          electionId,
          voterDid: premier[8]!,
          eligibilitySnapshotDigest: state.election.eligibilitySnapshotDigest,
          rankedCandidateDids: [...state.candidateDids].reverse(),
          castAt: "2026-08-03T01:00:00.000Z",
        },
      },
    );
    const result = evaluatePremierElection(state);
    state = applyElectionWorkflowTransition(
      state,
      event(
        11,
        "PremierElectionClosed",
        commissioners[1]!,
        "2026-08-04T00:00:00.000Z",
      ),
      {
        command: {
          electionId,
          requestedByDid: commissioners[1]!,
          requestedAt: "2026-08-04T00:00:00.000Z",
        },
      },
      result,
    );
    expect(state.result).toEqual(result);
    expect(state.result?.electedDids).toEqual(
      [...premier.slice(0, 8)].reverse(),
    );
    expect(electionWorkflowStateRoot(state)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects outsider administration, proxy nominations, partial rankings, and duplicate voter seats", () => {
    const badOpen = () =>
      transition(
        null,
        1,
        "PremierElectionOpened",
        premier[0]!,
        "2026-08-02T00:00:00.000Z",
        {
          command: open().election,
          eligibilitySnapshot: snapshot,
        },
      );
    expect(badOpen).toThrow("commissioner");

    let state = open();
    expect(() =>
      transition(
        state,
        2,
        "PremierElectionCandidateDeclared",
        premier[0]!,
        "2026-08-02T01:00:00.000Z",
        {
          command: {
            electionId,
            candidateDid: premier[1]!,
            eligibilitySnapshotDigest: state.election.eligibilitySnapshotDigest,
            declaredAt: "2026-08-02T01:00:00.000Z",
          },
        },
      ),
    ).toThrow("self-nomination");

    state = nominateEight(state);
    expect(() =>
      transition(
        state,
        10,
        "PremierElectionBallotCast",
        premier[8]!,
        "2026-08-03T01:00:00.000Z",
        {
          command: {
            ballotId: "019cc4d0-7867-7000-8000-000000000004",
            electionId,
            voterDid: premier[8]!,
            eligibilitySnapshotDigest: state.election.eligibilitySnapshotDigest,
            rankedCandidateDids: state.candidateDids.slice(0, 7),
            castAt: "2026-08-03T01:00:00.000Z",
          },
        },
      ),
    ).toThrow();

    const ballot = {
      command: {
        ballotId: "019cc4d0-7867-7000-8000-000000000005",
        electionId,
        voterDid: premier[8]!,
        eligibilitySnapshotDigest: state.election.eligibilitySnapshotDigest,
        rankedCandidateDids: [...state.candidateDids],
        castAt: "2026-08-03T01:00:00.000Z",
      },
    };
    const voted = transition(
      state,
      10,
      "PremierElectionBallotCast",
      premier[8]!,
      ballot.command.castAt,
      ballot,
    );
    expect(() =>
      transition(
        voted,
        11,
        "PremierElectionBallotCast",
        premier[8]!,
        "2026-08-03T02:00:00.000Z",
        {
          command: {
            ...ballot.command,
            ballotId: "019cc4d0-7867-7000-8000-000000000006",
            castAt: "2026-08-03T02:00:00.000Z",
          },
        },
      ),
    ).toThrow("voter seat");
  });
});
