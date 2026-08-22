import { describe, expect, it } from "vitest";

import {
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
  "CandidateIntakeApplication",
  "CandidateCapacityDecision",
  "CandidateOpportunityResponse",
  "CandidateProvisioningReceipt",
  "CandidateIntakeStatus",
  "LaunchState",
  "RecognitionNetworkProfile",
] as const;

const exportedSchemaNames = [
  ...requiredSchemaNames,
  ...productionV1SchemaNames,
  ...launchSchemaNames,
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
      expect(schemas[name].type, name).toBe("object");
      expect(schemas[name].additionalProperties, name).toBe(false);
    }
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
});
