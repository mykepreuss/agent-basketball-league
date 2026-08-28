import {
  finalizedGameStateRoot,
  replayRoleCompleteFoundingExhibition,
} from "@abl/basketball";
import { sha256Commitment } from "@abl/recognition";
import { LaunchStateSchema } from "@abl/schemas";
import { z } from "zod";

import { assessGenesisStartupEvidence } from "./genesis-gate.js";

const DigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const GitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const RecognitionMechanismSchema = z.enum([
  "SIGNED_WITNESSES",
  "BASE_FINALIZED",
  "COMPATIBLE_REPLACEMENT",
]);
const RecognitionLevelSchema = z.enum([
  "INDEPENDENTLY_WITNESSED",
  "ONCHAIN_FINALIZED",
]);
const RoleDecisionRootsSchema = z.strictObject({
  players: DigestSchema,
  coaches: DigestSchema,
  referees: DigestSchema,
  replayOfficials: DigestSchema,
});
const FinalScoreSchema = z.strictObject({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});
const WorkloadRevisionSchema = z
  .strictObject({
    kind: z.enum(["Sandbox", "Function", "Job"]),
    name: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    immutableImageReference: z
      .string()
      .min(1)
      .max(500)
      .regex(/(?:@sha256:[0-9a-f]{64}|:[a-z0-9]{12}|:[0-9a-f]{21})$/),
  })
  .superRefine((workload, context) => {
    if (
      !workload.immutableImageReference.includes("@sha256:") &&
      !workload.immutableImageReference.startsWith(
        `${workload.kind.toLowerCase()}/`,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["immutableImageReference"],
        message: "Provider image kind does not match the workload",
      });
  });

const OpeningGameSchema = z.strictObject({
  gameId: z.string().uuid(),
  finalizedPayloadDigest: DigestSchema,
  roleAuthorityEvidenceDigest: DigestSchema,
  decisionRoots: RoleDecisionRootsSchema,
  eventMerkleRoot: DigestSchema,
  finalStateRoot: DigestSchema,
  finalScore: FinalScoreSchema,
  checkpointDigest: DigestSchema,
  exactReplayResultDigest: DigestSchema,
  humanDecisionCount: z.literal(0),
  participantInferenceInvocations: z.number().int().positive(),
  ablHostedParticipantModelInvocations: z.literal(0),
  ablHostedOfficialModelInvocations: z.number().int().positive(),
  exactReplayInferenceInvocations: z.literal(0),
  recognition: z.strictObject({
    mechanism: RecognitionMechanismSchema,
    recognitionLevel: RecognitionLevelSchema,
    finalizedAt: z.iso.datetime({ offset: true }),
  }),
});

const PublicGameObservationSchema = z.strictObject({
  gameId: z.string().uuid(),
  eventStreamDigest: DigestSchema,
  cursorDigest: DigestSchema,
  segmentsDigest: DigestSchema,
  boxScoreDigest: DigestSchema,
  decisionRootsDigest: DigestSchema,
  officiatingRecordDigest: DigestSchema,
  replayRulingsDigest: DigestSchema,
  eventMerkleRoot: DigestSchema,
  finalStateRoot: DigestSchema,
  finalScore: FinalScoreSchema,
  checkpointDigest: DigestSchema,
  anonymous: z.literal(true),
  cursorContinuous: z.literal(true),
  allSegmentsObserved: z.literal(true),
  apiPassed: z.literal(true),
  arenaPassed: z.literal(true),
});

const CleanPublicVerifierSchema = z.strictObject({
  passed: z.literal(true),
  usedRepositoryAccess: z.literal(false),
  usedPrivateCredentials: z.literal(false),
  releaseManifestDigest: DigestSchema,
  checkpointDigest: DigestSchema,
  gameId: z.string().uuid(),
  eventMerkleRoot: DigestSchema,
  finalStateRoot: DigestSchema,
  finalScore: FinalScoreSchema,
  resultDigest: DigestSchema,
});

const SignupProbeSchema = z.strictObject({
  candidateDid: z.string().startsWith("did:").max(500),
  challengeCommitment: DigestSchema,
  applicationCommitment: DigestSchema,
  statusCommitment: DigestSchema,
  responseReceiptCommitment: DigestSchema,
  capacityDecision: z.enum(["OFFERED", "QUEUED"]),
  finalStatus: z.enum(["DECLINED", "WITHDRAWN"]),
  runtimeScope: z.literal("POST_GENESIS_SINGLE"),
  foundingRegistryCountBefore: z.literal(20),
  foundingRegistryCountAfter: z.literal(20),
  foundingRegistryRootBefore: DigestSchema,
  foundingRegistryRootAfter: DigestSchema,
  lastingRoleCapacityConsumed: z.literal(false),
  existingCandidatePathUsed: z.literal(true),
  negativeChecks: z.strictObject({
    humanAuthoredRejected: z.literal(true),
    unsignedRejected: z.literal(true),
    replayedRejected: z.literal(true),
    staleRejected: z.literal(true),
    malformedRejected: z.literal(true),
    foundingScopeRejected: z.literal(true),
  }),
});

const MonitoringSchema = z.strictObject({
  observedAt: z.iso.datetime({ offset: true }),
  p0: z.number().int().nonnegative(),
  p1: z.number().int().nonnegative(),
  replayDivergences: z.number().int().nonnegative(),
  privacyBreaches: z.number().int().nonnegative(),
  falseCanonicalLabels: z.number().int().nonnegative(),
  projectedInfrastructureCostUsd: z.number().nonnegative(),
  costHardStopEnabled: z.literal(false),
  costOptimizationRequired: z.literal(true),
  ablHostedParticipantModelCalls: z.literal(0),
  ablHostedOfficialModelCalls: z.number().int().positive(),
  participantModelCredentialsHeld: z.literal(0),
  publicDiscoveryAvailable: z.boolean(),
  verifierAvailable: z.boolean(),
  arenaAvailable: z.boolean(),
  signupAvailable: z.boolean(),
});

export const GenesisCompletionEvidenceSchema = z
  .strictObject({
    version: z.literal(1),
    evidenceClass: z.literal("ABL_COMPLETION_01_STAGE_I"),
    programId: z.literal("ABL-COMPLETION-01"),
    releaseCommit: GitCommitSchema,
    immutableWorkloadRevisions: z.array(WorkloadRevisionSchema).min(1).max(100),
    genesisStartupEvidence: z.unknown(),
    genesisEvidenceDigest: DigestSchema,
    launchState: LaunchStateSchema,
    openingGame: OpeningGameSchema,
    publicObservation: PublicGameObservationSchema,
    cleanPublicVerifier: CleanPublicVerifierSchema,
    signupProbe: SignupProbeSchema,
    monitoring: MonitoringSchema,
    completedAt: z.iso.datetime({ offset: true }),
    secretValuesRecorded: z.literal(false),
  })
  .superRefine((evidence, context) => {
    const workloadIds = evidence.immutableWorkloadRevisions.map(
      ({ kind, name }) => `${kind}/${name}`,
    );
    if (new Set(workloadIds).size !== workloadIds.length)
      context.addIssue({
        code: "custom",
        path: ["immutableWorkloadRevisions"],
        message: "Immutable workload revisions contain duplicates",
      });
    if (
      Date.parse(evidence.completedAt) <
      Date.parse(evidence.openingGame.recognition.finalizedAt)
    )
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completion predates opening-game recognition finality",
      });
    if (
      Date.parse(evidence.completedAt) <
      Date.parse(evidence.monitoring.observedAt)
    )
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completion predates the final monitoring observation",
      });
  });

export type GenesisCompletionEvidence = z.infer<
  typeof GenesisCompletionEvidenceSchema
>;

type OpeningGameDigestInput = Pick<
  GenesisCompletionEvidence["openingGame"],
  | "gameId"
  | "finalizedPayloadDigest"
  | "roleAuthorityEvidenceDigest"
  | "decisionRoots"
  | "eventMerkleRoot"
  | "finalStateRoot"
  | "finalScore"
>;

export function openingGameReplayResultDigest(
  input: OpeningGameDigestInput,
): `0x${string}` {
  const {
    gameId,
    finalizedPayloadDigest,
    roleAuthorityEvidenceDigest,
    decisionRoots,
    eventMerkleRoot,
    finalStateRoot,
    finalScore,
  } = input;
  return sha256Commitment({
    protocol: "abl-genesis-opening-game-exact-replay-v1",
    gameId,
    finalizedPayloadDigest,
    roleAuthorityEvidenceDigest,
    decisionRoots,
    eventMerkleRoot,
    finalStateRoot,
    finalScore,
    exact: true,
    replayInferenceInvocations: 0,
  });
}

type PublicVerifierDigestInput = Omit<
  GenesisCompletionEvidence["cleanPublicVerifier"],
  "passed" | "usedRepositoryAccess" | "usedPrivateCredentials" | "resultDigest"
>;

export function openingGamePublicVerifierResultDigest(
  input: PublicVerifierDigestInput,
): `0x${string}` {
  const {
    releaseManifestDigest,
    checkpointDigest,
    gameId,
    eventMerkleRoot,
    finalStateRoot,
    finalScore,
  } = input;
  return sha256Commitment({
    protocol: "abl-genesis-opening-game-clean-public-verifier-v1",
    releaseManifestDigest,
    checkpointDigest,
    gameId,
    eventMerkleRoot,
    finalStateRoot,
    finalScore,
    passed: true,
    usedRepositoryAccess: false,
    usedPrivateCredentials: false,
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  return sha256Commitment(left) === sha256Commitment(right);
}

function releaseManifestDigest(candidate: unknown): `0x${string}` | null {
  if (candidate === null || typeof candidate !== "object") return null;
  const releaseManifest = (candidate as Record<string, unknown>)[
    "releaseManifest"
  ];
  return releaseManifest === undefined
    ? null
    : sha256Commitment(releaseManifest);
}

function failureResult(blockers: readonly string[]) {
  const result = {
    status: "FAIL" as const,
    stage: "PRODUCTION_GENESIS" as const,
    programId: "ABL-COMPLETION-01" as const,
    releaseCommit: null,
    gameId: null,
    evidenceDigest: null,
    blockers: [...new Set(blockers)],
  };
  return { ...result, resultDigest: sha256Commitment(result) };
}

export function assessGenesisCompletion(
  evidenceInput: unknown,
  finalizedGameInput: unknown,
) {
  const parsed = GenesisCompletionEvidenceSchema.safeParse(evidenceInput);
  if (!parsed.success)
    return failureResult([
      "Stage I completion evidence is incomplete or invalid",
    ]);

  const evidence = parsed.data;
  const blockers: string[] = [];
  const genesis = assessGenesisStartupEvidence(evidence.genesisStartupEvidence);
  if (
    !genesis.ready ||
    genesis.operatingProfile !== "PRODUCTION_GENESIS" ||
    genesis.evidenceDigest !== evidence.genesisEvidenceDigest
  )
    blockers.push("Genesis startup evidence does not pass");

  const launchState = evidence.launchState;
  if (
    launchState.launchStage !== "PRODUCTION_GENESIS" ||
    launchState.operatingProfile !== "PRODUCTION_GENESIS" ||
    launchState.publicExposure !== "GENESIS" ||
    !launchState.genesis ||
    !launchState.canonical ||
    !launchState.canonicalHistoryOpen ||
    launchState.blockingReasons.length !== 0
  )
    blockers.push("Public launch state is not an unblocked canonical Genesis");
  if (
    launchState.candidateIntake.mode !== "CAPPED_PUBLIC" ||
    (launchState.candidateIntake.capacityState !== "AVAILABLE" &&
      launchState.candidateIntake.capacityState !== "QUEUEING")
  )
    blockers.push("Post-Genesis candidate intake is not open");
  if (
    launchState.foundingCohort.targetCareers !== 20 ||
    launchState.foundingCohort.admitted.PLAYER <
      launchState.foundingCohort.participantFounderMinimum.PLAYER ||
    launchState.foundingCohort.admitted.COACH <
      launchState.foundingCohort.participantFounderMinimum.COACH ||
    launchState.foundingCohort.operationalOfficials.REFEREE <
      launchState.foundingCohort.operationalOfficialMinimum.REFEREE ||
    launchState.foundingCohort.operationalOfficials.REPLAY_OFFICIAL <
      launchState.foundingCohort.operationalOfficialMinimum.REPLAY_OFFICIAL
  )
    blockers.push(
      "Public launch state does not satisfy Genesis minimum coverage",
    );
  if (
    genesis.ready &&
    (launchState.recognitionLevel !== genesis.recognitionLevel ||
      launchState.genesisRecognition.mechanism !==
        genesis.genesisRecognition.mechanism ||
      !launchState.genesisRecognition.ratified)
  )
    blockers.push("Public recognition state differs from the ratified profile");

  try {
    const replay = replayRoleCompleteFoundingExhibition(finalizedGameInput);
    const payload = replay.payload;
    const game = evidence.openingGame;
    const expectedPayloadDigest = sha256Commitment(payload);
    const expectedAuthorityDigest = sha256Commitment(replay.authorityEvidence);
    const expectedStateRoot = finalizedGameStateRoot(payload);
    if (payload.competition === null)
      blockers.push("Opening game lacks independent schedule evidence");
    if (
      game.gameId !== payload.gameId ||
      game.finalizedPayloadDigest !== expectedPayloadDigest ||
      game.roleAuthorityEvidenceDigest !== expectedAuthorityDigest ||
      !sameValue(game.decisionRoots, payload.agentEvidence.decisionRoots) ||
      game.eventMerkleRoot !== payload.proof.eventMerkleRoot ||
      game.finalStateRoot !== expectedStateRoot ||
      !sameValue(game.finalScore, replay.state.score)
    )
      blockers.push("Opening-game evidence does not match exact replay");
    if (game.exactReplayResultDigest !== openingGameReplayResultDigest(game))
      blockers.push("Opening-game replay result digest is invalid");
  } catch {
    blockers.push("Opening game is not a role-complete exact finalized replay");
  }

  const game = evidence.openingGame;
  const publicGame = evidence.publicObservation;
  if (
    publicGame.gameId !== game.gameId ||
    publicGame.decisionRootsDigest !== sha256Commitment(game.decisionRoots) ||
    publicGame.eventMerkleRoot !== game.eventMerkleRoot ||
    publicGame.finalStateRoot !== game.finalStateRoot ||
    !sameValue(publicGame.finalScore, game.finalScore) ||
    publicGame.checkpointDigest !== game.checkpointDigest
  )
    blockers.push("Public API and arena do not match the opening-game proof");
  if (
    game.recognition.mechanism !== genesis.genesisRecognition.mechanism ||
    game.recognition.recognitionLevel !== genesis.recognitionLevel
  )
    blockers.push("Opening-game checkpoint does not use the ratified profile");

  const verifier = evidence.cleanPublicVerifier;
  const { resultDigest: _resultDigest, ...verifierInput } = verifier;
  if (
    verifier.gameId !== game.gameId ||
    verifier.releaseManifestDigest !==
      releaseManifestDigest(evidence.genesisStartupEvidence) ||
    verifier.checkpointDigest !== game.checkpointDigest ||
    verifier.eventMerkleRoot !== game.eventMerkleRoot ||
    verifier.finalStateRoot !== game.finalStateRoot ||
    !sameValue(verifier.finalScore, game.finalScore) ||
    verifier.resultDigest !==
      openingGamePublicVerifierResultDigest(verifierInput)
  )
    blockers.push("Clean public verifier result is invalid or mismatched");

  const signup = evidence.signupProbe;
  if (
    signup.foundingRegistryRootBefore !== signup.foundingRegistryRootAfter ||
    signup.foundingRegistryCountBefore !== signup.foundingRegistryCountAfter ||
    signup.lastingRoleCapacityConsumed
  )
    blockers.push(
      "Signup probe changed the founding registry or role capacity",
    );

  const monitoring = evidence.monitoring;
  const incidentCount =
    monitoring.p0 +
    monitoring.p1 +
    monitoring.replayDivergences +
    monitoring.privacyBreaches +
    monitoring.falseCanonicalLabels;
  if (incidentCount !== 0)
    blockers.push("Stage I monitoring contains a completion-blocking incident");
  if (
    !monitoring.publicDiscoveryAvailable ||
    !monitoring.verifierAvailable ||
    !monitoring.arenaAvailable ||
    !monitoring.signupAvailable
  )
    blockers.push("A required live public or signup surface is unavailable");

  const uniqueBlockers = [...new Set(blockers)];
  const result = {
    status: uniqueBlockers.length === 0 ? ("PASS" as const) : ("FAIL" as const),
    stage: "PRODUCTION_GENESIS" as const,
    programId: evidence.programId,
    releaseCommit: evidence.releaseCommit,
    gameId: evidence.openingGame.gameId,
    evidenceDigest: sha256Commitment(evidence),
    blockers: uniqueBlockers,
  };
  return { ...result, resultDigest: sha256Commitment(result) };
}
