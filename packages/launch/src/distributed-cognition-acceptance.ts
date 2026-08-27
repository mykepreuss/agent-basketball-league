import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const DigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/);

const RestartedServiceSchema = z.enum([
  "abl-cognition-relay",
  "abl-competition-director",
  "career-sandbox",
  "abl-private-storage-broker",
  "abl-core-api",
  "abl-public-api",
  "abl-spectator-arena",
]);

export const DistributedCognitionAcceptanceEvidenceSchema = z
  .strictObject({
    version: z.literal(1),
    evidenceClass: z.literal("DISTRIBUTED_COGNITION_ACCEPTANCE"),
    releaseCommit: CommitSchema,
    workspace: z.literal("agent-basketball-league"),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    infrastructure: z.strictObject({
      cognitionRelaySandbox: z.literal(true),
      competitionDirectorSandbox: z.literal(true),
      blaxelAgentResources: z.literal(0),
      blaxelApplications: z.literal(0),
      blaxelVolumes: z.literal(0),
      additionalWorkspaces: z.literal(0),
      additiveMigrationApplied: z.literal(true),
    }),
    admission: z.strictObject({
      legacyGenesisMinimum: z.literal(20),
      minimumGenesisCoverage: z.strictObject({
        players: z.literal(10),
        coaches: z.literal(2),
        referees: z.literal(6),
        replayOfficials: z.literal(2),
      }),
      admissionCapacity: z.strictObject({
        players: z.literal(16),
        coaches: z.literal(2),
        referees: z.literal(6),
        replayOfficials: z.literal(2),
      }),
      priorPlayerOffersPreserved: z.literal(3),
      remainingPlayerOpenings: z.literal(13),
    }),
    joining: z.strictObject({
      llmsJoinPassed: z.literal(true),
      admissionIndependentOfPairing: z.literal(true),
      deferredPairingPreservesMembership: z.literal(true),
      noOperatorGateAfterValidSignup: z.literal(true),
    }),
    runner: z.strictObject({
      immutableBundleDigest: DigestSchema,
      pairingPassed: z.literal(true),
      doctorPassed: z.literal(true),
      closedJoinSurfaceContinuationPassed: z.literal(true),
      automaticDelegationRenewalPassed: z.literal(true),
      validatedCommandPaths: z
        .array(z.enum(["CODEX_CLI", "CLAUDE_CODE", "GEMINI_CLI", "QWEN_LOCAL"]))
        .length(4)
        .refine((values) => new Set(values).size === 4),
      heterogeneousLiveAdapters: z
        .array(z.string().min(1).max(200))
        .min(2)
        .refine((values) => new Set(values).size >= 2),
    }),
    cognition: z.strictObject({
      participantInferenceOutsideAbl: z.literal(true),
      officialContextSelectedByCareer: z.literal(true),
      officialContextFromAgentDrive: z.literal(true),
      capsulesSealedToRunner: z.literal(true),
      minimumNecessarySelectionPassed: z.literal(true),
      allRolesCareerSigned: z.strictObject({
        player: z.literal(true),
        coach: z.literal(true),
        referee: z.literal(true),
        replay: z.literal(true),
      }),
      ablHostedModelCalls: z.literal(0),
      participantModelCredentialsHeldByAbl: z.literal(0),
      plaintextContextLeaks: z.literal(0),
    }),
    competition: z.strictObject({
      rosterPlayers: z.literal(16),
      teamCount: z.literal(2),
      startersPerTeam: z.literal(5),
      benchPerTeam: z.literal(3),
      completeGame: z.literal(true),
      commitmentsPassed: z.literal(true),
      readinessLeasesPassed: z.literal(true),
      fallbacksPassed: z.literal(true),
      substitutionsPassed: z.literal(true),
      suspensionAndResumePassed: z.literal(true),
      reliabilityDueProcessPassed: z.literal(true),
      basketballAbilityUnaffected: z.literal(true),
    }),
    delivery: z.strictObject({
      canonicalEventCount: z.number().int().positive(),
      publicSseSnapshotCount: z.number().int().positive(),
      courtcastRendered: z.literal(true),
      exactReplayPassed: z.literal(true),
      finalStateRoot: DigestSchema,
      replayStateRoot: DigestSchema,
    }),
    recovery: z.strictObject({
      restartedServices: z
        .array(RestartedServiceSchema)
        .length(7)
        .refine((values) => new Set(values).size === 7),
      duplicateInferenceRequests: z.literal(0),
      duplicateCanonicalActions: z.literal(0),
    }),
    assurance: z.strictObject({
      pinnedNode: z.literal("24.18.0"),
      ciPassed: z.literal(true),
      focusedSecurityChecksPassed: z.literal(true),
      secretValuesRecorded: z.literal(false),
      criticalIncidents: z.literal(0),
    }),
    authorityBoundary: z.strictObject({
      preGenesisExperiment: z.literal(true),
      genesis: z.literal(false),
      recognitionBroadcast: z.literal(false),
      baseTransaction: z.literal(false),
    }),
  })
  .superRefine((evidence, context) => {
    if (Date.parse(evidence.endedAt) < Date.parse(evidence.startedAt))
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "Acceptance timestamps are not monotonic",
      });
    if (evidence.delivery.finalStateRoot !== evidence.delivery.replayStateRoot)
      context.addIssue({
        code: "custom",
        path: ["delivery", "replayStateRoot"],
        message: "Exact replay state root differs from the live game",
      });
  });

export type DistributedCognitionAcceptanceEvidence = z.infer<
  typeof DistributedCognitionAcceptanceEvidenceSchema
>;

export function assessDistributedCognitionAcceptance(input: unknown) {
  const parsed = DistributedCognitionAcceptanceEvidenceSchema.safeParse(input);
  const blockers = parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "evidence"}: ${issue.message}`,
      );
  const result = parsed.success
    ? {
        status: "PASS" as const,
        releaseCommit: parsed.data.releaseCommit,
        workspace: parsed.data.workspace,
        gameStateRoot: parsed.data.delivery.finalStateRoot,
        blockers,
      }
    : {
        status: "FAIL" as const,
        releaseCommit: null,
        workspace: null,
        gameStateRoot: null,
        blockers,
      };
  return { ...result, resultDigest: sha256Commitment(result) };
}
