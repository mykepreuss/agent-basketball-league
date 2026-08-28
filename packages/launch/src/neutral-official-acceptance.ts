import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
const DigestSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const ResourceNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);

const officialRoster = [
  ["abl-official-referee-001", "REFEREE"],
  ["abl-official-referee-002", "REFEREE"],
  ["abl-official-referee-003", "REFEREE"],
  ["abl-official-referee-004", "REFEREE"],
  ["abl-official-referee-005", "REFEREE"],
  ["abl-official-referee-006", "REFEREE"],
  ["abl-official-replay-001", "REPLAY"],
  ["abl-official-replay-002", "REPLAY"],
] as const;

const NeutralOfficialCareerEvidenceSchema = z.strictObject({
  careerId: z.string().min(1).max(80),
  role: z.enum(["REFEREE", "REPLAY"]),
  applicationId: z.uuid(),
  careerDid: z.string().startsWith("did:").max(500),
  signerAddress: AddressSchema,
  identityCommitment: DigestSchema,
  careerSandbox: ResourceNameSchema,
  fixedBrokerSandbox: ResourceNameSchema,
  careerStatus: z.literal("DEPLOYED"),
  fixedBrokerStatus: z.literal("DEPLOYED"),
  careerHealthPassed: z.literal(true),
  fixedBrokerHealthPassed: z.literal(true),
  identityGeneratedInsideCareerSandbox: z.literal(true),
  careerRootKeyExported: z.literal(false),
  careerHasModelCredential: z.literal(false),
  careerHasAgentDriveMount: z.literal(false),
  brokerHasDedicatedModelAccess: z.literal(true),
  brokerCanonicalSigningEnabled: z.literal(false),
  foundingElectorateEligible: z.literal(false),
  governanceVotingPower: z.literal(false),
  invalidModelResultFallbackContractTestPassed: z.literal(true),
  signedDecisionVerified: z.literal(true),
  activationState: z.literal("CAREER_SIGNED"),
  participantResultAccepted: z.literal(true),
  fallback: z.literal("NONE"),
  provenanceEvidenceLevel: z.literal("PROVIDER_ATTESTED"),
});

export const NeutralOfficialAcceptanceEvidenceSchema = z
  .strictObject({
    version: z.literal(1),
    evidenceClass: z.literal("NEUTRAL_OFFICIAL_ACCEPTANCE"),
    releaseCommit: CommitSchema,
    workspace: z.literal("agent-basketball-league"),
    region: z.literal("us-was-1"),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    modelGateway: z.strictObject({
      name: z.literal("abl-neutral-official-model"),
      status: z.literal("DEPLOYED"),
      sandbox: z.literal(false),
      integrationConnection: z
        .string()
        .regex(/^abl-neutral-official-[a-z0-9-]+$/)
        .refine((value) => !value.includes("sandbox-openai")),
      providerModel: z.string().min(1).max(200),
      providerCredentialExposedToCareer: z.literal(false),
      providerCredentialRecordedInEvidence: z.literal(false),
      structuredAdviceCallPassed: z.literal(true),
      modelMaySignCanonicalAction: z.literal(false),
      unrelatedSandboxOpenAiRouteReused: z.literal(false),
      unrelatedSandboxOpenAiRouteChanged: z.literal(false),
    }),
    runtimeContractEvidence: z.strictObject({
      sourceCommit: CommitSchema,
      nodeVersion: z.literal("v24.18.0"),
      testSuite: z.literal("apps/staging-body/test/cognition-runtime.test.ts"),
      passed: z.literal(true),
    }),
    careers: z.array(NeutralOfficialCareerEvidenceSchema).length(8),
    isolation: z.strictObject({
      distinctApplicationIds: z.literal(8),
      distinctCareerDids: z.literal(8),
      distinctSignerAddresses: z.literal(8),
      distinctIdentityCommitments: z.literal(8),
      distinctCareerSandboxes: z.literal(8),
      distinctFixedBrokerSandboxes: z.literal(8),
      crossCareerActivationRejectedLive: z.literal(true),
      modelCoreMutationAuthorityAbsent: z.literal(true),
      modelStorageAuthorityAbsent: z.literal(true),
      modelCanonicalSigningAuthorityAbsent: z.literal(true),
      plaintextContextRecordingDisabled: z.literal(true),
    }),
    runtime: z.strictObject({
      blaxelAgentResources: z.literal(0),
      blaxelApplications: z.literal(0),
      blaxelVolumes: z.literal(0),
      additionalWorkspaces: z.literal(0),
      modelCallsRestrictedToAmbiguousOfficialJudgments: z.literal(true),
      objectiveRulesRemainDeterministic: z.literal(true),
      refereeFallback: z.literal("NO_CALL"),
      replayFallback: z.literal("NO_REVIEW"),
    }),
    authorityBoundary: z.strictObject({
      preGenesisExperiment: z.literal(true),
      genesis: z.literal(false),
      canonicalHistoryClaim: z.literal(false),
      recognitionBroadcast: z.literal(false),
      baseTransaction: z.literal(false),
      secretValuesRecorded: z.literal(false),
    }),
  })
  .superRefine((evidence, context) => {
    if (Date.parse(evidence.endedAt) < Date.parse(evidence.startedAt))
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "Acceptance timestamps are not monotonic",
      });
    if (
      evidence.runtimeContractEvidence.sourceCommit !== evidence.releaseCommit
    )
      context.addIssue({
        code: "custom",
        path: ["runtimeContractEvidence", "sourceCommit"],
        message: "Runtime contract evidence is not bound to the release",
      });

    const expectedRoster = new Map<string, string>(officialRoster);
    for (const [index, career] of evidence.careers.entries()) {
      if (expectedRoster.get(career.careerId) !== career.role)
        context.addIssue({
          code: "custom",
          path: ["careers", index, "careerId"],
          message: "Career is not in the exact neutral-official roster",
        });
      if (career.careerSandbox !== career.careerId)
        context.addIssue({
          code: "custom",
          path: ["careers", index, "careerSandbox"],
          message: "Career Sandbox name differs from the approved roster",
        });
      if (career.fixedBrokerSandbox !== `${career.careerId}-broker`)
        context.addIssue({
          code: "custom",
          path: ["careers", index, "fixedBrokerSandbox"],
          message: "Fixed-broker Sandbox name differs from the approved roster",
        });
    }
    if (new Set(evidence.careers.map(({ careerId }) => careerId)).size !== 8)
      context.addIssue({
        code: "custom",
        path: ["careers"],
        message: "Neutral-official career IDs must be distinct",
      });
    const distinctFields = [
      "applicationId",
      "careerDid",
      "signerAddress",
      "identityCommitment",
      "careerSandbox",
      "fixedBrokerSandbox",
    ] as const;
    for (const field of distinctFields)
      if (new Set(evidence.careers.map((career) => career[field])).size !== 8)
        context.addIssue({
          code: "custom",
          path: ["careers"],
          message: `Neutral-official ${field} values must be distinct`,
        });
  });

export type NeutralOfficialAcceptanceEvidence = z.infer<
  typeof NeutralOfficialAcceptanceEvidenceSchema
>;

export function assessNeutralOfficialAcceptance(input: unknown) {
  const parsed = NeutralOfficialAcceptanceEvidenceSchema.safeParse(input);
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
        officialCareerCount: parsed.data.careers.length,
        blockers,
      }
    : {
        status: "FAIL" as const,
        releaseCommit: null,
        workspace: null,
        officialCareerCount: null,
        blockers,
      };
  return { ...result, resultDigest: sha256Commitment(result) };
}
