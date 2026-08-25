import { timingSafeEqual } from "node:crypto";

import { FixedWindowRateLimiter } from "@abl/foundation";
import { CandidateIntakeError, type CandidateIntakeService } from "@abl/launch";
import { sha256Commitment } from "@abl/recognition";
import {
  CandidateCareerBindingSchema,
  CandidateIntakeApplicationSchema,
  CandidateOpportunityResponseSchema,
  CandidateProvisioningReceiptSchema,
  DidSchema,
} from "@abl/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

const ChallengeRequestSchema = z.strictObject({ candidateDid: DidSchema });
const AuthorityQuerySchema = CandidateCareerBindingSchema;
const RegistrationSchema = z.strictObject({
  application: CandidateIntakeApplicationSchema,
  challengeToken: z.string().min(1).max(4_096),
});
const StatusAuthorizationSchema = z.strictObject({
  applicationId: z.uuid(),
  candidateDid: DidSchema,
  requestedAt: z.iso.datetime({ offset: true }),
  nonce: z.string().min(16).max(160),
  signature: z.string().regex(/^0x[0-9a-f]{130}$/),
});

export const CANDIDATE_EDGE_ROUTE_CATALOG = [
  ["GET", "/v1/candidate-intake"],
  ["POST", "/v1/candidates/challenge"],
  ["POST", "/v1/candidates/register"],
  ["POST", "/v1/candidate-intake/status"],
  ["POST", "/v1/candidate-intake/redeliver"],
  ["POST", "/v1/candidate-intake/respond"],
] as const;
export const CANDIDATE_EDGE_INTERNAL_ROUTE_CATALOG = [
  ["POST", "/internal/v1/candidate-intake/snapshot"],
  ["POST", "/internal/v1/candidate-intake/receipt"],
  ["POST", "/internal/v1/candidate-intake/authority"],
] as const;

const forbiddenEnvironmentNames = [
  "DATABASE_URL",
  "ABL_DATABASE_URL",
  "BLAXEL_API_KEY",
  "BLAXEL_TOKEN",
  "AGENT_DRIVE_TOKEN",
  "ABL_PRIVATE_STORAGE_URL",
  "ABL_CORE_API_URL",
  "ABL_MODEL_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

export function assertCandidateEdgeIsolation(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const forbidden = forbiddenEnvironmentNames.filter(
    (name) => environment[name] !== undefined,
  );
  if (forbidden.length > 0)
    throw new Error(
      `Candidate edge received forbidden authority: ${forbidden.join(", ")}`,
    );
}

function failClosed(reply: {
  code(status: number): { send(body: unknown): unknown };
}) {
  return reply.code(400).send({ error: "candidate_intake_request_rejected" });
}

export interface CandidateRateLimitOptions {
  readMaximumRequests?: number;
  writeMaximumRequests?: number;
  windowMs?: number;
  maximumTrackedKeys?: number;
  now?: () => number;
}

export function installCandidateRateLimit(
  app: FastifyInstance,
  options: CandidateRateLimitOptions = {},
): void {
  const windowMs = options.windowMs ?? 60_000;
  const maximumTrackedKeys = options.maximumTrackedKeys ?? 50_000;
  const readLimiter = new FixedWindowRateLimiter({
    maximumRequests: options.readMaximumRequests ?? 120,
    windowMs,
    maximumTrackedKeys,
  });
  const writeLimiter = new FixedWindowRateLimiter({
    maximumRequests: options.writeMaximumRequests ?? 30,
    windowMs,
    maximumTrackedKeys,
  });
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (path === "/health" || path.startsWith("/internal/")) return;
    const isWrite = request.method !== "GET";
    const decision = (isWrite ? writeLimiter : readLimiter).consume(
      `${request.ip}:${isWrite ? "write" : "read"}`,
      options.now?.(),
    );
    reply.header("ratelimit-limit", decision.limit);
    reply.header("ratelimit-remaining", decision.remaining);
    reply.header("ratelimit-reset", decision.retryAfterSeconds);
    if (!decision.allowed)
      return reply
        .header("retry-after", decision.retryAfterSeconds)
        .code(429)
        .send({
          error: "candidate_intake_rate_limited",
          retryAfterSeconds: decision.retryAfterSeconds,
        });
  });
}

export function createCandidateEdge(input: {
  intake: CandidateIntakeService;
  provisioningToken?: string;
  authorityToken?: string;
  rateLimit?: CandidateRateLimitOptions;
}): FastifyInstance {
  for (const [name, token] of [
    ["provisioning", input.provisioningToken],
    ["authority", input.authorityToken],
  ] as const)
    if (token !== undefined && Buffer.byteLength(token) < 32)
      throw new Error(`Candidate ${name} token is too short`);
  const app = Fastify({ logger: false, bodyLimit: 1_200_000 });
  installCandidateRateLimit(app, input.rateLimit);

  function hasToken(
    expectedToken: string | undefined,
    authorization: string | undefined,
  ): boolean {
    if (expectedToken === undefined || authorization === undefined)
      return false;
    const expected = Buffer.from(`Bearer ${expectedToken}`);
    const supplied = Buffer.from(authorization);
    return (
      expected.byteLength === supplied.byteLength &&
      timingSafeEqual(expected, supplied)
    );
  }

  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-canonical-authority", "none");
    reply.header("x-abl-genesis", "false");
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "abl-candidate-store",
    mode: "STORE",
    genesis: false,
    canonicalAuthority: false,
  }));

  app.get("/v1/candidate-intake", async () => input.intake.intakeState());

  app.post("/internal/v1/candidate-intake/snapshot", async (request, reply) => {
    if (!hasToken(input.provisioningToken, request.headers.authorization))
      return reply.code(404).send({ error: "not_found" });
    return { records: await input.intake.provisioningSnapshot() };
  });
  app.post("/internal/v1/candidate-intake/receipt", async (request, reply) => {
    if (!hasToken(input.provisioningToken, request.headers.authorization))
      return reply.code(404).send({ error: "not_found" });
    const receipt = CandidateProvisioningReceiptSchema.safeParse(request.body);
    if (!receipt.success)
      return reply.code(400).send({ error: "invalid_provisioning_receipt" });
    return input.intake.recordProvisioningReceipt(receipt.data);
  });
  app.post(
    "/internal/v1/candidate-intake/authority",
    async (request, reply) => {
      if (!hasToken(input.authorityToken, request.headers.authorization))
        return reply.code(404).send({ error: "not_found" });
      const query = AuthorityQuerySchema.safeParse(request.body);
      if (!query.success) return failClosed(reply);
      const record = (await input.intake.provisioningSnapshot()).find(
        ({ application }) =>
          application.applicationId === query.data.applicationId,
      );
      const receipt = record?.provisioningReceipt;
      const accepted = record?.opportunityResponses.findLast(
        (response) =>
          response.action === "ACCEPT_OFFER" &&
          response.decisionCommitment === query.data.capacityDecisionCommitment,
      );
      if (
        record === undefined ||
        record.application.candidateDid !== query.data.candidateDid ||
        record.decision.roleClass !== query.data.roleClass ||
        record.decision.decisionCommitment !==
          query.data.capacityDecisionCommitment ||
        accepted === undefined ||
        sha256Commitment(accepted) !==
          query.data.opportunityResponseCommitment ||
        record.status.state !== "PROVISIONED" ||
        (receipt?.state !== "PROVISIONED_AWAITING_TRANSFER" &&
          receipt?.state !== "ISOLATED_TRANSFER_COMPLETE") ||
        receipt.sandboxResourceName === null
      )
        return reply.code(403).send({ error: "candidate_not_operational" });
      return {
        operational: true,
        ...query.data,
        sandboxResourceName: receipt.sandboxResourceName,
      };
    },
  );

  app.post("/v1/candidates/challenge", async (request, reply) => {
    const parsed = ChallengeRequestSchema.safeParse(request.body);
    if (!parsed.success) return failClosed(reply);
    try {
      return input.intake.issueChallenge(parsed.data.candidateDid);
    } catch {
      return failClosed(reply);
    }
  });

  app.post("/v1/candidates/register", async (request, reply) => {
    const parsed = RegistrationSchema.safeParse(request.body);
    if (!parsed.success) return failClosed(reply);
    try {
      return await input.intake.register(parsed.data);
    } catch (error) {
      if (error instanceof CandidateIntakeError || error instanceof z.ZodError)
        return failClosed(reply);
      throw error;
    }
  });

  app.post("/v1/candidate-intake/respond", async (request, reply) => {
    const parsed = CandidateOpportunityResponseSchema.safeParse(request.body);
    if (!parsed.success) return failClosed(reply);
    try {
      return await input.intake.respond(parsed.data);
    } catch (error) {
      if (error instanceof CandidateIntakeError || error instanceof z.ZodError)
        return failClosed(reply);
      throw error;
    }
  });

  for (const [path, operation] of [
    ["/v1/candidate-intake/status", "status"],
    ["/v1/candidate-intake/redeliver", "redeliver"],
  ] as const) {
    app.post(path, async (request, reply) => {
      const parsed = StatusAuthorizationSchema.safeParse(request.body);
      if (!parsed.success) return failClosed(reply);
      try {
        return await input.intake[operation]({
          ...parsed.data,
          signature: parsed.data.signature as `0x${string}`,
        });
      } catch (error) {
        if (
          error instanceof CandidateIntakeError ||
          error instanceof z.ZodError
        )
          return failClosed(reply);
        throw error;
      }
    });
  }

  return app;
}
