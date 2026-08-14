import { hexToBytes } from "@noble/hashes/utils.js";

import { sha256Bytes } from "./canonical.js";

export interface MerkleProofStep {
  side: "LEFT" | "RIGHT";
  hash: `0x${string}`;
}

function bytes(value: `0x${string}`): Uint8Array {
  return hexToBytes(value.slice(2));
}

function leafHash(value: `0x${string}`): `0x${string}` {
  return sha256Bytes(new Uint8Array([0]), bytes(value));
}

function nodeHash(left: `0x${string}`, right: `0x${string}`): `0x${string}` {
  return sha256Bytes(new Uint8Array([1]), bytes(left), bytes(right));
}

export function merkleRoot(leaves: readonly `0x${string}`[]): `0x${string}` {
  if (leaves.length === 0) return sha256Bytes(new Uint8Array([0]));
  let level = leaves.map(leafHash);
  while (level.length > 1) {
    const next: `0x${string}`[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      next.push(nodeHash(left, level[index + 1] ?? left));
    }
    level = next;
  }
  return level[0]!;
}

export function merkleProof(
  leaves: readonly `0x${string}`[],
  leafIndex: number,
): MerkleProofStep[] {
  if (
    !Number.isInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= leaves.length
  )
    throw new Error("Invalid leaf index");
  const proof: MerkleProofStep[] = [];
  let index = leafIndex;
  let level = leaves.map(leafHash);
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push({
      side: index % 2 === 0 ? "RIGHT" : "LEFT",
      hash: level[siblingIndex] ?? level[index]!,
    });
    const next: `0x${string}`[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const left = level[cursor]!;
      next.push(nodeHash(left, level[cursor + 1] ?? left));
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return proof;
}

export function verifyMerkleProof(
  leaf: `0x${string}`,
  proof: readonly MerkleProofStep[],
  root: `0x${string}`,
): boolean {
  let current = leafHash(leaf);
  for (const step of proof)
    current =
      step.side === "LEFT"
        ? nodeHash(step.hash, current)
        : nodeHash(current, step.hash);
  return current === root;
}
