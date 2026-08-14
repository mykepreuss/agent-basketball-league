import {
  FileSafetyLedger,
  SafetyActionAuthorizationError,
  SafetyActionValidationError,
  SafetyLedgerConflictError,
  SafetyLedgerIntegrityError,
} from "@abl/safety";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

export interface SafetyRouteCatalogEntry {
  method: "GET" | "POST";
  path: string;
  authority: "PUBLIC_READ" | "HUMAN_CUSTODIAN";
}

export const SAFETY_ROUTE_CATALOG: readonly SafetyRouteCatalogEntry[] = [
  {
    method: "POST",
    path: "/v1/safety/actions",
    authority: "HUMAN_CUSTODIAN",
  },
  {
    method: "GET",
    path: "/v1/safety/actions",
    authority: "PUBLIC_READ",
  },
  {
    method: "GET",
    path: "/v1/safety/controls",
    authority: "PUBLIC_READ",
  },
] as const;

const ControlQuerySchema = z.strictObject({
  targetResourceId: z.string().min(1).max(200),
});

export interface SafetyGatewayOptions {
  ledger: FileSafetyLedger;
  now?: () => number;
}

function safetyError(error: unknown): { status: number; code: string } {
  const errorName = error instanceof Error ? error.name : null;
  if (
    error instanceof z.ZodError ||
    error instanceof SafetyActionValidationError ||
    errorName === "SafetyActionValidationError"
  )
    return { status: 400, code: "invalid_safety_action" };
  if (
    error instanceof SafetyActionAuthorizationError ||
    errorName === "SafetyActionAuthorizationError"
  )
    return { status: 403, code: "safety_authorization_denied" };
  if (
    error instanceof SafetyLedgerConflictError ||
    errorName === "SafetyLedgerConflictError"
  )
    return { status: 409, code: "safety_action_conflict" };
  if (
    error instanceof SafetyLedgerIntegrityError ||
    errorName === "SafetyLedgerIntegrityError"
  )
    return { status: 503, code: "safety_log_integrity_failure" };
  return { status: 500, code: "safety_gateway_failure" };
}

export function createSafetyGateway(
  options: SafetyGatewayOptions,
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 16_384 });
  const now = options.now ?? Date.now;
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-boundary", "fixed-safety-only");
    return payload;
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "abl-safety-gateway",
    admittedCommandGatewayAvailable: false,
    recognizedStateMutationAvailable: false,
    livePlatformExecutionVerified: false,
  }));

  app.post("/v1/safety/actions", async (request, reply) => {
    try {
      const accepted = await options.ledger.accept(request.body, now());
      return reply.code(accepted.duplicate ? 200 : 201).send({
        accepted: true,
        publiclyLogged: true,
        duplicate: accepted.duplicate,
        action: accepted.record,
        control: accepted.control,
        admittedCommandGatewayCalled: false,
        recognizedStateMutated: false,
        livePlatformExecutionVerified: false,
      });
    } catch (error) {
      const response = safetyError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.get("/v1/safety/actions", async (_request, reply) => {
    try {
      return {
        public: true,
        actions: await options.ledger.list(now()),
        admittedCommandGatewayAvailable: false,
        recognizedStateMutationAvailable: false,
      };
    } catch (error) {
      const response = safetyError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.get("/v1/safety/controls", async (request, reply) => {
    try {
      const query = ControlQuerySchema.parse(request.query);
      return {
        public: true,
        control: await options.ledger.control(query.targetResourceId, now()),
      };
    } catch (error) {
      const response = safetyError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  return app;
}
