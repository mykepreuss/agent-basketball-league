import { describe, expect, it } from "vitest";

import {
  buildLiveGameSnapshots,
  liveGameSnapshotsAfter,
  verifyLiveGameSnapshotChain,
  type ProjectionRecord,
  type PublicFinalizedGameProjection,
} from "../src/index.js";

const hash = (digit: string) => `0x${digit.repeat(64)}` as `0x${string}`;

function possessionRecord(): ProjectionRecord {
  const players = [
    ["H1", "HOME", "PG", 1_800, 300],
    ["H2", "HOME", "SG", 2_000, 500],
    ["H3", "HOME", "SF", 2_100, 700],
    ["H4", "HOME", "PF", 2_200, 900],
    ["H5", "HOME", "C", 2_300, 1_100],
    ["A1", "AWAY", "PG", 1_000, 300],
    ["A2", "AWAY", "SG", 800, 500],
    ["A3", "AWAY", "SF", 700, 700],
    ["A4", "AWAY", "PF", 600, 900],
    ["A5", "AWAY", "C", 500, 1_100],
  ].map(([playerId, team, position, xCm, yCm]) => ({
    playerId: playerId as string,
    team: team as "HOME" | "AWAY",
    position: position as "PG" | "SG" | "SF" | "PF" | "C",
    xCm: xCm as number,
    yCm: yCm as number,
  }));
  const snapshots = [
    {
      format: "ABL-POSSESSION-SNAPSHOT-V1" as const,
      sequence: 0,
      eventType: "PASS" as const,
      eventData: { from: "H1", to: "H2", completed: true },
      eventHash: hash("1"),
      stateRoot: hash("2"),
      gameId: "game-1",
      possessionId: "possession-1",
      period: 1,
      gameClockMs: 700_000,
      shotClockMs: 20_000,
      score: { home: 0, away: 0 },
      possessionTeam: "HOME" as const,
      phase: "LIVE" as const,
      ball: { xCm: 1_800, yCm: 300, possessorId: "H2" },
      players,
    },
    {
      format: "ABL-POSSESSION-SNAPSHOT-V1" as const,
      sequence: 1,
      eventType: "SHOT" as const,
      eventData: { shooter: "H2", shot: "THREE", made: true, points: 3 },
      eventHash: hash("3"),
      stateRoot: hash("4"),
      gameId: "game-1",
      possessionId: "possession-1",
      period: 1,
      gameClockMs: 698_000,
      shotClockMs: 18_000,
      score: { home: 3, away: 0 },
      possessionTeam: "HOME" as const,
      phase: "DEAD" as const,
      ball: { xCm: 2_000, yCm: 500, possessorId: "H2" },
      players,
    },
  ];
  return {
    cursor: 4,
    previousRecordHash: hash("8"),
    projection: {
      state: "REHEARSAL",
      canonical: true,
      verification: "CANONICAL_LOCAL_REHEARSAL",
      gameId: "game-1",
      possessionId: "possession-1",
      aggregateVersion: "2",
      canonicalEventHash: hash("5"),
      score: { home: 3, away: 0 },
      gameClockMs: 698_000,
      shotClockMs: 18_000,
      players,
      events: snapshots.map((snapshot) => ({
        sequence: snapshot.sequence,
        type: snapshot.eventType,
        label: snapshot.eventType,
        stateRoot: snapshot.stateRoot,
        eventHash: snapshot.eventHash,
      })),
      snapshots,
      segments: [],
      finalStateRoot: hash("4"),
      eventMerkleRoot: hash("6"),
      filmCommitment: hash("7"),
      finalSegmentHash: hash("8"),
      projectedAt: "2026-08-25T20:00:00.000Z",
    },
    authorization: null,
    recordHash: hash("9"),
  };
}

function fullState() {
  return {
    gameId: "game-1",
    period: 1,
    periodKind: "REGULATION" as const,
    gameClockMs: 690_000,
    shotClockMs: 18_000,
    score: { home: 3, away: 0 },
    possessionTeam: "HOME" as const,
    phase: "DEAD" as const,
    active: {
      home: ["H1", "H6", "H3", "H4", "H5"],
      away: ["A1", "A2", "A3", "A4", "A5"],
    },
    bench: { home: ["H2"], away: ["A6"] },
    timeouts: { home: 7, away: 7 },
    challenges: { home: 2, away: 1 },
    teamFouls: { home: 0, away: 1 },
    bonus: { home: false, away: false },
    playerFouls: { A1: 1 },
    ejectedPlayerIds: [],
    injuredPlayerIds: [],
    pendingFreeThrows: null,
    freeThrowLaneActive: false,
    restart: { kind: "THROW_IN" as const, team: "HOME" as const },
    protests: [],
    winner: null,
  };
}

function finalizedGame(): PublicFinalizedGameProjection {
  const eventTypes = ["FOUL", "SUBSTITUTE", "REPLAY_RULING"] as const;
  const eventData = [
    { byTeam: "AWAY", playerId: "A1", kind: "PERSONAL" },
    { team: "HOME", outPlayerId: "H2", inPlayerId: "H6" },
    { targetEventSequence: 0, ruling: "REVERSE" },
  ];
  const snapshots = eventTypes.map((type, sequence) => ({
    format: "ABL-FULL-GAME-SNAPSHOT-V1" as const,
    sequence,
    event: {
      sequence,
      type,
      period: 1,
      gameClockMs: 690_000,
      data: eventData[sequence]!,
      previousEventHash: sequence === 0 ? null : hash(String(sequence)),
      stateRoot: hash(String(sequence + 4)),
      eventHash: hash(String(sequence + 1)),
    },
    state: fullState(),
  }));
  return {
    gameId: "game-1",
    aggregateVersion: "1",
    canonicalEventHash: hash("a"),
    snapshots,
    segments: snapshots.map((snapshot) => ({
      cursor: snapshot.sequence,
      sourceSequence: snapshot.sequence,
      previousSegmentHash: null,
      payloadCommitment: hash("b"),
      stateRoot: snapshot.event.stateRoot,
      releaseAt: `2026-08-25T20:00:0${snapshot.sequence}.000Z`,
      segmentHash: hash("c"),
    })),
  } as unknown as PublicFinalizedGameProjection;
}

describe("live game snapshot contract", () => {
  it("combines fixed-point possessions and replayed game actions into one resumable integrity chain", () => {
    const snapshots = buildLiveGameSnapshots({
      possessionRecords: [possessionRecord()],
      finalizedGame: finalizedGame(),
    });
    expect(snapshots.map(({ action }) => action.type)).toEqual([
      "PASS",
      "SHOT",
      "FOUL",
      "SUBSTITUTE",
      "REPLAY_RULING",
    ]);
    expect(snapshots[0]?.cursor).toBe("p:4:0");
    expect(
      snapshots[0]?.players.every(
        ({ placement }) => placement === "AUTHORITATIVE_FIXED_POINT",
      ),
    ).toBe(true);
    expect(snapshots[2]?.cursor).toBe("f:0");
    expect(
      snapshots[2]?.players.every(
        ({ placement }) => placement === "DERIVED_LINEUP_FORMATION",
      ),
    ).toBe(true);
    for (const [index, snapshot] of snapshots.entries()) {
      expect(snapshot.integrity.previousSnapshotHash).toBe(
        snapshots[index - 1]?.integrity.snapshotHash ?? null,
      );
    }
    expect(verifyLiveGameSnapshotChain(snapshots)).toBe(true);
    expect(
      verifyLiveGameSnapshotChain([
        snapshots[0]!,
        { ...snapshots[1]!, score: { home: 999, away: 0 } },
      ]),
    ).toBe(false);
    expect(liveGameSnapshotsAfter(snapshots, "p:4:1")).toHaveLength(3);
    expect(() => liveGameSnapshotsAfter(snapshots, "missing")).toThrow(
      "cursor is not in canonical history",
    );
  });
});
