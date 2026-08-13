import type { Address, Hex, TypedDataDomain } from "viem";

import {
  checkpointManifestDigest,
  type CheckpointManifest,
} from "./checkpoints.js";
import {
  recoverCanonicalEventSigner,
  verifyEventContent,
  type CanonicalEvent,
} from "./events.js";
import { merkleRoot } from "./merkle.js";
import { InstitutionalKeyRegistry, type ThresholdPolicy } from "./registry.js";

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
  claimedRoot: Hex;
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  confirmations: number;
  requiredConfirmations: number;
}): VerificationResult {
  if (checkpointManifestDigest(input.manifest) !== input.manifestDigest) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_MANIFEST_DIGEST_MISMATCH"],
    };
  }
  if (
    merkleRoot(input.manifest.eventHashes) !== input.manifest.merkleRoot ||
    input.claimedRoot !== input.manifest.merkleRoot
  ) {
    return {
      label: "NONCANONICAL_FORK",
      reasons: ["CHECKPOINT_ROOT_MISMATCH"],
    };
  }
  if (input.transactionHash === null || input.blockNumber === null) {
    return {
      label: "UNVERIFIABLE",
      reasons: ["CHECKPOINT_TRANSACTION_MISSING"],
    };
  }
  if (input.confirmations < input.requiredConfirmations) {
    return {
      label: "PENDING_FINALITY",
      reasons: ["CHECKPOINT_CONFIRMATIONS_PENDING"],
    };
  }
  return { label: "CANONICAL", reasons: [] };
}
