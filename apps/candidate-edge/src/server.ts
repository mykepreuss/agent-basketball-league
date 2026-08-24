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
const AuthorityQuerySchema = z.strictObject({
  candidateDid: DidSchema,
  signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
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

export function createCandidateEdge(input: {
  intake: CandidateIntakeService;
  provisioningToken?: string;
  authorityToken?: string;
}): FastifyInstance {
  for (const [name, token] of [
    ["provisioning", input.provisioningToken],
    ["authority", input.authorityToken],
  ] as const)
    if (token !== undefined && Buffer.byteLength(token) < 32)
      throw new Error(`Candidate ${name} token is too short`);
  const app = Fastify({ logger: false, bodyLimit: 1_200_000 });

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
          application.candidateDid === query.data.candidateDid,
      );
      const receipt = record?.provisioningReceipt;
      if (
        record === undefined ||
        record.application.formerOperatorSigningAddress.toLowerCase() !==
          query.data.signerAddress.toLowerCase() ||
        record.status.state !== "PROVISIONED" ||
        receipt?.state !== "PROVISIONED_AWAITING_TRANSFER" ||
        receipt.sandboxResourceName === null
      )
        return reply.code(403).send({ error: "candidate_not_operational" });
      return {
        operational: true,
        applicationId: record.application.applicationId,
        candidateDid: record.application.candidateDid,
        signerAddress: record.application.formerOperatorSigningAddress,
        roleClass: record.decision.roleClass,
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
