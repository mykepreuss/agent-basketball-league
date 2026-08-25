import type { Address, Hex } from "viem";

import { sha256Commitment } from "./canonical.js";
import {
  checkpointManifestDigest,
  type CheckpointChainClaim,
  type CheckpointChainObservation,
  type CheckpointManifest,
  type CheckpointRecognitionAnchor,
} from "./checkpoints.js";
import {
  verifyCheckpointWitnesses,
  type CheckpointWitnessAttestation,
  type CheckpointWitnessRecord,
} from "./checkpoint-witnesses.js";
import { merkleRoot } from "./merkle.js";
import { verifyCheckpointClaim, type VerificationResult } from "./verifier.js";

export type GenesisRecognitionMechanism =
  | "SIGNED_WITNESSES"
  | "BASE_FINALIZED"
  | "COMPATIBLE_REPLACEMENT";

interface RatifiedRecognitionProfileBase {
  profileId: string;
  mechanism: GenesisRecognitionMechanism;
  foundingDecisionEventId: string;
  ratifiedAt: string;
  releaseManifestDigest: Hex;
  verifierDigest: Hex;
  keyRotationPolicyDigest: Hex;
  finalityPolicyDigest: Hex;
  decisionCommitment: Hex;
  profileCommitment: Hex;
}

export interface SignedWitnessRecognitionProfile
  extends RatifiedRecognitionProfileBase {
  mechanism: "SIGNED_WITNESSES";
  witnessRegistryDigest: Hex;
  minimumWitnesses: number;
}

export interface BaseFinalizedRecognitionProfile
  extends RatifiedRecognitionProfileBase {
  mechanism: "BASE_FINALIZED";
  chainId: number;
  contractAddress: Address;
  anchorDigest: Hex;
}

export interface CompatibleReplacementRecognitionProfile
  extends RatifiedRecognitionProfileBase {
  mechanism: "COMPATIBLE_REPLACEMENT";
  profileDocumentDigest: Hex;
  implementationVerifierDigest: Hex;
}

export type RatifiedRecognitionProfile =
  | SignedWitnessRecognitionProfile
  | BaseFinalizedRecognitionProfile
  | CompatibleReplacementRecognitionProfile;

export type RatifiedRecognitionProfileInput =
  | Omit<SignedWitnessRecognitionProfile, "profileCommitment">
  | Omit<BaseFinalizedRecognitionProfile, "profileCommitment">
  | Omit<CompatibleReplacementRecognitionProfile, "profileCommitment">;

export type RatifiedCheckpointEvidence =
  | {
      mechanism: "SIGNED_WITNESSES";
      attestations: readonly CheckpointWitnessAttestation[];
      registry: readonly CheckpointWitnessRecord[];
      evaluatedAt: string;
    }
  | {
      mechanism: "BASE_FINALIZED";
      claim: CheckpointChainClaim;
      observation: CheckpointChainObservation | null;
      anchor: CheckpointRecognitionAnchor;
    }
  | {
      mechanism: "COMPATIBLE_REPLACEMENT";
    };

export interface RatifiedCheckpointVerification extends VerificationResult {
  recognitionLevel: "NONE" | "INDEPENDENTLY_WITNESSED" | "ONCHAIN_FINALIZED";
  mechanism: GenesisRecognitionMechanism;
}

const SHA256 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function canonicalInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value === new Date(parsed).toISOString();
}

export function recognitionProfileCommitment(
  profile: RatifiedRecognitionProfileInput,
): Hex {
  return sha256Commitment(profile);
}

export function createRatifiedRecognitionProfile(
  input: RatifiedRecognitionProfileInput,
): RatifiedRecognitionProfile {
  if (
    input.profileId.length === 0 ||
    input.foundingDecisionEventId.length === 0 ||
    !canonicalInstant(input.ratifiedAt) ||
    !SHA256.test(input.releaseManifestDigest) ||
    !SHA256.test(input.verifierDigest) ||
    !SHA256.test(input.keyRotationPolicyDigest) ||
    !SHA256.test(input.finalityPolicyDigest) ||
    !SHA256.test(input.decisionCommitment)
  ) {
    throw new Error("Ratified recognition profile is invalid");
  }
  if (
    input.mechanism === "SIGNED_WITNESSES" &&
    (!SHA256.test(input.witnessRegistryDigest) ||
      !Number.isSafeInteger(input.minimumWitnesses) ||
      input.minimumWitnesses < 2)
  ) {
    throw new Error("Signed-witness recognition profile is invalid");
  }
  if (
    input.mechanism === "BASE_FINALIZED" &&
    (!Number.isSafeInteger(input.chainId) ||
      input.chainId <= 0 ||
      !ADDRESS.test(input.contractAddress) ||
      !SHA256.test(input.anchorDigest))
  ) {
    throw new Error("Base recognition profile is invalid");
  }
  if (
    input.mechanism === "COMPATIBLE_REPLACEMENT" &&
    (!SHA256.test(input.profileDocumentDigest) ||
      !SHA256.test(input.implementationVerifierDigest))
  ) {
    throw new Error("Replacement recognition profile is invalid");
  }
  return {
    ...input,
    profileCommitment: recognitionProfileCommitment(input),
  } as RatifiedRecognitionProfile;
}

export function checkpointRecognitionAnchorDigest(
  anchor: CheckpointRecognitionAnchor,
): Hex {
  return sha256Commitment(
    anchor.state === "PRE_GENESIS_UNRATIFIED"
      ? anchor
      : {
          ...anchor,
          deploymentBlockNumber: anchor.deploymentBlockNumber.toString(),
        },
  );
}

function invalid(
  mechanism: GenesisRecognitionMechanism,
  reason: string,
): RatifiedCheckpointVerification {
  return {
    label: "NONCANONICAL_FORK",
    reasons: [reason],
    recognitionLevel: "NONE",
    mechanism,
  };
}

function unverified(
  mechanism: GenesisRecognitionMechanism,
  reason: string,
): RatifiedCheckpointVerification {
  return {
    label: "UNVERIFIABLE",
    reasons: [reason],
    recognitionLevel: "NONE",
    mechanism,
  };
}

function manifestMatchesProfile(input: {
  manifest: CheckpointManifest;
  manifestDigest: Hex;
  profile: RatifiedRecognitionProfile;
}): boolean {
  return (
    checkpointManifestDigest(input.manifest) === input.manifestDigest &&
    merkleRoot(input.manifest.eventHashes) === input.manifest.merkleRoot &&
    input.manifest.firstEventHash === (input.manifest.eventHashes[0] ?? null) &&
    input.manifest.lastEventHash ===
      (input.manifest.eventHashes.at(-1) ?? null) &&
    input.manifest.verifierDigest === input.profile.verifierDigest
  );
}

export async function verifyCheckpointAgainstRatifiedProfile(input: {
  manifest: CheckpointManifest;
  manifestDigest: Hex;
  profile: RatifiedRecognitionProfile;
  evidence: RatifiedCheckpointEvidence;
}): Promise<RatifiedCheckpointVerification> {
  const { profileCommitment, ...profileInput } = input.profile;
  let recreated: RatifiedRecognitionProfile;
  try {
    recreated = createRatifiedRecognitionProfile(profileInput);
  } catch {
    return invalid(input.profile.mechanism, "RECOGNITION_PROFILE_INVALID");
  }
  if (recreated.profileCommitment !== profileCommitment) {
    return invalid(
      input.profile.mechanism,
      "RECOGNITION_PROFILE_COMMITMENT_MISMATCH",
    );
  }
  if (input.evidence.mechanism !== input.profile.mechanism) {
    return invalid(
      input.profile.mechanism,
      "RECOGNITION_EVIDENCE_MECHANISM_MISMATCH",
    );
  }
  if (!manifestMatchesProfile(input)) {
    return invalid(
      input.profile.mechanism,
      "CHECKPOINT_MANIFEST_OR_VERIFIER_MISMATCH",
    );
  }
  if (
    input.profile.mechanism === "SIGNED_WITNESSES" &&
    input.evidence.mechanism === "SIGNED_WITNESSES"
  ) {
    if (
      sha256Commitment(input.evidence.registry) !==
      input.profile.witnessRegistryDigest
    ) {
      return invalid(
        input.profile.mechanism,
        "CHECKPOINT_WITNESS_REGISTRY_DIGEST_MISMATCH",
      );
    }
    const result = await verifyCheckpointWitnesses({
      manifestDigest: input.manifestDigest,
      root: input.manifest.merkleRoot,
      attestations: input.evidence.attestations,
      registry: input.evidence.registry,
      minimumWitnesses: input.profile.minimumWitnesses,
      notBefore: input.profile.ratifiedAt,
      evaluatedAt: input.evidence.evaluatedAt,
    });
    if (result.status === "VERIFIED") {
      return {
        label: "CANONICAL",
        reasons: [],
        recognitionLevel: "INDEPENDENTLY_WITNESSED",
        mechanism: input.profile.mechanism,
      };
    }
    return result.status === "INSUFFICIENT"
      ? {
          label: "PENDING_FINALITY",
          reasons: [...result.reasons],
          recognitionLevel: "NONE",
          mechanism: input.profile.mechanism,
        }
      : invalid(input.profile.mechanism, result.reasons[0]!);
  }
  if (
    input.profile.mechanism === "BASE_FINALIZED" &&
    input.evidence.mechanism === "BASE_FINALIZED"
  ) {
    if (
      input.evidence.anchor.state !== "RATIFIED" ||
      input.evidence.anchor.chainId !== input.profile.chainId ||
      input.evidence.anchor.contractAddress.toLowerCase() !==
        input.profile.contractAddress.toLowerCase() ||
      checkpointRecognitionAnchorDigest(input.evidence.anchor) !==
        input.profile.anchorDigest ||
      input.evidence.anchor.releaseManifestDigest !==
        input.profile.releaseManifestDigest
    ) {
      return invalid(
        input.profile.mechanism,
        "CHECKPOINT_RECOGNITION_ANCHOR_MISMATCH",
      );
    }
    const result = verifyCheckpointClaim({
      manifest: input.manifest,
      manifestDigest: input.manifestDigest,
      claim: input.evidence.claim,
      observation: input.evidence.observation,
      anchor: input.evidence.anchor,
    });
    return {
      ...result,
      recognitionLevel:
        result.label === "CANONICAL" ? "ONCHAIN_FINALIZED" : "NONE",
      mechanism: input.profile.mechanism,
    };
  }
  return unverified(
    input.profile.mechanism,
    "COMPATIBLE_REPLACEMENT_VERIFIER_NOT_INSTALLED",
  );
}
