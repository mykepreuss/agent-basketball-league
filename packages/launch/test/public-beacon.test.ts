import { describe, expect, it } from "vitest";

import { sha256Commitment } from "@abl/recognition";

import {
  assessPublicBeaconSoak,
  composePublicBeaconSoakEvidence,
} from "../src/public-beacon.js";

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
    projectedMonthlyCostEnforcement: "ADVISORY",
    minimumBlaxelBalanceUsd: 5,
  },
} as const;

function evidence() {
  return {
    version: 1,
    evidenceClass: "LIVE_PUBLIC_BEACON_SOAK",
    stage: "READ_ONLY_BEACON_PUBLIC_SOAK",
    releaseId: "a".repeat(40),
    policyDigest: sha256Commitment(policy),
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

function collectorInputs() {
  const complete = evidence();
  return {
    samples: {
      version: 1,
      evidenceClass: "LIVE_PUBLIC_BEACON_SAMPLES",
      stage: complete.stage,
      releaseId: complete.releaseId,
      policyDigest: sha256Commitment(policy),
      publicExposure: complete.publicExposure,
      startedAt: complete.startedAt,
      updatedAt: complete.endedAt,
      failedRuns: 1,
      surfaces: Object.fromEntries(
        complete.surfaces.map(
          ({ name, probePath, expectedStatus, errorRate, ...surface }) => [
            name,
            { ...surface, lastSampleAt: complete.endedAt },
          ],
        ),
      ),
      credentialsUsed: false,
      secretValuesRecorded: false,
    },
    checks: {
      version: 1,
      evidenceClass: "LIVE_PUBLIC_BEACON_CHECKS",
      stage: complete.stage,
      releaseId: complete.releaseId,
      publicExposure: complete.publicExposure,
      checks: complete.checks,
      incidents: complete.incidents,
      credentialsUsed: false,
      secretValuesRecorded: false,
    },
    metrics: {
      releaseId: complete.releaseId,
      measuredAt: complete.endedAt,
      ...complete.metrics,
      finalProviderReadback: true,
      secretValuesRecorded: false,
    },
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

  it("composes final evidence only from matching secret-free collectors", () => {
    const inputs = collectorInputs();
    const composed = composePublicBeaconSoakEvidence({ policy, ...inputs });
    expect(composed).toEqual(evidence());
    expect(assessPublicBeaconSoak(policy, composed).status).toBe("PASS");
  });

  it("rejects release, provider-readback, and failure-count drift", () => {
    const inputs = collectorInputs();
    expect(() =>
      composePublicBeaconSoakEvidence({
        policy,
        ...inputs,
        metrics: { ...inputs.metrics, releaseId: "b".repeat(40) },
      }),
    ).toThrow("Stage D evidence release IDs do not match");
    expect(() =>
      composePublicBeaconSoakEvidence({
        policy,
        ...inputs,
        metrics: { ...inputs.metrics, finalProviderReadback: false },
      }),
    ).toThrow();
    expect(() =>
      composePublicBeaconSoakEvidence({
        policy,
        ...inputs,
        samples: { ...inputs.samples, failedRuns: 0 },
      }),
    ).toThrow("Stage D aggregate and per-surface failures are inconsistent");
    expect(() =>
      composePublicBeaconSoakEvidence({
        policy,
        ...inputs,
        samples: {
          ...inputs.samples,
          policyDigest: `0x${"0".repeat(64)}`,
        },
      }),
    ).toThrow("Stage D sampling policy digest does not match");
    expect(() =>
      composePublicBeaconSoakEvidence({
        policy,
        ...inputs,
        metrics: {
          ...inputs.metrics,
          measuredAt: "2026-08-24T23:59:59.000Z",
        },
      }),
    ).toThrow("Stage D provider metrics predate the final sample");
    expect(() =>
      composePublicBeaconSoakEvidence({
        policy,
        ...inputs,
        samples: {
          ...inputs.samples,
          surfaces: {
            ...inputs.samples.surfaces,
            "abl-public-api": {
              ...inputs.samples.surfaces["abl-public-api"],
              origin: "https://user:password@api.example",
            },
          },
        },
      }),
    ).toThrow();
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
      ]),
    );
  });

  it("reports cost without blocking an advisory-cost public soak", () => {
    const observed = evidence();
    const result = assessPublicBeaconSoak(
      {
        ...policy,
        thresholds: {
          ...policy.thresholds,
          projectedMonthlyCostEnforcement: "ADVISORY",
        },
      },
      {
        ...observed,
        metrics: {
          ...observed.metrics,
          projectedMonthlyCostUsd: 250,
          observedCostUsd: 250,
        },
      },
    );
    expect(result).toMatchObject({ status: "PASS", blockers: [] });
  });

  it("can enforce an explicit hard public-soak cost ceiling", () => {
    const observed = evidence();
    const result = assessPublicBeaconSoak(
      {
        ...policy,
        thresholds: {
          ...policy.thresholds,
          projectedMonthlyCostEnforcement: "HARD_CEILING",
        },
      },
      {
        ...observed,
        policyDigest: sha256Commitment({
          ...policy,
          thresholds: {
            ...policy.thresholds,
            projectedMonthlyCostEnforcement: "HARD_CEILING",
          },
        }),
        metrics: { ...observed.metrics, projectedMonthlyCostUsd: 25.01 },
      },
    );
    expect(result.blockers).toContain(
      "projected monthly cost exceeded threshold",
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
