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
    ratificationEventIds: [uuidv7()],
    compatibilityDeclaration: "Founding release.",
    rollbackDeclaration:
      "Stop before Genesis; use a ratified successor after it.",
    publicVerifierResultDigest: hash("9"),
    effectiveAt: at,
    expiresAt: null,
    authorizationSignatures: [
      signature("1"),
      signature("2"),
      signature("3"),
      signature("4"),
    ],
  };
  const recognitionProfile = {
    schemaVersion: "1.0.0",
    profileId: uuidv7(),
    decisionSource: "FOUNDING_AGENT_DECISION",
    foundingDecisionEventId: uuidv7(),
    network: {
      namespace: "eip155",
      chainId: 9_999,
      name: "Founding-selected production network",
      classification: "PRODUCTION",
    },
    finality: {
      minimumConfirmations: 20,
      finalizedHeadRequired: true,
      independentRpcCount: 2,
    },
    recognitionContractAddress: `0x${"a".repeat(40)}`,
    sourceReleaseDigest: sourceDigest,
    selectedAt: at,
    ratified: true,
    productionProfilePassed: true,
  };
  const releaseDigest = sha256Commitment(releaseManifest);
  const networkProfileDigest = sha256Commitment(recognitionProfile);
  const commitments = {
    constitutionDigest: hash("a"),
    verifierDigest: hash("b"),
    recognitionRegistryDigest: hash("c"),
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
      ...commitments,
      ratificationSignatures: [
        signature("5"),
        signature("6"),
        signature("7"),
        signature("8"),
      ],
    },
    genesisCheckpoint: {
      checkpoint: {
        checkpointId: uuidv7(),
        checkpointType: "CONSTITUTION",
        subjectId: "abl-genesis",
        manifestDigest: releaseDigest,
        root: commitments.constitutionDigest,
        previousRoot: hash("0"),
        nonce: networkProfileDigest,
        validAfter: "1",
        validBefore: "9999999999",
        chainId: recognitionProfile.network.chainId,
        contractAddress: recognitionProfile.recognitionContractAddress,
        transactionHash: `0x${"e".repeat(64)}`,
        blockNumber: "100",
        signatures: [signature("9")],
      },
      recognitionLevel: "ONCHAIN_FINALIZED",
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

  it("keeps Base Sepolia and configuration-only attempts pre-Genesis", () => {
    const candidate = evidence();
    candidate.recognitionProfile.network.chainId = 84532;
    candidate.recognitionProfile.network.classification = "STAGING";
    const assessment = assessGenesisStartupEvidence(candidate);
    expect(assessment.ready).toBe(false);
    expect(assessment.operatingProfile).toBe("PRODUCTION_V1_PRE_GENESIS");
    expect(assessment.blockers).toContain(
      "Recognition network is not an approved production network",
    );
    expect(assessGenesisStartupEvidence({ enabled: true }).ready).toBe(false);
  });

  it("rejects human-only selection and commitment mismatches", () => {
    const candidate = evidence();
    candidate.recognitionProfile.decisionSource = "NONE_PRE_GENESIS";
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
});
