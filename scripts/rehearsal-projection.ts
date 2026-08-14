import {
  runFirstPossessionRehearsal,
  type FirstPossessionRehearsalOptions,
} from "../packages/basketball/src/index.js";
import type { PublicGameProjection } from "../packages/projections/src/index.js";

interface RehearsalProjectionOptions extends FirstPossessionRehearsalOptions {
  projectedAt?: string;
}

export async function createRehearsalPossessionProjection({
  projectedAt = "2026-08-13T10:05:00.000Z",
  ...possessionOptions
}: RehearsalProjectionOptions = {}): Promise<PublicGameProjection> {
  const { result } = await runFirstPossessionRehearsal(possessionOptions);
  const finalSegmentHash = result.segments.at(-1)?.segmentHash;
  const canonicalEventHash = result.events.at(-1)?.eventHash;
  if (finalSegmentHash === undefined || canonicalEventHash === undefined)
    throw new Error("Rehearsal possession produced no public proof");

  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    gameId: result.finalState.gameId,
    possessionId: result.finalState.possessionId,
    aggregateVersion: "1",
    canonicalEventHash,
    score: result.finalState.score,
    gameClockMs: result.finalState.gameClockMs,
    shotClockMs: result.finalState.shotClockMs,
    players: result.finalState.players.map(
      ({ playerId, team, position, xCm, yCm }) => ({
        playerId,
        team,
        position,
        xCm,
        yCm,
      }),
    ),
    events: result.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      label: `${event.type.toLowerCase().replaceAll("_", " ")} resolved`,
      stateRoot: event.stateRoot,
      eventHash: event.eventHash,
    })),
    segments: result.segments,
    finalStateRoot: result.finalStateRoot,
    eventMerkleRoot: result.eventMerkleRoot,
    filmCommitment: result.filmCommitment,
    finalSegmentHash,
    projectedAt,
  };
}
