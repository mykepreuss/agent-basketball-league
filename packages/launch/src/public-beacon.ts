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
  origin: z.url().startsWith("https://"),
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
