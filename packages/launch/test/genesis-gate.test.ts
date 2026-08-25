import { sha256Commitment } from "@abl/recognition";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";

import { assessGenesisStartupEvidence } from "../src/index.js";

const at = "2026-08-19T12:00:00.000Z";
const hash = (character: string) => `0x${character.repeat(64)}`;
const signature = (character: string) => `0x${character.repeat(130)}`;

function evidence() {
  const sourceDigest = hash("1");
  const imageDigest = hash("2");
  const schemaDigest = hash("3");
  const migrationDigest = hash("4");
  const recognitionDecisionEventId = uuidv7();
  const genesisReleaseDecisionEventId = uuidv7();
  const authorizationSignatures = [
    signature("1"),
    signature("2"),
    signature("3"),
    signature("4"),
    signature("5"),
    signature("6"),
    signature("7"),
  ];
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
    testResultDigest: hash("8"),
    applicableLawEventIds: [uuidv7()],
    ratificationEventIds: [
      recognitionDecisionEventId,
      genesisReleaseDecisionEventId,
    ],
    compatibilityDeclaration: "Founding release.",
    rollbackDeclaration:
      "Stop before Genesis; use a ratified successor after it.",
    publicVerifierResultDigest: hash("9"),
    effectiveAt: at,
    expiresAt: null,
    authorizationSignatures,
  };
  const releaseDigest = sha256Commitment(releaseManifest);
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
  const proof = (id: string, character: string) => ({
    evidenceId: id,
    digest: hash(character),
    passed: true,
    verifiedAt: at,
  });
  const genesisReleaseAuthorizationBody = {
    releaseManifestDigest: releaseDigest,
    foundingDecisionEventId: genesisReleaseDecisionEventId,
    decisionCommitment: hash("f"),
    eligible: 10,
    requiredYes: 7,
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
      sandboxIsolation: proof("sandbox-isolation", "1"),
      storageRecovery: proof("storage-recovery", "2"),
      databaseRecovery: proof("database-recovery", "3"),
      publicBoundary: proof("public-boundary", "4"),
      capacity: proof("capacity", "5"),
    },
    recognitionProfile,
    ratifiedAnchor: {
      foundingDecisionEventId: recognitionProfile.foundingDecisionEventId,
      decisionCommitment: recognitionProfile.decisionCommitment,
      ...commitments,
      ratificationSignatures: [
        signature("5"),
        signature("6"),
        signature("7"),
        signature("8"),
      ],
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
});
