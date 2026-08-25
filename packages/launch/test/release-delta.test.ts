import { describe, expect, it } from "vitest";

import {
  PrivateReleaseDeltaEvidenceSchema,
  assessPrivateReleaseDelta,
} from "../src/release-delta.js";

const stageCReleaseId = "a".repeat(40);
const targetReleaseId = "b".repeat(40);
const policy = {
  version: 1,
  stage: "READ_ONLY_BEACON_PRIVATE_SOAK",
  requiredDurationHours: 24,
  requiredWorkspaces: ["agent-basketball-league"],
  requiredServices: [
    {
      service: "abl-core-api",
      workspace: "agent-basketball-league",
      probe: { method: "GET", path: "/health", expectedStatus: 200 },
    },
  ],
  requiredExercises: [
    "restartRecovery",
    "credentialRotation",
    "backupCreation",
    "cleanRoomRestore",
    "replayRootEquality",
    "scaleToZeroRecovery",
    "rollbackReadiness",
    "candidateFlow",
  ],
  thresholds: {
    maximumErrorRate: 0.01,
    maximumSampleGapSeconds: 600,
    maximumProjectionLagMs: 2_000,
    maximumQueueDepth: 100,
    maximumProjectedMonthlyCostUsd: 25,
    minimumBlaxelBalanceUsd: 5,
  },
} as const;
const deploymentMap = {
  workloads: [
    {
      kind: "Sandbox",
      name: "abl-core-api",
      imageName: "abl-stage-c-core-api-image",
      trustDomain: "abl-core",
    },
    {
      kind: "Function",
      name: "abl-government-mcp",
      imageName: "abl-stage-c-government-mcp-image",
      trustDomain: "abl-core",
    },
    {
      kind: "Job",
      name: "abl-candidate-provisioner",
      imageName: "abl-stage-c-candidate-provisioner-image",
      trustDomain: "abl-core",
    },
  ],
} as const;

function stageCEvidence() {
  return {
    version: 1,
    evidenceClass: "LIVE_PRIVATE_SOAK",
    stage: "READ_ONLY_BEACON_PRIVATE_SOAK",
    releaseId: stageCReleaseId,
    startedAt: "2026-08-24T00:00:00.000Z",
    endedAt: "2026-08-25T00:00:00.000Z",
    publicExposure: "NONE",
    workspaces: ["agent-basketball-league"],
    services: [
      {
        ...policy.requiredServices[0],
        samples: 288,
        failures: 0,
        errorRate: 0,
        maximumLatencyMs: 500,
        maximumSampleGapSeconds: 300,
      },
    ],
    exercises: {
      restartRecovery: true,
      credentialRotation: true,
      backupCreation: true,
      cleanRoomRestore: true,
      replayRootEquality: true,
      scaleToZeroRecovery: true,
      rollbackReadiness: true,
      candidateFlow: true,
    },
    incidents: {
      p0: 0,
      p1: 0,
      privacyBreaches: 0,
      replayRootDivergences: 0,
      unrecoverableRestarts: 0,
      unboundedCostEvents: 0,
    },
    metrics: {
      maximumProjectionLagMs: 500,
      maximumQueueDepth: 1,
      candidateProvisioningFailures: 0,
      projectedMonthlyCostUsd: 24,
      observedCostUsd: 1,
      blaxelBalanceUsd: 10,
      automaticTopUp: false,
      publicIngressRequests: 0,
      canonicalClaims: 0,
      genesisClaims: 0,
    },
    recovery: {
      sourceEventCount: 10,
      restoredEventCount: 10,
      sourceOutboxCount: 10,
      restoredOutboxCount: 10,
      sourceStateRoot: `0x${"1".repeat(64)}`,
      restoredStateRoot: `0x${"1".repeat(64)}`,
    },
  } as const;
}

function deltaEvidence() {
  return {
    version: 1,
    evidenceClass: "LIVE_PRIVATE_RELEASE_DELTA",
    stage: "READ_ONLY_BEACON_RELEASE_DELTA",
    workspace: "agent-basketball-league",
    stageCReleaseId,
    targetReleaseId,
    startedAt: "2026-08-25T01:00:00.000Z",
    endedAt: "2026-08-25T01:30:00.000Z",
    publicExposure: "NONE",
    changedWorkloads: [
      {
        ...deploymentMap.workloads[0],
        providerTrustDomainLabel: deploymentMap.workloads[0].trustDomain,
        immutableImageReference: `sandbox/abl-stage-c-core-api-image:${"c".repeat(12)}`,
      },
      {
        ...deploymentMap.workloads[1],
        providerTrustDomainLabel: deploymentMap.workloads[1].trustDomain,
        immutableImageReference: `function/abl-stage-c-government-mcp-image:${"d".repeat(12)}`,
      },
      {
        ...deploymentMap.workloads[2],
        providerTrustDomainLabel: deploymentMap.workloads[2].trustDomain,
        immutableImageReference: `job/abl-stage-c-candidate-provisioner-image:${"e".repeat(12)}`,
      },
    ],
    changedServiceRestarts: [
      { kind: "Sandbox", name: "abl-core-api", passed: true },
      { kind: "Function", name: "abl-government-mcp", passed: true },
    ],
    checks: {
      targetDescendsFromStageC: true,
      exactReleaseIdentity: true,
      exactImageIdentity: true,
      healthReadiness: true,
      coreToPublicDelivery: true,
      replayRootEquality: true,
      affectedRejections: true,
      privateBoundary: true,
    },
    incidents: {
      p0: 0,
      p1: 0,
      privacyBreaches: 0,
      replayRootDivergences: 0,
      unrecoverableRestarts: 0,
    },
    metrics: {
      measuredAt: "2026-08-25T01:30:00.000Z",
      projectedMonthlyCostUsd: 24,
      observedDeltaCostUsd: 0.1,
      blaxelBalanceUsd: 10,
      automaticTopUp: false,
      publicIngressRequests: 0,
      canonicalClaims: 0,
      genesisClaims: 0,
      finalProviderReadback: true,
    },
    secretValuesRecorded: false,
  } as const;
}

describe("private release-delta handoff", () => {
  it("passes a bounded private update linked to accepted Stage C evidence", () => {
    expect(
      assessPrivateReleaseDelta(
        policy,
        deploymentMap,
        stageCEvidence(),
        deltaEvidence(),
      ),
    ).toMatchObject({
      status: "PASS",
      stageCReleaseId,
      targetReleaseId,
      changedWorkloadCount: 3,
      publicExposure: "NONE",
      blockers: [],
      resultDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("fails only the release-delta criteria that drift", () => {
    const observed = deltaEvidence();
    const result = assessPrivateReleaseDelta(
      policy,
      deploymentMap,
      stageCEvidence(),
      {
        ...observed,
        stageCReleaseId: "c".repeat(40),
        checks: { ...observed.checks, privateBoundary: false },
        changedServiceRestarts: observed.changedServiceRestarts.map(
          (restart, index) => ({ ...restart, passed: index !== 0 }),
        ),
        incidents: { ...observed.incidents, privacyBreaches: 1 },
        metrics: {
          ...observed.metrics,
          projectedMonthlyCostUsd: 25.01,
          observedDeltaCostUsd: 25.01,
          blaxelBalanceUsd: 4.99,
          automaticTopUp: true,
          publicIngressRequests: 1,
          canonicalClaims: 1,
          genesisClaims: 1,
        },
      },
    );
    expect(result.status).toBe("FAIL");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "release delta does not reference the accepted Stage C release",
        "required release-delta check did not pass: privateBoundary",
        "changed service did not recover after restart: Sandbox/abl-core-api",
        "release delta recorded privacyBreaches: 1",
        "projected monthly cost exceeded threshold",
        "observed release-delta cost exceeded threshold",
        "Blaxel balance fell below the approved floor",
        "automatic top-up must remain off",
        "private release delta received public ingress",
        "private release delta emitted canonical claims",
        "private release delta emitted Genesis claims",
      ]),
    );
  });

  it("rejects mutable, duplicated, mismatched, and incomplete image evidence", () => {
    const observed = deltaEvidence();
    expect(() =>
      PrivateReleaseDeltaEvidenceSchema.parse({
        ...observed,
        changedWorkloads: [
          observed.changedWorkloads[0],
          observed.changedWorkloads[0],
        ],
        changedServiceRestarts: [observed.changedServiceRestarts[0]],
      }),
    ).toThrow();
    expect(() =>
      PrivateReleaseDeltaEvidenceSchema.parse({
        ...observed,
        changedWorkloads: [
          {
            ...observed.changedWorkloads[0],
            immutableImageReference:
              "sandbox/abl-stage-c-core-api-image:latest",
          },
        ],
        changedServiceRestarts: [observed.changedServiceRestarts[0]],
      }),
    ).toThrow();
    expect(() =>
      PrivateReleaseDeltaEvidenceSchema.parse({
        ...observed,
        changedWorkloads: [
          {
            ...observed.changedWorkloads[1],
            immutableImageReference: `sandbox/abl-stage-c-government-mcp-image:${"d".repeat(12)}`,
          },
        ],
        changedServiceRestarts: [observed.changedServiceRestarts[1]],
      }),
    ).toThrow("Provider image kind does not match");
  });

  it("rejects provider readback drift and workloads outside the deployment map", () => {
    const observed = deltaEvidence();
    expect(() =>
      PrivateReleaseDeltaEvidenceSchema.parse({
        ...observed,
        metrics: {
          ...observed.metrics,
          measuredAt: "2026-08-25T01:29:59.000Z",
        },
      }),
    ).toThrow("Provider readback predates");
    expect(() =>
      PrivateReleaseDeltaEvidenceSchema.parse({
        ...observed,
        changedWorkloads: [
          {
            ...observed.changedWorkloads[0],
            providerTrustDomainLabel: "abl-public",
          },
        ],
        changedServiceRestarts: [observed.changedServiceRestarts[0]],
      }),
    ).toThrow("Provider trust-domain label does not match");

    const result = assessPrivateReleaseDelta(
      policy,
      deploymentMap,
      stageCEvidence(),
      {
        ...observed,
        changedWorkloads: [
          {
            ...observed.changedWorkloads[0],
            name: "abl-unapproved-service",
          },
        ],
        changedServiceRestarts: [
          { kind: "Sandbox", name: "abl-unapproved-service", passed: true },
        ],
      },
    );
    expect(result.blockers).toContain(
      "changed workload is outside the approved deployment map: Sandbox/abl-unapproved-service",
    );
  });
});
