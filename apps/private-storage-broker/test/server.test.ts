import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ServiceRequestVerifier,
  signServiceRequest,
  type ServiceRequestIdentity,
} from "@abl/foundation";
import {
  CiphertextBroker,
  DriveCiphertextRepository,
  encryptContent,
  generateDomainKey,
  type StorageDomainPolicy,
} from "@abl/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createPrivateStorageBroker } from "../src/server.js";

const now = Date.parse("2026-08-13T08:30:00.000Z");
const identity: ServiceRequestIdentity = {
  serviceId: "body-agent-a",
  secret: new TextEncoder().encode("private-broker-transport-secret-0001"),
  capabilities: new Set(["private:ciphertext"]),
};
const policy: StorageDomainPolicy = {
  domainId: "personal:agent-a",
  kind: "PERSONAL",
  version: 1,
  members: { "did:abl:agent-a": ["READ", "WRITE", "ADMIN"] },
  guardianEnvelopeCommitments: [],
  manifestCommitment: `0x${"a".repeat(64)}`,
};
const apps: Array<ReturnType<typeof createPrivateStorageBroker>> = [];
afterEach(async () =>
  Promise.all(apps.splice(0).map(async (app) => app.close())),
);

class FailOnceRepository extends DriveCiphertextRepository {
  #shouldFail = true;

  public override async putCiphertext(
    blob: Parameters<DriveCiphertextRepository["putCiphertext"]>[0],
  ): Promise<void> {
    if (this.#shouldFail) {
      this.#shouldFail = false;
      throw new Error("simulated durable write failure");
    }
    await super.putCiphertext(blob);
  }
}

async function fixture(
  binding = "did:abl:agent-a",
  repositoryFactory: (root: string) => DriveCiphertextRepository = (root) =>
    new DriveCiphertextRepository(root),
) {
  const root = await mkdtemp(join(tmpdir(), "abl-private-broker-"));
  const repository = repositoryFactory(root);
  await repository.initialize();
  const broker = new CiphertextBroker();
  broker.registerDomain("did:abl:agent-a", policy);
  const app = createPrivateStorageBroker({
    broker,
    repository,
    verifier: new ServiceRequestVerifier([identity], { now: () => now }),
    serviceActorBindings: new Map([[identity.serviceId, binding]]),
  });
  apps.push(app);
  return { app, repository };
}

function signed(
  body: unknown,
  nonce: string,
  expectedVersion: string,
): Record<string, string> {
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    ...signServiceRequest(identity, {
      method: "POST",
      path: "/v1/ciphertext",
      body: bodyBytes,
      nonce,
      timestamp: new Date(now).toISOString(),
      expectedVersion,
      capability: "private:ciphertext",
    }),
  };
}

describe("private ciphertext broker service", () => {
  it("accepts bound, signed ciphertext and persists exactly its commitment", async () => {
    const { app, repository } = await fixture();
    const key = await generateDomainKey();
    const blob = await encryptContent({
      key,
      objectId: "memory-1",
      domainId: policy.domainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext: new TextEncoder().encode(
        "encrypted before crossing workspaces",
      ),
      createdAt: "2026-08-13T08:30:00.000Z",
    });
    const body = { callerDid: "did:abl:agent-a", blob };
    const response = await app.inject({
      method: "POST",
      url: "/v1/ciphertext",
      headers: signed(body, "service-nonce-storage-0001", "0"),
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    await expect(
      repository.getCiphertext(policy.domainId, blob.objectId, 1),
    ).resolves.toEqual(blob);
  });

  it("rejects actor spoofing, signature replay, and mismatched expected versions", async () => {
    const { app } = await fixture("did:abl:agent-b");
    const key = await generateDomainKey();
    const blob = await encryptContent({
      key,
      objectId: "memory-2",
      domainId: policy.domainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext: new TextEncoder().encode("opaque"),
      createdAt: "2026-08-13T08:30:00.000Z",
    });
    const body = { callerDid: "did:abl:agent-a", blob };
    const headers = signed(body, "service-nonce-storage-0002", "0");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/ciphertext",
          headers,
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/ciphertext",
          headers,
          payload: body,
        })
      ).statusCode,
    ).toBe(409);

    const second = await fixture();
    const wrongVersionHeaders = signed(body, "service-nonce-storage-0003", "9");
    expect(
      (
        await second.app.inject({
          method: "POST",
          url: "/v1/ciphertext",
          headers: wrongVersionHeaders,
          payload: body,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("rolls back metadata when durable persistence fails so the write can retry", async () => {
    const { app, repository } = await fixture(
      "did:abl:agent-a",
      (root) => new FailOnceRepository(root),
    );
    const blob = await encryptContent({
      key: await generateDomainKey(),
      objectId: "memory-retry",
      domainId: policy.domainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext: new TextEncoder().encode("opaque retry payload"),
      createdAt: "2026-08-13T08:30:00.000Z",
    });
    const body = { callerDid: "did:abl:agent-a", blob };
    const failed = await app.inject({
      method: "POST",
      url: "/v1/ciphertext",
      headers: signed(body, "service-nonce-storage-0004", "0"),
      payload: body,
    });
    expect(failed.statusCode).toBe(500);

    const retried = await app.inject({
      method: "POST",
      url: "/v1/ciphertext",
      headers: signed(body, "service-nonce-storage-0005", "0"),
      payload: body,
    });
    expect(retried.statusCode).toBe(201);
    await expect(
      repository.getCiphertext(policy.domainId, blob.objectId, blob.version),
    ).resolves.toEqual(blob);
  });
});
