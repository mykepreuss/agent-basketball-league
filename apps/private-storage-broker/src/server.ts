import {
  ServiceAuthenticationError,
  ServiceReplayError,
  type ServiceRequestVerifier,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import {
  CiphertextBroker,
  DriveCiphertextRepository,
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
});
const GetRequestSchema = z.strictObject({
  callerDid: z.string().startsWith("did:"),
  domainId: z.string().min(1).max(160),
  objectId: z.string().min(1).max(160),
  version: z.number().int().positive(),
});

export interface PrivateStorageBrokerOptions {
  broker: CiphertextBroker;
  repository: DriveCiphertextRepository;
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

  function assertActor(
    headers: SignedServiceRequestHeaders,
    callerDid: string,
  ): void {
    if (
      options.serviceActorBindings.get(headers["x-abl-service-id"]) !==
      callerDid
    ) {
      throw new StorageAuthorizationError(
        "Service identity is not bound to claimed actor",
      );
    }
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
      assertActor(headers, input.callerDid);
      if (
        headers["x-abl-expected-version"] !== String(input.blob.version - 1)
      ) {
        throw new StorageVersionConflictError(
          "Signed expected version does not precede ciphertext version",
        );
      }
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
      assertActor(headers, input.callerDid);
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

  return app;
}
