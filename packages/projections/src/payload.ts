import { merkleRoot, sha256Commitment } from "@abl/recognition";

import type { PublicGameProjection } from "./repository.js";

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
  };
}

export interface ProjectionAgentAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

function isHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
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
    !hasExactKeys(source, [
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
    ]) ||
    !hasExactKeys(source.score, ["home", "away"]) ||
    !hasExactKeys(proof, [
      "playerDecisionHashes",
      "coachDecisionHashes",
      "refereeDecisionHashes",
      "replayDecisionHashes",
    ]) ||
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
  const typed = payload as unknown as PossessionResolvedPayload;
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
