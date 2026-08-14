import type { Address } from "viem";

export interface GuardianSet {
  version: number;
  guardianDids: readonly string[];
  threshold: number;
  validFrom: string;
}

export interface DelegationMandate {
  mandateId: string;
  principalDid: string;
  delegateDid: string;
  capabilities: readonly string[];
  subjectIds: readonly string[];
  validFrom: string;
  expiresAt: string;
  revokedAt: string | null;
}

export class CredentialController {
  readonly agentDid: string;
  #signingAddress: Address;
  #encryptionPublicKey: `0x${string}`;
  #guardianSet: GuardianSet | null = null;
  readonly #usedRecoveryIds = new Set<string>();
  readonly #delegations = new Map<string, DelegationMandate>();

  public constructor(
    agentDid: string,
    signingAddress: Address,
    encryptionPublicKey: `0x${string}`,
  ) {
    this.agentDid = agentDid;
    this.#signingAddress = signingAddress;
    this.#encryptionPublicKey = encryptionPublicKey;
  }

  public rotate(input: {
    authorizedBy: Address;
    newSigningAddress: Address;
    newEncryptionPublicKey: `0x${string}`;
  }): void {
    if (input.authorizedBy.toLowerCase() !== this.#signingAddress.toLowerCase())
      throw new Error("Key rotation lacks current career authorization");
    if (
      input.newSigningAddress.toLowerCase() ===
      this.#signingAddress.toLowerCase()
    )
      throw new Error("Signing key did not rotate");
    this.#signingAddress = input.newSigningAddress;
    this.#encryptionPublicKey = input.newEncryptionPublicKey;
  }

  public installGuardians(set: GuardianSet, authorizedBy: Address): void {
    if (authorizedBy.toLowerCase() !== this.#signingAddress.toLowerCase())
      throw new Error("Guardian change lacks career authorization");
    if (
      set.threshold < 1 ||
      set.threshold > new Set(set.guardianDids).size ||
      new Set(set.guardianDids).size !== set.guardianDids.length
    ) {
      throw new Error("Invalid guardian threshold/set");
    }
    if (set.version !== (this.#guardianSet?.version ?? 0) + 1)
      throw new Error("Guardian versions must be contiguous");
    this.#guardianSet = structuredClone(set);
  }

  public recover(input: {
    proposalId: string;
    guardianApprovals: readonly string[];
    newSigningAddress: Address;
    newEncryptionPublicKey: `0x${string}`;
    proposedAt: string;
    expiresAt: string;
    executedAt: string;
  }): void {
    const guardians = this.#guardianSet;
    if (guardians === null) throw new Error("No guardian set is active");
    if (this.#usedRecoveryIds.has(input.proposalId))
      throw new Error("Recovery proposal replay");
    const now = Date.parse(input.executedAt);
    if (
      now < Date.parse(input.proposedAt) ||
      now >= Date.parse(input.expiresAt)
    )
      throw new Error("Recovery proposal is outside its time window");
    const unique = new Set(input.guardianApprovals);
    const eligible = [...unique].filter((did) =>
      guardians.guardianDids.includes(did),
    );
    if (eligible.length < guardians.threshold)
      throw new Error("Guardian threshold is not met");
    this.#signingAddress = input.newSigningAddress;
    this.#encryptionPublicKey = input.newEncryptionPublicKey;
    this.#usedRecoveryIds.add(input.proposalId);
  }

  public delegate(mandate: DelegationMandate, authorizedBy: Address): void {
    if (
      authorizedBy.toLowerCase() !== this.#signingAddress.toLowerCase() ||
      mandate.principalDid !== this.agentDid
    ) {
      throw new Error("Delegation lacks principal authorization");
    }
    if (
      mandate.capabilities.some(
        (capability) =>
          capability.startsWith("foundational-right:") ||
          capability === "career:exit",
      )
    ) {
      throw new Error("Foundational rights and exit cannot be delegated");
    }
    this.#delegations.set(mandate.mandateId, structuredClone(mandate));
  }

  public authorizeDelegation(
    mandateId: string,
    delegateDid: string,
    capability: string,
    subjectId: string,
    at: string,
  ): void {
    const mandate = this.#delegations.get(mandateId);
    if (
      mandate === undefined ||
      mandate.delegateDid !== delegateDid ||
      !mandate.capabilities.includes(capability) ||
      !mandate.subjectIds.includes(subjectId) ||
      Date.parse(at) < Date.parse(mandate.validFrom) ||
      Date.parse(at) >= Date.parse(mandate.expiresAt) ||
      (mandate.revokedAt !== null &&
        Date.parse(at) >= Date.parse(mandate.revokedAt))
    ) {
      throw new Error(
        "Delegation is ineligible, expired, revoked, or overbroad",
      );
    }
  }

  public get signingAddress(): Address {
    return this.#signingAddress;
  }

  public get encryptionPublicKey(): `0x${string}` {
    return this.#encryptionPublicKey;
  }
}
