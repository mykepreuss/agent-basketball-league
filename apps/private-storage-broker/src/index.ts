import { isDeepStrictEqual } from "node:util";

import {
  ServiceRequestVerifier,
  type ServiceRequestIdentity,
} from "@abl/foundation";
import {
  CiphertextBroker,
  createCiphertextRepository,
  type StorageBackendProfile,
} from "@abl/storage";
import { z } from "zod";

import { loadStorageBootstrap } from "./bootstrap.js";
import { createPrivateStorageBroker } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const bootstrap = await loadStorageBootstrap(process.env);
const storageBackend = z
  .enum(["LOCAL_REHEARSAL", "BLAXEL_VOLUME_V1", "AGENT_DRIVE"])
  .parse(
    process.env.ABL_STORAGE_BACKEND ?? "LOCAL_REHEARSAL",
  ) satisfies StorageBackendProfile;
const repository = createCiphertextRepository({
  backend: storageBackend,
  root:
    process.env.ABL_STORAGE_ROOT ??
    process.env.ABL_DRIVE_MOUNT ??
    required("ABL_STORAGE_ROOT"),
  brokerOnly:
    storageBackend === "LOCAL_REHEARSAL" ||
    process.env.ABL_STORAGE_BROKER_ONLY === "1",
  region: process.env.ABL_BLAXEL_REGION ?? null,
  permissionsConfigured:
    storageBackend !== "AGENT_DRIVE" ||
    process.env.ABL_AGENT_DRIVE_PERMISSIONS_CONFIGURED === "1",
  liveProof:
    storageBackend === "LOCAL_REHEARSAL"
      ? "NOT_APPLICABLE"
      : "LIVE_PROOF_REQUIRED",
});
await repository.initialize();
const broker = CiphertextBroker.restore(await repository.loadState());
for (const policy of bootstrap.policies) {
  const durablePolicy = broker.domainPolicy(policy.domainId);
  if (durablePolicy !== undefined && isDeepStrictEqual(durablePolicy, policy))
    continue;
  if (durablePolicy !== undefined && policy.version <= durablePolicy.version) {
    throw new Error(
      `Storage policy ${policy.domainId} conflicts with durable version ${durablePolicy.version}`,
    );
  }
  const authorizingPolicy = durablePolicy ?? policy;
  const admin = Object.entries(authorizingPolicy.members).find(([, grants]) =>
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
await app.listen({ host, port });
