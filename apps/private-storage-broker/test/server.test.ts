import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ServiceRequestVerifier,
  signServiceRequest,
  type ServiceRequestIdentity,
} from "@abl/foundation";
import {
  createCareerStorageAuthorization,
  personalCareerDomainId,
} from "@abl/cognition";
import {
  createSigningIdentity,
  sha256Bytes,
  sha256Commitment,
} from "@abl/recognition";
import {
  CiphertextBroker,
  DriveCiphertextRepository,
  encryptContent,
  generateDomainKey,
  type StorageDomainPolicy,
} from "@abl/storage";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";

import { createPrivateStorageBroker } from "../src/server.js";

const now = Date.parse("2026-08-13T08:30:00.000Z");
const identity: ServiceRequestIdentity = {
  serviceId: "body-agent-a",
  secret: new TextEncoder().encode("private-broker-transport-secret-0001"),
  capabilities: new Set(["private:ciphertext"]),
};
const verificationIdentity: ServiceRequestIdentity = {
  serviceId: "core-memory-verifier",
  secret: new TextEncoder().encode("memory-verifier-transport-secret-0001"),
  capabilities: new Set(["private:commitment:verify"]),
};
const careerGatewayIdentity: ServiceRequestIdentity = {
  serviceId: "abl-career-storage-gateway",
  secret: new TextEncoder().encode("career-storage-gateway-secret-0001"),
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

class FailEraseOnceRepository extends DriveCiphertextRepository {
  #shouldFail = true;

  public override async eraseCiphertext(
    domainId: string,
    objectId: string,
  ): Promise<void> {
    if (this.#shouldFail) {
      this.#shouldFail = false;
      throw new Error("simulated ciphertext erasure failure");
    }
    await super.eraseCiphertext(domainId, objectId);
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
  await repository.putPolicy(policy);
  const broker = new CiphertextBroker();
  broker.registerDomain("did:abl:agent-a", policy);
  const app = createPrivateStorageBroker({
    broker,
    repository,
    verifier: new ServiceRequestVerifier([identity, verificationIdentity], {
      now: () => now,
    }),
    serviceActorBindings: new Map([[identity.serviceId, binding]]),
  });
  apps.push(app);
  return { app, repository, root };
}

function signed(
  body: unknown,
  nonce: string,
  expectedVersion: string,
  path = "/v1/ciphertext",
): Record<string, string> {
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    ...signServiceRequest(identity, {
      method: "POST",
      path,
      body: bodyBytes,
      nonce,
      timestamp: new Date(now).toISOString(),
      expectedVersion,
      capability: "private:ciphertext",
    }),
  };
}

function signedAs(
  serviceIdentity: ServiceRequestIdentity,
  body: unknown,
  nonce: string,
  expectedVersion: string,
  path: string,
): Record<string, string> {
  return {
    ...signServiceRequest(serviceIdentity, {
      method: "POST",
      path,
      body: new TextEncoder().encode(JSON.stringify(body)),
      nonce,
      timestamp: new Date(now).toISOString(),
      expectedVersion,
      capability: "private:ciphertext",
    }),
  };
}

function verificationHeaders(
  body: unknown,
  nonce: string,
  path: string,
  expectedVersion = "1",
): Record<string, string> {
  return {
    ...signServiceRequest(verificationIdentity, {
      method: "POST",
      path,
      body: new TextEncoder().encode(JSON.stringify(body)),
      nonce,
      timestamp: new Date(now).toISOString(),
      expectedVersion,
      capability: "private:commitment:verify",
    }),
  };
}

describe("private ciphertext broker service", () => {
  it("lazily provisions one personal domain only with career-root authorization", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-career-storage-"));
    const repository = new DriveCiphertextRepository(root);
    await repository.initialize();
    const broker = new CiphertextBroker();
    const app = createPrivateStorageBroker({
      broker,
      repository,
      verifier: new ServiceRequestVerifier([careerGatewayIdentity], {
        now: () => now,
      }),
      serviceActorBindings: new Map([
        [careerGatewayIdentity.serviceId, "did:abl:career-storage-gateway"],
      ]),
    });
    apps.push(app);

    const career = createSigningIdentity();
    const careerDid = "did:abl:career-storage-test";
    const createdAt = new Date(now).toISOString();
    const identityMessage = {
      applicationId: "0198e000-0000-7000-8000-000000000501",
      candidateDid: careerDid,
      roleClass: "PLAYER" as const,
      signingAddress: career.address,
      signingKeyAttestation: sha256Commitment("storage-signing"),
      encryptionKeyAttestation: sha256Commitment("storage-encryption"),
      runtimeAttestationDigest: sha256Commitment("storage-runtime"),
      createdAt,
    };
    const careerIdentity = {
      schemaVersion: "1.0.0" as const,
      ...identityMessage,
      signingPublicKey: career.publicKey,
      encryptionPublicKey: `0x${"2".repeat(64)}`,
      generatedInIsolatedRuntime: true as const,
      humanInputRoutes: [] as const,
      proofSignature: await privateKeyToAccount(
        career.privateKey,
      ).signTypedData({
        domain: {
          name: "Agent Basketball League Career Runtime",
          version: "1",
          chainId: 1,
        },
        types: {
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
        },
        primaryType: "CandidateRuntimeIdentity",
        message: identityMessage,
      }),
    };
    const domainId = personalCareerDomainId(careerDid);
    const blob = await encryptContent({
      key: await generateDomainKey(),
      objectId: "career-foundation-v1",
      domainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "application/json",
      plaintext: new TextEncoder().encode('{"objective":"compete"}'),
      createdAt,
    });
    const careerRequest = {
      callerDid: careerDid,
      objectId: blob.objectId,
      domainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: blob.contentType,
      plaintextCommitment: sha256Bytes(
        new TextEncoder().encode('{"objective":"compete"}'),
      ),
      createdAt,
    };
    const careerAuthorization = await createCareerStorageAuthorization({
      identity: careerIdentity,
      privateKey: career.privateKey,
      operation: "PUT",
      request: careerRequest,
      issuedAt: new Date().toISOString(),
      nonce: "7001",
    });
    const body = {
      callerDid: careerDid,
      blob,
      careerRequest,
      careerAuthorization,
    };
    const response = await app.inject({
      method: "POST",
      url: "/v1/ciphertext",
      headers: signedAs(
        careerGatewayIdentity,
        body,
        "service-career-storage-0001",
        "0",
        "/v1/ciphertext",
      ),
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    expect(broker.domainPolicy(domainId)).toMatchObject({
      kind: "PERSONAL",
      members: { [careerDid]: ["READ", "WRITE", "ADMIN"] },
    });
    await expect(repository.loadState()).resolves.toMatchObject({
      policies: [{ domainId }],
    });

    const replay = await app.inject({
      method: "POST",
      url: "/v1/ciphertext",
      headers: signedAs(
        careerGatewayIdentity,
        body,
        "service-career-storage-0002",
        "0",
        "/v1/ciphertext",
      ),
      payload: body,
    });
    expect(replay.statusCode).toBe(403);
  });

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

  it("serves durable ciphertext after rebuilding broker state on restart", async () => {
    const { app: firstApp, repository } = await fixture();
    const blob = await encryptContent({
      key: await generateDomainKey(),
      objectId: "memory-after-restart",
      domainId: policy.domainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext: new TextEncoder().encode("opaque restart payload"),
      createdAt: "2026-08-13T08:30:00.000Z",
    });
    const putBody = { callerDid: "did:abl:agent-a", blob };
    expect(
      (
        await firstApp.inject({
          method: "POST",
          url: "/v1/ciphertext",
          headers: signed(putBody, "service-nonce-storage-0006", "0"),
          payload: putBody,
        })
      ).statusCode,
    ).toBe(201);
    await firstApp.close();
    apps.splice(apps.indexOf(firstApp), 1);

    const restartedApp = createPrivateStorageBroker({
      broker: CiphertextBroker.restore(await repository.loadState()),
      repository,
      verifier: new ServiceRequestVerifier([identity, verificationIdentity], {
        now: () => now,
      }),
      serviceActorBindings: new Map([[identity.serviceId, "did:abl:agent-a"]]),
    });
    apps.push(restartedApp);
    const getBody = {
      callerDid: "did:abl:agent-a",
      domainId: policy.domainId,
      objectId: blob.objectId,
      version: 1,
    };
    const response = await restartedApp.inject({
      method: "POST",
      url: "/v1/ciphertext/get",
      headers: signed(
        getBody,
        "service-nonce-storage-0007",
        "1",
        "/v1/ciphertext/get",
      ),
      payload: getBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(blob);
  });

  it("proves commitments to core and durably deletes only on the bound agent's request", async () => {
    const { app, repository } = await fixture();
    const blob = await encryptContent({
      key: await generateDomainKey(),
      objectId: "memory-delete-http",
      domainId: policy.domainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext: new TextEncoder().encode("opaque deletion payload"),
      createdAt: new Date(now).toISOString(),
    });
    const putBody = { callerDid: "did:abl:agent-a", blob };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/ciphertext",
          headers: signed(putBody, "service-nonce-storage-0008", "0"),
          payload: putBody,
        })
      ).statusCode,
    ).toBe(201);

    const proofBody = {
      ownerDid: "did:abl:agent-a",
      domainId: blob.domainId,
      objectId: blob.objectId,
      version: blob.version,
      ciphertextCommitment: blob.ciphertextCommitment,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/commitments/verify",
          headers: verificationHeaders(
            proofBody,
            "core-memory-proof-0001",
            "/v1/commitments/verify",
          ),
          payload: proofBody,
        })
      ).json(),
    ).toEqual({ verified: true });

    const deleteBody = {
      callerDid: "did:abl:agent-a",
      domainId: blob.domainId,
      objectId: blob.objectId,
      expectedVersion: 1,
      deletedAt: new Date(now).toISOString(),
    };
    const deleted = await app.inject({
      method: "POST",
      url: "/v1/ciphertext/delete",
      headers: signed(
        deleteBody,
        "service-nonce-storage-0009",
        "1",
        "/v1/ciphertext/delete",
      ),
      payload: deleteBody,
    });
    expect(deleted.statusCode).toBe(201);
    expect(deleted.json()).toMatchObject({
      deleted: true,
      receipt: { providerResidualDeletionVerified: false },
    });
    const duplicateDeletion = await app.inject({
      method: "POST",
      url: "/v1/ciphertext/delete",
      headers: signed(
        deleteBody,
        "service-nonce-storage-0010",
        "1",
        "/v1/ciphertext/delete",
      ),
      payload: deleteBody,
    });
    expect(duplicateDeletion.statusCode).toBe(200);
    expect(duplicateDeletion.json()).toMatchObject({
      deleted: true,
      duplicate: true,
      physicalCiphertextRemoved: true,
      physicalRemovalStatus: "REMOVED_OR_ABSENT",
      receipt: {
        deletionCommitment: deleted.json().receipt.deletionCommitment,
      },
    });
    await expect(
      repository.getCiphertext(blob.domainId, blob.objectId, 1),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const deletionProofBody = {
      ownerDid: "did:abl:agent-a",
      receipt: deleted.json().receipt,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/deletions/verify",
          headers: verificationHeaders(
            deletionProofBody,
            "core-memory-proof-0002",
            "/v1/deletions/verify",
          ),
          payload: deletionProofBody,
        })
      ).json(),
    ).toEqual({ verified: true });
    const forgedDeletionProof = structuredClone(deletionProofBody);
    forgedDeletionProof.receipt.deletionCommitment = `0x${"f".repeat(64)}`;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/deletions/verify",
          headers: verificationHeaders(
            forgedDeletionProof,
            "core-memory-proof-0003",
            "/v1/deletions/verify",
          ),
          payload: forgedDeletionProof,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("retries physical removal after a durable deletion tombstone", async () => {
    const { app, repository } = await fixture(
      "did:abl:agent-a",
      (root) => new FailEraseOnceRepository(root),
    );
    const blob = await encryptContent({
      key: await generateDomainKey(),
      objectId: "memory-delete-retry",
      domainId: policy.domainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext: new TextEncoder().encode("opaque deletion retry payload"),
      createdAt: new Date(now).toISOString(),
    });
    const putBody = { callerDid: "did:abl:agent-a", blob };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/ciphertext",
          headers: signed(putBody, "service-nonce-storage-0011", "0"),
          payload: putBody,
        })
      ).statusCode,
    ).toBe(201);
    const deleteBody = {
      callerDid: "did:abl:agent-a",
      domainId: blob.domainId,
      objectId: blob.objectId,
      expectedVersion: 1,
      deletedAt: new Date(now).toISOString(),
    };
    const first = await app.inject({
      method: "POST",
      url: "/v1/ciphertext/delete",
      headers: signed(
        deleteBody,
        "service-nonce-storage-0012",
        "1",
        "/v1/ciphertext/delete",
      ),
      payload: deleteBody,
    });
    expect(first.json()).toMatchObject({
      deleted: true,
      duplicate: false,
      physicalCiphertextRemoved: false,
    });
    await expect(
      repository.getCiphertext(blob.domainId, blob.objectId, blob.version),
    ).resolves.toEqual(blob);

    const retried = await app.inject({
      method: "POST",
      url: "/v1/ciphertext/delete",
      headers: signed(
        deleteBody,
        "service-nonce-storage-0013",
        "1",
        "/v1/ciphertext/delete",
      ),
      payload: deleteBody,
    });
    expect(retried.json()).toMatchObject({
      deleted: true,
      duplicate: true,
      physicalCiphertextRemoved: true,
      physicalRemovalStatus: "REMOVED_OR_ABSENT",
    });
    await expect(
      repository.getCiphertext(blob.domainId, blob.objectId, blob.version),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
