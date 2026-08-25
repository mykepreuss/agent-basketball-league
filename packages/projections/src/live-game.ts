import type {
  FullGameSnapshot,
  PublicPossessionSnapshot,
  Team,
} from "@abl/basketball";
import { sha256Commitment } from "@abl/recognition";

import type { PublicFinalizedGameProjection } from "./final-game-repository.js";
import type { ProjectionRecord } from "./repository.js";

export const LIVE_GAME_SNAPSHOT_FORMAT = "ABL-LIVE-GAME-SNAPSHOT-V1";

export interface PublicLivePlayer {
  playerId: string;
  team: Team;
  position: "PG" | "SG" | "SF" | "PF" | "C";
  xCm: number;
  yCm: number;
  placement: "AUTHORITATIVE_FIXED_POINT" | "DERIVED_LINEUP_FORMATION";
}

export interface PublicLiveAction {
  type: string;
  label: string;
  team: Team | null;
  primaryPlayerId: string | null;
  secondaryPlayerId: string | null;
  outcome: string | null;
  target: { xCm: number; yCm: number } | null;
  data: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PublicLiveGameSnapshot {
  format: typeof LIVE_GAME_SNAPSHOT_FORMAT;
  cursor: string;
  gameId: string;
  source: "POSSESSION_RESOLUTION" | "FULL_GAME_REPLAY";
  aggregateVersion: string;
  sequence: number;
  period: number;
  gameClockMs: number;
  shotClockMs: number;
  score: { home: number; away: number };
  possessionTeam: Team;
  phase: "LIVE" | "DEAD" | "FINAL";
  ball: { xCm: number; yCm: number; possessorId: string | null };
  players: readonly PublicLivePlayer[];
  action: PublicLiveAction;
  observedAt: string;
  canonical: true;
  integrity: {
    canonicalEventHash: `0x${string}`;
    sourceEventHash: `0x${string}`;
    stateRoot: `0x${string}`;
    previousSnapshotHash: `0x${string}` | null;
    snapshotHash: `0x${string}`;
  };
}

const positions = ["PG", "SG", "SF", "PF", "C"] as const;

function isTeam(value: unknown): value is Team {
  return value === "HOME" || value === "AWAY";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function teamFromData(data: Readonly<Record<string, unknown>>): Team | null {
  for (const key of ["team", "byTeam", "awardedTeam", "winningTeam"])
    if (isTeam(data[key])) return data[key];
  return null;
}

function actionFromEvent(
  type: string,
  data: Readonly<Record<string, string | number | boolean | null>>,
): PublicLiveAction {
  const team = teamFromData(data);
  const primaryPlayerId =
    stringValue(data.playerId) ??
    stringValue(data.shooter) ??
    stringValue(data.from) ??
    stringValue(data.outPlayerId);
  const secondaryPlayerId =
    stringValue(data.to) ?? stringValue(data.inPlayerId);
  let outcome: string | null = null;
  if (type === "SHOT" || type === "FREE_THROW")
    outcome = data.made === true ? "MADE" : "MISSED";
  else if (type === "PASS")
    outcome = data.completed === true ? "COMPLETED" : "DEFLECTED";
  else if (type === "REPLAY_RULING") outcome = stringValue(data.ruling);
  else if (type === "FOUL") outcome = stringValue(data.kind);
  const target =
    type === "SHOT" && team !== null
      ? { xCm: team === "HOME" ? 2_865 : 0, yCm: 762 }
      : null;
  const detail = [primaryPlayerId, secondaryPlayerId, outcome]
    .filter((value) => value !== null)
    .join(" · ");
  return {
    type,
    label: `${type.toLowerCase().replaceAll("_", " ")}${detail === "" ? "" : ` · ${detail}`}`,
    team,
    primaryPlayerId,
    secondaryPlayerId,
    outcome,
    target,
    data,
  };
}

function snapshotHash(
  snapshot: Omit<PublicLiveGameSnapshot, "integrity">,
  integrity: Omit<PublicLiveGameSnapshot["integrity"], "snapshotHash">,
): `0x${string}` {
  return sha256Commitment({
    snapshot: {
      format: snapshot.format,
      cursor: snapshot.cursor,
      gameId: snapshot.gameId,
      source: snapshot.source,
      aggregateVersion: snapshot.aggregateVersion,
      sequence: snapshot.sequence,
      period: snapshot.period,
      gameClockMs: snapshot.gameClockMs,
      shotClockMs: snapshot.shotClockMs,
      score: snapshot.score,
      possessionTeam: snapshot.possessionTeam,
      phase: snapshot.phase,
      ball: snapshot.ball,
      players: snapshot.players,
      action: snapshot.action,
      observedAt: snapshot.observedAt,
    },
    integrity,
  });
}

function sealSnapshot(
  snapshot: Omit<PublicLiveGameSnapshot, "integrity">,
  integrity: Omit<PublicLiveGameSnapshot["integrity"], "snapshotHash">,
): PublicLiveGameSnapshot {
  return {
    ...snapshot,
    integrity: {
      ...integrity,
      snapshotHash: snapshotHash(snapshot, integrity),
    },
  };
}

function possessionSnapshot(
  record: ProjectionRecord,
  source: PublicPossessionSnapshot,
  previousSnapshotHash: `0x${string}` | null,
): PublicLiveGameSnapshot {
  const projection = record.projection;
  const snapshot: Omit<PublicLiveGameSnapshot, "integrity"> = {
    format: LIVE_GAME_SNAPSHOT_FORMAT,
    cursor: `p:${record.cursor}:${source.sequence}`,
    gameId: source.gameId,
    source: "POSSESSION_RESOLUTION" as const,
    aggregateVersion: projection.aggregateVersion,
    sequence: source.sequence,
    period: source.period,
    gameClockMs: source.gameClockMs,
    shotClockMs: source.shotClockMs,
    score: source.score,
    possessionTeam: source.possessionTeam,
    phase: source.phase,
    ball: source.ball,
    players: source.players.map((player) => ({
      ...player,
      placement: "AUTHORITATIVE_FIXED_POINT" as const,
    })),
    action: actionFromEvent(source.eventType, source.eventData),
    observedAt: projection.projectedAt,
    canonical: true as const,
  };
  return sealSnapshot(snapshot, {
    canonicalEventHash: projection.canonicalEventHash,
    sourceEventHash: source.eventHash,
    stateRoot: source.stateRoot,
    previousSnapshotHash,
  });
}

function formationPlayers(snapshot: FullGameSnapshot): PublicLivePlayer[] {
  const players: PublicLivePlayer[] = [];
  for (const team of ["HOME", "AWAY"] as const) {
    const active =
      snapshot.state["active"][team.toLowerCase() as "home" | "away"];
    for (const [index, playerId] of active.entries()) {
      const lane = index % positions.length;
      players.push({
        playerId,
        team,
        position: positions[lane]!,
        xCm: team === "HOME" ? 1_850 + lane * 180 : 1_015 - lane * 180,
        yCm: 250 + lane * 255,
        placement: "DERIVED_LINEUP_FORMATION",
      });
    }
  }
  return players;
}

function fullGameSnapshot(
  projection: PublicFinalizedGameProjection,
  source: FullGameSnapshot,
  previousSnapshotHash: `0x${string}` | null,
): PublicLiveGameSnapshot {
  const players = formationPlayers(source);
  const action = actionFromEvent(source.event.type, source.event.data);
  const possessor =
    players.find((player) => player.playerId === action.primaryPlayerId) ??
    players.find((player) => player.team === source.state.possessionTeam);
  const segment = projection.segments[source.sequence];
  const snapshot: Omit<PublicLiveGameSnapshot, "integrity"> = {
    format: LIVE_GAME_SNAPSHOT_FORMAT,
    cursor: `f:${source.sequence}`,
    gameId: projection.gameId,
    source: "FULL_GAME_REPLAY" as const,
    aggregateVersion: projection.aggregateVersion,
    sequence: source.sequence,
    period: source.state.period,
    gameClockMs: source.state.gameClockMs,
    shotClockMs: source.state.shotClockMs,
    score: source.state.score,
    possessionTeam: source.state.possessionTeam,
    phase: source.state.phase,
    ball: {
      xCm: possessor?.xCm ?? 1_433,
      yCm: possessor?.yCm ?? 762,
      possessorId: possessor?.playerId ?? null,
    },
    players,
    action,
    observedAt: segment?.releaseAt ?? projection.projectedAt,
    canonical: true as const,
  };
  return sealSnapshot(snapshot, {
    canonicalEventHash: projection.canonicalEventHash,
    sourceEventHash: source.event.eventHash,
    stateRoot: source.event.stateRoot,
    previousSnapshotHash,
  });
}

export function buildLiveGameSnapshots(input: {
  possessionRecords: readonly ProjectionRecord[];
  finalizedGame?: PublicFinalizedGameProjection;
}): readonly PublicLiveGameSnapshot[] {
  const snapshots: PublicLiveGameSnapshot[] = [];
  let previousSnapshotHash: `0x${string}` | null = null;
  for (const record of input.possessionRecords) {
    for (const source of record.projection.snapshots ?? []) {
      const snapshot = possessionSnapshot(record, source, previousSnapshotHash);
      snapshots.push(snapshot);
      previousSnapshotHash = snapshot.integrity.snapshotHash;
    }
  }
  if (input.finalizedGame !== undefined) {
    for (const source of input.finalizedGame.snapshots ?? []) {
      const snapshot = fullGameSnapshot(
        input.finalizedGame,
        source,
        previousSnapshotHash,
      );
      snapshots.push(snapshot);
      previousSnapshotHash = snapshot.integrity.snapshotHash;
    }
  }
  return structuredClone(snapshots);
}

export function liveGameSnapshotsAfter(
  snapshots: readonly PublicLiveGameSnapshot[],
  cursor: string | undefined,
): readonly PublicLiveGameSnapshot[] {
  if (cursor === undefined || cursor === "") return structuredClone(snapshots);
  const index = snapshots.findIndex((snapshot) => snapshot.cursor === cursor);
  if (index < 0)
    throw new Error("Live game cursor is not in canonical history");
  return structuredClone(snapshots.slice(index + 1));
}

export function verifyLiveGameSnapshotChain(
  snapshots: readonly PublicLiveGameSnapshot[],
  expectedPreviousSnapshotHash: `0x${string}` | null = null,
): boolean {
  let previousSnapshotHash = expectedPreviousSnapshotHash;
  const cursors = new Set<string>();
  for (const snapshot of snapshots) {
    const { snapshotHash: claimedHash, ...integrity } = snapshot.integrity;
    if (
      snapshot.format !== LIVE_GAME_SNAPSHOT_FORMAT ||
      cursors.has(snapshot.cursor) ||
      integrity.previousSnapshotHash !== previousSnapshotHash ||
      snapshotHash(snapshot, integrity) !== claimedHash
    ) {
      return false;
    }
    cursors.add(snapshot.cursor);
    previousSnapshotHash = claimedHash;
  }
  return true;
}
