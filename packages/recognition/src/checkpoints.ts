import type { Hex } from "viem";

import { sha256Commitment } from "./canonical.js";
import { merkleRoot } from "./merkle.js";

export type CheckpointType =
  | "CONSTITUTION"
  | "KEY_REGISTRY"
  | "GAME"
  | "BALLOT"
  | "RELEASE"
  | "RULING"
  | "DAILY_ROOT";

export const checkpointTypes = [
  "CONSTITUTION",
  "KEY_REGISTRY",
  "GAME",
  "BALLOT",
  "RELEASE",
  "RULING",
  "DAILY_ROOT",
] as const satisfies readonly CheckpointType[];

export interface CheckpointManifest {
  manifestId: string;
  checkpointType: CheckpointType;
  subjectId: string;
  eventHashes: readonly Hex[];
  merkleRoot: Hex;
  firstEventHash: Hex | null;
  lastEventHash: Hex | null;
  institutionalKeyRegistryDigest: Hex;
  verifierDigest: Hex;
  previousManifestDigest: Hex | null;
  createdAt: string;
}

export function createCheckpointManifest(
  input: Omit<
    CheckpointManifest,
    "merkleRoot" | "firstEventHash" | "lastEventHash"
  >,
): CheckpointManifest {
  return {
    ...input,
    merkleRoot: merkleRoot(input.eventHashes),
    firstEventHash: input.eventHashes[0] ?? null,
    lastEventHash: input.eventHashes.at(-1) ?? null,
  };
}

export function checkpointManifestDigest(manifest: CheckpointManifest): Hex {
  return sha256Commitment(manifest);
}

export function dailyAggregateRoot(roots: Readonly<Record<string, Hex>>): Hex {
  return sha256Commitment(
    Object.fromEntries(
      Object.entries(roots).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}
