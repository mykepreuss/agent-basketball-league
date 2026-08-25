import { describe, expect, it } from "vitest";

import { assessPublicBeaconSoak } from "../src/public-beacon.js";

const policy = {
  version: 1,
  stage: "READ_ONLY_BEACON_PUBLIC_SOAK",
  requiredDurationHours: 24,
  publicExposure: "READ_ONLY",
  requiredSurfaces: [
    { name: "abl-public-api", probePath: "/health", expectedStatus: 200 },
    { name: "abl-spectator-arena", probePath: "/health", expectedStatus: 200 },
  ],
  requiredChecks: [
    "anonymousDiscovery",
    "arenaRendering",
    "releaseBoundSkill",
    "releaseBoundVerifier",
    "noncanonicalPractice",
    "candidateMutationPrivate",
    "rateLimitRetryGuidance",
    "boundedPayloads",
    "scaleToZeroRecovery",
    "restartRecovery",
    "cleanRoomExternalAgent",
    "degradedStateLabeling",
  ],
  thresholds: {
    maximumErrorRate: 0.01,
    maximumSampleGapSeconds: 600,
    maximumProjectedMonthlyCostUsd: 25,
    minimumBlaxelBalanceUsd: 5,
  },
} as const;

function evidence() {
  return {
    version: 1,
    evidenceClass: "LIVE_PUBLIC_BEACON_SOAK",
    stage: "READ_ONLY_BEACON_PUBLIC_SOAK",
    releaseId: "a".repeat(40),
    startedAt: "2026-08-25T00:00:00.000Z",
    endedAt: "2026-08-26T00:00:00.000Z",
    publicExposure: "READ_ONLY",
    surfaces: policy.requiredSurfaces.map((surface, index) => ({
      ...surface,
      origin: `https://${index === 0 ? "api" : "arena"}.example`,
      samples: 480,
      failures: 1,
      errorRate: 1 / 480,
      maximumLatencyMs: 2_000,
      maximumSampleGapSeconds: 300,
    })),
    checks: Object.fromEntries(
      policy.requiredChecks.map((check) => [check, true]),
    ),
    incidents: {
      p0: 0,
      p1: 0,
      privacyBreaches: 0,
      falseCanonicalClaims: 0,
      falseGenesisClaims: 0,
      candidateMutationExposures: 0,
      unboundedCostEvents: 0,
    },
    metrics: {
      projectedMonthlyCostUsd: 24,
      observedCostUsd: 2,
      blaxelBalanceUsd: 5,
      automaticTopUp: false,
    },
    credentialsUsed: false,
    secretValuesRecorded: false,
  } as const;
}

describe("public Beacon soak", () => {
  it("passes the bounded 24-hour read-only observation", () => {
    expect(assessPublicBeaconSoak(policy, evidence())).toMatchObject({
      status: "PASS",
      durationHours: 24,
      publicExposure: "READ_ONLY",
      blockers: [],
      resultDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("fails only the violated public criteria", () => {
    const observed = evidence();
    const result = assessPublicBeaconSoak(policy, {
      ...observed,
      endedAt: "2026-08-25T23:00:00.000Z",
      checks: { ...observed.checks, cleanRoomExternalAgent: false },
      incidents: { ...observed.incidents, falseCanonicalClaims: 1 },
      metrics: { ...observed.metrics, projectedMonthlyCostUsd: 25.01 },
    });
    expect(result).toMatchObject({ status: "FAIL" });
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "public soak is shorter than 24 hours",
        "required public check did not pass: cleanRoomExternalAgent",
        "public soak recorded falseCanonicalClaims: 1",
        "projected monthly cost exceeded threshold",
      ]),
    );
  });

  it("rejects a policy that repeats a check or public surface", () => {
    expect(() =>
      assessPublicBeaconSoak(
        {
          ...policy,
          requiredChecks: [
            ...policy.requiredChecks.slice(0, -1),
            policy.requiredChecks[0],
          ],
        },
        evidence(),
      ),
    ).toThrow();
    expect(() =>
      assessPublicBeaconSoak(
        {
          ...policy,
          requiredSurfaces: [
            policy.requiredSurfaces[0],
            policy.requiredSurfaces[0],
          ],
        },
        evidence(),
      ),
    ).toThrow();
  });
});
