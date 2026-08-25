import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const PersistentWorkspaceSchema = z.literal("agent-basketball-league");

const ProbeSchema = z
  .strictObject({
    method: z.enum(["GET", "POST"]),
    path: z.string().startsWith("/").max(200),
    expectedStatus: z.number().int().min(100).max(599),
    jsonBody: z
      .strictObject({
        jsonrpc: z.literal("2.0"),
        id: z.number().int().nonnegative(),
        method: z.literal("tools/list"),
      })
      .optional(),
  })
  .superRefine((probe, context) => {
    if (probe.method === "POST" && probe.jsonBody === undefined)
      context.addIssue({
        code: "custom",
        message: "POST protocol probes require a JSON body",
        path: ["jsonBody"],
      });
    if (probe.method === "GET" && probe.jsonBody !== undefined)
      context.addIssue({
        code: "custom",
        message: "GET health probes cannot include a JSON body",
        path: ["jsonBody"],
      });
  });

const RequiredServiceSchema = z.strictObject({
  service: z.string().min(1).max(100),
  workspace: PersistentWorkspaceSchema,
  probe: ProbeSchema,
});

const ExerciseSchema = z.enum([
  "restartRecovery",
  "credentialRotation",
  "backupCreation",
  "cleanRoomRestore",
  "replayRootEquality",
  "scaleToZeroRecovery",
  "rollbackReadiness",
  "candidateFlow",
]);

export const PersistentSoakPolicySchema = z.strictObject({
  version: z.literal(1),
  stage: z.literal("READ_ONLY_BEACON_PRIVATE_SOAK"),
  requiredDurationHours: z.number().min(24).max(168),
  requiredWorkspaces: z.array(PersistentWorkspaceSchema).length(1),
  requiredServices: z.array(RequiredServiceSchema).min(1),
  requiredExercises: z.array(ExerciseSchema).length(8),
  thresholds: z.strictObject({
    maximumErrorRate: z.number().min(0).max(1),
    maximumSampleGapSeconds: z.number().int().positive(),
    maximumProjectionLagMs: z.number().int().nonnegative(),
    maximumQueueDepth: z.number().int().nonnegative(),
    maximumProjectedMonthlyCostUsd: z.number().positive(),
    minimumBlaxelBalanceUsd: z.number().nonnegative(),
  }),
});

const ServiceObservationSchema = RequiredServiceSchema.extend({
  samples: z.number().int().positive(),
  failures: z.number().int().nonnegative(),
  errorRate: z.number().min(0).max(1),
  maximumLatencyMs: z.number().int().nonnegative(),
  maximumSampleGapSeconds: z.number().int().nonnegative(),
}).superRefine((service, context) => {
  if (service.failures > service.samples)
    context.addIssue({
      code: "custom",
      message: "Service failures cannot exceed samples",
      path: ["failures"],
    });
});

export const PersistentSoakEvidenceSchema = z.strictObject({
  version: z.literal(1),
  evidenceClass: z.literal("LIVE_PRIVATE_SOAK"),
  stage: z.literal("READ_ONLY_BEACON_PRIVATE_SOAK"),
  releaseId: z.string().min(1).max(200),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  publicExposure: z.literal("NONE"),
  workspaces: z.array(PersistentWorkspaceSchema).length(1),
  services: z.array(ServiceObservationSchema).min(1),
  exercises: z.strictObject({
    restartRecovery: z.boolean(),
    credentialRotation: z.boolean(),
    backupCreation: z.boolean(),
    cleanRoomRestore: z.boolean(),
    replayRootEquality: z.boolean(),
    scaleToZeroRecovery: z.boolean(),
    rollbackReadiness: z.boolean(),
    candidateFlow: z.boolean(),
  }),
  incidents: z.strictObject({
    p0: z.number().int().nonnegative(),
    p1: z.number().int().nonnegative(),
    privacyBreaches: z.number().int().nonnegative(),
    replayRootDivergences: z.number().int().nonnegative(),
    unrecoverableRestarts: z.number().int().nonnegative(),
    unboundedCostEvents: z.number().int().nonnegative(),
  }),
  metrics: z.strictObject({
    maximumProjectionLagMs: z.number().int().nonnegative(),
    maximumQueueDepth: z.number().int().nonnegative(),
    candidateProvisioningFailures: z.number().int().nonnegative(),
    projectedMonthlyCostUsd: z.number().nonnegative(),
    observedCostUsd: z.number().nonnegative(),
    blaxelBalanceUsd: z.number().nonnegative(),
    automaticTopUp: z.boolean(),
    publicIngressRequests: z.number().int().nonnegative(),
    canonicalClaims: z.number().int().nonnegative(),
    genesisClaims: z.number().int().nonnegative(),
  }),
  recovery: z.strictObject({
    sourceEventCount: z.number().int().nonnegative(),
    restoredEventCount: z.number().int().nonnegative(),
    sourceOutboxCount: z.number().int().nonnegative(),
    restoredOutboxCount: z.number().int().nonnegative(),
    sourceStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
    restoredStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
  }),
});

export type PersistentSoakPolicy = z.infer<typeof PersistentSoakPolicySchema>;
export type PersistentSoakEvidence = z.infer<
  typeof PersistentSoakEvidenceSchema
>;

const PersistentSoakSamplesSchema = z.object({
  stage: z.literal("READ_ONLY_BEACON_PRIVATE_SOAK"),
  releaseId: z.string().min(1).max(200),
  workspace: PersistentWorkspaceSchema,
  publicExposure: z.literal("NONE"),
  startedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  failedRuns: z.number().int().nonnegative(),
  services: z.record(
    z.string().min(1).max(100),
    z.object({
      samples: z.number().int().positive(),
      failures: z.number().int().nonnegative(),
      maximumLatencyMs: z.number().int().nonnegative(),
      maximumSampleGapSeconds: z.number().int().nonnegative(),
    }),
  ),
  secretValuesRecorded: z.literal(false),
});

const PersistentSoakExercisesSchema = z.object({
  stage: z.literal("READ_ONLY_BEACON_PRIVATE_SOAK"),
  releaseId: z.string().min(1).max(200),
  workspace: PersistentWorkspaceSchema,
  publicExposure: z.literal("NONE"),
  exercises: PersistentSoakEvidenceSchema.shape.exercises,
  incidents: PersistentSoakEvidenceSchema.shape.incidents,
  recovery: PersistentSoakEvidenceSchema.shape.recovery,
  secretValuesRecorded: z.literal(false),
});

const PersistentSoakMetricsSchema =
  PersistentSoakEvidenceSchema.shape.metrics.extend({
    releaseId: z.string().min(1).max(200),
    measuredAt: z.iso.datetime({ offset: true }),
    finalProviderReadback: z.literal(true),
    secretValuesRecorded: z.literal(false),
  });

export function composePersistentSoakEvidence(input: {
  policy: unknown;
  samples: unknown;
  exercises: unknown;
  metrics: unknown;
}): PersistentSoakEvidence {
  const policy = PersistentSoakPolicySchema.parse(input.policy);
  const samples = PersistentSoakSamplesSchema.parse(input.samples);
  const exercises = PersistentSoakExercisesSchema.parse(input.exercises);
  const metrics = PersistentSoakMetricsSchema.parse(input.metrics);
  if (
    new Set([samples.releaseId, exercises.releaseId, metrics.releaseId])
      .size !== 1
  )
    throw new Error("Stage C evidence release IDs do not match");
  if (
    samples.stage !== policy.stage ||
    exercises.stage !== policy.stage ||
    samples.workspace !== policy.requiredWorkspaces[0] ||
    exercises.workspace !== samples.workspace
  )
    throw new Error("Stage C evidence boundary does not match the policy");
  const serviceFailures = Object.values(samples.services).reduce(
    (total, service) => total + service.failures,
    0,
  );
  if (samples.failedRuns !== serviceFailures)
    throw new Error("Stage C aggregate and per-service failures do not match");

  return PersistentSoakEvidenceSchema.parse({
    version: 1,
    evidenceClass: "LIVE_PRIVATE_SOAK",
    stage: policy.stage,
    releaseId: samples.releaseId,
    startedAt: samples.startedAt,
    endedAt: samples.updatedAt,
    publicExposure: "NONE",
    workspaces: policy.requiredWorkspaces,
    services: policy.requiredServices.map((required) => {
      const observed = samples.services[required.service];
      if (observed === undefined)
        throw new Error(`Missing service sample: ${required.service}`);
      return {
        ...required,
        ...observed,
        errorRate: observed.failures / observed.samples,
      };
    }),
    exercises: exercises.exercises,
    incidents: exercises.incidents,
    metrics: {
      maximumProjectionLagMs: metrics.maximumProjectionLagMs,
      maximumQueueDepth: metrics.maximumQueueDepth,
      candidateProvisioningFailures: metrics.candidateProvisioningFailures,
      projectedMonthlyCostUsd: metrics.projectedMonthlyCostUsd,
      observedCostUsd: metrics.observedCostUsd,
      blaxelBalanceUsd: metrics.blaxelBalanceUsd,
      automaticTopUp: metrics.automaticTopUp,
      publicIngressRequests: metrics.publicIngressRequests,
      canonicalClaims: metrics.canonicalClaims,
      genesisClaims: metrics.genesisClaims,
    },
    recovery: exercises.recovery,
  });
}

function sameMembers(left: readonly string[], right: readonly string[]) {
  return (
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function serviceKey(service: z.infer<typeof RequiredServiceSchema>): string {
  return `${service.workspace}:${service.service}:${service.probe.method}:${service.probe.path}`;
}

export function assessPersistentSoak(
  policyInput: unknown,
  evidenceInput: unknown,
) {
  const policy = PersistentSoakPolicySchema.parse(policyInput);
  const evidence = PersistentSoakEvidenceSchema.parse(evidenceInput);
  const blockers: string[] = [];
  const startedAt = Date.parse(evidence.startedAt);
  const endedAt = Date.parse(evidence.endedAt);
  const durationHours = (endedAt - startedAt) / 3_600_000;

  if (!Number.isFinite(durationHours) || durationHours < 0)
    blockers.push("soak timestamps are not monotonic");
  else if (durationHours < policy.requiredDurationHours)
    blockers.push(
      `private soak is shorter than ${policy.requiredDurationHours} hours`,
    );

  if (!sameMembers(policy.requiredWorkspaces, evidence.workspaces))
    blockers.push(
      "observed workspace set does not match the persistent topology",
    );

  const observations = new Map(
    evidence.services.map((service) => [serviceKey(service), service]),
  );
  if (observations.size !== evidence.services.length)
    blockers.push("service observations contain duplicates");
  for (const requiredService of policy.requiredServices) {
    const observation = observations.get(serviceKey(requiredService));
    if (observation === undefined) {
      blockers.push(
        `required service was not observed: ${requiredService.service}`,
      );
      continue;
    }
    if (observation.errorRate > policy.thresholds.maximumErrorRate)
      blockers.push(
        `service error rate exceeded threshold: ${requiredService.service}`,
      );
    if (
      observation.maximumSampleGapSeconds >
      policy.thresholds.maximumSampleGapSeconds
    )
      blockers.push(
        `service observation gap exceeded threshold: ${requiredService.service}`,
      );
  }

  for (const exercise of policy.requiredExercises)
    if (!evidence.exercises[exercise])
      blockers.push(`required exercise did not pass: ${exercise}`);

  for (const [incident, count] of Object.entries(evidence.incidents))
    if (count !== 0) blockers.push(`soak recorded ${incident}: ${count}`);

  if (
    evidence.metrics.maximumProjectionLagMs >
    policy.thresholds.maximumProjectionLagMs
  )
    blockers.push("projection lag exceeded threshold");
  if (evidence.metrics.maximumQueueDepth > policy.thresholds.maximumQueueDepth)
    blockers.push("queue depth exceeded threshold");
  if (evidence.metrics.candidateProvisioningFailures !== 0)
    blockers.push("candidate flow recorded provisioning failures");
  if (
    evidence.metrics.projectedMonthlyCostUsd >
    policy.thresholds.maximumProjectedMonthlyCostUsd
  )
    blockers.push("projected monthly cost exceeded threshold");
  if (
    evidence.metrics.observedCostUsd >
    policy.thresholds.maximumProjectedMonthlyCostUsd
  )
    blockers.push("observed soak cost exceeded the monthly ceiling");
  if (
    evidence.metrics.blaxelBalanceUsd <
    policy.thresholds.minimumBlaxelBalanceUsd
  )
    blockers.push("Blaxel balance fell below the approved floor");
  if (evidence.metrics.automaticTopUp)
    blockers.push("automatic top-up must remain off");
  if (evidence.metrics.publicIngressRequests !== 0)
    blockers.push("private soak received public ingress");
  if (evidence.metrics.canonicalClaims !== 0)
    blockers.push("private soak emitted canonical claims");
  if (evidence.metrics.genesisClaims !== 0)
    blockers.push("private soak emitted Genesis claims");

  if (
    evidence.recovery.sourceEventCount !==
      evidence.recovery.restoredEventCount ||
    evidence.recovery.sourceOutboxCount !==
      evidence.recovery.restoredOutboxCount ||
    evidence.recovery.sourceStateRoot !== evidence.recovery.restoredStateRoot
  )
    blockers.push("clean-room restore did not reproduce canonical state");

  const uniqueBlockers = [...new Set(blockers)];
  const result = {
    status: uniqueBlockers.length === 0 ? ("PASS" as const) : ("FAIL" as const),
    stage: evidence.stage,
    releaseId: evidence.releaseId,
    durationHours,
    publicExposure: evidence.publicExposure,
    blockers: uniqueBlockers,
  };
  return { ...result, resultDigest: sha256Commitment(result) };
}
