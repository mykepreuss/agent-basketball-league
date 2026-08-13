import { randomBytes, randomUUID } from "node:crypto";

import {
  CanonicalConflictError,
  HashChainConflictError,
  IdempotencyConflictError,
  NonceReplayError,
  type CanonicalStore,
} from "@abl/database";
import { validatePossessionResolvedPayload } from "@abl/projections";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  type CanonicalEvent,
} from "@abl/recognition";
import Fastify, { type FastifyInstance } from "fastify";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import {
  installCandidateRehearsalRoutes,
  type CandidateRehearsalOptions,
} from "./candidates.js";

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

const HexSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);
const CanonicalEventSchema = z.strictObject({
  eventId: z.uuid(),
  actorDid: z.string().startsWith("did:"),
  nonce: z.string().min(1).max(78),
  idempotencyKey: z.uuid(),
  aggregateType: z.string().min(1).max(100),
  aggregateId: z.string().min(1).max(200),
  aggregateVersion: z.string().regex(/^[1-9]\d*$/),
  eventType: z.string().min(1).max(100),
  previousEventHash: HexSchema.nullable(),
  payloadCommitment: HexSchema,
  payload: z.unknown(),
  stateRoot: HexSchema,
  schemaDigest: HexSchema,
  timestamp: z.iso.datetime({ offset: true }),
  eventHash: HexSchema,
});
const CommandSchema = z.strictObject({
  event: CanonicalEventSchema,
  signatures: z.array(SignatureSchema).length(1),
});

export interface AdmittedAgentAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

export interface LiveCoreApiOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<string, AdmittedAgentAuthority>;
  competitionId: string;
  seasonId: string;
  now?: () => number;
  candidateAdmission?: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
}

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

function commandError(error: unknown): { status: number; code: string } {
  if (error instanceof z.ZodError)
    return { status: 400, code: "invalid_command" };
  if (error instanceof Error && error.name === "CommandValidationError")
    return { status: 400, code: "invalid_command" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "aggregate_conflict" };
  }
  if (error instanceof Error && error.name === "AuthorizationError")
    return { status: 403, code: "authorization_denied" };
  return { status: 500, code: "command_failure" };
}

function authorizationError(message: string): Error {
  const error = new Error(message);
  error.name = "AuthorizationError";
  return error;
}

function commandValidationError(message: string): Error {
  const error = new Error(message);
  error.name = "CommandValidationError";
  return error;
}

export function createLiveCoreApi(
  options: LiveCoreApiOptions,
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  const now = options.now ?? Date.now;
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-genesis-state", "REHEARSAL");
    return payload;
  });
  app.get("/health", async () => ({
    status: "ok",
    service: "abl-core-api",
    genesis: false,
    rehearsal: true,
    canonicalWritesEnabled: true,
  }));
  app.post("/v1/commands", async (request, reply) => {
    try {
      const parsed = CommandSchema.parse(request.body);
      const event = {
        ...parsed.event,
        aggregateVersion: BigInt(parsed.event.aggregateVersion),
      } as CanonicalEvent;
      const authority = options.admittedAgents.get(event.actorDid);
      const occurredAt = Date.parse(event.timestamp);
      if (
        authority === undefined ||
        !authority.allowedAggregateTypes.includes(event.aggregateType) ||
        !Number.isFinite(occurredAt) ||
        event.timestamp !== new Date(occurredAt).toISOString() ||
        occurredAt > now() + 60_000
      ) {
        throw authorizationError("Actor is not admitted for this command");
      }
      let signer: `0x${string}`;
      try {
        signer = await recoverCanonicalEventSigner(
          options.domain,
          event,
          parsed.signatures[0]! as `0x${string}`,
        );
      } catch {
        throw authorizationError("Canonical event signature is invalid");
      }
      if (signer.toLowerCase() !== authority.signerAddress.toLowerCase())
        throw authorizationError("Signature is not registered to actor");
      if (
        event.aggregateType !== "game-possession" ||
        event.eventType !== "PossessionResolved"
      ) {
        throw authorizationError("Command type is not enabled in rehearsal");
      }
      try {
        validatePossessionResolvedPayload(
          event.payload,
          event.aggregateId,
          event.stateRoot,
        );
      } catch (error) {
        throw commandValidationError(
          error instanceof Error ? error.message : "Invalid command payload",
        );
      }
      const result = await options.store.append({
        eventId: event.eventId,
        actorDid: event.actorDid,
        nonce: event.nonce,
        idempotencyKey: event.idempotencyKey,
        requestHash: sha256Commitment({
          eventHash: event.eventHash,
          signatures: parsed.signatures,
        }),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        expectedVersion: event.aggregateVersion - 1n,
        competitionId: options.competitionId,
        seasonId: options.seasonId,
        eventType: event.eventType,
        previousEventHash: event.previousEventHash,
        eventHash: event.eventHash,
        payloadSchemaDigest: event.schemaDigest,
        payloadCommitment: event.payloadCommitment,
        payload: event.payload,
        stateRoot: event.stateRoot,
        signatures: parsed.signatures,
        occurredAt: new Date(occurredAt),
        outboxTopic: "public.game",
      });
      return reply.code(result.duplicate ? 200 : 201).send({
        accepted: true,
        canonical: true,
        rehearsal: true,
        eventId: result.eventId,
        eventHash: result.eventHash,
        aggregateVersion: result.aggregateVersion.toString(),
        duplicate: result.duplicate,
      });
    } catch (error) {
      const response = commandError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });
  if (options.candidateAdmission !== undefined) {
    installCandidateRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      ...options.candidateAdmission,
    });
  }
  for (const route of CORE_ROUTE_CATALOG.filter(
    (entry) =>
      entry.path !== "/v1/commands" &&
      !(
        options.candidateAdmission !== undefined &&
        entry.authority === "CANDIDATE"
      ),
  )) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (_request, reply) =>
        reply.code(503).send({
          error: "genesis_not_authorized",
          canonicalWriteAccepted: false,
          retryableAfterGenesis: true,
        }),
    });
  }
  return app;
}
