import { generateEncryptionKeyPair } from "@abl/storage";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  publicKeyToAddress,
} from "viem/accounts";

export interface SigningIdentity {
  privateKey: Hex;
  publicKey: Hex;
  address: Address;
}

export interface AgentKeyBundle {
  signing: SigningIdentity;
  encryption: { secretKey: Uint8Array; publicKey: Uint8Array };
}

export function createSigningIdentity(
  privateKey: Hex = generatePrivateKey(),
): SigningIdentity {
  const account = privateKeyToAccount(privateKey);
  const compressed = secp256k1.getPublicKey(
    hexToBytes(privateKey.slice(2)),
    true,
  );
  return {
    privateKey,
    publicKey: `0x${bytesToHex(compressed)}`,
    address: getAddress(account.address),
  };
}

export function signingPublicKeyToAddress(publicKey: Hex): Address {
  const uncompressed = secp256k1.Point.fromHex(publicKey.slice(2)).toBytes(
    false,
  );
  return getAddress(publicKeyToAddress(`0x${bytesToHex(uncompressed)}`));
}

export function createAgentKeyBundle(): AgentKeyBundle {
  const signing = createSigningIdentity();
  const encryption = generateEncryptionKeyPair();
  if (signing.publicKey.slice(4) === bytesToHex(encryption.publicKey))
    throw new Error("Signing and encryption keys collided");
  return { signing, encryption };
}

export const EventAuthorizationTypes = {
  CanonicalEvent: [
    { name: "eventId", type: "string" },
    { name: "actorDid", type: "string" },
    { name: "aggregateType", type: "string" },
    { name: "aggregateId", type: "string" },
    { name: "aggregateVersion", type: "uint256" },
    { name: "eventType", type: "string" },
    { name: "eventHash", type: "bytes32" },
    { name: "payloadCommitment", type: "bytes32" },
    { name: "nonce", type: "string" },
    { name: "timestamp", type: "string" },
  ],
} as const;

export interface EventAuthorizationMessage {
  eventId: string;
  actorDid: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  eventHash: Hex;
  payloadCommitment: Hex;
  nonce: string;
  timestamp: string;
}

export async function signEventAuthorization(
  identity: SigningIdentity,
  domain: TypedDataDomain,
  message: EventAuthorizationMessage,
): Promise<Hex> {
  return privateKeyToAccount(identity.privateKey).signTypedData({
    domain,
    types: EventAuthorizationTypes,
    primaryType: "CanonicalEvent",
    message,
  });
}

export async function recoverEventSigner(
  domain: TypedDataDomain,
  message: EventAuthorizationMessage,
  signature: Hex,
): Promise<Address> {
  return getAddress(
    await recoverTypedDataAddress({
      domain,
      types: EventAuthorizationTypes,
      primaryType: "CanonicalEvent",
      message,
      signature,
    }),
  );
}
