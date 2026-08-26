import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  signServiceRequest,
  type ServiceRequestIdentity,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  signCanonicalEvent,
  verifyEventContent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import {
  CAREER_CAPABILITY_AGGREGATE_TYPE,
  CAREER_CAPABILITY_RENEWAL_EVENT_TYPE,
  CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL,
  CareerCapabilityRenewalPayloadSchema,
  SignedCanonicalCommandSchema,
} from "@abl/schemas";
import { encryptContent } from "@abl/storage";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type { Address, TypedDataDomain } from "viem";
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

const CanonicalSigningRequestSchema = z.strictObject({
  event: z.strictObject({
    eventId: z.string().min(1).max(200),
    actorDid: z.string().startsWith("did:").max(500),
    nonce: z.string().min(1).max(200),
    idempotencyKey: z.string().min(16).max(200),
    aggregateType: z.string().min(1).max(160),
    aggregateId: z.string().min(1).max(200),
    aggregateVersion: z.string().regex(/^[1-9][0-9]*$/),
    eventType: z.string().min(1).max(160),
    previousEventHash: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/)
      .nullable(),
    payloadCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
    payload: z.unknown(),
    stateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
    schemaDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    timestamp: z.iso.datetime({ offset: true }),
    eventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  }),
});

export interface BrokerRoute {
  name: string;
  targetOrigin: string;
  methods: ReadonlySet<"GET" | "POST">;
  pathPrefixes: readonly string[];
  capability: string;
  credential?: Readonly<Record<string, string>>;
}

export function createBlaxelUpstreamCredential(input: {
  mode: string;
  token: string;
  workspace: string | null;
}): Readonly<Record<string, string>> {
  if (input.token.length < 1 || input.token.length > 4_096)
    throw new BrokerPolicyError("Invalid upstream credential token");
  if (input.mode === "BLAXEL_PRIVATE_PREVIEW") {
    if (input.workspace !== null)
      throw new BrokerPolicyError(
        "Private-preview credentials cannot select a workspace",
      );
    return { "x-blaxel-preview-token": input.token };
  }
  if (input.mode === "BLAXEL_ACCESS_TOKEN") {
    if (
      input.workspace === null ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.workspace)
    )
      throw new BrokerPolicyError("Invalid upstream credential workspace");
    return {
      "x-blaxel-authorization": `Bearer ${input.token}`,
      "x-blaxel-workspace": input.workspace,
    };
  }
  throw new BrokerPolicyError("Unsupported upstream credential mode");
}

export interface BodyBrokerOptions {
  agentDid: string;
  clientCapability: {
    token: string;
    expiresAt: string;
    operations: ReadonlySet<string>;
  };
  serviceIdentity: ServiceRequestIdentity;
  routes: readonly BrokerRoute[];
  storageDomainKeys: ReadonlyMap<string, Uint8Array>;
  canonicalSigning?: {
    identity: SigningIdentity;
    domain: TypedDataDomain;
    allowedEvents: ReadonlySet<string>;
  };
  careerCapabilityRenewal?: {
    signerAddress: Address;
    domain: TypedDataDomain;
  };
  fetchImplementation?: typeof fetch;
  now?: () => number;
  createNonce?: () => string;
  createCapabilityToken?: () => string;
  allowHttpForTest?: boolean;
}

export class BrokerPolicyError extends Error {
  public override readonly name = "BrokerPolicyError";
}

const maximumCapabilityLifetimeMs = 4 * 60 * 60 * 1_000;

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
  const now = options.now ?? Date.now;
  const configuredAt = now();
  const capabilityExpiresAt = Date.parse(options.clientCapability.expiresAt);
  if (
    !Number.isFinite(capabilityExpiresAt) ||
    capabilityExpiresAt <= configuredAt ||
    capabilityExpiresAt - configuredAt > maximumCapabilityLifetimeMs ||
    options.clientCapability.token.length < 32 ||
    options.clientCapability.token.length > 512 ||
    options.clientCapability.operations.size === 0
  ) {
    throw new BrokerPolicyError("Invalid body capability configuration");
  }
  const routes = new Map(options.routes.map((route) => [route.name, route]));
  if (routes.size !== options.routes.length)
    throw new BrokerPolicyError("Duplicate broker route name");
  const app = Fastify({
    logger: false,
    bodyLimit: 1_500_000,
    requestTimeout: 15_000,
  });
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const createNonce = options.createNonce ?? randomUUID;
  const createCapabilityToken =
    options.createCapabilityToken ??
    (() => randomBytes(32).toString("base64url"));
  let activeCapability = {
    token: options.clientCapability.token,
    expiresAtMs: capabilityExpiresAt,
    operations: new Set(options.clientCapability.operations),
  };
  const usedRenewalEvents = new Map<string, number>();

  function assertClientCapability(
    request: FastifyRequest,
    operation: string,
  ): void {
    const authorization = request.headers.authorization;
    const supplied =
      typeof authorization === "string" && authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
    const expectedBytes = Buffer.from(activeCapability.token, "utf8");
    const suppliedBytes = Buffer.from(supplied, "utf8");
    if (
      now() >= activeCapability.expiresAtMs ||
      !activeCapability.operations.has(operation) ||
      suppliedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(suppliedBytes, expectedBytes)
    ) {
      throw new BrokerPolicyError("Body capability denied");
    }
  }

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
      for (const [name, value] of Object.entries(route.credential))
        headers[name.toLowerCase()] = value;
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
    boundary: "fixed-body-broker",
  }));

  app.post("/v1/capabilities/renew", async (request, reply) => {
    try {
      const renewal = options.careerCapabilityRenewal;
      if (renewal === undefined)
        throw new BrokerPolicyError("Career capability renewal is disabled");
      const command = SignedCanonicalCommandSchema.parse(request.body);
      if (command.signatures.length !== 1)
        throw new BrokerPolicyError(
          "Career capability renewal requires one signature",
        );
      const event = {
        ...command.event,
        aggregateVersion: BigInt(command.event.aggregateVersion),
      } as CanonicalEvent;
      verifyEventContent(event);
      const payload = CareerCapabilityRenewalPayloadSchema.parse(event.payload);
      const eventTime = Date.parse(event.timestamp);
      const expiresAtMs = Date.parse(payload.requestedExpiresAt);
      const currentTime = now();
      const operations = [...options.clientCapability.operations].sort();
      const recovered = await recoverCanonicalEventSigner(
        renewal.domain,
        event,
        command.signatures[0]! as `0x${string}`,
      );
      if (
        recovered.toLowerCase() !== renewal.signerAddress.toLowerCase() ||
        event.actorDid !== options.agentDid ||
        event.aggregateType !== CAREER_CAPABILITY_AGGREGATE_TYPE ||
        event.aggregateId !== options.agentDid ||
        event.aggregateVersion !== 1n ||
        event.eventType !== CAREER_CAPABILITY_RENEWAL_EVENT_TYPE ||
        event.previousEventHash !== null ||
        event.schemaDigest !==
          sha256Commitment(CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL) ||
        event.stateRoot !== sha256Commitment(payload) ||
        !Number.isFinite(eventTime) ||
        eventTime > currentTime + 5_000 ||
        currentTime - eventTime > 60_000 ||
        !Number.isFinite(expiresAtMs) ||
        expiresAtMs <= currentTime ||
        expiresAtMs - currentTime > maximumCapabilityLifetimeMs ||
        JSON.stringify(payload.operations) !== JSON.stringify(operations) ||
        usedRenewalEvents.has(event.eventHash)
      )
        throw new BrokerPolicyError("Career capability renewal denied");
      for (const [eventHash, expiresAt] of usedRenewalEvents)
        if (expiresAt <= currentTime) usedRenewalEvents.delete(eventHash);
      const token = createCapabilityToken();
      if (token.length < 32 || token.length > 512 || /[\r\n]/.test(token))
        throw new BrokerPolicyError("Generated body capability is invalid");
      usedRenewalEvents.set(event.eventHash, expiresAtMs);
      activeCapability = {
        token,
        expiresAtMs,
        operations: new Set(payload.operations),
      };
      return reply.send({
        token,
        expiresAt: payload.requestedExpiresAt,
        operations: payload.operations,
      });
    } catch (error) {
      return sendBrokerError(reply, error);
    }
  });

  app.post("/v1/signing/canonical-event", async (request, reply) => {
    try {
      assertClientCapability(request, "canonical-event:sign");
      const signing = options.canonicalSigning;
      if (signing === undefined)
        throw new BrokerPolicyError("Canonical signing is disabled");
      const { event: wireEvent } = CanonicalSigningRequestSchema.parse(
        request.body,
      );
      if (
        wireEvent.actorDid !== options.agentDid ||
        !signing.allowedEvents.has(
          `${wireEvent.aggregateType}:${wireEvent.eventType}`,
        )
      ) {
        throw new BrokerPolicyError("Canonical signing authority denied");
      }
      const event = {
        ...wireEvent,
        aggregateVersion: BigInt(wireEvent.aggregateVersion),
      } as CanonicalEvent;
      let signature;
      try {
        signature = await signCanonicalEvent(
          signing.identity,
          signing.domain,
          event,
        );
      } catch {
        throw new BrokerPolicyError("Canonical event content is invalid");
      }
      return reply.send({
        eventHash: event.eventHash,
        signerAddress: signing.identity.address,
        signature,
      });
    } catch (error) {
      return sendBrokerError(reply, error);
    }
  });

  app.post("/v1/proxy", async (request, reply) => {
    try {
      const input = ProxyRequestSchema.parse(request.body);
      assertClientCapability(request, `proxy:${input.route}`);
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
      assertClientCapability(request, "storage:put");
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
