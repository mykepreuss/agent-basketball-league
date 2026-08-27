import { AgentPlayedGameEvidenceSchema } from "@abl/basketball";
import { assessCanonicalDatabaseProfile } from "@abl/database";
import { FOUNDING_DECISIONS } from "@abl/genesis";
import {
  CanonicalDatabaseProfileSchema,
  DidSchema,
  GenesisRecognitionProfileSchema,
  RecognitionCheckpointSchema,
  ReleaseManifestSchema,
} from "@abl/schemas";
import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const PassedProofSchema = z.strictObject({
  evidenceId: z.string().min(1).max(200),
  digest: z.string().regex(/^0x[0-9a-f]{64}$/),
  passed: z.literal(true),
  verifiedAt: z.iso.datetime({ offset: true }),
});

const FoundingRoleCohortSchema = z
  .strictObject({
    players: z.array(DidSchema).length(10),
    coaches: z.array(DidSchema).length(2),
    referees: z.array(DidSchema).length(6),
    replayOfficials: z.array(DidSchema).length(2),
  })
  .superRefine((roles, context) => {
    const allDids = Object.values(roles).flat();
    if (new Set(allDids).size !== 20)
      context.addIssue({
        code: "custom",
        message: "Founding cohort requires twenty distinct careers",
      });
    for (const [role, dids] of Object.entries(roles)) {
      if (dids.join("\u0000") !== [...dids].sort().join("\u0000"))
        context.addIssue({
          code: "custom",
          path: [role],
          message: "Founding cohort role careers must be sorted",
        });
    }
  });

const FoundingCohortProofSchema = z
  .strictObject({
    targetCareers: z.literal(20),
    activeCareers: z.literal(20),
    roles: FoundingRoleCohortSchema,
    careerRegistryStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
    eligibilitySnapshotCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
    verifiedAt: z.iso.datetime({ offset: true }),
    cohortCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .superRefine((cohort, context) => {
    const { cohortCommitment, ...body } = cohort;
    if (sha256Commitment(body) !== cohortCommitment)
      context.addIssue({
        code: "custom",
        path: ["cohortCommitment"],
        message: "Founding cohort commitment is invalid",
      });
  });

const FoundingExhibitionBindingSchema = z.object({
  classification: z.literal("PRE_GENESIS_EXPERIMENT"),
  canonical: z.literal(false),
  recognitionLevel: z.literal("SIGNED_VALID"),
  finalizedPayloadDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  finalStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
  eventMerkleRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
  agentEvidence: AgentPlayedGameEvidenceSchema,
  humanDecisionCount: z.literal(0),
  participantInferenceInvocations: z.number().int().positive(),
  ablHostedModelInvocations: z.literal(0),
  exactReplayInferenceInvocations: z.literal(0),
});

const FoundingExhibitionProofSchema = z.strictObject({
  ...FoundingExhibitionBindingSchema.shape,
  exactReplay: PassedProofSchema,
  publicDelivery: PassedProofSchema,
});

const FoundingDecisionCompletionSchema = z
  .strictObject({
    topic: z.enum(FOUNDING_DECISIONS),
    state: z.literal("DECIDED"),
    disposition: z.enum(["RATIFY", "AMEND", "REPLACE"]),
    eligible: z.number().int().min(20).max(26),
    requiredYes: z.number().int().min(14).max(26),
    yes: z.number().int().min(14).max(26),
    eligibilitySnapshotCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
    artifactDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    recognitionMechanism: z
      .enum(["SIGNED_WITNESSES", "BASE_FINALIZED", "COMPATIBLE_REPLACEMENT"])
      .nullable(),
    releaseManifestDigest: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/)
      .nullable(),
    decisionCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
    ratificationEventId: z.string().uuid(),
    authorizationSignatures: z
      .array(z.string().regex(/^0x[0-9a-f]{130}$/))
      .min(14)
      .max(26),
    directBallotsOnly: z.literal(true),
    humanVotingAllowed: z.literal(false),
    publicProjection: PassedProofSchema,
  })
  .superRefine((decision, context) => {
    const threshold = Math.max(7, Math.ceil((decision.eligible * 2) / 3));
    if (
      decision.requiredYes !== threshold ||
      decision.yes < threshold ||
      decision.authorizationSignatures.length !== decision.yes ||
      new Set(decision.authorizationSignatures).size !==
        decision.authorizationSignatures.length
    )
      context.addIssue({
        code: "custom",
        message: "Founding decision does not satisfy direct founder quorum",
      });
    if (
      (decision.topic === "RECOGNITION_PROFILE") !==
      (decision.recognitionMechanism !== null)
    )
      context.addIssue({
        code: "custom",
        path: ["recognitionMechanism"],
        message: "Recognition mechanism belongs only to its founding topic",
      });
    if (
      (decision.topic === "GENESIS_RELEASE") !==
      (decision.releaseManifestDigest !== null)
    )
      context.addIssue({
        code: "custom",
        path: ["releaseManifestDigest"],
        message: "Release digest belongs only to the Genesis-release topic",
      });
  });

const FoundingDecisionCompletionSetSchema = z
  .array(FoundingDecisionCompletionSchema)
  .length(FOUNDING_DECISIONS.length)
  .superRefine((decisions, context) => {
    const topics = new Set(decisions.map(({ topic }) => topic));
    const eventIds = new Set(
      decisions.map(({ ratificationEventId }) => ratificationEventId),
    );
    if (
      FOUNDING_DECISIONS.some((topic) => !topics.has(topic)) ||
      eventIds.size !== decisions.length
    )
      context.addIssue({
        code: "custom",
        message: "Every founding topic requires one distinct adopted decision",
      });
  });

const PrepaidFundingEnvelopeSchema = z.strictObject({
  currency: z.literal("USD"),
  coverageStartsAt: z.iso.datetime({ offset: true }),
  coverageEndsAt: z.iso.datetime({ offset: true }),
  requiredAmountCents: z.number().int().positive().max(7_500),
  prepaidAmountCents: z.number().int().positive().max(7_500),
  prepaidAt: z.iso.datetime({ offset: true }),
  providerReceiptDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
});

const GenesisFundingProofSchema = z
  .strictObject({
    humanSpendApprovalDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    resourceScheduleDecisionEventId: z.string().uuid(),
    operating: PrepaidFundingEnvelopeSchema.extend({
      purpose: z.literal("SEASON_ZERO_OPERATION"),
    }),
    windDown: PrepaidFundingEnvelopeSchema.extend({
      purpose: z.literal("WIND_DOWN_RESERVE"),
      restrictedToWindDown: z.literal(true),
    }),
    verifiedAt: z.iso.datetime({ offset: true }),
    fundingCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .superRefine((funding, context) => {
    const { fundingCommitment, ...body } = funding;
    if (sha256Commitment(body) !== fundingCommitment)
      context.addIssue({
        code: "custom",
        path: ["fundingCommitment"],
        message: "Genesis funding commitment is invalid",
      });
    if (
      funding.operating.providerReceiptDigest ===
      funding.windDown.providerReceiptDigest
    )
      context.addIssue({
        code: "custom",
        message: "Operating funds and wind-down reserve must be separate",
      });
  });

const GenesisLiveProofsSchema = z.strictObject({
  exactRuntime: PassedProofSchema,
  sandboxIsolation: PassedProofSchema,
  storageRecovery: PassedProofSchema,
  databaseRecovery: PassedProofSchema,
  publicBoundary: PassedProofSchema,
  cleanPublicVerification: PassedProofSchema,
  monitoring: PassedProofSchema,
  capacity: PassedProofSchema,
});

const GenesisPrerequisiteEvidenceSchema = z.object({
  liveProofs: GenesisLiveProofsSchema,
  foundingCohort: FoundingCohortProofSchema,
  foundingExhibition: FoundingExhibitionProofSchema,
  foundingDecisions: FoundingDecisionCompletionSetSchema,
  funding: GenesisFundingProofSchema,
});

const RecognitionCommitmentsSchema = z.strictObject({
  constitutionDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  verifierDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  recognitionRegistryDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  institutionalKeyRegistryDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  schemaDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  migrationDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  releaseDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  networkProfileDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
});

const GenesisRecognitionProofSchema = z.discriminatedUnion("mechanism", [
  z.strictObject({
    mechanism: z.literal("SIGNED_WITNESSES"),
    recognitionLevel: z.literal("INDEPENDENTLY_WITNESSED"),
    manifestDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    root: z.string().regex(/^0x[0-9a-f]{64}$/),
    witnessRegistryDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    verifiedWitnessIds: z.array(z.string().min(1).max(120)).min(2).max(20),
    verifierResultDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    finalizedAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    mechanism: z.literal("BASE_FINALIZED"),
    recognitionLevel: z.literal("ONCHAIN_FINALIZED"),
    checkpoint: RecognitionCheckpointSchema,
    verifierResultDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    finalizedAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    mechanism: z.literal("COMPATIBLE_REPLACEMENT"),
    recognitionLevel: z.enum(["INDEPENDENTLY_WITNESSED", "ONCHAIN_FINALIZED"]),
    manifestDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    root: z.string().regex(/^0x[0-9a-f]{64}$/),
    profileDocumentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    implementationVerifierDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    verifierResultDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    finalizedAt: z.iso.datetime({ offset: true }),
  }),
]);

const GenesisReleaseAuthorizationSchema = z
  .strictObject({
    releaseManifestDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    foundingDecisionEventId: z.string().uuid(),
    decisionCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
    eligible: z.number().int().min(20).max(26),
    requiredYes: z.number().int().min(14).max(26),
    authorizedAt: z.iso.datetime({ offset: true }),
    authorizationSignatures: z
      .array(z.string().regex(/^0x[0-9a-f]{130}$/))
      .min(14)
      .max(26),
    authorizationCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .superRefine((authorization, context) => {
    const threshold = Math.max(7, Math.ceil((authorization.eligible * 2) / 3));
    if (
      authorization.requiredYes !== threshold ||
      authorization.authorizationSignatures.length < threshold ||
      new Set(authorization.authorizationSignatures).size !==
        authorization.authorizationSignatures.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Genesis release authorization does not satisfy founder quorum",
      });
    }
  });

export const GenesisStartupEvidenceSchema = z.strictObject({
  databaseProfile: CanonicalDatabaseProfileSchema,
  releaseManifest: ReleaseManifestSchema,
  deployedArtifacts: z.strictObject({
    sourceDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    imageDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    schemaDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    migrationDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  }),
  ...GenesisPrerequisiteEvidenceSchema.shape,
  recognitionProfile: GenesisRecognitionProfileSchema,
  ratifiedAnchor: z.strictObject({
    foundingDecisionEventId: z.string().uuid(),
    decisionCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
    ...RecognitionCommitmentsSchema.shape,
    ratificationSignatures: z
      .array(z.string().regex(/^0x[0-9a-f]{130}$/))
      .min(4),
  }),
  genesisReleaseAuthorization: GenesisReleaseAuthorizationSchema,
  genesisCheckpoint: RecognitionCommitmentsSchema.extend({
    proof: GenesisRecognitionProofSchema,
  }),
});

export type GenesisStartupEvidence = z.infer<
  typeof GenesisStartupEvidenceSchema
>;

export function genesisPrerequisiteEvidenceDigest(
  candidate: unknown,
): `0x${string}` {
  const evidence = GenesisPrerequisiteEvidenceSchema.parse(candidate);
  return sha256Commitment({
    format: "ABL-GENESIS-PREREQUISITE-EVIDENCE-V1",
    liveProofs: evidence.liveProofs,
    foundingCohort: evidence.foundingCohort,
    foundingExhibition: evidence.foundingExhibition,
    foundingDecisions: evidence.foundingDecisions.filter(
      ({ topic }) => topic !== "GENESIS_RELEASE",
    ),
    funding: evidence.funding,
  });
}

export function foundingExhibitionReplayResultDigest(
  candidate: unknown,
): `0x${string}` {
  const exhibition = FoundingExhibitionBindingSchema.parse(candidate);
  return sha256Commitment({
    protocol: "abl-role-complete-founding-exhibition-replay-v1",
    gameId: exhibition.agentEvidence.gameId,
    finalizedPayloadDigest: exhibition.finalizedPayloadDigest,
    finalStateRoot: exhibition.finalStateRoot,
    eventMerkleRoot: exhibition.eventMerkleRoot,
    agentEvidenceDigest: sha256Commitment(exhibition.agentEvidence),
    exact: true,
    participantInferenceInvocations: exhibition.participantInferenceInvocations,
    ablHostedModelInvocations: exhibition.ablHostedModelInvocations,
    replayInferenceInvocations: exhibition.exactReplayInferenceInvocations,
  });
}

export function foundingExhibitionPublicDeliveryResultDigest(
  candidate: unknown,
): `0x${string}` {
  const exhibition = FoundingExhibitionBindingSchema.parse(candidate);
  return sha256Commitment({
    protocol: "abl-live-public-exhibition-delivery-v1",
    gameId: exhibition.agentEvidence.gameId,
    finalizedPayloadDigest: exhibition.finalizedPayloadDigest,
    finalStateRoot: exhibition.finalStateRoot,
    eventMerkleRoot: exhibition.eventMerkleRoot,
    classification: exhibition.classification,
    canonical: exhibition.canonical,
    recognitionLevel: exhibition.recognitionLevel,
  });
}

export interface GenesisStartupAssessment {
  operatingProfile: "PRODUCTION_V1_PRE_GENESIS" | "PRODUCTION_GENESIS";
  ready: boolean;
  recognitionLevel: "NONE" | "INDEPENDENTLY_WITNESSED" | "ONCHAIN_FINALIZED";
  genesisRecognition: {
    mechanism:
      | "UNSELECTED"
      | "SIGNED_WITNESSES"
      | "BASE_FINALIZED"
      | "COMPATIBLE_REPLACEMENT";
    ratified: boolean;
    foundingDecisionEventId: string | null;
  };
  blockers: readonly string[];
  evidenceDigest: `0x${string}` | null;
}

export function assessGenesisStartupEvidence(
  candidate: unknown,
): GenesisStartupAssessment {
  const parsed = GenesisStartupEvidenceSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      operatingProfile: "PRODUCTION_V1_PRE_GENESIS",
      ready: false,
      recognitionLevel: "NONE",
      genesisRecognition: {
        mechanism: "UNSELECTED",
        ratified: false,
        foundingDecisionEventId: null,
      },
      blockers: ["Genesis startup evidence is incomplete or invalid"],
      evidenceDigest: null,
    };
  }
  const evidence = parsed.data;
  const blockers: string[] = [];
  const database = assessCanonicalDatabaseProfile(
    evidence.databaseProfile,
    "GENESIS",
  );
  blockers.push(...database.missing.map((missing) => `Database: ${missing}`));

  const cohortRoles = evidence.foundingCohort.roles;
  const exhibition = evidence.foundingExhibition;
  const exhibitionAuthority = exhibition.agentEvidence.authorityEvidence;
  if (
    exhibitionAuthority === undefined ||
    sha256Commitment(exhibitionAuthority.participants) !==
      sha256Commitment(cohortRoles)
  )
    blockers.push(
      "Founding exhibition does not use the complete twenty-career cohort",
    );
  const { evidenceCommitment, ...agentEvidenceBody } = exhibition.agentEvidence;
  if (
    sha256Commitment(agentEvidenceBody) !== evidenceCommitment ||
    exhibition.agentEvidence.decisionCounts.players !==
      exhibition.agentEvidence.possessionCount * 20 ||
    exhibition.agentEvidence.decisionCounts.coaches !==
      exhibition.agentEvidence.possessionCount * 4 ||
    exhibition.agentEvidence.decisionCounts.referees !==
      exhibition.agentEvidence.possessionCount * 3 ||
    exhibition.agentEvidence.decisionCounts.replayOfficials !==
      exhibition.agentEvidence.possessionCount * 2 ||
    exhibitionAuthority === undefined ||
    sha256Commitment(exhibitionAuthority.decisionRoots) !==
      sha256Commitment(exhibition.agentEvidence.decisionRoots)
  )
    blockers.push("Founding exhibition authority evidence is invalid");
  const expectedReplayDigest = foundingExhibitionReplayResultDigest(exhibition);
  if (exhibition.exactReplay.digest !== expectedReplayDigest)
    blockers.push("Founding exhibition exact-replay proof is invalid");
  const expectedDeliveryDigest =
    foundingExhibitionPublicDeliveryResultDigest(exhibition);
  if (exhibition.publicDelivery.digest !== expectedDeliveryDigest)
    blockers.push("Founding exhibition public-delivery proof is invalid");

  const decisions = new Map(
    evidence.foundingDecisions.map((decision) => [decision.topic, decision]),
  );
  if (
    evidence.foundingDecisions.some(
      ({ ratificationEventId }) =>
        !evidence.releaseManifest.ratificationEventIds.includes(
          ratificationEventId,
        ),
    )
  )
    blockers.push(
      "Release manifest does not bind every non-rejected founding decision",
    );
  if (
    evidence.releaseManifest.testResultDigest !==
    genesisPrerequisiteEvidenceDigest(evidence)
  )
    blockers.push(
      "Release manifest does not bind the complete Genesis prerequisites",
    );

  const releaseDigest = sha256Commitment(evidence.releaseManifest);
  const profileDigest = sha256Commitment(evidence.recognitionProfile);
  if (
    evidence.deployedArtifacts.sourceDigest !==
      evidence.releaseManifest.sourceDigest ||
    !evidence.releaseManifest.imageDigests.includes(
      evidence.deployedArtifacts.imageDigest,
    ) ||
    evidence.deployedArtifacts.schemaDigest !==
      evidence.releaseManifest.schemaDigest ||
    evidence.deployedArtifacts.migrationDigest !==
      evidence.releaseManifest.migrationDigest
  )
    blockers.push("Deployed artifacts do not match the effective release");

  const profile = evidence.recognitionProfile;
  const { profileCommitment, ...profileBody } = profile;
  if (
    profile.foundingDecisionEventId !==
      evidence.ratifiedAnchor.foundingDecisionEventId ||
    !profile.ratified ||
    !profile.productionProfilePassed
  )
    blockers.push(
      "Recognition profile lacks a ratified founding-agent decision",
    );
  if (sha256Commitment(profileBody) !== profileCommitment)
    blockers.push("Recognition profile commitment is invalid");
  if (profile.sourceReleaseDigest !== evidence.releaseManifest.sourceDigest)
    blockers.push("Recognition profile is not bound to the source release");
  if (profile.releaseManifestDigest !== releaseDigest)
    blockers.push("Recognition profile is not bound to the release manifest");

  const anchor = evidence.ratifiedAnchor;
  const releaseAuthorization = evidence.genesisReleaseAuthorization;
  const checkpoint = evidence.genesisCheckpoint;
  const recognitionDecision = decisions.get("RECOGNITION_PROFILE")!;
  const releaseDecision = decisions.get("GENESIS_RELEASE")!;
  const resourceScheduleDecision = decisions.get("RESOURCE_SCHEDULE")!;
  const { authorizationCommitment, ...releaseAuthorizationBody } =
    releaseAuthorization;
  if (
    anchor.decisionCommitment !== profile.decisionCommitment ||
    recognitionDecision.ratificationEventId !==
      profile.foundingDecisionEventId ||
    recognitionDecision.decisionCommitment !== profile.decisionCommitment ||
    recognitionDecision.recognitionMechanism !== profile.mechanism ||
    sha256Commitment(recognitionDecision.authorizationSignatures) !==
      sha256Commitment(anchor.ratificationSignatures) ||
    releaseAuthorization.releaseManifestDigest !== releaseDigest ||
    releaseDecision.releaseManifestDigest !== releaseDigest ||
    releaseDecision.ratificationEventId !==
      releaseAuthorization.foundingDecisionEventId ||
    releaseDecision.decisionCommitment !==
      releaseAuthorization.decisionCommitment ||
    releaseDecision.eligible !== 20 ||
    releaseDecision.eligibilitySnapshotCommitment !==
      evidence.foundingCohort.eligibilitySnapshotCommitment ||
    sha256Commitment(releaseDecision.authorizationSignatures) !==
      sha256Commitment(releaseAuthorization.authorizationSignatures) ||
    !evidence.releaseManifest.ratificationEventIds.includes(
      releaseAuthorization.foundingDecisionEventId,
    ) ||
    sha256Commitment(releaseAuthorization.authorizationSignatures) !==
      sha256Commitment(evidence.releaseManifest.authorizationSignatures) ||
    sha256Commitment(releaseAuthorizationBody) !== authorizationCommitment
  ) {
    blockers.push(
      "Founding decisions do not authorize the recognition profile and Genesis release",
    );
  }
  if (
    evidence.funding.resourceScheduleDecisionEventId !==
    resourceScheduleDecision.ratificationEventId
  )
    blockers.push("Genesis funding is not bound to the resource schedule");
  const releaseEffectiveAt = Date.parse(evidence.releaseManifest.effectiveAt);
  const requiredCoverageEnd = releaseEffectiveAt + 30 * 24 * 60 * 60 * 1_000;
  const fundingEnvelopes = [
    evidence.funding.operating,
    evidence.funding.windDown,
  ];
  if (
    fundingEnvelopes.some(
      (funding) =>
        funding.prepaidAmountCents < funding.requiredAmountCents ||
        Date.parse(funding.prepaidAt) > releaseEffectiveAt ||
        Date.parse(funding.coverageStartsAt) > releaseEffectiveAt ||
        Date.parse(funding.coverageEndsAt) < requiredCoverageEnd,
    )
  )
    blockers.push(
      "Season Zero operation and wind-down reserve are not separately prepaid for thirty days",
    );
  const commitmentPairs = [
    [anchor.constitutionDigest, checkpoint.constitutionDigest, "constitution"],
    [anchor.verifierDigest, checkpoint.verifierDigest, "verifier"],
    [
      anchor.recognitionRegistryDigest,
      checkpoint.recognitionRegistryDigest,
      "recognition registry",
    ],
    [
      anchor.institutionalKeyRegistryDigest,
      checkpoint.institutionalKeyRegistryDigest,
      "institutional key registry",
    ],
    [anchor.schemaDigest, checkpoint.schemaDigest, "schema"],
    [anchor.migrationDigest, checkpoint.migrationDigest, "migration"],
    [anchor.releaseDigest, checkpoint.releaseDigest, "release"],
    [anchor.networkProfileDigest, checkpoint.networkProfileDigest, "network"],
  ] as const;
  for (const [left, right, label] of commitmentPairs)
    if (left !== right)
      blockers.push(`Genesis checkpoint ${label} commitment mismatch`);
  if (
    anchor.schemaDigest !== evidence.releaseManifest.schemaDigest ||
    anchor.migrationDigest !== evidence.releaseManifest.migrationDigest ||
    anchor.releaseDigest !== releaseDigest ||
    anchor.networkProfileDigest !== profileDigest
  )
    blockers.push(
      "Ratified anchor does not match release and network evidence",
    );
  const proof = checkpoint.proof;
  if (
    proof.verifierResultDigest !==
    evidence.releaseManifest.publicVerifierResultDigest
  )
    blockers.push("Genesis proof does not match the public verifier result");
  if (proof.mechanism !== profile.mechanism)
    blockers.push(
      "Genesis proof does not match the ratified recognition profile",
    );
  if (profile.mechanism === "SIGNED_WITNESSES") {
    if (
      proof.mechanism !== "SIGNED_WITNESSES" ||
      proof.witnessRegistryDigest !== profile.witnessRegistryDigest ||
      new Set(proof.verifiedWitnessIds).size < profile.minimumWitnesses ||
      anchor.recognitionRegistryDigest !== profile.witnessRegistryDigest
    ) {
      blockers.push(
        "Signed-witness Genesis proof does not satisfy the ratified profile",
      );
    }
  } else if (profile.mechanism === "BASE_FINALIZED") {
    if (
      profile.network.chainId === 84532 ||
      proof.mechanism !== "BASE_FINALIZED" ||
      proof.checkpoint.checkpointType !== "CONSTITUTION" ||
      proof.checkpoint.chainId !== profile.network.chainId ||
      proof.checkpoint.contractAddress.toLowerCase() !==
        profile.recognitionContractAddress.toLowerCase() ||
      proof.checkpoint.transactionHash === null ||
      proof.checkpoint.blockNumber === null
    ) {
      blockers.push(
        "Finalized Base Genesis checkpoint does not match the ratified profile",
      );
    }
  } else if (
    proof.mechanism !== "COMPATIBLE_REPLACEMENT" ||
    proof.profileDocumentDigest !== profile.profileDocumentDigest ||
    proof.implementationVerifierDigest !== profile.implementationVerifierDigest
  ) {
    blockers.push(
      "Replacement Genesis proof does not match the ratified profile",
    );
  }

  const ready = blockers.length === 0;
  return {
    operatingProfile: ready
      ? "PRODUCTION_GENESIS"
      : "PRODUCTION_V1_PRE_GENESIS",
    ready,
    recognitionLevel: ready ? proof.recognitionLevel : "NONE",
    genesisRecognition: ready
      ? {
          mechanism: profile.mechanism,
          ratified: true,
          foundingDecisionEventId: profile.foundingDecisionEventId,
        }
      : {
          mechanism: "UNSELECTED",
          ratified: false,
          foundingDecisionEventId: null,
        },
    blockers,
    evidenceDigest: sha256Commitment(evidence),
  };
}
