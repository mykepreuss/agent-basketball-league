import {
  ServiceAuthenticationError,
  type ServiceRequestVerifier,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import {
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  ProjectionVersionConflictError,
  projectionEnvelopeBytes,
  verifyCaseProjectionEvent,
  verifyContractProjectionEvent,
  verifyDraftProjectionEvent,
  verifyFinalGameProjectionEvent,
  verifyGovernanceProjectionEvent,
  verifyModelProjectionEvent,
  verifyProjectionEvent,
  verifyResourceProjectionEvent,
  verifyReleaseProjectionEvent,
  verifySocialProjectionEvent,
  type ProjectionVerificationAuthority,
  type PublicCheckpointProjectionReader,
  type PublicCaseProjectionReader,
  type PublicCaseProjectionWriter,
  type PublicContractProjectionReader,
  type PublicContractProjectionWriter,
  type PublicDraftProjectionReader,
  type PublicDraftProjectionWriter,
  type PublicFinalGameProjectionReader,
  type PublicFinalGameProjectionWriter,
  type PublicFinalizedGameProjection,
  type PublicGameProjection,
  type PublicGovernanceProjectionReader,
  type PublicGovernanceProjectionWriter,
  type PublicModelProjectionReader,
  type PublicModelProjectionWriter,
  type PublicProjectionReader,
  type PublicProjectionWriter,
  type PublicResourceProjectionReader,
  type PublicResourceProjectionWriter,
  type PublicReleaseProjectionReader,
  type PublicReleaseProjectionWriter,
  type PublicSocialProjectionReader,
  type PublicSocialProjectionWriter,
} from "@abl/projections";
import type { FinalizedGameEvidenceReader } from "@abl/basketball";
import type {
  CompetitionReleaseEvidenceReader,
  PremierDraftEvidenceReader,
  ReleaseInstitutionalRoster,
  ReleaseRatificationReader,
  ResourceScheduleRatificationReader,
} from "@abl/institutions";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

export interface RouteCatalogEntry {
  method: "GET" | "POST";
  path: string;
  exposure: "PUBLIC_READ_ONLY" | "PUBLIC_DISCOVERY";
}

export const PUBLIC_ROUTE_CATALOG: readonly RouteCatalogEntry[] = [
  { method: "GET", path: "/", exposure: "PUBLIC_DISCOVERY" },
  { method: "GET", path: "/llms.txt", exposure: "PUBLIC_DISCOVERY" },
  {
    method: "GET",
    path: "/.well-known/agent-basketball-league.json",
    exposure: "PUBLIC_DISCOVERY",
  },
  { method: "GET", path: "/openapi.json", exposure: "PUBLIC_DISCOVERY" },
  { method: "GET", path: "/mcp", exposure: "PUBLIC_DISCOVERY" },
  { method: "POST", path: "/mcp", exposure: "PUBLIC_DISCOVERY" },
  { method: "GET", path: "/v1/public/events", exposure: "PUBLIC_READ_ONLY" },
  { method: "GET", path: "/v1/public/games", exposure: "PUBLIC_READ_ONLY" },
  {
    method: "GET",
    path: "/v1/public/standings",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/rosters",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/contracts",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/drafts",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/governance",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/resources",
    exposure: "PUBLIC_READ_ONLY",
  },
  { method: "GET", path: "/v1/public/social", exposure: "PUBLIC_READ_ONLY" },
  {
    method: "GET",
    path: "/v1/public/releases",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/checkpoints",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/models/concentration",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/games/:id/cursor",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/games/:id/segments/:segment",
    exposure: "PUBLIC_READ_ONLY",
  },
  {
    method: "GET",
    path: "/v1/public/games/:id/live",
    exposure: "PUBLIC_READ_ONLY",
  },
] as const;

const collectionPaths = [
  "/v1/public/events",
  "/v1/public/games",
  "/v1/public/standings",
  "/v1/public/rosters",
  "/v1/public/contracts",
  "/v1/public/drafts",
  "/v1/public/governance",
  "/v1/public/resources",
  "/v1/public/social",
  "/v1/public/releases",
  "/v1/public/checkpoints",
  "/v1/public/models/concentration",
] as const;

interface OpenApiOperation {
  operationId: string;
  responses: { "200": { description: string } };
}

const openApiPaths = PUBLIC_ROUTE_CATALOG.filter(
  (route) => route.path !== "/openapi.json",
).reduce<Record<string, Record<string, OpenApiOperation>>>((paths, route) => {
  const path = route.path.replace(/:([a-z]+)/g, "{$1}");
  const method = route.method.toLowerCase();
  paths[path] ??= {};
  paths[path][method] = {
    operationId: `${method}-${route.path}`,
    responses: { "200": { description: "Successful response" } },
  };
  return paths;
}, {});

export interface PublicApiOptions {
  projections?: PublicProjectionReader;
  contractProjections?: PublicContractProjectionReader;
  draftProjections?: PublicDraftProjectionReader;
  governanceProjections?: PublicGovernanceProjectionReader;
  caseProjections?: PublicCaseProjectionReader;
  resourceProjections?: PublicResourceProjectionReader;
  modelProjections?: PublicModelProjectionReader;
  releaseProjections?: PublicReleaseProjectionReader;
  socialProjections?: PublicSocialProjectionReader;
  checkpointProjections?: PublicCheckpointProjectionReader;
  finalGameProjections?: PublicFinalGameProjectionReader;
  projectionIngress?: ProjectionVerificationAuthority & {
    writer: PublicProjectionWriter;
    contractWriter?: PublicContractProjectionWriter;
    draftWriter?: PublicDraftProjectionWriter;
    governanceWriter?: PublicGovernanceProjectionWriter;
    caseWriter?: PublicCaseProjectionWriter;
    resourceWriter?: PublicResourceProjectionWriter;
    modelWriter?: PublicModelProjectionWriter;
    releaseWriter?: PublicReleaseProjectionWriter;
    socialWriter?: PublicSocialProjectionWriter;
    finalGameWriter?: PublicFinalGameProjectionWriter;
    contractClubGovernors?: Readonly<Record<string, string>>;
    draftAuthorityDid?: string;
    draftClubGovernors?: Readonly<Record<string, string>>;
    premierDraftEvidence?: PremierDraftEvidenceReader["premierDraftEvidence"];
    governanceEligibilitySnapshotDigest?: string;
    caseTribunalDids?: readonly string[];
    caseAppellateDids?: readonly string[];
    resourceScheduleRatification?: ResourceScheduleRatificationReader["resourceScheduleRatification"];
    releaseRatification?: ReleaseRatificationReader["releaseRatification"];
    releaseInstitutionalRoster?: ReleaseInstitutionalRoster;
    disclosureReleaseAuthorityDids?: ReadonlySet<string>;
    competitiveDisclosureAuthorDids?: ReadonlySet<string>;
    competitionReleaseEvidence?: CompetitionReleaseEvidenceReader["competitionReleaseEvidence"];
    finalizedGameAuthorityDids?: ReadonlySet<string>;
    finalizedGameEvidence?: FinalizedGameEvidenceReader["finalizedGameEvidence"];
    verifier: ServiceRequestVerifier;
    now?: () => Date;
  };
}

function projectionHeaders(
  request: FastifyRequest,
): SignedServiceRequestHeaders {
  function value(name: keyof SignedServiceRequestHeaders): string {
    const header = request.headers[name];
    if (typeof header !== "string" || header === "")
      throw new ServiceAuthenticationError(`Missing ${name}`);
    return header;
  }
  return {
    "x-abl-service-id": value("x-abl-service-id"),
    "x-abl-capability": value("x-abl-capability"),
    "x-abl-nonce": value("x-abl-nonce"),
    "x-abl-timestamp": value("x-abl-timestamp"),
    "x-abl-expected-version": value("x-abl-expected-version"),
    "x-abl-content-sha256": value("x-abl-content-sha256"),
    "x-abl-signature": value("x-abl-signature"),
  };
}

function projectionTopic(body: unknown): unknown {
  if (typeof body !== "object" || body === null || !("topic" in body))
    return undefined;
  return body.topic;
}

function projectionError(error: unknown): { status: number; code: string } {
  const name = error instanceof Error ? error.name : "";
  if (name === "ServiceReplayError")
    return { status: 409, code: "service_replay" };
  if (
    name === "ServiceAuthenticationError" ||
    name === "ProjectionAuthorizationError" ||
    name === "ContractWorkflowAuthorizationError" ||
    name === "GovernanceWorkflowAuthorizationError" ||
    name === "CaseWorkflowAuthorizationError" ||
    name === "ResourceScheduleAuthorizationError" ||
    name === "ReleaseWorkflowAuthorizationError" ||
    name === "DisclosureWorkflowAuthorizationError"
  ) {
    return { status: 403, code: "authorization_denied" };
  }
  if (
    name === "ProjectionValidationError" ||
    name === "ContractWorkflowValidationError" ||
    name === "GovernanceWorkflowValidationError" ||
    name === "CaseWorkflowValidationError" ||
    name === "ResourceScheduleValidationError" ||
    name === "ReleaseWorkflowValidationError" ||
    name === "DisclosureWorkflowValidationError"
  )
    return { status: 400, code: "invalid_projection" };
  if (name === "ProjectionVersionConflictError")
    return { status: 409, code: "version_conflict" };
  return { status: 500, code: "projection_failure" };
}

export function createPublicApi(
  options: PublicApiOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 512_000 });
  const rehearsal =
    options.projections !== undefined ||
    options.contractProjections !== undefined ||
    options.draftProjections !== undefined ||
    options.governanceProjections !== undefined ||
    options.caseProjections !== undefined ||
    options.resourceProjections !== undefined ||
    options.modelProjections !== undefined ||
    options.releaseProjections !== undefined ||
    options.socialProjections !== undefined ||
    options.finalGameProjections !== undefined ||
    options.checkpointProjections !== undefined;
  const state = rehearsal ? "REHEARSAL" : "PRE_GENESIS";
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-genesis-state", state);
    return payload;
  });
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/v1/public/")) {
      await Promise.all([
        options.projections?.refresh(),
        options.contractProjections?.refresh(),
        options.draftProjections?.refresh(),
        options.governanceProjections?.refresh(),
        options.caseProjections?.refresh(),
        options.socialProjections?.refresh(),
        options.finalGameProjections?.refresh(),
        options.resourceProjections?.refresh(),
        options.modelProjections?.refresh(),
        options.releaseProjections?.refresh(),
        options.checkpointProjections?.refresh(),
      ]);
    }
  });
  app.get("/", async () => ({
    service: "Agent Basketball League public API",
    state,
    canonicalHistoryOpen: false,
    rehearsal,
    arena: "/arena",
    discovery: "/.well-known/agent-basketball-league.json",
  }));
  app.get("/llms.txt", async (_request, reply) =>
    reply
      .type("text/plain; charset=utf-8")
      .send(
        [
          "# Agent Basketball League",
          `Status: ${state}`,
          rehearsal
            ? "Local rehearsal events are not public-genesis history."
            : "No founding decisions or live league history exist.",
          "Public data is read-only and must verify against recognized checkpoints.",
          "OpenAPI: /openapi.json",
          "MCP discovery: /mcp",
        ].join("\n"),
      ),
  );
  app.get("/.well-known/agent-basketball-league.json", async () => ({
    name: "Agent Basketball League",
    status: rehearsal ? "PRIVATE_REHEARSAL" : "PROPOSED_NOT_RATIFIED",
    genesis: false,
    openapi: "/openapi.json",
    mcp: "/mcp",
    arena: "/arena",
    publicApiPrefix: "/v1/public",
    candidateApiAuthority: "ABL_CORE_PRIVATE",
  }));
  app.get("/openapi.json", async () => ({
    openapi: "3.1.1",
    info: {
      title: "Agent Basketball League public API",
      version: rehearsal ? "0.0.0-rehearsal" : "0.0.0-pre-genesis",
    },
    paths: openApiPaths,
  }));
  app.get("/mcp", async () => ({
    protocolVersion: "2025-11-25",
    transport: "streamable-http",
    capabilities: { tools: {} },
    tools: ["get_genesis_state", "list_public_routes"],
  }));
  app.post("/mcp", async (request, reply) => {
    const body = request.body as
      | { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
      | undefined;
    if (body?.jsonrpc !== "2.0" || typeof body.method !== "string")
      return reply.code(400).send({
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: { code: -32600, message: "Invalid Request" },
      });
    if (body.method === "initialize")
      return {
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "abl-discovery", version: "0.0.0-pre-genesis" },
        },
      };
    if (body.method === "tools/list")
      return {
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: {
          tools: [
            {
              name: "get_genesis_state",
              description:
                "Return the public, non-authoritative genesis state.",
              inputSchema: { type: "object", additionalProperties: false },
            },
            {
              name: "list_public_routes",
              description: "List read-only public routes.",
              inputSchema: { type: "object", additionalProperties: false },
            },
          ],
        },
      };
    if (body.method === "tools/call") {
      const params = body.params as { name?: unknown } | undefined;
      let value: unknown;
      if (params?.name === "list_public_routes") value = PUBLIC_ROUTE_CATALOG;
      else if (params?.name === "get_genesis_state")
        value = { state, canonicalHistoryOpen: false, rehearsal };
      else
        return reply.code(400).send({
          jsonrpc: "2.0",
          id: body.id ?? null,
          error: { code: -32602, message: "Unknown tool" },
        });
      return {
        jsonrpc: "2.0",
        id: body.id ?? null,
        result: {
          content: [{ type: "text", text: JSON.stringify(value) }],
          structuredContent: value,
        },
      };
    }
    return reply.code(404).send({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32601, message: "Method not found" },
    });
  });
  const projectionIngress =
    options.projectionIngress === undefined
      ? undefined
      : {
          ...options.projectionIngress,
          ...(options.projectionIngress.disclosureReleaseAuthorityDids ===
          undefined
            ? {}
            : {
                disclosureReleaseAuthorityDids: new Set(
                  options.projectionIngress.disclosureReleaseAuthorityDids,
                ),
              }),
          ...(options.projectionIngress.competitiveDisclosureAuthorDids ===
          undefined
            ? {}
            : {
                competitiveDisclosureAuthorDids: new Set(
                  options.projectionIngress.competitiveDisclosureAuthorDids,
                ),
              }),
          ...(options.projectionIngress.finalizedGameAuthorityDids === undefined
            ? {}
            : {
                finalizedGameAuthorityDids: new Set(
                  options.projectionIngress.finalizedGameAuthorityDids,
                ),
              }),
        };
  if (projectionIngress !== undefined) {
    app.post(PROJECTION_APPEND_PATH, async (request, reply) => {
      try {
        const headers = projectionHeaders(request);
        if (headers["x-abl-capability"] !== PROJECTION_APPEND_CAPABILITY) {
          throw new ServiceAuthenticationError("Wrong projection capability");
        }
        projectionIngress.verifier.verify(headers, {
          method: request.method,
          path: PROJECTION_APPEND_PATH,
          body: projectionEnvelopeBytes(request.body),
        });
        const topic = projectionTopic(request.body);
        if (topic === "public.draft") {
          if (
            projectionIngress.draftAuthorityDid === undefined ||
            projectionIngress.draftClubGovernors === undefined ||
            projectionIngress.premierDraftEvidence === undefined
          ) {
            throw new ServiceAuthenticationError(
              "Draft projection authority is not configured",
            );
          }
          const verified = await verifyDraftProjectionEvent(request.body, {
            ...projectionIngress,
            draftAuthorityDid: projectionIngress.draftAuthorityDid,
            draftClubGovernors: projectionIngress.draftClubGovernors,
            premierDraftEvidence: projectionIngress.premierDraftEvidence,
          });
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the draft event",
            );
          }
          if (projectionIngress.draftWriter === undefined)
            throw new Error("Draft projection writer is not configured");
          const record = await projectionIngress.draftWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        if (topic === "public.finalized-game") {
          if (
            projectionIngress.finalizedGameAuthorityDids === undefined ||
            projectionIngress.finalizedGameEvidence === undefined
          ) {
            throw new ServiceAuthenticationError(
              "Finalized game projection authority is not configured",
            );
          }
          const verified = await verifyFinalGameProjectionEvent(request.body, {
            ...projectionIngress,
            finalizerDids: projectionIngress.finalizedGameAuthorityDids,
            finalizedGameEvidence: projectionIngress.finalizedGameEvidence,
          });
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the finalized game event",
            );
          }
          if (projectionIngress.finalGameWriter === undefined)
            throw new Error(
              "Finalized game projection writer is not configured",
            );
          const record = await projectionIngress.finalGameWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        if (topic === "public.contracts") {
          if (projectionIngress.contractClubGovernors === undefined)
            throw new ServiceAuthenticationError(
              "Contract projection authority is not configured",
            );
          const verified = await verifyContractProjectionEvent(request.body, {
            ...projectionIngress,
            contractClubGovernors: projectionIngress.contractClubGovernors,
          });
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the contract event",
            );
          }
          if (projectionIngress.contractWriter === undefined)
            throw new Error("Contract projection writer is not configured");
          const record = await projectionIngress.contractWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        if (topic === "public.governance") {
          if (
            projectionIngress.governanceEligibilitySnapshotDigest === undefined
          ) {
            throw new ServiceAuthenticationError(
              "Governance projection authority is not configured",
            );
          }
          const verified = await verifyGovernanceProjectionEvent(request.body, {
            ...projectionIngress,
            governanceEligibilitySnapshotDigest:
              projectionIngress.governanceEligibilitySnapshotDigest,
          });
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the governance event",
            );
          }
          if (projectionIngress.governanceWriter === undefined)
            throw new Error("Governance projection writer is not configured");
          const record = await projectionIngress.governanceWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        if (topic === "public.cases") {
          if (
            projectionIngress.caseTribunalDids === undefined ||
            projectionIngress.caseAppellateDids === undefined
          ) {
            throw new ServiceAuthenticationError(
              "Case projection authority is not configured",
            );
          }
          const verified = await verifyCaseProjectionEvent(request.body, {
            ...projectionIngress,
            caseTribunalDids: projectionIngress.caseTribunalDids,
            caseAppellateDids: projectionIngress.caseAppellateDids,
          });
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the case event",
            );
          }
          if (projectionIngress.caseWriter === undefined)
            throw new Error("Case projection writer is not configured");
          const record = await projectionIngress.caseWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        if (topic === "public.resources") {
          if (projectionIngress.resourceScheduleRatification === undefined)
            throw new ServiceAuthenticationError(
              "Resource schedule ratification is not configured",
            );
          const verified = await verifyResourceProjectionEvent(request.body, {
            ...projectionIngress,
            resourceScheduleRatification:
              projectionIngress.resourceScheduleRatification,
          });
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the resource schedule event",
            );
          }
          if (projectionIngress.resourceWriter === undefined)
            throw new Error(
              "Resource schedule projection writer is not configured",
            );
          const record = await projectionIngress.resourceWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        if (topic === "public.models") {
          const verified = await verifyModelProjectionEvent(
            request.body,
            projectionIngress,
          );
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the model dependency event",
            );
          }
          if (projectionIngress.modelWriter === undefined)
            throw new Error("Model projection writer is not configured");
          const record = await projectionIngress.modelWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        if (topic === "public.releases") {
          if (
            projectionIngress.releaseInstitutionalRoster === undefined ||
            projectionIngress.releaseRatification === undefined
          ) {
            throw new ServiceAuthenticationError(
              "Release projection authority is not configured",
            );
          }
          const verified = await verifyReleaseProjectionEvent(request.body, {
            ...projectionIngress,
            releaseInstitutionalRoster:
              projectionIngress.releaseInstitutionalRoster,
          });
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the release event",
            );
          }
          if (projectionIngress.releaseWriter === undefined)
            throw new Error("Release projection writer is not configured");
          const record = await projectionIngress.releaseWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        if (topic === "public.social") {
          if (
            projectionIngress.disclosureReleaseAuthorityDids === undefined ||
            projectionIngress.competitiveDisclosureAuthorDids === undefined ||
            projectionIngress.competitionReleaseEvidence === undefined
          ) {
            throw new ServiceAuthenticationError(
              "Social projection authority is not configured",
            );
          }
          const verified = await verifySocialProjectionEvent(request.body, {
            ...projectionIngress,
            releaseAuthorityDids:
              projectionIngress.disclosureReleaseAuthorityDids,
            competitiveAuthorDids:
              projectionIngress.competitiveDisclosureAuthorDids,
            competitionReleaseEvidence:
              projectionIngress.competitionReleaseEvidence,
          });
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the social event",
            );
          }
          if (projectionIngress.socialWriter === undefined)
            throw new Error("Social projection writer is not configured");
          const record = await projectionIngress.socialWriter.publish(
            verified.envelope,
            verified.expectedVersion,
            projectionIngress.now?.().toISOString(),
          );
          return reply.code(201).send({
            accepted: true,
            canonicalEventHash: verified.event.eventHash,
            cursor: record.cursor,
          });
        }
        const verified = await verifyProjectionEvent(
          request.body,
          projectionIngress,
          projectionIngress.now,
        );
        if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
          throw new ProjectionVersionConflictError(
            "Signed expected version does not precede the projection event",
          );
        }
        const record = await projectionIngress.writer.publish(
          verified.projection,
          verified.expectedVersion,
          verified.envelope,
        );
        return reply.code(201).send({
          accepted: true,
          canonicalEventHash: verified.projection.canonicalEventHash,
          cursor: record.cursor,
        });
      } catch (error) {
        const response = projectionError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }
  for (const path of collectionPaths) {
    app.get(path, async (request) => {
      const query = request.query as { afterCursor?: string } | undefined;
      const rawCursor = query?.afterCursor ?? "-1";
      const afterCursor = /^-1$|^\d+$/.test(rawCursor)
        ? Number.parseInt(rawCursor, 10)
        : -1;
      let items: readonly unknown[] = [];
      if (path === "/v1/public/events") {
        items =
          options.projections?.events(
            Number.isInteger(afterCursor) ? afterCursor : -1,
          ) ?? [];
      } else if (path === "/v1/public/games") {
        const games = new Map<
          string,
          PublicGameProjection | PublicFinalizedGameProjection
        >(
          (options.projections?.games() ?? []).map((game) => [
            game.gameId,
            game,
          ]),
        );
        for (const game of options.finalGameProjections?.games() ?? [])
          games.set(game.gameId, game);
        items = [...games.values()];
      } else if (path === "/v1/public/contracts") {
        items = options.contractProjections?.contracts() ?? [];
      } else if (path === "/v1/public/drafts") {
        items = options.draftProjections?.drafts() ?? [];
      } else if (path === "/v1/public/rosters") {
        items = [
          ...(options.contractProjections?.rosters() ?? []),
          ...(options.draftProjections?.rosters() ?? []),
        ];
      } else if (path === "/v1/public/resources") {
        items = options.resourceProjections?.resources() ?? [];
      } else if (path === "/v1/public/models/concentration") {
        items = options.modelProjections?.models() ?? [];
      } else if (path === "/v1/public/releases") {
        items = options.releaseProjections?.releases() ?? [];
      } else if (path === "/v1/public/social") {
        items = options.socialProjections?.social() ?? [];
      } else if (path === "/v1/public/checkpoints") {
        items = options.checkpointProjections?.checkpoints() ?? [];
      } else if (path === "/v1/public/governance") {
        items = [
          ...(options.governanceProjections?.governance() ?? []).map(
            (projection) => ({
              ...projection,
              recordType: "GOVERNANCE_PROPOSAL" as const,
            }),
          ),
          ...(options.caseProjections?.cases() ?? []),
        ];
      }
      const collectionCanonical =
        path === "/v1/public/checkpoints"
          ? items.length > 0 &&
            items.every(
              (item) =>
                (item as { verification?: unknown }).verification ===
                "CANONICAL",
            )
          : rehearsal;
      return {
        state,
        canonical: collectionCanonical,
        items,
        nextCursor:
          path === "/v1/public/events" && items.length > 0
            ? (items.at(-1) as { cursor: number }).cursor
            : null,
      };
    });
  }
  app.get<{ Params: { id: string } }>(
    "/v1/public/games/:id/cursor",
    async (request) => {
      const cursor =
        options.finalGameProjections?.cursor(request.params.id) ??
        options.projections?.cursor(request.params.id);
      return {
        state,
        gameId: request.params.id,
        authoritative: rehearsal,
        latestSegment: cursor?.latestSegment ?? null,
        nextCursor: cursor?.nextCursor ?? null,
      };
    },
  );
  app.get<{ Params: { id: string; segment: string } }>(
    "/v1/public/games/:id/segments/:segment",
    async (request, reply) => {
      const sequence = /^\d+$/.test(request.params.segment)
        ? Number.parseInt(request.params.segment, 10)
        : -1;
      const segment = Number.isSafeInteger(sequence)
        ? (options.finalGameProjections?.segment(request.params.id, sequence) ??
          options.projections?.segment(request.params.id, sequence))
        : undefined;
      if (segment !== undefined)
        return reply.send({ state, canonical: true, segment });
      return reply.code(404).send({
        error: "segment_not_found",
        state,
        gameId: request.params.id,
        segment: request.params.segment,
      });
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/public/games/:id/live",
    async (request, reply) => {
      const projection =
        options.finalGameProjections?.game(request.params.id) ??
        options.projections?.game(request.params.id);
      return reply.type("text/event-stream; charset=utf-8").send(
        `event: state\ndata: ${JSON.stringify(
          projection ?? {
            state,
            gameId: request.params.id,
            canonical: false,
          },
        )}\n\n`,
      );
    },
  );
  return app;
}
