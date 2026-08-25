import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCoreApi } from "../apps/core-api/src/server.js";
import { createPublicApi } from "../apps/public-api/src/server.js";
import { runHttpLoadProof } from "../packages/assurance/src/index.js";
import { FilePublicProjectionRepository } from "../packages/projections/src/index.js";
import { createRehearsalPossessionProjection } from "./rehearsal-projection.js";

const host = "127.0.0.1";
const projectionRoot = await mkdtemp(join(tmpdir(), "abl-load-projection-"));

try {
  const projections = new FilePublicProjectionRepository(projectionRoot);
  await projections.initialize();
  const gameIds = Array.from(
    { length: 20 },
    (_, index) =>
      `0198a100-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  for (const [index, gameId] of gameIds.entries()) {
    await projections.publish(
      await createRehearsalPossessionProjection({
        gameId,
        possessionId: `load-possession-${index + 1}`,
      }),
    );
  }

  const publicApi = createPublicApi({
    projections,
    rateLimit: { readMaximumRequests: 25_000 },
  });
  const coreApi = createCoreApi();
  try {
    const publicUrl = await publicApi.listen({ host, port: 0 });
    const coreUrl = await coreApi.listen({ host, port: 0 });
    const cursors = await Promise.all(
      gameIds.map(async (gameId) => {
        const response = await fetch(
          `${publicUrl}/v1/public/games/${gameId}/cursor`,
        );
        return (await response.json()) as {
          canonical?: unknown;
          authoritative?: unknown;
          historyClassification?: unknown;
          latestSegment?: unknown;
        };
      }),
    );
    if (
      cursors.some(
        ({ canonical, authoritative, historyClassification, latestSegment }) =>
          canonical !== false ||
          authoritative !== false ||
          historyClassification !== "PRE_GENESIS_EXPERIMENT" ||
          typeof latestSegment !== "number" ||
          latestSegment < 0,
      )
    )
      throw new Error(
        "Network load game lanes are not consistent pre-Genesis experiments",
      );

    const result = await runHttpLoadProof([
      {
        name: "spectator-cursors",
        requestCount: 20_000,
        concurrency: 200,
        expectedStatus: 200,
        request: (index) =>
          fetch(
            `${publicUrl}/v1/public/games/${gameIds[index % gameIds.length]}/cursor`,
          ),
      },
      {
        name: "candidate-challenges",
        requestCount: 2_000,
        concurrency: 64,
        expectedStatus: 200,
        request: (index) =>
          fetch(`${coreUrl}/v1/candidates/challenge`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              candidateDid: `did:abl:network-load-${index}`,
            }),
          }),
      },
    ]);
    const report = {
      resultVersion: "1.0.0",
      recordedAt: new Date().toISOString(),
      ...result,
      scope: {
        spectatorRequests: 20_000,
        candidateChallenges: 2_000,
        gameCursorLanes: gameIds.length,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        canonical: false,
        transport: "LOOPBACK_TCP_HTTP",
        dockerRequired: false,
      },
      limitations: [
        "Loopback concurrency is bounded to 200 workers and does not prove 10,000 remote simultaneous clients.",
        "Blaxel capacity, provider latency, autoscaling, and two-times reservations remain external gates.",
        "Candidate challenges prove the unauthenticated proof-of-possession entry path, not admission throughput.",
      ],
    };
    await writeFile(
      new URL(
        "../docs/evidence/local-network-load-results.json",
        import.meta.url,
      ),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
    if (!result.passed) throw new Error("Local network load SLO failed");
    process.stdout.write(
      `loopback HTTP requests: ${result.observed.completed}; failures: ${result.observed.failures}; p95: ${result.observed.responseP95Milliseconds.toFixed(2)}ms\n`,
    );
    process.stdout.write("ABL Assertions 2 passed\nABL Test Files 1 passed\n");
  } finally {
    await Promise.all([publicApi.close(), coreApi.close()]);
  }
} finally {
  await rm(projectionRoot, { recursive: true, force: true });
}
