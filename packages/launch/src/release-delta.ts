import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

import { ImmutableSandboxImageReferenceSchema } from "./image-reference.js";
import {
  PersistentSoakEvidenceSchema,
  PersistentSoakPolicySchema,
  assessPersistentSoak,
} from "./persistent-soak.js";

const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const WorkloadNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const WorkloadKindSchema = z.enum(["Sandbox", "Function", "Job"]);
const TrustDomainSchema = z.enum([
  "abl-core",
  "abl-private",
  "abl-public",
  "abl-competition",
]);
const ImmutableWorkloadImageReferenceSchema = z.union([
  ImmutableSandboxImageReferenceSchema,
  z
    .string()
    .min(1)
    .max(500)
    .regex(
      /^(?:function|job)\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?:(?:[a-z0-9]{12}|[0-9a-f]{21})$/,
    ),
]);
const ChangedWorkloadSchema = z
  .strictObject({
    kind: WorkloadKindSchema,
    name: WorkloadNameSchema,
    imageName: WorkloadNameSchema,
    trustDomain: TrustDomainSchema,
    providerTrustDomainLabel: TrustDomainSchema,
    immutableImageReference: ImmutableWorkloadImageReferenceSchema,
  })
  .superRefine((workload, context) => {
    if (workload.providerTrustDomainLabel !== workload.trustDomain)
      context.addIssue({
        code: "custom",
        path: ["providerTrustDomainLabel"],
        message: "Provider trust-domain label does not match the release",
      });
    if (
      !workload.immutableImageReference.includes("@sha256:") &&
      !workload.immutableImageReference.startsWith(
        `${workload.kind.toLowerCase()}/`,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Provider image kind does not match the changed workload",
        path: ["immutableImageReference"],
      });
  });
const RestartObservationSchema = z.strictObject({
  kind: z.enum(["Sandbox", "Function"]),
  name: WorkloadNameSchema,
  passed: z.boolean(),
});

function resourceId(resource: { kind: string; name: string }): string {
  return `${resource.kind}/${resource.name}`;
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const PrivateReleaseDeltaEvidenceSchema = z
  .strictObject({
    version: z.literal(1),
    evidenceClass: z.literal("LIVE_PRIVATE_RELEASE_DELTA"),
    stage: z.literal("READ_ONLY_BEACON_RELEASE_DELTA"),
    workspace: z.literal("agent-basketball-league"),
    stageCReleaseId: GitCommitSchema,
    targetReleaseId: GitCommitSchema,
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    publicExposure: z.literal("NONE"),
    changedWorkloads: z.array(ChangedWorkloadSchema).min(1).max(13),
    changedServiceRestarts: z.array(RestartObservationSchema).max(11),
    checks: z.strictObject({
      targetDescendsFromStageC: z.boolean(),
      exactReleaseIdentity: z.boolean(),
      exactImageIdentity: z.boolean(),
      healthReadiness: z.boolean(),
      coreToPublicDelivery: z.boolean(),
      replayRootEquality: z.boolean(),
      affectedRejections: z.boolean(),
      privateBoundary: z.boolean(),
    }),
    incidents: z.strictObject({
      p0: z.number().int().nonnegative(),
      p1: z.number().int().nonnegative(),
      privacyBreaches: z.number().int().nonnegative(),
      replayRootDivergences: z.number().int().nonnegative(),
      unrecoverableRestarts: z.number().int().nonnegative(),
    }),
    metrics: z.strictObject({
      measuredAt: z.iso.datetime({ offset: true }),
      projectedMonthlyCostUsd: z.number().nonnegative(),
      observedDeltaCostUsd: z.number().nonnegative(),
      blaxelBalanceUsd: z.number().nonnegative(),
      automaticTopUp: z.boolean(),
      publicIngressRequests: z.number().int().nonnegative(),
      canonicalClaims: z.number().int().nonnegative(),
      genesisClaims: z.number().int().nonnegative(),
      finalProviderReadback: z.literal(true),
    }),
    secretValuesRecorded: z.literal(false),
  })
  .superRefine((evidence, context) => {
    if (evidence.stageCReleaseId === evidence.targetReleaseId)
      context.addIssue({
        code: "custom",
        message: "Release delta must target a newer commit",
        path: ["targetReleaseId"],
      });
    if (Date.parse(evidence.endedAt) < Date.parse(evidence.startedAt))
      context.addIssue({
        code: "custom",
        message: "Release-delta timestamps are not monotonic",
        path: ["endedAt"],
      });
    if (Date.parse(evidence.metrics.measuredAt) < Date.parse(evidence.endedAt))
      context.addIssue({
        code: "custom",
        message: "Provider readback predates release-delta completion",
        path: ["metrics", "measuredAt"],
      });

    const workloadIds = evidence.changedWorkloads.map(resourceId);
    if (!unique(workloadIds))
      context.addIssue({
        code: "custom",
        message: "Changed workloads contain duplicates",
        path: ["changedWorkloads"],
      });
    const restartIds = evidence.changedServiceRestarts.map(resourceId);
    if (!unique(restartIds))
      context.addIssue({
        code: "custom",
        message: "Restart observations contain duplicates",
        path: ["changedServiceRestarts"],
      });
    const persistentServiceIds = evidence.changedWorkloads
      .filter(({ kind }) => kind !== "Job")
      .map(resourceId)
      .sort();
    if (
      JSON.stringify([...restartIds].sort()) !==
      JSON.stringify(persistentServiceIds)
    )
      context.addIssue({
        code: "custom",
        message:
          "Restart observations must cover every changed persistent service",
        path: ["changedServiceRestarts"],
      });
  });

export type PrivateReleaseDeltaEvidence = z.infer<
  typeof PrivateReleaseDeltaEvidenceSchema
>;

const DeploymentMapSchema = z.object({
  workloads: z
    .array(
      z.object({
        kind: WorkloadKindSchema,
        name: WorkloadNameSchema,
        imageName: WorkloadNameSchema,
        trustDomain: TrustDomainSchema,
      }),
    )
    .min(1)
    .max(13),
});

export function assessPrivateReleaseDelta(
  policyInput: unknown,
  deploymentMapInput: unknown,
  stageCEvidenceInput: unknown,
  deltaEvidenceInput: unknown,
) {
  const policy = PersistentSoakPolicySchema.parse(policyInput);
  const deploymentMap = DeploymentMapSchema.parse(deploymentMapInput);
  const stageCEvidence =
    PersistentSoakEvidenceSchema.parse(stageCEvidenceInput);
  const evidence = PrivateReleaseDeltaEvidenceSchema.parse(deltaEvidenceInput);
  const stageCAssessment = assessPersistentSoak(policy, stageCEvidence);
  const blockers: string[] = [];

  if (stageCAssessment.status !== "PASS")
    blockers.push("Stage C acceptance evidence does not pass");
  if (stageCEvidence.releaseId !== evidence.stageCReleaseId)
    blockers.push(
      "release delta does not reference the accepted Stage C release",
    );
  const declaredWorkloads = new Map(
    deploymentMap.workloads.map((workload) => [resourceId(workload), workload]),
  );
  for (const workload of evidence.changedWorkloads) {
    const declared = declaredWorkloads.get(resourceId(workload));
    if (
      declared === undefined ||
      declared.imageName !== workload.imageName ||
      declared.trustDomain !== workload.trustDomain
    )
      blockers.push(
        `changed workload is outside the approved deployment map: ${resourceId(workload)}`,
      );
  }
  for (const [check, passed] of Object.entries(evidence.checks))
    if (!passed)
      blockers.push(`required release-delta check did not pass: ${check}`);
  for (const restart of evidence.changedServiceRestarts)
    if (!restart.passed)
      blockers.push(
        `changed service did not recover after restart: ${resourceId(restart)}`,
      );
  for (const [incident, count] of Object.entries(evidence.incidents))
    if (count !== 0)
      blockers.push(`release delta recorded ${incident}: ${count}`);
  if (
    evidence.metrics.projectedMonthlyCostUsd >
    policy.thresholds.maximumProjectedMonthlyCostUsd
  )
    blockers.push("projected monthly cost exceeded threshold");
  if (
    evidence.metrics.observedDeltaCostUsd >
    policy.thresholds.maximumProjectedMonthlyCostUsd
  )
    blockers.push("observed release-delta cost exceeded threshold");
  if (
    evidence.metrics.blaxelBalanceUsd <
    policy.thresholds.minimumBlaxelBalanceUsd
  )
    blockers.push("Blaxel balance fell below the approved floor");
  if (evidence.metrics.automaticTopUp)
    blockers.push("automatic top-up must remain off");
  if (evidence.metrics.publicIngressRequests !== 0)
    blockers.push("private release delta received public ingress");
  if (evidence.metrics.canonicalClaims !== 0)
    blockers.push("private release delta emitted canonical claims");
  if (evidence.metrics.genesisClaims !== 0)
    blockers.push("private release delta emitted Genesis claims");

  const uniqueBlockers = [...new Set(blockers)];
  const result = {
    status: uniqueBlockers.length === 0 ? ("PASS" as const) : ("FAIL" as const),
    stage: evidence.stage,
    stageCReleaseId: evidence.stageCReleaseId,
    stageCResultDigest: stageCAssessment.resultDigest,
    targetReleaseId: evidence.targetReleaseId,
    changedWorkloadCount: evidence.changedWorkloads.length,
    publicExposure: evidence.publicExposure,
    blockers: uniqueBlockers,
  };
  return { ...result, resultDigest: sha256Commitment(result) };
}
