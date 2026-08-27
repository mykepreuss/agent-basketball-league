import {
  personalCareerDomainId,
  verifyCareerStorageAuthorization,
} from "@abl/cognition";
import {
  ServiceAuthenticationError,
  ServiceReplayError,
  type ServiceRequestVerifier,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import { sha256Commitment } from "@abl/recognition";
import {
  CiphertextBroker,
  type CiphertextRepository,
  StorageAuthorizationError,
  StorageVersionConflictError,
} from "@abl/storage";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

const HexCommitmentSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const EncryptedBlobSchema = z.strictObject({
  format: z.literal("ABL-XCHACHA20-POLY1305-V1"),
  objectId: z.string().min(1).max(160),
  domainId: z.string().min(1).max(160),
  version: z.number().int().positive(),
  previousVersionCommitment: HexCommitmentSchema.nullable(),
  contentType: z.string().min(1).max(128),
  nonce: z.string().min(1).max(128),
  ciphertext: z.string().min(1).max(2_000_000),
  associatedData: z.string().min(1).max(4096),
  ciphertextCommitment: HexCommitmentSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
const PutRequestSchema = z.strictObject({
  callerDid: z.string().startsWith("did:"),
  blob: EncryptedBlobSchema,
  careerRequest: z.unknown().optional(),
  careerAuthorization: z.unknown().optional(),
});
const GetRequestSchema = z.strictObject({
  callerDid: z.string().startsWith("did:"),
  domainId: z.string().min(1).max(160),
  objectId: z.string().min(1).max(160),
  version: z.number().int().positive(),
  careerRequest: z.unknown().optional(),
  careerAuthorization: z.unknown().optional(),
});
const DeleteRequestSchema = z.strictObject({
  callerDid: z.string().startsWith("did:"),
  domainId: z.string().min(1).max(160),
  objectId: z.string().min(1).max(160),
  expectedVersion: z.number().int().positive(),
  deletedAt: z.iso.datetime({ offset: true }),
  careerRequest: z.unknown().optional(),
  careerAuthorization: z.unknown().optional(),
});
const VerifyCommitmentRequestSchema = z.strictObject({
  ownerDid: z.string().startsWith("did:"),
  domainId: z.string().min(1).max(160),
  objectId: z.string().min(1).max(160),
  version: z.number().int().positive(),
  ciphertextCommitment: HexCommitmentSchema,
});
const DeletionReceiptSchema = z.strictObject({
  format: z.literal("ABL-CIPHERTEXT-DELETION-V1"),
  domainId: z.string().min(1).max(160),
  objectId: z.string().min(1).max(160),
  actorDid: z.string().startsWith("did:"),
  deletedVersion: z.number().int().positive(),
  lastCiphertextCommitment: HexCommitmentSchema,
  deletedAt: z.iso.datetime({ offset: true }),
  providerResidualDeletionVerified: z.literal(false),
  deletionCommitment: HexCommitmentSchema,
});
const VerifyDeletionRequestSchema = z.strictObject({
  ownerDid: z.string().startsWith("did:"),
  receipt: DeletionReceiptSchema,
});

export interface PrivateStorageBrokerOptions {
  broker: CiphertextBroker;
  repository: CiphertextRepository;
  verifier: ServiceRequestVerifier;
  serviceActorBindings: ReadonlyMap<string, string>;
}

function signedHeaders(request: FastifyRequest): SignedServiceRequestHeaders {
  function value(name: keyof SignedServiceRequestHeaders): string {
    const header = request.headers[name];
    if (typeof header !== "string" || header === "")
      throw new ServiceAuthenticationError(`Missing ${name}`);
    return header;
  }
  return {
    "x-abl-service-id": value("x-abl-service-id"),
    "x-abl-capability": value("x-abl-capability"),
    "x-abl-nonce": value("x-abl-nonce"),
    "x-abl-timestamp": value("x-abl-timestamp"),
    "x-abl-expected-version": value("x-abl-expected-version"),
    "x-abl-content-sha256": value("x-abl-content-sha256"),
    "x-abl-signature": value("x-abl-signature"),
  };
}

function bytes(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

export function createPrivateStorageBroker(
  options: PrivateStorageBrokerOptions,
): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 2_100_000,
    requestTimeout: 15_000,
  });
  const writeTails = new Map<string, Promise<void>>();
  const careerAuthorizationNonces = new Set<string>();

  async function serializeWrite<T>(key: string, write: () => Promise<T>) {
    const prior = writeTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => current);
    writeTails.set(key, tail);
    await prior;
    try {
      return await write();
    } finally {
      release();
      if (writeTails.get(key) === tail) writeTails.delete(key);
    }
  }

  function authenticate(
    request: FastifyRequest,
    capability: string,
  ): SignedServiceRequestHeaders {
    const headers = signedHeaders(request);
    if (headers["x-abl-capability"] !== capability)
      throw new ServiceAuthenticationError("Wrong capability");
    options.verifier.verify(headers, {
      method: request.method,
      path: request.url,
      body: bytes(request.body),
    });
    return headers;
  }

  async function authorizeActor(input: {
    headers: SignedServiceRequestHeaders;
    callerDid: string;
    domainId: string;
    operation: "GET" | "PUT" | "DELETE";
    careerRequest: unknown;
    careerAuthorization: unknown;
  }): Promise<void> {
    if (
      options.serviceActorBindings.get(input.headers["x-abl-service-id"]) ===
      input.callerDid
    )
      return;
    if (
      input.careerRequest === undefined ||
      input.careerAuthorization === undefined
    )
      throw new StorageAuthorizationError(
        "Unbound storage service requires career-root authorization",
      );
    const authorization = await verifyCareerStorageAuthorization({
      authorization: input.careerAuthorization,
      operation: input.operation,
      request: input.careerRequest,
    });
    if (
      authorization.identity.candidateDid !== input.callerDid ||
      input.domainId !== personalCareerDomainId(input.callerDid)
    )
      throw new StorageAuthorizationError(
        "Career storage authorization is bound to another actor or domain",
      );
    const nonceKey = `${input.callerDid}:${authorization.nonce}`;
    if (careerAuthorizationNonces.has(nonceKey))
      throw new StorageAuthorizationError(
        "Career storage authorization nonce was already used",
      );
    careerAuthorizationNonces.add(nonceKey);
    await serializeWrite(`policy:${input.domainId}`, async () => {
      if (options.broker.domainPolicy(input.domainId) !== undefined) return;
      const policy = {
        domainId: input.domainId,
        kind: "PERSONAL" as const,
        version: 1,
        members: {
          [input.callerDid]: ["READ", "WRITE", "ADMIN"] as const,
        },
        guardianEnvelopeCommitments: [],
        manifestCommitment: sha256Commitment({
          protocol: "ABL-CAREER-PERSONAL-DOMAIN-V2",
          domainId: input.domainId,
          ownerDid: input.callerDid,
        }),
      };
      await options.repository.putPolicy(policy);
      options.broker.registerDomain(input.callerDid, policy);
    });
  }

  function assertExpectedVersion(
    headers: SignedServiceRequestHeaders,
    expectedVersion: number,
    message: string,
  ): void {
    if (headers["x-abl-expected-version"] !== String(expectedVersion))
      throw new StorageVersionConflictError(message);
  }

  async function eraseCiphertext(
    domainId: string,
    objectId: string,
  ): Promise<boolean> {
    return options.repository
      .eraseCiphertext(domainId, objectId)
      .then(() => true)
      .catch(() => false);
  }

  function errorResponse(error: unknown): { status: number; code: string } {
    if (error instanceof z.ZodError)
      return { status: 400, code: "invalid_request" };
    if (error instanceof ServiceReplayError)
      return { status: 409, code: "service_replay" };
    if (
      error instanceof ServiceAuthenticationError ||
      error instanceof StorageAuthorizationError
    ) {
      return { status: 403, code: "authorization_denied" };
    }
    if (error instanceof StorageVersionConflictError)
      return { status: 409, code: "version_conflict" };
    return { status: 500, code: "storage_failure" };
  }

  app.get("/health", async () => ({
    status: "ok",
    contentMode: "ciphertext-only",
  }));

  app.post("/v1/ciphertext", async (request, reply) => {
    try {
      const headers = authenticate(request, "private:ciphertext");
      const input = PutRequestSchema.parse(request.body);
      await authorizeActor({
        headers,
        callerDid: input.callerDid,
        domainId: input.blob.domainId,
        operation: "PUT",
        careerRequest: input.careerRequest,
        careerAuthorization: input.careerAuthorization,
      });
      assertExpectedVersion(
        headers,
        input.blob.version - 1,
        "Signed expected version does not precede ciphertext version",
      );
      return await serializeWrite(
        `${input.blob.domainId}:${input.blob.objectId}`,
        async () => {
          const rollback = options.broker.put(input.callerDid, input.blob);
          try {
            await options.repository.putCiphertext(input.blob);
          } catch (error) {
            rollback();
            throw error;
          }
          return reply.code(201).send({
            stored: true,
            commitment: input.blob.ciphertextCommitment,
            version: input.blob.version,
          });
        },
      );
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/ciphertext/get", async (request, reply) => {
    try {
      const headers = authenticate(request, "private:ciphertext");
      const input = GetRequestSchema.parse(request.body);
      await authorizeActor({
        headers,
        callerDid: input.callerDid,
        domainId: input.domainId,
        operation: "GET",
        careerRequest: input.careerRequest,
        careerAuthorization: input.careerAuthorization,
      });
      const authorized = options.broker.get(
        input.callerDid,
        input.domainId,
        input.objectId,
        input.version,
      );
      const stored = await options.repository.getCiphertext(
        input.domainId,
        input.objectId,
        input.version,
      );
      if (stored.ciphertextCommitment !== authorized.ciphertextCommitment)
        throw new Error("Repository commitment mismatch");
      return reply.send(stored);
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/ciphertext/delete", async (request, reply) => {
    try {
      const headers = authenticate(request, "private:ciphertext");
      const input = DeleteRequestSchema.parse(request.body);
      await authorizeActor({
        headers,
        callerDid: input.callerDid,
        domainId: input.domainId,
        operation: "DELETE",
        careerRequest: input.careerRequest,
        careerAuthorization: input.careerAuthorization,
      });
      assertExpectedVersion(
        headers,
        input.expectedVersion,
        "Signed expected version does not match deletion request",
      );
      return await serializeWrite(
        `${input.domainId}:${input.objectId}`,
        async () => {
          const existing = options.broker.deletionReceipt(
            input.callerDid,
            input.domainId,
            input.objectId,
          );
          if (existing !== undefined) {
            if (
              existing.deletedVersion !== input.expectedVersion ||
              existing.deletedAt !== input.deletedAt
            ) {
              throw new StorageVersionConflictError(
                "Ciphertext deletion conflicts with the durable tombstone",
              );
            }
            const physicalCiphertextRemoved = await eraseCiphertext(
              input.domainId,
              input.objectId,
            );
            return reply.code(200).send({
              deleted: true,
              duplicate: true,
              physicalCiphertextRemoved,
              physicalRemovalStatus: physicalCiphertextRemoved
                ? "REMOVED_OR_ABSENT"
                : "RETRY_FAILED",
              receipt: existing,
            });
          }
          const receipt = options.broker.prepareDeletion(
            input.callerDid,
            input.domainId,
            input.objectId,
            input.deletedAt,
          );
          if (receipt.deletedVersion !== input.expectedVersion)
            throw new StorageVersionConflictError(
              "Ciphertext deletion version does not match the live object",
            );
          try {
            await options.repository.putDeletion(receipt);
          } catch (error) {
            const recovered = await options.repository
              .getDeletion(input.domainId, input.objectId)
              .catch(() => undefined);
            if (recovered?.deletionCommitment !== receipt.deletionCommitment) {
              throw error;
            }
          }
          options.broker.applyDeletion(receipt);
          const physicalCiphertextRemoved = await eraseCiphertext(
            input.domainId,
            input.objectId,
          );
          return reply.code(201).send({
            deleted: true,
            duplicate: false,
            physicalCiphertextRemoved,
            receipt,
          });
        },
      );
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/commitments/verify", async (request, reply) => {
    try {
      const headers = authenticate(request, "private:commitment:verify");
      const input = VerifyCommitmentRequestSchema.parse(request.body);
      assertExpectedVersion(
        headers,
        input.version,
        "Signed expected version does not match commitment proof",
      );
      options.broker.verifyObjectCommitment(input);
      return reply.send({ verified: true });
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/deletions/verify", async (request, reply) => {
    try {
      const headers = authenticate(request, "private:commitment:verify");
      const input = VerifyDeletionRequestSchema.parse(request.body);
      assertExpectedVersion(
        headers,
        input.receipt.deletedVersion,
        "Signed expected version does not match deletion proof",
      );
      options.broker.verifyDeletionReceipt(input.ownerDid, input.receipt);
      return reply.send({ verified: true });
    } catch (error) {
      const response = errorResponse(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  return app;
}
