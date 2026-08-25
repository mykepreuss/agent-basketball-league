import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  checkpointManifestDigest,
  createCheckpointManifest,
  createRatifiedRecognitionProfile,
  createSigningIdentity,
  sha256Commitment,
  signCheckpointWitness,
  verifyCheckpointAgainstRatifiedProfile,
  type CheckpointWitnessAttestation,
  type CheckpointWitnessRecord,
} from "../src/index.js";

const at = "2026-09-01T00:00:00.000Z";
const digestA = `0x${"a".repeat(64)}` as Hex;
const digestB = `0x${"b".repeat(64)}` as Hex;

describe("ratified recognition-profile dispatch", () => {
  it("recognizes a checkpoint through the founders' signed-witness choice without Base", async () => {
    const manifest = createCheckpointManifest({
      manifestId: "0199d000-0000-7000-8000-000000000001",
      checkpointType: "CONSTITUTION",
      subjectId: "abl-genesis",
      eventHashes: [digestA],
      institutionalKeyRegistryDigest: digestA,
      verifierDigest: digestB,
      previousManifestDigest: null,
      createdAt: at,
    });
    const manifestDigest = checkpointManifestDigest(manifest);
    const identities = [createSigningIdentity(), createSigningIdentity()];
    const registry: CheckpointWitnessRecord[] = identities.map(
      (identity, index) => ({
        witnessId: `witness-${index + 1}`,
        address: identity.address,
        administrativeDomain: `witness-${index + 1}.example`,
        validFrom: at,
        validUntil: null,
      }),
    );
    const attestations: CheckpointWitnessAttestation[] = await Promise.all(
      identities.map(async (identity, index) => {
        const statement = {
          witnessId: registry[index]!.witnessId,
          manifestDigest,
          root: manifest.merkleRoot,
          observedAt: "2026-09-01T00:01:00.000Z",
          publicationUri: `https://${registry[index]!.administrativeDomain}/abl-genesis.json`,
        };
        return {
          ...statement,
          signature: await signCheckpointWitness(identity, statement),
        };
      }),
    );
    const profile = createRatifiedRecognitionProfile({
      profileId: "0199d000-0000-7000-8000-000000000002",
      mechanism: "SIGNED_WITNESSES",
      foundingDecisionEventId: "0199d000-0000-7000-8000-000000000003",
      ratifiedAt: at,
      releaseManifestDigest: digestA,
      verifierDigest: digestB,
      keyRotationPolicyDigest: sha256Commitment("witness-key-rotation"),
      finalityPolicyDigest: sha256Commitment("two-independent-witnesses"),
      decisionCommitment: sha256Commitment("founding-recognition-decision"),
      witnessRegistryDigest: sha256Commitment(registry),
      minimumWitnesses: 2,
    });

    await expect(
      verifyCheckpointAgainstRatifiedProfile({
        manifest,
        manifestDigest,
        profile,
        evidence: {
          mechanism: "SIGNED_WITNESSES",
          attestations,
          registry,
          evaluatedAt: "2026-09-01T00:02:00.000Z",
        },
      }),
    ).resolves.toMatchObject({
      label: "CANONICAL",
      recognitionLevel: "INDEPENDENTLY_WITNESSED",
      mechanism: "SIGNED_WITNESSES",
      reasons: [],
    });
  });

  it("fails closed when evidence does not match the ratified mechanism", async () => {
    const manifest = createCheckpointManifest({
      manifestId: "0199d000-0000-7000-8000-000000000004",
      checkpointType: "CONSTITUTION",
      subjectId: "abl-genesis",
      eventHashes: [digestA],
      institutionalKeyRegistryDigest: digestA,
      verifierDigest: digestB,
      previousManifestDigest: null,
      createdAt: at,
    });
    const profile = createRatifiedRecognitionProfile({
      profileId: "0199d000-0000-7000-8000-000000000005",
      mechanism: "COMPATIBLE_REPLACEMENT",
      foundingDecisionEventId: "0199d000-0000-7000-8000-000000000006",
      ratifiedAt: at,
      releaseManifestDigest: digestA,
      verifierDigest: digestB,
      keyRotationPolicyDigest: digestA,
      finalityPolicyDigest: digestB,
      decisionCommitment: sha256Commitment("replacement-decision"),
      profileDocumentDigest: digestA,
      implementationVerifierDigest: digestB,
    });
    await expect(
      verifyCheckpointAgainstRatifiedProfile({
        manifest,
        manifestDigest: checkpointManifestDigest(manifest),
        profile,
        evidence: { mechanism: "COMPATIBLE_REPLACEMENT" },
      }),
    ).resolves.toMatchObject({
      label: "UNVERIFIABLE",
      recognitionLevel: "NONE",
      reasons: ["COMPATIBLE_REPLACEMENT_VERIFIER_NOT_INSTALLED"],
    });

    await expect(
      verifyCheckpointAgainstRatifiedProfile({
        manifest,
        manifestDigest: checkpointManifestDigest(manifest),
        profile: { ...profile, profileCommitment: digestA },
        evidence: { mechanism: "COMPATIBLE_REPLACEMENT" },
      }),
    ).resolves.toMatchObject({
      label: "NONCANONICAL_FORK",
      recognitionLevel: "NONE",
      reasons: ["RECOGNITION_PROFILE_COMMITMENT_MISMATCH"],
    });
  });
});
