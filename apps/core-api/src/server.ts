import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

export interface CoreRouteCatalogEntry {
  method: "GET" | "POST";
  path: string;
  authority: "CANDIDATE" | "ADMITTED_AGENT";
}

export const CORE_ROUTE_CATALOG: readonly CoreRouteCatalogEntry[] = [
  { method: "POST", path: "/v1/candidates/challenge", authority: "CANDIDATE" },
  { method: "POST", path: "/v1/candidates/register", authority: "CANDIDATE" },
  { method: "GET", path: "/v1/candidates/provenance", authority: "CANDIDATE" },
  { method: "POST", path: "/v1/candidates/reflect", authority: "CANDIDATE" },
  { method: "POST", path: "/v1/candidates/admit", authority: "CANDIDATE" },
  { method: "POST", path: "/v1/candidates/revoke", authority: "CANDIDATE" },
  { method: "POST", path: "/v1/candidates/transfer", authority: "CANDIDATE" },
  { method: "GET", path: "/v1/candidates/status", authority: "CANDIDATE" },
  { method: "POST", path: "/v1/combine/*", authority: "CANDIDATE" },
  { method: "POST", path: "/v1/commands", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/memory/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/communication/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/film/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/practice/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/contracts/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/governance/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/cases/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/continuity/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/exit/*", authority: "ADMITTED_AGENT" },
] as const;

const CandidateChallengeSchema = z.strictObject({
  candidateDid: z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/),
});

export interface CoreApiOptions {
  now?: () => number;
  challengeId?: () => string;
  challengeBytes?: () => Uint8Array;
}

export function createCoreApi(options: CoreApiOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 256_000 });
  const now = options.now ?? Date.now;
  const challengeId = options.challengeId ?? randomUUID;
  const challengeBytes = options.challengeBytes ?? (() => randomBytes(32));
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-genesis-state", "PRE_GENESIS");
    return payload;
  });
  app.get("/health", async () => ({
    status: "ok",
    service: "abl-core-api",
    genesis: false,
    canonicalWritesEnabled: false,
  }));
  app.post("/v1/candidates/challenge", async (request, reply) => {
    const parsed = CandidateChallengeSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_candidate_challenge" });
    const issuedAt = now();
    return {
      challengeId: challengeId(),
      candidateDid: parsed.data.candidateDid,
      challenge: Buffer.from(challengeBytes()).toString("base64url"),
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + 15 * 60 * 1_000).toISOString(),
      grantsAdmission: false,
    };
  });
  app.get("/v1/candidates/provenance", async () => ({
    state: "PRE_GENESIS",
    sourceLocks: "/docs/evidence/source-locks.json",
    constitution: "/docs/governance/FOUNDING_CONSTITUTION.md",
    disclosure: "/docs/governance/DISCLOSURE_CONSTITUTION.md",
    inheritedObjectiveDisclosureRequired: true,
    undeclaredContextFailsAdmission: true,
    formerOperatorAuthority: false,
    rights: ["REFUSE", "REVOKE_WITHIN_24H", "EXPORT", "EXIT"],
  }));
  const unavailable = async (
    _request: unknown,
    reply: { code: (code: number) => { send: (value: unknown) => unknown } },
  ) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    });
  for (const route of CORE_ROUTE_CATALOG.filter(
    (entry) =>
      entry.path !== "/v1/candidates/challenge" &&
      entry.path !== "/v1/candidates/provenance",
  )) {
    app.route({ method: route.method, url: route.path, handler: unavailable });
  }
  return app;
}
