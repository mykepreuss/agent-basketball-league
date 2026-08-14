import type { Address, Hex, TypedDataDomain } from "viem";

import {
  checkpointManifestDigest,
  checkpointSubjectId,
  checkpointTypeId,
  type CheckpointChainClaim,
  type CheckpointChainObservation,
  type CheckpointManifest,
  type CheckpointRecognitionAnchor,
} from "./checkpoints.js";
import {
  recoverCanonicalEventSigner,
  verifyEventContent,
  type CanonicalEvent,
} from "./events.js";
import { merkleRoot } from "./merkle.js";
import { InstitutionalKeyRegistry, type ThresholdPolicy } from "./registry.js";

const MAX_UINT64 = (1n << 64n) - 1n;

export type VerificationLabel =
  | "CANONICAL"
  | "NONCANONICAL_FORK"
  | "PENDING_FINALITY"
  | "UNVERIFIABLE";

export interface VerificationResult {
  label: VerificationLabel;
  reasons: string[];
  eventHash?: Hex;
}

interface AggregateHead {
  version: bigint;
  hash: Hex | null;
}

export class PublicVerifier {
  readonly #heads = new Map<string, AggregateHead>();
  readonly #nonces = new Set<string>();
  readonly #idempotency = new Map<string, Hex>();

  public async verifyAndApply(input: {
    event: CanonicalEvent;
    signatures: readonly Hex[];
    domain: TypedDataDomain;
    registry: InstitutionalKeyRegistry;
    threshold: ThresholdPolicy;
    recusedAddresses?: ReadonlySet<Address>;
    now: string;
  }): Promise<VerificationResult> {
    const reasons: string[] = [];
    try {
      verifyEventContent(input.event);
      const eventTime = Date.parse(input.event.timestamp);
      const now = Date.parse(input.now);
      if (
        !Number.isFinite(eventTime) ||
        !Number.isFinite(now) ||
        eventTime > now + 60_000
      ) {
        throw new Error("Event timestamp is invalid or in the future");
      }
      const priorIdempotency = this.#idempotency.get(
        input.event.idempotencyKey,
      );
      if (priorIdempotency !== undefined) {
        if (priorIdempotency !== input.event.eventHash)
          throw new Error("Idempotency key content conflict");
        return {
          label: "CANONICAL",
          reasons: ["IDEMPOTENT_REPLAY"],
          eventHash: input.event.eventHash,
        };
      }
      const aggregateKey = `${input.event.aggregateType}:${input.event.aggregateId}`;
      const head = this.#heads.get(aggregateKey) ?? { version: 0n, hash: null };
      if (input.event.aggregateVersion !== head.version + 1n)
        throw new Error("Aggregate version gap or rewrite");
      if (input.event.previousEventHash !== head.hash)
        throw new Error("Previous event hash mismatch");
      const nonceKey = `${input.event.actorDid}:${input.event.nonce}`;
      if (this.#nonces.has(nonceKey)) throw new Error("Actor nonce replay");
      const signers: Address[] = [];
      for (const signature of input.signatures) {
        signers.push(
          await recoverCanonicalEventSigner(
            input.domain,
            input.event,
            signature,
          ),
        );
      }
      input.registry.authorize({
        signers,
        policy: input.threshold,
        at: input.event.timestamp,
        ...(input.recusedAddresses === undefined
          ? {}
          : { recusedAddresses: input.recusedAddresses }),
      });
      this.#heads.set(aggregateKey, {
        version: input.event.aggregateVersion,
        hash: input.event.eventHash,
      });
      this.#nonces.add(nonceKey);
      this.#idempotency.set(input.event.idempotencyKey, input.event.eventHash);
      return { label: "CANONICAL", reasons, eventHash: input.event.eventHash };
    } catch (error) {
      reasons.push(
        error instanceof Error ? error.message : "Unknown verification failure",
      );
      return { label: "NONCANONICAL_FORK", reasons };
    }
  }
}

export function verifyDeploymentAgainstRelease(input: {
  deployedSourceDigest: Hex;
  deployedImageDigests: readonly Hex[];
  deployedSchemaDigest: Hex;
  deployedMigrationDigest: Hex;
  release: {
    sourceDigest: Hex;
    imageDigests: readonly Hex[];
    schemaDigest: Hex;
    migrationDigest: Hex;
    effectiveAt: string;
    expiresAt: string | null;
  } | null;
  at: string;
}): VerificationResult {
  if (input.release === null)
    return { label: "NONCANONICAL_FORK", reasons: ["NO_RECOGNIZED_RELEASE"] };
  const release = input.release;
  const effective = Date.parse(release.effectiveAt);
  const expiry =
    release.expiresAt === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(release.expiresAt);
  const at = Date.parse(input.at);
  if (
    !Number.isFinite(effective) ||
    !Number.isFinite(at) ||
    (release.expiresAt !== null &&
      (!Number.isFinite(expiry) || expiry <= effective))
  ) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["RELEASE_TIME_WINDOW_INVALID"],
    };
  }
  const imagesMatch =
    [...input.deployedImageDigests].sort().join(":") ===
    [...release.imageDigests].sort().join(":");
  if (
    at < effective ||
    at >= expiry ||
    input.deployedSourceDigest !== release.sourceDigest ||
    !imagesMatch ||
    input.deployedSchemaDigest !== release.schemaDigest ||
    input.deployedMigrationDigest !== release.migrationDigest
  ) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["DEPLOYED_ARTIFACTS_DO_NOT_MATCH_RELEASE"],
    };
  }
  return { label: "CANONICAL", reasons: [] };
}

export function verifyCheckpointClaim(input: {
  manifest: CheckpointManifest;
  manifestDigest: Hex;
  claim: CheckpointChainClaim;
  observation: CheckpointChainObservation | null;
  anchor: CheckpointRecognitionAnchor;
}): VerificationResult {
  const manifestDigest = checkpointManifestDigest(input.manifest);
  if (manifestDigest !== input.manifestDigest) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_MANIFEST_DIGEST_MISMATCH"],
    };
  }
  if (
    merkleRoot(input.manifest.eventHashes) !== input.manifest.merkleRoot ||
    input.manifest.firstEventHash !== (input.manifest.eventHashes[0] ?? null) ||
    input.manifest.lastEventHash !==
      (input.manifest.eventHashes.at(-1) ?? null) ||
    (input.claim.checkpointType !== "KEY_REGISTRY" &&
      input.claim.root !== input.manifest.merkleRoot) ||
    input.claim.checkpointType !== input.manifest.checkpointType ||
    input.claim.subjectId !== input.manifest.subjectId
  ) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_ROOT_MISMATCH"],
    };
  }
  if (input.claim.nonce !== manifestDigest) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_MANIFEST_NOT_ANCHORED"],
    };
  }
  if (
    input.claim.validAfter < 0n ||
    input.claim.validBefore <= input.claim.validAfter ||
    input.claim.validBefore > MAX_UINT64 ||
    (input.claim.blockNumber !== null && input.claim.blockNumber < 0n) ||
    !Number.isSafeInteger(input.claim.chainId) ||
    input.claim.chainId <= 0 ||
    !Number.isSafeInteger(input.anchor.requiredConfirmations) ||
    input.anchor.requiredConfirmations <= 0
  ) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_CHAIN_CLAIM_INVALID"],
    };
  }
  if (input.anchor.state === "PRE_GENESIS_UNRATIFIED") {
    return {
      label: "UNVERIFIABLE",
      reasons: ["CHECKPOINT_RECOGNITION_ANCHOR_UNRATIFIED"],
    };
  }
  const anchorTime = Date.parse(input.anchor.finalizedAt);
  if (
    input.claim.chainId !== input.anchor.chainId ||
    input.claim.contractAddress.toLowerCase() !==
      input.anchor.contractAddress.toLowerCase() ||
    (input.claim.blockNumber !== null &&
      input.claim.blockNumber < input.anchor.deploymentBlockNumber) ||
    input.anchor.deploymentBlockNumber < 0n ||
    !Number.isFinite(anchorTime) ||
    input.anchor.finalizedAt !== new Date(anchorTime).toISOString()
  ) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_RECOGNITION_ANCHOR_MISMATCH"],
    };
  }
  if (input.claim.transactionHash === null) {
    return {
      label: "UNVERIFIABLE",
      reasons: ["CHECKPOINT_TRANSACTION_MISSING"],
    };
  }
  const observation = input.observation;
  if (observation === null) {
    return {
      label: "UNVERIFIABLE",
      reasons: ["CHECKPOINT_CHAIN_OBSERVATION_MISSING"],
    };
  }
  const observationTime = Date.parse(observation.observedAt);
  const signaturesMatch =
    input.claim.signatures.length > 0 &&
    input.claim.signatures.length === observation.signatures.length &&
    input.claim.signatures.every(
      (signature, index) =>
        /^0x[0-9a-f]{130}$/.test(signature) &&
        signature === observation.signatures[index],
    );
  if (
    !observation.receiptSucceeded ||
    observation.runtimeBytecodeKeccak256 !==
      input.anchor.deployedRuntimeBytecodeKeccak256 ||
    !Number.isFinite(observationTime) ||
    observation.observedAt !== new Date(observationTime).toISOString() ||
    observation.blockNumber < 0n ||
    observation.blockNumber < input.anchor.deploymentBlockNumber ||
    observation.blockTimestamp < 0n ||
    !Number.isSafeInteger(observation.confirmations) ||
    observation.confirmations < 0 ||
    observation.chainId !== input.claim.chainId ||
    observation.contractAddress.toLowerCase() !==
      input.claim.contractAddress.toLowerCase() ||
    observation.transactionHash !== input.claim.transactionHash ||
    (input.claim.blockNumber !== null &&
      observation.blockNumber !== input.claim.blockNumber) ||
    observation.checkpointTypeId !==
      checkpointTypeId(input.claim.checkpointType) ||
    observation.subjectId !== checkpointSubjectId(input.claim.subjectId) ||
    observation.root !== input.claim.root ||
    observation.previousRoot !== input.claim.previousRoot ||
    observation.nonce !== input.claim.nonce ||
    observation.validAfter !== input.claim.validAfter ||
    observation.validBefore !== input.claim.validBefore ||
    observation.blockTimestamp < input.claim.validAfter ||
    observation.blockTimestamp >= input.claim.validBefore ||
    !signaturesMatch
  ) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_CHAIN_OBSERVATION_MISMATCH"],
    };
  }
  if (observation.confirmations < input.anchor.requiredConfirmations) {
    return {
      label: "PENDING_FINALITY",
      reasons: ["CHECKPOINT_CONFIRMATIONS_PENDING"],
    };
  }
  if (!observation.baseFinalized) {
    return {
      label: "PENDING_FINALITY",
      reasons: ["CHECKPOINT_BASE_FINALITY_PENDING"],
    };
  }
  return { label: "CANONICAL", reasons: [] };
}
