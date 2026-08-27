import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const RunnerRequestTypes = {
  RunnerRequest: [
    { name: "runnerId", type: "string" },
    { name: "careerDid", type: "string" },
    { name: "delegationId", type: "string" },
    { name: "method", type: "string" },
    { name: "path", type: "string" },
    { name: "bodyCommitment", type: "bytes32" },
    { name: "nonce", type: "string" },
    { name: "idempotencyKey", type: "string" },
    { name: "timestamp", type: "string" },
  ],
} as const;

export const RUNNER_AUTH_DOMAIN = {
  name: "ABL Cognition Relay",
  version: "2",
  chainId: 1,
  verifyingContract: "0x0000000000000000000000000000000000000ab1",
} as const;

export interface RunnerRequestMessage {
  runnerId: string;
  careerDid: string;
  delegationId: string;
  method: string;
  path: string;
  bodyCommitment: Hex;
  nonce: string;
  idempotencyKey: string;
  timestamp: string;
}

export async function signRunnerRequest(
  privateKey: Hex,
  message: RunnerRequestMessage,
): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: RUNNER_AUTH_DOMAIN,
    types: RunnerRequestTypes,
    primaryType: "RunnerRequest",
    message,
  });
}

export async function recoverRunnerRequestSigner(
  message: RunnerRequestMessage,
  signature: Hex,
): Promise<Address> {
  return getAddress(
    await recoverTypedDataAddress({
      domain: RUNNER_AUTH_DOMAIN,
      types: RunnerRequestTypes,
      primaryType: "RunnerRequest",
      message,
      signature,
    }),
  );
}
