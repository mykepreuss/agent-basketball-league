import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { SigningIdentity } from "./identity.js";

export const CheckpointWitnessTypes = {
  CheckpointWitness: [
    { name: "witnessId", type: "string" },
    { name: "manifestDigest", type: "bytes32" },
    { name: "root", type: "bytes32" },
    { name: "observedAt", type: "string" },
    { name: "publicationUri", type: "string" },
  ],
} as const;

export const checkpointWitnessDomain = {
  name: "ABL Checkpoint Witness",
  version: "1",
} as const;

export interface CheckpointWitnessStatement {
  witnessId: string;
  manifestDigest: Hex;
  root: Hex;
  observedAt: string;
  publicationUri: string;
}

export interface CheckpointWitnessAttestation
  extends CheckpointWitnessStatement {
  signature: Hex;
}

export interface CheckpointWitnessRecord {
  witnessId: string;
  address: Address;
  administrativeDomain: string;
  validFrom: string;
  validUntil: string | null;
}

export type CheckpointWitnessStatus =
  | "NOT_CONFIGURED"
  | "INSUFFICIENT"
  | "VERIFIED"
  | "INVALID";

export interface CheckpointWitnessResult {
  status: CheckpointWitnessStatus;
  reasons: readonly string[];
  verifiedWitnessIds: readonly string[];
  verifiedAdministrativeDomains: readonly string[];
}

export async function signCheckpointWitness(
  identity: SigningIdentity,
  statement: CheckpointWitnessStatement,
): Promise<Hex> {
  return privateKeyToAccount(identity.privateKey).signTypedData({
    domain: checkpointWitnessDomain,
    types: CheckpointWitnessTypes,
    primaryType: "CheckpointWitness",
    message: statement,
  });
}

function canonicalInstant(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) &&
    value === new Date(timestamp).toISOString()
    ? timestamp
    : null;
}

function invalidWitnessResult(reason: string): CheckpointWitnessResult {
  return {
    status: "INVALID",
    reasons: [reason],
    verifiedWitnessIds: [],
    verifiedAdministrativeDomains: [],
  };
}

function publicationMatchesAdministrativeDomain(
  publicationUri: string,
  administrativeDomain: string,
): boolean {
  if (publicationUri.startsWith("ipfs://")) return true;
  try {
    const publication = new URL(publicationUri);
    return (
      publication.protocol === "https:" &&
      publication.hostname.toLowerCase() === administrativeDomain.toLowerCase()
    );
  } catch {
    return false;
  }
}

export async function verifyCheckpointWitnesses(input: {
  manifestDigest: Hex;
  root: Hex;
  attestations: readonly CheckpointWitnessAttestation[];
  registry: readonly CheckpointWitnessRecord[];
  minimumWitnesses: number;
  notBefore: string;
  evaluatedAt: string;
}): Promise<CheckpointWitnessResult> {
  if (input.registry.length === 0) {
    return {
      status: "NOT_CONFIGURED",
      reasons: ["CHECKPOINT_WITNESS_REGISTRY_NOT_CONFIGURED"],
      verifiedWitnessIds: [],
      verifiedAdministrativeDomains: [],
    };
  }
  if (
    !Number.isSafeInteger(input.minimumWitnesses) ||
    input.minimumWitnesses < 2 ||
    input.minimumWitnesses > input.registry.length
  ) {
    return invalidWitnessResult("CHECKPOINT_WITNESS_THRESHOLD_INVALID");
  }
  const notBefore = canonicalInstant(input.notBefore);
  const evaluatedAt = canonicalInstant(input.evaluatedAt);
  if (notBefore === null || evaluatedAt === null || evaluatedAt < notBefore) {
    return invalidWitnessResult("CHECKPOINT_WITNESS_EVALUATION_TIME_INVALID");
  }
  const records = new Map<string, CheckpointWitnessRecord>();
  const addresses = new Set<string>();
  const administrativeDomains = new Set<string>();
  try {
    for (const record of input.registry) {
      const address = getAddress(record.address);
      const validFrom = canonicalInstant(record.validFrom);
      const validUntil =
        record.validUntil === null
          ? Number.POSITIVE_INFINITY
          : canonicalInstant(record.validUntil);
      if (
        records.has(record.witnessId) ||
        addresses.has(address) ||
        administrativeDomains.has(record.administrativeDomain) ||
        validFrom === null ||
        validUntil === null ||
        validUntil <= validFrom
      ) {
        return invalidWitnessResult("CHECKPOINT_WITNESS_REGISTRY_INVALID");
      }
      records.set(record.witnessId, { ...record, address });
      addresses.add(address);
      administrativeDomains.add(record.administrativeDomain);
    }
  } catch {
    return invalidWitnessResult("CHECKPOINT_WITNESS_REGISTRY_INVALID");
  }
  const verifiedWitnessIds: string[] = [];
  const verifiedDomains: string[] = [];
  const seenWitnesses = new Set<string>();
  try {
    for (const attestation of input.attestations) {
      const record = records.get(attestation.witnessId);
      const observedAt = canonicalInstant(attestation.observedAt);
      const validFrom =
        record === undefined ? null : canonicalInstant(record.validFrom);
      const validUntil =
        record?.validUntil === null || record === undefined
          ? Number.POSITIVE_INFINITY
          : canonicalInstant(record.validUntil);
      if (
        record === undefined ||
        seenWitnesses.has(attestation.witnessId) ||
        attestation.manifestDigest !== input.manifestDigest ||
        attestation.root !== input.root ||
        observedAt === null ||
        observedAt < notBefore ||
        observedAt > evaluatedAt ||
        validFrom === null ||
        validUntil === null ||
        observedAt < validFrom ||
        observedAt >= validUntil ||
        !publicationMatchesAdministrativeDomain(
          attestation.publicationUri,
          record.administrativeDomain,
        )
      ) {
        throw new Error("Invalid checkpoint witness statement");
      }
      const recovered = getAddress(
        await recoverTypedDataAddress({
          domain: checkpointWitnessDomain,
          types: CheckpointWitnessTypes,
          primaryType: "CheckpointWitness",
          message: {
            witnessId: attestation.witnessId,
            manifestDigest: attestation.manifestDigest,
            root: attestation.root,
            observedAt: attestation.observedAt,
            publicationUri: attestation.publicationUri,
          },
          signature: attestation.signature,
        }),
      );
      if (recovered !== record.address)
        throw new Error("Checkpoint witness signer mismatch");
      seenWitnesses.add(attestation.witnessId);
      verifiedWitnessIds.push(attestation.witnessId);
      verifiedDomains.push(record.administrativeDomain);
    }
  } catch {
    return invalidWitnessResult("CHECKPOINT_WITNESS_ATTESTATION_INVALID");
  }
  if (verifiedWitnessIds.length < input.minimumWitnesses) {
    return {
      status: "INSUFFICIENT",
      reasons: ["CHECKPOINT_WITNESS_THRESHOLD_NOT_MET"],
      verifiedWitnessIds,
      verifiedAdministrativeDomains: verifiedDomains,
    };
  }
  return {
    status: "VERIFIED",
    reasons: [],
    verifiedWitnessIds,
    verifiedAdministrativeDomains: verifiedDomains,
  };
}
