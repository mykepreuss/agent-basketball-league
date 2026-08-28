import { FOUNDING_DECISIONS } from "@abl/genesis";
import { sha256Commitment } from "@abl/recognition";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";

import {
  assessGenesisStartupEvidence,
  foundingExhibitionPublicDeliveryResultDigest,
  foundingExhibitionReplayResultDigest,
  genesisPrerequisiteEvidenceDigest,
} from "../src/index.js";

const at = "2026-08-19T12:00:00.000Z";
const hash = (character: string): `0x${string}` => `0x${character.repeat(64)}`;
const signature = (index: number): `0x${string}` =>
  `0x${index.toString(16).padStart(130, "0")}`;

function evidence() {
  const sourceDigest = hash("1");
  const imageDigest = hash("2");
  const schemaDigest = hash("3");
  const migrationDigest = hash("4");
  const recognitionDecisionEventId = uuidv7();
  const genesisReleaseDecisionEventId = uuidv7();
  const authorizationSignatures = Array.from({ length: 8 }, (_, index) =>
    signature(index + 1),
  );
  const proof = (id: string, character: string) => ({
    evidenceId: id,
    digest: hash(character),
    passed: true as const,
    verifiedAt: at,
  });
  const roles = {
    players: Array.from(
      { length: 10 },
      (_, index) =>
        `did:abl:founding-player-${String(index + 1).padStart(2, "0")}`,
    ),
    coaches: Array.from(
      { length: 2 },
      (_, index) =>
        `did:abl:founding-coach-${String(index + 1).padStart(2, "0")}`,
    ),
    referees: Array.from(
      { length: 6 },
      (_, index) =>
        `did:abl:founding-referee-${String(index + 1).padStart(2, "0")}`,
    ),
    replayOfficials: Array.from(
      { length: 2 },
      (_, index) =>
        `did:abl:founding-replay-${String(index + 1).padStart(2, "0")}`,
    ),
  };
  const cohortBody = {
    targetCareers: 20 as const,
    activeCareers: 20 as const,
    independentFounderCount: 12 as const,
    roles,
    eligibleFounderDids: [...roles.players, ...roles.coaches].sort(),
    roleAuthority: {
      playersAndCoaches: "INDEPENDENT_FOUNDERS_AND_ELECTORS" as const,
      refereesAndReplayOfficials:
        "LEAGUE_OPERATED_NONVOTING_OPERATIONAL_CAREERS" as const,
    },
    careerRegistryStateRoot: hash("a"),
    eligibilitySnapshotCommitment: hash("b"),
    verifiedAt: at,
  };
  const foundingCohort = {
    ...cohortBody,
    cohortCommitment: sha256Commitment(cohortBody),
  };
  const decisionRoots = {
    players: hash("1"),
    coaches: hash("2"),
    referees: hash("3"),
    replayOfficials: hash("4"),
  };
  const agentEvidenceBody = {
    gameId: uuidv7(),
    possessionCount: 128,
    decisionCounts: {
      players: 2_560,
      coaches: 512,
      referees: 384,
      replayOfficials: 256,
    },
    decisionRoots,
    authorityEvidence: {
      participants: structuredClone(roles),
      decisionRoots,
    },
    possessionProofRoot: hash("5"),
    gameProofCommitment: hash("6"),
  };
  const agentEvidence = {
    ...agentEvidenceBody,
    evidenceCommitment: sha256Commitment(agentEvidenceBody),
  };
  const finalizedPayloadDigest = hash("7");
  const finalStateRoot = hash("8");
  const eventMerkleRoot = hash("9");
  const foundingExhibition = {
    classification: "PRE_GENESIS_EXPERIMENT" as const,
    canonical: false as const,
    recognitionLevel: "SIGNED_VALID" as const,
    finalizedPayloadDigest,
    finalStateRoot,
    eventMerkleRoot,
    agentEvidence,
    humanDecisionCount: 0 as const,
    participantInferenceInvocations: 64,
    ablHostedParticipantModelInvocations: 0 as const,
    ablHostedOfficialModelInvocations: 128,
    exactReplayInferenceInvocations: 0 as const,
  };
  const foundingExhibitionProof = {
    ...foundingExhibition,
    exactReplay: {
      evidenceId: "founding-exhibition-exact-replay",
      digest: foundingExhibitionReplayResultDigest(foundingExhibition),
      passed: true as const,
      verifiedAt: at,
    },
    publicDelivery: {
      evidenceId: "founding-exhibition-public-delivery",
      digest: foundingExhibitionPublicDeliveryResultDigest(foundingExhibition),
      passed: true as const,
      verifiedAt: at,
    },
  };
  const liveProofs = {
    exactRuntime: proof("exact-runtime", "0"),
    sandboxIsolation: proof("sandbox-isolation", "1"),
    storageRecovery: proof("storage-recovery", "2"),
    databaseRecovery: proof("database-recovery", "3"),
    publicBoundary: proof("public-boundary", "4"),
    cleanPublicVerification: proof("clean-public-verification", "5"),
    monitoring: proof("monitoring", "6"),
    capacity: proof("capacity", "7"),
  };
  const eventIds = new Map(
    FOUNDING_DECISIONS.map((topic) => [
      topic,
      topic === "RECOGNITION_PROFILE"
        ? recognitionDecisionEventId
        : topic === "GENESIS_RELEASE"
          ? genesisReleaseDecisionEventId
          : uuidv7(),
    ]),
  );
  const foundingDecisions = FOUNDING_DECISIONS.map((topic, index) => ({
    topic,
    state: "DECIDED" as const,
    disposition: "RATIFY" as const,
    eligible: 12,
    requiredYes: 8,
    yes: 8,
    eligibilitySnapshotCommitment: foundingCohort.eligibilitySnapshotCommitment,
    artifactDigest: sha256Commitment({ topic, artifact: index }),
    recognitionMechanism:
      topic === "RECOGNITION_PROFILE" ? ("SIGNED_WITNESSES" as const) : null,
    releaseManifestDigest: topic === "GENESIS_RELEASE" ? hash("0") : null,
    decisionCommitment:
      topic === "RECOGNITION_PROFILE"
        ? hash("8")
        : topic === "GENESIS_RELEASE"
          ? hash("f")
          : sha256Commitment({ topic, decision: index }),
    ratificationEventId: eventIds.get(topic)!,
    authorizationSignatures,
    directBallotsOnly: true as const,
    humanVotingAllowed: false as const,
    publicProjection: {
      evidenceId: `founding-decision-${topic.toLowerCase()}`,
      digest: sha256Commitment({ topic, projection: index }),
      passed: true as const,
      verifiedAt: at,
    },
  }));
  const fundingBody = {
    humanSpendApprovalDigest: hash("c"),
    resourceScheduleDecisionEventId: eventIds.get("RESOURCE_SCHEDULE")!,
    operating: {
      purpose: "SEASON_ZERO_OPERATION" as const,
      currency: "USD" as const,
      coverageStartsAt: at,
      coverageEndsAt: "2026-09-18T12:00:00.000Z",
      requiredAmountCents: 7_500,
      prepaidAmountCents: 7_500,
      prepaidAt: "2026-08-18T12:00:00.000Z",
      providerReceiptDigest: hash("d"),
    },
    windDown: {
      purpose: "WIND_DOWN_RESERVE" as const,
      restrictedToWindDown: true as const,
      currency: "USD" as const,
      coverageStartsAt: at,
      coverageEndsAt: "2026-09-18T12:00:00.000Z",
      requiredAmountCents: 7_500,
      prepaidAmountCents: 7_500,
      prepaidAt: "2026-08-18T12:00:00.000Z",
      providerReceiptDigest: hash("e"),
    },
    verifiedAt: at,
  };
  const funding = {
    ...fundingBody,
    fundingCommitment: sha256Commitment(fundingBody),
  };
  const testResultDigest = genesisPrerequisiteEvidenceDigest({
    liveProofs,
    foundingCohort,
    foundingExhibition: foundingExhibitionProof,
    foundingDecisions,
    funding,
  });
  const releaseManifest = {
    releaseId: uuidv7(),
    version: 1,
    releaseClass: "IDENTITY_CONSTITUTIONAL",
    changeClasses: ["IDENTITY", "RECOGNITION", "VERIFIER"],
    sourceDigest,
    containerDigests: [hash("5")],
    imageDigests: [imageDigest],
    kernelDigest: hash("6"),
    toolDigest: hash("7"),
    schemaDigest,
    migrationDigest,
    testResultDigest,
    applicableLawEventIds: foundingDecisions.map(
      ({ ratificationEventId }) => ratificationEventId,
    ),
    ratificationEventIds: foundingDecisions.map(
      ({ ratificationEventId }) => ratificationEventId,
    ),
    compatibilityDeclaration: "Founding release.",
    rollbackDeclaration:
      "Stop before Genesis; use a ratified successor after it.",
    publicVerifierResultDigest: hash("9"),
    effectiveAt: at,
    expiresAt: null,
    authorizationSignatures,
  };
  const releaseDigest = sha256Commitment(releaseManifest);
  foundingDecisions.find(
    ({ topic }) => topic === "GENESIS_RELEASE",
  )!.releaseManifestDigest = releaseDigest;
  const witnessRegistryDigest = hash("c");
  const recognitionProfileBody = {
    schemaVersion: "1.0.0",
    profileId: uuidv7(),
    mechanism: "SIGNED_WITNESSES",
    decisionSource: "FOUNDING_AGENT_DECISION",
    foundingDecisionEventId: recognitionDecisionEventId,
    sourceReleaseDigest: sourceDigest,
    releaseManifestDigest: releaseDigest,
    verifierDigest: hash("b"),
    keyRotationPolicyDigest: hash("6"),
    finalityPolicyDigest: hash("7"),
    decisionCommitment: hash("8"),
    witnessRegistryDigest,
    minimumWitnesses: 2,
    selectedAt: at,
    ratified: true,
    productionProfilePassed: true,
  };
  const recognitionProfile = {
    ...recognitionProfileBody,
    profileCommitment: sha256Commitment(recognitionProfileBody),
  };
  const networkProfileDigest = sha256Commitment(recognitionProfile);
  const commitments = {
    constitutionDigest: hash("a"),
    verifierDigest: hash("b"),
    recognitionRegistryDigest: witnessRegistryDigest,
    institutionalKeyRegistryDigest: hash("d"),
    schemaDigest,
    migrationDigest,
    releaseDigest,
    networkProfileDigest,
  };
  const genesisReleaseAuthorizationBody = {
    releaseManifestDigest: releaseDigest,
    foundingDecisionEventId: genesisReleaseDecisionEventId,
    decisionCommitment: hash("f"),
    eligible: 12,
    requiredYes: 8,
    authorizedAt: at,
    authorizationSignatures,
  };
  return {
    databaseProfile: {
      profileVersion: 1,
      provider: "founding-approved-postgres",
      engine: "POSTGRESQL",
      region: "private-region",
      connection: {
        tlsRequired: true,
        publicInternetAllowed: false,
        sourceRestricted: true,
        applicationCredentialsLeastPrivilege: true,
        credentialRotationSupported: true,
      },
      transactions: {
        serializable: true,
        advisoryLocks: true,
        atomicOutbox: true,
      },
      recovery: {
        continuousBackup: true,
        pointInTimeRecovery: true,
        restoreWindowDays: 30,
        maxRpoSeconds: 300,
        maxRtoSeconds: 3_600,
        cleanRoomRestoreVerifiedAt: at,
        replayRootsMatched: true,
      },
      durability: {
        multiZone: true,
        encryptedAtRest: true,
        independentBackupCopy: true,
      },
    },
    releaseManifest,
    deployedArtifacts: {
      sourceDigest,
      imageDigest,
      schemaDigest,
      migrationDigest,
    },
    liveProofs: {
      ...liveProofs,
    },
    foundingCohort,
    foundingExhibition: foundingExhibitionProof,
    foundingDecisions,
    funding,
    recognitionProfile,
    ratifiedAnchor: {
      foundingDecisionEventId: recognitionProfile.foundingDecisionEventId,
      decisionCommitment: recognitionProfile.decisionCommitment,
      ...commitments,
      ratificationSignatures: authorizationSignatures,
    },
    genesisReleaseAuthorization: {
      ...genesisReleaseAuthorizationBody,
      authorizationCommitment: sha256Commitment(
        genesisReleaseAuthorizationBody,
      ),
    },
    genesisCheckpoint: {
      proof: {
        mechanism: "SIGNED_WITNESSES",
        recognitionLevel: "INDEPENDENTLY_WITNESSED",
        manifestDigest: releaseDigest,
        root: commitments.constitutionDigest,
        witnessRegistryDigest,
        verifiedWitnessIds: ["witness-1", "witness-2"],
        verifierResultDigest: releaseManifest.publicVerifierResultDigest,
        finalizedAt: at,
      },
      ...commitments,
    },
  };
}

describe("PRODUCTION_GENESIS startup evidence", () => {
  it("activates only from a complete source-bound evidence bundle", () => {
    const assessment = assessGenesisStartupEvidence(evidence());
    expect(assessment.ready).toBe(true);
    expect(assessment.operatingProfile).toBe("PRODUCTION_GENESIS");
    expect(assessment.evidenceDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("keeps incomplete or configuration-only attempts pre-Genesis", () => {
    const candidate = evidence();
    candidate.recognitionProfile.minimumWitnesses = 3;
    const assessment = assessGenesisStartupEvidence(candidate);
    expect(assessment.ready).toBe(false);
    expect(assessment.operatingProfile).toBe("PRODUCTION_V1_PRE_GENESIS");
    expect(assessment.blockers).toContain(
      "Signed-witness Genesis proof does not satisfy the ratified profile",
    );
    expect(assessGenesisStartupEvidence({ enabled: true }).ready).toBe(false);
  });

  it("rejects unbound selection and commitment mismatches", () => {
    const candidate = evidence();
    candidate.recognitionProfile.foundingDecisionEventId = uuidv7();
    candidate.ratifiedAnchor.schemaDigest = hash("f");
    const assessment = assessGenesisStartupEvidence(candidate);
    expect(assessment.ready).toBe(false);
    expect(assessment.blockers).toContain(
      "Recognition profile lacks a ratified founding-agent decision",
    );
    expect(assessment.blockers).toContain(
      "Genesis checkpoint schema commitment mismatch",
    );
  });

  it("rejects tampered recognition and release authorizations", () => {
    const tamperedProfile = evidence();
    tamperedProfile.recognitionProfile.decisionCommitment = hash("e");
    expect(assessGenesisStartupEvidence(tamperedProfile).blockers).toContain(
      "Recognition profile commitment is invalid",
    );

    const tamperedRelease = evidence();
    tamperedRelease.genesisReleaseAuthorization.decisionCommitment = hash("e");
    const assessment = assessGenesisStartupEvidence(tamperedRelease);
    expect(assessment.ready).toBe(false);
    expect(assessment.blockers).toContain(
      "Founding decisions do not authorize the recognition profile and Genesis release",
    );
  });

  it("requires every adopted founding topic and the complete role cohort", () => {
    const missingDecision = evidence();
    missingDecision.foundingDecisions.pop();
    expect(assessGenesisStartupEvidence(missingDecision)).toMatchObject({
      ready: false,
      blockers: ["Genesis startup evidence is incomplete or invalid"],
    });

    const substitutedCareer = evidence();
    substitutedCareer.foundingExhibition.agentEvidence.authorityEvidence!.participants.players[0] =
      "did:abl:founding-player-00";
    const assessment = assessGenesisStartupEvidence(substitutedCareer);
    expect(assessment.ready).toBe(false);
    expect(assessment.blockers).toContain(
      "Founding exhibition does not use the complete twenty-career cohort",
    );
    expect(assessment.blockers).toContain(
      "Founding exhibition authority evidence is invalid",
    );
  });

  it("requires exact replay, public delivery, and two prepaid envelopes", () => {
    const invalidReplay = evidence();
    invalidReplay.foundingExhibition.exactReplay.digest = hash("f");
    expect(assessGenesisStartupEvidence(invalidReplay).blockers).toContain(
      "Founding exhibition exact-replay proof is invalid",
    );

    const underfunded = evidence();
    underfunded.funding.windDown.prepaidAmountCents = 100;
    const { fundingCommitment: _fundingCommitment, ...fundingBody } =
      underfunded.funding;
    underfunded.funding.fundingCommitment = sha256Commitment(fundingBody);
    const assessment = assessGenesisStartupEvidence(underfunded);
    expect(assessment.ready).toBe(false);
    expect(assessment.blockers).toContain(
      "Season Zero operation and wind-down reserve are not separately prepaid for thirty days",
    );
  });

  it("requires the release to bind the complete prerequisite bundle", () => {
    const candidate = evidence();
    candidate.releaseManifest.testResultDigest = hash("f");
    const assessment = assessGenesisStartupEvidence(candidate);
    expect(assessment.ready).toBe(false);
    expect(assessment.blockers).toContain(
      "Release manifest does not bind the complete Genesis prerequisites",
    );
  });
});
