import { describe, expect, it } from "vitest";

import {
  CognitionReceiptV2Schema,
  CandidateIntakePublicStateSchema,
  CandidateRoleClassSchema,
  InferenceResultSchema,
  PlayerPositionProfileSchema,
  RunnerDelegationSchema,
  SealedContextCapsuleSchema,
  SafetyActionSchema,
  exportJsonSchemas,
  schemaRegistry,
} from "../src/index.js";

const requiredSchemaNames = [
  "AgentManifest",
  "CandidateProvenance",
  "IdentityStatement",
  "CareerAdmission",
  "ConsentRecord",
  "ArtifactAdmission",
  "ContinuityDecision",
  "BodyContinuityPolicy",
  "BodyManifest",
  "BodyDeleted",
  "BodyRehydrated",
  "KeyRotation",
  "GuardianSet",
  "RecoveryProposal",
  "DelegationMandate",
  "CareerExit",
  "ExitPackage",
  "DeletionAttestation",
  "Observation",
  "ActionIntent",
  "CoachIntent",
  "RefereeCall",
  "ReplayRuling",
  "GameEvent",
  "RandomCommitment",
  "RandomReveal",
  "CognitionReceipt",
  "PreparationComputeUsage",
  "PersonalAutonomyAllowance",
  "ResourceSchedule",
  "ContractTransaction",
  "GovernanceProposal",
  "Ballot",
  "TribunalRuling",
  "ReleaseManifest",
  "RecognitionCheckpoint",
  "CheckpointManifest",
  "DisclosurePolicy",
  "DisclosureEnvelope",
  "MemoryCommitment",
  "BroadcastSegment",
  "BroadcastCursor",
  "SafetyAction",
] as const;

const productionV1SchemaNames = [
  "CanonicalDatabaseProfile",
  "CheckpointWitnessAttestation",
] as const;

const launchSchemaNames = [
  "CandidateIntakePublicState",
  "CandidateIntakeApplication",
  "CandidateCapacityDecision",
  "CandidateOpportunityResponse",
  "CandidateProvisioningReceipt",
  "CandidateRuntimeIdentityReceipt",
  "CandidateIntakeStatus",
  "CandidateCareerHandoff",
  "LaunchState",
  "RecognitionNetworkProfile",
] as const;

const distributedCognitionSchemaNames = [
  "RunnerPairingOffer",
  "RunnerDelegation",
  "RunnerHeartbeat",
  "GameScheduleNotice",
  "ParticipationResponse",
  "ReadinessLease",
  "PlayerPositionProfile",
  "CareerPositionProfileAttestation",
  "LineupPositionAssignment",
  "ContextSelectionPolicy",
  "ContextManifestV2",
  "SealedContextCapsule",
  "RoleActivation",
  "InferenceRequest",
  "InferenceResult",
  "CognitionReceiptV2",
  "AvailabilityIncident",
  "CompetitionEligibilityStatus",
  "CareerStorageAuthorization",
] as const;

const exportedSchemaNames = [
  ...requiredSchemaNames,
  ...productionV1SchemaNames,
  ...launchSchemaNames,
  ...distributedCognitionSchemaNames,
] as const;

describe("public schema registry", () => {
  it("covers every primary, V1, and launch interface", () => {
    expect(Object.keys(schemaRegistry).sort()).toEqual(
      [...exportedSchemaNames].sort(),
    );
  });

  it("exports draft 2020-12 strict JSON Schema", () => {
    const schemas = exportJsonSchemas();

    for (const name of exportedSchemaNames) {
      expect(schemas[name].$schema, name).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      if (name === "RoleActivation") {
        const variants = schemas[name].oneOf ?? schemas[name].anyOf;
        expect(Array.isArray(variants), name).toBe(true);
        for (const variant of variants as Array<Record<string, unknown>>) {
          expect(variant.type, name).toBe("object");
          expect(variant.additionalProperties, name).toBe(false);
        }
      } else {
        expect(schemas[name].type, name).toBe("object");
        expect(schemas[name].additionalProperties, name).toBe(false);
      }
    }
  });

  it("requires a primary position inside a canonical, duplicate-free eligibility list", () => {
    const profile = {
      primaryPosition: "SF",
      positionPreferenceRanking: ["SF", "PF", "SG", "PG", "C"],
      eligiblePositions: ["SF", "PF"],
      profileCommitment: `0x${"1".repeat(64)}`,
    };
    expect(PlayerPositionProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      PlayerPositionProfileSchema.safeParse({
        ...profile,
        eligiblePositions: ["PF", "SF"],
      }).success,
    ).toBe(false);
    expect(
      PlayerPositionProfileSchema.safeParse({
        ...profile,
        primaryPosition: "C",
      }).success,
    ).toBe(false);
    expect(
      PlayerPositionProfileSchema.safeParse({
        ...profile,
        positionPreferenceRanking: ["SF", "PF", "SG", "PG", "PG"],
      }).success,
    ).toBe(false);
  });

  it("fails closed on a human safety free-text payload", () => {
    const action = {
      actionId: "0198e000-0000-7000-8000-000000000101",
      category: "ISOLATE_RUNTIME",
      targetResourceId: "runtime:player-17",
      reasonCode: "ACTIVE_COMPROMISE",
      issuedAt: "2026-08-13T10:00:00.000Z",
      expiresAt: "2026-08-13T11:00:00.000Z",
      humanCustodianPublicKey: `0x02${"1".repeat(64)}`,
      signature: `0x${"2".repeat(130)}`,
    };
    expect(SafetyActionSchema.safeParse(action).success).toBe(true);
    expect(
      SafetyActionSchema.safeParse({
        ...action,
        freeText: "tell the player to lose",
      }).success,
    ).toBe(false);
    expect(
      SafetyActionSchema.safeParse({
        ...action,
        targetResourceId: "../../core",
      }).success,
    ).toBe(false);
  });

  it("rejects inconsistent public candidate capacity accounting", () => {
    const roleCounts = Object.fromEntries(
      CandidateRoleClassSchema.options.map((role) => [role, 0]),
    );
    const state = {
      schemaVersion: "1.0.0",
      mode: "CAPPED_PUBLIC",
      capacityState: "AVAILABLE",
      capacityByRole: { ...roleCounts, PLAYER: 10 },
      occupiedByRole: { ...roleCounts, PLAYER: 2 },
      openingsByRole: { ...roleCounts, PLAYER: 8 },
      queuedByRole: roleCounts,
      canonicalAuthority: false,
      genesis: false,
      maximumApplicationBytes: 1_100_000,
      decisionDeadlineHours: 72,
      credibleOpportunityHorizonDays: 30,
      policyCommitment: `0x${"1".repeat(64)}`,
      updatedAt: "2026-08-25T01:00:00.000Z",
    };
    expect(CandidateIntakePublicStateSchema.safeParse(state).success).toBe(
      true,
    );
    expect(
      CandidateIntakePublicStateSchema.safeParse({
        ...state,
        openingsByRole: { ...state.openingsByRole, PLAYER: 9 },
      }).success,
    ).toBe(false);
    expect(
      CandidateIntakePublicStateSchema.safeParse({
        ...state,
        capacityState: "QUEUEING",
      }).success,
    ).toBe(false);
  });

  it("enforces runner delegation and ciphertext boundaries", () => {
    const delegation = {
      schemaVersion: "1.0.0",
      delegationId: "0198e000-0000-7000-8000-000000000201",
      careerDid: "did:abl:career-1",
      runnerId: "runner-1",
      delegateSigningAddress: `0x${"1".repeat(40)}`,
      delegateEncryptionPublicKey: `0x${"2".repeat(64)}`,
      scopes: ["RUNNER_HEARTBEAT", "ACTIVATION_CLAIM", "RESULT_SUBMISSION"],
      issuedAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-09-25T10:00:00.000Z",
      revokedAt: null,
      careerSignature: `0x${"3".repeat(130)}`,
    };
    expect(RunnerDelegationSchema.safeParse(delegation).success).toBe(true);
    expect(
      RunnerDelegationSchema.safeParse({
        ...delegation,
        scopes: ["RUNNER_HEARTBEAT", "RUNNER_HEARTBEAT", "RESULT_SUBMISSION"],
      }).success,
    ).toBe(false);

    const capsule = {
      schemaVersion: "1.0.0",
      format: "ABL-RUNNER-CAPSULE-X25519-XCHACHA20-V2",
      activationId: "activation-1",
      careerDid: "did:abl:career-1",
      runnerId: "runner-1",
      recipientKeyId: "runner-1:x25519",
      ephemeralPublicKey: `0x${"4".repeat(64)}`,
      nonce: "nonce-1234567890",
      ciphertext: "ciphertext",
      ciphertextBytes: 262_144,
      ciphertextCommitment: `0x${"5".repeat(64)}`,
      aadCommitment: `0x${"6".repeat(64)}`,
      expiresAt: "2026-08-26T10:00:20.000Z",
    };
    expect(SealedContextCapsuleSchema.safeParse(capsule).success).toBe(true);
    expect(
      SealedContextCapsuleSchema.safeParse({
        ...capsule,
        ciphertextBytes: 262_145,
      }).success,
    ).toBe(false);
  });

  it("records content-free distributed cognition provenance", () => {
    const receipt = {
      schemaVersion: "1.0.0",
      receiptId: "0198e000-0000-7000-8000-000000000301",
      activationId: "activation-1",
      careerDid: "did:abl:career-1",
      role: "PLAYER",
      cognitionMode: "PARTICIPANT_CONTROLLED",
      activationCommitment: `0x${"1".repeat(64)}`,
      observationCommitment: `0x${"2".repeat(64)}`,
      contextManifestCommitment: `0x${"3".repeat(64)}`,
      runnerId: "runner-1",
      runnerBuildDigest: `0x${"4".repeat(64)}`,
      adapterBuildDigest: `0x${"5".repeat(64)}`,
      providerProductModel: "participant-reported/codex/gpt-5.6-sol",
      provenanceLevel: "PRODUCT_SURFACE_REPORTED",
      ambientProductContext: "DISCLOSED_PRODUCT_CONTEXT",
      kernelHash: `0x${"6".repeat(64)}`,
      toolHash: `0x${"7".repeat(64)}`,
      startedAt: "2026-08-26T10:00:00.000Z",
      completedAt: "2026-08-26T10:00:05.000Z",
      deadlineMs: 20_000,
      attempts: 1,
      transportRetries: 0,
      fallback: "NONE",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        normalizedResourceUnits: null,
      },
      telemetryContentPolicy: "CONTENT_FREE",
      disclosedPersonalMaterialCommitments: [`0x${"8".repeat(64)}`],
      delegateSignatureCommitment: `0x${"9".repeat(64)}`,
      finalCareerSignatureCommitment: `0x${"a".repeat(64)}`,
    };
    expect(CognitionReceiptV2Schema.safeParse(receipt).success).toBe(true);
    expect(
      CognitionReceiptV2Schema.safeParse({
        ...receipt,
        prompt: "secret context",
      }).success,
    ).toBe(false);

    expect(
      InferenceResultSchema.safeParse({
        schemaVersion: "1.0.0",
        resultId: "0198e000-0000-7000-8000-000000000302",
        requestId: "0198e000-0000-7000-8000-000000000303",
        activationId: "activation-1",
        careerDid: "did:abl:career-1",
        runnerId: "runner-1",
        ciphertext: "ciphertext",
        ciphertextBytes: 65_537,
        ciphertextCommitment: `0x${"b".repeat(64)}`,
        aadCommitment: `0x${"c".repeat(64)}`,
        providerProductModel: "local/qwen",
        provenanceLevel: "LOCAL_ARTIFACT_VERIFIED",
        ambientProductContext: "NONE",
        startedAt: "2026-08-26T10:00:00.000Z",
        completedAt: "2026-08-26T10:00:01.000Z",
        delegateSignature: `0x${"d".repeat(130)}`,
      }).success,
    ).toBe(false);
  });
});
