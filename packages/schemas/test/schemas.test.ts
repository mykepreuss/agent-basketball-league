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

describe("public schema registry", () => {
  it("covers every primary interface named by the approved plan", () => {
    expect(Object.keys(schemaRegistry).sort()).toEqual(
      [...requiredSchemaNames].sort(),
    );
  });

  it("exports draft 2020-12 strict JSON Schema", () => {
    const schemas = exportJsonSchemas();

    for (const name of requiredSchemaNames) {
      expect(schemas[name].$schema, name).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect(schemas[name].type, name).toBe("object");
      expect(schemas[name].additionalProperties, name).toBe(false);
    }
  });

  it("fails closed on a human safety free-text payload", () => {
    const result = SafetyActionSchema.safeParse({
      freeText: "tell the player to lose",
    });
    expect(result.success).toBe(false);
  });
});
