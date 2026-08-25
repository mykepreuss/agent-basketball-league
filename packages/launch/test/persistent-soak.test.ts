import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  PersistentSoakPolicySchema,
  assessPersistentSoak,
  composePersistentSoakEvidence,
} from "../src/persistent-soak.js";

const requiredServices = [
  ["abl-private-storage-broker", "agent-basketball-league", "GET", "/health"],
  ["abl-core-api", "agent-basketball-league", "GET", "/health"],
  ["abl-safety-gateway", "agent-basketball-league", "GET", "/health"],
  ["abl-public-api", "agent-basketball-league", "GET", "/health"],
  ["abl-candidate-store", "agent-basketball-league", "GET", "/health"],
  ["abl-candidate-edge", "agent-basketball-league", "GET", "/health"],
  ["abl-spectator-arena", "agent-basketball-league", "GET", "/health"],
  ["abl-basketball-mcp", "agent-basketball-league", "POST", "/mcp"],
  ["abl-career-mcp", "agent-basketball-league", "POST", "/mcp"],
  ["abl-government-mcp", "agent-basketball-league", "POST", "/mcp"],
  ["abl-discovery-mcp", "agent-basketball-league", "POST", "/mcp"],
] as const;

const policy = {
  version: 1,
  stage: "READ_ONLY_BEACON_PRIVATE_SOAK",
  requiredDurationHours: 24,
  requiredWorkspaces: ["agent-basketball-league"],
  requiredServices: requiredServices.map(
    ([service, workspace, method, path]) => ({
      service,
      workspace,
      probe: {
        method,
        path,
        expectedStatus: 200,
        ...(method === "POST"
          ? { jsonBody: { jsonrpc: "2.0", id: 1, method: "tools/list" } }
          : {}),
      },
    }),
  ),
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

function evidence() {
  return {
    version: 1,
    evidenceClass: "LIVE_PRIVATE_SOAK",
    stage: "READ_ONLY_BEACON_PRIVATE_SOAK",
    releaseId: "release-under-test",
    startedAt: "2026-08-24T00:00:00.000Z",
    endedAt: "2026-08-25T00:00:00.000Z",
    publicExposure: "NONE",
    workspaces: [...policy.requiredWorkspaces],
    services: policy.requiredServices.map((service) => ({
      ...service,
      samples: 288,
      failures: 0,
      errorRate: 0,
      maximumLatencyMs: 750,
      maximumSampleGapSeconds: 300,
    })),
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
      projectedMonthlyCostUsd: 24.99,
      observedCostUsd: 1.5,
      blaxelBalanceUsd: 100,
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

function collectorInputs() {
  const complete = evidence();
  return {
    samples: {
      stage: complete.stage,
      releaseId: complete.releaseId,
      workspace: complete.workspaces[0],
      publicExposure: complete.publicExposure,
      startedAt: complete.startedAt,
      updatedAt: complete.endedAt,
      failedRuns: 0,
      services: Object.fromEntries(
        complete.services.map(({ service, ...observation }) => [
          service,
          observation,
        ]),
      ),
      secretValuesRecorded: false,
    },
    exercises: {
      stage: complete.stage,
      releaseId: complete.releaseId,
      workspace: complete.workspaces[0],
      publicExposure: complete.publicExposure,
      exercises: complete.exercises,
      incidents: complete.incidents,
      recovery: complete.recovery,
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

describe("persistent private soak", () => {
  it("keeps the checked-in policy and resource plan on the single-workspace boundary", async () => {
    const repositoryRoot = new URL("../../../", import.meta.url);
    const policyFile = PersistentSoakPolicySchema.parse(
      JSON.parse(
        await readFile(
          new URL(
            "infra/blaxel/persistent-pre-genesis/monitoring-policy.json",
            repositoryRoot,
          ),
          "utf8",
        ),
      ),
    );
    expect(policyFile).toEqual(policy);

    const plan = JSON.parse(
      await readFile(
        new URL(
          "infra/blaxel/persistent-pre-genesis/resource-plan.json",
          repositoryRoot,
        ),
        "utf8",
      ),
    ) as {
      workspaces: Array<{ name: string }>;
      resourceCounts: Record<string, number>;
      sandboxLifecycle: {
        automaticStandby: boolean;
        keepAlive: boolean;
        expirationPolicies: unknown[];
        reason: string;
      };
      costEnvelope: string;
      deploymentMap: string;
      publicExposure: string;
    };
    expect(plan.workspaces.map(({ name }) => name)).toEqual(
      policy.requiredWorkspaces,
    );
    expect(plan.resourceCounts).toMatchObject({
      sandboxes: 7,
      functions: 4,
      jobs: 2,
      agentDrives: 3,
      agents: 0,
      applications: 0,
      volumes: 0,
      privatePreviews: 11,
      publicPreviews: 0,
    });
    expect(plan.sandboxLifecycle).toEqual({
      automaticStandby: true,
      keepAlive: false,
      expirationPolicies: [],
      reason:
        "Persistent Sandboxes use Blaxel automatic standby and are retained without an automatic deletion TTL. Durable data remains in Agent Drive or PostgreSQL.",
    });
    expect(plan.costEnvelope).toBe(
      "infra/blaxel/persistent-pre-genesis/cost-envelope.json",
    );
    expect(plan.deploymentMap).toBe(
      "infra/blaxel/persistent-pre-genesis/deployment-map.json",
    );
    expect(plan.publicExposure).toBe("NONE");
  });

  it("keeps the recurring cost projection beneath the Stage C ceiling", async () => {
    const repositoryRoot = new URL("../../../", import.meta.url);
    const envelope = JSON.parse(
      await readFile(
        new URL(
          "infra/blaxel/persistent-pre-genesis/cost-envelope.json",
          repositoryRoot,
        ),
        "utf8",
      ),
    ) as {
      monthDays: number;
      maximumProjectedMonthlyCost: number;
      publishedRates: {
        sandboxActiveGiBSecond: number;
        sandboxSnapshotGiBMonth: number;
        imageGiBMonth: number;
        mcpActiveGiBSecond: number;
        jobActiveGiBSecond: number;
      };
      usageCaps: {
        sandboxAllocatedGiB: number;
        sandboxProbeIntervalSeconds: number;
        maximumSandboxActiveSecondsPerProbe: number;
        sandboxSnapshotGiB: number;
        imageGiB: number;
        mcpAllocatedGiB: number;
        maximumMcpActiveSecondsPerProbe: number;
        jobAllocatedGiB: number;
        maximumMonthlyJobActiveSeconds: number;
      };
      monthlyProjection: {
        sandboxActiveCompute: number;
        sandboxSnapshotStorage: number;
        imageStorage: number;
        mcpActiveCompute: number;
        jobActiveCompute: number;
        agentDrive: number;
        neonPostgresql17: number;
        total: number;
        remainingContingency: number;
      };
    };
    const { total, remainingContingency, ...components } =
      envelope.monthlyProjection;
    const probesPerMonth =
      (envelope.monthDays * 24 * 60 * 60) /
      envelope.usageCaps.sandboxProbeIntervalSeconds;
    const expectedComponents = {
      sandboxActiveCompute:
        envelope.usageCaps.sandboxAllocatedGiB *
        envelope.usageCaps.maximumSandboxActiveSecondsPerProbe *
        probesPerMonth *
        envelope.publishedRates.sandboxActiveGiBSecond,
      sandboxSnapshotStorage:
        envelope.usageCaps.sandboxSnapshotGiB *
        envelope.publishedRates.sandboxSnapshotGiBMonth,
      imageStorage:
        envelope.usageCaps.imageGiB * envelope.publishedRates.imageGiBMonth,
      mcpActiveCompute:
        envelope.usageCaps.mcpAllocatedGiB *
        envelope.usageCaps.maximumMcpActiveSecondsPerProbe *
        probesPerMonth *
        envelope.publishedRates.mcpActiveGiBSecond,
      jobActiveCompute:
        envelope.usageCaps.jobAllocatedGiB *
        envelope.usageCaps.maximumMonthlyJobActiveSeconds *
        envelope.publishedRates.jobActiveGiBSecond,
      agentDrive: 0,
      neonPostgresql17: 0,
    };
    const calculatedTotal = Object.values(components).reduce(
      (sum, component) => sum + component,
      0,
    );

    for (const [component, expected] of Object.entries(
      expectedComponents,
    ) as Array<[keyof typeof components, number]>) {
      expect(components[component]).toBeCloseTo(expected, 8);
    }
    expect(calculatedTotal).toBeCloseTo(total, 8);
    expect(total + remainingContingency).toBeCloseTo(
      envelope.maximumProjectedMonthlyCost,
      8,
    );
    expect(total).toBeLessThan(envelope.maximumProjectedMonthlyCost);
  });

  it("passes one complete bounded 24-hour observation", () => {
    expect(assessPersistentSoak(policy, evidence())).toMatchObject({
      status: "PASS",
      durationHours: 24,
      publicExposure: "NONE",
      blockers: [],
      resultDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("composes final evidence only from matching secret-free collectors", () => {
    const inputs = collectorInputs();
    const composed = composePersistentSoakEvidence({ policy, ...inputs });
    expect(composed).toEqual(evidence());
    expect(assessPersistentSoak(policy, composed).status).toBe("PASS");
  });

  it("accepts several service failures from the same failed sample run", () => {
    const inputs = collectorInputs();
    const services = structuredClone(inputs.samples.services);
    services["abl-core-api"]!.failures = 1;
    services["abl-public-api"]!.failures = 1;
    const composed = composePersistentSoakEvidence({
      policy,
      ...inputs,
      samples: { ...inputs.samples, failedRuns: 1, services },
    });
    expect(
      composed.services.reduce((total, service) => total + service.failures, 0),
    ).toBe(2);
  });

  it("rejects mismatched releases, unverified metrics, and failure drift", () => {
    const inputs = collectorInputs();
    expect(() =>
      composePersistentSoakEvidence({
        policy,
        ...inputs,
        metrics: { ...inputs.metrics, releaseId: "other-release" },
      }),
    ).toThrow("Stage C evidence release IDs do not match");
    expect(() =>
      composePersistentSoakEvidence({
        policy,
        ...inputs,
        metrics: { ...inputs.metrics, finalProviderReadback: false },
      }),
    ).toThrow();
    expect(() =>
      composePersistentSoakEvidence({
        policy,
        ...inputs,
        samples: { ...inputs.samples, failedRuns: 1 },
      }),
    ).toThrow("Stage C aggregate and per-service failures are inconsistent");
  });

  it("fails only the observed Stage C criteria without reopening earlier stages", () => {
    const failed = evidence();
    const result = assessPersistentSoak(policy, {
      ...failed,
      endedAt: "2026-08-24T23:00:00.000Z",
      exercises: { ...failed.exercises, cleanRoomRestore: false },
      incidents: { ...failed.incidents, p1: 1 },
      metrics: {
        ...failed.metrics,
        projectedMonthlyCostUsd: 25.01,
        publicIngressRequests: 1,
      },
      recovery: {
        ...failed.recovery,
        restoredStateRoot: `0x${"2".repeat(64)}`,
      },
    });
    expect(result.status).toBe("FAIL");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "private soak is shorter than 24 hours",
        "required exercise did not pass: cleanRoomRestore",
        "soak recorded p1: 1",
        "projected monthly cost exceeded threshold",
        "private soak received public ingress",
        "clean-room restore did not reproduce canonical state",
      ]),
    );
  });
});
