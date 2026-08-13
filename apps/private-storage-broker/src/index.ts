import { readFile } from "node:fs/promises";

import {
  ServiceRequestVerifier,
  type ServiceRequestIdentity,
} from "@abl/foundation";
import {
  CiphertextBroker,
  DriveCiphertextRepository,
  type StorageDomainPolicy,
} from "@abl/storage";
import { z } from "zod";

import { createPrivateStorageBroker } from "./server.js";

const BootstrapSchema = z.strictObject({
  identities: z.array(
    z.strictObject({
      serviceId: z.string().min(1),
      actorDid: z.string().startsWith("did:"),
      secretBase64: z.string().min(1),
      capabilities: z.array(z.literal("private:ciphertext")).min(1),
    }),
  ),
  policies: z.array(z.custom<StorageDomainPolicy>()),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const bootstrap = BootstrapSchema.parse(
  JSON.parse(await readFile(required("ABL_STORAGE_BOOTSTRAP_FILE"), "utf8")),
);
const broker = new CiphertextBroker();
const repository = new DriveCiphertextRepository(required("ABL_DRIVE_MOUNT"));
await repository.initialize();
for (const policy of bootstrap.policies) {
  const admin = Object.entries(policy.members).find(([, grants]) =>
    grants.includes("ADMIN"),
  );
  if (admin === undefined)
    throw new Error(`Storage policy ${policy.domainId} has no administrator`);
  broker.registerDomain(admin[0], policy);
  await repository.putPolicy(policy);
}
const identities: ServiceRequestIdentity[] = bootstrap.identities.map(
  (identity) => ({
    serviceId: identity.serviceId,
    secret: new Uint8Array(Buffer.from(identity.secretBase64, "base64")),
    capabilities: new Set(identity.capabilities),
  }),
);
const app = createPrivateStorageBroker({
  broker,
  repository,
  verifier: new ServiceRequestVerifier(identities),
  serviceActorBindings: new Map(
    bootstrap.identities.map((identity) => [
      identity.serviceId,
      identity.actorDid,
    ]),
  ),
});
await app.listen({ host: "0.0.0.0", port: 8080 });
