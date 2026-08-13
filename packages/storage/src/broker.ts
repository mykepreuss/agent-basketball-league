import { createHash } from "node:crypto";

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

export interface CiphertextBrokerState {
  policies: readonly StorageDomainPolicy[];
  objects: readonly EncryptedBlob[];
  guardianEnvelopes: readonly GuardianWrappedKey[];
  deletions: readonly CiphertextDeletionReceipt[];
}

export interface CiphertextDeletionReceipt {
  format: "ABL-CIPHERTEXT-DELETION-V1";
  domainId: string;
  objectId: string;
  actorDid: string;
  deletedVersion: number;
  lastCiphertextCommitment: string;
  deletedAt: string;
  providerResidualDeletionVerified: false;
  deletionCommitment: string;
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

function objectKey(domainId: string, objectId: string): string {
  return `${domainId}:${objectId}`;
}

function deletionCommitment(
  receipt: Omit<CiphertextDeletionReceipt, "deletionCommitment">,
): string {
  const canonicalReceipt = {
    format: receipt.format,
    domainId: receipt.domainId,
    objectId: receipt.objectId,
    actorDid: receipt.actorDid,
    deletedVersion: receipt.deletedVersion,
    lastCiphertextCommitment: receipt.lastCiphertextCommitment,
    deletedAt: receipt.deletedAt,
    providerResidualDeletionVerified: receipt.providerResidualDeletionVerified,
  };
  return `0x${createHash("sha256").update(JSON.stringify(canonicalReceipt)).digest("hex")}`;
}

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && value === new Date(timestamp).toISOString()
  );
}

export function verifyCiphertextDeletionReceipt(
  receipt: CiphertextDeletionReceipt,
): void {
  const { deletionCommitment: supplied, ...content } = receipt;
  if (
    receipt.format !== "ABL-CIPHERTEXT-DELETION-V1" ||
    receipt.domainId.length < 1 ||
    receipt.objectId.length < 1 ||
    !receipt.actorDid.startsWith("did:") ||
    !Number.isInteger(receipt.deletedVersion) ||
    receipt.deletedVersion < 1 ||
    !/^0x[0-9a-f]{64}$/.test(receipt.lastCiphertextCommitment) ||
    !isCanonicalTimestamp(receipt.deletedAt) ||
    receipt.providerResidualDeletionVerified !== false ||
    supplied !== deletionCommitment(content)
  ) {
    throw new StorageVersionConflictError(
      "Ciphertext deletion receipt is invalid",
    );
  }
}

export class CiphertextBroker {
  readonly #policies = new Map<string, StorageDomainPolicy>();
  readonly #objects = new Map<string, EncryptedBlob[]>();
  readonly #guardianEnvelopes = new Map<string, GuardianWrappedKey[]>();
  readonly #deletions = new Map<string, CiphertextDeletionReceipt>();

  public static restore(state: CiphertextBrokerState): CiphertextBroker {
    const broker = new CiphertextBroker();
    const policiesByDomain = new Map<string, StorageDomainPolicy[]>();
    for (const policy of state.policies) {
      const policies = policiesByDomain.get(policy.domainId) ?? [];
      policies.push(clone(policy));
      policiesByDomain.set(policy.domainId, policies);
    }
    for (const [domainId, policies] of policiesByDomain) {
      policies.sort((left, right) => left.version - right.version);
      policies.forEach((policy, index) => {
        if (
          policy.domainId !== domainId ||
          policy.version !== index + 1 ||
          !Object.values(policy.members).some((grants) =>
            grants.includes("ADMIN"),
          )
        ) {
          throw new StorageVersionConflictError(
            `Durable policy chain is invalid for ${domainId}`,
          );
        }
      });
      broker.#policies.set(domainId, clone(policies.at(-1)!));
    }

    const objectsByKey = new Map<string, EncryptedBlob[]>();
    for (const blob of state.objects) {
      if (!broker.#policies.has(blob.domainId)) {
        throw new StorageAuthorizationError(
          `Durable object references unknown domain ${blob.domainId}`,
        );
      }
      const key = objectKey(blob.domainId, blob.objectId);
      const versions = objectsByKey.get(key) ?? [];
      versions.push(clone(blob));
      objectsByKey.set(key, versions);
    }
    for (const [key, versions] of objectsByKey) {
      versions.sort((left, right) => left.version - right.version);
      versions.forEach((blob, index) => {
        const prior = versions[index - 1];
        if (
          blob.version !== index + 1 ||
          blob.previousVersionCommitment !==
            (prior?.ciphertextCommitment ?? null)
        ) {
          throw new StorageVersionConflictError(
            `Durable ciphertext chain is invalid for ${key}`,
          );
        }
      });
      broker.#objects.set(key, clone(versions));
    }

    for (const receipt of state.deletions) {
      verifyCiphertextDeletionReceipt(receipt);
      const policy = broker.#policies.get(receipt.domainId);
      if (policy === undefined)
        throw new StorageAuthorizationError(
          `Durable deletion references unknown domain ${receipt.domainId}`,
        );
      broker.#assertPersonalOwner(policy, receipt.actorDid);
      const key = objectKey(receipt.domainId, receipt.objectId);
      if (broker.#deletions.has(key))
        throw new StorageVersionConflictError(
          `Durable deletion is duplicated for ${key}`,
        );
      const versions = broker.#objects.get(key);
      const latest = versions?.at(-1);
      if (
        latest !== undefined &&
        (latest.version !== receipt.deletedVersion ||
          latest.ciphertextCommitment !== receipt.lastCiphertextCommitment)
      ) {
        throw new StorageVersionConflictError(
          `Durable deletion does not match ciphertext history for ${key}`,
        );
      }
      broker.#objects.delete(key);
      broker.#deletions.set(key, clone(receipt));
    }

    for (const envelope of state.guardianEnvelopes) {
      const policy = broker.#policies.get(envelope.domainId);
      if (
        policy === undefined ||
        !policy.guardianEnvelopeCommitments.includes(envelope.commitment)
      ) {
        throw new StorageAuthorizationError(
          "Durable guardian envelope is absent from its domain policy",
        );
      }
      const envelopes = broker.#guardianEnvelopes.get(envelope.domainId) ?? [];
      if (
        envelopes.some(
          (candidate) =>
            candidate.guardianDid === envelope.guardianDid ||
            candidate.commitment === envelope.commitment,
        )
      ) {
        throw new StorageVersionConflictError(
          "Durable guardian envelope is duplicated",
        );
      }
      envelopes.push(clone(envelope));
      broker.#guardianEnvelopes.set(envelope.domainId, envelopes);
    }
    return broker;
  }

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

  public domainPolicy(domainId: string): StorageDomainPolicy | undefined {
    const policy = this.#policies.get(domainId);
    return policy === undefined ? undefined : clone(policy);
  }

  public put(callerDid: string, blob: EncryptedBlob): () => void {
    const policy = this.#policy(blob.domainId);
    this.#assertAccess(policy, callerDid, "WRITE");
    const key = objectKey(blob.domainId, blob.objectId);
    if (this.#deletions.has(key))
      throw new StorageVersionConflictError(
        "Deleted ciphertext object identifiers cannot be reused",
      );
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
    const versions = this.#objects.get(objectKey(domainId, objectId)) ?? [];
    const blob =
      version === undefined
        ? versions.at(-1)
        : versions.find((candidate) => candidate.version === version);
    if (blob === undefined)
      throw new Error("Ciphertext object/version not found");
    return clone(blob);
  }

  public verifyObjectCommitment(input: {
    ownerDid: string;
    domainId: string;
    objectId: string;
    version: number;
    ciphertextCommitment: string;
  }): void {
    const policy = this.#policy(input.domainId);
    this.#assertPersonalOwner(policy, input.ownerDid);
    const blob = this.get(
      input.ownerDid,
      input.domainId,
      input.objectId,
      input.version,
    );
    if (blob.ciphertextCommitment !== input.ciphertextCommitment)
      throw new StorageAuthorizationError(
        "Ciphertext commitment does not match durable storage",
      );
  }

  public prepareDeletion(
    callerDid: string,
    domainId: string,
    objectId: string,
    deletedAt: string,
  ): CiphertextDeletionReceipt {
    const policy = this.#policy(domainId);
    this.#assertPersonalOwner(policy, callerDid);
    if (!isCanonicalTimestamp(deletedAt))
      throw new StorageVersionConflictError(
        "Ciphertext deletion time must be canonical",
      );
    const key = objectKey(domainId, objectId);
    if (this.#deletions.has(key))
      throw new StorageVersionConflictError(
        "Ciphertext object has already been deleted",
      );
    const latest = this.#objects.get(key)?.at(-1);
    if (latest === undefined) throw new Error("Ciphertext object not found");
    const content = {
      format: "ABL-CIPHERTEXT-DELETION-V1" as const,
      domainId,
      objectId,
      actorDid: callerDid,
      deletedVersion: latest.version,
      lastCiphertextCommitment: latest.ciphertextCommitment,
      deletedAt,
      providerResidualDeletionVerified: false as const,
    };
    return { ...content, deletionCommitment: deletionCommitment(content) };
  }

  public applyDeletion(receipt: CiphertextDeletionReceipt): void {
    verifyCiphertextDeletionReceipt(receipt);
    const expected = this.prepareDeletion(
      receipt.actorDid,
      receipt.domainId,
      receipt.objectId,
      receipt.deletedAt,
    );
    if (expected.deletionCommitment !== receipt.deletionCommitment)
      throw new StorageVersionConflictError(
        "Ciphertext deletion no longer matches the live object",
      );
    const key = objectKey(receipt.domainId, receipt.objectId);
    this.#objects.delete(key);
    this.#deletions.set(key, clone(receipt));
  }

  public verifyDeletionReceipt(
    ownerDid: string,
    receipt: CiphertextDeletionReceipt,
  ): void {
    verifyCiphertextDeletionReceipt(receipt);
    const policy = this.#policy(receipt.domainId);
    this.#assertPersonalOwner(policy, ownerDid);
    if (receipt.actorDid !== ownerDid)
      throw new StorageAuthorizationError(
        "Ciphertext deletion belongs to another actor",
      );
    const durable = this.#deletions.get(
      objectKey(receipt.domainId, receipt.objectId),
    );
    if (durable?.deletionCommitment !== receipt.deletionCommitment)
      throw new StorageAuthorizationError(
        "Ciphertext deletion receipt is not durable",
      );
  }

  public deletionReceipt(
    ownerDid: string,
    domainId: string,
    objectId: string,
  ): CiphertextDeletionReceipt | undefined {
    const policy = this.#policy(domainId);
    this.#assertPersonalOwner(policy, ownerDid);
    const receipt = this.#deletions.get(objectKey(domainId, objectId));
    return receipt === undefined ? undefined : clone(receipt);
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
      deletions: [...this.#deletions.values()].map((receipt) => ({
        domainId: receipt.domainId,
        objectId: receipt.objectId,
        actorDid: receipt.actorDid,
        deletedVersion: receipt.deletedVersion,
        lastCiphertextCommitment: receipt.lastCiphertextCommitment,
        deletedAt: receipt.deletedAt,
        deletionCommitment: receipt.deletionCommitment,
        providerResidualDeletionVerified: false,
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

  #assertPersonalOwner(policy: StorageDomainPolicy, ownerDid: string): void {
    if (policy.kind !== "PERSONAL")
      throw new StorageAuthorizationError(
        "Personal memory operations require a PERSONAL storage domain",
      );
    this.#assertAccess(policy, ownerDid, "ADMIN");
  }
}
