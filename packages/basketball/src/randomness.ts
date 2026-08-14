import { createHash } from "node:crypto";

import { hexToBytes } from "@noble/hashes/utils.js";

import { canonicalize, sha256Commitment } from "@abl/recognition";

export interface RandomCommitment {
  party: string;
  gameId: string;
  commitment: `0x${string}`;
}

export interface RandomReveal {
  party: string;
  gameId: string;
  share: `0x${string}`;
}

export function commitRandomShare(
  gameId: string,
  party: string,
  share: `0x${string}`,
): RandomCommitment {
  if (!/^0x[0-9a-f]{64}$/.test(share))
    throw new Error("Random share must contain 32 bytes");
  return {
    party,
    gameId,
    commitment: sha256Commitment({ gameId, party, share }),
  };
}

export function deriveRandomSeed(
  gameId: string,
  commitments: readonly RandomCommitment[],
  reveals: readonly RandomReveal[],
  requiredParties: readonly string[],
): `0x${string}` {
  const commitmentByParty = new Map(
    commitments.map((commitment) => [commitment.party, commitment]),
  );
  const revealByParty = new Map(
    reveals.map((reveal) => [reveal.party, reveal]),
  );
  if (
    commitmentByParty.size !== requiredParties.length ||
    revealByParty.size !== requiredParties.length
  ) {
    throw new Error("Random ceremony has missing or duplicate parties");
  }
  const ordered = [...requiredParties].sort().map((party) => {
    const commitment = commitmentByParty.get(party);
    const reveal = revealByParty.get(party);
    if (
      commitment === undefined ||
      reveal === undefined ||
      commitment.gameId !== gameId ||
      reveal.gameId !== gameId
    ) {
      throw new Error(`Missing random material for ${party}`);
    }
    if (
      commitRandomShare(gameId, party, reveal.share).commitment !==
      commitment.commitment
    ) {
      throw new Error(`Random reveal does not match commitment for ${party}`);
    }
    return { party, share: reveal.share };
  });
  return sha256Commitment({
    format: "ABL-RANDOM-SEED-V1",
    gameId,
    shares: ordered,
  });
}

export class CounterRandom {
  readonly #seed: Uint8Array;
  #counter = 0n;

  public constructor(seed: `0x${string}`) {
    this.#seed = hexToBytes(seed.slice(2));
  }

  public nextBps(): number {
    const counterBytes = new Uint8Array(8);
    new DataView(counterBytes.buffer).setBigUint64(0, this.#counter, false);
    this.#counter += 1n;
    const bytes = createHash("sha256")
      .update(this.#seed)
      .update(counterBytes)
      .digest();
    return bytes.readUInt32BE(0) % 10_000;
  }

  public get counter(): bigint {
    return this.#counter;
  }

  public commitment(): `0x${string}` {
    return sha256Commitment({
      seed: `0x${Buffer.from(this.#seed).toString("hex")}`,
      counter: this.#counter.toString(),
    });
  }
}

export function randomCeremonyCommitment(input: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(canonicalize(input)).digest("hex")}`;
}
