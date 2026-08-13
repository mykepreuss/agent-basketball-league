import type { EncryptedBlob, GuardianWrappedKey } from "./crypto.js";

export type StorageDomainKind =
  | "PERSONAL"
  | "CLUB"
  | "UNION"
  | "TRIBUNAL"
  | "CASE";
export type StorageAccess = "READ" | "WRITE" | "ADMIN";

export interface StorageDomainPolicy {
  domainId: string;
  kind: StorageDomainKind;
  version: number;
  members: Readonly<Record<string, readonly StorageAccess[]>>;
  guardianEnvelopeCommitments: readonly string[];
  manifestCommitment: string;
}

export class StorageAuthorizationError extends Error {
  public override readonly name = "StorageAuthorizationError";
}

export class StorageVersionConflictError extends Error {
  public override readonly name = "StorageVersionConflictError";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class CiphertextBroker {
  readonly #policies = new Map<string, StorageDomainPolicy>();
  readonly #objects = new Map<string, EncryptedBlob[]>();
  readonly #guardianEnvelopes = new Map<string, GuardianWrappedKey[]>();

  public registerDomain(callerDid: string, policy: StorageDomainPolicy): void {
    const prior = this.#policies.get(policy.domainId);
    if (prior === undefined) {
      if (!policy.members[callerDid]?.includes("ADMIN")) {
        throw new StorageAuthorizationError(
          "Creating a domain requires ADMIN membership in the signed policy",
        );
      }
      if (policy.version !== 1)
        throw new StorageVersionConflictError(
          "Initial domain policy version must be one",
        );
    } else {
      this.#assertAccess(prior, callerDid, "ADMIN");
      if (policy.version !== prior.version + 1) {
        throw new StorageVersionConflictError(
          "Domain policy versions must be contiguous",
        );
      }
    }
    this.#policies.set(policy.domainId, clone(policy));
  }

  public put(callerDid: string, blob: EncryptedBlob): () => void {
    const policy = this.#policy(blob.domainId);
    this.#assertAccess(policy, callerDid, "WRITE");
    const key = `${blob.domainId}:${blob.objectId}`;
    const versions = this.#objects.get(key) ?? [];
    const prior = versions.at(-1);
    const expectedVersion = (prior?.version ?? 0) + 1;
    const expectedPrior = prior?.ciphertextCommitment ?? null;
    if (
      blob.version !== expectedVersion ||
      blob.previousVersionCommitment !== expectedPrior
    ) {
      throw new StorageVersionConflictError(
        "Ciphertext version chain is not contiguous",
      );
    }
    const stored = clone(blob);
    versions.push(stored);
    this.#objects.set(key, versions);
    let active = true;
    return () => {
      if (!active) return;
      const latest = versions.at(-1);
      if (
        latest?.version !== stored.version ||
        latest.ciphertextCommitment !== stored.ciphertextCommitment
      ) {
        throw new StorageVersionConflictError(
          "Ciphertext write cannot be rolled back after a later version",
        );
      }
      versions.pop();
      if (versions.length === 0) this.#objects.delete(key);
      active = false;
    };
  }

  public get(
    callerDid: string,
    domainId: string,
    objectId: string,
    version?: number,
  ): EncryptedBlob {
    const policy = this.#policy(domainId);
    this.#assertAccess(policy, callerDid, "READ");
    const versions = this.#objects.get(`${domainId}:${objectId}`) ?? [];
    const blob =
      version === undefined
        ? versions.at(-1)
        : versions.find((candidate) => candidate.version === version);
    if (blob === undefined)
      throw new Error("Ciphertext object/version not found");
    return clone(blob);
  }

  public putGuardianEnvelope(
    callerDid: string,
    envelope: GuardianWrappedKey,
  ): void {
    const policy = this.#policy(envelope.domainId);
    this.#assertAccess(policy, callerDid, "ADMIN");
    if (!policy.guardianEnvelopeCommitments.includes(envelope.commitment)) {
      throw new StorageAuthorizationError(
        "Guardian envelope is absent from the signed domain manifest",
      );
    }
    const envelopes = this.#guardianEnvelopes.get(envelope.domainId) ?? [];
    envelopes.push(clone(envelope));
    this.#guardianEnvelopes.set(envelope.domainId, envelopes);
  }

  public getGuardianEnvelope(
    callerDid: string,
    domainId: string,
    guardianDid: string,
  ): GuardianWrappedKey {
    const policy = this.#policy(domainId);
    this.#assertAccess(policy, callerDid, "ADMIN");
    const envelope = (this.#guardianEnvelopes.get(domainId) ?? []).find(
      (candidate) => candidate.guardianDid === guardianDid,
    );
    if (envelope === undefined) throw new Error("Guardian envelope not found");
    return clone(envelope);
  }

  public metadataSnapshot(): unknown {
    return {
      policies: [...this.#policies.values()].map((policy) => ({
        domainId: policy.domainId,
        kind: policy.kind,
        version: policy.version,
        memberDids: Object.keys(policy.members),
        guardianEnvelopeCommitments: policy.guardianEnvelopeCommitments,
        manifestCommitment: policy.manifestCommitment,
      })),
      objects: [...this.#objects.entries()].map(([key, values]) => ({
        key,
        versions: values.map((value) => ({
          version: value.version,
          ciphertextCommitment: value.ciphertextCommitment,
          contentType: value.contentType,
          createdAt: value.createdAt,
        })),
      })),
    };
  }

  #policy(domainId: string): StorageDomainPolicy {
    const policy = this.#policies.get(domainId);
    if (policy === undefined)
      throw new StorageAuthorizationError("Unknown storage domain");
    return policy;
  }

  #assertAccess(
    policy: StorageDomainPolicy,
    callerDid: string,
    required: StorageAccess,
  ): void {
    const grants = policy.members[callerDid] ?? [];
    const allowed = grants.includes("ADMIN") || grants.includes(required);
    if (!allowed)
      throw new StorageAuthorizationError(
        `Caller lacks ${required} access to ${policy.kind} domain`,
      );
  }
}
