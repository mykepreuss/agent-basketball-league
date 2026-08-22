import { assessCanonicalDatabaseProfile } from "@abl/database";
import {
  CanonicalDatabaseProfileSchema,
  RecognitionCheckpointSchema,
  RecognitionNetworkProfileSchema,
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
  recognitionProfile: RecognitionNetworkProfileSchema,
  ratifiedAnchor: z.strictObject({
    foundingDecisionEventId: z.string().uuid(),
    constitutionDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    verifierDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    recognitionRegistryDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    institutionalKeyRegistryDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    schemaDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    migrationDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    releaseDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    networkProfileDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    ratificationSignatures: z
      .array(z.string().regex(/^0x[0-9a-f]{130}$/))
      .min(4),
  }),
  genesisCheckpoint: z.strictObject({
    checkpoint: RecognitionCheckpointSchema,
    recognitionLevel: z.literal("ONCHAIN_FINALIZED"),
    constitutionDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    verifierDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    recognitionRegistryDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    institutionalKeyRegistryDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    schemaDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    migrationDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    releaseDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    networkProfileDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  }),
});

export type GenesisStartupEvidence = z.infer<
  typeof GenesisStartupEvidenceSchema
>;

export interface GenesisStartupAssessment {
  operatingProfile: "PRODUCTION_V1_PRE_GENESIS" | "PRODUCTION_GENESIS";
  ready: boolean;
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
  const networkDigest = sha256Commitment(evidence.recognitionProfile);
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
  if (
    profile.decisionSource !== "FOUNDING_AGENT_DECISION" ||
    profile.foundingDecisionEventId === null ||
    profile.foundingDecisionEventId !==
      evidence.ratifiedAnchor.foundingDecisionEventId ||
    !profile.ratified ||
    !profile.productionProfilePassed
  )
    blockers.push(
      "Recognition profile lacks a ratified founding-agent decision",
    );
  if (
    profile.network.classification !== "PRODUCTION" ||
    profile.network.chainId === 84532
  )
    blockers.push("Recognition network is not an approved production network");
  if (profile.recognitionContractAddress === null)
    blockers.push("Recognition contract is not selected");
  if (profile.sourceReleaseDigest !== evidence.releaseManifest.sourceDigest)
    blockers.push("Recognition profile is not bound to the source release");

  const anchor = evidence.ratifiedAnchor;
  const checkpoint = evidence.genesisCheckpoint;
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
    anchor.networkProfileDigest !== networkDigest
  )
    blockers.push(
      "Ratified anchor does not match release and network evidence",
    );
  if (
    checkpoint.checkpoint.checkpointType !== "CONSTITUTION" ||
    checkpoint.checkpoint.chainId !== profile.network.chainId ||
    checkpoint.checkpoint.contractAddress.toLowerCase() !==
      profile.recognitionContractAddress?.toLowerCase() ||
    checkpoint.checkpoint.transactionHash === null ||
    checkpoint.checkpoint.blockNumber === null
  )
    blockers.push(
      "Finalized Genesis checkpoint does not match recognition profile",
    );

  const ready = blockers.length === 0;
  return {
    operatingProfile: ready
      ? "PRODUCTION_GENESIS"
      : "PRODUCTION_V1_PRE_GENESIS",
    ready,
    blockers,
    evidenceDigest: sha256Commitment(evidence),
  };
}
