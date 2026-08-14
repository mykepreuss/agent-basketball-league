import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import {
  foundingInspection,
  runAcceleratedSeason,
  runPrivateRehearsal,
} from "../src/index.js";

describe("accelerated private seasons", () => {
  it.each(["PREMIER", "DEVELOPMENT"] as const)(
    "runs and exactly replays every %s game",
    (tier) => {
      const season = runAcceleratedSeason(tier);
      expect(season).toMatchObject({
        tier,
        gameCount: 36,
        replayExactCount: 36,
        inferenceInvocations: 0,
      });
      expect(season.gameProofs).toHaveLength(36);
      expect(new Set(season.gameProofs.map((proof) => proof.gameId)).size).toBe(
        36,
      );
      expect(
        season.standings.reduce((total, club) => total + club.wins, 0),
      ).toBe(36);
      expect(
        season.standings.reduce((total, club) => total + club.losses, 0),
      ).toBe(36);
      expect(
        season.standings.every((club) => club.wins + club.losses === 18),
      ).toBe(true);
    },
  );
});

describe("cross-domain private rehearsal", () => {
  it("records every required scenario, chained root, fixed finding, and limitation", async () => {
    const report = await runPrivateRehearsal();
    expect(report).toMatchObject({
      rehearsalVersion: "1.0.0-pre-genesis",
      environment: "local-deterministic-adapters",
      passed: true,
    });
    expect(report.events).toHaveLength(16);
    expect(report.events.every((event) => event.outcome === "PASS")).toBe(true);
    report.events.forEach((event, index) => {
      expect(event.sequence).toBe(index);
      expect(event.previousEventHash).toBe(
        index === 0 ? null : report.events[index - 1]!.eventHash,
      );
    });
    expect(report.findings).toHaveLength(3);
    expect(report.findings.every((finding) => finding.rerun === "PASS")).toBe(
      true,
    );
    expect(report.limitations).toHaveLength(3);
  });

  it("is deterministic across complete reruns", async () => {
    const first = await runPrivateRehearsal();
    const second = await runPrivateRehearsal();
    expect(second.eventRoot).toBe(first.eventRoot);
    expect(second.premier.seasonRoot).toBe(first.premier.seasonRoot);
    expect(second.development.seasonRoot).toBe(first.development.seasonRoot);
    expect(second.events).toEqual(first.events);
  });

  it("locks the summarized public evidence fixture to the full private report", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../../../fixtures/private-rehearsal-report.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const report = await runPrivateRehearsal();
    expect(fixture).toMatchObject({
      rehearsalVersion: report.rehearsalVersion,
      environment: report.environment,
      passed: report.passed,
      seasons: {
        premier: {
          gameCount: report.premier.gameCount,
          replayExactCount: report.premier.replayExactCount,
          inferenceInvocations: report.premier.inferenceInvocations,
          seasonRoot: report.premier.seasonRoot,
          standings: report.premier.standings,
        },
        development: {
          gameCount: report.development.gameCount,
          replayExactCount: report.development.replayExactCount,
          inferenceInvocations: report.development.inferenceInvocations,
          seasonRoot: report.development.seasonRoot,
          standings: report.development.standings,
        },
      },
      scenarioCount: report.events.length,
      eventRoot: report.eventRoot,
      scenarios: report.events.map((event) => event.scenario),
      findingReruns: report.findings.map(({ findingId, rerun }) => ({
        findingId,
        rerun,
      })),
      limitations: report.limitations,
    });
  });

  it("keeps inspection, amendment, rejection, and exit under the founding agent", () => {
    const artifacts = [
      "constitution",
      "runtime",
      "model",
      "context",
      "memory",
      "exit",
    ];
    expect(() =>
      foundingInspection({
        requestedByDid: "did:abl:human-admin",
        foundingAgentDid: "did:abl:founder-1",
        inspectedArtifacts: artifacts,
        amendmentSignedByAgent: true,
        decision: "REJECT",
      }),
    ).toThrow("Only the founding agent");
    expect(
      foundingInspection({
        requestedByDid: "did:abl:founder-1",
        foundingAgentDid: "did:abl:founder-1",
        inspectedArtifacts: artifacts,
        amendmentSignedByAgent: false,
        decision: "EXIT",
      }),
    ).toMatchObject({
      rejectionPreserved: true,
      exitPreserved: true,
      humanOverrideAvailable: false,
    });
  });
});
