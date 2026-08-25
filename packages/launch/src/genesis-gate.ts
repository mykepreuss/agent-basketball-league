import { assessCanonicalDatabaseProfile } from "@abl/database";
import {
  CanonicalDatabaseProfileSchema,
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
    eligible: z.number().int().min(10).max(20),
    requiredYes: z.number().int().min(7).max(20),
    authorizedAt: z.iso.datetime({ offset: true }),
    authorizationSignatures: z
      .array(z.string().regex(/^0x[0-9a-f]{130}$/))
      .min(7)
      .max(20),
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
  liveProofs: z.strictObject({
    sandboxIsolation: PassedProofSchema,
    storageRecovery: PassedProofSchema,
    databaseRecovery: PassedProofSchema,
    publicBoundary: PassedProofSchema,
    capacity: PassedProofSchema,
  }),
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
  const { authorizationCommitment, ...releaseAuthorizationBody } =
    releaseAuthorization;
  if (
    anchor.decisionCommitment !== profile.decisionCommitment ||
    releaseAuthorization.releaseManifestDigest !== releaseDigest ||
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
