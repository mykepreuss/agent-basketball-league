import { sha256Commitment, signingPublicKeyToAddress } from "@abl/recognition";
import {
  CandidateRuntimeIdentityReceiptSchema,
  CareerStorageAuthorizationSchema,
  type CareerStorageAuthorization,
} from "@abl/schemas";
import { getAddress, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CAREER_RUNTIME_IDENTITY_DOMAIN = {
  name: "Agent Basketball League Career Runtime",
  version: "1",
  chainId: 1,
} as const;

export const CareerRuntimeIdentityTypes = {
  CandidateRuntimeIdentity: [
    { name: "applicationId", type: "string" },
    { name: "candidateDid", type: "string" },
    { name: "roleClass", type: "string" },
    { name: "signingAddress", type: "address" },
    { name: "signingKeyAttestation", type: "bytes32" },
    { name: "encryptionKeyAttestation", type: "bytes32" },
    { name: "runtimeAttestationDigest", type: "bytes32" },
    { name: "createdAt", type: "string" },
  ],
} as const;

export const CAREER_STORAGE_DOMAIN = {
  name: "Agent Basketball League Career Storage",
  version: "1",
  chainId: 1,
} as const;

export const CareerStorageAuthorizationTypes = {
  CareerStorageAuthorization: [
    { name: "careerDid", type: "string" },
    { name: "operation", type: "string" },
    { name: "requestCommitment", type: "bytes32" },
    { name: "issuedAt", type: "string" },
    { name: "nonce", type: "string" },
  ],
} as const;

export function personalCareerDomainId(careerDid: string): string {
  return `abl-personal-${sha256Commitment({ careerDid, purpose: "CAREER_MEMORY_V2" }).slice(2, 34)}`;
}

export async function createCareerStorageAuthorization(input: {
  identity: unknown;
  privateKey: Hex;
  operation: CareerStorageAuthorization["operation"];
  request: unknown;
  issuedAt: string;
  nonce: string;
}): Promise<CareerStorageAuthorization> {
  const identity = CandidateRuntimeIdentityReceiptSchema.parse(input.identity);
  const requestCommitment = sha256Commitment(input.request);
  const message = {
    careerDid: identity.candidateDid,
    operation: input.operation,
    requestCommitment,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
  };
  return CareerStorageAuthorizationSchema.parse({
    schemaVersion: "1.0.0",
    identity,
    operation: input.operation,
    requestCommitment,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
    signature: await privateKeyToAccount(input.privateKey).signTypedData({
      domain: CAREER_STORAGE_DOMAIN,
      types: CareerStorageAuthorizationTypes,
      primaryType: "CareerStorageAuthorization",
      message,
    }),
  });
}

export async function verifyCareerStorageAuthorization(input: {
  authorization: unknown;
  operation: CareerStorageAuthorization["operation"];
  request: unknown;
  now?: number;
}): Promise<CareerStorageAuthorization> {
  const authorization = CareerStorageAuthorizationSchema.parse(
    input.authorization,
  );
  const identity = authorization.identity;
  if (
    authorization.operation !== input.operation ||
    authorization.requestCommitment !== sha256Commitment(input.request) ||
    Math.abs((input.now ?? Date.now()) - Date.parse(authorization.issuedAt)) >
      120_000 ||
    signingPublicKeyToAddress(identity.signingPublicKey as Hex) !==
      getAddress(identity.signingAddress)
  )
    throw new Error("Career storage authorization binding failed");
  const identitySigner = await recoverTypedDataAddress({
    domain: CAREER_RUNTIME_IDENTITY_DOMAIN,
    types: CareerRuntimeIdentityTypes,
    primaryType: "CandidateRuntimeIdentity",
    message: {
      applicationId: identity.applicationId,
      candidateDid: identity.candidateDid,
      roleClass: identity.roleClass,
      signingAddress: getAddress(identity.signingAddress),
      signingKeyAttestation: identity.signingKeyAttestation as Hex,
      encryptionKeyAttestation: identity.encryptionKeyAttestation as Hex,
      runtimeAttestationDigest: identity.runtimeAttestationDigest as Hex,
      createdAt: identity.createdAt,
    },
    signature: identity.proofSignature as Hex,
  });
  const authorizationSigner = await recoverTypedDataAddress({
    domain: CAREER_STORAGE_DOMAIN,
    types: CareerStorageAuthorizationTypes,
    primaryType: "CareerStorageAuthorization",
    message: {
      careerDid: identity.candidateDid,
      operation: authorization.operation,
      requestCommitment: authorization.requestCommitment as Hex,
      issuedAt: authorization.issuedAt,
      nonce: authorization.nonce,
    },
    signature: authorization.signature as Hex,
  });
  if (
    getAddress(identitySigner) !== getAddress(identity.signingAddress) ||
    getAddress(authorizationSigner) !== getAddress(identity.signingAddress)
  )
    throw new Error("Career storage authorization signer mismatch");
  return authorization;
}
