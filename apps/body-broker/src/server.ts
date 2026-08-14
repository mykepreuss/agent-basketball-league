import { randomUUID } from "node:crypto";

import {
  signServiceRequest,
  type ServiceRequestIdentity,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import { encryptContent } from "@abl/storage";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";

const ProxyRequestSchema = z.strictObject({
  route: z.string().min(1).max(64),
  method: z.enum(["GET", "POST"]),
  path: z.string().min(1).max(512),
  body: z.unknown().optional(),
  expectedVersion: z.string().regex(/^(0|[1-9][0-9]*)$/),
  idempotencyKey: z.string().min(16).max(128),
});

const StoragePutSchema = z.strictObject({
  objectId: z.string().min(1).max(160),
  domainId: z.string().min(1).max(160),
  version: z.number().int().positive(),
  previousVersionCommitment: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  contentType: z.string().min(1).max(128),
  plaintextBase64: z
    .string()
    .max(1_400_000)
    .refine(
      (value) => Buffer.from(value, "base64").toString("base64") === value,
      "Plaintext must use canonical Base64 encoding",
    ),
  createdAt: z.iso.datetime({ offset: true }),
  expectedVersion: z.string().regex(/^(0|[1-9][0-9]*)$/),
  idempotencyKey: z.string().min(16).max(128),
});

export interface BrokerRoute {
  name: string;
  targetOrigin: string;
  methods: ReadonlySet<"GET" | "POST">;
  pathPrefixes: readonly string[];
  capability: string;
  credential?: { header: string; value: string };
}

export interface BodyBrokerOptions {
  agentDid: string;
  serviceIdentity: ServiceRequestIdentity;
  routes: readonly BrokerRoute[];
  storageDomainKeys: ReadonlyMap<string, Uint8Array>;
  fetchImplementation?: typeof fetch;
  now?: () => number;
  createNonce?: () => string;
  allowHttpForTest?: boolean;
}

export class BrokerPolicyError extends Error {
  public override readonly name = "BrokerPolicyError";
}

function assertCanonicalPath(path: string): void {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes("#") ||
    pathname.includes("%") ||
    /(?:^|\/)\.\.(?:\/|$)/.test(pathname)
  ) {
    throw new BrokerPolicyError("Noncanonical outbound path");
  }
}

function resolveTarget(
  route: BrokerRoute,
  method: "GET" | "POST",
  path: string,
  allowHttp: boolean,
): URL {
  assertCanonicalPath(path);
  if (!route.methods.has(method))
    throw new BrokerPolicyError("Method is not allowed for route");
  const origin = new URL(route.targetOrigin);
  if (
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.username !== "" ||
    origin.password !== ""
  ) {
    throw new BrokerPolicyError("Route origin must be a bare origin");
  }
  if (
    origin.protocol !== "https:" &&
    !(allowHttp && origin.protocol === "http:")
  ) {
    throw new BrokerPolicyError("Outbound routes require HTTPS");
  }
  const target = new URL(path, origin);
  if (target.origin !== origin.origin)
    throw new BrokerPolicyError("Outbound path escaped the configured origin");
  if (
    target.pathname.includes("//") ||
    !route.pathPrefixes.some(
      (prefix) =>
        target.pathname === prefix || target.pathname.startsWith(`${prefix}/`),
    )
  ) {
    throw new BrokerPolicyError("Path is not allowed for route");
  }
  return target;
}

function headerRecord(
  headers: SignedServiceRequestHeaders,
): Record<string, string> {
  return { ...headers };
}

function sendBrokerError(reply: FastifyReply, error: unknown) {
  if (error instanceof z.ZodError)
    return reply.code(400).send({ error: "broker_policy_denied" });
  if (error instanceof BrokerPolicyError)
    return reply.code(403).send({ error: "broker_policy_denied" });
  return reply.code(502).send({ error: "upstream_failure" });
}

export function createBodyBroker(options: BodyBrokerOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_500_000,
    requestTimeout: 15_000,
  });
  const routes = new Map(options.routes.map((route) => [route.name, route]));
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const now = options.now ?? Date.now;
  const createNonce = options.createNonce ?? randomUUID;

  async function forward(input: {
    routeName: string;
    method: "GET" | "POST";
    path: string;
    body: unknown;
    expectedVersion: string;
    idempotencyKey: string;
  }): Promise<{ statusCode: number; contentType: string; body: string }> {
    const route = routes.get(input.routeName);
    if (route === undefined)
      throw new BrokerPolicyError("Unknown outbound route");
    const target = resolveTarget(
      route,
      input.method,
      input.path,
      options.allowHttpForTest ?? false,
    );
    const bodyBytes =
      input.method === "GET"
        ? new Uint8Array()
        : new TextEncoder().encode(JSON.stringify(input.body));
    const signedHeaders = signServiceRequest(options.serviceIdentity, {
      method: input.method,
      path: `${target.pathname}${target.search}`,
      body: bodyBytes,
      nonce: createNonce(),
      timestamp: new Date(now()).toISOString(),
      expectedVersion: input.expectedVersion,
      capability: route.capability,
    });
    const headers: Record<string, string> = {
      ...headerRecord(signedHeaders),
      "x-abl-idempotency-key": input.idempotencyKey,
    };
    if (input.method === "POST") headers["content-type"] = "application/json";
    if (route.credential !== undefined)
      headers[route.credential.header.toLowerCase()] = route.credential.value;
    const response = await fetchImplementation(target, {
      method: input.method,
      headers,
      body: input.method === "GET" ? null : Buffer.from(bodyBytes),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    const responseBody = await response.text();
    if (Buffer.byteLength(responseBody) > 2_000_000)
      throw new BrokerPolicyError("Upstream response exceeds limit");
    return {
      statusCode: response.status,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      body: responseBody,
    };
  }

  app.get("/health", async () => ({
    status: "ok",
    boundary: "fixed-local-broker",
  }));

  app.post("/v1/proxy", async (request, reply) => {
    try {
      const input = ProxyRequestSchema.parse(request.body);
      if (input.route === "private-storage")
        throw new BrokerPolicyError("Use the encrypted storage interface");
      const response = await forward({
        routeName: input.route,
        method: input.method,
        path: input.path,
        body: input.body ?? null,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      });
      return reply
        .code(response.statusCode)
        .header("content-type", response.contentType)
        .send(response.body);
    } catch (error) {
      return sendBrokerError(reply, error);
    }
  });

  app.post("/v1/storage/put", async (request, reply) => {
    try {
      const input = StoragePutSchema.parse(request.body);
      const key = options.storageDomainKeys.get(input.domainId);
      if (key === undefined)
        throw new BrokerPolicyError("No kernel-held key for storage domain");
      const plaintext = new Uint8Array(
        Buffer.from(input.plaintextBase64, "base64"),
      );
      const blob = await encryptContent({
        key,
        objectId: input.objectId,
        domainId: input.domainId,
        version: input.version,
        previousVersionCommitment: input.previousVersionCommitment,
        contentType: input.contentType,
        plaintext,
        createdAt: input.createdAt,
      });
      const response = await forward({
        routeName: "private-storage",
        method: "POST",
        path: "/v1/ciphertext",
        body: { callerDid: options.agentDid, blob },
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      });
      return reply
        .code(response.statusCode)
        .header("content-type", response.contentType)
        .send(response.body);
    } catch (error) {
      return sendBrokerError(reply, error);
    }
  });

  return app;
}
