import { timingSafeEqual } from "node:crypto";

import {
  CandidateIntakeApplicationSchema,
  CandidateOpportunityResponseSchema,
  CandidateProvisioningReceiptSchema,
  DidSchema,
} from "@abl/schemas";
import { CandidateIntakeError, type CandidateIntakeService } from "@abl/launch";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

const ChallengeRequestSchema = z.strictObject({ candidateDid: DidSchema });
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

export function createCandidateEdge(input: {
  intake: CandidateIntakeService;
  provisioningToken?: string;
}): FastifyInstance {
  if (
    input.provisioningToken !== undefined &&
    Buffer.byteLength(input.provisioningToken) < 32
  )
    throw new Error("Candidate provisioning token is too short");
  const app = Fastify({ logger: false, bodyLimit: 1_200_000 });

  function isProvisioner(authorization: string | undefined): boolean {
    if (input.provisioningToken === undefined || authorization === undefined)
      return false;
    const expected = Buffer.from(`Bearer ${input.provisioningToken}`);
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

  app.get("/v1/candidate-intake", async () => input.intake.intakeState());

  app.post("/internal/v1/candidate-intake/snapshot", async (request, reply) => {
    if (!isProvisioner(request.headers.authorization))
      return reply.code(404).send({ error: "not_found" });
    return { records: await input.intake.provisioningSnapshot() };
  });
  app.post("/internal/v1/candidate-intake/receipt", async (request, reply) => {
    if (!isProvisioner(request.headers.authorization))
      return reply.code(404).send({ error: "not_found" });
    const receipt = CandidateProvisioningReceiptSchema.safeParse(request.body);
    if (!receipt.success)
      return reply.code(400).send({ error: "invalid_provisioning_receipt" });
    return input.intake.recordProvisioningReceipt(receipt.data);
  });

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
