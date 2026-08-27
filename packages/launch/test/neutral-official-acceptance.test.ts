import { describe, expect, it } from "vitest";

import { assessNeutralOfficialAcceptance } from "../src/neutral-official-acceptance.js";

const roster = [
  ["abl-official-referee-001", "REFEREE"],
  ["abl-official-referee-002", "REFEREE"],
  ["abl-official-referee-003", "REFEREE"],
  ["abl-official-referee-004", "REFEREE"],
  ["abl-official-referee-005", "REFEREE"],
  ["abl-official-referee-006", "REFEREE"],
  ["abl-official-replay-001", "REPLAY"],
  ["abl-official-replay-002", "REPLAY"],
] as const;

function evidence() {
  return {
    version: 1,
    evidenceClass: "NEUTRAL_OFFICIAL_ACCEPTANCE",
    releaseCommit: "a".repeat(40),
    workspace: "agent-basketball-league",
    region: "us-was-1",
    startedAt: "2026-08-27T20:00:00.000Z",
    endedAt: "2026-08-27T20:10:00.000Z",
    modelGateway: {
      name: "abl-neutral-official-model",
      status: "DEPLOYED",
      sandbox: false,
      integrationConnection: "abl-neutral-official-openai",
      providerModel: "structured-official-model",
      providerCredentialExposedToCareer: false,
      providerCredentialRecordedInEvidence: false,
      structuredAdviceCallPassed: true,
      modelMaySignCanonicalAction: false,
      unrelatedSandboxOpenAiRouteReused: false,
      unrelatedSandboxOpenAiRouteChanged: false,
    },
    careers: roster.map(([careerId, role], index) => ({
      careerId,
      role,
      applicationId: `00000000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
      careerDid: `did:abl:neutral-official-${index + 1}`,
      signerAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      identityCommitment: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      careerSandbox: careerId,
      fixedBrokerSandbox: `${careerId}-broker`,
      careerStatus: "DEPLOYED",
      fixedBrokerStatus: "DEPLOYED",
      careerHealthPassed: true,
      fixedBrokerHealthPassed: true,
      identityGeneratedInsideCareerSandbox: true,
      careerRootKeyExported: false,
      careerHasModelCredential: false,
      careerHasAgentDriveMount: false,
      brokerHasDedicatedModelAccess: true,
      brokerCanonicalSigningEnabled: false,
      foundingElectorateEligible: false,
      governanceVotingPower: false,
      invalidModelResultFallbackPassed: true,
      signedDecisionVerified: true,
    })),
    isolation: {
      distinctApplicationIds: 8,
      distinctCareerDids: 8,
      distinctSignerAddresses: 8,
      distinctIdentityCommitments: 8,
      distinctCareerSandboxes: 8,
      distinctFixedBrokerSandboxes: 8,
      crossCareerModelSubmissionRejected: true,
      modelDirectCoreMutationRejected: true,
      modelDirectStorageAccessRejected: true,
      modelDirectCareerSigningRejected: true,
      plaintextContextLeaks: 0,
    },
    runtime: {
      blaxelAgentResources: 0,
      blaxelApplications: 0,
      blaxelVolumes: 0,
      additionalWorkspaces: 0,
      modelCallsRestrictedToAmbiguousOfficialJudgments: true,
      objectiveRulesRemainDeterministic: true,
      refereeFallback: "NO_CALL",
      replayFallback: "NO_REVIEW",
    },
    authorityBoundary: {
      preGenesisExperiment: true,
      genesis: false,
      canonicalHistoryClaim: false,
      recognitionBroadcast: false,
      baseTransaction: false,
      secretValuesRecorded: false,
    },
  };
}

describe("neutral-official acceptance", () => {
  it("passes only the exact separately keyed non-voting crew", () => {
    expect(assessNeutralOfficialAcceptance(evidence())).toMatchObject({
      status: "PASS",
      releaseCommit: "a".repeat(40),
      workspace: "agent-basketball-league",
      officialCareerCount: 8,
      blockers: [],
    });
  });

  it("rejects a substituted official or broker name", () => {
    const input = evidence();
    (input.careers[0]! as { careerId: string }).careerId =
      "abl-official-referee-009";
    input.careers[1]!.fixedBrokerSandbox = "substituted-broker";
    const result = assessNeutralOfficialAcceptance(input);
    expect(result.status).toBe("FAIL");
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("exact neutral-official roster"),
        expect.stringContaining("Fixed-broker Sandbox name"),
      ]),
    );
  });

  it("rejects shared career identities", () => {
    const input = evidence();
    input.careers[1]!.signerAddress = input.careers[0]!.signerAddress;
    expect(assessNeutralOfficialAcceptance(input)).toMatchObject({
      status: "FAIL",
      blockers: expect.arrayContaining([
        expect.stringContaining("signerAddress values must be distinct"),
      ]),
    });
  });

  it("rejects the unrelated sandbox model route and authority drift", () => {
    const input = evidence();
    input.modelGateway.integrationConnection = "sandbox-openai";
    input.modelGateway.unrelatedSandboxOpenAiRouteReused = true;
    input.careers[0]!.governanceVotingPower = true;
    expect(assessNeutralOfficialAcceptance(input).status).toBe("FAIL");
  });
});
