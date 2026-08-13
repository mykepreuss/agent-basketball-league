import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FilePublicProjectionRepository,
  ProjectionVersionConflictError,
  type PublicGameProjection,
} from "../src/index.js";

function projection(): PublicGameProjection {
  const hash = `0x${"a".repeat(64)}` as const;
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    gameId: "game-1",
    possessionId: "possession-1",
    aggregateVersion: "1",
    canonicalEventHash: hash,
    score: { home: 2, away: 0 },
    gameClockMs: 714_000,
    shotClockMs: 18_000,
    players: [],
    events: [],
    segments: [],
    finalStateRoot: hash,
    eventMerkleRoot: hash,
    filmCommitment: hash,
    finalSegmentHash: hash,
    projectedAt: "2026-08-13T10:00:00.000Z",
  };
}

describe("durable public projection repository", () => {
  it("publishes idempotently and reconstructs the cursor after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-projections-"));
    const first = new FilePublicProjectionRepository(root);
    await first.initialize();
    const reader = new FilePublicProjectionRepository(root);
    await reader.initialize();
    expect(reader.game("game-1")).toBeUndefined();
    const published = await first.publish(projection());
    expect((await first.publish(projection())).cursor).toBe(published.cursor);
    await reader.refresh();
    expect(reader.game("game-1")).toEqual(projection());

    const restarted = new FilePublicProjectionRepository(root);
    await restarted.initialize();
    expect(restarted.game("game-1")).toEqual(projection());
    expect(restarted.cursor("game-1")).toEqual({
      latestSegment: -1,
      nextCursor: 1,
    });
  });

  it("rejects aggregate version skips while preserving exact-event retries", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-projection-version-"));
    const repository = new FilePublicProjectionRepository(root);
    await repository.initialize();
    const first = projection();
    const published = await repository.publish(first, "0");
    expect((await repository.publish(first, "99")).cursor).toBe(
      published.cursor,
    );
    await expect(
      repository.publish(
        {
          ...first,
          aggregateVersion: "3",
          canonicalEventHash: `0x${"b".repeat(64)}`,
        },
        "2",
      ),
    ).rejects.toBeInstanceOf(ProjectionVersionConflictError);
    expect(repository.events()).toHaveLength(1);
  });
});
