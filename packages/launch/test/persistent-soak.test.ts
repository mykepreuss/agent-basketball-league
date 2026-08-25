import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  PersistentSoakPolicySchema,
  assessPersistentSoak,
  assessPersistentSoakHandoff,
  composePersistentSoakEvidence,
  createReadOnlyBeaconLaunchState,
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
    projectedMonthlyCostEnforcement: "ADVISORY",
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
      sources: {
        blaxelInventoryReadAt: complete.endedAt,
        blaxelBillingReadAt: complete.endedAt,
        neonInventoryReadAt: complete.endedAt,
        databaseMetricsReadAt: complete.endedAt,
        launchStateReadAt: complete.endedAt,
        candidateFlowReadAt: complete.endedAt,
        blaxelWorkspace: "agent-basketball-league",
        neonProjectId: "project-under-test",
        databaseConnection: "DIRECT_TLS",
        costProjectionMethod: "GREATER_OF_CAP_OR_24H_ANNUALIZED",
      },
      secretValuesRecorded: false,
    },
  } as const;
}

function ownerAcceptedEvidence() {
  const observed = evidence();
  return {
    ...observed,
    endedAt: "2026-08-24T13:30:00.000Z",
    services: observed.services.map((service) => ({
      ...service,
      maximumSampleGapSeconds: 1_667,
      ...(service.service === "abl-government-mcp"
        ? { failures: 1, errorRate: 1 / service.samples }
        : {}),
    })),
  };
}

function ownerAcceptance(observed = ownerAcceptedEvidence()) {
  const technical = assessPersistentSoak(policy, observed);
  return {
    version: 1,
    evidenceClass: "OWNER_ACCEPTED_EXPERIMENTAL_STAGE_C",
    programId: "ABL-COMPLETION-01",
    acceptanceId: "ABL-COMPLETION-01-STAGE-C-OWNER-ACCEPTANCE-01",
    releaseId: observed.releaseId,
    technicalStatus: "FAIL",
    technicalResultDigest: technical.resultDigest,
    acceptedBlockers: technical.blockers,
    ownerDisposition: "ACCEPTED_FOR_EXPERIMENTAL_LAUNCH",
    rationaleCode: "LOCAL_MONITOR_SLEEP_INTERRUPTION",
    experimentalLimits: {
      minimumObservedHours: 12,
      maximumObservedGapSeconds: 1_800,
      maximumServiceFailures: 1,
    },
    observed: {
      durationHours: technical.durationHours,
      maximumSampleGapSeconds: 1_667,
      serviceFailures: 1,
    },
    requiredFollowUps: [
      "FOCUSED_GOVERNMENT_MCP_HEALTH",
      "LIVE_PUBLIC_MONITORING_AND_ROLLBACK",
    ],
    publicExposure: "NONE",
    canonicalHistoryClaim: false,
    genesis: false,
    secretValuesRecorded: false,
    acceptedAt: "2026-08-24T13:31:00.000Z",
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

  it("keeps the technical failure while accepting only the bounded local-monitor interruption", () => {
    const observed = ownerAcceptedEvidence();
    expect(assessPersistentSoak(policy, observed).status).toBe("FAIL");
    expect(
      assessPersistentSoakHandoff(policy, observed, ownerAcceptance(observed)),
    ).toMatchObject({
      status: "ACCEPTED",
      basis: "OWNER_ACCEPTED_EXPERIMENTAL_LAUNCH",
      technicalStatus: "FAIL",
      ownerAcceptanceDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      blockers: [],
    });
  });

  it("does not let owner acceptance waive substantive launch failures", () => {
    const base = ownerAcceptedEvidence();
    const observed = {
      ...base,
      incidents: { ...base.incidents, privacyBreaches: 1 },
    };
    const technical = assessPersistentSoak(policy, observed);
    expect(technical.blockers).toContain("soak recorded privacyBreaches: 1");
    expect(() =>
      assessPersistentSoakHandoff(policy, observed, {
        ...ownerAcceptance(),
        technicalResultDigest: technical.resultDigest,
        acceptedBlockers: technical.blockers,
      }),
    ).toThrow(
      "Owner acceptance may cover only the shortened observation and local sampling-gap blockers",
    );
  });

  it("composes final evidence only from matching secret-free collectors", () => {
    const inputs = collectorInputs();
    const composed = composePersistentSoakEvidence({ policy, ...inputs });
    expect(composed).toEqual(evidence());
    expect(assessPersistentSoak(policy, composed).status).toBe("PASS");
  });

  it("accepts provider recovery metadata without copying it into final evidence", () => {
    const inputs = collectorInputs();
    const composed = composePersistentSoakEvidence({
      policy,
      ...inputs,
      exercises: {
        ...inputs.exercises,
        recovery: {
          ...inputs.exercises.recovery,
          job: "abl-recovery-verifier",
          executionId: "execution-under-test",
          temporaryBranchId: "branch-under-test",
          temporaryBranchDeleted: true,
          temporarySecretMaterialDeleted: true,
          sourceCredentialExposed: false,
          restoredCredentialExposed: false,
        },
      },
    });

    expect(composed.recovery).toEqual(evidence().recovery);
    expect(composed.recovery).not.toHaveProperty("temporaryBranchId");
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
        metrics: {
          ...inputs.metrics,
          sources: {
            ...inputs.metrics.sources,
            blaxelBillingReadAt: "2026-08-24T22:59:59.999Z",
          },
        },
      }),
    ).toThrow("Stage C metrics source is stale or future-dated");
    expect(() =>
      composePersistentSoakEvidence({
        policy,
        ...inputs,
        samples: { ...inputs.samples, failedRuns: 1 },
      }),
    ).toThrow("Stage C aggregate and per-service failures are inconsistent");
  });

  it("derives the evidence-bound read-only Beacon state only after Stage C passes", () => {
    const launchState = createReadOnlyBeaconLaunchState(
      policy,
      evidence(),
      "2026-08-25T00:01:00.000Z",
    );
    expect(launchState).toMatchObject({
      launchStage: "READ_ONLY_BEACON",
      operatingProfile: "PRE_GENESIS_REHEARSAL",
      recognitionLevel: "SIGNED_VALID",
      publicExposure: "READ_ONLY",
      genesis: false,
      canonical: false,
      recognized: false,
      canonicalHistoryOpen: false,
      productionV1Ready: false,
      candidateIntake: { mode: "INVITE_ONLY", capacityState: "CLOSED" },
      lastSuccessfulAcceptance: {
        stage: "READ_ONLY_BEACON",
        evidenceId: "ABL-COMPLETION-01-STAGE-C",
      },
    });
    expect(launchState.evidenceDigest).toMatch(/^0x[0-9a-f]{64}$/);

    const shortSoak = { ...evidence(), endedAt: "2026-08-24T23:00:00.000Z" };
    expect(() =>
      createReadOnlyBeaconLaunchState(
        policy,
        shortSoak,
        "2026-08-25T00:01:00.000Z",
      ),
    ).toThrow("Stage C private soak has not been accepted");

    const observed = ownerAcceptedEvidence();
    expect(
      createReadOnlyBeaconLaunchState(
        policy,
        observed,
        "2026-08-24T13:31:00.000Z",
        ownerAcceptance(observed),
      ),
    ).toMatchObject({
      launchStage: "READ_ONLY_BEACON",
      publicExposure: "READ_ONLY",
      candidateIntake: { mode: "INVITE_ONLY" },
    });
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
        "private soak received public ingress",
        "clean-room restore did not reproduce canonical state",
      ]),
    );
  });

  it("reports cost without blocking an advisory-cost soak", () => {
    const observed = evidence();
    const result = assessPersistentSoak(
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

  it("can enforce an explicit hard cost ceiling", () => {
    const observed = evidence();
    const result = assessPersistentSoak(
      {
        ...policy,
        thresholds: {
          ...policy.thresholds,
          projectedMonthlyCostEnforcement: "HARD_CEILING",
        },
      },
      {
        ...observed,
        metrics: { ...observed.metrics, projectedMonthlyCostUsd: 25.01 },
      },
    );
    expect(result.blockers).toContain(
      "projected monthly cost exceeded threshold",
    );
  });

  it("rejects an empty clean-room restore as insufficient replay evidence", () => {
    const observed = evidence();
    const result = assessPersistentSoak(policy, {
      ...observed,
      recovery: {
        ...observed.recovery,
        sourceEventCount: 0,
        restoredEventCount: 0,
        sourceOutboxCount: 0,
        restoredOutboxCount: 0,
      },
    });
    expect(result.status).toBe("FAIL");
    expect(result.blockers).toContain(
      "clean-room restore did not include recorded event and outbox history",
    );
  });
});
