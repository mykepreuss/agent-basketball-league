import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const PublicSurfaceNameSchema = z.enum([
  "abl-public-api",
  "abl-spectator-arena",
]);
const PublicBeaconCheckSchema = z.enum([
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
]);

const RequiredPublicSurfaceSchema = z.strictObject({
  name: PublicSurfaceNameSchema,
  probePath: z.string().startsWith("/").max(200),
  expectedStatus: z.literal(200),
});

const PublicOriginSchema = z.url().superRefine((input, context) => {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    context.addIssue({
      code: "custom",
      message: "Public Beacon URL must be a credential-free HTTPS origin",
    });
});

export const PublicBeaconSoakPolicySchema = z.strictObject({
  version: z.literal(1),
  stage: z.literal("READ_ONLY_BEACON_PUBLIC_SOAK"),
  requiredDurationHours: z.literal(24),
  publicExposure: z.literal("READ_ONLY"),
  requiredSurfaces: z
    .array(RequiredPublicSurfaceSchema)
    .length(2)
    .refine((surfaces) => new Set(surfaces.map(({ name }) => name)).size === 2),
  requiredChecks: z
    .array(PublicBeaconCheckSchema)
    .length(12)
    .refine((checks) => new Set(checks).size === 12),
  thresholds: z.strictObject({
    maximumErrorRate: z.number().min(0).max(0.01),
    maximumSampleGapSeconds: z.literal(600),
    maximumProjectedMonthlyCostUsd: z.literal(25),
    minimumBlaxelBalanceUsd: z.literal(5),
  }),
});

const PublicSurfaceObservationSchema = RequiredPublicSurfaceSchema.extend({
  origin: PublicOriginSchema,
  samples: z.number().int().positive(),
  failures: z.number().int().nonnegative(),
  errorRate: z.number().min(0).max(1),
  maximumLatencyMs: z.number().int().nonnegative(),
  maximumSampleGapSeconds: z.number().int().nonnegative(),
}).superRefine((surface, context) => {
  if (surface.failures > surface.samples)
    context.addIssue({
      code: "custom",
      message: "Public surface failures cannot exceed samples",
      path: ["failures"],
    });
  if (surface.errorRate !== surface.failures / surface.samples)
    context.addIssue({
      code: "custom",
      message:
        "Public surface error rate must equal failures divided by samples",
      path: ["errorRate"],
    });
});

export const PublicBeaconSoakEvidenceSchema = z.strictObject({
  version: z.literal(1),
  evidenceClass: z.literal("LIVE_PUBLIC_BEACON_SOAK"),
  stage: z.literal("READ_ONLY_BEACON_PUBLIC_SOAK"),
  releaseId: z.string().regex(/^[0-9a-f]{40}$/),
  policyDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  publicExposure: z.literal("READ_ONLY"),
  surfaces: z.array(PublicSurfaceObservationSchema).length(2),
  checks: z.strictObject({
    anonymousDiscovery: z.boolean(),
    arenaRendering: z.boolean(),
    releaseBoundSkill: z.boolean(),
    releaseBoundVerifier: z.boolean(),
    noncanonicalPractice: z.boolean(),
    candidateMutationPrivate: z.boolean(),
    rateLimitRetryGuidance: z.boolean(),
    boundedPayloads: z.boolean(),
    scaleToZeroRecovery: z.boolean(),
    restartRecovery: z.boolean(),
    cleanRoomExternalAgent: z.boolean(),
    degradedStateLabeling: z.boolean(),
  }),
  incidents: z.strictObject({
    p0: z.number().int().nonnegative(),
    p1: z.number().int().nonnegative(),
    privacyBreaches: z.number().int().nonnegative(),
    falseCanonicalClaims: z.number().int().nonnegative(),
    falseGenesisClaims: z.number().int().nonnegative(),
    candidateMutationExposures: z.number().int().nonnegative(),
    unboundedCostEvents: z.number().int().nonnegative(),
  }),
  metrics: z.strictObject({
    projectedMonthlyCostUsd: z.number().nonnegative(),
    observedCostUsd: z.number().nonnegative(),
    blaxelBalanceUsd: z.number().nonnegative(),
    automaticTopUp: z.boolean(),
  }),
  credentialsUsed: z.literal(false),
  secretValuesRecorded: z.literal(false),
});

export type PublicBeaconSoakEvidence = z.infer<
  typeof PublicBeaconSoakEvidenceSchema
>;

const PublicSurfaceSamplesSchema = z
  .strictObject({
    origin: PublicOriginSchema,
    samples: z.number().int().positive(),
    failures: z.number().int().nonnegative(),
    maximumLatencyMs: z.number().int().nonnegative(),
    maximumSampleGapSeconds: z.number().int().nonnegative(),
    lastSampleAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((surface, context) => {
    if (surface.failures > surface.samples)
      context.addIssue({
        code: "custom",
        message: "Public surface failures cannot exceed samples",
        path: ["failures"],
      });
  });

const PublicBeaconSamplesSchema = z.strictObject({
  version: z.literal(1),
  evidenceClass: z.literal("LIVE_PUBLIC_BEACON_SAMPLES"),
  stage: z.literal("READ_ONLY_BEACON_PUBLIC_SOAK"),
  releaseId: z.string().regex(/^[0-9a-f]{40}$/),
  policyDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  publicExposure: z.literal("READ_ONLY"),
  startedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  failedRuns: z.number().int().nonnegative(),
  surfaces: z.strictObject({
    "abl-public-api": PublicSurfaceSamplesSchema,
    "abl-spectator-arena": PublicSurfaceSamplesSchema,
  }),
  credentialsUsed: z.literal(false),
  secretValuesRecorded: z.literal(false),
});

const PublicBeaconChecksSchema = z.strictObject({
  version: z.literal(1),
  evidenceClass: z.literal("LIVE_PUBLIC_BEACON_CHECKS"),
  stage: z.literal("READ_ONLY_BEACON_PUBLIC_SOAK"),
  releaseId: z.string().regex(/^[0-9a-f]{40}$/),
  publicExposure: z.literal("READ_ONLY"),
  checks: PublicBeaconSoakEvidenceSchema.shape.checks,
  incidents: PublicBeaconSoakEvidenceSchema.shape.incidents,
  credentialsUsed: z.literal(false),
  secretValuesRecorded: z.literal(false),
});

const PublicBeaconMetricsSchema =
  PublicBeaconSoakEvidenceSchema.shape.metrics.extend({
    releaseId: z.string().regex(/^[0-9a-f]{40}$/),
    measuredAt: z.iso.datetime({ offset: true }),
    finalProviderReadback: z.literal(true),
    secretValuesRecorded: z.literal(false),
  });

export function composePublicBeaconSoakEvidence(input: {
  policy: unknown;
  samples: unknown;
  checks: unknown;
  metrics: unknown;
}): PublicBeaconSoakEvidence {
  const policy = PublicBeaconSoakPolicySchema.parse(input.policy);
  const samples = PublicBeaconSamplesSchema.parse(input.samples);
  const checks = PublicBeaconChecksSchema.parse(input.checks);
  const metrics = PublicBeaconMetricsSchema.parse(input.metrics);
  if (
    new Set([samples.releaseId, checks.releaseId, metrics.releaseId]).size !== 1
  )
    throw new Error("Stage D evidence release IDs do not match");
  if (
    samples.stage !== policy.stage ||
    checks.stage !== policy.stage ||
    samples.publicExposure !== policy.publicExposure ||
    checks.publicExposure !== samples.publicExposure
  )
    throw new Error("Stage D evidence boundary does not match the policy");
  if (samples.policyDigest !== sha256Commitment(policy))
    throw new Error("Stage D sampling policy digest does not match");

  const sampleCounts = Object.values(samples.surfaces).map(
    ({ samples: count }) => count,
  );
  if (
    new Set(sampleCounts).size !== 1 ||
    samples.failedRuns > sampleCounts[0]! ||
    Object.values(samples.surfaces).some(
      ({ lastSampleAt }) => lastSampleAt !== samples.updatedAt,
    )
  )
    throw new Error("Stage D surface sample runs are inconsistent");
  if (Date.parse(metrics.measuredAt) < Date.parse(samples.updatedAt))
    throw new Error("Stage D provider metrics predate the final sample");

  const surfaceFailures = Object.values(samples.surfaces).reduce(
    (total, surface) => total + surface.failures,
    0,
  );
  if (
    surfaceFailures < samples.failedRuns ||
    surfaceFailures > samples.failedRuns * policy.requiredSurfaces.length
  )
    throw new Error(
      "Stage D aggregate and per-surface failures are inconsistent",
    );

  return PublicBeaconSoakEvidenceSchema.parse({
    version: 1,
    evidenceClass: "LIVE_PUBLIC_BEACON_SOAK",
    stage: policy.stage,
    releaseId: samples.releaseId,
    policyDigest: samples.policyDigest,
    startedAt: samples.startedAt,
    endedAt: samples.updatedAt,
    publicExposure: policy.publicExposure,
    surfaces: policy.requiredSurfaces.map((required) => {
      const observed = samples.surfaces[required.name];
      return {
        ...required,
        origin: observed.origin,
        samples: observed.samples,
        failures: observed.failures,
        errorRate: observed.failures / observed.samples,
        maximumLatencyMs: observed.maximumLatencyMs,
        maximumSampleGapSeconds: observed.maximumSampleGapSeconds,
      };
    }),
    checks: checks.checks,
    incidents: checks.incidents,
    metrics: {
      projectedMonthlyCostUsd: metrics.projectedMonthlyCostUsd,
      observedCostUsd: metrics.observedCostUsd,
      blaxelBalanceUsd: metrics.blaxelBalanceUsd,
      automaticTopUp: metrics.automaticTopUp,
    },
    credentialsUsed: false,
    secretValuesRecorded: false,
  });
}

function surfaceKey(surface: z.infer<typeof RequiredPublicSurfaceSchema>) {
  return `${surface.name}:${surface.probePath}:${surface.expectedStatus}`;
}

export function assessPublicBeaconSoak(
  policyInput: unknown,
  evidenceInput: unknown,
) {
  const policy = PublicBeaconSoakPolicySchema.parse(policyInput);
  const evidence = PublicBeaconSoakEvidenceSchema.parse(evidenceInput);
  const blockers: string[] = [];
  const durationHours =
    (Date.parse(evidence.endedAt) - Date.parse(evidence.startedAt)) / 3_600_000;
  if (!Number.isFinite(durationHours) || durationHours < 0)
    blockers.push("public soak timestamps are not monotonic");
  else if (durationHours < policy.requiredDurationHours)
    blockers.push("public soak is shorter than 24 hours");
  if (evidence.policyDigest !== sha256Commitment(policy))
    blockers.push("public soak policy digest does not match");

  const observations = new Map(
    evidence.surfaces.map((surface) => [surfaceKey(surface), surface]),
  );
  if (observations.size !== evidence.surfaces.length)
    blockers.push("public surface observations contain duplicates");
  for (const required of policy.requiredSurfaces) {
    const observed = observations.get(surfaceKey(required));
    if (!observed) {
      blockers.push(
        `required public surface was not observed: ${required.name}`,
      );
      continue;
    }
    if (observed.errorRate > policy.thresholds.maximumErrorRate)
      blockers.push(`public surface error rate exceeded: ${required.name}`);
    if (
      observed.maximumSampleGapSeconds >
      policy.thresholds.maximumSampleGapSeconds
    )
      blockers.push(`public surface sample gap exceeded: ${required.name}`);
  }

  for (const check of policy.requiredChecks)
    if (!evidence.checks[check])
      blockers.push(`required public check did not pass: ${check}`);
  for (const [incident, count] of Object.entries(evidence.incidents))
    if (count !== 0)
      blockers.push(`public soak recorded ${incident}: ${count}`);

  if (
    evidence.metrics.projectedMonthlyCostUsd >
    policy.thresholds.maximumProjectedMonthlyCostUsd
  )
    blockers.push("projected monthly cost exceeded threshold");
  if (
    evidence.metrics.observedCostUsd >
    policy.thresholds.maximumProjectedMonthlyCostUsd
  )
    blockers.push("observed public-soak cost exceeded the monthly ceiling");
  if (
    evidence.metrics.blaxelBalanceUsd <
    policy.thresholds.minimumBlaxelBalanceUsd
  )
    blockers.push("Blaxel balance fell below the approved floor");
  if (evidence.metrics.automaticTopUp)
    blockers.push("automatic top-up must remain off");

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
