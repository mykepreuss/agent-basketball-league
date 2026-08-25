import { merkleRoot, sha256Commitment } from "@abl/recognition";
import {
  POSSESSION_RESOLVED_SCHEMA_DIGEST_V1,
  POSSESSION_RESOLVED_SCHEMA_DIGEST_V2,
  type AgentPlayedPossessionAuthorityDids,
} from "@abl/basketball";

import type { PublicGameProjection } from "./repository.js";

export {
  POSSESSION_RESOLVED_SCHEMA_DIGEST_V1,
  POSSESSION_RESOLVED_SCHEMA_DIGEST_V2,
};

export type PublicGameProjectionSource = Omit<
  PublicGameProjection,
  | "state"
  | "canonical"
  | "verification"
  | "aggregateVersion"
  | "canonicalEventHash"
  | "projectedAt"
>;

export interface PossessionResolvedPayload {
  source: PublicGameProjectionSource;
  decisionProof: {
    playerDecisionHashes: readonly `0x${string}`[];
    coachDecisionHashes: readonly `0x${string}`[];
    refereeDecisionHashes: readonly `0x${string}`[];
    replayDecisionHashes: readonly `0x${string}`[];
    authorityDids?: AgentPlayedPossessionAuthorityDids;
  };
}

export interface ProjectionAgentAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

function isHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

function isDid(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("did:");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

export function validatePossessionResolvedPayload(
  payload: unknown,
  aggregateId?: string,
  stateRoot?: string,
  schemaDigest?: string,
): PossessionResolvedPayload {
  if (!isRecord(payload)) throw new Error("Projection payload is absent");
  const { source, decisionProof: proof } = payload;
  if (
    !isRecord(source) ||
    typeof source.gameId !== "string" ||
    source.gameId === "" ||
    typeof source.possessionId !== "string" ||
    source.possessionId === "" ||
    !isRecord(source.score) ||
    !Array.isArray(source.players) ||
    !Array.isArray(source.events) ||
    (source.snapshots !== undefined && !Array.isArray(source.snapshots)) ||
    !Array.isArray(source.segments) ||
    !isHash(source.finalStateRoot) ||
    !isHash(source.eventMerkleRoot) ||
    !isHash(source.filmCommitment) ||
    !isHash(source.finalSegmentHash) ||
    !isRecord(proof)
  ) {
    throw new Error("Projection payload is malformed");
  }
  if (
    !hasExactKeys(payload, ["source", "decisionProof"]) ||
    !hasExactKeys(
      source,
      [
        "gameId",
        "possessionId",
        "score",
        "gameClockMs",
        "shotClockMs",
        "players",
        "events",
        "segments",
        "finalStateRoot",
        "eventMerkleRoot",
        "filmCommitment",
        "finalSegmentHash",
      ].concat(source.snapshots === undefined ? [] : ["snapshots"]),
    ) ||
    !hasExactKeys(source.score, ["home", "away"]) ||
    !hasExactKeys(
      proof,
      proof.authorityDids === undefined
        ? [
            "playerDecisionHashes",
            "coachDecisionHashes",
            "refereeDecisionHashes",
            "replayDecisionHashes",
          ]
        : [
            "playerDecisionHashes",
            "coachDecisionHashes",
            "refereeDecisionHashes",
            "replayDecisionHashes",
            "authorityDids",
          ],
    ) ||
    source.players.some(
      (player) =>
        !isRecord(player) ||
        !hasExactKeys(player, ["playerId", "team", "position", "xCm", "yCm"]),
    ) ||
    source.events.some(
      (event) =>
        !isRecord(event) ||
        !hasExactKeys(event, [
          "sequence",
          "type",
          "label",
          "stateRoot",
          "eventHash",
        ]),
    ) ||
    (source.snapshots ?? []).some(
      (snapshot) =>
        !isRecord(snapshot) ||
        !hasExactKeys(snapshot, [
          "format",
          "sequence",
          "eventType",
          "eventData",
          "eventHash",
          "stateRoot",
          "gameId",
          "possessionId",
          "period",
          "gameClockMs",
          "shotClockMs",
          "score",
          "possessionTeam",
          "phase",
          "ball",
          "players",
        ]),
    ) ||
    source.segments.some(
      (segment) =>
        !isRecord(segment) ||
        !hasExactKeys(segment, [
          "sequence",
          "previousSegmentHash",
          "eventHashes",
          "stateRoot",
          "payloadCommitment",
          "segmentHash",
        ]) ||
        !Array.isArray(segment.eventHashes),
    )
  ) {
    throw new Error("Projection payload contains undeclared fields");
  }
  for (const key of [
    "playerDecisionHashes",
    "coachDecisionHashes",
    "refereeDecisionHashes",
    "replayDecisionHashes",
  ] as const) {
    const hashes = proof[key];
    if (
      !Array.isArray(hashes) ||
      hashes.length === 0 ||
      !hashes.every(isHash) ||
      new Set(hashes).size !== hashes.length
    )
      throw new Error(`Projection decision proof is invalid: ${key}`);
  }
  if (proof.authorityDids !== undefined) {
    const authorityDids = proof.authorityDids;
    if (
      !isRecord(authorityDids) ||
      !hasExactKeys(authorityDids, [
        "players",
        "coaches",
        "referees",
        "replayOfficials",
      ])
    )
      throw new Error("Projection decision authority evidence is invalid");
    const roleRequirements = [
      ["players", "playerDecisionHashes", 10],
      ["coaches", "coachDecisionHashes", 2],
      ["referees", "refereeDecisionHashes", 3],
      ["replayOfficials", "replayDecisionHashes", 2],
    ] as const;
    const allAuthorityDids: string[] = [];
    for (const [role, decisionHashKey, uniqueCareerCount] of roleRequirements) {
      const dids = authorityDids[role];
      const hashes = proof[decisionHashKey];
      if (
        !Array.isArray(dids) ||
        !dids.every(isDid) ||
        !Array.isArray(hashes) ||
        dids.length !== hashes.length ||
        new Set(dids).size !== uniqueCareerCount
      )
        throw new Error("Projection decision authority evidence is invalid");
      allAuthorityDids.push(...dids);
    }
    if (new Set(allAuthorityDids).size !== 17)
      throw new Error("Projection decision authority evidence is invalid");
  }
  const typed = payload as unknown as PossessionResolvedPayload;
  if (
    schemaDigest !== undefined &&
    ((typed.source.snapshots === undefined &&
      schemaDigest !== POSSESSION_RESOLVED_SCHEMA_DIGEST_V1) ||
      (typed.source.snapshots !== undefined &&
        schemaDigest !== POSSESSION_RESOLVED_SCHEMA_DIGEST_V2))
  ) {
    throw new Error("Possession projection schema version is inconsistent");
  }
  if (
    (aggregateId !== undefined && typed.source.gameId !== aggregateId) ||
    (stateRoot !== undefined && typed.source.finalStateRoot !== stateRoot) ||
    !Number.isSafeInteger(typed.source.score.home) ||
    typed.source.score.home < 0 ||
    !Number.isSafeInteger(typed.source.score.away) ||
    typed.source.score.away < 0 ||
    !Number.isSafeInteger(typed.source.gameClockMs) ||
    typed.source.gameClockMs < 0 ||
    !Number.isSafeInteger(typed.source.shotClockMs) ||
    typed.source.shotClockMs < 0 ||
    typed.source.shotClockMs > 24_000 ||
    typed.source.players.length !== 10 ||
    typed.source.players.some(
      (player) =>
        !isRecord(player) ||
        typeof player.playerId !== "string" ||
        player.playerId === "" ||
        (player.team !== "HOME" && player.team !== "AWAY") ||
        !["PG", "SG", "SF", "PF", "C"].includes(String(player.position)) ||
        !Number.isSafeInteger(player.xCm) ||
        (player.xCm as number) < 0 ||
        (player.xCm as number) > 2_865 ||
        !Number.isSafeInteger(player.yCm) ||
        (player.yCm as number) < 0 ||
        (player.yCm as number) > 1_524,
    ) ||
    typed.source.players.filter(({ team }) => team === "HOME").length !== 5 ||
    typed.source.players.filter(({ team }) => team === "AWAY").length !== 5 ||
    new Set(typed.source.players.map(({ playerId }) => playerId)).size !== 10 ||
    typed.source.events.length === 0 ||
    typed.source.events.some(
      (event, index) =>
        !isRecord(event) ||
        event.sequence !== index ||
        typeof event.type !== "string" ||
        event.type === "" ||
        typeof event.label !== "string" ||
        event.label === "" ||
        !isHash(event.eventHash) ||
        !isHash(event.stateRoot),
    ) ||
    (typed.source.snapshots !== undefined &&
      typed.source.snapshots.length !== typed.source.events.length) ||
    (typed.source.snapshots ?? []).some((snapshot, index) => {
      const event = typed.source.events[index];
      const segment = typed.source.segments[index];
      const playerIds = snapshot.players.map(({ playerId }) => playerId);
      return (
        snapshot.format !== "ABL-POSSESSION-SNAPSHOT-V1" ||
        snapshot.sequence !== index ||
        snapshot.eventType !== event?.type ||
        snapshot.eventHash !== event?.eventHash ||
        snapshot.stateRoot !== event?.stateRoot ||
        snapshot.gameId !== typed.source.gameId ||
        snapshot.possessionId !== typed.source.possessionId ||
        !Number.isSafeInteger(snapshot.period) ||
        snapshot.period < 1 ||
        !Number.isSafeInteger(snapshot.gameClockMs) ||
        snapshot.gameClockMs < 0 ||
        !Number.isSafeInteger(snapshot.shotClockMs) ||
        snapshot.shotClockMs < 0 ||
        snapshot.shotClockMs > 24_000 ||
        !isRecord(snapshot.eventData) ||
        !isRecord(snapshot.score) ||
        !Number.isSafeInteger(snapshot.score.home) ||
        snapshot.score.home < 0 ||
        !Number.isSafeInteger(snapshot.score.away) ||
        snapshot.score.away < 0 ||
        (snapshot.possessionTeam !== "HOME" &&
          snapshot.possessionTeam !== "AWAY") ||
        !["LIVE", "DEAD", "FINAL"].includes(snapshot.phase) ||
        !isRecord(snapshot.ball) ||
        !hasExactKeys(snapshot.ball, ["xCm", "yCm", "possessorId"]) ||
        !Number.isSafeInteger(snapshot.ball.xCm) ||
        snapshot.ball.xCm < 0 ||
        snapshot.ball.xCm > 2_865 ||
        !Number.isSafeInteger(snapshot.ball.yCm) ||
        snapshot.ball.yCm < 0 ||
        snapshot.ball.yCm > 1_524 ||
        !Array.isArray(snapshot.players) ||
        snapshot.players.length !== 10 ||
        new Set(playerIds).size !== 10 ||
        (snapshot.ball.possessorId !== null &&
          !playerIds.includes(snapshot.ball.possessorId)) ||
        snapshot.players.some(
          (player) =>
            !isRecord(player) ||
            !hasExactKeys(player, [
              "playerId",
              "team",
              "position",
              "xCm",
              "yCm",
            ]) ||
            typeof player.playerId !== "string" ||
            player.playerId === "" ||
            (player.team !== "HOME" && player.team !== "AWAY") ||
            !["PG", "SG", "SF", "PF", "C"].includes(player.position) ||
            !Number.isSafeInteger(player.xCm) ||
            player.xCm < 0 ||
            player.xCm > 2_865 ||
            !Number.isSafeInteger(player.yCm) ||
            player.yCm < 0 ||
            player.yCm > 1_524,
        ) ||
        snapshot.players.filter(({ team }) => team === "HOME").length !== 5 ||
        snapshot.players.filter(({ team }) => team === "AWAY").length !== 5 ||
        segment === undefined ||
        segment.payloadCommitment !==
          sha256Commitment({
            type: snapshot.eventType,
            data: snapshot.eventData,
          })
      );
    }) ||
    typed.source.segments.length !== typed.source.events.length ||
    typed.source.segments.some(
      (segment, index) =>
        !isRecord(segment) ||
        segment.sequence !== index ||
        !isHash(segment.payloadCommitment) ||
        !isHash(segment.segmentHash) ||
        segment.previousSegmentHash !==
          (typed.source.segments[index - 1]?.segmentHash ?? null) ||
        segment.eventHashes.length !== 1 ||
        segment.eventHashes[0] !== typed.source.events[index]?.eventHash ||
        segment.stateRoot !== typed.source.events[index]?.stateRoot ||
        segment.segmentHash !==
          sha256Commitment({
            sequence: segment.sequence,
            previousSegmentHash: segment.previousSegmentHash,
            eventHashes: segment.eventHashes,
            stateRoot: segment.stateRoot,
            payloadCommitment: segment.payloadCommitment,
          }),
    ) ||
    typed.source.eventMerkleRoot !==
      merkleRoot(typed.source.events.map(({ eventHash }) => eventHash)) ||
    typed.source.finalStateRoot !== typed.source.events.at(-1)?.stateRoot ||
    (typed.source.snapshots !== undefined &&
      (typed.source.finalStateRoot !==
        typed.source.snapshots.at(-1)?.stateRoot ||
        sha256Commitment(typed.source.snapshots.at(-1)?.score) !==
          sha256Commitment(typed.source.score) ||
        typed.source.snapshots.at(-1)?.gameClockMs !==
          typed.source.gameClockMs ||
        typed.source.snapshots.at(-1)?.shotClockMs !==
          typed.source.shotClockMs ||
        sha256Commitment(typed.source.snapshots.at(-1)?.players) !==
          sha256Commitment(typed.source.players))) ||
    typed.source.finalSegmentHash !==
      typed.source.segments.at(-1)?.segmentHash ||
    ![20, 30, 40].includes(typed.decisionProof.playerDecisionHashes.length) ||
    typed.decisionProof.coachDecisionHashes.length !==
      (typed.decisionProof.playerDecisionHashes.length / 10) * 2 ||
    typed.decisionProof.refereeDecisionHashes.length !== 3 ||
    typed.decisionProof.replayDecisionHashes.length !== 2
  ) {
    throw new Error("Public game projection is internally inconsistent");
  }
  return typed;
}
