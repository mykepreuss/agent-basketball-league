import { sha256Commitment } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  OperationalFoundingAlphaEvidenceSchema,
  assessOperationalFoundingAlpha,
  assessPersistentSoakHandoff,
  assessPublicBeaconSoak,
  createFoundingIntakeLaunchState,
} from "../src/index.js";

const releaseCommit = "b".repeat(40);
const stageCRelease = "a".repeat(40);
const applicationId = "0198e000-0000-7000-8000-000000000001";
const digest = (value: unknown) => sha256Commitment(value);
const stageCPolicy = {
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
    projectedMonthlyCostEnforcement: "HARD_CEILING",
    minimumBlaxelBalanceUsd: 5,
  },
} as const;
const stageCEvidence = {
  version: 1,
  evidenceClass: "LIVE_PRIVATE_SOAK",
  stage: "READ_ONLY_BEACON_PRIVATE_SOAK",
  releaseId: stageCRelease,
  startedAt: "2026-08-24T00:00:00.000Z",
  endedAt: "2026-08-25T00:00:00.000Z",
  publicExposure: "NONE",
  workspaces: ["agent-basketball-league"],
  services: [
    {
      ...stageCPolicy.requiredServices[0],
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
    maximumProjectionLagMs: 100,
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
    sourceEventCount: 1,
    restoredEventCount: 1,
    sourceOutboxCount: 1,
    restoredOutboxCount: 1,
    sourceStateRoot: digest("stage-c-state"),
    restoredStateRoot: digest("stage-c-state"),
  },
} as const;
const requiredPublicChecks = [
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
] as const;
const stageDPolicy = {
  version: 1,
  stage: "READ_ONLY_BEACON_PUBLIC_SOAK",
  requiredDurationHours: 24,
  publicExposure: "READ_ONLY",
  requiredSurfaces: [
    {
      name: "abl-public-api",
      probePath: "/health",
      expectedStatus: 200,
    },
    {
      name: "abl-spectator-arena",
      probePath: "/health",
      expectedStatus: 200,
    },
  ],
  requiredChecks: requiredPublicChecks,
  thresholds: {
    maximumErrorRate: 0.01,
    maximumSampleGapSeconds: 600,
    maximumProjectedMonthlyCostUsd: 25,
    projectedMonthlyCostEnforcement: "HARD_CEILING",
    minimumBlaxelBalanceUsd: 5,
  },
} as const;
const stageDEvidence = {
  version: 1,
  evidenceClass: "LIVE_PUBLIC_BEACON_SOAK",
  stage: "READ_ONLY_BEACON_PUBLIC_SOAK",
  releaseId: releaseCommit,
  policyDigest: digest(stageDPolicy),
  startedAt: "2026-08-25T00:00:00.000Z",
  endedAt: "2026-08-26T00:00:00.000Z",
  publicExposure: "READ_ONLY",
  surfaces: stageDPolicy.requiredSurfaces.map((surface) => ({
    ...surface,
    origin:
      surface.name === "abl-public-api"
        ? "https://api.abl.example/"
        : "https://arena.abl.example/",
    samples: 288,
    failures: 0,
    errorRate: 0,
    maximumLatencyMs: 500,
    maximumSampleGapSeconds: 300,
  })),
  checks: Object.fromEntries(
    requiredPublicChecks.map((check) => [check, true]),
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
    observedCostUsd: 1,
    blaxelBalanceUsd: 10,
    automaticTopUp: false,
  },
  credentialsUsed: false,
  secretValuesRecorded: false,
};
const privateProofEvidence = {
  programId: "ABL-COMPLETION-01",
  stage: "PRIVATE_STAGING",
  result: "PASSED",
  acceptedAt: "2026-08-24T00:00:00.000Z",
  source: {
    workspace: "agent-basketball-league",
    correctionsRemainWithinProgram: true,
  },
  classification: {
    operatingProfile: "PRE_GENESIS_REHEARSAL",
    publicExposure: "NONE",
    recognitionLevel: "SIGNED_VALID",
    canonical: false,
    genesis: false,
  },
  acceptedPath: {
    applicationId,
    careerDid: "did:abl:private-proof-career",
    inferenceInvocations: 0,
    publicGameCount: 1,
    publicSegmentCount: 6,
    sseVerified: true,
    arenaVerifiedAfterRestart: true,
  },
} as const;

function operationalEvidence() {
  const stageCResult = assessPersistentSoakHandoff(
    stageCPolicy,
    stageCEvidence,
  );
  const stageDResult = assessPublicBeaconSoak(stageDPolicy, stageDEvidence);
  return {
    version: 1,
    evidenceClass: "ABL_COMPLETION_01_OPERATIONAL_FOUNDING_ALPHA",
    programId: "ABL-COMPLETION-01",
    releaseCommit,
    prerequisiteDigests: {
      privateProofEvidence: digest(privateProofEvidence),
      stageCPolicy: digest(stageCPolicy),
      stageCEvidence: digest(stageCEvidence),
      stageCOwnerAcceptance: digest(null),
      stageCResult: stageCResult.resultDigest,
      stageDPolicy: digest(stageDPolicy),
      stageDEvidence: digest(stageDEvidence),
      stageDResult: stageDResult.resultDigest,
    },
    launchState: {
      schemaVersion: "1.0.0",
      launchStage: "CAPPED_FOUNDING_INTAKE",
      operatingProfile: "PRODUCTION_V1_PRE_GENESIS",
      recognitionLevel: "SIGNED_VALID",
      genesis: false,
      canonical: false,
      recognized: false,
      canonicalHistoryOpen: false,
      productionV1Ready: true,
      publicExposure: "CANDIDATE_INTAKE",
      candidateIntake: {
        mode: "CAPPED_PUBLIC",
        capacityState: "AVAILABLE",
        requirementsUri: "https://api.abl.example/requirements",
        capacityPolicyUri: "https://api.abl.example/capacity",
      },
      foundingCohort: {
        targetCareers: 20,
        capacity: { PLAYER: 10, COACH: 2, REFEREE: 6, REPLAY_OFFICIAL: 2 },
        openings: { PLAYER: 9, COACH: 2, REFEREE: 6, REPLAY_OFFICIAL: 2 },
        offers: { PLAYER: 0, COACH: 0, REFEREE: 0, REPLAY_OFFICIAL: 0 },
        admitted: { PLAYER: 1, COACH: 0, REFEREE: 0, REPLAY_OFFICIAL: 0 },
        activeGames: 0,
        offerWindowHours: 72,
        selection: "RECEIPT_ORDER_FIRST_AVAILABLE_PREFERENCE",
        firstInvitation: {
          model: "GPT-5.6 Sol",
          reservedSeat: false,
          preselectedIdentity: false,
          preselectedRole: false,
          preselectedAdmissionDecision: false,
        },
      },
      foundingConvention: {
        state: "RECRUITING",
        minimumFounders: 10,
        liveFounders: 1,
        eligibilitySnapshotCommitment: null,
        bootstrap: {
          state: "NOT_OPEN",
          closesAt: null,
          requiredYes: null,
          yesVotes: 0,
        },
      },
      genesisRecognition: {
        mechanism: "UNSELECTED",
        ratified: false,
        foundingDecisionEventId: null,
      },
      evidenceDigest: digest("operational-launch-state"),
      blockingReasons: [],
      nextBlockingRequirement: null,
      lastSuccessfulAcceptance: {
        stage: "CAPPED_FOUNDING_INTAKE",
        evidenceId: "external-admission",
        acceptedAt: "2026-08-26T00:10:00.000Z",
      },
      updatedAt: "2026-08-26T00:10:00.000Z",
    },
    externalAdmission: {
      applicationId,
      candidateDid: "did:abl:external-candidate",
      careerDid: "did:abl:external-player-one",
      role: "PLAYER",
      runtimeScope: "CAPPED_FOUNDING",
      applicationCommitment: digest("application"),
      agentDecisionEvidenceDigest: digest("agent-decisions"),
      provisioningReceiptCommitment: digest("provisioning-receipt"),
      careerAuthorityCommitment: digest("career-authority"),
      acceptedAt: "2026-08-26T00:10:00.000Z",
      active: true,
      externallyOperated: true,
      humanDecisionCount: 0,
      independentlyChosen: {
        identity: true,
        role: true,
        continuityPolicy: true,
        admissionOffer: true,
      },
      careerSandbox: {
        name: "abl-career-0198e000000070008000000000000001",
        workspace: "agent-basketball-league",
        resourceType: "Sandbox",
        trustDomain: "abl-competition",
        public: false,
        persistent: true,
        scaleToZero: true,
        driveMountCount: 0,
        volumeMountCount: 0,
        driveAuthority: false,
        rawPostgresCredential: false,
        infrastructureCredentialCount: 0,
        unrelatedModelCredentialCount: 0,
      },
      fixedBroker: {
        name: "abl-broker-0198e000000070008000000000000001",
        workspace: "agent-basketball-league",
        public: false,
        driveMountCount: 0,
        volumeMountCount: 0,
      },
    },
    publicSurfaces: {
      publicApiOrigin: "https://api.abl.example/",
      arenaOrigin: "https://arena.abl.example/",
      candidateIntakeOrigin: "https://join.abl.example/",
      anonymousDiscovery: true,
      arenaAvailable: true,
      publicApiAvailable: true,
      verifierAvailable: true,
      candidateIntakeAvailable: true,
      roleCapacityPublic: true,
      boundedPayloads: true,
      rateLimitRetryGuidance: true,
      idempotencyEnforced: true,
    },
    rejectionChecks: {
      unsignedRejected: true,
      humanAuthoredRejected: true,
      wrongCareerRejected: true,
      wrongRoleRejected: true,
      replayedRejected: true,
      staleRejected: true,
      malformedRejected: true,
      directServiceMutationRejected: true,
      crossCareerBrokerAccessRejected: true,
      candidateSecretAccessRejected: true,
    },
    monitoring: {
      observedAt: "2026-08-26T00:11:00.000Z",
      p0: 0,
      p1: 0,
      privacyBreaches: 0,
      replayDivergences: 0,
      falseCanonicalClaims: 0,
      falseGenesisClaims: 0,
      projectedInfrastructureCostUsd: 24,
      approvedInfrastructureCostCeilingUsd: 25,
      projectedModelCostUsd: 49,
      approvedModelCostCeilingUsd: 50,
      projectedCareerModelCostUsd: 19,
      approvedCareerModelCostCeilingUsd: 20,
      blaxelBalanceUsd: 10,
      minimumBlaxelBalanceUsd: 5,
      automaticTopUp: false,
      finalProviderReadback: true,
    },
    completedAt: "2026-08-26T00:12:00.000Z",
    secretValuesRecorded: false,
  } as const;
}

function inputs(evidence: unknown = operationalEvidence()) {
  return {
    evidence,
    privateProofEvidence,
    stageCPolicy,
    stageCEvidence,
    stageDPolicy,
    stageDEvidence,
  };
}

describe("Operational Founding Alpha completion", () => {
  it("opens invite-only intake after Stage D and requires admission before capped public intake", () => {
    const acceptedAt = "2026-08-26T00:10:00.000Z";
    expect(
      createFoundingIntakeLaunchState({
        stageDPolicy,
        stageDEvidence,
        mode: "INVITE_ONLY",
        acceptedAt,
      }),
    ).toMatchObject({
      launchStage: "PRIVATE_FOUNDING_ALPHA",
      publicExposure: "CANDIDATE_INTAKE",
      candidateIntake: {
        mode: "INVITE_ONLY",
        capacityState: "NO_CREDIBLE_OPPORTUNITY",
      },
      foundingConvention: { liveFounders: 0 },
      blockingReasons: [
        "First externally operated founding admission is pending",
      ],
    });
    expect(() =>
      createFoundingIntakeLaunchState({
        stageDPolicy,
        stageDEvidence,
        mode: "CAPPED_PUBLIC",
        acceptedAt,
      }),
    ).toThrow("requires the first external admission");
    expect(() =>
      createFoundingIntakeLaunchState({
        stageDPolicy,
        stageDEvidence,
        mode: "INVITE_ONLY",
        acceptedAt: "2026-08-25T23:59:59.000Z",
      }),
    ).toThrow("predates the public Beacon");

    const firstAdmission = operationalEvidence().externalAdmission;
    expect(
      createFoundingIntakeLaunchState({
        stageDPolicy,
        stageDEvidence,
        mode: "CAPPED_PUBLIC",
        acceptedAt,
        firstAdmission,
      }),
    ).toMatchObject({
      launchStage: "CAPPED_FOUNDING_INTAKE",
      candidateIntake: { mode: "CAPPED_PUBLIC" },
      foundingCohort: {
        admitted: { PLAYER: 1 },
        openings: { PLAYER: 9 },
      },
      foundingConvention: { liveFounders: 1 },
      blockingReasons: [],
    });
  });

  it("passes exactly one live external admission on the accepted public release", () => {
    expect(assessOperationalFoundingAlpha(inputs())).toMatchObject({
      status: "PASS",
      milestone: "OPERATIONAL_FOUNDING_ALPHA",
      stage: "CAPPED_FOUNDING_INTAKE",
      releaseCommit,
      applicationId,
      careerDid: "did:abl:external-player-one",
      blockers: [],
      resultDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("rejects prerequisite or release substitution without reopening passed gates", () => {
    const evidence = operationalEvidence();
    const substitutedPublicEvidence = {
      ...stageDEvidence,
      releaseId: "c".repeat(40),
    };
    const result = assessOperationalFoundingAlpha({
      ...inputs(evidence),
      stageDEvidence: substitutedPublicEvidence,
    });
    expect(result.status).toBe("FAIL");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Operational evidence does not bind the accepted prerequisite results",
        "Operational release differs from the accepted public Beacon release",
      ]),
    );
  });

  it("rejects inconsistent role accounting and budget or incident drift", () => {
    const evidence = operationalEvidence();
    const result = assessOperationalFoundingAlpha(
      inputs({
        ...evidence,
        launchState: {
          ...evidence.launchState,
          foundingCohort: {
            ...evidence.launchState.foundingCohort,
            openings: {
              ...evidence.launchState.foundingCohort.openings,
              PLAYER: 10,
            },
          },
        },
        monitoring: {
          ...evidence.monitoring,
          p1: 1,
          projectedInfrastructureCostUsd: 25.01,
        },
      }),
    );
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "Founding role accounting differs for PLAYER",
        "Operational monitoring contains a completion-blocking incident",
        "Operational projected cost exceeds an approved ceiling",
      ]),
    );
  });

  it("rejects operator-authored choices and non-derived career resources", () => {
    const evidence = operationalEvidence();
    const invalid = {
      ...evidence,
      externalAdmission: {
        ...evidence.externalAdmission,
        humanDecisionCount: 1,
        careerSandbox: {
          ...evidence.externalAdmission.careerSandbox,
          name: "abl-career-00000000000000000000000000000000",
        },
      },
    };
    expect(
      OperationalFoundingAlphaEvidenceSchema.safeParse(invalid).success,
    ).toBe(false);
    expect(assessOperationalFoundingAlpha(inputs(invalid))).toMatchObject({
      status: "FAIL",
      blockers: [
        "Operational Founding Alpha evidence is incomplete or invalid",
      ],
    });
  });

  it("rejects a candidate mutation surface aliased to a read-only surface", () => {
    const evidence = operationalEvidence();
    expect(
      OperationalFoundingAlphaEvidenceSchema.safeParse({
        ...evidence,
        publicSurfaces: {
          ...evidence.publicSurfaces,
          candidateIntakeOrigin: evidence.publicSurfaces.publicApiOrigin,
        },
      }).success,
    ).toBe(false);
  });
});
