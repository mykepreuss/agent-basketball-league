import { describe, expect, it } from "vitest";

import { loadGameProof } from "./data.js";

const game = {
  state: "REHEARSAL",
  canonical: false,
  historyClassification: "PRE_GENESIS_EXPERIMENT",
  recognitionLevel: "SIGNED_VALID",
  verification: "CANONICAL_LOCAL_REHEARSAL",
  gameId: "game-1",
  possessionId: "possession-1",
  aggregateVersion: "1",
  canonicalEventHash: `0x${"1".repeat(64)}`,
  score: { home: 2, away: 0 },
  gameClockMs: 718_000,
  shotClockMs: 22_000,
  players: [],
  events: [],
  segments: [],
  finalStateRoot: `0x${"2".repeat(64)}`,
  eventMerkleRoot: `0x${"3".repeat(64)}`,
  filmCommitment: `0x${"4".repeat(64)}`,
  finalSegmentHash: `0x${"5".repeat(64)}`,
  projectedAt: "2026-08-22T20:00:00.000Z",
} as const;

function response(value: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("arena public game classification", () => {
  it("renders an explicitly noncanonical pre-Genesis experiment", async () => {
    const projection = await loadGameProof("https://public.example", () =>
      response({
        state: "PRE_GENESIS_REHEARSAL",
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        recognitionLevel: "SIGNED_VALID",
        items: [game],
      }),
    );
    expect(projection).toMatchObject({
      gameId: "game-1",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      recognitionLevel: "SIGNED_VALID",
    });
  });

  it("rejects mixed or overstated pre-Genesis classifications", async () => {
    await expect(
      loadGameProof("https://public.example", () =>
        response({
          state: "PRE_GENESIS_REHEARSAL",
          canonical: true,
          historyClassification: "PRE_GENESIS_EXPERIMENT",
          recognitionLevel: "SIGNED_VALID",
          items: [game],
        }),
      ),
    ).rejects.toThrow("history classification is inconsistent");
    await expect(
      loadGameProof("https://public.example", () =>
        response({
          state: "PRE_GENESIS_REHEARSAL",
          canonical: false,
          historyClassification: "PRE_GENESIS_EXPERIMENT",
          recognitionLevel: "ONCHAIN_FINALIZED",
          items: [{ ...game, recognitionLevel: "ONCHAIN_FINALIZED" }],
        }),
      ),
    ).rejects.toThrow("history classification is inconsistent");
  });
});
