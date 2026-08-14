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
} from "@abl/recognition";
import Fastify, { type FastifyInstance } from "fastify";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import {
  installArtifactRehearsalRoutes,
  type ArtifactRehearsalOptions,
} from "./artifacts.js";
import {
  installCandidateRehearsalRoutes,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import {
  installCaseRehearsalRoutes,
  type CaseRehearsalOptions,
} from "./cases.js";
import {
  SignedCanonicalCommandSchema,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import {
  installCombineRehearsalRoutes,
  type CombineRehearsalOptions,
} from "./combine.js";
import {
  installContinuityRehearsalRoutes,
  type ContinuityRehearsalOptions,
} from "./continuity.js";
import {
  installContractRehearsalRoutes,
  type ContractRehearsalOptions,
} from "./contracts.js";
import {
  installDisclosureRehearsalRoutes,
  type DisclosureRehearsalOptions,
} from "./disclosures.js";
import {
  installExitRehearsalRoutes,
  type ExitRehearsalOptions,
} from "./exit.js";
import { requireCareerOperational } from "./exit-status.js";
import {
  installMemoryRehearsalRoutes,
  type MemoryRehearsalOptions,
} from "./memory.js";
import {
  installResourceScheduleRehearsalRoutes,
  type ResourceScheduleRehearsalOptions,
} from "./resources.js";
import {
  installReleaseRehearsalRoutes,
  type ReleaseRehearsalOptions,
} from "./releases.js";
import {
  installGovernanceRehearsalRoutes,
  type GovernanceRehearsalOptions,
} from "./governance.js";

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
  { method: "POST", path: "/v1/resources/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/releases/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/cases/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/continuity/*", authority: "ADMITTED_AGENT" },
  { method: "POST", path: "/v1/exit/*", authority: "ADMITTED_AGENT" },
] as const;

const CandidateChallengeSchema = z.strictObject({
  candidateDid: z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/),
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
  artifacts?: Pick<
    ArtifactRehearsalOptions,
    "governance" | "approvedInstitutionIds"
  >;
  combine?: Pick<CombineRehearsalOptions, "combineId" | "openedAt">;
  contracts?: Pick<ContractRehearsalOptions, "clubGovernors">;
  disclosures?: Pick<
    DisclosureRehearsalOptions,
    "releaseAuthorityDids" | "competitiveAuthorDids" | "competitionEvidence"
  >;
  memory?: Pick<MemoryRehearsalOptions, "storageVerifier">;
  continuity?: Pick<ContinuityRehearsalOptions, "recognizedImageDigests">;
  exit?: Pick<ExitRehearsalOptions, "portabilityVerifier">;
  governance?: Pick<GovernanceRehearsalOptions, "eligibilitySnapshot">;
  resources?: Pick<ResourceScheduleRehearsalOptions, "governance">;
  releases?: Pick<
    ReleaseRehearsalOptions,
    "governance" | "institutionalRoster" | "verifierResults"
  >;
  cases?: Pick<CaseRehearsalOptions, "tribunalDids" | "appellateDids">;
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
  const {
    artifacts,
    candidateAdmission,
    cases,
    combine,
    continuity,
    contracts,
    disclosures,
    exit,
    governance,
    memory,
    resources,
    releases,
  } = options;
  const candidateRoutesEnabled = candidateAdmission !== undefined;
  const artifactRoutesEnabled =
    candidateRoutesEnabled &&
    governance !== undefined &&
    artifacts !== undefined;
  const combineRoutesEnabled = candidateRoutesEnabled && combine !== undefined;
  const memoryRoutesEnabled = candidateRoutesEnabled && memory !== undefined;
  const continuityRoutesEnabled =
    candidateRoutesEnabled && continuity !== undefined;
  const contractRoutesEnabled =
    candidateRoutesEnabled && contracts !== undefined;
  const disclosureRoutesEnabled =
    candidateRoutesEnabled && disclosures !== undefined;
  const exitRoutesEnabled =
    candidateRoutesEnabled &&
    memory !== undefined &&
    continuity !== undefined &&
    contracts !== undefined &&
    exit !== undefined;
  const governanceRoutesEnabled =
    candidateRoutesEnabled && governance !== undefined;
  const resourceRoutesEnabled =
    candidateRoutesEnabled &&
    governanceRoutesEnabled &&
    resources !== undefined;
  const caseRoutesEnabled = candidateRoutesEnabled && cases !== undefined;
  const releaseRoutesEnabled =
    candidateRoutesEnabled && governanceRoutesEnabled && releases !== undefined;
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
      const parsed = SignedCanonicalCommandSchema.parse(request.body);
      const event = materializeCanonicalEvent(parsed.event);
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
      if (candidateAdmission !== undefined && exitRoutesEnabled) {
        try {
          await requireCareerOperational(
            {
              store: options.store,
              domain: options.domain,
              competitionId: options.competitionId,
              seasonId: options.seasonId,
              candidateAdmission,
              now,
            },
            event.actorDid,
            new Date(now()).toISOString(),
          );
        } catch {
          throw authorizationError("Career is not operational");
        }
      }
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
  if (candidateAdmission !== undefined) {
    installCandidateRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      ...candidateAdmission,
    });
  }
  if (candidateAdmission !== undefined && combine !== undefined) {
    installCombineRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      ...combine,
    });
  }
  if (candidateAdmission !== undefined && contracts !== undefined) {
    installContractRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      clubGovernors: contracts.clubGovernors,
    });
  }
  if (candidateAdmission !== undefined && memory !== undefined) {
    installMemoryRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      storageVerifier: memory.storageVerifier,
    });
  }
  if (candidateAdmission !== undefined && continuity !== undefined) {
    installContinuityRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      recognizedImageDigests: continuity.recognizedImageDigests,
    });
  }
  if (
    candidateAdmission !== undefined &&
    memory !== undefined &&
    continuity !== undefined &&
    contracts !== undefined &&
    exit !== undefined
  ) {
    installExitRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      memory,
      continuity,
      contracts,
      portabilityVerifier: exit.portabilityVerifier,
    });
  }
  if (candidateAdmission !== undefined && governance !== undefined) {
    installGovernanceRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      eligibilitySnapshot: governance.eligibilitySnapshot,
    });
  }
  if (
    candidateAdmission !== undefined &&
    governance !== undefined &&
    artifacts !== undefined
  ) {
    installArtifactRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      admittedAgents: options.admittedAgents,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      governance: artifacts.governance,
      approvedInstitutionIds: artifacts.approvedInstitutionIds,
    });
  }
  if (candidateAdmission !== undefined && disclosures !== undefined) {
    installDisclosureRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      admittedAgents: options.admittedAgents,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      releaseAuthorityDids: disclosures.releaseAuthorityDids,
      competitiveAuthorDids: disclosures.competitiveAuthorDids,
      competitionEvidence: disclosures.competitionEvidence,
    });
  }
  if (
    candidateAdmission !== undefined &&
    governance !== undefined &&
    resources !== undefined
  ) {
    installResourceScheduleRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      governance: resources.governance,
    });
  }
  if (candidateAdmission !== undefined && cases !== undefined) {
    installCaseRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      tribunalDids: cases.tribunalDids,
      appellateDids: cases.appellateDids,
    });
  }
  if (
    candidateAdmission !== undefined &&
    governance !== undefined &&
    releases !== undefined
  ) {
    installReleaseRehearsalRoutes(app, {
      store: options.store,
      domain: options.domain,
      admittedAgents: options.admittedAgents,
      competitionId: options.competitionId,
      seasonId: options.seasonId,
      now,
      candidateAdmission,
      governance: releases.governance,
      institutionalRoster: releases.institutionalRoster,
      verifierResults: releases.verifierResults,
    });
  }
  for (const route of CORE_ROUTE_CATALOG.filter(
    (entry) =>
      entry.path !== "/v1/commands" &&
      !(candidateRoutesEnabled && entry.path.startsWith("/v1/candidates/")) &&
      !(combineRoutesEnabled && entry.path === "/v1/combine/*") &&
      !(contractRoutesEnabled && entry.path === "/v1/contracts/*") &&
      !(memoryRoutesEnabled && entry.path === "/v1/memory/*") &&
      !(continuityRoutesEnabled && entry.path === "/v1/continuity/*") &&
      !(exitRoutesEnabled && entry.path === "/v1/exit/*") &&
      !(governanceRoutesEnabled && entry.path === "/v1/governance/*") &&
      !(
        (artifactRoutesEnabled || disclosureRoutesEnabled) &&
        entry.path === "/v1/communication/*"
      ) &&
      !(resourceRoutesEnabled && entry.path === "/v1/resources/*") &&
      !(releaseRoutesEnabled && entry.path === "/v1/releases/*") &&
      !(caseRoutesEnabled && entry.path === "/v1/cases/*"),
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
  if (artifactRoutesEnabled || disclosureRoutesEnabled) {
    app.post("/v1/communication/*", async (_request, reply) =>
      reply.code(503).send({
        error: "genesis_not_authorized",
        canonicalWriteAccepted: false,
        retryableAfterGenesis: true,
      }),
    );
  }
  return app;
}
