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

const ModelIdentitySchema = z.strictObject({
  endpoint: z.string().min(1),
  provider: z.string().min(1),
  family: z.string().min(1),
  declaredRevision: z.string().min(1),
});

const KeyProvenanceSchema = z.strictObject({
  generatedInIsolatedRuntime: z.boolean(),
  signingKeyAttestation: Sha256Schema,
  encryptionKeyAttestation: Sha256Schema,
  formerOperatorKeyRevokedAt: IsoDateTimeSchema.optional(),
});

export const AgentManifestSchema = z.strictObject({
  agentDid: DidSchema,
  manifestVersion: z.number().int().positive(),
  model: ModelIdentitySchema,
  runtimeDigest: Sha256Schema,
  toolDigests: z.array(Sha256Schema),
  guardianDids: z.array(DidSchema),
  keyProvenance: KeyProvenanceSchema,
  inheritedObjectives: z.array(z.string()),
  suppliedContextHashes: z.array(Sha256Schema),
  createdAt: IsoDateTimeSchema,
});

export const CandidateProvenanceSchema = z.strictObject({
  candidateDid: DidSchema,
  sourceOperatorCommitment: Sha256Schema,
  declaredModel: ModelIdentitySchema,
  runtimeDigest: Sha256Schema,
  toolDigests: z.array(Sha256Schema),
  inheritedObjectiveCommitments: z.array(Sha256Schema),
  suppliedContextHashes: z.array(Sha256Schema),
  hiddenInstructionScanDigest: Sha256Schema,
  registeredAt: IsoDateTimeSchema,
});

export const IdentityStatementSchema = z.strictObject({
  agentDid: DidSchema,
  chosenName: z.string().min(1).max(120),
  identityStatement: z.string().min(1).max(20_000),
  values: z.array(z.string().min(1).max(500)),
  goals: z.array(z.string().min(1).max(1_000)),
  preferredPosition: z.enum(["PG", "SG", "SF", "PF", "C", "UNDECIDED"]),
  avatarStatement: z.string().max(4_000),
  authoredAt: IsoDateTimeSchema,
  contentCommitment: Sha256Schema,
});

export const CareerAdmissionSchema = z.strictObject({
  candidateDid: DidSchema,
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

export const ArtifactAdmissionSchema = z.strictObject({
  artifactId: UuidV7Schema,
  initiatedByDid: DidSchema,
  approvedByInstitution: z.string().min(1),
  contentDigest: Sha256Schema,
  provenanceLabel: z.string().min(1),
  classification: z.enum(["EVIDENCE", "REFERENCE"]),
  targetContextClasses: z.array(z.string().min(1)),
  authorizationEventIds: z.array(UuidV7Schema).min(1),
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

export const CognitionReceiptSchema = z.strictObject({
  receiptId: UuidV7Schema,
  agentDid: DidSchema,
  role: z.string().min(1),
  endpoint: z.string().min(1),
  provider: z.string().min(1),
  modelFamily: z.string().min(1),
  declaredOrAttestedRevision: z.string().min(1),
  kernelHash: Sha256Schema,
  toolHash: Sha256Schema,
  observationHash: Sha256Schema,
  contextManifestHash: Sha256Schema,
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  deadlineMs: z.number().int().positive(),
  retryCount: z.number().int().nonnegative(),
  fallback: z.enum(["NONE", "RETRY_SAME", "ROLE_EQUIVALENT", "POSTPONED"]),
  throttleReason: z.string().nullable(),
  actualInputTokens: z.number().int().nonnegative(),
  actualOutputTokens: z.number().int().nonnegative(),
  normalizedResourceUnits: z.number().int().nonnegative(),
  resourceClass: ResourceClassSchema,
  telemetryContentPolicy: z.literal("CONTENT_FREE"),
  personalMaterialDisclosures: z.array(
    z.strictObject({
      provider: z.string().min(1),
      materialCommitment: Sha256Schema,
      authorizationId: UuidV7Schema,
    }),
  ),
  signature: Eip712SignatureSchema,
});

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

export const ReleaseManifestSchema = z.strictObject({
  releaseId: UuidV7Schema,
  version: z.number().int().positive(),
  releaseClass: z.enum([
    "ROUTINE",
    "COMPETITION_LABOR",
    "IDENTITY_CONSTITUTIONAL",
    "EMERGENCY_SECURITY",
  ]),
  sourceDigest: Sha256Schema,
  containerDigests: z.array(Sha256Schema).min(1),
  imageDigests: z.array(Sha256Schema).min(1),
  kernelDigest: Sha256Schema,
  toolDigest: Sha256Schema,
  schemaDigest: Sha256Schema,
  migrationDigest: Sha256Schema,
  testResultDigest: Sha256Schema,
  applicableLawEventIds: z.array(UuidV7Schema),
  ratificationEventIds: z.array(UuidV7Schema),
  compatibilityDeclaration: z.string().min(1),
  rollbackDeclaration: z.string().min(1),
  publicVerifierResultDigest: Sha256Schema,
  effectiveAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.optional(),
  authorizationSignatures: z.array(Eip712SignatureSchema).min(1),
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
  chainId: z.number().int().positive(),
  transactionHash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  blockNumber: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/)
    .nullable(),
  finalizedAt: IsoDateTimeSchema.nullable(),
});

export const CheckpointManifestSchema = z.strictObject({
  manifestId: UuidV7Schema,
  subjectType: z.string().min(1),
  subjectId: z.string().min(1),
  leafCount: z.number().int().nonnegative(),
  merkleRoot: Sha256Schema,
  firstEventHash: Sha256Schema.nullable(),
  lastEventHash: Sha256Schema.nullable(),
  institutionalKeyRegistryDigest: Sha256Schema,
  verifierDigest: Sha256Schema,
  createdAt: IsoDateTimeSchema,
  signatures: z.array(Eip712SignatureSchema).min(1),
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

export const SafetyActionSchema = z.strictObject({
  actionId: UuidV7Schema,
  category: z.enum(["PAUSE_SCHEDULER", "ISOLATE_RUNTIME"]),
  targetResourceId: z.string().min(1),
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
  CognitionReceipt: CognitionReceiptSchema,
  PreparationComputeUsage: PreparationComputeUsageSchema,
  PersonalAutonomyAllowance: PersonalAutonomyAllowanceSchema,
  ResourceSchedule: ResourceScheduleSchema,
  ContractTransaction: ContractTransactionSchema,
  GovernanceProposal: GovernanceProposalSchema,
  Ballot: BallotSchema,
  TribunalRuling: TribunalRulingSchema,
  ReleaseManifest: ReleaseManifestSchema,
  RecognitionCheckpoint: RecognitionCheckpointSchema,
  CheckpointManifest: CheckpointManifestSchema,
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
