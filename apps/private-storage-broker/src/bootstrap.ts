import { readFile } from "node:fs/promises";

import type { StorageDomainPolicy } from "@abl/storage";
import { z } from "zod";

const Sha256Schema = z.string().regex(/^0x[0-9a-f]{64}$/);
const StorageAccessSchema = z.enum(["READ", "WRITE", "ADMIN"]);
const StorageDomainPolicySchema: z.ZodType<StorageDomainPolicy> = z
  .strictObject({
    domainId: z.string().min(1).max(160),
    kind: z.enum(["PERSONAL", "CLUB", "UNION", "TRIBUNAL", "CASE"]),
    version: z.number().int().positive(),
    members: z
      .record(
        z.string().startsWith("did:").max(500),
        z
          .array(StorageAccessSchema)
          .min(1)
          .max(StorageAccessSchema.options.length)
          .refine((grants) => new Set(grants).size === grants.length),
      )
      .refine((members) => Object.keys(members).length > 0),
    guardianEnvelopeCommitments: z
      .array(Sha256Schema)
      .max(32)
      .refine((values) => new Set(values).size === values.length),
    manifestCommitment: Sha256Schema,
  })
  .refine(
    (policy) =>
      Object.values(policy.members).some((grants) => grants.includes("ADMIN")),
    "Storage policy requires an administrator",
  );

const CanonicalSecretSchema = z.string().refine((value) => {
  const bytes = Buffer.from(value, "base64");
  return bytes.length >= 32 && bytes.toString("base64") === value;
}, "Service secret must be canonical Base64 containing at least 256 bits");

const BootstrapSchema = z
  .strictObject({
    identities: z.array(
      z.strictObject({
        serviceId: z.string().min(1).max(160),
        actorDid: z.string().startsWith("did:").max(500),
        secretBase64: CanonicalSecretSchema,
        capabilities: z
          .array(z.enum(["private:ciphertext", "private:commitment:verify"]))
          .min(1)
          .refine((values) => new Set(values).size === values.length),
      }),
    ),
    policies: z.array(StorageDomainPolicySchema),
  })
  .refine(
    ({ identities }) =>
      new Set(identities.map(({ serviceId }) => serviceId)).size ===
      identities.length,
    "Storage service identities must be unique",
  );

export async function loadStorageBootstrap(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const inline = environment.ABL_STORAGE_BOOTSTRAP_JSON;
  const path = environment.ABL_STORAGE_BOOTSTRAP_FILE;
  if ((inline === undefined) === (path === undefined))
    throw new Error("Exactly one storage bootstrap source must be configured");
  return BootstrapSchema.parse(
    JSON.parse(inline ?? (await readFile(path!, "utf8"))),
  );
}
