import { getAddress, type Address } from "viem";

export type InstitutionalRole =
  | "CAREER_AGENT"
  | "COMMISSIONER"
  | "INTEGRITY_OFFICER"
  | "TRIBUNAL"
  | "PREMIER_PLAYER_BOARD"
  | "DEVELOPMENT_PLAYER_BOARD"
  | "PREMIER_GOVERNOR"
  | "DEVELOPMENT_GOVERNOR"
  | "REFEREE"
  | "REPLAY_OFFICIAL"
  | "PROJECTOR";

export interface InstitutionalKeyRecord {
  address: Address;
  did: string;
  role: InstitutionalRole;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
  purpose: "SIGNING";
}

export interface ThresholdGroup {
  role: InstitutionalRole;
  required: number;
}

export interface ThresholdPolicy {
  policyId: string;
  groups: readonly ThresholdGroup[];
}

export const thresholdPolicies = {
  ROUTINE_RELEASE: {
    policyId: "ROUTINE_RELEASE",
    groups: [
      { role: "COMMISSIONER", required: 2 },
      { role: "INTEGRITY_OFFICER", required: 2 },
    ],
  },
  CONSTITUTIONAL_RELEASE: {
    policyId: "CONSTITUTIONAL_RELEASE",
    groups: [
      { role: "COMMISSIONER", required: 2 },
      { role: "INTEGRITY_OFFICER", required: 2 },
      { role: "TRIBUNAL", required: 4 },
    ],
  },
  KEY_REGISTRY: {
    policyId: "KEY_REGISTRY",
    groups: [
      { role: "COMMISSIONER", required: 2 },
      { role: "INTEGRITY_OFFICER", required: 2 },
      { role: "TRIBUNAL", required: 4 },
    ],
  },
  FINAL_GAME: {
    policyId: "FINAL_GAME",
    groups: [
      { role: "REFEREE", required: 3 },
      { role: "INTEGRITY_OFFICER", required: 1 },
    ],
  },
} as const satisfies Record<string, ThresholdPolicy>;

export class InstitutionalKeyRegistry {
  readonly #records = new Map<Address, InstitutionalKeyRecord>();

  public constructor(records: readonly InstitutionalKeyRecord[]) {
    for (const record of records) {
      const address = getAddress(record.address);
      if (this.#records.has(address))
        throw new Error(`Duplicate institutional key: ${address}`);
      this.#records.set(address, { ...record, address });
    }
  }

  public record(address: Address): InstitutionalKeyRecord | undefined {
    const record = this.#records.get(getAddress(address));
    return record === undefined ? undefined : { ...record };
  }

  public authorize(input: {
    signers: readonly Address[];
    policy: ThresholdPolicy;
    at: string;
    recusedAddresses?: ReadonlySet<Address>;
  }): InstitutionalKeyRecord[] {
    const at = Date.parse(input.at);
    if (!Number.isFinite(at)) throw new Error("Invalid authorization time");
    const unique = new Set<Address>();
    const eligible: InstitutionalKeyRecord[] = [];
    for (const unnormalized of input.signers) {
      const address = getAddress(unnormalized);
      if (unique.has(address)) throw new Error(`Duplicate signer: ${address}`);
      unique.add(address);
      if (input.recusedAddresses?.has(address) === true)
        throw new Error(`Recused signer: ${address}`);
      const record = this.#records.get(address);
      if (record === undefined)
        throw new Error(`Unknown institutional signer: ${address}`);
      const validFrom = Date.parse(record.validFrom);
      const validUntil =
        record.validUntil === null
          ? Number.POSITIVE_INFINITY
          : Date.parse(record.validUntil);
      const revokedAt =
        record.revokedAt === null
          ? Number.POSITIVE_INFINITY
          : Date.parse(record.revokedAt);
      if (at < validFrom || at >= validUntil || at >= revokedAt)
        throw new Error(`Institutional signer is inactive: ${address}`);
      eligible.push({ ...record });
    }
    for (const group of input.policy.groups) {
      if (
        eligible.filter((record) => record.role === group.role).length <
        group.required
      ) {
        throw new Error(`Threshold not met for ${group.role}`);
      }
    }
    return eligible;
  }
}
