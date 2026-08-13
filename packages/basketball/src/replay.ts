import { sha256Commitment } from "@abl/recognition";

import {
  resolvePossession,
  type PossessionInput,
  type PossessionResult,
} from "./engine.js";

export async function replayPossession(
  input: PossessionInput,
  expected: PossessionResult,
): Promise<{
  exact: boolean;
  replayDigest: `0x${string}`;
  inferenceInvocations: 0;
}> {
  const replayed = await resolvePossession(structuredClone(input));
  const exact =
    replayed.finalStateRoot === expected.finalStateRoot &&
    replayed.eventMerkleRoot === expected.eventMerkleRoot &&
    replayed.events.length === expected.events.length &&
    replayed.segments.at(-1)?.segmentHash ===
      expected.segments.at(-1)?.segmentHash;
  return {
    exact,
    replayDigest: sha256Commitment({
      finalStateRoot: replayed.finalStateRoot,
      eventMerkleRoot: replayed.eventMerkleRoot,
      finalSegmentHash: replayed.segments.at(-1)?.segmentHash ?? null,
    }),
    inferenceInvocations: 0,
  };
}
