import { describe, expect, it } from "vitest";

import { assessDistributedCognitionAcceptance } from "../src/distributed-cognition-acceptance.js";

const hash = `0x${"a".repeat(64)}`;
const evidence = {
  version: 1,
  evidenceClass: "DISTRIBUTED_COGNITION_ACCEPTANCE",
  releaseCommit: "b".repeat(40),
  workspace: "agent-basketball-league",
  startedAt: "2026-08-26T10:00:00.000Z",
  endedAt: "2026-08-26T12:00:00.000Z",
  infrastructure: {
    cognitionRelaySandbox: true,
    competitionDirectorSandbox: true,
    blaxelAgentResources: 0,
    blaxelApplications: 0,
    blaxelVolumes: 0,
    additionalWorkspaces: 0,
    additiveMigrationApplied: true,
  },
  admission: {
    legacyGenesisMinimum: 20,
    minimumGenesisCoverage: {
      players: 10,
      coaches: 2,
      referees: 6,
      replayOfficials: 2,
    },
    admissionCapacity: {
      players: 16,
      coaches: 2,
      referees: 6,
      replayOfficials: 2,
    },
    priorPlayerOffersPreserved: 3,
    remainingPlayerOpenings: 13,
  },
  joining: {
    llmsJoinPassed: true,
    admissionIndependentOfPairing: true,
    deferredPairingPreservesMembership: true,
    noOperatorGateAfterValidSignup: true,
  },
  runner: {
    immutableBundleDigest: hash,
    pairingPassed: true,
    doctorPassed: true,
    closedJoinSurfaceContinuationPassed: true,
    automaticDelegationRenewalPassed: true,
    validatedCommandPaths: [
      "CODEX_CLI",
      "CLAUDE_CODE",
      "GEMINI_CLI",
      "QWEN_LOCAL",
    ],
    heterogeneousLiveAdapters: ["codex-cli", "local-qwen"],
  },
  cognition: {
    participantInferenceOutsideAbl: true,
    officialContextSelectedByCareer: true,
    officialContextFromAgentDrive: true,
    capsulesSealedToRunner: true,
    minimumNecessarySelectionPassed: true,
    allRolesCareerSigned: {
      player: true,
      coach: true,
      referee: true,
      replay: true,
    },
    ablHostedModelCalls: 0,
    participantModelCredentialsHeldByAbl: 0,
    plaintextContextLeaks: 0,
  },
  competition: {
    rosterPlayers: 16,
    teamCount: 2,
    startersPerTeam: 5,
    benchPerTeam: 3,
    completeGame: true,
    commitmentsPassed: true,
    readinessLeasesPassed: true,
    fallbacksPassed: true,
    substitutionsPassed: true,
    suspensionAndResumePassed: true,
    reliabilityDueProcessPassed: true,
    basketballAbilityUnaffected: true,
  },
  delivery: {
    canonicalEventCount: 1,
    publicSseSnapshotCount: 1,
    courtcastRendered: true,
    exactReplayPassed: true,
    finalStateRoot: hash,
    replayStateRoot: hash,
  },
  recovery: {
    restartedServices: [
      "abl-cognition-relay",
      "abl-competition-director",
      "career-sandbox",
      "abl-private-storage-broker",
      "abl-core-api",
      "abl-public-api",
      "abl-spectator-arena",
    ],
    duplicateInferenceRequests: 0,
    duplicateCanonicalActions: 0,
  },
  assurance: {
    pinnedNode: "24.18.0",
    ciPassed: true,
    focusedSecurityChecksPassed: true,
    secretValuesRecorded: false,
    criticalIncidents: 0,
  },
  authorityBoundary: {
    preGenesisExperiment: true,
    genesis: false,
    recognitionBroadcast: false,
    baseTransaction: false,
  },
} as const;

describe("distributed cognition acceptance", () => {
  it("provides one finite PASS definition for the iteration", () => {
    expect(assessDistributedCognitionAcceptance(evidence)).toMatchObject({
      status: "PASS",
      releaseCommit: evidence.releaseCommit,
      workspace: "agent-basketball-league",
      gameStateRoot: hash,
      blockers: [],
      resultDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("fails closed on a hosted model call", () => {
    const failed = assessDistributedCognitionAcceptance({
      ...evidence,
      cognition: { ...evidence.cognition, ablHostedModelCalls: 1 },
    });
    expect(failed.status).toBe("FAIL");
    expect(failed.blockers).toEqual(
      expect.arrayContaining([expect.stringContaining("ablHostedModelCalls")]),
    );
  });

  it("fails closed on exact-replay divergence", () => {
    const failed = assessDistributedCognitionAcceptance({
      ...evidence,
      delivery: {
        ...evidence.delivery,
        replayStateRoot: `0x${"c".repeat(64)}`,
      },
    });
    expect(failed.status).toBe("FAIL");
    expect(failed.blockers).toEqual(
      expect.arrayContaining([expect.stringContaining("replayStateRoot")]),
    );
  });
});
