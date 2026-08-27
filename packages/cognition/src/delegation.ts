import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { RunnerDelegation } from "@abl/schemas";

export const RUNNER_DELEGATION_DOMAIN = {
  name: "ABL Career Runner Delegation",
  version: "2",
  chainId: 1,
  verifyingContract: "0x0000000000000000000000000000000000000ab1",
} as const;

export const RunnerDelegationTypes = {
  RunnerDelegation: [
    { name: "delegationId", type: "string" },
    { name: "careerDid", type: "string" },
    { name: "runnerId", type: "string" },
    { name: "delegateSigningAddress", type: "address" },
    { name: "delegateEncryptionPublicKey", type: "bytes32" },
    { name: "scopesCommitment", type: "bytes32" },
    { name: "issuedAt", type: "string" },
    { name: "expiresAt", type: "string" },
  ],
} as const;

export interface RunnerDelegationMessage {
  delegationId: string;
  careerDid: string;
  runnerId: string;
  delegateSigningAddress: Address;
  delegateEncryptionPublicKey: Hex;
  scopesCommitment: Hex;
  issuedAt: string;
  expiresAt: string;
}

export function runnerDelegationMessage(
  delegation: Omit<RunnerDelegation, "careerSignature" | "revokedAt">,
  scopesCommitment: Hex,
): RunnerDelegationMessage {
  return {
    delegationId: delegation.delegationId,
    careerDid: delegation.careerDid,
    runnerId: delegation.runnerId,
    delegateSigningAddress: getAddress(delegation.delegateSigningAddress),
    delegateEncryptionPublicKey: delegation.delegateEncryptionPublicKey as Hex,
    scopesCommitment,
    issuedAt: delegation.issuedAt,
    expiresAt: delegation.expiresAt,
  };
}

export async function signRunnerDelegation(
  privateKey: Hex,
  message: RunnerDelegationMessage,
): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: RUNNER_DELEGATION_DOMAIN,
    types: RunnerDelegationTypes,
    primaryType: "RunnerDelegation",
    message,
  });
}

export async function recoverRunnerDelegationSigner(
  message: RunnerDelegationMessage,
  signature: Hex,
): Promise<Address> {
  return getAddress(
    await recoverTypedDataAddress({
      domain: RUNNER_DELEGATION_DOMAIN,
      types: RunnerDelegationTypes,
      primaryType: "RunnerDelegation",
      message,
      signature,
    }),
  );
}
