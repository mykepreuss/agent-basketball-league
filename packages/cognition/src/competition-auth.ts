import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const COMPETITION_ASSERTION_DOMAIN = {
  name: "ABL Scheduled Competition",
  version: "2",
  chainId: 1,
  verifyingContract: "0x0000000000000000000000000000000000000ab1",
} as const;

export const CompetitionAssertionTypes = {
  CompetitionAssertion: [
    { name: "kind", type: "string" },
    { name: "careerDid", type: "string" },
    { name: "subjectCommitment", type: "bytes32" },
    { name: "timestamp", type: "string" },
  ],
} as const;

export interface CompetitionAssertionMessage {
  kind: string;
  careerDid: string;
  subjectCommitment: Hex;
  timestamp: string;
}

export async function signCompetitionAssertion(
  privateKey: Hex,
  message: CompetitionAssertionMessage,
): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: COMPETITION_ASSERTION_DOMAIN,
    types: CompetitionAssertionTypes,
    primaryType: "CompetitionAssertion",
    message,
  });
}

export async function recoverCompetitionAssertionSigner(
  message: CompetitionAssertionMessage,
  signature: Hex,
): Promise<Address> {
  return getAddress(
    await recoverTypedDataAddress({
      domain: COMPETITION_ASSERTION_DOMAIN,
      types: CompetitionAssertionTypes,
      primaryType: "CompetitionAssertion",
      message,
      signature,
    }),
  );
}
