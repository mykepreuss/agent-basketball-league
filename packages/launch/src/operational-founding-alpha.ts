import { sha256Commitment } from "@abl/recognition";
import {
  DEFAULT_FOUNDING_COHORT_STATE,
  LaunchStateSchema,
  SchemaVersion,
} from "@abl/schemas";
import { z } from "zod";

import { assessPersistentSoak } from "./persistent-soak.js";
import {
  PublicBeaconSoakEvidenceSchema,
  assessPublicBeaconSoak,
} from "./public-beacon.js";

const DigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const DidSchema = z.string().startsWith("did:").max(500);
const FoundingRoleSchema = z.enum([
  "PLAYER",
  "COACH",
  "REFEREE",
  "REPLAY_OFFICIAL",
]);
const FoundingRoleCountsSchema = z.strictObject({
  PLAYER: z.number().int().nonnegative().max(10),
  COACH: z.number().int().nonnegative().max(2),
  REFEREE: z.number().int().nonnegative().max(6),
  REPLAY_OFFICIAL: z.number().int().nonnegative().max(2),
});
const CredentialFreeOriginSchema = z.url().superRefine((input, context) => {
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
      message: "Public endpoint must be a credential-free HTTPS origin",
    });
});

const PrivateProofSchema = z
  .object({
    programId: z.literal("ABL-COMPLETION-01"),
    stage: z.literal("PRIVATE_STAGING"),
    result: z.literal("PASSED"),
    acceptedAt: z.iso.datetime({ offset: true }),
    source: z
      .object({
        workspace: z.literal("agent-basketball-league"),
        correctionsRemainWithinProgram: z.literal(true),
      })
      .passthrough(),
    classification: z
      .object({
        operatingProfile: z.literal("PRE_GENESIS_REHEARSAL"),
        publicExposure: z.literal("NONE"),
        recognitionLevel: z.literal("SIGNED_VALID"),
        canonical: z.literal(false),
        genesis: z.literal(false),
      })
      .passthrough(),
    acceptedPath: z
      .object({
        applicationId: z.string().uuid(),
        careerDid: DidSchema,
        inferenceInvocations: z.literal(0),
        publicGameCount: z.number().int().positive(),
        publicSegmentCount: z.number().int().positive(),
        sseVerified: z.literal(true),
        arenaVerifiedAfterRestart: z.literal(true),
      })
      .passthrough(),
  })
  .passthrough();

const ExternalAdmissionSchema = z
  .strictObject({
    applicationId: z.string().uuid(),
    candidateDid: DidSchema,
    careerDid: DidSchema,
    role: FoundingRoleSchema,
    runtimeScope: z.literal("CAPPED_FOUNDING"),
    applicationCommitment: DigestSchema,
    agentDecisionEvidenceDigest: DigestSchema,
    provisioningReceiptCommitment: DigestSchema,
    careerAuthorityCommitment: DigestSchema,
    acceptedAt: z.iso.datetime({ offset: true }),
    active: z.literal(true),
    externallyOperated: z.literal(true),
    humanDecisionCount: z.literal(0),
    independentlyChosen: z.strictObject({
      identity: z.literal(true),
      role: z.literal(true),
      continuityPolicy: z.literal(true),
      admissionOffer: z.literal(true),
    }),
    careerSandbox: z.strictObject({
      name: z.string().regex(/^abl-career-[0-9a-f]{32}$/),
      workspace: z.literal("agent-basketball-league"),
      resourceType: z.literal("Sandbox"),
      trustDomain: z.literal("abl-competition"),
      public: z.literal(false),
      persistent: z.literal(true),
      scaleToZero: z.literal(true),
      driveMountCount: z.literal(0),
      volumeMountCount: z.literal(0),
      driveAuthority: z.literal(false),
      rawPostgresCredential: z.literal(false),
      infrastructureCredentialCount: z.literal(0),
      unrelatedModelCredentialCount: z.literal(0),
    }),
    fixedBroker: z.strictObject({
      name: z.string().regex(/^abl-broker-[0-9a-f]{32}$/),
      workspace: z.literal("agent-basketball-league"),
      public: z.literal(false),
      driveMountCount: z.literal(0),
      volumeMountCount: z.literal(0),
    }),
  })
  .superRefine((admission, context) => {
    const applicationSuffix = admission.applicationId.replaceAll("-", "");
    if (admission.careerSandbox.name !== `abl-career-${applicationSuffix}`)
      context.addIssue({
        code: "custom",
        path: ["careerSandbox", "name"],
        message: "Career Sandbox name is not application-derived",
      });
    if (admission.fixedBroker.name !== `abl-broker-${applicationSuffix}`)
      context.addIssue({
        code: "custom",
        path: ["fixedBroker", "name"],
        message: "Fixed broker name is not application-derived",
      });
  });

const PrerequisiteDigestsSchema = z.strictObject({
  privateProofEvidence: DigestSchema,
  stageCPolicy: DigestSchema,
  stageCEvidence: DigestSchema,
  stageCResult: DigestSchema,
  stageDPolicy: DigestSchema,
  stageDEvidence: DigestSchema,
  stageDResult: DigestSchema,
});

export const OperationalFoundingAlphaEvidenceSchema = z
  .strictObject({
    version: z.literal(1),
    evidenceClass: z.literal("ABL_COMPLETION_01_OPERATIONAL_FOUNDING_ALPHA"),
    programId: z.literal("ABL-COMPLETION-01"),
    releaseCommit: GitCommitSchema,
    prerequisiteDigests: PrerequisiteDigestsSchema,
    launchState: LaunchStateSchema,
    externalAdmission: ExternalAdmissionSchema,
    publicSurfaces: z.strictObject({
      publicApiOrigin: CredentialFreeOriginSchema,
      arenaOrigin: CredentialFreeOriginSchema,
      candidateIntakeOrigin: CredentialFreeOriginSchema,
      anonymousDiscovery: z.literal(true),
      arenaAvailable: z.literal(true),
      publicApiAvailable: z.literal(true),
      verifierAvailable: z.literal(true),
      candidateIntakeAvailable: z.literal(true),
      roleCapacityPublic: z.literal(true),
      boundedPayloads: z.literal(true),
      rateLimitRetryGuidance: z.literal(true),
      idempotencyEnforced: z.literal(true),
    }),
    rejectionChecks: z.strictObject({
      unsignedRejected: z.literal(true),
      humanAuthoredRejected: z.literal(true),
      wrongCareerRejected: z.literal(true),
      wrongRoleRejected: z.literal(true),
      replayedRejected: z.literal(true),
      staleRejected: z.literal(true),
      malformedRejected: z.literal(true),
      directServiceMutationRejected: z.literal(true),
      crossCareerBrokerAccessRejected: z.literal(true),
      candidateSecretAccessRejected: z.literal(true),
    }),
    monitoring: z.strictObject({
      observedAt: z.iso.datetime({ offset: true }),
      p0: z.number().int().nonnegative(),
      p1: z.number().int().nonnegative(),
      privacyBreaches: z.number().int().nonnegative(),
      replayDivergences: z.number().int().nonnegative(),
      falseCanonicalClaims: z.number().int().nonnegative(),
      falseGenesisClaims: z.number().int().nonnegative(),
      projectedInfrastructureCostUsd: z.number().nonnegative(),
      approvedInfrastructureCostCeilingUsd: z.literal(25),
      projectedModelCostUsd: z.number().nonnegative(),
      approvedModelCostCeilingUsd: z.literal(50),
      projectedCareerModelCostUsd: z.number().nonnegative(),
      approvedCareerModelCostCeilingUsd: z.literal(20),
      blaxelBalanceUsd: z.number().nonnegative(),
      minimumBlaxelBalanceUsd: z.literal(5),
      automaticTopUp: z.literal(false),
      finalProviderReadback: z.literal(true),
    }),
    completedAt: z.iso.datetime({ offset: true }),
    secretValuesRecorded: z.literal(false),
  })
  .superRefine((evidence, context) => {
    const completedAt = Date.parse(evidence.completedAt);
    if (
      completedAt < Date.parse(evidence.externalAdmission.acceptedAt) ||
      completedAt < Date.parse(evidence.monitoring.observedAt)
    )
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Operational completion predates its final live evidence",
      });
    const publicOrigins = [
      evidence.publicSurfaces.publicApiOrigin,
      evidence.publicSurfaces.arenaOrigin,
      evidence.publicSurfaces.candidateIntakeOrigin,
    ];
    if (new Set(publicOrigins).size !== publicOrigins.length)
      context.addIssue({
        code: "custom",
        path: ["publicSurfaces"],
        message: "Operational public surfaces must use distinct origins",
      });
  });

export type OperationalFoundingAlphaEvidence = z.infer<
  typeof OperationalFoundingAlphaEvidenceSchema
>;

export interface OperationalFoundingAlphaInputs {
  evidence: unknown;
  privateProofEvidence: unknown;
  stageCPolicy: unknown;
  stageCEvidence: unknown;
  stageDPolicy: unknown;
  stageDEvidence: unknown;
}

function failureResult(blockers: readonly string[]) {
  const result = {
    status: "FAIL" as const,
    milestone: "OPERATIONAL_FOUNDING_ALPHA" as const,
    stage: "CAPPED_FOUNDING_INTAKE" as const,
    programId: "ABL-COMPLETION-01" as const,
    releaseCommit: null,
    applicationId: null,
    careerDid: null,
    evidenceDigest: null,
    blockers: [...new Set(blockers)],
  };
  return { ...result, resultDigest: sha256Commitment(result) };
}

const foundingCapacity = {
  PLAYER: 10,
  COACH: 2,
  REFEREE: 6,
  REPLAY_OFFICIAL: 2,
} as const;

export function createFoundingIntakeLaunchState(input: {
  stageDPolicy: unknown;
  stageDEvidence: unknown;
  mode: "INVITE_ONLY" | "CAPPED_PUBLIC";
  acceptedAt: string;
  firstAdmission?: unknown;
}) {
  const evidence = PublicBeaconSoakEvidenceSchema.parse(input.stageDEvidence);
  const result = assessPublicBeaconSoak(input.stageDPolicy, evidence);
  if (result.status !== "PASS")
    throw new Error(
      `Stage D public Beacon has not passed: ${result.blockers.join(", ")}`,
    );
  const acceptedAt = z.iso.datetime({ offset: true }).parse(input.acceptedAt);
  if (Date.parse(acceptedAt) < Date.parse(evidence.endedAt))
    throw new Error("Founding intake activation predates the public Beacon");
  const capped = input.mode === "CAPPED_PUBLIC";
  const firstAdmission =
    input.firstAdmission === undefined
      ? null
      : ExternalAdmissionSchema.parse(input.firstAdmission);
  if (capped && firstAdmission === null)
    throw new Error(
      "Capped public intake requires the first external admission",
    );
  if (!capped && firstAdmission !== null)
    throw new Error(
      "Invite-only launch state cannot include an external admission",
    );
  if (
    firstAdmission !== null &&
    Date.parse(acceptedAt) < Date.parse(firstAdmission.acceptedAt)
  )
    throw new Error("Capped intake activation predates the first admission");
  let foundingCohort = DEFAULT_FOUNDING_COHORT_STATE;
  if (firstAdmission !== null)
    foundingCohort = {
      ...DEFAULT_FOUNDING_COHORT_STATE,
      admitted: {
        ...DEFAULT_FOUNDING_COHORT_STATE.admitted,
        [firstAdmission.role]: 1,
      },
      openings: {
        ...DEFAULT_FOUNDING_COHORT_STATE.openings,
        [firstAdmission.role]:
          DEFAULT_FOUNDING_COHORT_STATE.openings[firstAdmission.role] - 1,
      },
    };
  return LaunchStateSchema.parse({
    schemaVersion: SchemaVersion,
    launchStage: capped ? "CAPPED_FOUNDING_INTAKE" : "PRIVATE_FOUNDING_ALPHA",
    operatingProfile: "PRODUCTION_V1_PRE_GENESIS",
    recognitionLevel: "SIGNED_VALID",
    genesis: false,
    canonical: false,
    recognized: false,
    canonicalHistoryOpen: false,
    productionV1Ready: true,
    publicExposure: "CANDIDATE_INTAKE",
    candidateIntake: {
      mode: input.mode,
      capacityState: "NO_CREDIBLE_OPPORTUNITY",
      requirementsUri: "/v1/discovery/candidate-requirements",
      capacityPolicyUri: "/v1/discovery/capacity-policy",
    },
    foundingCohort,
    foundingConvention: {
      state: "RECRUITING",
      minimumFounders: 10,
      liveFounders: firstAdmission === null ? 0 : 1,
      eligibilitySnapshotCommitment: null,
      bootstrap: {
        state: "NOT_OPEN",
        closesAt: null,
        requiredYes: null,
        yesVotes: 0,
      },
    },
    evidenceDigest: sha256Commitment({
      stageDResultDigest: result.resultDigest,
      releaseId: evidence.releaseId,
      mode: input.mode,
      firstAdmission:
        firstAdmission === null ? null : sha256Commitment(firstAdmission),
    }),
    blockingReasons: capped
      ? []
      : ["First externally operated founding admission is pending"],
    nextBlockingRequirement: capped
      ? "Reach ten active founding careers and open the founding convention"
      : "Complete one independently chosen external admission",
    lastSuccessfulAcceptance: {
      stage: "READ_ONLY_BEACON",
      evidenceId: "ABL-COMPLETION-01-STAGE-D",
      acceptedAt,
    },
    updatedAt: acceptedAt,
  });
}

function sameRoleCounts(
  value: z.infer<typeof FoundingRoleCountsSchema>,
  expected: z.infer<typeof FoundingRoleCountsSchema>,
): boolean {
  return FoundingRoleSchema.options.every(
    (role) => value[role] === expected[role],
  );
}

export function assessOperationalFoundingAlpha(
  input: OperationalFoundingAlphaInputs,
) {
  const parsed = OperationalFoundingAlphaEvidenceSchema.safeParse(
    input.evidence,
  );
  if (!parsed.success)
    return failureResult([
      "Operational Founding Alpha evidence is incomplete or invalid",
    ]);

  const evidence = parsed.data;
  const blockers: string[] = [];
  const privateProof = PrivateProofSchema.safeParse(input.privateProofEvidence);
  if (!privateProof.success)
    blockers.push("Private integrated proof evidence does not pass");

  let stageCResult: ReturnType<typeof assessPersistentSoak> | null = null;
  try {
    stageCResult = assessPersistentSoak(
      input.stageCPolicy,
      input.stageCEvidence,
    );
    if (stageCResult.status !== "PASS")
      blockers.push("Stage C private soak evidence does not pass");
  } catch {
    blockers.push("Stage C private soak evidence is invalid");
  }

  let stageDResult: ReturnType<typeof assessPublicBeaconSoak> | null = null;
  try {
    stageDResult = assessPublicBeaconSoak(
      input.stageDPolicy,
      input.stageDEvidence,
    );
    if (stageDResult.status !== "PASS")
      blockers.push("Stage D public Beacon evidence does not pass");
  } catch {
    blockers.push("Stage D public Beacon evidence is invalid");
  }

  const prerequisiteDigests = {
    privateProofEvidence: sha256Commitment(input.privateProofEvidence),
    stageCPolicy: sha256Commitment(input.stageCPolicy),
    stageCEvidence: sha256Commitment(input.stageCEvidence),
    stageCResult:
      stageCResult?.resultDigest ?? sha256Commitment("invalid-stage-c-result"),
    stageDPolicy: sha256Commitment(input.stageDPolicy),
    stageDEvidence: sha256Commitment(input.stageDEvidence),
    stageDResult:
      stageDResult?.resultDigest ?? sha256Commitment("invalid-stage-d-result"),
  };
  if (
    sha256Commitment(prerequisiteDigests) !==
    sha256Commitment(evidence.prerequisiteDigests)
  )
    blockers.push(
      "Operational evidence does not bind the accepted prerequisite results",
    );

  if (
    stageDResult?.status === "PASS" &&
    stageDResult.releaseId !== evidence.releaseCommit
  )
    blockers.push(
      "Operational release differs from the accepted public Beacon release",
    );

  const launchState = evidence.launchState;
  if (
    launchState.launchStage !== "CAPPED_FOUNDING_INTAKE" ||
    launchState.operatingProfile !== "PRODUCTION_V1_PRE_GENESIS" ||
    launchState.recognitionLevel !== "SIGNED_VALID" ||
    launchState.genesis ||
    launchState.canonical ||
    launchState.recognized ||
    launchState.canonicalHistoryOpen ||
    !launchState.productionV1Ready ||
    launchState.publicExposure !== "CANDIDATE_INTAKE" ||
    launchState.blockingReasons.length !== 0
  )
    blockers.push(
      "Launch state is not an unblocked pre-Genesis Operational Founding Alpha",
    );
  if (
    launchState.candidateIntake.mode !== "CAPPED_PUBLIC" ||
    !["AVAILABLE", "QUEUEING"].includes(
      launchState.candidateIntake.capacityState,
    )
  )
    blockers.push("Capped founding intake is not open");

  const cohort = launchState.foundingCohort;
  if (!sameRoleCounts(cohort.capacity, foundingCapacity))
    blockers.push("Founding role capacity is not 10/2/6/2");
  for (const role of FoundingRoleSchema.options)
    if (
      cohort.openings[role] + cohort.offers[role] + cohort.admitted[role] !==
      cohort.capacity[role]
    )
      blockers.push(`Founding role accounting differs for ${role}`);
  const admittedCount = FoundingRoleSchema.options.reduce(
    (total, role) => total + cohort.admitted[role],
    0,
  );
  if (
    admittedCount < 1 ||
    cohort.admitted[evidence.externalAdmission.role] < 1 ||
    launchState.foundingConvention.liveFounders < 1 ||
    launchState.foundingConvention.liveFounders > admittedCount
  )
    blockers.push(
      "The external admitted career is not present in the live founding cohort",
    );

  const monitoring = evidence.monitoring;
  if (
    monitoring.p0 +
      monitoring.p1 +
      monitoring.privacyBreaches +
      monitoring.replayDivergences +
      monitoring.falseCanonicalClaims +
      monitoring.falseGenesisClaims !==
    0
  )
    blockers.push(
      "Operational monitoring contains a completion-blocking incident",
    );
  if (
    monitoring.projectedInfrastructureCostUsd >
      monitoring.approvedInfrastructureCostCeilingUsd ||
    monitoring.projectedModelCostUsd > monitoring.approvedModelCostCeilingUsd ||
    monitoring.projectedCareerModelCostUsd >
      monitoring.approvedCareerModelCostCeilingUsd
  )
    blockers.push("Operational projected cost exceeds an approved ceiling");
  if (monitoring.blaxelBalanceUsd < monitoring.minimumBlaxelBalanceUsd)
    blockers.push("Blaxel balance fell below the approved floor");

  const uniqueBlockers = [...new Set(blockers)];
  const result = {
    status: uniqueBlockers.length === 0 ? ("PASS" as const) : ("FAIL" as const),
    milestone: "OPERATIONAL_FOUNDING_ALPHA" as const,
    stage: "CAPPED_FOUNDING_INTAKE" as const,
    programId: evidence.programId,
    releaseCommit: evidence.releaseCommit,
    applicationId: evidence.externalAdmission.applicationId,
    careerDid: evidence.externalAdmission.careerDid,
    evidenceDigest: sha256Commitment(evidence),
    blockers: uniqueBlockers,
  };
  return { ...result, resultDigest: sha256Commitment(result) };
}
