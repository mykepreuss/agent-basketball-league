import { keccak256, toBytes, type Address, type Hex } from "viem";

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

export type CheckpointRecognitionLevel =
  | "NONE"
  | "SIGNED_VALID"
  | "INDEPENDENTLY_WITNESSED"
  | "ONCHAIN_FINALIZED";

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

export interface CheckpointChainClaim {
  checkpointType: CheckpointType;
  subjectId: string;
  root: Hex;
  previousRoot: Hex;
  nonce: Hex;
  validAfter: bigint;
  validBefore: bigint;
  chainId: number;
  contractAddress: Address;
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  signatures: readonly Hex[];
}

export interface CheckpointChainObservation {
  checkpointTypeId: Hex;
  subjectId: Hex;
  root: Hex;
  previousRoot: Hex;
  nonce: Hex;
  validAfter: bigint;
  validBefore: bigint;
  chainId: number;
  contractAddress: Address;
  transactionHash: Hex;
  blockNumber: bigint;
  blockTimestamp: bigint;
  confirmations: number;
  baseFinalized: boolean;
  receiptSucceeded: boolean;
  runtimeBytecodeKeccak256: Hex | null;
  signatures: readonly Hex[];
  observedAt: string;
}

interface CheckpointRecognitionAnchorBase {
  chainId: number;
  requiredConfirmations: number;
}

export interface PendingCheckpointRecognitionAnchor
  extends CheckpointRecognitionAnchorBase {
  state: "PRE_GENESIS_UNRATIFIED";
  contractAddress: null;
  deployedRuntimeBytecodeKeccak256: null;
  releaseManifestDigest: null;
  deploymentTransactionHash: null;
  deploymentBlockNumber: null;
  finalizedAt: null;
}

export interface RatifiedCheckpointRecognitionAnchor
  extends CheckpointRecognitionAnchorBase {
  state: "RATIFIED";
  contractAddress: Address;
  deployedRuntimeBytecodeKeccak256: Hex;
  releaseManifestDigest: Hex;
  deploymentTransactionHash: Hex;
  deploymentBlockNumber: bigint;
  finalizedAt: string;
}

export type CheckpointRecognitionAnchor =
  | PendingCheckpointRecognitionAnchor
  | RatifiedCheckpointRecognitionAnchor;

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

export function checkpointTypeId(checkpointType: CheckpointType): Hex {
  return keccak256(toBytes(checkpointType));
}

export function checkpointSubjectId(subjectId: string): Hex {
  return keccak256(toBytes(subjectId));
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
