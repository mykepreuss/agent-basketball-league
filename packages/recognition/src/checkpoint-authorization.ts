import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  checkpointSubjectId,
  checkpointTypeId,
  type CheckpointChainClaim,
} from "./checkpoints.js";
import type { SigningIdentity } from "./identity.js";
import { InstitutionalKeyRegistry, type ThresholdPolicy } from "./registry.js";

export const CheckpointAuthorizationTypes = {
  Checkpoint: [
    { name: "checkpointType", type: "bytes32" },
    { name: "subjectId", type: "bytes32" },
    { name: "root", type: "bytes32" },
    { name: "previousRoot", type: "bytes32" },
    { name: "validAfter", type: "uint64" },
    { name: "validBefore", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

function checkpointMessage(claim: CheckpointChainClaim) {
  return {
    checkpointType: checkpointTypeId(claim.checkpointType),
    subjectId: checkpointSubjectId(claim.subjectId),
    root: claim.root,
    previousRoot: claim.previousRoot,
    validAfter: claim.validAfter,
    validBefore: claim.validBefore,
    nonce: claim.nonce,
  };
}

function checkpointDomain(claim: CheckpointChainClaim) {
  return {
    name: "ABL Recognition",
    version: "1",
    chainId: claim.chainId,
    verifyingContract: claim.contractAddress,
  } as const;
}

export interface CheckpointAuthorizationResult {
  valid: boolean;
  reasons: readonly string[];
  signers: readonly Address[];
}

export async function signCheckpointAuthorization(
  identity: SigningIdentity,
  claim: CheckpointChainClaim,
): Promise<Hex> {
  return privateKeyToAccount(identity.privateKey).signTypedData({
    domain: checkpointDomain(claim),
    types: CheckpointAuthorizationTypes,
    primaryType: "Checkpoint",
    message: checkpointMessage(claim),
  });
}

export async function verifyCheckpointAuthorization(input: {
  claim: CheckpointChainClaim;
  registry: InstitutionalKeyRegistry;
  policy: ThresholdPolicy;
  authorizedAt: string;
}): Promise<CheckpointAuthorizationResult> {
  const authorizedAt = Date.parse(input.authorizedAt);
  const authorizedAtSeconds = BigInt(
    Number.isFinite(authorizedAt) ? Math.floor(authorizedAt / 1_000) : -1,
  );
  if (
    !Number.isFinite(authorizedAt) ||
    input.authorizedAt !== new Date(authorizedAt).toISOString() ||
    authorizedAtSeconds < input.claim.validAfter ||
    authorizedAtSeconds >= input.claim.validBefore
  ) {
    return {
      valid: false,
      reasons: ["CHECKPOINT_AUTHORIZATION_TIME_INVALID"],
      signers: [],
    };
  }
  if (input.claim.signatures.length === 0) {
    return {
      valid: false,
      reasons: ["CHECKPOINT_AUTHORIZATION_SIGNATURES_MISSING"],
      signers: [],
    };
  }
  try {
    const signers: Address[] = [];
    for (const signature of input.claim.signatures) {
      signers.push(
        getAddress(
          await recoverTypedDataAddress({
            domain: checkpointDomain(input.claim),
            types: CheckpointAuthorizationTypes,
            primaryType: "Checkpoint",
            message: checkpointMessage(input.claim),
            signature,
          }),
        ),
      );
    }
    for (let index = 1; index < signers.length; index += 1) {
      if (signers[index - 1]!.toLowerCase() >= signers[index]!.toLowerCase()) {
        return {
          valid: false,
          reasons: ["CHECKPOINT_AUTHORIZATION_SIGNERS_NOT_SORTED"],
          signers,
        };
      }
    }
    input.registry.authorize({
      signers,
      policy: input.policy,
      at: input.authorizedAt,
    });
    return { valid: true, reasons: [], signers };
  } catch {
    return {
      valid: false,
      reasons: ["CHECKPOINT_AUTHORIZATION_INVALID"],
      signers: [],
    };
  }
}
