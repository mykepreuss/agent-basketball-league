import {
  sha256Commitment,
  signingPublicKeyToAddress,
  type SigningIdentity,
} from "@abl/recognition";
import { SafetyActionSchema, Secp256k1PublicKeySchema } from "@abl/schemas";
import {
  getAddress,
  recoverTypedDataAddress,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

export const SAFETY_DOMAIN_NAME = "ABL Safety Boundary";
export const SAFETY_DOMAIN_VERSION = "1";
export const SAFETY_ACTION_MAXIMUM_DURATION_MS = 24 * 60 * 60 * 1_000;
export const SAFETY_ACTION_CLOCK_SKEW_MS = 60 * 1_000;
const SAFETY_DOMAIN_FIELDS = new Set([
  "chainId",
  "name",
  "verifyingContract",
  "version",
]);

export const SafetyActionAuthorizationTypes = {
  SafetyAction: [
    { name: "actionId", type: "string" },
    { name: "category", type: "string" },
    { name: "targetResourceId", type: "string" },
    { name: "reasonCode", type: "string" },
    { name: "issuedAt", type: "string" },
    { name: "expiresAt", type: "string" },
    { name: "humanCustodianPublicKey", type: "bytes" },
  ],
} as const;

export type SafetyAction = z.infer<typeof SafetyActionSchema>;
export type UnsignedSafetyAction = Omit<SafetyAction, "signature" | "freeText">;

export interface SafetyAuthorizationPolicy {
  domain: TypedDataDomain;
  custodianPublicKeys: ReadonlySet<string>;
  maximumDurationMs?: number;
  maximumClockSkewMs?: number;
}

export class SafetyActionAuthorizationError extends Error {
  public override readonly name = "SafetyActionAuthorizationError";
}

export class SafetyActionValidationError extends Error {
  public override readonly name = "SafetyActionValidationError";
}

function assertDomain(domain: TypedDataDomain): void {
  const keys = Object.keys(domain);
  if (
    keys.length !== 4 ||
    keys.some((key) => !SAFETY_DOMAIN_FIELDS.has(key)) ||
    domain.name !== SAFETY_DOMAIN_NAME ||
    domain.version !== SAFETY_DOMAIN_VERSION ||
    typeof domain.chainId !== "number" ||
    !Number.isSafeInteger(domain.chainId) ||
    domain.chainId <= 0 ||
    typeof domain.verifyingContract !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(domain.verifyingContract) ||
    /^0x0{40}$/i.test(domain.verifyingContract)
  ) {
    throw new SafetyActionValidationError(
      "Safety authorization domain is not purpose-bound",
    );
  }
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new SafetyActionValidationError(
      "Safety action timestamp is not canonical UTC",
    );
  return parsed;
}

function authorizationMessage(action: UnsignedSafetyAction) {
  return {
    actionId: action.actionId,
    category: action.category,
    targetResourceId: action.targetResourceId,
    reasonCode: action.reasonCode,
    issuedAt: action.issuedAt,
    expiresAt: action.expiresAt,
    humanCustodianPublicKey: action.humanCustodianPublicKey as Hex,
  };
}

function unsignedAction(action: SafetyAction): UnsignedSafetyAction {
  return {
    actionId: action.actionId,
    category: action.category,
    targetResourceId: action.targetResourceId,
    reasonCode: action.reasonCode,
    issuedAt: action.issuedAt,
    expiresAt: action.expiresAt,
    humanCustodianPublicKey: action.humanCustodianPublicKey,
  };
}

function normalizedRegistry(policy: SafetyAuthorizationPolicy): string[] {
  const values = [...policy.custodianPublicKeys].map((key) => {
    const parsed = Secp256k1PublicKeySchema.safeParse(key);
    if (!parsed.success)
      throw new SafetyActionValidationError(
        "Safety custodian registry contains an invalid public key",
      );
    return parsed.data.toLowerCase();
  });
  if (values.length === 0 || new Set(values).size !== values.length)
    throw new SafetyActionValidationError(
      "Safety custodian registry must be nonempty and unique",
    );
  return values.sort();
}

export function safetyCustodianRegistryDigest(
  policy: SafetyAuthorizationPolicy,
): Hex {
  assertDomain(policy.domain);
  return sha256Commitment({
    format: "ABL-SAFETY-CUSTODIAN-REGISTRY-V1",
    domain: policy.domain,
    custodianPublicKeys: normalizedRegistry(policy),
  });
}

export async function signSafetyAction(
  identity: SigningIdentity,
  domain: TypedDataDomain,
  action: Omit<UnsignedSafetyAction, "humanCustodianPublicKey"> & {
    humanCustodianPublicKey?: Hex;
  },
): Promise<SafetyAction> {
  assertDomain(domain);
  const humanCustodianPublicKey =
    action.humanCustodianPublicKey ?? identity.publicKey;
  if (
    humanCustodianPublicKey.toLowerCase() !== identity.publicKey.toLowerCase()
  )
    throw new SafetyActionAuthorizationError(
      "Safety signing key does not match the declared custodian key",
    );
  const unsigned = {
    ...action,
    humanCustodianPublicKey,
  } satisfies UnsignedSafetyAction;
  const signature = await privateKeyToAccount(
    identity.privateKey,
  ).signTypedData({
    domain,
    types: SafetyActionAuthorizationTypes,
    primaryType: "SafetyAction",
    message: authorizationMessage(unsigned),
  });
  return SafetyActionSchema.parse({ ...unsigned, signature });
}

export async function verifySafetyAction(
  value: unknown,
  policy: SafetyAuthorizationPolicy,
  now: number,
): Promise<SafetyAction> {
  assertDomain(policy.domain);
  if (!Number.isSafeInteger(now) || now < 0)
    throw new SafetyActionValidationError(
      "Safety verification time is invalid",
    );
  const action = SafetyActionSchema.parse(value);
  const issuedAt = canonicalInstant(action.issuedAt);
  const expiresAt = canonicalInstant(action.expiresAt);
  const maximumDurationMs =
    policy.maximumDurationMs ?? SAFETY_ACTION_MAXIMUM_DURATION_MS;
  const maximumClockSkewMs =
    policy.maximumClockSkewMs ?? SAFETY_ACTION_CLOCK_SKEW_MS;
  if (
    !Number.isSafeInteger(maximumDurationMs) ||
    maximumDurationMs <= 0 ||
    maximumDurationMs > SAFETY_ACTION_MAXIMUM_DURATION_MS ||
    !Number.isSafeInteger(maximumClockSkewMs) ||
    maximumClockSkewMs < 0 ||
    issuedAt >= expiresAt ||
    expiresAt - issuedAt > maximumDurationMs ||
    issuedAt > now + maximumClockSkewMs ||
    expiresAt <= now
  ) {
    throw new SafetyActionValidationError(
      "Safety action time window is invalid or expired",
    );
  }
  const registry = normalizedRegistry(policy);
  if (!registry.includes(action.humanCustodianPublicKey.toLowerCase()))
    throw new SafetyActionAuthorizationError(
      "Safety custodian key is not configured",
    );

  let recovered: string;
  let declared: string;
  try {
    recovered = getAddress(
      await recoverTypedDataAddress({
        domain: policy.domain,
        types: SafetyActionAuthorizationTypes,
        primaryType: "SafetyAction",
        message: authorizationMessage(unsignedAction(action)),
        signature: action.signature as Hex,
      }),
    );
    declared = signingPublicKeyToAddress(action.humanCustodianPublicKey as Hex);
  } catch {
    throw new SafetyActionAuthorizationError(
      "Safety action signature or public key is invalid",
    );
  }
  if (recovered.toLowerCase() !== declared.toLowerCase())
    throw new SafetyActionAuthorizationError(
      "Safety action signature is not from the declared custodian",
    );
  return structuredClone(action);
}
