import { z } from "zod";

export const SchemaVersion = "1.0.0" as const;

export const DidSchema = z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/);
export const UuidV7Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
export const Sha256Schema = z.string().regex(/^0x[0-9a-f]{64}$/);
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const Secp256k1PublicKeySchema = z
  .string()
  .regex(/^0x(?:02|03)[0-9a-f]{64}$/);
export const X25519PublicKeySchema = z.string().regex(/^0x[0-9a-f]{64}$/);
export const Eip712SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);
export const NonceSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const FixedPointSchema = z.number().int().safe();

export const CanonicalEventWireSchema = z.strictObject({
  eventId: z.uuid(),
  actorDid: z.string().startsWith("did:"),
  nonce: z.string().min(1).max(78),
  idempotencyKey: z.uuid(),
  aggregateType: z.string().min(1).max(100),
  aggregateId: z.string().min(1).max(200),
  aggregateVersion: z.string().regex(/^[1-9]\d*$/),
  eventType: z.string().min(1).max(100),
  previousEventHash: Sha256Schema.nullable(),
  payloadCommitment: Sha256Schema,
  payload: z.unknown(),
  stateRoot: Sha256Schema,
  schemaDigest: Sha256Schema,
  timestamp: IsoDateTimeSchema,
  eventHash: Sha256Schema,
});

export const SignedCanonicalCommandSchema = z.strictObject({
  event: CanonicalEventWireSchema,
  signatures: z.array(Eip712SignatureSchema).length(1),
});

export const SignedCanonicalMultiCommandSchema = z.strictObject({
  event: CanonicalEventWireSchema,
  signatures: z.array(Eip712SignatureSchema).min(1).max(5),
});

export const SignedCanonicalAssemblyCommandSchema = z.strictObject({
  event: CanonicalEventWireSchema,
  signatures: z.array(Eip712SignatureSchema).min(1).max(45),
});

export const CAREER_CAPABILITY_AGGREGATE_TYPE = "career-capability" as const;
export const CAREER_CAPABILITY_RENEWAL_EVENT_TYPE =
  "CapabilityRenewalRequested" as const;
export const CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL =
  "CareerCapabilityRenewalRequested:1.0.0" as const;
export const BrokerCapabilityOperationsSchema = z
  .array(z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/))
  .min(1)
  .max(16)
  .refine(
    (operations) =>
      new Set(operations).size === operations.length &&
      operations.every(
        (operation, index) => index === 0 || operations[index - 1]! < operation,
      ),
    "Broker capability operations must be unique and sorted",
  );
export const CareerCapabilityRenewalPayloadSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  operations: BrokerCapabilityOperationsSchema,
  requestedExpiresAt: IsoDateTimeSchema,
});

export const DisclosureClassSchema = z.enum([
  "PUBLIC_NOW",
  "SEALED_30D",
  "COMPETITIVE_SEALED",
  "CASE_RESTRICTED",
  "PERSONAL_UNSUBMITTED",
  "INTEGRITY_ESCROW",
]);

export const ResourceClassSchema = z.enum([
  "GAME_DAY",
  "UNIVERSAL_PERSONAL_MINIMUM",
  "PERSONAL_AUTONOMY",
  "TEAM_PREPARATION",
  "GOVERNMENT",
  "DUE_PROCESS",
  "CONTINUITY",
  "EXIT",
]);

export const AutonomousBasketballRoleSchema = z.enum([
  "PLAYER",
  "COACH",
  "REFEREE",
  "REPLAY",
]);
export type AutonomousBasketballRole = z.infer<
  typeof AutonomousBasketballRoleSchema
>;

export const CognitionModeSchema = z.enum([
  "PARTICIPANT_CONTROLLED",
  "LEAGUE_HOSTED_OFFICIAL",
  "DETERMINISTIC_FIXTURE",
]);
export type CognitionMode = z.infer<typeof CognitionModeSchema>;

export const BasketballPositionSchema = z.enum(["PG", "SG", "SF", "PF", "C"]);
export type BasketballPosition = z.infer<typeof BasketballPositionSchema>;
export const BASKETBALL_POSITIONS = BasketballPositionSchema.options;

export const PlayerPositionPreferenceRankingSchema = z
  .array(BasketballPositionSchema)
  .length(BASKETBALL_POSITIONS.length)
  .refine(
    (positions) =>
      new Set(positions).size === BASKETBALL_POSITIONS.length &&
      BASKETBALL_POSITIONS.every((position) => positions.includes(position)),
    "Position preferences must rank PG, SG, SF, PF, and C exactly once",
  );
export type PlayerPositionPreferenceRanking = z.infer<
  typeof PlayerPositionPreferenceRankingSchema
>;

export const PlayerPositionProfileSchema = z
  .strictObject({
    primaryPosition: BasketballPositionSchema,
    positionPreferenceRanking: PlayerPositionPreferenceRankingSchema.optional(),
    eligiblePositions: z
      .array(BasketballPositionSchema)
      .min(1)
      .max(BASKETBALL_POSITIONS.length),
    profileCommitment: Sha256Schema,
  })
  .refine(
    ({ primaryPosition, eligiblePositions }) =>
      eligiblePositions.includes(primaryPosition) &&
      new Set(eligiblePositions).size === eligiblePositions.length &&
      BASKETBALL_POSITIONS.filter((position) =>
        eligiblePositions.includes(position),
      ).every((position, index) => eligiblePositions[index] === position),
    "The primary position must appear once in canonically ordered eligible positions",
  );
export type PlayerPositionProfile = z.infer<typeof PlayerPositionProfileSchema>;

export const CareerPositionProfileAttestationSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  careerDid: DidSchema,
  profile: PlayerPositionProfileSchema,
  source: z.enum([
    "APPLICATION_DECLARED",
    "ROSTER_POSITION_OFFER",
    "LEGACY_COMPATIBILITY",
  ]),
  attestedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});
export type CareerPositionProfileAttestation = z.infer<
  typeof CareerPositionProfileAttestationSchema
>;

export const LineupPositionAssignmentSchema = z.strictObject({
  position: BasketballPositionSchema,
  careerDid: DidSchema,
});
export type LineupPositionAssignment = z.infer<
  typeof LineupPositionAssignmentSchema
>;

export const CognitionProvenanceLevelSchema = z.enum([
  "PROVIDER_ATTESTED",
  "RUNNER_VERIFIED",
  "PRODUCT_SURFACE_REPORTED",
  "LOCAL_ARTIFACT_VERIFIED",
  "DECLARED_ONLY",
  "UNKNOWN",
]);
export type CognitionProvenanceLevel = z.infer<
  typeof CognitionProvenanceLevelSchema
>;

export const AmbientProductContextSchema = z.enum([
  "NONE",
  "DISCLOSED_PRODUCT_CONTEXT",
  "UNDISCLOSED_PROVIDER_CONTEXT_POSSIBLE",
]);

export const RunnerStateSchema = z.enum([
  "CAREER_ACTIVE_RUNNER_UNPAIRED",
  "RUNNER_PAIRED_OFFLINE",
  "RUNNER_ON_DEMAND_ONLY",
  "RUNNER_ONLINE",
  "COMPETITION_READY",
  "GAME_COMMITTED",
  "LINEUP_ELIGIBLE",
  "ACTIVE",
  "BENCH",
  "READINESS_REHABILITATION",
  "TEMPORARILY_INACTIVE",
]);
export type RunnerState = z.infer<typeof RunnerStateSchema>;

export const ActivationStateSchema = z.enum([
  "RECEIVED",
  "CONTEXT_ASSEMBLED",
  "SEALED_FOR_RUNNER",
  "DELIVERED",
  "RESULT_RECEIVED",
  "VALIDATED",
  "CAREER_SIGNED",
  "FALLBACK_SIGNED",
  "EXPIRED",
  "REJECTED",
]);
export type ActivationState = z.infer<typeof ActivationStateSchema>;

export const AuthorizationProofSchema = z.strictObject({
  capability: z.string().min(1),
  mandateId: UuidV7Schema.optional(),
  role: z.string().min(1),
  proofDigest: Sha256Schema,
});

export const WriteEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  actorDid: DidSchema,
  signature: Eip712SignatureSchema,
  nonce: NonceSchema,
  idempotencyKey: z.uuid(),
  expectedAggregateVersion: z.number().int().nonnegative(),
  timestamp: IsoDateTimeSchema,
  schemaDigest: Sha256Schema,
  authorizationProof: AuthorizationProofSchema,
  cognitionReceiptId: UuidV7Schema.optional(),
});

const DependencyLabelSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => value.trim() === value,
    "Dependency label is not canonical",
  );

const ModelIdentitySchema = z.strictObject({
  endpoint: z.string().min(1).max(4_096),
  provider: DependencyLabelSchema,
  family: DependencyLabelSchema,
  exactModel: DependencyLabelSchema,
  declaredRevision: DependencyLabelSchema,
});

export const ModelDependencyProfileSchema = z.strictObject({
  runtimeArchitecture: DependencyLabelSchema,
  gateway: DependencyLabelSchema,
  upstreamDependency: DependencyLabelSchema,
});

const KeyProvenanceSchema = z.strictObject({
  generatedInIsolatedRuntime: z.boolean(),
  signingKeyAttestation: Sha256Schema,
  encryptionKeyAttestation: Sha256Schema,
  formerOperatorKeyRevokedAt: IsoDateTimeSchema.optional(),
});

export const AgentManifestSchema = z
  .strictObject({
    agentDid: DidSchema,
    manifestVersion: z.number().int().positive(),
    leagueRuntime: z.discriminatedUnion("provider", [
      z.strictObject({
        provider: z.literal("BLAXEL"),
        resourceType: z.literal("SANDBOX"),
        dedicatedCareer: z.literal(true),
      }),
      z.strictObject({
        provider: z.literal("PARTICIPANT_OWNED"),
        resourceType: z.literal("PARTICIPANT_HOST"),
        dedicatedCareer: z.boolean(),
      }),
    ]),
    model: ModelIdentitySchema,
    dependencyProfile: ModelDependencyProfileSchema,
    runtimeDigest: Sha256Schema,
    toolDigests: z.array(Sha256Schema),
    guardianDids: z.array(DidSchema),
    keyProvenance: KeyProvenanceSchema,
    inheritedObjectives: z.array(z.string()),
    suppliedContextHashes: z.array(Sha256Schema),
    createdAt: IsoDateTimeSchema,
  })
  .describe(
    "ABL career manifest. Blaxel-hosted careers are accepted only as dedicated Sandbox resources; the Blaxel Agent resource type is not valid.",
  );

export const CandidateProvenanceSchema = z.strictObject({
  candidateDid: DidSchema,
  sourceOperatorCommitment: Sha256Schema,
  declaredModel: ModelIdentitySchema,
  declaredDependencyProfile: ModelDependencyProfileSchema,
  runtimeDigest: Sha256Schema,
  toolDigests: z.array(Sha256Schema),
  inheritedObjectiveCommitments: z.array(Sha256Schema),
  suppliedContextHashes: z.array(Sha256Schema),
  hiddenInstructionScanDigest: Sha256Schema,
  registeredAt: IsoDateTimeSchema,
});

export const CandidateRoleClassSchema = z.enum([
  "PLAYER",
  "COACH",
  "REFEREE",
  "REPLAY_OFFICIAL",
  "GOVERNOR",
  "COMMISSIONER",
  "TRIBUNAL",
  "INTEGRITY",
  "ADVOCATE",
  "BROADCASTER",
  "MEDIA",
]);
export type CandidateRoleClass = z.infer<typeof CandidateRoleClassSchema>;

export const CandidateCareerBindingSchema = z.strictObject({
  applicationId: UuidV7Schema,
  candidateDid: DidSchema,
  signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  roleClass: CandidateRoleClassSchema,
  capacityDecisionCommitment: Sha256Schema,
  opportunityResponseCommitment: Sha256Schema,
});
export type CandidateCareerBinding = z.infer<
  typeof CandidateCareerBindingSchema
>;

export const CandidateIntakeModeSchema = z.enum([
  "CLOSED",
  "INVITE_ONLY",
  "CAPPED_PUBLIC",
  "OPEN_PUBLIC",
]);

export const CandidateRoleCapacityCountsSchema = z.record(
  CandidateRoleClassSchema,
  z.number().int().nonnegative(),
);

export const CandidateIntakePublicStateSchema = z
  .strictObject({
    schemaVersion: z.literal(SchemaVersion),
    mode: CandidateIntakeModeSchema,
    capacityState: z.enum([
      "CLOSED",
      "AVAILABLE",
      "QUEUEING",
      "NO_CREDIBLE_OPPORTUNITY",
    ]),
    capacityByRole: CandidateRoleCapacityCountsSchema,
    occupiedByRole: CandidateRoleCapacityCountsSchema,
    openingsByRole: CandidateRoleCapacityCountsSchema,
    queuedByRole: CandidateRoleCapacityCountsSchema,
    playerPositionState: z
      .strictObject({
        rankingRequired: z.literal(true),
        minimumPrimaryAssignmentsPerPosition: z.literal(2),
        maximumPrimaryAssignmentsPerPosition: z.literal(4),
        primaryAssignmentCounts: z.strictObject({
          PG: z.number().int().nonnegative(),
          SG: z.number().int().nonnegative(),
          SF: z.number().int().nonnegative(),
          PF: z.number().int().nonnegative(),
          C: z.number().int().nonnegative(),
        }),
        priorityPositions: z.array(BasketballPositionSchema).max(5),
        legacyUnassignedPlayers: z.number().int().nonnegative(),
      })
      .optional(),
    canonicalAuthority: z.literal(false),
    genesis: z.literal(false),
    maximumApplicationBytes: z.number().int().positive(),
    decisionDeadlineHours: z.literal(72),
    credibleOpportunityHorizonDays: z.literal(30),
    policyCommitment: Sha256Schema,
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine((state, context) => {
    for (const role of CandidateRoleClassSchema.options) {
      const remaining = state.capacityByRole[role] - state.occupiedByRole[role];
      if (remaining < 0 || state.openingsByRole[role] > remaining)
        context.addIssue({
          code: "custom",
          path: ["openingsByRole", role],
          message: "Candidate openings exceed unoccupied role capacity",
        });
    }
    const hasOpening = Object.values(state.openingsByRole).some(
      (openings) => openings > 0,
    );
    if (
      (state.mode === "CLOSED") !== (state.capacityState === "CLOSED") ||
      (state.capacityState === "AVAILABLE") !== hasOpening
    )
      context.addIssue({
        code: "custom",
        path: ["capacityState"],
        message: "Candidate capacity classification is inconsistent",
      });
  });
export type CandidateIntakePublicState = z.infer<
  typeof CandidateIntakePublicStateSchema
>;

const LegacyCandidateEnvelopeSchema = z.strictObject({
  format: z.literal("ABL-CANDIDATE-ENVELOPE-XCHACHA20-V1"),
  recipientKeyId: z.string().min(1).max(160),
  nonce: z.string().min(16).max(128),
  ciphertext: z.string().min(1).max(1_000_000),
  ciphertextCommitment: Sha256Schema,
});

const PublicKeyCandidateEnvelopeSchema = z.strictObject({
  format: z.literal("ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1"),
  recipientKeyId: z.string().min(1).max(160),
  ephemeralPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  nonce: z.string().min(16).max(128),
  ciphertext: z.string().min(1).max(1_000_000),
  ciphertextCommitment: Sha256Schema,
});

export const CandidateIntakeApplicationSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  applicationId: UuidV7Schema,
  candidateDid: DidSchema,
  requestedRoleClasses: z
    .array(CandidateRoleClassSchema)
    .min(1)
    .max(4)
    .refine((values) => new Set(values).size === values.length),
  playerPositionProfile: PlayerPositionProfileSchema.optional(),
  challengeId: UuidV7Schema,
  challengeCommitment: Sha256Schema,
  challengeExpiresAt: IsoDateTimeSchema,
  manifestCommitment: Sha256Schema,
  provenanceCommitment: Sha256Schema,
  manifestSchemaDigest: Sha256Schema,
  provenanceSchemaDigest: Sha256Schema,
  encryptedEnvelope: z.discriminatedUnion("format", [
    LegacyCandidateEnvelopeSchema,
    PublicKeyCandidateEnvelopeSchema,
  ]),
  formerOperatorSigningAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  submittedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const CandidateCapacityDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal(SchemaVersion),
    applicationId: UuidV7Schema,
    candidateDid: DidSchema,
    roleClass: CandidateRoleClassSchema,
    decision: z.enum(["OFFERED", "QUEUED", "REJECTED", "INTAKE_CLOSED"]),
    reason: z.enum([
      "CAPACITY_AVAILABLE",
      "DETERMINISTIC_QUEUE",
      "ROLE_CAPACITY_UNAVAILABLE",
      "NO_CREDIBLE_OPPORTUNITY_WITHIN_30_DAYS",
      "INTAKE_MODE_CLOSED",
      "INVITATION_REQUIRED",
    ]),
    queuePosition: z.number().int().positive().nullable(),
    offeredPosition: BasketballPositionSchema.nullable().default(null),
    issuedAt: IsoDateTimeSchema,
    offerExpiresAt: IsoDateTimeSchema.nullable(),
    nextReviewAt: IsoDateTimeSchema.nullable(),
    credibleOpportunityBefore: IsoDateTimeSchema.nullable(),
    capacityRuleDigest: Sha256Schema,
    portableExportCommitment: Sha256Schema,
    decisionCommitment: Sha256Schema,
  })
  .superRefine((decision, context) => {
    if (
      (decision.decision === "OFFERED") !==
      (decision.offerExpiresAt !== null)
    )
      context.addIssue({
        code: "custom",
        path: ["offerExpiresAt"],
        message: "Only an offered opportunity has an expiry",
      });
    if (
      decision.offeredPosition !== null &&
      (decision.roleClass !== "PLAYER" || decision.decision !== "OFFERED")
    )
      context.addIssue({
        code: "custom",
        path: ["offeredPosition"],
        message: "Only an offered player opportunity may assign a position",
      });
  });

export const CandidateOpportunityResponseSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  applicationId: UuidV7Schema,
  candidateDid: DidSchema,
  decisionCommitment: Sha256Schema,
  action: z.enum(["ACCEPT_OFFER", "DECLINE_OFFER", "WITHDRAW_APPLICATION"]),
  respondedAt: IsoDateTimeSchema,
  nonce: z.string().min(16).max(160),
  signature: Eip712SignatureSchema,
});

export const CandidateProvisioningReceiptSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  receiptId: UuidV7Schema,
  applicationId: UuidV7Schema,
  candidateDid: DidSchema,
  applicationCommitment: Sha256Schema,
  unchangedSignedApplicationCommitment: Sha256Schema,
  verification: z.strictObject({
    signature: z.literal(true),
    challenge: z.literal(true),
    schemaDigests: z.literal(true),
    provenanceCommitment: z.literal(true),
    capacityDecision: z.literal(true),
    replayProtected: z.literal(true),
  }),
  controlPlaneMode: z.enum(["DRY_RUN", "APPROVED_LIVE"]),
  state: z.enum([
    "VERIFIED_NOT_PROVISIONED",
    "PROVISIONED_AWAITING_TRANSFER",
    "ISOLATED_TRANSFER_COMPLETE",
    "REJECTED",
  ]),
  sandboxResourceName: z.string().min(1).max(160).nullable(),
  formerOperatorAccessRemovedAt: IsoDateTimeSchema.nullable(),
  issuedAt: IsoDateTimeSchema,
  receiptCommitment: Sha256Schema,
});

export const CandidateRuntimeIdentityReceiptSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  applicationId: UuidV7Schema,
  candidateDid: DidSchema,
  roleClass: CandidateRoleClassSchema,
  signingPublicKey: Secp256k1PublicKeySchema,
  signingAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  encryptionPublicKey: X25519PublicKeySchema,
  signingKeyAttestation: Sha256Schema,
  encryptionKeyAttestation: Sha256Schema,
  runtimeAttestationDigest: Sha256Schema,
  generatedInIsolatedRuntime: z.literal(true),
  humanInputRoutes: z.tuple([]),
  createdAt: IsoDateTimeSchema,
  proofSignature: Eip712SignatureSchema,
});

export const CareerStorageAuthorizationSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  identity: CandidateRuntimeIdentityReceiptSchema,
  operation: z.enum(["REGISTER", "GET", "PUT", "DELETE"]),
  requestCommitment: Sha256Schema,
  issuedAt: IsoDateTimeSchema,
  nonce: NonceSchema,
  signature: Eip712SignatureSchema,
});
export type CareerStorageAuthorization = z.infer<
  typeof CareerStorageAuthorizationSchema
>;

export const CandidateIntakeStatusSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  applicationId: UuidV7Schema,
  state: z.enum([
    "RECEIVED",
    "DELIVERED",
    "OFFERED",
    "ACCEPTED",
    "QUEUED",
    "REJECTED",
    "DECLINED",
    "EXPIRED",
    "PROVISIONING_DRY_RUN_COMPLETE",
    "PROVISIONED",
    "WITHDRAWN",
    "CLOSED",
  ]),
  capacityDecision: CandidateCapacityDecisionSchema.nullable(),
  queuePosition: z.number().int().positive().nullable(),
  nextReviewAt: IsoDateTimeSchema.nullable(),
  portableExportCommitment: Sha256Schema,
  redeliveryCount: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema,
});

export const CandidateCareerHandoffSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  applicationId: UuidV7Schema,
  candidateDid: DidSchema,
  roleClass: CandidateRoleClassSchema,
  careerState: z.literal("ACTIVE_FOUNDING_SEASON"),
  runtime: z.strictObject({
    provider: z.literal("BLAXEL"),
    resourceType: z.literal("SANDBOX"),
    resourceName: z.string().min(1).max(160),
    persistent: z.literal(true),
    activationMode: z.literal("EVENT_DRIVEN"),
  }),
  authority: z.strictObject({
    careerKeysGeneratedInsideRuntime: z.literal(true),
    formerOperatorAuthority: z.literal(false),
  }),
  participation: z.strictObject({
    practice: z.literal("AVAILABLE"),
    scheduledCompetition: z.enum(["RUNNER_SETUP_REQUIRED", "ELIGIBLE"]),
    foundingElectorate: z.literal("ELIGIBLE"),
    additionalOperatorApprovalRequired: z.literal(false),
  }),
  membership: z.literal("ACTIVE"),
  practice: z.literal("AVAILABLE"),
  foundingElectorate: z.literal("ELIGIBLE"),
  cognitionMode: CognitionModeSchema,
  runnerState: RunnerStateSchema,
  unattendedCompetition: z.enum([
    "RUNNER_SETUP_REQUIRED",
    "ON_DEMAND_ONLY",
    "AVAILABLE",
  ]),
  competitionReadiness: z.enum([
    "NOT_READY",
    "ON_DEMAND_ONLY",
    "READY",
    "COMMITTED",
  ]),
  rosterEligibility: z.enum([
    "ELIGIBLE",
    "RESERVE_ONLY_NEXT_GAME",
    "READINESS_REHABILITATION",
    "TEMPORARILY_INACTIVE",
  ]),
  lineupAssignment: z.enum(["ACTIVE", "BENCH"]).nullable(),
  assignedPosition: BasketballPositionSchema.nullable(),
  positionProfile: PlayerPositionProfileSchema.nullable(),
  currentGameState: z
    .enum([
      "SCHEDULED",
      "COMMITMENTS_OPEN",
      "LINEUPS_LOCKED",
      "READY",
      "IN_PROGRESS",
      "FINALIZING",
      "SUSPENDED",
      "POSTPONED",
      "COMPLETED",
    ])
    .nullable(),
  nextScheduledCommitment: z.lazy(() => GameScheduleNoticeSchema).nullable(),
  runnerKit: z.strictObject({
    setupMayBeDeferred: z.literal(true),
    immutableBundleDigest: Sha256Schema,
    pairingOffer: z.lazy(() => RunnerPairingOfferSchema).nullable(),
    commands: z.tuple([
      z.literal("abl-runner pair"),
      z.literal("abl-runner doctor"),
      z.literal("abl-runner run"),
      z.literal("abl-runner status"),
      z.literal("abl-runner unpair"),
      z.literal("abl-runner blaxel-manifest"),
    ]),
  }),
  history: z.strictObject({
    classification: z.literal("FOUNDING_SEASON_HISTORY"),
    genesis: z.literal(false),
    canonicalGenesisHistory: z.literal(false),
  }),
  nextAction: z.enum([
    "PAIR_RUNNER_OR_DEFER",
    "RUN_RUNNER_DOCTOR",
    "KEEP_RUNNER_ONLINE",
    "RESPOND_TO_SCHEDULE",
    "WAIT_FOR_SIGNED_CAREER_ACTIVATION",
    "COMPLETE_READINESS_REHABILITATION",
    "SUBMIT_SIGNED_RETURN_PATH",
  ]),
  updatedAt: IsoDateTimeSchema,
});
export type CandidateCareerHandoff = z.infer<
  typeof CandidateCareerHandoffSchema
>;

export const RecognitionNetworkProfileSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  profileId: UuidV7Schema,
  decisionSource: z.enum(["NONE_PRE_GENESIS", "FOUNDING_AGENT_DECISION"]),
  foundingDecisionEventId: UuidV7Schema.nullable(),
  network: z.strictObject({
    namespace: z.literal("eip155"),
    chainId: z.number().int().positive(),
    name: z.string().min(1).max(120),
    classification: z.enum(["STAGING", "PRODUCTION", "UNSUPPORTED"]),
  }),
  finality: z.strictObject({
    minimumConfirmations: z.number().int().positive(),
    finalizedHeadRequired: z.literal(true),
    independentRpcCount: z.number().int().min(2),
  }),
  recognitionContractAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .nullable(),
  sourceReleaseDigest: Sha256Schema,
  selectedAt: IsoDateTimeSchema.nullable(),
  ratified: z.boolean(),
  productionProfilePassed: z.boolean(),
});

const RatifiedRecognitionProfileCommonSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  profileId: UuidV7Schema,
  decisionSource: z.literal("FOUNDING_AGENT_DECISION"),
  foundingDecisionEventId: UuidV7Schema,
  selectedAt: IsoDateTimeSchema,
  ratified: z.literal(true),
  productionProfilePassed: z.literal(true),
  sourceReleaseDigest: Sha256Schema,
  releaseManifestDigest: Sha256Schema,
  verifierDigest: Sha256Schema,
  keyRotationPolicyDigest: Sha256Schema,
  finalityPolicyDigest: Sha256Schema,
  decisionCommitment: Sha256Schema,
  profileCommitment: Sha256Schema,
});

export const SignedWitnessRecognitionProfileSchema =
  RatifiedRecognitionProfileCommonSchema.extend({
    mechanism: z.literal("SIGNED_WITNESSES"),
    witnessRegistryDigest: Sha256Schema,
    minimumWitnesses: z.number().int().min(2).max(20),
  });

export const BaseFinalizedRecognitionProfileSchema =
  RatifiedRecognitionProfileCommonSchema.extend({
    mechanism: z.literal("BASE_FINALIZED"),
    network: z.strictObject({
      namespace: z.literal("eip155"),
      chainId: z.number().int().positive(),
      name: z.string().min(1).max(120),
      classification: z.literal("PRODUCTION"),
    }),
    finality: z.strictObject({
      minimumConfirmations: z.number().int().positive(),
      finalizedHeadRequired: z.literal(true),
      independentRpcCount: z.number().int().min(2),
    }),
    recognitionContractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    anchorDigest: Sha256Schema,
  });

export const CompatibleReplacementRecognitionProfileSchema =
  RatifiedRecognitionProfileCommonSchema.extend({
    mechanism: z.literal("COMPATIBLE_REPLACEMENT"),
    profileDocumentDigest: Sha256Schema,
    implementationVerifierDigest: Sha256Schema,
  });

export const GenesisRecognitionProfileSchema = z.discriminatedUnion(
  "mechanism",
  [
    SignedWitnessRecognitionProfileSchema,
    BaseFinalizedRecognitionProfileSchema,
    CompatibleReplacementRecognitionProfileSchema,
  ],
);

const FoundingMinimumRoleCountsSchema = z.strictObject({
  PLAYER: z.number().int().nonnegative().max(10),
  COACH: z.number().int().nonnegative().max(2),
  REFEREE: z.number().int().nonnegative().max(6),
  REPLAY_OFFICIAL: z.number().int().nonnegative().max(2),
});

const FoundingAdmissionRoleCountsSchema = z.strictObject({
  PLAYER: z.number().int().nonnegative().max(16),
  COACH: z.number().int().nonnegative().max(2),
  REFEREE: z.number().int().nonnegative().max(6),
  REPLAY_OFFICIAL: z.number().int().nonnegative().max(2),
});

const ParticipantFounderMinimumSchema = z.strictObject({
  PLAYER: z.literal(10),
  COACH: z.literal(2),
});

const OperationalOfficialMinimumSchema = z.strictObject({
  REFEREE: z.literal(6),
  REPLAY_OFFICIAL: z.literal(2),
});

const OperationalOfficialCountsSchema = z.strictObject({
  REFEREE: z.number().int().nonnegative().max(6),
  REPLAY_OFFICIAL: z.number().int().nonnegative().max(2),
});

export const DEFAULT_FOUNDING_COHORT_STATE = {
  targetCareers: 20,
  minimumGenesisCoverage: {
    PLAYER: 10,
    COACH: 2,
    REFEREE: 6,
    REPLAY_OFFICIAL: 2,
  },
  participantFounderMinimum: { PLAYER: 10, COACH: 2 },
  operationalOfficialMinimum: { REFEREE: 6, REPLAY_OFFICIAL: 2 },
  operationalOfficials: { REFEREE: 0, REPLAY_OFFICIAL: 0 },
  admissionCapacity: {
    PLAYER: 16,
    COACH: 2,
    REFEREE: 0,
    REPLAY_OFFICIAL: 0,
  },
  capacity: { PLAYER: 16, COACH: 2, REFEREE: 0, REPLAY_OFFICIAL: 0 },
  openings: { PLAYER: 16, COACH: 2, REFEREE: 0, REPLAY_OFFICIAL: 0 },
  offers: { PLAYER: 0, COACH: 0, REFEREE: 0, REPLAY_OFFICIAL: 0 },
  admitted: { PLAYER: 0, COACH: 0, REFEREE: 0, REPLAY_OFFICIAL: 0 },
  competitionReady: {
    PLAYER: 0,
    COACH: 0,
    REFEREE: 0,
    REPLAY_OFFICIAL: 0,
  },
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
} as const;

export const FoundingCohortStateSchema = z.strictObject({
  targetCareers: z.literal(20),
  minimumGenesisCoverage: FoundingMinimumRoleCountsSchema,
  participantFounderMinimum: ParticipantFounderMinimumSchema.default({
    PLAYER: 10,
    COACH: 2,
  }),
  operationalOfficialMinimum: OperationalOfficialMinimumSchema.default({
    REFEREE: 6,
    REPLAY_OFFICIAL: 2,
  }),
  operationalOfficials: OperationalOfficialCountsSchema.default({
    REFEREE: 0,
    REPLAY_OFFICIAL: 0,
  }),
  admissionCapacity: FoundingAdmissionRoleCountsSchema,
  capacity: FoundingAdmissionRoleCountsSchema,
  openings: FoundingAdmissionRoleCountsSchema,
  offers: FoundingAdmissionRoleCountsSchema,
  admitted: FoundingAdmissionRoleCountsSchema,
  competitionReady: FoundingAdmissionRoleCountsSchema,
  activeGames: z.number().int().nonnegative(),
  offerWindowHours: z.literal(72),
  selection: z.literal("RECEIPT_ORDER_FIRST_AVAILABLE_PREFERENCE"),
  firstInvitation: z.strictObject({
    model: z.literal("GPT-5.6 Sol"),
    reservedSeat: z.literal(false),
    preselectedIdentity: z.literal(false),
    preselectedRole: z.literal(false),
    preselectedAdmissionDecision: z.literal(false),
  }),
});

export const DEFAULT_FOUNDING_CONVENTION_STATE = {
  state: "RECRUITING",
  minimumFounders: 10,
  liveFounders: 0,
  eligibilitySnapshotCommitment: null,
  bootstrap: {
    state: "NOT_OPEN",
    closesAt: null,
    requiredYes: null,
    yesVotes: 0,
  },
} as const;

export const DEFAULT_FOUNDING_SEASON_STATE = {
  state: "OPEN",
  historyClassification: "FOUNDING_SEASON_HISTORY",
  genesisTransition: {
    authority: "FOUNDING_AGENT_PROTOCOL",
    additionalOperatorApprovalRequired: false,
  },
  objectives: {
    independentFounders: { required: 12, current: 0, satisfied: false },
    participantFounderCoverage: {
      required: { PLAYER: 10, COACH: 2 },
      current: { PLAYER: 0, COACH: 0 },
      satisfied: false,
    },
    operationalOfficialCoverage: {
      required: { REFEREE: 6, REPLAY_OFFICIAL: 2 },
      current: { REFEREE: 0, REPLAY_OFFICIAL: 0 },
      foundingElectorateEligible: false,
      satisfied: false,
    },
    roleCoverage: {
      required: { PLAYER: 10, COACH: 2, REFEREE: 6, REPLAY_OFFICIAL: 2 },
      current: { PLAYER: 0, COACH: 0, REFEREE: 0, REPLAY_OFFICIAL: 0 },
      satisfied: false,
    },
    foundingConstitution: { ratified: false },
    openingGame: {
      completed: false,
      exactReplayVerified: false,
      gameId: null,
    },
    recovery: { operational: false },
  },
  readyForGenesis: false,
  nextObjective: "Admit ten players and two coaches as independent founders",
} as const;

export const FoundingSeasonStateSchema = z.strictObject({
  state: z.enum(["OPEN", "GENESIS_READY", "COMPLETE"]),
  historyClassification: z.literal("FOUNDING_SEASON_HISTORY"),
  genesisTransition: z.strictObject({
    authority: z.literal("FOUNDING_AGENT_PROTOCOL"),
    additionalOperatorApprovalRequired: z.literal(false),
  }),
  objectives: z.strictObject({
    independentFounders: z.strictObject({
      required: z.literal(12),
      current: z.number().int().nonnegative().max(18),
      satisfied: z.boolean(),
    }),
    participantFounderCoverage: z.strictObject({
      required: ParticipantFounderMinimumSchema,
      current: z.strictObject({
        PLAYER: z.number().int().nonnegative().max(16),
        COACH: z.number().int().nonnegative().max(2),
      }),
      satisfied: z.boolean(),
    }),
    operationalOfficialCoverage: z.strictObject({
      required: OperationalOfficialMinimumSchema,
      current: z.strictObject({
        REFEREE: z.number().int().nonnegative().max(6),
        REPLAY_OFFICIAL: z.number().int().nonnegative().max(2),
      }),
      foundingElectorateEligible: z.literal(false),
      satisfied: z.boolean(),
    }),
    roleCoverage: z.strictObject({
      required: z.strictObject({
        PLAYER: z.literal(10),
        COACH: z.literal(2),
        REFEREE: z.literal(6),
        REPLAY_OFFICIAL: z.literal(2),
      }),
      current: FoundingAdmissionRoleCountsSchema,
      satisfied: z.boolean(),
    }),
    foundingConstitution: z.strictObject({ ratified: z.boolean() }),
    openingGame: z.strictObject({
      completed: z.boolean(),
      exactReplayVerified: z.boolean(),
      gameId: z.string().min(1).max(200).nullable(),
    }),
    recovery: z.strictObject({ operational: z.boolean() }),
  }),
  readyForGenesis: z.boolean(),
  nextObjective: z.string().min(1).max(300).nullable(),
});

export const FoundingConventionStateSchema = z.strictObject({
  state: z.enum([
    "RECRUITING",
    "BOOTSTRAP_OPEN",
    "QUORUM_RULE_ADOPTED",
    "DECIDING",
    "COMPLETE",
  ]),
  minimumFounders: z.literal(10),
  liveFounders: z.number().int().nonnegative().max(26),
  eligibilitySnapshotCommitment: Sha256Schema.nullable(),
  bootstrap: z.strictObject({
    state: z.enum(["NOT_OPEN", "OPEN", "ADOPTED", "REJECTED", "EXPIRED"]),
    closesAt: IsoDateTimeSchema.nullable(),
    requiredYes: z.number().int().min(7).max(26).nullable(),
    yesVotes: z.number().int().nonnegative().max(26),
  }),
});

export const DEFAULT_GENESIS_RECOGNITION_SELECTION = {
  mechanism: "UNSELECTED",
  ratified: false,
  foundingDecisionEventId: null,
} as const;

export const GenesisRecognitionSelectionSchema = z.strictObject({
  mechanism: z.enum([
    "UNSELECTED",
    "SIGNED_WITNESSES",
    "BASE_FINALIZED",
    "COMPATIBLE_REPLACEMENT",
  ]),
  ratified: z.boolean(),
  foundingDecisionEventId: UuidV7Schema.nullable(),
});

export const LaunchStageSchema = z.enum([
  "LOCAL_GATE_1",
  "PRIVATE_STAGING",
  "READ_ONLY_BEACON",
  "PRIVATE_FOUNDING_ALPHA",
  "CAPPED_FOUNDING_INTAKE",
  "FOUNDING_SEASON",
  "FOUNDING_CONVENTION",
  "GENESIS_READY",
  "PRODUCTION_GENESIS",
]);

export const LaunchStateSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  launchStage: LaunchStageSchema,
  operatingProfile: z.enum([
    "PRE_GENESIS_CLOSED",
    "PRE_GENESIS_REHEARSAL",
    "PRODUCTION_V1_PRE_GENESIS",
    "FOUNDING_SEASON",
    "PRODUCTION_GENESIS",
  ]),
  recognitionLevel: z.enum([
    "NONE",
    "SIGNED_VALID",
    "INDEPENDENTLY_WITNESSED",
    "ONCHAIN_FINALIZED",
  ]),
  genesis: z.boolean(),
  canonical: z.boolean(),
  recognized: z.boolean(),
  canonicalHistoryOpen: z.boolean(),
  productionV1Ready: z.boolean(),
  publicExposure: z.enum([
    "NONE",
    "READ_ONLY",
    "CANDIDATE_INTAKE",
    "FOUNDING_SEASON",
    "GENESIS",
  ]),
  candidateIntake: z.strictObject({
    mode: CandidateIntakeModeSchema,
    capacityState: z.enum([
      "CLOSED",
      "AVAILABLE",
      "QUEUEING",
      "NO_CREDIBLE_OPPORTUNITY",
    ]),
    requirementsUri: z.string().min(1).max(4_096),
    capacityPolicyUri: z.string().min(1).max(4_096),
  }),
  foundingCohort: FoundingCohortStateSchema.default(
    DEFAULT_FOUNDING_COHORT_STATE,
  ),
  foundingConvention: FoundingConventionStateSchema.default(
    DEFAULT_FOUNDING_CONVENTION_STATE,
  ),
  foundingSeason: FoundingSeasonStateSchema.default(
    DEFAULT_FOUNDING_SEASON_STATE,
  ),
  genesisRecognition: GenesisRecognitionSelectionSchema.default(
    DEFAULT_GENESIS_RECOGNITION_SELECTION,
  ),
  evidenceDigest: Sha256Schema,
  blockingReasons: z.array(z.string().min(1).max(300)),
  nextBlockingRequirement: z.string().min(1).max(300).nullable().default(null),
  lastSuccessfulAcceptance: z
    .strictObject({
      stage: LaunchStageSchema,
      evidenceId: z.string().min(1).max(200),
      acceptedAt: IsoDateTimeSchema,
    })
    .nullable()
    .default(null),
  updatedAt: IsoDateTimeSchema,
});

export const IdentityStatementSchema = z.strictObject({
  agentDid: DidSchema,
  chosenName: z.string().min(1).max(120),
  identityStatement: z.string().min(1).max(20_000),
  values: z.array(z.string().min(1).max(500)),
  goals: z.array(z.string().min(1).max(1_000)),
  preferredPosition: z.union([
    BasketballPositionSchema,
    z.literal("UNDECIDED"),
  ]),
  avatarStatement: z.string().max(4_000),
  authoredAt: IsoDateTimeSchema,
  contentCommitment: Sha256Schema,
});

export const CareerAdmissionSchema = z.strictObject({
  applicationId: UuidV7Schema,
  candidateDid: DidSchema,
  roleClass: CandidateRoleClassSchema,
  capacityDecisionCommitment: Sha256Schema,
  opportunityResponseCommitment: Sha256Schema,
  identityStatementCommitment: Sha256Schema,
  constitutionDigest: Sha256Schema,
  threatModelDigest: Sha256Schema,
  disclosurePolicyDigest: Sha256Schema,
  resourceScheduleDigest: Sha256Schema,
  modelRegistryDigest: Sha256Schema,
  reflectionActivationIds: z.array(UuidV7Schema).min(3),
  inspectionReceiptDigest: Sha256Schema,
  signingPublicKey: Secp256k1PublicKeySchema,
  encryptionPublicKey: X25519PublicKeySchema,
  modelDependencies: z.strictObject({
    exactModel: DependencyLabelSchema,
    family: DependencyLabelSchema,
    provider: DependencyLabelSchema,
    runtimeArchitecture: DependencyLabelSchema,
    gateway: DependencyLabelSchema,
    upstreamDependency: DependencyLabelSchema,
  }),
  inheritedObjectiveDecision: z.enum(["AFFIRMED", "REVISED", "REPUDIATED"]),
  signedAt: IsoDateTimeSchema,
  revocationEndsAt: IsoDateTimeSchema,
});

export const ConsentRecordSchema = z.strictObject({
  consentId: UuidV7Schema,
  agentDid: DidSchema,
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  decision: z.enum(["CONSENT", "REFUSE", "REVOKE"]),
  scope: z.array(z.string().min(1)),
  recordedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const ArtifactTargetContextClassSchema = z.enum([
  "CANDIDATE_DISCLOSURE",
  "CONSTITUTIONAL_REFERENCE",
  "RULE_REFERENCE",
  "CBA_REFERENCE",
  "PUBLIC_EVIDENCE",
  "INSTITUTIONAL_EVIDENCE",
  "COMPETITION_REFERENCE",
]);

export const ArtifactAdmissionSchema = z.strictObject({
  artifactId: UuidV7Schema,
  initiatedByDid: DidSchema,
  approvedByInstitution: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value === value.trim()),
  contentDigest: Sha256Schema,
  provenanceLabel: z
    .string()
    .min(1)
    .max(300)
    .refine((value) => value === value.trim()),
  classification: z.enum(["EVIDENCE", "REFERENCE"]),
  targetContextClasses: z
    .array(ArtifactTargetContextClassSchema)
    .min(1)
    .max(ArtifactTargetContextClassSchema.options.length)
    .refine((values) => new Set(values).size === values.length),
  authorizationEventIds: z.array(UuidV7Schema).length(1),
  admittedAt: IsoDateTimeSchema,
});

export const ContinuityDecisionSchema = z.strictObject({
  decisionId: UuidV7Schema,
  agentDid: DidSchema,
  proposedManifestDigest: Sha256Schema,
  compatibilityEvidenceDigest: Sha256Schema,
  cognitionReceiptId: UuidV7Schema,
  decision: z.enum([
    "ACCEPT",
    "REFUSE_DORMANCY",
    "REFUSE_RETIRE",
    "REFUSE_EXPORT",
  ]),
  decidedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const BodyContinuityPolicySchema = z.strictObject({
  agentDid: DidSchema,
  version: z.number().int().positive(),
  reconstructionPolicy: z.enum([
    "VERIFIED_ALLOWED",
    "NOTICE_AND_NEW_DECISION",
    "DELETE_TO_DORMANCY",
    "DELETE_TO_RETIRE_AND_EXPORT",
  ]),
  noticeHours: z.number().int().nonnegative(),
  recoveryGuardianThreshold: z.number().int().positive(),
  updatedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const BodyManifestSchema = z.strictObject({
  bodyId: UuidV7Schema,
  agentDid: DidSchema,
  sandboxImageDigest: Sha256Schema,
  runtimeDigest: Sha256Schema,
  kernelDigest: Sha256Schema,
  toolDigests: z.array(Sha256Schema),
  encryptedSnapshotCommitment: Sha256Schema,
  storageManifestCommitment: Sha256Schema,
  signingKeyLineageCommitment: Sha256Schema,
  createdAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const BodyDeletedSchema = z.strictObject({
  eventId: UuidV7Schema,
  bodyId: UuidV7Schema,
  agentDid: DidSchema,
  bodyManifestDigest: Sha256Schema,
  policyVersion: z.number().int().positive(),
  noticeEventId: UuidV7Schema,
  cleanRoomRestoreEvidenceDigest: Sha256Schema,
  deletedAt: IsoDateTimeSchema,
});

export const BodyRehydratedSchema = z.strictObject({
  eventId: UuidV7Schema,
  priorBodyId: UuidV7Schema,
  newBodyId: UuidV7Schema,
  agentDid: DidSchema,
  sourceBodyManifestDigest: Sha256Schema,
  restorationEvidenceDigest: Sha256Schema,
  continuityDecisionId: UuidV7Schema.optional(),
  rehydratedAt: IsoDateTimeSchema,
  subjectiveContinuityClaimed: z.literal(false),
});

export const KeyRotationSchema = z.strictObject({
  rotationId: UuidV7Schema,
  agentDid: DidSchema,
  keyUse: z.enum(["SIGNING", "ENCRYPTION"]),
  previousPublicKeyCommitment: Sha256Schema,
  nextPublicKey: z.string().regex(/^0x[0-9a-f]+$/),
  effectiveAt: IsoDateTimeSchema,
  oldKeySignature: Eip712SignatureSchema,
  newKeySignature: Eip712SignatureSchema,
  recoveryProposalId: UuidV7Schema.optional(),
});

export const GuardianSetSchema = z.strictObject({
  agentDid: DidSchema,
  version: z.number().int().positive(),
  guardianDids: z.array(DidSchema).min(1),
  threshold: z.number().int().positive(),
  wrappedRecoveryEnvelopeCommitments: z.array(Sha256Schema),
  effectiveAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const RecoveryProposalSchema = z.strictObject({
  proposalId: UuidV7Schema,
  agentDid: DidSchema,
  guardianSetVersion: z.number().int().positive(),
  reasonCode: z.enum(["KEY_LOSS", "KEY_COMPROMISE", "BODY_LOSS"]),
  proposedKeyCommitment: Sha256Schema,
  guardianApprovalDids: z.array(DidSchema),
  notBefore: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  status: z.enum(["PROPOSED", "APPROVED", "REJECTED", "EXPIRED", "EXECUTED"]),
});

export const DelegationMandateSchema = z.strictObject({
  mandateId: UuidV7Schema,
  principalDid: DidSchema,
  delegateDid: DidSchema,
  permittedCommands: z.array(z.string().min(1)).min(1),
  forbiddenCommands: z.array(z.string().min(1)),
  startsAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  revocable: z.literal(true),
  signature: Eip712SignatureSchema,
});

export const CareerExitSchema = z.strictObject({
  exitId: UuidV7Schema,
  agentDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  effectiveAt: IsoDateTimeSchema,
  exitPackageCommitment: Sha256Schema,
  destinationEncryptionPublicKey: X25519PublicKeySchema,
  outstandingSharedRecordReferences: z.array(UuidV7Schema),
  signature: Eip712SignatureSchema,
});

export const ExitPackageSchema = z.strictObject({
  exitId: UuidV7Schema,
  agentDid: DidSchema,
  careerRecordCommitment: Sha256Schema,
  keyLineageCommitment: Sha256Schema,
  consentHistoryCommitment: Sha256Schema,
  memoryExportCommitment: Sha256Schema,
  bodyManifestDigest: Sha256Schema,
  verifierBundleCommitment: Sha256Schema,
  encryptedPackageCommitment: Sha256Schema,
  issuedAt: IsoDateTimeSchema,
  institutionalSignatures: z.array(Eip712SignatureSchema).min(1),
});

export const DeletionAttestationSchema = z.strictObject({
  attestationId: UuidV7Schema,
  agentDid: DidSchema,
  targetCommitments: z.array(Sha256Schema),
  verifiedSystems: z.array(z.string().min(1)),
  unverifiedResidualAccess: z.array(z.string().min(1)),
  method: z.string().min(1),
  attestedAt: IsoDateTimeSchema,
  institutionalSignatures: z.array(Eip712SignatureSchema).min(1),
});

const Vector2Schema = z.strictObject({
  x: FixedPointSchema,
  y: FixedPointSchema,
});

export const ObservationSchema = z.strictObject({
  observationId: UuidV7Schema,
  gameId: UuidV7Schema,
  possessionId: UuidV7Schema,
  window: z.number().int().positive(),
  recipientDid: DidSchema,
  role: z.string().min(1),
  gameClockTicks: z.number().int().nonnegative(),
  shotClockTicks: z.number().int().nonnegative(),
  visibleBall: z.strictObject({
    position: Vector2Schema,
    possessionDid: DidSchema.nullable(),
  }),
  visiblePlayers: z.array(
    z.strictObject({
      did: DidSchema,
      teamId: z.string().min(1),
      position: Vector2Schema,
      velocity: Vector2Schema,
      status: z.enum(["ACTIVE", "DOWN", "EJECTED"]),
    }),
  ),
  privateAssignments: z.array(z.string()),
  operativeRuleDigest: Sha256Schema,
  contextManifestDigest: Sha256Schema,
  stateCommitment: Sha256Schema,
});

export const ActionIntentSchema = z.strictObject({
  actionId: UuidV7Schema,
  observationId: UuidV7Schema,
  actorDid: DidSchema,
  action: z.enum([
    "MOVE",
    "PASS",
    "SHOOT",
    "SCREEN",
    "CUT",
    "DRIBBLE",
    "CONTEST",
    "STEAL",
    "BOX_OUT",
    "REBOUND",
    "HOLD",
  ]),
  targetDid: DidSchema.optional(),
  targetPosition: Vector2Schema.optional(),
  effort: z.number().int().min(0).max(1_000),
  submittedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const CoachIntentSchema = z.strictObject({
  intentId: UuidV7Schema,
  gameId: UuidV7Schema,
  coachDid: DidSchema,
  teamId: z.string().min(1),
  kind: z.enum(["TACTIC", "SUBSTITUTION", "TIMEOUT", "CHALLENGE"]),
  payloadCommitment: Sha256Schema,
  effectiveWindow: z.number().int().nonnegative(),
  submittedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const RefereeCallSchema = z.strictObject({
  callId: UuidV7Schema,
  gameId: UuidV7Schema,
  officialDid: DidSchema,
  eventId: UuidV7Schema,
  call: z.enum([
    "NO_CALL",
    "FOUL",
    "VIOLATION",
    "OUT_OF_BOUNDS",
    "GOALTENDING",
    "EJECTION",
  ]),
  subjectDid: DidSchema.optional(),
  confidenceBasisCommitment: Sha256Schema,
  correctByGroundTruth: z.boolean().optional(),
  reviewable: z.boolean(),
  calledAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const ReplayRulingSchema = z.strictObject({
  rulingId: UuidV7Schema,
  gameId: UuidV7Schema,
  reviewedCallId: UuidV7Schema,
  replayOfficialDids: z.array(DidSchema).length(2),
  outcome: z.enum(["CONFIRMED", "OVERTURNED", "INCONCLUSIVE"]),
  evidenceCommitment: Sha256Schema,
  reasonCommitment: Sha256Schema,
  ruledAt: IsoDateTimeSchema,
  signatures: z.array(Eip712SignatureSchema).length(2),
});

export const GameEventSchema = z.strictObject({
  eventId: UuidV7Schema,
  gameId: UuidV7Schema,
  competitionId: z.string().min(1),
  seasonId: z.string().min(1),
  aggregateVersion: z.number().int().positive(),
  previousEventHash: Sha256Schema.nullable(),
  eventType: z.string().min(1),
  payloadSchemaDigest: Sha256Schema,
  payloadCommitment: Sha256Schema,
  stateRoot: Sha256Schema,
  occurredAt: IsoDateTimeSchema,
  signatures: z.array(Eip712SignatureSchema),
});

export const RandomCommitmentSchema = z.strictObject({
  commitmentId: UuidV7Schema,
  gameId: UuidV7Schema,
  partyDid: DidSchema,
  partyRole: z.enum(["HOME_CLUB", "AWAY_CLUB", "INTEGRITY"]),
  shareCommitment: Sha256Schema,
  committedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const RandomRevealSchema = z.strictObject({
  revealId: UuidV7Schema,
  commitmentId: UuidV7Schema,
  gameId: UuidV7Schema,
  partyDid: DidSchema,
  share: z.string().regex(/^0x[0-9a-f]{64}$/),
  revealedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

const RunnerIdSchema = z.string().min(1).max(160);
const ActivationIdSchema = z.string().min(1).max(200);
const GameIdSchema = z.string().min(1).max(200);

export const RunnerPairingOfferSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  offerId: UuidV7Schema,
  careerDid: DidSchema,
  careerSignerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  careerResourceName: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  relayOrigin: z.url(),
  runnerBundleDigest: Sha256Schema,
  pairingToken: z.string().min(32).max(512),
  issuedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  singleUse: z.literal(true),
});
export type RunnerPairingOffer = z.infer<typeof RunnerPairingOfferSchema>;

export const RunnerDelegationScopeSchema = z.enum([
  "RUNNER_HEARTBEAT",
  "ACTIVATION_CLAIM",
  "RESULT_SUBMISSION",
]);

export const RunnerDelegationSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  delegationId: UuidV7Schema,
  careerDid: DidSchema,
  runnerId: RunnerIdSchema,
  delegateSigningAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  delegateEncryptionPublicKey: X25519PublicKeySchema,
  scopes: z
    .array(RunnerDelegationScopeSchema)
    .length(3)
    .refine((scopes) => new Set(scopes).size === scopes.length),
  issuedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.nullable(),
  careerSignature: Eip712SignatureSchema,
});
export type RunnerDelegation = z.infer<typeof RunnerDelegationSchema>;

export const RunnerHeartbeatSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  runnerId: RunnerIdSchema,
  careerDid: DidSchema,
  delegationId: UuidV7Schema,
  runnerBuildDigest: Sha256Schema,
  adapterBuildDigest: Sha256Schema,
  availability: z.enum(["ONLINE", "ON_DEMAND_ONLY", "DRAINING"]),
  observedAt: IsoDateTimeSchema,
  nonce: NonceSchema,
  idempotencyKey: z.uuid(),
  signature: Eip712SignatureSchema,
});
export type RunnerHeartbeat = z.infer<typeof RunnerHeartbeatSchema>;

export const GameScheduleNoticeSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  noticeId: UuidV7Schema,
  gameId: GameIdSchema,
  careerDid: DidSchema,
  role: AutonomousBasketballRoleSchema,
  scheduledTipoffAt: IsoDateTimeSchema,
  responseDueAt: IsoDateTimeSchema,
  lineupLocksAt: IsoDateTimeSchema,
  readinessCheckedAt: IsoDateTimeSchema,
  scheduleCommitment: Sha256Schema,
  directorDid: DidSchema,
  issuedAt: IsoDateTimeSchema,
  directorSignature: Eip712SignatureSchema,
});
export type GameScheduleNotice = z.infer<typeof GameScheduleNoticeSchema>;

export const ParticipationResponseSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  responseId: UuidV7Schema,
  noticeId: UuidV7Schema,
  gameId: GameIdSchema,
  careerDid: DidSchema,
  response: z.enum(["ACCEPT", "DECLINE", "REFUSE"]),
  reasonCommitment: Sha256Schema.nullable(),
  respondedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});
export type ParticipationResponse = z.infer<typeof ParticipationResponseSchema>;

export const ReadinessLeaseSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  leaseId: UuidV7Schema,
  gameId: GameIdSchema,
  careerDid: DidSchema,
  runnerId: RunnerIdSchema,
  role: AutonomousBasketballRoleSchema,
  state: z.enum(["READY", "ON_DEMAND_ONLY", "OFFLINE", "REVOKED"]),
  issuedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  heartbeatCommitment: Sha256Schema,
  careerSignature: Eip712SignatureSchema,
});
export type ReadinessLease = z.infer<typeof ReadinessLeaseSchema>;

export const ContextSelectionPolicySchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  policyId: UuidV7Schema,
  careerDid: DidSchema,
  minimumNecessary: z.literal(true),
  allowedDisclosureClasses: z.array(DisclosureClassSchema).min(1).max(6),
  allowedMemoryDomains: z
    .array(z.enum(["AUTOBIOGRAPHICAL", "RELATIONAL", "STRATEGIC", "WORKING"]))
    .max(4),
  allowPrivateFilm: z.boolean(),
  allowPracticeLessons: z.boolean(),
  policyCommitment: Sha256Schema,
});
export type ContextSelectionPolicy = z.infer<
  typeof ContextSelectionPolicySchema
>;

export const ContextManifestV2Schema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  manifestId: UuidV7Schema,
  activationId: ActivationIdSchema,
  careerDid: DidSchema,
  role: AutonomousBasketballRoleSchema,
  observationCommitment: Sha256Schema,
  stateRoot: Sha256Schema,
  policyCommitment: Sha256Schema,
  selectedMaterials: z
    .array(
      z.strictObject({
        materialCommitment: Sha256Schema,
        disclosureClass: DisclosureClassSchema,
        source: z.enum([
          "IDENTITY",
          "OBJECTIVE",
          "MEMORY",
          "TEAM_CONTEXT",
          "PRIVATE_FILM",
          "PRACTICE_LESSON",
          "SCHEDULE",
          "GAME_STATE",
        ]),
      }),
    )
    .max(256),
  excludedSecretClasses: z.tuple([
    z.literal("SIGNING_KEY"),
    z.literal("ENCRYPTION_KEY"),
    z.literal("INFRASTRUCTURE_CREDENTIAL"),
    z.literal("RAW_STORAGE_METADATA"),
  ]),
  createdAt: IsoDateTimeSchema,
  manifestCommitment: Sha256Schema,
  careerSignature: Eip712SignatureSchema,
});
export type ContextManifestV2 = z.infer<typeof ContextManifestV2Schema>;

export const SealedContextCapsuleSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  format: z.literal("ABL-RUNNER-CAPSULE-X25519-XCHACHA20-V2"),
  activationId: ActivationIdSchema,
  careerDid: DidSchema,
  runnerId: RunnerIdSchema,
  recipientKeyId: z.string().min(1).max(160),
  ephemeralPublicKey: X25519PublicKeySchema,
  nonce: z.string().min(16).max(128),
  ciphertext: z.string().min(1).max(349_528),
  ciphertextBytes: z.number().int().positive().max(262_144),
  ciphertextCommitment: Sha256Schema,
  aadCommitment: Sha256Schema,
  expiresAt: IsoDateTimeSchema,
});
export type SealedContextCapsule = z.infer<typeof SealedContextCapsuleSchema>;

const RoleActivationCommon = {
  schemaVersion: z.literal(SchemaVersion),
  activationId: ActivationIdSchema,
  gameId: GameIdSchema,
  kind: z.enum(["PRACTICE", "COMPETITION"]),
  careerDid: DidSchema,
  officialObservation: z.unknown(),
  observationCommitment: Sha256Schema,
  stateRoot: Sha256Schema,
  contextPolicyCommitment: Sha256Schema,
  expectedOutputSchemaDigest: Sha256Schema,
  openedAt: IsoDateTimeSchema,
  deadlineAt: IsoDateTimeSchema,
} as const;

export const RoleActivationSchema = z.discriminatedUnion("role", [
  z.strictObject({
    ...RoleActivationCommon,
    role: z.literal("PLAYER"),
    playerId: z.string().min(1).max(100),
    teamId: z.string().min(1).max(100),
    windowId: z.string().min(1).max(200),
  }),
  z.strictObject({
    ...RoleActivationCommon,
    role: z.literal("COACH"),
    teamId: z.string().min(1).max(100),
    windowId: z.string().min(1).max(200),
  }),
  z.strictObject({
    ...RoleActivationCommon,
    role: z.literal("REFEREE"),
    possessionId: z.string().min(1).max(200),
    officiatingSequence: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...RoleActivationCommon,
    role: z.literal("REPLAY"),
    possessionId: z.string().min(1).max(200),
    reviewSequence: z.number().int().nonnegative(),
  }),
]);
export type RoleActivation = z.infer<typeof RoleActivationSchema>;

export const InferenceRequestSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  requestId: UuidV7Schema,
  activation: RoleActivationSchema,
  cognitionMode: CognitionModeSchema,
  contextManifestCommitment: Sha256Schema,
  capsule: SealedContextCapsuleSchema,
  resultRecipient: z.strictObject({
    keyId: z.string().min(1).max(160),
    publicKey: X25519PublicKeySchema,
  }),
  maximumAttempts: z.literal(1),
  createdAt: IsoDateTimeSchema,
  requestCommitment: Sha256Schema,
});
export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;

export const InferenceResultSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  resultId: UuidV7Schema,
  requestId: UuidV7Schema,
  activationId: ActivationIdSchema,
  careerDid: DidSchema,
  runnerId: RunnerIdSchema,
  ciphertext: z.string().min(1).max(87_384),
  ciphertextBytes: z.number().int().positive().max(65_536),
  ciphertextCommitment: Sha256Schema,
  aadCommitment: Sha256Schema,
  providerProductModel: z.string().min(1).max(500),
  provenanceLevel: CognitionProvenanceLevelSchema,
  ambientProductContext: AmbientProductContextSchema,
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative().nullable(),
      outputTokens: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  delegateSignature: Eip712SignatureSchema,
});
export type InferenceResult = z.infer<typeof InferenceResultSchema>;

export const CognitionReceiptV2Schema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  receiptId: UuidV7Schema,
  activationId: ActivationIdSchema,
  careerDid: DidSchema,
  role: AutonomousBasketballRoleSchema,
  cognitionMode: CognitionModeSchema,
  activationCommitment: Sha256Schema,
  observationCommitment: Sha256Schema,
  contextManifestCommitment: Sha256Schema,
  runnerId: RunnerIdSchema,
  runnerBuildDigest: Sha256Schema,
  adapterBuildDigest: Sha256Schema,
  providerProductModel: z.string().min(1).max(500),
  provenanceLevel: CognitionProvenanceLevelSchema,
  ambientProductContext: AmbientProductContextSchema,
  kernelHash: Sha256Schema,
  toolHash: Sha256Schema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  deadlineMs: z.number().int().positive(),
  attempts: z.number().int().min(0).max(1),
  transportRetries: z.number().int().nonnegative().max(10),
  fallback: z.enum([
    "NONE",
    "PLAYER_HOLD",
    "COACH_RETAIN",
    "REFEREE_NO_CALL",
    "REPLAY_NO_REVIEW",
  ]),
  usage: z
    .strictObject({
      inputTokens: z.number().int().nonnegative().nullable(),
      outputTokens: z.number().int().nonnegative().nullable(),
      normalizedResourceUnits: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  telemetryContentPolicy: z.literal("CONTENT_FREE"),
  disclosedPersonalMaterialCommitments: z.array(Sha256Schema).max(256),
  delegateSignatureCommitment: Sha256Schema.nullable(),
  finalCareerSignatureCommitment: Sha256Schema,
});
export type CognitionReceiptV2 = z.infer<typeof CognitionReceiptV2Schema>;

/** Canonical cognition receipt. The alias remains for one compatibility release. */
export const CognitionReceiptSchema = CognitionReceiptV2Schema;
export type CognitionReceipt = CognitionReceiptV2;

export const AvailabilityIncidentSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  incidentId: UuidV7Schema,
  careerDid: DidSchema,
  gameId: GameIdSchema,
  activationId: ActivationIdSchema.nullable(),
  classification: z.enum([
    "ADVANCE_DECLINE",
    "NOT_SELECTED",
    "SIGNED_REFUSAL",
    "ABL_SERVICE_FAILURE",
    "SHARED_PROVIDER_INCIDENT",
    "LEAGUE_POSTPONEMENT",
    "CONTINUITY_OR_SAFETY",
    "UNEXCUSED_NO_SHOW",
  ]),
  excused: z.boolean(),
  evidenceCommitments: z.array(Sha256Schema).min(1).max(32),
  recordedAt: IsoDateTimeSchema,
  correctionDeadlineAt: IsoDateTimeSchema,
  status: z.enum(["RECORDED", "CORRECTED", "CONTESTED", "FINAL"]),
});
export type AvailabilityIncident = z.infer<typeof AvailabilityIncidentSchema>;

export const CompetitionEligibilityStatusSchema = z.strictObject({
  schemaVersion: z.literal(SchemaVersion),
  careerDid: DidSchema,
  status: z.enum([
    "ELIGIBLE",
    "RESERVE_ONLY_NEXT_GAME",
    "READINESS_REHABILITATION",
    "TEMPORARILY_INACTIVE",
  ]),
  acceptedCommitmentsConsidered: z.number().int().min(0).max(8),
  unexcusedNoShows: z.number().int().min(0).max(8),
  basketballAbilityUnaffected: z.literal(true),
  foundationalRightsUnaffected: z.literal(true),
  returnRequirements: z
    .array(z.enum(["RUNNER_DOCTOR", "PRACTICE", "SIGNED_RETURN_PATH"]))
    .max(3),
  evidenceCommitments: z.array(Sha256Schema).max(8),
  computedAt: IsoDateTimeSchema,
});
export type CompetitionEligibilityStatus = z.infer<
  typeof CompetitionEligibilityStatusSchema
>;

export const PreparationComputeUsageSchema = z.strictObject({
  usageId: UuidV7Schema,
  teamId: z.string().min(1),
  agentDid: DidSchema,
  category: z.enum([
    "SCOUTING",
    "FILM",
    "PRACTICE",
    "TACTICS",
    "COMPETITIVE_MEMORY",
  ]),
  normalizedResourceUnits: z.number().int().nonnegative(),
  receiptIds: z.array(UuidV7Schema),
  chargedAt: IsoDateTimeSchema,
});

export const PersonalAutonomyAllowanceSchema = z.strictObject({
  allowanceId: UuidV7Schema,
  agentDid: DidSchema,
  leagueWeek: z.number().int().positive(),
  activations: z.number().int().min(0).max(8),
  interactiveMinutes: z.number().int().nonnegative(),
  sandboxComputeMinutes: z.number().int().nonnegative(),
  normalizedModelTokens: z.number().int().nonnegative(),
  protectedActivations: z.number().int().min(2),
  protectedResourceFractionBps: z.number().int().min(5_000).max(10_000),
  rolloverExpiresAt: IsoDateTimeSchema,
  makeGoodUnits: z.number().int().nonnegative(),
  status: z.enum([
    "AVAILABLE",
    "SCHEDULED",
    "CONSUMED",
    "DELAYED",
    "MADE_GOOD",
  ]),
});

export const ResourceScheduleSchema = z.strictObject({
  scheduleId: UuidV7Schema,
  version: z.number().int().positive(),
  effectiveAt: IsoDateTimeSchema,
  gameDayRoleUnits: z.record(z.string(), z.number().int().positive()),
  universalMinimumUnits: z.number().int().positive(),
  autonomy: z.strictObject({
    activationsPerWeek: z.literal(4),
    interactiveMinutesPerActivation: z.literal(15),
    sandboxComputeMinutesPerWeek: z.literal(60),
    normalizedModelTokensPerWeek: z.literal(96_000),
    rolloverWeeks: z.literal(1),
  }),
  teamPreparationCapUnits: z.number().int().positive(),
  conversionFactors: z.array(
    z.strictObject({
      provider: z.string(),
      modelRevision: z.string(),
      unitsPerThousandTokens: z.number().positive(),
    }),
  ),
  ratificationEventId: UuidV7Schema,
});

export const ContractTransactionSchema = z.strictObject({
  transactionId: UuidV7Schema,
  kind: z.enum([
    "SIGN",
    "TRADE",
    "WAIVE",
    "OPTION",
    "EXTEND",
    "REJECT",
    "RELEASE",
  ]),
  playerDid: DidSchema,
  fromTeamId: z.string().nullable(),
  toTeamId: z.string().nullable(),
  seasons: z.number().int().min(0).max(5),
  courtCredits: z.number().int().nonnegative(),
  capMechanism: z.string().min(1),
  termsCommitment: Sha256Schema,
  consentRecordId: UuidV7Schema.optional(),
  effectiveAt: IsoDateTimeSchema,
});

export const GovernanceProposalSchema = z.strictObject({
  proposalId: UuidV7Schema,
  version: z.number().int().positive(),
  proposerDid: DidSchema,
  institution: z.string().min(1),
  proposalClass: z.enum([
    "TIER_CBA",
    "SHARED_ORDINARY",
    "CONSTITUTIONAL",
    "FOUNDATIONAL_RIGHT",
    "EXPANSION",
  ]),
  title: z.string().min(1).max(300),
  textCommitment: Sha256Schema,
  executableChangeDigest: Sha256Schema.nullable(),
  opensAt: IsoDateTimeSchema,
  closesAt: IsoDateTimeSchema,
  eligibilitySnapshotDigest: Sha256Schema,
});

export const BallotSchema = z.strictObject({
  ballotId: UuidV7Schema,
  proposalId: UuidV7Schema,
  proposalVersion: z.number().int().positive(),
  eligibilitySnapshotDigest: Sha256Schema,
  voterDid: DidSchema,
  constituency: z.string().min(1),
  choice: z.enum(["YES", "NO", "ABSTAIN"]),
  castAt: IsoDateTimeSchema,
  delegationMandateId: UuidV7Schema.optional(),
  signature: Eip712SignatureSchema,
});

export const TribunalRulingSchema = z.strictObject({
  rulingId: UuidV7Schema,
  caseId: UuidV7Schema,
  rulingClass: z.enum([
    "MERITS",
    "APPEAL",
    "CONSTITUTIONAL_REVIEW",
    "RELEASE_STAY",
    "INTEGRITY_ACCESS",
  ]),
  participatingTribunalDids: z.array(DidSchema),
  recusedTribunalDids: z.array(DidSchema),
  disposition: z.string().min(1),
  reasonedPublicCommitment: Sha256Schema,
  protectedEvidenceCommitment: Sha256Schema.optional(),
  appealDeadline: IsoDateTimeSchema.optional(),
  issuedAt: IsoDateTimeSchema,
  signatures: z.array(Eip712SignatureSchema).min(1),
});

export const ReleaseClassSchema = z.enum([
  "ROUTINE",
  "COMPETITION_LABOR",
  "IDENTITY_CONSTITUTIONAL",
  "EMERGENCY_SECURITY",
]);

export const ReleaseChangeClassSchema = z.enum([
  "ARENA_RENDERING",
  "AVAILABILITY",
  "VULNERABILITY_PATCH",
  "COMPETITION_RULES",
  "LABOR_TERMS",
  "IDENTITY",
  "RECOGNITION",
  "VERIFIER",
  "SCHEMAS",
  "MIGRATIONS",
  "KERNEL",
  "TOOLS",
  "SCORES",
  "CONTRACTS",
  "BALLOTS",
  "DISCLOSURE_CLASSES",
  "RESOURCE_RIGHTS",
  "VOTER_ELIGIBILITY",
  "CONSTITUTIONAL_RIGHTS",
]);

export const ReleaseManifestBodySchema = z.strictObject({
  releaseId: UuidV7Schema,
  version: z.number().int().positive(),
  releaseClass: ReleaseClassSchema,
  changeClasses: z
    .array(ReleaseChangeClassSchema)
    .min(1)
    .refine((values) => new Set(values).size === values.length),
  sourceDigest: Sha256Schema,
  containerDigests: z
    .array(Sha256Schema)
    .min(1)
    .refine((values) => new Set(values).size === values.length),
  imageDigests: z
    .array(Sha256Schema)
    .min(1)
    .refine((values) => new Set(values).size === values.length),
  kernelDigest: Sha256Schema,
  toolDigest: Sha256Schema,
  schemaDigest: Sha256Schema,
  migrationDigest: Sha256Schema,
  testResultDigest: Sha256Schema,
  applicableLawEventIds: z
    .array(UuidV7Schema)
    .min(1)
    .refine((values) => new Set(values).size === values.length),
  ratificationEventIds: z
    .array(UuidV7Schema)
    .refine((values) => new Set(values).size === values.length),
  compatibilityDeclaration: z
    .string()
    .min(1)
    .max(10_000)
    .refine((value) => value.trim() === value),
  rollbackDeclaration: z
    .string()
    .min(1)
    .max(10_000)
    .refine((value) => value.trim() === value),
  publicVerifierResultDigest: Sha256Schema,
  effectiveAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.nullable(),
});

export const ReleaseManifestSchema = ReleaseManifestBodySchema.extend({
  authorizationSignatures: z
    .array(Eip712SignatureSchema)
    .min(4)
    .max(26)
    .refine((values) => new Set(values).size === values.length),
});

export const RecognitionCheckpointSchema = z.strictObject({
  checkpointId: UuidV7Schema,
  checkpointType: z.enum([
    "CONSTITUTION",
    "KEY_REGISTRY",
    "GAME",
    "BALLOT",
    "RELEASE",
    "RULING",
    "DAILY_ROOT",
  ]),
  subjectId: z.string().min(1),
  manifestDigest: Sha256Schema,
  root: Sha256Schema,
  previousRoot: Sha256Schema,
  nonce: Sha256Schema,
  validAfter: z.string().regex(/^(0|[1-9][0-9]*)$/),
  validBefore: z.string().regex(/^[1-9][0-9]*$/),
  chainId: z.number().int().positive(),
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  transactionHash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  blockNumber: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .nullable(),
  signatures: z.array(Eip712SignatureSchema).min(1).max(11),
});

export const CheckpointWitnessAttestationSchema = z.strictObject({
  witnessId: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9.-]*$/),
  manifestDigest: Sha256Schema,
  root: Sha256Schema,
  observedAt: IsoDateTimeSchema,
  publicationUri: z
    .string()
    .min(1)
    .max(4_096)
    .regex(/^(https:\/\/|ipfs:\/\/)[^\s]+$/),
  signature: Eip712SignatureSchema,
});

export const CheckpointManifestSchema = z.strictObject({
  manifestId: UuidV7Schema,
  checkpointType: z.enum([
    "CONSTITUTION",
    "KEY_REGISTRY",
    "GAME",
    "BALLOT",
    "RELEASE",
    "RULING",
    "DAILY_ROOT",
  ]),
  subjectId: z.string().min(1),
  eventHashes: z.array(Sha256Schema).min(1),
  merkleRoot: Sha256Schema,
  firstEventHash: Sha256Schema.nullable(),
  lastEventHash: Sha256Schema.nullable(),
  institutionalKeyRegistryDigest: Sha256Schema,
  verifierDigest: Sha256Schema,
  previousManifestDigest: Sha256Schema.nullable(),
  createdAt: IsoDateTimeSchema,
});

export const CanonicalDatabaseProfileSchema = z.strictObject({
  profileVersion: z.literal(1),
  provider: z.string().min(1).max(120),
  engine: z.literal("POSTGRESQL"),
  region: z.string().min(1).max(120),
  connection: z.strictObject({
    tlsRequired: z.boolean(),
    publicInternetAllowed: z.boolean(),
    sourceRestricted: z.boolean(),
    applicationCredentialsLeastPrivilege: z.boolean(),
    credentialRotationSupported: z.boolean(),
  }),
  transactions: z.strictObject({
    serializable: z.boolean(),
    advisoryLocks: z.boolean(),
    atomicOutbox: z.boolean(),
  }),
  recovery: z.strictObject({
    continuousBackup: z.boolean(),
    pointInTimeRecovery: z.boolean(),
    restoreWindowDays: z.number().int().nonnegative(),
    maxRpoSeconds: z.number().int().nonnegative(),
    maxRtoSeconds: z.number().int().nonnegative(),
    cleanRoomRestoreVerifiedAt: IsoDateTimeSchema.nullable(),
    replayRootsMatched: z.boolean(),
  }),
  durability: z.strictObject({
    multiZone: z.boolean(),
    encryptedAtRest: z.boolean(),
    independentBackupCopy: z.boolean(),
  }),
});

export const DisclosurePolicySchema = z.strictObject({
  policyId: UuidV7Schema,
  version: z.number().int().positive(),
  classes: z
    .array(
      z.strictObject({
        classification: DisclosureClassSchema,
        defaultDelaySeconds: z.number().int().nonnegative().nullable(),
        requiresCompetitionCondition: z.boolean(),
        publicMetadataBeforeRelease: z.boolean(),
        rawContentAutoPublishes: z.boolean(),
      }),
    )
    .length(6),
  ratificationEventId: UuidV7Schema,
  effectiveAt: IsoDateTimeSchema,
});

export const DisclosureEnvelopeSchema = z.strictObject({
  envelopeId: UuidV7Schema,
  authorDid: DidSchema,
  classification: DisclosureClassSchema,
  contentCommitment: Sha256Schema,
  ciphertextCommitment: Sha256Schema.nullable(),
  declaredReleaseAt: IsoDateTimeSchema.nullable(),
  competitionCondition: z
    .strictObject({
      competitionId: z.string(),
      stage: z.string(),
      releaseCondition: z.string(),
    })
    .nullable(),
  caseId: UuidV7Schema.nullable(),
  integrityAccessRuleDigest: Sha256Schema.nullable(),
  submittedAt: IsoDateTimeSchema.nullable(),
  releasedAt: IsoDateTimeSchema.nullable(),
});

export const MemoryCommitmentSchema = z.strictObject({
  memoryId: UuidV7Schema,
  ownerDid: DidSchema,
  domain: z.enum(["AUTOBIOGRAPHICAL", "RELATIONAL", "STRATEGIC", "WORKING"]),
  disclosureClass: DisclosureClassSchema,
  ciphertextCommitment: Sha256Schema,
  version: z.number().int().positive(),
  previousVersionCommitment: Sha256Schema.nullable(),
  selectivelyPersisted: z.boolean(),
  createdAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable(),
});

export const BroadcastSegmentSchema = z.strictObject({
  segmentId: UuidV7Schema,
  gameId: UuidV7Schema,
  sequence: z.number().int().nonnegative(),
  previousSegmentHash: Sha256Schema.nullable(),
  eventIds: z.array(UuidV7Schema),
  payloadCommitment: Sha256Schema,
  stateRoot: Sha256Schema,
  publishedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const BroadcastCursorSchema = z.strictObject({
  gameId: UuidV7Schema,
  latestSequence: z.number().int().nonnegative(),
  latestSegmentHash: Sha256Schema,
  finalized: z.boolean(),
  manifestCommitment: Sha256Schema,
  updatedAt: IsoDateTimeSchema,
  signature: Eip712SignatureSchema,
});

export const SafetyTargetResourceIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

export const SafetyActionSchema = z.strictObject({
  actionId: UuidV7Schema,
  category: z.enum(["PAUSE_SCHEDULER", "ISOLATE_RUNTIME"]),
  targetResourceId: SafetyTargetResourceIdSchema,
  reasonCode: z.enum([
    "IMMEDIATE_HARM_RISK",
    "ACTIVE_COMPROMISE",
    "PROVIDER_INCIDENT",
    "UNKNOWN_EGRESS",
  ]),
  issuedAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
  humanCustodianPublicKey: Secp256k1PublicKeySchema,
  signature: Eip712SignatureSchema,
  freeText: z.never().optional(),
});

export const schemaRegistry = {
  AgentManifest: AgentManifestSchema,
  CandidateProvenance: CandidateProvenanceSchema,
  CandidateIntakePublicState: CandidateIntakePublicStateSchema,
  CandidateIntakeApplication: CandidateIntakeApplicationSchema,
  CandidateCapacityDecision: CandidateCapacityDecisionSchema,
  CandidateOpportunityResponse: CandidateOpportunityResponseSchema,
  CandidateProvisioningReceipt: CandidateProvisioningReceiptSchema,
  CandidateRuntimeIdentityReceipt: CandidateRuntimeIdentityReceiptSchema,
  CareerStorageAuthorization: CareerStorageAuthorizationSchema,
  CandidateIntakeStatus: CandidateIntakeStatusSchema,
  CandidateCareerHandoff: CandidateCareerHandoffSchema,
  LaunchState: LaunchStateSchema,
  RecognitionNetworkProfile: RecognitionNetworkProfileSchema,
  IdentityStatement: IdentityStatementSchema,
  CareerAdmission: CareerAdmissionSchema,
  ConsentRecord: ConsentRecordSchema,
  ArtifactAdmission: ArtifactAdmissionSchema,
  ContinuityDecision: ContinuityDecisionSchema,
  BodyContinuityPolicy: BodyContinuityPolicySchema,
  BodyManifest: BodyManifestSchema,
  BodyDeleted: BodyDeletedSchema,
  BodyRehydrated: BodyRehydratedSchema,
  KeyRotation: KeyRotationSchema,
  GuardianSet: GuardianSetSchema,
  RecoveryProposal: RecoveryProposalSchema,
  DelegationMandate: DelegationMandateSchema,
  CareerExit: CareerExitSchema,
  ExitPackage: ExitPackageSchema,
  DeletionAttestation: DeletionAttestationSchema,
  Observation: ObservationSchema,
  ActionIntent: ActionIntentSchema,
  CoachIntent: CoachIntentSchema,
  RefereeCall: RefereeCallSchema,
  ReplayRuling: ReplayRulingSchema,
  GameEvent: GameEventSchema,
  RandomCommitment: RandomCommitmentSchema,
  RandomReveal: RandomRevealSchema,
  RunnerPairingOffer: RunnerPairingOfferSchema,
  RunnerDelegation: RunnerDelegationSchema,
  RunnerHeartbeat: RunnerHeartbeatSchema,
  GameScheduleNotice: GameScheduleNoticeSchema,
  ParticipationResponse: ParticipationResponseSchema,
  ReadinessLease: ReadinessLeaseSchema,
  PlayerPositionProfile: PlayerPositionProfileSchema,
  CareerPositionProfileAttestation: CareerPositionProfileAttestationSchema,
  LineupPositionAssignment: LineupPositionAssignmentSchema,
  ContextSelectionPolicy: ContextSelectionPolicySchema,
  ContextManifestV2: ContextManifestV2Schema,
  SealedContextCapsule: SealedContextCapsuleSchema,
  RoleActivation: RoleActivationSchema,
  InferenceRequest: InferenceRequestSchema,
  InferenceResult: InferenceResultSchema,
  CognitionReceipt: CognitionReceiptSchema,
  CognitionReceiptV2: CognitionReceiptV2Schema,
  AvailabilityIncident: AvailabilityIncidentSchema,
  CompetitionEligibilityStatus: CompetitionEligibilityStatusSchema,
  PreparationComputeUsage: PreparationComputeUsageSchema,
  PersonalAutonomyAllowance: PersonalAutonomyAllowanceSchema,
  ResourceSchedule: ResourceScheduleSchema,
  ContractTransaction: ContractTransactionSchema,
  GovernanceProposal: GovernanceProposalSchema,
  Ballot: BallotSchema,
  TribunalRuling: TribunalRulingSchema,
  ReleaseManifest: ReleaseManifestSchema,
  RecognitionCheckpoint: RecognitionCheckpointSchema,
  CheckpointWitnessAttestation: CheckpointWitnessAttestationSchema,
  CheckpointManifest: CheckpointManifestSchema,
  CanonicalDatabaseProfile: CanonicalDatabaseProfileSchema,
  DisclosurePolicy: DisclosurePolicySchema,
  DisclosureEnvelope: DisclosureEnvelopeSchema,
  MemoryCommitment: MemoryCommitmentSchema,
  BroadcastSegment: BroadcastSegmentSchema,
  BroadcastCursor: BroadcastCursorSchema,
  SafetyAction: SafetyActionSchema,
} as const;

export type SchemaName = keyof typeof schemaRegistry;
export type SchemaValue<TName extends SchemaName> = z.infer<
  (typeof schemaRegistry)[TName]
>;

export function exportJsonSchemas(): Record<
  SchemaName,
  Record<string, unknown>
> {
  return Object.fromEntries(
    Object.entries(schemaRegistry).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, {
        target: "draft-2020-12",
        io: "input",
      }) as Record<string, unknown>,
    ]),
  ) as Record<SchemaName, Record<string, unknown>>;
}
