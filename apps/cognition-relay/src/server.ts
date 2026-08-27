import {
  CognitionRelay,
  DurableCognitionRelay,
  type PairingSubmission,
  type RunnerAuthenticatedRequest,
} from "@abl/cognition";
import { sha256Commitment } from "@abl/recognition";
import {
  InferenceRequestSchema,
  InferenceResultSchema,
  RunnerHeartbeatSchema,
  RunnerPairingOfferSchema,
  type RunnerDelegation,
} from "@abl/schemas";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

const PairSchema = z.strictObject({
  offerId: z.uuid(),
  pairingToken: z.string().min(32).max(512),
  runnerId: z.string().min(1).max(160),
  delegateSigningAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  delegateEncryptionPublicKey: z.string().regex(/^0x[0-9a-f]{64}$/),
});

const InternalResultQuerySchema = z.strictObject({
  acknowledge: z.enum(["true", "false"]).optional(),
});
const ActivationTransitionSchema = z.strictObject({
  activationId: z.string().min(1).max(200),
  careerDid: z.string().startsWith("did:").max(500),
  gameId: z.string().min(1).max(200),
  role: z.enum(["PLAYER", "COACH", "REFEREE", "REPLAY"]),
  state: z.enum([
    "RECEIVED",
    "CONTEXT_ASSEMBLED",
    "SEALED_FOR_RUNNER",
    "DELIVERED",
    "RESULT_RECEIVED",
    "VALIDATED",
    "CAREER_SIGNED",
    "FALLBACK_SIGNED",
    "EXPIRED",
    "REJECTED",
  ]),
  activationCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  contextManifestCommitment: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  finalDecisionCommitment: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  deadlineAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export interface CognitionRelayServerOptions {
  relay: CognitionRelay | DurableCognitionRelay;
  internalToken: string;
  authorizePairing: (input: {
    submission: PairingSubmission;
    offer: Omit<z.infer<typeof RunnerPairingOfferSchema>, "pairingToken">;
  }) => Promise<RunnerDelegation>;
  authorizeRenewal?: (input: {
    current: RunnerDelegation;
    careerResourceName: string;
  }) => Promise<RunnerDelegation>;
  now?: () => string;
  longPollMs?: number;
}

type RateScope = "PAIR" | "RUNNER_IP" | "RUNNER";

export function createRelayRateLimiter(input?: {
  windowMs?: number;
  maximumEntries?: number;
}): {
  limited(
    scope: RateScope,
    identity: string,
    maximum: number,
    now: number,
  ): boolean;
  size(): number;
} {
  const windowMs = input?.windowMs ?? 60_000;
  const maximumEntries = input?.maximumEntries ?? 4_096;
  const windows = new Map<string, { startedAt: number; requests: number }>();
  return {
    limited(scope, identity, maximum, now) {
      for (const [key, value] of windows)
        if (now - value.startedAt >= windowMs) windows.delete(key);
      const key = `${scope}:${identity}`;
      const existing = windows.get(key);
      if (existing === undefined) {
        if (windows.size >= maximumEntries) return true;
        windows.set(key, { startedAt: now, requests: 1 });
        return false;
      }
      existing.requests += 1;
      return existing.requests > maximum;
    },
    size: () => windows.size,
  };
}

function internalAuthorized(
  request: FastifyRequest,
  expectedToken: string,
): boolean {
  return request.headers.authorization === `Bearer ${expectedToken}`;
}

function runnerAuth(
  request: FastifyRequest,
  body: unknown,
): RunnerAuthenticatedRequest {
  const headers = z
    .strictObject({
      runnerId: z.string().min(1).max(160),
      careerDid: z.string().startsWith("did:"),
      delegationId: z.uuid(),
      nonce: z.string().min(1).max(78),
      idempotencyKey: z.uuid(),
      timestamp: z.iso.datetime({ offset: true }),
      signature: z.string().regex(/^0x[0-9a-f]{130}$/),
    })
    .parse({
      runnerId: request.headers["x-abl-runner-id"],
      careerDid: request.headers["x-abl-career-did"],
      delegationId: request.headers["x-abl-delegation-id"],
      nonce: request.headers["x-abl-nonce"],
      idempotencyKey: request.headers["x-abl-idempotency-key"],
      timestamp: request.headers["x-abl-timestamp"],
      signature: request.headers["x-abl-signature"],
    });
  return {
    message: {
      runnerId: headers.runnerId,
      careerDid: headers.careerDid,
      delegationId: headers.delegationId,
      method: request.method,
      path: new URL(request.url, "http://relay.internal").pathname,
      bodyCommitment: sha256Commitment(body),
      nonce: headers.nonce,
      idempotencyKey: headers.idempotencyKey,
      timestamp: headers.timestamp,
    },
    signature: headers.signature as `0x${string}`,
  };
}

export function createCognitionRelayServer(
  options: CognitionRelayServerOptions,
): FastifyInstance {
  if (options.internalToken.length < 32)
    throw new Error("Relay internal token must contain at least 32 characters");
  const now = options.now ?? (() => new Date().toISOString());
  const app = Fastify({ logger: false, bodyLimit: 350_000 });
  const rateLimiter = createRelayRateLimiter();
  const rateLimited = (scope: RateScope, identity: string, maximum: number) =>
    rateLimiter.limited(scope, identity, maximum, Date.parse(now()));
  const preauthenticatedRunnerLimited = (request: FastifyRequest) =>
    rateLimited("RUNNER_IP", request.ip, 240);
  const authenticatedRunnerLimited = (runnerId: string) =>
    rateLimited("RUNNER", runnerId, 120);
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-canonical-authority", "none");
    reply.header("x-abl-cognition-custody", "ciphertext-only");
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "abl-cognition-relay",
    canonicalAuthority: false,
    plaintextContextAccess: false,
    modelCredentials: false,
    ...options.relay.snapshot(),
  }));

  app.post("/v1/runners/pair", async (request, reply) => {
    try {
      if (rateLimited("PAIR", request.ip, 10))
        return reply.code(429).send({ error: "pairing_rate_limited" });
      const submission = PairSchema.parse(request.body) as PairingSubmission;
      const delegation = await options.relay.pair(
        submission,
        async ({ offer }) => options.authorizePairing({ submission, offer }),
        now(),
      );
      return reply.code(201).send({ delegation });
    } catch (error) {
      return reply.code(400).send({
        error: "pairing_rejected",
        message: error instanceof Error ? error.message : "invalid pairing",
      });
    }
  });

  app.post("/v1/runners/heartbeat", async (request, reply) => {
    try {
      if (preauthenticatedRunnerLimited(request))
        return reply.code(429).send({ error: "runner_rate_limited" });
      const heartbeat = RunnerHeartbeatSchema.parse(request.body);
      const accepted = await options.relay.heartbeat(
        runnerAuth(request, heartbeat),
        heartbeat,
        now(),
      );
      if (authenticatedRunnerLimited(accepted.runnerId))
        return reply.code(429).send({ error: "runner_rate_limited" });
      return accepted;
    } catch (error) {
      return reply.code(401).send({
        error: "runner_authentication_failed",
        message: error instanceof Error ? error.message : "invalid heartbeat",
      });
    }
  });

  app.post("/v1/runners/delegation/renew", async (request, reply) => {
    try {
      if (preauthenticatedRunnerLimited(request))
        return reply.code(429).send({ error: "runner_rate_limited" });
      if (options.authorizeRenewal === undefined)
        throw new Error("Delegation renewal is unavailable");
      const auth = runnerAuth(request, null);
      const delegation = await options.relay.renew(
        auth,
        options.authorizeRenewal,
        now(),
      );
      if (authenticatedRunnerLimited(delegation.runnerId))
        return reply.code(429).send({ error: "runner_rate_limited" });
      return reply.code(201).send({ delegation });
    } catch (error) {
      return reply.code(401).send({
        error: "delegation_renewal_rejected",
        message: error instanceof Error ? error.message : "invalid renewal",
      });
    }
  });

  app.get("/v1/runners/status", async (request, reply) => {
    try {
      if (preauthenticatedRunnerLimited(request))
        return reply.code(429).send({ error: "runner_rate_limited" });
      const auth = runnerAuth(request, null);
      const delegation = await options.relay.authenticate(
        auth,
        now(),
        "RUNNER_HEARTBEAT",
      );
      if (authenticatedRunnerLimited(delegation.runnerId))
        return reply.code(429).send({ error: "runner_rate_limited" });
      return options.relay.runnerStatus(auth.message.runnerId);
    } catch (error) {
      return reply.code(401).send({
        error: "runner_authentication_failed",
        message: error instanceof Error ? error.message : "invalid request",
      });
    }
  });

  app.get("/v1/runners/activations/next", async (request, reply) => {
    try {
      if (preauthenticatedRunnerLimited(request))
        return reply.code(429).send({ error: "runner_rate_limited" });
      const auth = runnerAuth(request, null);
      const delegation = await options.relay.authenticate(
        auth,
        now(),
        "ACTIVATION_CLAIM",
      );
      if (authenticatedRunnerLimited(delegation.runnerId))
        return reply.code(429).send({ error: "runner_rate_limited" });
      const deadline =
        Date.now() + Math.min(options.longPollMs ?? 25_000, 25_000);
      let activation = options.relay.nextActivation(
        auth.message.runnerId,
        now(),
      );
      while (activation === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        activation = options.relay.nextActivation(auth.message.runnerId, now());
      }
      return activation === null ? reply.code(204).send() : activation;
    } catch (error) {
      return reply.code(401).send({
        error: "runner_authentication_failed",
        message: error instanceof Error ? error.message : "invalid request",
      });
    }
  });

  app.post<{ Params: { activationId: string } }>(
    "/v1/runners/activations/:activationId/result",
    async (request, reply) => {
      try {
        if (preauthenticatedRunnerLimited(request))
          return reply.code(429).send({ error: "runner_rate_limited" });
        const result = InferenceResultSchema.parse(request.body);
        const auth = runnerAuth(request, result);
        const delegation = await options.relay.authenticate(
          auth,
          now(),
          "RESULT_SUBMISSION",
        );
        if (authenticatedRunnerLimited(delegation.runnerId))
          return reply.code(429).send({ error: "runner_rate_limited" });
        if (request.params.activationId !== result.activationId)
          throw new Error("Result path and activation differ");
        return reply.code(202).send({
          status: await options.relay.submitResult(result, delegation, now()),
        });
      } catch (error) {
        return reply.code(400).send({
          error: "result_rejected",
          message: error instanceof Error ? error.message : "invalid result",
        });
      }
    },
  );

  app.post("/v1/runners/unpair", async (request, reply) => {
    try {
      if (preauthenticatedRunnerLimited(request))
        return reply.code(429).send({ error: "runner_rate_limited" });
      const auth = runnerAuth(request, null);
      const delegation = await options.relay.authenticate(
        auth,
        now(),
        "RUNNER_HEARTBEAT",
      );
      if (authenticatedRunnerLimited(delegation.runnerId))
        return reply.code(429).send({ error: "runner_rate_limited" });
      return await options.relay.unpair(auth.message.runnerId, now());
    } catch (error) {
      return reply.code(401).send({
        error: "unpair_rejected",
        message: error instanceof Error ? error.message : "invalid request",
      });
    }
  });

  app.post("/v1/internal/pairing-offers", async (request, reply) => {
    if (!internalAuthorized(request, options.internalToken))
      return reply.code(401).send({ error: "unauthorized" });
    await options.relay.registerPairingOffer(
      RunnerPairingOfferSchema.parse(request.body),
    );
    return reply.code(201).send({ status: "REGISTERED" });
  });

  app.post("/v1/internal/activations", async (request, reply) => {
    if (!internalAuthorized(request, options.internalToken))
      return reply.code(401).send({ error: "unauthorized" });
    return reply.code(201).send({
      status: await options.relay.enqueue(
        InferenceRequestSchema.parse(request.body),
      ),
    });
  });

  app.post("/v1/internal/activation-states", async (request, reply) => {
    if (!internalAuthorized(request, options.internalToken))
      return reply.code(401).send({ error: "unauthorized" });
    return reply.code(202).send(
      await options.relay.transitionActivation(
        (() => {
          const parsed = ActivationTransitionSchema.parse(request.body);
          return {
            ...parsed,
            activationCommitment: parsed.activationCommitment as `0x${string}`,
            contextManifestCommitment: parsed.contextManifestCommitment as
              | `0x${string}`
              | null,
            finalDecisionCommitment: parsed.finalDecisionCommitment as
              | `0x${string}`
              | null,
          };
        })(),
      ),
    );
  });

  app.get<{ Params: { careerDid: string } }>(
    "/v1/internal/careers/:careerDid/runner",
    async (request, reply) => {
      if (!internalAuthorized(request, options.internalToken))
        return reply.code(401).send({ error: "unauthorized" });
      return options.relay.careerRunnerStatus(
        decodeURIComponent(request.params.careerDid),
      );
    },
  );

  app.get<{ Params: { activationId: string }; Querystring: unknown }>(
    "/v1/internal/activations/:activationId/result",
    async (request, reply) => {
      if (!internalAuthorized(request, options.internalToken))
        return reply.code(401).send({ error: "unauthorized" });
      const query = InternalResultQuerySchema.parse(request.query);
      const result = await options.relay.result(
        request.params.activationId,
        query.acknowledge === "true" ? now() : undefined,
      );
      return result === null ? reply.code(204).send() : result;
    },
  );

  app.post<{ Params: { delegationId: string } }>(
    "/v1/internal/delegations/:delegationId/revoke",
    async (request, reply) => {
      if (!internalAuthorized(request, options.internalToken))
        return reply.code(401).send({ error: "unauthorized" });
      return await options.relay.revoke(request.params.delegationId, now());
    },
  );

  return app;
}
