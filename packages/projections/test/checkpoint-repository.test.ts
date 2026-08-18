import {
  checkpointManifestDigest,
  checkpointSubjectId,
  checkpointTypeId,
  createSigningIdentity,
  createCheckpointManifest,
  sha256Commitment,
  signCheckpointWitness,
  type CheckpointChainObservation,
  type CheckpointRecognitionAnchor,
} from "@abl/recognition";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  PublicCheckpointProjectionRepository,
  type CheckpointPublication,
} from "../src/index.js";

const createdAt = "2026-08-13T09:00:00.000Z";
const contractAddress = "0x1111111111111111111111111111111111111111";
const transactionHash = sha256Commitment("checkpoint-transaction");
const signature = `0x${"1".repeat(130)}`;
const runtimeBytecodeHash = sha256Commitment("recognition-runtime-bytecode");
const recognitionAnchor: CheckpointRecognitionAnchor = {
  state: "RATIFIED",
  chainId: 84532,
  contractAddress,
  deployedRuntimeBytecodeKeccak256: runtimeBytecodeHash,
  releaseManifestDigest: sha256Commitment("ratified-release"),
  deploymentTransactionHash: sha256Commitment("deployment-transaction"),
  deploymentBlockNumber: 10n,
  finalizedAt: "2026-08-13T08:00:00.000Z",
  requiredConfirmations: 12,
};
const pendingRecognitionAnchor: CheckpointRecognitionAnchor = {
  state: "PRE_GENESIS_UNRATIFIED",
  chainId: 84532,
  contractAddress: null,
  deployedRuntimeBytecodeKeccak256: null,
  releaseManifestDigest: null,
  deploymentTransactionHash: null,
  deploymentBlockNumber: null,
  finalizedAt: null,
  requiredConfirmations: 12,
};

function publication(submitted = true): CheckpointPublication {
  const manifest = createCheckpointManifest({
    manifestId: "0198d000-0000-7000-8000-000000000801",
    checkpointType: "RELEASE",
    subjectId: "0198d000-0000-7000-8000-000000000802",
    eventHashes: [
      sha256Commitment("release-event-1"),
      sha256Commitment("release-event-2"),
    ],
    institutionalKeyRegistryDigest: sha256Commitment("registry"),
    verifierDigest: sha256Commitment("verifier"),
    previousManifestDigest: null,
    createdAt,
  });
  const manifestDigest = checkpointManifestDigest(manifest);
  return {
    manifest: { ...manifest, eventHashes: [...manifest.eventHashes] },
    checkpoint: {
      checkpointId: "0198d000-0000-7000-8000-000000000803",
      checkpointType: manifest.checkpointType,
      subjectId: manifest.subjectId,
      manifestDigest,
      root: manifest.merkleRoot,
      previousRoot: sha256Commitment("prior-release-root"),
      nonce: manifestDigest,
      validAfter: "1786611599",
      validBefore: "1786615200",
      chainId: 84532,
      contractAddress,
      transactionHash: submitted ? transactionHash : null,
      blockNumber: submitted ? "100" : null,
      signatures: [signature],
    },
  };
}

function observation(
  candidate: CheckpointPublication,
  confirmations: number,
): CheckpointChainObservation {
  return {
    checkpointTypeId: checkpointTypeId(candidate.checkpoint.checkpointType),
    subjectId: checkpointSubjectId(candidate.checkpoint.subjectId),
    root: candidate.checkpoint.root as Hex,
    previousRoot: candidate.checkpoint.previousRoot as Hex,
    nonce: candidate.checkpoint.nonce as Hex,
    validAfter: BigInt(candidate.checkpoint.validAfter),
    validBefore: BigInt(candidate.checkpoint.validBefore),
    chainId: candidate.checkpoint.chainId,
    contractAddress,
    transactionHash,
    blockNumber: 100n,
    blockTimestamp: 1_786_611_600n,
    confirmations,
    baseFinalized: confirmations >= 12,
    receiptSucceeded: true,
    runtimeBytecodeKeccak256: runtimeBytecodeHash,
    signatures: [signature as Hex],
    observedAt: "2026-08-13T09:10:00.000Z",
  };
}

describe("public checkpoint projection", () => {
  it("cannot recognize a checkpoint before the deployment anchor is ratified", async () => {
    const repository = new PublicCheckpointProjectionRepository({
      publications: [publication()],
      anchor: pendingRecognitionAnchor,
      checkpointObservation: async () => {
        throw new Error("An unratified anchor must not query Base");
      },
    });
    await repository.initialize();
    expect(repository.checkpoints()[0]).toMatchObject({
      canonical: false,
      recognized: false,
      recognitionLevel: "NONE",
      verification: "UNVERIFIABLE",
      reasons: ["CHECKPOINT_RECOGNITION_ANCHOR_UNRATIFIED"],
      recognitionAnchorState: "PRE_GENESIS_UNRATIFIED",
      confirmations: null,
      observedAt: null,
    });
  });

  it("keeps a signed but unsubmitted checkpoint explicitly unverifiable", async () => {
    const repository = new PublicCheckpointProjectionRepository({
      publications: [publication(false)],
      anchor: recognitionAnchor,
      checkpointObservation: async () => {
        throw new Error("Unsubmitted checkpoint must not query Base");
      },
      now: () => new Date(createdAt),
    });
    await repository.initialize();
    expect(repository.checkpoints()).toMatchObject([
      {
        canonical: false,
        recognized: false,
        recognitionLevel: "NONE",
        verification: "UNVERIFIABLE",
        reasons: ["CHECKPOINT_TRANSACTION_MISSING"],
        confirmations: null,
      },
    ]);
  });

  it("advances only from observed inclusion to required finality", async () => {
    const candidate = publication();
    let confirmations = 2;
    const repository = new PublicCheckpointProjectionRepository({
      publications: [candidate],
      anchor: recognitionAnchor,
      checkpointObservation: async () => observation(candidate, confirmations),
    });
    await repository.initialize();
    expect(repository.checkpoints()[0]).toMatchObject({
      verification: "PENDING_FINALITY",
      recognized: false,
      confirmations: 2,
    });
    confirmations = 12;
    await repository.refresh();
    expect(repository.checkpoints()[0]).toMatchObject({
      verification: "CANONICAL",
      canonical: true,
      recognized: true,
      recognitionLevel: "ONCHAIN_FINALIZED",
      confirmations: 12,
    });

    const unfinalized = new PublicCheckpointProjectionRepository({
      publications: [candidate],
      anchor: recognitionAnchor,
      checkpointObservation: async () => ({
        ...observation(candidate, 12),
        baseFinalized: false,
      }),
    });
    await unfinalized.initialize();
    expect(unfinalized.checkpoints()[0]).toMatchObject({
      verification: "PENDING_FINALITY",
      reasons: ["CHECKPOINT_BASE_FINALITY_PENDING"],
      recognized: false,
    });
  });

  it("labels an observed field substitution as a noncanonical fork", async () => {
    const candidate = publication();
    const repository = new PublicCheckpointProjectionRepository({
      publications: [candidate],
      anchor: recognitionAnchor,
      checkpointObservation: async () => ({
        ...observation(candidate, 12),
        root: sha256Commitment("substituted-root"),
      }),
    });
    await repository.initialize();
    expect(repository.checkpoints()[0]).toMatchObject({
      verification: "NONCANONICAL_FORK",
      canonical: false,
      recognized: false,
      reasons: ["CHECKPOINT_CHAIN_OBSERVATION_MISMATCH"],
    });
  });

  it("distinguishes chain-read failure from invalid checkpoint evidence", async () => {
    const candidate = publication();
    const repository = new PublicCheckpointProjectionRepository({
      publications: [candidate],
      anchor: recognitionAnchor,
      checkpointObservation: async () => {
        throw new Error("RPC unavailable");
      },
    });
    await repository.initialize();
    expect(repository.checkpoints()[0]).toMatchObject({
      verification: "UNVERIFIABLE",
      reasons: ["CHECKPOINT_CHAIN_READ_FAILED"],
    });

    const invalid = structuredClone(candidate);
    invalid.manifest.merkleRoot = sha256Commitment("forged-manifest-root");
    await expect(
      new PublicCheckpointProjectionRepository({
        publications: [invalid],
        anchor: recognitionAnchor,
        checkpointObservation: async () => null,
      }).initialize(),
    ).rejects.toThrow("does not match its event hashes");
  });

  it("rejects a self-consistent manifest substitution not anchored by the signed nonce", async () => {
    const original = publication();
    const substituted = structuredClone(original);
    const substitutedManifest = createCheckpointManifest({
      ...original.manifest,
      eventHashes: original.manifest.eventHashes as readonly Hex[],
      institutionalKeyRegistryDigest: original.manifest
        .institutionalKeyRegistryDigest as Hex,
      verifierDigest: sha256Commitment("substituted-verifier"),
      previousManifestDigest: original.manifest
        .previousManifestDigest as Hex | null,
    });
    substituted.manifest = {
      ...substitutedManifest,
      eventHashes: [...substitutedManifest.eventHashes],
    };
    substituted.checkpoint.manifestDigest =
      checkpointManifestDigest(substitutedManifest);
    const repository = new PublicCheckpointProjectionRepository({
      publications: [substituted],
      anchor: recognitionAnchor,
      checkpointObservation: async () => observation(original, 12),
    });
    await repository.initialize();
    expect(repository.checkpoints()[0]).toMatchObject({
      verification: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_MANIFEST_NOT_ANCHORED"],
      recognized: false,
    });
  });

  it("separates signed and independently witnessed V1 history from on-chain finality", async () => {
    const candidate = publication(false);
    const signed = new PublicCheckpointProjectionRepository({
      publications: [candidate],
      anchor: pendingRecognitionAnchor,
      checkpointObservation: async () => null,
      checkpointAuthorization: async () => ({
        valid: true,
        reasons: [],
        signers: [contractAddress as Address],
      }),
      now: () => new Date("2026-08-13T09:10:00.000Z"),
    });
    await signed.initialize();
    expect(signed.checkpoints()[0]).toMatchObject({
      recognitionLevel: "SIGNED_VALID",
      authorizationVerified: true,
      witnessVerification: "NOT_CONFIGURED",
      canonical: false,
      recognized: false,
    });

    const identities = [createSigningIdentity(), createSigningIdentity()];
    candidate.witnesses = await Promise.all(
      identities.map(async (identity, index) => {
        const statement = {
          witnessId: `witness-${index + 1}`,
          manifestDigest: candidate.checkpoint.manifestDigest as Hex,
          root: candidate.checkpoint.root as Hex,
          observedAt: "2026-08-13T09:05:00.000Z",
          publicationUri: `https://operator-${index + 1}.example/checkpoints/${candidate.checkpoint.manifestDigest}`,
        };
        return {
          ...statement,
          signature: await signCheckpointWitness(identity, statement),
        };
      }),
    );
    const witnessed = new PublicCheckpointProjectionRepository({
      publications: [candidate],
      anchor: pendingRecognitionAnchor,
      checkpointObservation: async () => null,
      checkpointAuthorization: async () => ({
        valid: true,
        reasons: [],
        signers: [contractAddress as Address],
      }),
      witnessRegistry: identities.map((identity, index) => ({
        witnessId: `witness-${index + 1}`,
        address: identity.address,
        administrativeDomain: `operator-${index + 1}.example`,
        validFrom: "2026-08-01T00:00:00.000Z",
        validUntil: null,
      })),
      minimumWitnesses: 2,
      now: () => new Date("2026-08-13T09:10:00.000Z"),
    });
    await witnessed.initialize();
    expect(witnessed.checkpoints()[0]).toMatchObject({
      recognitionLevel: "INDEPENDENTLY_WITNESSED",
      authorizationVerified: true,
      witnessVerification: "VERIFIED",
      verifiedWitnessIds: ["witness-1", "witness-2"],
      canonical: false,
      recognized: false,
    });
  });
});
