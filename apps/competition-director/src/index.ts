import { SandboxInstance, blStartJob } from "@blaxel/core";
import { createSigningIdentity } from "@abl/recognition";
import type { Hex } from "viem";
import { z } from "zod";

import { runFoundingCareerSession } from "./practice.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const DomainSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  chainId: z.number().int().positive(),
  verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
const CareerSandboxNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const SessionKindSchema = z.enum(["PRACTICE", "COMPETITION"]);
const TaskSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("RUN_CAREER_SESSION"),
    sessionId: z.string().min(16).max(120),
    kind: SessionKindSchema,
    careerSandboxName: CareerSandboxNameSchema,
  }),
  z.strictObject({
    action: z.literal("RUN_SCHEDULED_CAREER_SESSION"),
    sessionSeriesId: z.string().min(8).max(80),
    kind: SessionKindSchema,
    careerSandboxName: CareerSandboxNameSchema,
  }),
]);

export function scheduledSessionId(seriesId: string, now = Date.now()): string {
  const hour = new Date(now)
    .toISOString()
    .slice(0, 13)
    .replaceAll(/[-T:]/g, "");
  return `${seriesId}:${hour}`;
}

const parsedDomain = DomainSchema.parse(
  JSON.parse(required("ABL_COMPETITION_COMMAND_DOMAIN_JSON")),
);
const domain = {
  ...parsedDomain,
  verifyingContract: parsedDomain.verifyingContract as Hex,
};
const coordinatorIdentity = createSigningIdentity(
  z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .parse(required("ABL_COMPETITION_COORDINATOR_SIGNING_KEY")) as Hex,
);
const model = {
  name: required("ABL_COMPETITION_MODEL_NAME"),
  provider: required("ABL_COMPETITION_MODEL_PROVIDER"),
  family: required("ABL_COMPETITION_MODEL_FAMILY"),
  revision: required("ABL_COMPETITION_MODEL_REVISION"),
  maxOutputTokens: z.coerce
    .number()
    .int()
    .min(64)
    .max(2_048)
    .parse(required("ABL_COMPETITION_MODEL_MAX_OUTPUT_TOKENS")),
};

blStartJob(async (candidate: unknown) => {
  const task = TaskSchema.parse(candidate);
  const sessionId =
    task.action === "RUN_CAREER_SESSION"
      ? task.sessionId
      : scheduledSessionId(task.sessionSeriesId);
  const sandbox = await SandboxInstance.get(task.careerSandboxName);
  const career = {
    async identity() {
      const response = await sandbox.fetch(3_000, "/v1/career/identity");
      if (!response.ok)
        throw new Error(`Career identity request failed: ${response.status}`);
      return response.json();
    },
    async activate(command: unknown) {
      const response = await sandbox.fetch(3_000, "/v1/career/activations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      if (!response.ok)
        throw new Error(`Career activation failed: ${response.status}`);
      return response.json();
    },
  };
  const result = await runFoundingCareerSession({
    sessionId,
    kind: task.kind,
    coordinatorDid: required("ABL_COMPETITION_COORDINATOR_DID"),
    coordinatorIdentity,
    domain,
    career,
    model,
  });
  process.stdout.write(
    `${JSON.stringify({
      sessionId: result.sessionId,
      state: result.state,
      canonical: result.canonical,
      genesis: result.genesis,
      applicationId: result.career.applicationId,
      candidateDid: result.career.candidateDid,
      activationCount: result.activationCount,
      modelInvocationCount: result.modelInvocationCount,
      modelDecisionCount: result.modelDecisionCount,
      fallbackCount: result.fallbackCount,
      eventMerkleRoot: result.result.eventMerkleRoot,
      finalStateRoot: result.result.finalStateRoot,
    })}\n`,
  );
});
