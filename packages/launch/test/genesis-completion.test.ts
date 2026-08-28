import {
  FinalizedGamePayloadSchema,
  createFinalizedGameScheduleEvidence,
  finalizedGameStateRoot,
  replayRoleCompleteFoundingExhibition,
  runAgentPlayedExhibition,
  type FinalizedGamePayload,
} from "@abl/basketball";
import { sha256Commitment } from "@abl/recognition";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/genesis-gate.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/genesis-gate.js")>();
  return {
    ...actual,
    assessGenesisStartupEvidence(candidate: unknown) {
      const record = candidate as { valid?: boolean };
      const ready = record.valid === true;
      return {
        operatingProfile: ready
          ? ("PRODUCTION_GENESIS" as const)
          : ("PRODUCTION_V1_PRE_GENESIS" as const),
        ready,
        recognitionLevel: ready
          ? ("INDEPENDENTLY_WITNESSED" as const)
          : ("NONE" as const),
        genesisRecognition: ready
          ? {
              mechanism: "SIGNED_WITNESSES" as const,
              ratified: true,
              foundingDecisionEventId: "0198f200-0000-7000-8000-000000000001",
            }
          : {
              mechanism: "UNSELECTED" as const,
              ratified: false,
              foundingDecisionEventId: null,
            },
        blockers: ready ? [] : ["fixture startup evidence is invalid"],
        evidenceDigest: ready ? sha256Commitment(candidate) : null,
      };
    },
  };
});

import {
  GenesisCompletionEvidenceSchema,
  assessGenesisCompletion,
  openingGamePublicVerifierResultDigest,
  openingGameReplayResultDigest,
} from "../src/genesis-completion.js";

const at = "2026-08-25T12:00:00.000Z";
const observedAt = "2026-08-25T12:01:00.000Z";
const completedAt = "2026-08-25T12:02:00.000Z";
const digest = (value: unknown) => sha256Commitment(value);
let finalizedGame: FinalizedGamePayload;

beforeAll(async () => {
  const exhibition = await runAgentPlayedExhibition();
  const schedule = createFinalizedGameScheduleEvidence({
    gameId: exhibition.input.gameId,
    competitionId: "abl-season-zero",
    seasonId: "season-zero",
    tier: "PREMIER",
    scheduleId: "abl-season-zero:premier",
    scheduleVersion: 1,
    clubIds: ["club-a", "club-b", "club-c", "club-d"],
    homeClubId: "club-a",
    awayClubId: "club-b",
    scheduledAt: "2026-08-25T11:00:00.000Z",
    scheduleEventHash: digest("opening-game-schedule-event"),
    scheduleStateRoot: digest("opening-game-schedule-state"),
  });
  finalizedGame = FinalizedGamePayloadSchema.parse({
    gameId: exhibition.input.gameId,
    finalizedAt: at,
    competition: schedule,
    input: exhibition.input,
    commands: exhibition.commands,
    proof: exhibition.proof,
    agentEvidence: exhibition.agentEvidence,
    filmCommitment: digest(exhibition.events),
    broadcastStartedAt: at,
    broadcastIntervalMs: 1,
  });
}, 30_000);

function completionEvidence() {
  const replay = replayRoleCompleteFoundingExhibition(finalizedGame);
  const genesisStartupEvidence = {
    valid: true,
    releaseManifest: { releaseId: "genesis-release-fixture", version: 1 },
  };
  const openingGameBase = {
    gameId: finalizedGame.gameId,
    finalizedPayloadDigest: digest(finalizedGame),
    roleAuthorityEvidenceDigest: digest(replay.authorityEvidence),
    decisionRoots: finalizedGame.agentEvidence.decisionRoots,
    eventMerkleRoot: finalizedGame.proof.eventMerkleRoot,
    finalStateRoot: finalizedGameStateRoot(finalizedGame),
    finalScore: replay.state.score,
    checkpointDigest: digest("opening-game-checkpoint"),
    humanDecisionCount: 0 as const,
    participantInferenceInvocations: 64,
    ablHostedParticipantModelInvocations: 0 as const,
    ablHostedOfficialModelInvocations: 128,
    exactReplayInferenceInvocations: 0 as const,
    recognition: {
      mechanism: "SIGNED_WITNESSES" as const,
      recognitionLevel: "INDEPENDENTLY_WITNESSED" as const,
      finalizedAt: at,
    },
  };
  const openingGame = {
    ...openingGameBase,
    exactReplayResultDigest: openingGameReplayResultDigest(openingGameBase),
  };
  const publicObservation = {
    gameId: openingGame.gameId,
    eventStreamDigest: digest("public-event-stream"),
    cursorDigest: digest("public-cursor"),
    segmentsDigest: digest("public-segments"),
    boxScoreDigest: digest(openingGame.finalScore),
    decisionRootsDigest: digest(openingGame.decisionRoots),
    officiatingRecordDigest: digest("public-officiating-record"),
    replayRulingsDigest: digest("public-replay-rulings"),
    eventMerkleRoot: openingGame.eventMerkleRoot,
    finalStateRoot: openingGame.finalStateRoot,
    finalScore: openingGame.finalScore,
    checkpointDigest: openingGame.checkpointDigest,
    anonymous: true as const,
    cursorContinuous: true as const,
    allSegmentsObserved: true as const,
    apiPassed: true as const,
    arenaPassed: true as const,
  };
  const publicVerifierInput = {
    releaseManifestDigest: digest(genesisStartupEvidence.releaseManifest),
    checkpointDigest: openingGame.checkpointDigest,
    gameId: openingGame.gameId,
    eventMerkleRoot: openingGame.eventMerkleRoot,
    finalStateRoot: openingGame.finalStateRoot,
    finalScore: openingGame.finalScore,
  };
  return {
    version: 1,
    evidenceClass: "ABL_COMPLETION_01_STAGE_I",
    programId: "ABL-COMPLETION-01",
    releaseCommit: "a".repeat(40),
    immutableWorkloadRevisions: [
      {
        kind: "Sandbox",
        name: "abl-core-api",
        immutableImageReference: "sandbox/abl-core-api:aaaaaaaaaaaa",
      },
    ],
    genesisStartupEvidence,
    genesisEvidenceDigest: digest(genesisStartupEvidence),
    launchState: {
      schemaVersion: "1.0.0",
      launchStage: "PRODUCTION_GENESIS",
      operatingProfile: "PRODUCTION_GENESIS",
      recognitionLevel: "INDEPENDENTLY_WITNESSED",
      genesis: true,
      canonical: true,
      recognized: true,
      canonicalHistoryOpen: true,
      productionV1Ready: true,
      publicExposure: "GENESIS",
      candidateIntake: {
        mode: "CAPPED_PUBLIC",
        capacityState: "AVAILABLE",
        requirementsUri: "https://abl.example/requirements",
        capacityPolicyUri: "https://abl.example/capacity",
      },
      foundingCohort: {
        targetCareers: 20,
        minimumGenesisCoverage: {
          PLAYER: 10,
          COACH: 2,
          REFEREE: 6,
          REPLAY_OFFICIAL: 2,
        },
        participantFounderMinimum: { PLAYER: 10, COACH: 2 },
        operationalOfficialMinimum: { REFEREE: 6, REPLAY_OFFICIAL: 2 },
        operationalOfficials: { REFEREE: 6, REPLAY_OFFICIAL: 2 },
        admissionCapacity: {
          PLAYER: 16,
          COACH: 2,
          REFEREE: 0,
          REPLAY_OFFICIAL: 0,
        },
        capacity: { PLAYER: 16, COACH: 2, REFEREE: 0, REPLAY_OFFICIAL: 0 },
        openings: { PLAYER: 6, COACH: 0, REFEREE: 0, REPLAY_OFFICIAL: 0 },
        offers: { PLAYER: 0, COACH: 0, REFEREE: 0, REPLAY_OFFICIAL: 0 },
        admitted: { PLAYER: 10, COACH: 2, REFEREE: 0, REPLAY_OFFICIAL: 0 },
        competitionReady: {
          PLAYER: 10,
          COACH: 2,
          REFEREE: 6,
          REPLAY_OFFICIAL: 2,
        },
        activeGames: 1,
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
        state: "COMPLETE",
        minimumFounders: 10,
        liveFounders: 12,
        eligibilitySnapshotCommitment: digest("eligibility-snapshot"),
        bootstrap: {
          state: "ADOPTED",
          closesAt: "2026-08-24T12:00:00.000Z",
          requiredYes: 8,
          yesVotes: 8,
        },
      },
      genesisRecognition: {
        mechanism: "SIGNED_WITNESSES",
        ratified: true,
        foundingDecisionEventId: "0198f200-0000-7000-8000-000000000001",
      },
      evidenceDigest: digest("launch-ledger"),
      blockingReasons: [],
      nextBlockingRequirement: null,
      lastSuccessfulAcceptance: {
        stage: "PRODUCTION_GENESIS",
        evidenceId: "genesis-startup",
        acceptedAt: at,
      },
      updatedAt: at,
    },
    openingGame,
    publicObservation,
    cleanPublicVerifier: {
      passed: true,
      usedRepositoryAccess: false,
      usedPrivateCredentials: false,
      ...publicVerifierInput,
      resultDigest: openingGamePublicVerifierResultDigest(publicVerifierInput),
    },
    signupProbe: {
      candidateDid: "did:abl:external-signup-probe",
      challengeCommitment: digest("signup-challenge"),
      applicationCommitment: digest("signup-application"),
      statusCommitment: digest("signup-status"),
      responseReceiptCommitment: digest("signup-response"),
      capacityDecision: "OFFERED",
      finalStatus: "DECLINED",
      runtimeScope: "POST_GENESIS_SINGLE",
      foundingRegistryCountBefore: 20,
      foundingRegistryCountAfter: 20,
      foundingRegistryRootBefore: digest("founding-registry"),
      foundingRegistryRootAfter: digest("founding-registry"),
      lastingRoleCapacityConsumed: false,
      existingCandidatePathUsed: true,
      negativeChecks: {
        humanAuthoredRejected: true,
        unsignedRejected: true,
        replayedRejected: true,
        staleRejected: true,
        malformedRejected: true,
        foundingScopeRejected: true,
      },
    },
    monitoring: {
      observedAt,
      p0: 0,
      p1: 0,
      replayDivergences: 0,
      privacyBreaches: 0,
      falseCanonicalLabels: 0,
      projectedInfrastructureCostUsd: 24,
      costHardStopEnabled: false,
      costOptimizationRequired: true,
      ablHostedParticipantModelCalls: 0,
      ablHostedOfficialModelCalls: 128,
      participantModelCredentialsHeld: 0,
      publicDiscoveryAvailable: true,
      verifierAvailable: true,
      arenaAvailable: true,
      signupAvailable: true,
    },
    completedAt,
    secretValuesRecorded: false,
  };
}

describe("Stage I Genesis completion", () => {
  it("passes only the combined Genesis, game, public, signup, and monitoring proof", () => {
    const evidence = completionEvidence();
    const parsed = GenesisCompletionEvidenceSchema.safeParse(evidence);
    if (!parsed.success) throw parsed.error;
    expect(assessGenesisCompletion(evidence, finalizedGame)).toMatchObject({
      status: "PASS",
      stage: "PRODUCTION_GENESIS",
      programId: "ABL-COMPLETION-01",
      releaseCommit: "a".repeat(40),
      gameId: finalizedGame.gameId,
      blockers: [],
      evidenceDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      resultDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("reports only the failed terminal criteria without reopening earlier stages", () => {
    const evidence = completionEvidence();
    const result = assessGenesisCompletion(
      {
        ...evidence,
        publicObservation: {
          ...evidence.publicObservation,
          finalStateRoot: digest("wrong-public-state"),
        },
        signupProbe: {
          ...evidence.signupProbe,
          foundingRegistryRootAfter: digest("changed-founding-registry"),
        },
        monitoring: { ...evidence.monitoring, p1: 1 },
      },
      finalizedGame,
    );
    expect(result.status).toBe("FAIL");
    expect(result.blockers).toEqual([
      "Public API and arena do not match the opening-game proof",
      "Signup probe changed the founding registry or role capacity",
      "Stage I monitoring contains a completion-blocking incident",
    ]);
  });

  it("fails malformed evidence without exposing validation details", () => {
    expect(assessGenesisCompletion({}, {})).toMatchObject({
      status: "FAIL",
      releaseCommit: null,
      gameId: null,
      blockers: ["Stage I completion evidence is incomplete or invalid"],
    });
  });
});
