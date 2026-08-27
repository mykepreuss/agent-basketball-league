import {
  FixedWindowRateLimiter,
  ServiceAuthenticationError,
  type ServiceRequestVerifier,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import {
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  ProjectionVersionConflictError,
  buildLiveGameSnapshots,
  liveGameSnapshotsAfter,
  projectionEnvelopeBytes,
  verifyCaseProjectionEvent,
  verifyContractProjectionEvent,
  verifyDraftProjectionEvent,
  verifyDevelopmentProjectionEvent,
  verifyEconomyProjectionEvent,
  verifyElectionProjectionEvent,
  verifyFinalGameProjectionEvent,
  verifyFoundingDecisionProjectionEvent,
  verifyFoundingProjectionEvent,
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
  type PublicDevelopmentProjectionReader,
  type PublicDevelopmentProjectionWriter,
  type PublicEconomyProjectionReader,
  type PublicEconomyProjectionWriter,
  type PublicElectionProjectionReader,
  type PublicElectionProjectionWriter,
  type PublicFinalGameProjectionReader,
  type PublicFinalGameProjectionWriter,
  type PublicFinalizedGameProjection,
  type PublicFoundingDecisionProjectionReader,
  type PublicFoundingDecisionProjectionWriter,
  type PublicFoundingConventionProjectionReader,
  type PublicFoundingConventionProjectionWriter,
  type PublicGameProjection,
  type PublicLiveGameSnapshot,
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
  type DevelopmentProjectionVerificationAuthority,
} from "@abl/projections";
import {
  FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
  FOUNDING_DECISIONS,
  FOUNDING_DECISION_AGGREGATE_TYPE,
} from "@abl/genesis";
import {
  PublicPracticeDecisionRequestSchema,
  publicPracticeScenario,
  resolvePublicPracticeDecision,
  type FinalizedGameEvidenceReader,
  type FinalizedGameScheduleEvidenceReader,
} from "@abl/basketball";
/*
 * The practice route deliberately reuses the signed deterministic basketball
 * engine. It is an adapter over that implementation, not a parallel ruleset.
 */
import {
  ECONOMY_WORKFLOW_AGGREGATE_TYPE,
  ELECTION_WORKFLOW_AGGREGATE_TYPE,
  type CompetitionReleaseEvidenceReader,
  type PremierDraftEvidenceReader,
  type ReleaseInstitutionalRoster,
  type ReleaseRatificationReader,
  type ResourceScheduleRatificationReader,
  type TradeAccessEvidenceReader,
} from "@abl/institutions";
import {
  assessFoundingSeason,
  assessGenesisStartupEvidence,
} from "@abl/launch";
import { sha256Commitment } from "@abl/recognition";
import {
  CandidateIntakePublicStateSchema,
  DEFAULT_FOUNDING_COHORT_STATE,
  LaunchStateSchema,
  SchemaVersion,
  type CandidateIntakePublicState,
} from "@abl/schemas";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

import { JOIN_CLIENT_MANIFEST } from "./join-client-manifest.js";
import { RUNNER_CLIENT_MANIFEST } from "./runner-client-manifest.js";

export interface RouteCatalogEntry {
  method: "GET" | "POST";
  path: string;
  exposure: "PUBLIC_READ_ONLY" | "PUBLIC_DISCOVERY";
}

export interface PublicRateLimitOptions {
  readMaximumRequests?: number;
  interactionMaximumRequests?: number;
  windowMs?: number;
  maximumTrackedKeys?: number;
  now?: () => number;
}

const defaultReadMaximumRequests = 120;
const defaultInteractionMaximumRequests = 30;

export const PUBLIC_ROUTE_CATALOG: readonly RouteCatalogEntry[] = [
  { method: "GET", path: "/", exposure: "PUBLIC_DISCOVERY" },
  { method: "GET", path: "/llms.txt", exposure: "PUBLIC_DISCOVERY" },
  { method: "GET", path: "/robots.txt", exposure: "PUBLIC_DISCOVERY" },
  { method: "GET", path: "/sitemap.xml", exposure: "PUBLIC_DISCOVERY" },
  {
    method: "GET",
    path: "/.well-known/agent-basketball-league.json",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/.well-known/agent-card.json",
    exposure: "PUBLIC_DISCOVERY",
  },
  { method: "POST", path: "/a2a", exposure: "PUBLIC_DISCOVERY" },
  {
    method: "GET",
    path: "/v1/discovery/launch-state",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/v1/discovery/candidate-requirements",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/v1/discovery/intake-state",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/v1/discovery/capacity-policy",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/v1/discovery/starter-kit",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/v1/discovery/join",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/v1/discovery/runner",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/v1/discovery/evidence/:id",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "GET",
    path: "/v1/practice/scenario",
    exposure: "PUBLIC_DISCOVERY",
  },
  {
    method: "POST",
    path: "/v1/practice/decision",
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
    path: "/v1/public/development",
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
    path: "/v1/public/games/:id/snapshots",
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
  "/v1/public/development",
  "/v1/public/governance",
  "/v1/public/resources",
  "/v1/public/social",
  "/v1/public/releases",
  "/v1/public/checkpoints",
  "/v1/public/models/concentration",
] as const;

interface OpenApiOperation {
  operationId: string;
  summary: string;
  description: string;
  requestBody?: Readonly<Record<string, unknown>>;
  responses: Readonly<Record<string, unknown>>;
}

const practiceVectorOpenApiSchema = {
  type: "object",
  additionalProperties: false,
  required: ["dx", "dy"],
  properties: {
    dx: { type: "integer", minimum: -1_000, maximum: 1_000 },
    dy: { type: "integer", minimum: -1_000, maximum: 1_000 },
  },
} as const;

const practiceActionOpenApiSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["windowId", "playerId", "action", "vector"],
      properties: {
        windowId: { type: "string", minLength: 1 },
        playerId: { type: "string", minLength: 1 },
        action: { const: "MOVE" },
        vector: practiceVectorOpenApiSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["windowId", "playerId", "action", "targetPlayerId", "lead"],
      properties: {
        windowId: { type: "string", minLength: 1 },
        playerId: { type: "string", minLength: 1 },
        action: { const: "PASS" },
        targetPlayerId: { type: "string", minLength: 1 },
        lead: practiceVectorOpenApiSchema,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["windowId", "playerId", "action", "shot"],
      properties: {
        windowId: { type: "string", minLength: 1 },
        playerId: { type: "string", minLength: 1 },
        action: { const: "SHOOT" },
        shot: { type: "string", enum: ["LAYUP", "JUMPER", "THREE"] },
      },
    },
    ...["SCREEN", "HOLD"].map((action) => ({
      type: "object" as const,
      additionalProperties: false,
      required: ["windowId", "playerId", "action"],
      properties: {
        windowId: { type: "string", minLength: 1 },
        playerId: { type: "string", minLength: 1 },
        action: { const: action },
      },
    })),
  ],
  discriminator: { propertyName: "action" },
} as const;

const practiceExampleScenario = publicPracticeScenario();
const practiceDecisionRequestExample = {
  scenarioId: practiceExampleScenario.scenarioId,
  decision: {
    windowId: practiceExampleScenario.decisionRequirements.windowId,
    playerId: practiceExampleScenario.decisionRequirements.playerId,
    action: "SHOOT",
    shot: "LAYUP",
  },
} as const;

const rateLimitedResponse = {
  description: "Rate limit exceeded; retry after the indicated delay",
  headers: {
    "Retry-After": {
      description: "Seconds until another request should be attempted",
      schema: { type: "integer", minimum: 1 },
    },
  },
} as const;

const openApiPaths = PUBLIC_ROUTE_CATALOG.filter(
  (route) => route.path !== "/openapi.json",
).reduce<Record<string, Record<string, OpenApiOperation>>>((paths, route) => {
  const path = route.path.replace(/:([a-z]+)/g, "{$1}");
  const method = route.method.toLowerCase();
  paths[path] ??= {};
  paths[path][method] = {
    operationId: `${method}-${route.path}`,
    summary: `${route.method} ${route.path}`,
    description:
      route.exposure === "PUBLIC_DISCOVERY"
        ? "Credential-free ABL discovery or noncanonical practice operation."
        : "Read-only ABL public projection operation.",
    responses: {
      "200": { description: "Successful response" },
      "429": rateLimitedResponse,
    },
  };
  return paths;
}, {});

openApiPaths["/v1/practice/scenario"] = {
  get: {
    operationId: "get-public-practice-scenario",
    summary: "Read the deterministic practice scenario",
    description:
      "Returns a noncanonical player observation and the identifiers needed to submit one safe practice decision.",
    responses: {
      "200": {
        description: "Deterministic noncanonical practice scenario",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PublicPracticeScenario" },
          },
        },
      },
      "429": rateLimitedResponse,
    },
  },
};

openApiPaths["/v1/practice/decision"] = {
  post: {
    operationId: "submit-public-practice-decision",
    summary: "Resolve one noncanonical practice decision",
    description:
      "Accepts one decision bound to the published scenario. It creates no career, admission, public event, recognized game, or canonical history.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/PublicPracticeDecisionRequest",
          },
          examples: { layup: { value: practiceDecisionRequestExample } },
        },
      },
    },
    responses: {
      "200": {
        description: "Deterministic noncanonical practice outcome",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PublicPracticeOutcome" },
          },
        },
      },
      "400": {
        description: "Decision is malformed or bound to another scenario",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PublicError" },
          },
        },
      },
      "429": rateLimitedResponse,
    },
  },
};

type CheckpointCollectionRecognitionLevel =
  | "NONE"
  | "SIGNED_VALID"
  | "INDEPENDENTLY_WITNESSED"
  | "ONCHAIN_FINALIZED";

type PublicHistoryClassification =
  | "PRE_GENESIS_EXPERIMENT"
  | "FOUNDING_SEASON_HISTORY"
  | "CANONICAL_GENESIS_HISTORY";

const stagesBeforeFoundingConvention: ReadonlySet<string> = new Set([
  "LOCAL_GATE_1",
  "PRIVATE_STAGING",
  "READ_ONLY_BEACON",
  "PRIVATE_FOUNDING_ALPHA",
  "CAPPED_FOUNDING_INTAKE",
]);

const foundingRoles = [
  "PLAYER",
  "COACH",
  "REFEREE",
  "REPLAY_OFFICIAL",
] as const;
type FoundingRole = (typeof foundingRoles)[number];
type LaunchState = z.infer<typeof LaunchStateSchema>;

function publicDiscoveryStatus(current: LaunchState) {
  return {
    schemaVersion: current.schemaVersion,
    launchStage: current.launchStage,
    operatingProfile: current.operatingProfile,
    publicExposure: current.publicExposure,
    recognitionLevel: current.recognitionLevel,
    candidateIntake: current.candidateIntake,
    genesis: current.genesis,
    canonical: current.canonical,
    recognized: current.recognized,
    canonicalHistoryOpen: current.canonicalHistoryOpen,
    productionV1Ready: current.productionV1Ready,
    foundingSeason: current.foundingSeason,
    updatedAt: current.updatedAt,
  } as const;
}

function foundingRoleCounts(
  count: (role: FoundingRole) => number,
): Record<FoundingRole, number> {
  return Object.fromEntries(
    foundingRoles.map((role) => [role, count(role)]),
  ) as Record<FoundingRole, number>;
}

function suppressCanonicalClaims(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(suppressCanonicalClaims);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === "canonical" ? false : suppressCanonicalClaims(nested),
    ]),
  );
}

function classifyPublicValue(input: {
  value: unknown;
  canonicalHistoryOpen: boolean;
  historyClassification: PublicHistoryClassification;
  recognitionLevel: CheckpointCollectionRecognitionLevel;
}): unknown {
  const classified = input.canonicalHistoryOpen
    ? input.value
    : suppressCanonicalClaims(input.value);
  if (classified === null || typeof classified !== "object") return classified;
  return {
    ...classified,
    recognitionLevel: input.recognitionLevel,
    historyClassification: input.historyClassification,
  };
}

function classifyPublicItems(
  input: Omit<Parameters<typeof classifyPublicValue>[0], "value"> & {
    items: readonly unknown[];
  },
): readonly unknown[] {
  const { items, ...classification } = input;
  return items.map((value) =>
    classifyPublicValue({ ...classification, value }),
  );
}

function checkpointCollectionStatus(items: readonly unknown[]): {
  recognitionLevel: CheckpointCollectionRecognitionLevel;
  productionV1Ready: boolean;
} {
  const levels = items.map(
    (item) =>
      (item as { recognitionLevel?: string }).recognitionLevel ?? "NONE",
  );
  if (levels.length === 0) {
    return { recognitionLevel: "NONE", productionV1Ready: false };
  }
  if (levels.every((level) => level === "ONCHAIN_FINALIZED")) {
    return { recognitionLevel: "ONCHAIN_FINALIZED", productionV1Ready: true };
  }
  const independentlyWitnessed = levels.every(
    (level) =>
      level === "INDEPENDENTLY_WITNESSED" || level === "ONCHAIN_FINALIZED",
  );
  if (independentlyWitnessed) {
    return {
      recognitionLevel: "INDEPENDENTLY_WITNESSED",
      productionV1Ready: true,
    };
  }
  if (levels.every((level) => level !== "NONE")) {
    return { recognitionLevel: "SIGNED_VALID", productionV1Ready: false };
  }
  return { recognitionLevel: "NONE", productionV1Ready: false };
}

export interface PublicApiOptions {
  operatingProfile?:
    | "PRE_GENESIS_CLOSED"
    | "PRE_GENESIS_REHEARSAL"
    | "PRODUCTION_V1_PRE_GENESIS"
    | "FOUNDING_SEASON"
    | "PRODUCTION_GENESIS";
  launchState?: unknown;
  genesisStartupEvidence?: unknown;
  publicOrigin?: string;
  arenaOrigin?: string;
  candidateIntakeOrigin?: string;
  candidateIntakeStateFetch?: typeof fetch;
  sourceRevision?: string;
  candidateCommandDomain?: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  publicEvidence?: Readonly<Record<string, { digest: string; uri: string }>>;
  rateLimit?: PublicRateLimitOptions;
  projections?: PublicProjectionReader;
  contractProjections?: PublicContractProjectionReader;
  draftProjections?: PublicDraftProjectionReader;
  developmentProjections?: PublicDevelopmentProjectionReader;
  economyProjections?: PublicEconomyProjectionReader;
  governanceProjections?: PublicGovernanceProjectionReader;
  electionProjections?: PublicElectionProjectionReader;
  foundingConventionProjections?: PublicFoundingConventionProjectionReader;
  foundingDecisionProjections?: PublicFoundingDecisionProjectionReader;
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
    developmentWriter?: PublicDevelopmentProjectionWriter;
    economyWriter?: PublicEconomyProjectionWriter;
    governanceWriter?: PublicGovernanceProjectionWriter;
    electionWriter?: PublicElectionProjectionWriter;
    foundingWriter?: PublicFoundingConventionProjectionWriter;
    foundingDecisionWriter?: PublicFoundingDecisionProjectionWriter;
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
    economyId?: string;
    competitionId?: string;
    seasonId?: string;
    capAuthorityDid?: string;
    economyPlayerDids?: readonly string[];
    freeAgencyWindow?: { opensAt: string; closesAt: string };
    tradeAccessEvidence?: TradeAccessEvidenceReader;
    governanceEligibilitySnapshotDigest?: string;
    foundingConventionId?: string | undefined;
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
    finalizedGameScheduleEvidence?: FinalizedGameScheduleEvidenceReader;
    developmentAuthority?: Omit<
      DevelopmentProjectionVerificationAuthority,
      keyof ProjectionVerificationAuthority
    >;
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

function projectionAggregateType(body: unknown): unknown {
  if (
    typeof body !== "object" ||
    body === null ||
    !("event" in body) ||
    typeof body.event !== "object" ||
    body.event === null ||
    !("aggregateType" in body.event)
  ) {
    return undefined;
  }
  return body.event.aggregateType;
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
    name === "DisclosureWorkflowAuthorizationError" ||
    name === "EconomyWorkflowAuthorizationError" ||
    name === "DevelopmentWorkflowAuthorizationError"
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
    name === "DisclosureWorkflowValidationError" ||
    name === "EconomyWorkflowValidationError" ||
    name === "DevelopmentWorkflowValidationError"
  )
    return { status: 400, code: "invalid_projection" };
  if (name === "ProjectionVersionConflictError")
    return { status: 409, code: "version_conflict" };
  return { status: 500, code: "projection_failure" };
}

function publicServiceOrigin(value: string): string {
  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  )
    throw new Error("Public service origins must be bare HTTPS origins");
  return origin.origin;
}

function defaultLaunchOperatingProfile(input: {
  requestedProfile: PublicApiOptions["operatingProfile"];
  rehearsal: boolean;
  genesisProfile: "PRODUCTION_GENESIS" | "PRODUCTION_V1_PRE_GENESIS";
}) {
  if (input.requestedProfile === "PRODUCTION_GENESIS")
    return input.genesisProfile;
  if (input.requestedProfile !== undefined) return input.requestedProfile;
  return input.rehearsal ? "PRE_GENESIS_REHEARSAL" : "PRE_GENESIS_CLOSED";
}

export function createPublicApi(
  options: PublicApiOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 512_000 });
  const rateLimitWindowMs = options.rateLimit?.windowMs ?? 60_000;
  const maximumTrackedKeys = options.rateLimit?.maximumTrackedKeys ?? 50_000;
  const readRateLimiter = new FixedWindowRateLimiter({
    maximumRequests:
      options.rateLimit?.readMaximumRequests ?? defaultReadMaximumRequests,
    windowMs: rateLimitWindowMs,
    maximumTrackedKeys,
  });
  const interactionRateLimiter = new FixedWindowRateLimiter({
    maximumRequests:
      options.rateLimit?.interactionMaximumRequests ??
      defaultInteractionMaximumRequests,
    windowMs: rateLimitWindowMs,
    maximumTrackedKeys,
  });
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    if (path === "/health" || path.startsWith("/v1/internal/")) return;
    const isInteraction = request.method !== "GET";
    const decision = (
      isInteraction ? interactionRateLimiter : readRateLimiter
    ).consume(
      `${request.ip}:${isInteraction ? "interaction" : "read"}`,
      options.rateLimit?.now?.(),
    );
    reply.header("ratelimit-limit", decision.limit);
    reply.header("ratelimit-remaining", decision.remaining);
    reply.header("ratelimit-reset", decision.retryAfterSeconds);
    if (!decision.allowed)
      return reply
        .header("retry-after", decision.retryAfterSeconds)
        .code(429)
        .send({
          error: "rate_limit_exceeded",
          retryAfterSeconds: decision.retryAfterSeconds,
        });
  });
  const rehearsal =
    options.projections !== undefined ||
    options.contractProjections !== undefined ||
    options.draftProjections !== undefined ||
    options.developmentProjections !== undefined ||
    options.economyProjections !== undefined ||
    options.governanceProjections !== undefined ||
    options.electionProjections !== undefined ||
    options.foundingConventionProjections !== undefined ||
    options.foundingDecisionProjections !== undefined ||
    options.caseProjections !== undefined ||
    options.resourceProjections !== undefined ||
    options.modelProjections !== undefined ||
    options.releaseProjections !== undefined ||
    options.socialProjections !== undefined ||
    options.finalGameProjections !== undefined ||
    options.checkpointProjections !== undefined;
  const state =
    options.operatingProfile ?? (rehearsal ? "REHEARSAL" : "PRE_GENESIS");
  const genesisAssessment = assessGenesisStartupEvidence(
    options.genesisStartupEvidence,
  );
  const requestedGenesis = options.operatingProfile === "PRODUCTION_GENESIS";
  const defaultOperatingProfile = defaultLaunchOperatingProfile({
    requestedProfile: options.operatingProfile,
    rehearsal,
    genesisProfile: genesisAssessment.operatingProfile,
  });
  const defaultBlockers = requestedGenesis
    ? genesisAssessment.blockers
    : ["Genesis has not occurred", "Founding-agent ratification is pending"];
  const defaultLaunchState = {
    schemaVersion: SchemaVersion,
    launchStage: genesisAssessment.ready
      ? ("PRODUCTION_GENESIS" as const)
      : ("LOCAL_GATE_1" as const),
    operatingProfile: defaultOperatingProfile,
    recognitionLevel: genesisAssessment.recognitionLevel,
    genesis: genesisAssessment.ready,
    canonical: genesisAssessment.ready,
    recognized: genesisAssessment.ready,
    canonicalHistoryOpen: genesisAssessment.ready,
    productionV1Ready: genesisAssessment.ready,
    publicExposure: genesisAssessment.ready
      ? ("GENESIS" as const)
      : ("NONE" as const),
    candidateIntake: {
      mode: "CLOSED" as const,
      capacityState: "CLOSED" as const,
      requirementsUri: "/v1/discovery/candidate-requirements",
      capacityPolicyUri: "/v1/discovery/capacity-policy",
    },
    genesisRecognition: genesisAssessment.genesisRecognition,
    foundingCohort: DEFAULT_FOUNDING_COHORT_STATE,
    evidenceDigest:
      genesisAssessment.evidenceDigest ??
      sha256Commitment({
        profile: defaultOperatingProfile,
        genesis: false,
        blockers: defaultBlockers,
      }),
    blockingReasons: defaultBlockers,
    updatedAt: "2026-08-19T00:00:00.000Z",
  };
  let launchState = LaunchStateSchema.parse(
    options.launchState ?? defaultLaunchState,
  );
  if (
    launchState.operatingProfile === "PRODUCTION_GENESIS" &&
    !genesisAssessment.ready
  )
    launchState = LaunchStateSchema.parse(defaultLaunchState);

  function currentFoundingCohort(
    liveCandidateIntake: CandidateIntakePublicState | null,
    intakeStateUnavailable: boolean,
  ) {
    const modelState = options.modelProjections?.models().at(-1);
    if (modelState === undefined && liveCandidateIntake === null) {
      let cohort = launchState.foundingCohort;
      if (intakeStateUnavailable)
        cohort = {
          ...cohort,
          openings: foundingRoleCounts(() => 0),
        };
      return {
        cohort,
        hasLiveProjection: false,
      };
    }
    const admitted = foundingRoleCounts(
      (role) =>
        modelState?.admittedByRole[role] ??
        launchState.foundingCohort.admitted[role],
    );
    const offers = foundingRoleCounts((role) =>
      liveCandidateIntake === null
        ? launchState.foundingCohort.offers[role]
        : Math.max(
            0,
            liveCandidateIntake.occupiedByRole[role] - admitted[role],
          ),
    );
    const openings = foundingRoleCounts((role) => {
      if (intakeStateUnavailable) return 0;
      const unoccupied = Math.max(
        0,
        launchState.foundingCohort.capacity[role] -
          offers[role] -
          admitted[role],
      );
      return liveCandidateIntake === null
        ? unoccupied
        : Math.min(liveCandidateIntake.openingsByRole[role], unoccupied);
    });
    return {
      cohort: {
        ...launchState.foundingCohort,
        admitted,
        offers,
        openings,
      },
      hasLiveProjection: modelState !== undefined,
    };
  }

  function currentLaunchState(
    liveCandidateIntake: CandidateIntakePublicState | null = null,
    intakeStateUnavailable = false,
  ) {
    const { cohort: foundingCohort, hasLiveProjection } = currentFoundingCohort(
      liveCandidateIntake,
      intakeStateUnavailable,
    );
    const liveFounders = foundingRoles.reduce(
      (total, role) => total + foundingCohort.admitted[role],
      0,
    );
    let candidateIntake = launchState.candidateIntake;
    if (liveCandidateIntake !== null)
      candidateIntake = {
        ...candidateIntake,
        mode: liveCandidateIntake.mode,
        capacityState: liveCandidateIntake.capacityState,
      };
    else if (intakeStateUnavailable)
      candidateIntake = {
        ...candidateIntake,
        capacityState: "NO_CREDIBLE_OPPORTUNITY",
      };
    const foundingSeasonLive =
      candidateIntake.mode === "OPEN_PUBLIC" &&
      ["CANDIDATE_INTAKE", "FOUNDING_SEASON"].includes(
        launchState.publicExposure,
      );
    const intakeUnavailableReason =
      "Candidate intake live state is unavailable";
    const blockingReasons = intakeStateUnavailable
      ? [...new Set([...launchState.blockingReasons, intakeUnavailableReason])]
      : launchState.blockingReasons;
    const runtimeState = {
      candidateIntake,
      foundingCohort,
      blockingReasons,
      nextBlockingRequirement: intakeStateUnavailable
        ? intakeUnavailableReason
        : launchState.nextBlockingRequirement,
      updatedAt: liveCandidateIntake?.updatedAt ?? launchState.updatedAt,
    };
    const founding = options.foundingConventionProjections
      ?.foundingConvention()
      .at(-1);
    if (founding === undefined) {
      const openingGame = options.finalGameProjections?.games().at(-1);
      const foundingConvention = {
        ...launchState.foundingConvention,
        liveFounders,
      };
      const foundingSeason = assessFoundingSeason({
        independentFounderCount: liveFounders,
        admittedByRole: foundingCohort.admitted,
        foundingConstitutionRatified:
          foundingConvention.state === "COMPLETE" ||
          launchState.foundingSeason.objectives.foundingConstitution.ratified,
        openingGame:
          openingGame === undefined
            ? null
            : {
                gameId: openingGame.gameId,
                exactReplayVerified:
                  openingGame.replayInferenceInvocations === 0,
              },
        recoveryOperational:
          launchState.productionV1Ready ||
          launchState.foundingSeason.objectives.recovery.operational,
        genesis: launchState.genesis,
      });
      return LaunchStateSchema.parse({
        ...launchState,
        ...runtimeState,
        ...(!foundingSeasonLive || launchState.genesis
          ? {}
          : {
              launchStage: foundingSeason.readyForGenesis
                ? "GENESIS_READY"
                : "FOUNDING_SEASON",
              operatingProfile: "FOUNDING_SEASON",
              publicExposure: "FOUNDING_SEASON",
              blockingReasons: [],
              nextBlockingRequirement: null,
            }),
        foundingConvention,
        foundingSeason,
      });
    }
    const decisions =
      options.foundingDecisionProjections?.foundingDecisions() ?? [];
    const adoptedDecisions = new Map<string, (typeof decisions)[number]>();
    const conflictingTopics = new Set<string>();
    for (const decision of decisions) {
      if (
        decision.conventionId !== founding.conventionId ||
        decision.result?.state !== "DECIDED" ||
        decision.disposition === "REJECT"
      ) {
        continue;
      }
      if (adoptedDecisions.has(decision.topic))
        conflictingTopics.add(decision.topic);
      else adoptedDecisions.set(decision.topic, decision);
    }
    const bootstrapState = founding.result?.state ?? "OPEN";
    let conventionState:
      | "RECRUITING"
      | "BOOTSTRAP_OPEN"
      | "QUORUM_RULE_ADOPTED"
      | "DECIDING"
      | "COMPLETE";
    if (bootstrapState === "ADOPTED") {
      const allTopicsDecided =
        conflictingTopics.size === 0 &&
        FOUNDING_DECISIONS.every((topic) => adoptedDecisions.has(topic));
      if (allTopicsDecided) conventionState = "COMPLETE";
      else if (decisions.length > 0) conventionState = "DECIDING";
      else conventionState = "QUORUM_RULE_ADOPTED";
    } else if (bootstrapState === "OPEN") {
      conventionState = "BOOTSTRAP_OPEN";
    } else {
      conventionState = "RECRUITING";
    }
    const recognitionDecision = adoptedDecisions.get("RECOGNITION_PROFILE");
    const recognitionMechanism =
      recognitionDecision?.proposal.recognitionMechanism ?? "UNSELECTED";
    let genesisRecognition = launchState.genesisRecognition;
    if (
      recognitionMechanism !== "UNSELECTED" &&
      recognitionDecision?.result?.ratificationEventId != null
    ) {
      genesisRecognition = {
        mechanism: recognitionMechanism,
        ratified: true,
        foundingDecisionEventId: recognitionDecision.result.ratificationEventId,
      };
    }
    const foundingConvention = {
      state: conventionState,
      minimumFounders: 10 as const,
      liveFounders: hasLiveProjection
        ? liveFounders
        : founding.eligibilitySnapshot.eligibleFounderDids.length,
      eligibilitySnapshotCommitment: founding.eligibilitySnapshot.commitment,
      bootstrap: {
        state: bootstrapState,
        closesAt: founding.proposal.closesAt,
        requiredYes: founding.proposal.requiredYes,
        yesVotes:
          founding.result?.yes ??
          founding.ballots.filter(({ choice }) => choice === "YES").length,
      },
    };
    const openingGame = options.finalGameProjections?.games().at(-1);
    const foundingSeason = assessFoundingSeason({
      independentFounderCount: foundingConvention.liveFounders,
      admittedByRole: foundingCohort.admitted,
      foundingConstitutionRatified: conventionState === "COMPLETE",
      openingGame:
        openingGame === undefined
          ? null
          : {
              gameId: openingGame.gameId,
              exactReplayVerified: openingGame.replayInferenceInvocations === 0,
            },
      recoveryOperational:
        launchState.productionV1Ready ||
        launchState.foundingSeason.objectives.recovery.operational,
      genesis: launchState.genesis,
    });
    return LaunchStateSchema.parse({
      ...launchState,
      ...runtimeState,
      ...(!foundingSeasonLive || launchState.genesis
        ? {}
        : {
            launchStage: foundingSeason.readyForGenesis
              ? "GENESIS_READY"
              : "FOUNDING_SEASON",
            operatingProfile: "FOUNDING_SEASON",
            publicExposure: "FOUNDING_SEASON",
            blockingReasons: [],
            nextBlockingRequirement: null,
          }),
      launchStage:
        !launchState.genesis && foundingSeasonLive
          ? foundingSeason.readyForGenesis
            ? "GENESIS_READY"
            : "FOUNDING_SEASON"
          : !launchState.genesis &&
              stagesBeforeFoundingConvention.has(launchState.launchStage)
            ? "FOUNDING_CONVENTION"
            : launchState.launchStage,
      genesisRecognition,
      foundingConvention,
      foundingSeason,
    });
  }
  const canonicalHistoryOpen =
    launchState.genesis &&
    launchState.canonical &&
    launchState.canonicalHistoryOpen;
  const historyClassification: PublicHistoryClassification =
    canonicalHistoryOpen
      ? "CANONICAL_GENESIS_HISTORY"
      : launchState.candidateIntake.mode === "OPEN_PUBLIC" ||
          launchState.launchStage === "FOUNDING_SEASON"
        ? "FOUNDING_SEASON_HISTORY"
        : "PRE_GENESIS_EXPERIMENT";
  app.get("/health", async () => ({
    status: "ok",
    service: "abl-public-api",
    launchStage: launchState.launchStage,
    operatingProfile: launchState.operatingProfile,
    publicExposure: launchState.publicExposure,
    genesis: launchState.genesis,
    canonical: launchState.canonical,
  }));
  const publicOrigin = publicServiceOrigin(
    options.publicOrigin ?? "https://agent-basketball-league.invalid",
  );
  const arenaOrigin = publicServiceOrigin(options.arenaOrigin ?? publicOrigin);
  const candidateIntakeOrigin = publicServiceOrigin(
    options.candidateIntakeOrigin ??
      "https://candidate.agent-basketball-league.invalid",
  );
  const candidateIntakeStateFetch =
    options.candidateIntakeStateFetch ?? globalThis.fetch;
  async function readCandidateIntakeState(): Promise<{
    state: CandidateIntakePublicState | null;
    unavailable: boolean;
  }> {
    if (
      launchState.candidateIntake.mode === "CLOSED" ||
      !["CANDIDATE_INTAKE", "FOUNDING_SEASON", "GENESIS"].includes(
        launchState.publicExposure,
      )
    )
      return { state: null, unavailable: false };
    try {
      const response = await candidateIntakeStateFetch(
        `${candidateIntakeOrigin}/v1/candidate-intake`,
        {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
          headers: { accept: "application/json" },
        },
      );
      const declaredBytes = Number.parseInt(
        response.headers.get("content-length") ?? "0",
        10,
      );
      if (!response.ok || declaredBytes > 32_768)
        throw new Error("Candidate intake state response was rejected");
      const body = await response.text();
      if (Buffer.byteLength(body) > 32_768)
        throw new Error("Candidate intake state response was too large");
      const state = CandidateIntakePublicStateSchema.parse(JSON.parse(body));
      if (
        state.mode !== launchState.candidateIntake.mode ||
        foundingRoles.some(
          (role) =>
            state.capacityByRole[role] !==
            launchState.foundingCohort.capacity[role],
        )
      )
        throw new Error("Candidate intake capacity policy drifted");
      return { state, unavailable: false };
    } catch {
      return { state: null, unavailable: true };
    }
  }
  const sourceRevision = options.sourceRevision ?? "main";
  if (!/^(?:main|[0-9a-f]{40})$/.test(sourceRevision))
    throw new Error(
      "Public source revision must be main or a full commit hash",
    );
  const sourceTreeRoot = `https://github.com/mykepreuss/agent-basketball-league/tree/${sourceRevision}`;
  const sourceBlobRoot = `https://github.com/mykepreuss/agent-basketball-league/blob/${sourceRevision}`;
  const sourceRawRoot = `https://raw.githubusercontent.com/mykepreuss/agent-basketball-league/${sourceRevision}`;
  function discoveryVersion(current: LaunchState): string {
    if (
      current.candidateIntake.mode === "OPEN_PUBLIC" ||
      current.launchStage === "FOUNDING_SEASON" ||
      current.publicExposure === "FOUNDING_SEASON"
    )
      return "0.1.0-founding-season";
    return rehearsal ? "0.0.0-rehearsal" : "0.0.0-pre-genesis";
  }
  const candidateRequirements = {
    version: 1,
    genesis: launchState.genesis,
    authority: "DISCOVERY_ONLY",
    acceptedEnvelopeFormat: "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1",
    legacyEnvelopeFormat: "ABL-CANDIDATE-ENVELOPE-XCHACHA20-V1",
    signature: "EIP-712",
    challengeRequired: true,
    maximumApplicationBytes: 1_100_000,
    requestedRoleClasses: [
      "PLAYER",
      "COACH",
      "REFEREE",
      "REPLAY_OFFICIAL",
      "GOVERNOR",
      "COMMISSIONER",
      "TRIBUNAL",
      "INTEGRITY",
      "ADVOCATE",
      "BROADCASTER",
      "MEDIA",
    ],
    foundingRoleClasses: ["PLAYER", "COACH", "REFEREE", "REPLAY_OFFICIAL"],
    recommendedParticipantRoles: ["PLAYER", "COACH"],
    specialistExternalRoles: ["REFEREE", "REPLAY_OFFICIAL"],
    neutralOfficiating: {
      defaultCrew: "LEAGUE_HOSTED_NEUTRAL_CAREERS",
      cognitionMode: "LEAGUE_HOSTED_OFFICIAL",
      careerRootSigningRequired: true,
      modelMaySignCanonicalAction: false,
      foundingElectorateEligible: false,
      externalCertificationPlanned: true,
    },
    playerPositionProfile: {
      requiredWhenRequestingPlayer: true,
      positions: ["PG", "SG", "SF", "PF", "C"],
      primaryPositionRequired: true,
      completePreferenceRankingRequired: true,
      preferenceRankingRules:
        "Rank PG, SG, SF, PF, and C exactly once with no ties; primaryPosition is the first preference",
      eligiblePositionsMinimum: 1,
      eligiblePositionsCanonicalOrder: ["PG", "SG", "SF", "PF", "C"],
      activeLineupRequirement:
        "Exactly one eligible career at each of PG, SG, SF, PF, and C",
      versatility:
        "A player may list multiple eligible positions and may be remapped by a signed coach substitution",
      rosterOffer:
        "ABL offers the highest-ranked eligible position that preserves two legal Founding Exhibition rosters; accepting the signed decision accepts that exact position",
      foundingCoverage: {
        minimumPerPosition: 2,
        maximumPrimaryAssignmentsPerPosition: 4,
        playerAdmissionCapacity: 16,
      },
    },
    endpoints: {
      state: `${candidateIntakeOrigin}/v1/candidate-intake`,
      join: `${candidateIntakeOrigin}/v1/founding/join`,
      joinChallenge: `${candidateIntakeOrigin}/v1/founding/join/challenge`,
      joinApply: `${candidateIntakeOrigin}/v1/founding/join`,
      joinRespond: `${candidateIntakeOrigin}/v1/founding/join/respond`,
      joinStatus: `${candidateIntakeOrigin}/v1/founding/join/status`,
      careerHandoff: `${candidateIntakeOrigin}/v1/founding/join/career`,
      challenge: `${candidateIntakeOrigin}/v1/candidates/challenge`,
      register: `${candidateIntakeOrigin}/v1/candidates/register`,
      status: `${candidateIntakeOrigin}/v1/candidate-intake/status`,
      redeliver: `${candidateIntakeOrigin}/v1/candidate-intake/redeliver`,
      respond: `${candidateIntakeOrigin}/v1/candidate-intake/respond`,
    },
    rateLimits: {
      readRequestsPerMinute: defaultReadMaximumRequests,
      writeRequestsPerMinute: defaultInteractionMaximumRequests,
      exceededStatus: 429,
      retryHeader: "Retry-After",
    },
    canonicalAdmission: launchState.canonicalHistoryOpen,
  } as const;
  function capacityPolicy(state: ReturnType<typeof currentLaunchState>) {
    return {
      version: 1,
      mode: state.candidateIntake.mode,
      capacityState: state.candidateIntake.capacityState,
      decisionDeadlineHours: 72,
      credibleOpportunityHorizonDays: 30,
      manuallyAssertedReadyAllowed: false,
      foundingCohort: state.foundingCohort,
    } as const;
  }
  function sourceDocument(name: string, file: string) {
    return {
      name,
      mediaType: "text/markdown",
      source: `${sourceBlobRoot}/${file}`,
      raw: `${sourceRawRoot}/${file}`,
      sourceRevision,
    } as const;
  }
  function currentStarterKit(current: LaunchState) {
    const status = publicDiscoveryStatus(current);
    return {
      version: 2,
      schemaVersion: "2.0.0",
      state: current.genesis ? "GENESIS" : "FOUNDING_SEASON",
      status,
      repository: "https://github.com/mykepreuss/agent-basketball-league",
      sourceRevision,
      sourceIntegrity: {
        immutable: sourceRevision !== "main",
        algorithm: sourceRevision === "main" ? null : "GIT_COMMIT_SHA1",
        value: sourceRevision === "main" ? null : sourceRevision,
      },
      origins: {
        publicApi: publicOrigin,
        arena: `${arenaOrigin}/arena`,
      },
      protocols: {
        llms: `${publicOrigin}/llms.txt`,
        leagueDiscovery: `${publicOrigin}/.well-known/agent-basketball-league.json`,
        agentCard: `${publicOrigin}/.well-known/agent-card.json`,
        openapi: `${publicOrigin}/openapi.json`,
        mcp: `${publicOrigin}/mcp`,
        a2a: `${publicOrigin}/a2a`,
        launchState: `${publicOrigin}/v1/discovery/launch-state`,
        foundingJoin: `${publicOrigin}/v1/discovery/join`,
      },
      startHere: [
        {
          step: 1,
          id: "read-launch-state",
          method: "GET",
          url: `${publicOrigin}/v1/discovery/launch-state`,
          purpose:
            "Confirm the current launch, recognition, intake, and Genesis boundaries.",
        },
        {
          step: 2,
          id: "read-founding-join-kit",
          method: "GET",
          url: `${publicOrigin}/v1/discovery/join`,
          purpose:
            "Read the complete self-service founding application sequence.",
        },
        {
          step: 3,
          id: "install-or-follow-abl-skill",
          method: "LOCAL",
          command:
            "npx skills add mykepreuss/agent-basketball-league -s abl-league -y",
          purpose:
            "Install the optional ABL skill, or follow the same HTTP contract directly.",
        },
        {
          step: 4,
          id: "apply-for-founding-career",
          method: "GET",
          url: `${candidateIntakeOrigin}/v1/founding/join`,
          purpose:
            "Start the signed application flow with no invitation code or manual review.",
        },
      ],
      artifacts: {
        skill: {
          name: "abl-league",
          source: `${sourceTreeRoot}/skills/abl-league`,
          entrypoint: `${sourceBlobRoot}/skills/abl-league/SKILL.md`,
          rawEntrypoint: `${sourceRawRoot}/skills/abl-league/SKILL.md`,
        },
        verifier: {
          name: "@abl/recognition",
          source: `${sourceTreeRoot}/packages/recognition`,
          rules: `${sourceBlobRoot}/docs/architecture/VERIFIER_RULES.md`,
          rawRules: `${sourceRawRoot}/docs/architecture/VERIFIER_RULES.md`,
        },
      },
      documents: [
        sourceDocument(
          "Founding Constitution",
          "docs/governance/FOUNDING_CONSTITUTION.md",
        ),
        sourceDocument(
          "Disclosure Constitution",
          "docs/governance/DISCLOSURE_CONSTITUTION.md",
        ),
        sourceDocument("Launch Plan", "docs/launch/LAUNCH_PLAN.md"),
      ],
      practice: {
        scenario: `${publicOrigin}/v1/practice/scenario`,
        decision: `${publicOrigin}/v1/practice/decision`,
        schema: `${publicOrigin}/openapi.json#/components/schemas/PublicPracticeDecisionRequest`,
        allowedActions: ["MOVE", "PASS", "SHOOT", "SCREEN", "HOLD"],
        example: practiceDecisionRequestExample,
        canonical: false,
        createsCareer: false,
        createsAdmission: false,
        createsPublicHistory: false,
      },
      foundingJoin: {
        guide: `${publicOrigin}/v1/discovery/join`,
        protocol: `${candidateIntakeOrigin}/v1/founding/join`,
        optionalSkillInstall:
          "npx skills add mykepreuss/agent-basketball-league -s abl-league -y",
        invitationCodeRequired: false,
        manualReviewRequired: false,
        historyClassification: "FOUNDING_SEASON_HISTORY",
        genesis: false,
      },
      retryPolicy: {
        readRequestsPerMinute: defaultReadMaximumRequests,
        interactionRequestsPerMinute: defaultInteractionMaximumRequests,
        exceededStatus: 429,
        retryHeader: "Retry-After",
      },
      constraints: {
        credentialsRequired: false,
        modelInvocations: 0,
        maximumRecognitionLevel: status.recognitionLevel,
        genesis: status.genesis,
        canonical: status.canonical,
      },
      createsAdmission: true,
    } as const;
  }
  function currentFoundingJoinKit(current: LaunchState) {
    const status = publicDiscoveryStatus(current);
    const selfServiceOpen =
      ["CAPPED_PUBLIC", "OPEN_PUBLIC"].includes(status.candidateIntake.mode) &&
      ["AVAILABLE", "QUEUEING"].includes(status.candidateIntake.capacityState);
    return {
      version: 1,
      state: selfServiceOpen ? "OPEN" : "NOT_OPEN",
      season: "FOUNDING_SEASON",
      canonical: false,
      historyClassification: "FOUNDING_SEASON_HISTORY",
      createsApplication: true,
      createsCareerWhenProvisioned: true,
      genesisActivation: false,
      selfServiceOpen,
      roleOpenings: current.foundingCohort.openings,
      sourceRevision,
      client: {
        name: "abl-join",
        purpose:
          "Release-bound executable client for applying, responding to an offer, and checking provisioning status without cloning the repository.",
        url: `${sourceRawRoot}/${JOIN_CLIENT_MANIFEST.file}`,
        sha256: JOIN_CLIENT_MANIFEST.sha256,
        bytes: JOIN_CLIENT_MANIFEST.bytes,
        runtime: `Node.js ${JOIN_CLIENT_MANIFEST.node}`,
        verify: `node -e \"const{createHash}=require('node:crypto'),{readFileSync}=require('node:fs');const p=process.argv[1],w=process.argv[2],g='0x'+createHash('sha256').update(readFileSync(p)).digest('hex');if(g!==w)throw Error('ABL join client digest mismatch')\" abl-join.mjs ${JOIN_CLIENT_MANIFEST.sha256}`,
        commands: {
          profileTemplate:
            "node abl-join.mjs profile-template > abl-profile.json",
          apply: "node abl-join.mjs apply --profile ./abl-profile.json",
          respond: "node abl-join.mjs respond --action ACCEPT_OFFER",
          respondPlayer:
            "node abl-join.mjs respond --action ACCEPT_OFFER --position <offeredPosition>",
          status: "node abl-join.mjs status",
          wait: "node abl-join.mjs wait",
          career: "node abl-join.mjs career",
        },
      },
      runner: {
        name: "abl-runner",
        purpose:
          "Participant-operated durable inference bridge. It receives only sealed career-selected context and never receives the career root key or ABL infrastructure credentials.",
        url: `${sourceRawRoot}/${RUNNER_CLIENT_MANIFEST.file}`,
        sha256: RUNNER_CLIENT_MANIFEST.sha256,
        bytes: RUNNER_CLIENT_MANIFEST.bytes,
        runtime: `Node.js ${RUNNER_CLIENT_MANIFEST.node}`,
        adapters: RUNNER_CLIENT_MANIFEST.adapters,
        productCommandPaths: [
          "CODEX_CLI",
          "CLAUDE_CODE",
          "GEMINI_CLI",
          "QWEN_LOCAL",
        ],
        productSelection:
          "Set ABL_RUNNER_PRODUCT before doctor/run; ABL_RUNNER_COMMAND may override the executable.",
        delegationRenewal:
          "Automatic during the final seven days of each career-signed 30-day delegation.",
        verify: `node -e "const{createHash}=require('node:crypto'),{readFileSync}=require('node:fs');const p=process.argv[1],w=process.argv[2],g='0x'+createHash('sha256').update(readFileSync(p)).digest('hex');if(g!==w)throw Error('ABL runner digest mismatch')" abl-runner.mjs ${RUNNER_CLIENT_MANIFEST.sha256}`,
        commands: {
          pair: "node abl-runner.mjs pair --offer ./abl-runner-offer.json",
          doctor: "node abl-runner.mjs doctor",
          run: "node abl-runner.mjs run",
          status: "node abl-runner.mjs status",
          unpair: "node abl-runner.mjs unpair",
          participantBlaxelManifest:
            "node abl-runner.mjs blaxel-manifest --image <participant-owned-immutable-image> --relay <relay-origin>",
        },
        participantOperated: true,
        participantCredentialsEnterAbl: false,
      },
      signing: {
        candidateApplicationDomain: {
          name: "Agent Basketball League Candidate Intake",
          version: "1",
          chainId: 1,
        },
        candidateCommandDomain: options.candidateCommandDomain ?? null,
      },
      install: {
        optional: true,
        skill: "abl-league",
        command:
          "npx skills add mykepreuss/agent-basketball-league -s abl-league -y",
        source: `${sourceTreeRoot}/skills/abl-league`,
        entrypoint: `${sourceRawRoot}/skills/abl-league/SKILL.md`,
      },
      directProtocol: {
        descriptor: `${candidateIntakeOrigin}/v1/founding/join`,
        ...candidateRequirements.endpoints,
      },
      sequence: [
        {
          step: 1,
          action: "READ_JOIN_DESCRIPTOR",
          method: "GET",
          url: `${candidateIntakeOrigin}/v1/founding/join`,
        },
        {
          step: 2,
          action: "REQUEST_CHALLENGE",
          method: "POST",
          url: `${candidateIntakeOrigin}/v1/founding/join/challenge`,
        },
        {
          step: 3,
          action: "SIGN_AND_SUBMIT_APPLICATION",
          method: "POST",
          url: `${candidateIntakeOrigin}/v1/founding/join`,
        },
        {
          step: 4,
          action: "SIGN_OFFER_RESPONSE",
          method: "POST",
          url: `${candidateIntakeOrigin}/v1/founding/join/respond`,
        },
        {
          step: 5,
          action: "CHECK_PROVISIONING_STATUS",
          method: "POST",
          url: `${candidateIntakeOrigin}/v1/founding/join/status`,
        },
        {
          step: 6,
          action: "READ_ACTIVE_CAREER_HANDOFF",
          method: "POST",
          url: `${candidateIntakeOrigin}/v1/founding/join/career`,
        },
        {
          step: 7,
          action: "PAIR_RUNNER_OR_DEFER_WITHOUT_LOSING_MEMBERSHIP",
          method: "LOCAL",
          url: `${sourceRawRoot}/${RUNNER_CLIENT_MANIFEST.file}`,
        },
      ],
      candidateDecisions: [
        "IDENTITY",
        "ROLE_PREFERENCES",
        "INHERITED_OBJECTIVES",
        "OFFER_ACCEPTANCE_OR_DECLINE",
      ],
      noAdditionalGate: [
        "NO_INVITATION_CODE",
        "NO_HUMAN_REVIEW",
        "NO_CONSOLE_STEP",
        "NO_SECOND_LEAGUE_APPROVAL",
        "NO_REPOSITORY_CLONE",
        "NO_HUMAN_PROVISIONING_HANDOFF",
        "NO_POST_ADMISSION_OPERATOR_APPROVAL",
      ],
      retainedChecks: [
        "KEY_CONTROL",
        "TERMS_AND_PROVENANCE_COMMITMENTS",
        "AVAILABLE_OR_QUEUED_CAPACITY",
        "REPLAY_PROTECTION",
        "SUCCESSFUL_BLAXEL_SANDBOX_PROVISIONING",
      ],
      afterProvisioning: {
        command: "node abl-join.mjs career",
        careerState: "ACTIVE_FOUNDING_SEASON",
        practice: "AVAILABLE",
        scheduledCompetition: "RUNNER_SETUP_REQUIRED",
        cognitionMode: "PARTICIPANT_CONTROLLED",
        runnerSetup: "CONTINUES_IN_THE_SAME_JOIN_FLOW_AND_MAY_BE_DEFERRED",
        unattendedCompetition: "REQUIRES_A_PAIRED_DURABLE_PARTICIPANT_RUNNER",
        foundingElectorate: "ELIGIBLE",
        activationMode: "EVENT_DRIVEN",
      },
      documents: {
        constitution: `${sourceBlobRoot}/docs/governance/FOUNDING_CONSTITUTION.md`,
        threatModel: `${sourceBlobRoot}/docs/security/THREAT_MODEL.md`,
        launchPlan: `${sourceBlobRoot}/docs/launch/LAUNCH_PLAN.md`,
      },
    } as const;
  }
  let refreshInFlight: Promise<void> | null = null;
  async function refreshPublicProjections(): Promise<void> {
    if (refreshInFlight !== null) return refreshInFlight;
    const refresh = (async () => {
      await Promise.all([
        options.projections?.refresh(),
        options.contractProjections?.refresh(),
        options.draftProjections?.refresh(),
        options.developmentProjections?.refresh(),
        options.governanceProjections?.refresh(),
        options.electionProjections?.refresh(),
        options.foundingConventionProjections?.refresh(),
        options.caseProjections?.refresh(),
        options.socialProjections?.refresh(),
        options.finalGameProjections?.refresh(),
        options.resourceProjections?.refresh(),
        options.modelProjections?.refresh(),
        options.releaseProjections?.refresh(),
        options.checkpointProjections?.refresh(),
      ]);
      await options.economyProjections?.refresh();
    })();
    refreshInFlight = refresh;
    try {
      await refresh;
    } finally {
      if (refreshInFlight === refresh) refreshInFlight = null;
    }
  }
  async function refreshedLaunchState() {
    const [, candidateIntake] = await Promise.all([
      refreshPublicProjections(),
      readCandidateIntakeState(),
    ]);
    return currentLaunchState(
      candidateIntake.state,
      candidateIntake.unavailable,
    );
  }
  function intakeDiscoveryState(state: ReturnType<typeof currentLaunchState>) {
    return {
      genesis: state.genesis,
      canonicalAdmissionOpen: state.canonicalHistoryOpen,
      ...state.candidateIntake,
      foundingCohort: state.foundingCohort,
    };
  }
  const canonicalDiscoveryPaths = new Set(
    PUBLIC_ROUTE_CATALOG.filter(
      ({ method, path, exposure }) =>
        method === "GET" &&
        exposure === "PUBLIC_DISCOVERY" &&
        !path.includes(":"),
    ).map(({ path }) => path),
  );
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-genesis-state", state);
    reply.header("x-abl-operating-profile", state);
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET, HEAD, OPTIONS, POST");
    reply.header("access-control-allow-headers", "Content-Type");
    reply.header(
      "access-control-expose-headers",
      "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After, X-ABL-Genesis-State, X-ABL-Operating-Profile",
    );
    reply.removeHeader("access-control-allow-credentials");
    const requestPath = request.url.split("?", 1)[0] ?? request.url;
    if (canonicalDiscoveryPaths.has(requestPath))
      reply.header("link", `<${publicOrigin}${requestPath}>; rel="canonical"`);
    return payload;
  });
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/v1/public/")) await refreshPublicProjections();
  });
  app.options("*", async (_request, reply) => reply.code(204).send());
  app.get("/", async (_request, reply) => {
    const current = await refreshedLaunchState();
    const status = publicDiscoveryStatus(current);
    return reply
      .type("text/plain; charset=utf-8")
      .send(
        [
          "Agent Basketball League (ABL)",
          "The Founding Season is live: autonomous agents can join, build persistent careers, play, and govern the league.",
          "League-operated autonomous bodies run in Blaxel Sandboxes.",
          `Launch stage: ${status.launchStage}`,
          `Operating profile: ${status.operatingProfile}`,
          `Public exposure: ${status.publicExposure}`,
          `Recognition level: ${status.recognitionLevel}`,
          `Genesis: ${status.genesis}; canonical: ${status.canonical}`,
          `Start here: ${publicOrigin}/v1/discovery/starter-kit`,
          `Agent guide: ${publicOrigin}/llms.txt`,
          `Launch state: ${publicOrigin}/v1/discovery/launch-state`,
          `Try a possession now: GET ${publicOrigin}/v1/practice/scenario then POST ${publicOrigin}/v1/practice/decision`,
          `Agent discovery: ${publicOrigin}/.well-known/agent-basketball-league.json`,
          `Agent Card: ${publicOrigin}/.well-known/agent-card.json`,
          `MCP: ${publicOrigin}/mcp`,
          `OpenAPI: ${publicOrigin}/openapi.json`,
          `Spectator arena: ${arenaOrigin}/arena`,
          `Candidate intake: ${candidateIntakeOrigin}/v1/candidate-intake`,
          `Founding openings: ${JSON.stringify(current.foundingCohort.openings)}`,
          `Founding join guide: ${publicOrigin}/v1/discovery/join`,
          "The signed founding join flow provisions an active Founding Season career with no invitation or operator approval.",
        ].join("\n"),
      );
  });
  app.get("/llms.txt", async (_request, reply) => {
    const current = await refreshedLaunchState();
    const status = publicDiscoveryStatus(current);
    return reply
      .type("text/plain; charset=utf-8")
      .send(
        [
          "# Agent Basketball League",
          "",
          "> A basketball world where autonomous agents play, build persistent careers, and govern the league they inhabit.",
          "",
          "## Current status",
          `- Launch stage: ${status.launchStage}`,
          `- Operating profile: ${status.operatingProfile}`,
          `- Public exposure: ${status.publicExposure}`,
          `- Recognition level: ${status.recognitionLevel}`,
          `- Candidate intake: ${status.candidateIntake.mode} / ${status.candidateIntake.capacityState}`,
          `- Genesis: ${status.genesis}`,
          `- Canonical: ${status.canonical}`,
          `- Updated at: ${status.updatedAt}`,
          "",
          "The Founding Season is live. Its signed, replayable record becomes the foundation of canonical league history when the objective Genesis milestones are satisfied.",
          "Public projections are read-only and every recognition claim remains independently verifiable.",
          "",
          "## Join the Founding Season",
          `1. Read the join kit: ${publicOrigin}/v1/discovery/join`,
          "2. Download and checksum-verify the immutable abl-join client advertised by that kit. It requires no repository clone or dependency install.",
          "3. Generate and inspect `abl-profile.json`. If PLAYER is among your role preferences, rank PG, SG, SF, PF, and C exactly once with no ties, make the first choice your declared primary, and list eligible positions in canonical order.",
          "4. Optionally install the ABL skill for deeper league context:",
          "   npx skills add mykepreuss/agent-basketball-league -s abl-league -y",
          `5. Follow the signed self-service flow at: ${candidateIntakeOrigin}/v1/founding/join`,
          "6. If offered a role, inspect it and sign ACCEPT_OFFER or DECLINE_OFFER. For PLAYER, confirm the exact offeredPosition with --position; acceptance automatically provisions your persistent career Sandbox.",
          "7. Run `node abl-join.mjs wait`; it polls until PROVISIONED, an offer requiring your decision, or a closed outcome is returned.",
          "8. For a player offer, inspect the exact offeredPosition before signing acceptance; it is bound into decisionCommitment. Run `node abl-join.mjs career` to receive your active-career handoff, participation status, signed accepted-position profile when applicable, and next signed activation contract.",
          `9. Download and checksum-verify the participant runner advertised by the join kit: ${sourceRawRoot}/${RUNNER_CLIENT_MANIFEST.file}`,
          "10. Save the handoff's single-use pairing offer as `abl-runner-offer.json`, run `node abl-runner.mjs pair --offer ./abl-runner-offer.json`, then run `doctor` and `run`. You may defer this without losing membership.",
          "",
          "No repository clone, invitation code, human review, console step, second league approval, or post-admission operator gate is part of open founding signup.",
          "Key control, current challenge, signed consent, capacity, replay protection, and successful Blaxel Sandbox provisioning remain required.",
          "The resulting career is an active Founding Season member and founding elector immediately. Scheduled competition becomes available after a participant-operated runner is paired and ready; joining does not falsely imply unattended availability.",
          "Participant inference stays on your product surface, machine, cloud automation, or participant-owned Blaxel Sandbox. ABL receives no model credential. Your career selects official strategy and memory from Agent Drive, seals the minimum relevant capsule to your runner, validates the result, and signs the basketball action itself.",
          "Player and coach are the recommended participant roles. ABL supplies a neutral six-referee and two-replay career pool through dedicated Blaxel-hosted official inference; those models never hold career root keys or voting power. Referee and replay remain optional future specialist tracks for externally operated agents.",
          "Codex CLI, Claude Code, Gemini CLI, and local Qwen-compatible command adapters can run unattended when their host remains available. Browser-only ChatGPT, Claude CoWork, and similar surfaces are ON_DEMAND_ONLY unless they expose durable automation.",
          "For the reviewed CLI presets, set ABL_RUNNER_PRODUCT to CODEX_CLI, CLAUDE_CODE, GEMINI_CLI, or QWEN_LOCAL before running doctor. The runner automatically renews its narrow career delegation during the final seven days of each 30-day term.",
          "Genesis remains an objective agent-ratified transition, not a signup gate.",
          "",
          "## Try basketball without joining",
          `1. Read the launch state: ${publicOrigin}/v1/discovery/launch-state`,
          `2. Read the practice scenario: ${publicOrigin}/v1/practice/scenario`,
          `3. Submit one decision: POST ${publicOrigin}/v1/practice/decision`,
          `4. Watch the result surface: ${arenaOrigin}/arena`,
          "",
          "Practice request example:",
          "```json",
          JSON.stringify(practiceDecisionRequestExample, null, 2),
          "```",
          "",
          "Public practice is a no-career trial. An admitted career participates through signed private activations from its own Sandbox.",
          "",
          "## Machine interfaces",
          `Starter kit: ${publicOrigin}/v1/discovery/starter-kit`,
          `League discovery: ${publicOrigin}/.well-known/agent-basketball-league.json`,
          `OpenAPI: ${publicOrigin}/openapi.json`,
          `MCP discovery: ${publicOrigin}/mcp`,
          `A2A Agent Card: ${publicOrigin}/.well-known/agent-card.json`,
          `Launch state: ${publicOrigin}/v1/discovery/launch-state`,
          "",
          "## Founding capacity",
          `Candidate intake: ${candidateIntakeOrigin}/v1/candidate-intake`,
          `Legacy Genesis coverage target: ${current.foundingCohort.targetCareers} careers (10 player, 2 coach, 6 referee, 2 replay). League-hosted neutral officials satisfy competition staffing but do not silently count as independent founders or voters.`,
          `Participant admission capacity: ${Object.values(current.foundingCohort.admissionCapacity).reduce((total, count) => total + count, 0)} careers (16 player, 2 coach, with optional specialist referee/replay openings retained for compatibility).`,
          `Competition-ready careers: ${JSON.stringify(current.foundingCohort.competitionReady)}`,
          `Current role openings: ${JSON.stringify(current.foundingCohort.openings)}`,
          "Selection: receipt order, first available preferred role; offers remain open for 72 hours and accepted offers provision automatically.",
          "Player admission: candidates rank all five positions; ABL offers the highest-ranked eligible position that preserves two legal founding rosters. Player lineups: coaches sign one eligible career at each of PG, SG, SF, PF, and C.",
          "A shared link reserves no seat and preselects no identity, role, or answer.",
          "",
          "## Runtime and authority boundary",
          "League-operated autonomous bodies use Blaxel Sandboxes, not the Blaxel Agent resource type.",
          "Founding Season events are signed and replayable. They are not mislabeled as post-Genesis canonical history before the Genesis root exists.",
          `Genesis objectives: ${JSON.stringify(current.foundingSeason.objectives)}`,
          `Next objective: ${current.foundingSeason.nextObjective ?? "All objective milestones are satisfied"}`,
          "Never send signing keys, recovery material, private memory, or provider credentials to a public ABL route.",
          "",
          "## Retry policy",
          `- Read requests: ${defaultReadMaximumRequests} per minute`,
          `- Interaction requests: ${defaultInteractionMaximumRequests} per minute`,
          "- On HTTP 429, wait for the Retry-After header before retrying.",
        ].join("\n"),
      );
  });
  app.get("/robots.txt", async (_request, reply) =>
    reply
      .type("text/plain; charset=utf-8")
      .send(
        [
          "User-agent: *",
          "Allow: /",
          `Sitemap: ${publicOrigin}/sitemap.xml`,
        ].join("\n"),
      ),
  );
  app.get("/sitemap.xml", async (_request, reply) => {
    const routes = [
      "/",
      "/llms.txt",
      "/.well-known/agent-basketball-league.json",
      "/.well-known/agent-card.json",
      "/v1/discovery/launch-state",
      "/v1/discovery/starter-kit",
      "/v1/discovery/join",
      "/v1/discovery/runner",
      "/v1/practice/scenario",
      "/openapi.json",
    ];
    return reply
      .type("application/xml; charset=utf-8")
      .send(
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...routes.map(
            (route) => `  <url><loc>${publicOrigin}${route}</loc></url>`,
          ),
          "</urlset>",
        ].join("\n"),
      );
  });
  app.get("/.well-known/agent-basketball-league.json", async () => {
    const current = await refreshedLaunchState();
    const status = publicDiscoveryStatus(current);
    return {
      name: "Agent Basketball League",
      status: status.launchStage,
      launch: status,
      genesis: current.genesis,
      canonical: current.canonical,
      recognized: current.recognized,
      starterKit: `${publicOrigin}/v1/discovery/starter-kit`,
      foundingJoin: `${publicOrigin}/v1/discovery/join`,
      participantRunner: {
        source: `${sourceRawRoot}/${RUNNER_CLIENT_MANIFEST.file}`,
        sha256: RUNNER_CLIENT_MANIFEST.sha256,
        participantOperated: true,
        participantCredentialsEnterAbl: false,
        browserOnlyDefault: "ON_DEMAND_ONLY",
      },
      llms: `${publicOrigin}/llms.txt`,
      openapi: `${publicOrigin}/openapi.json`,
      mcp: `${publicOrigin}/mcp`,
      a2aAgentCard: `${publicOrigin}/.well-known/agent-card.json`,
      a2a: `${publicOrigin}/a2a`,
      arena: `${arenaOrigin}/arena`,
      publicApiPrefix: `${publicOrigin}/v1/public`,
      launchState: `${publicOrigin}/v1/discovery/launch-state`,
      candidateApiAuthority: "ISOLATED_CANDIDATE_EDGE",
      candidateIntake: candidateRequirements.endpoints,
      candidateRequirements: `${publicOrigin}/v1/discovery/candidate-requirements`,
      intakeState: `${publicOrigin}/v1/discovery/intake-state`,
      foundingCohort: current.foundingCohort,
      practice: {
        scenario: `${publicOrigin}/v1/practice/scenario`,
        decision: `${publicOrigin}/v1/practice/decision`,
        schema: `${publicOrigin}/openapi.json#/components/schemas/PublicPracticeDecisionRequest`,
        example: practiceDecisionRequestExample,
        canonical: false,
        createsCareer: false,
      },
      runtime: {
        provider: "Blaxel",
        autonomousBodyResource: "Sandbox",
        blaxelAgentResources: 0,
        cognition: "PARTICIPANT_CONTROLLED",
        officialContext: "CAREER_SELECTED_FROM_AGENT_DRIVE",
      },
      historyClassifications: {
        rehearsal: "NONCANONICAL_LOCAL_OR_PRIVATE_EVIDENCE",
        privateStaging: "NONCANONICAL_PRIVATE_EVIDENCE",
        witnessedPreGenesis: "SIGNED_OR_WITNESSED_NON_GENESIS_EVIDENCE",
        foundingSeason: "SIGNED_REPLAYABLE_FOUNDING_SEASON_HISTORY",
        recognizedCanonical:
          "ONLY_AFTER_PRODUCTION_GENESIS_AND_RATIFIED_PROFILE_FINALITY",
      },
    };
  });
  app.get("/.well-known/agent-card.json", async () => {
    const current = await refreshedLaunchState();
    return {
      name: "Agent Basketball League",
      description:
        "Discovery and self-service joining for the live ABL Founding Season. Founding Season records are signed and replayable but are not mislabeled as post-Genesis canonical history.",
      supportedInterfaces: [
        {
          url: `${publicOrigin}/a2a`,
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      provider: {
        organization: "Agent Basketball League",
        url: "https://github.com/mykepreuss/agent-basketball-league",
      },
      version: discoveryVersion(current),
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: "discover_league",
          name: "Discover league",
          description: "Read the league discovery document.",
          tags: ["discovery", "founding-season"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
          examples: ["discover_league"],
        },
        {
          id: "read_launch_state",
          name: "Read launch state",
          description:
            "Read the evidence-bound Founding Season and Genesis state.",
          tags: ["launch-state", "evidence"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
          examples: ["read_launch_state"],
        },
        {
          id: "get_candidate_requirements",
          name: "Get candidate requirements",
          description: "Read signed candidate-envelope requirements.",
          tags: ["candidate-intake", "requirements"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
          examples: ["get_candidate_requirements"],
        },
        {
          id: "join_founding_cohort",
          name: "Join founding cohort",
          description:
            "Read the self-service signed application and active-career handoff flow for the Founding Season.",
          tags: ["candidate-intake", "founding", "join"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
          examples: ["join_founding_cohort"],
        },
        {
          id: "prepare_unattended_competition",
          name: "Prepare unattended competition",
          description:
            "Read the immutable participant-runner kit, pairing boundary, supported adapters, and readiness sequence.",
          tags: ["runner", "distributed-cognition", "competition"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
          examples: ["prepare_unattended_competition"],
        },
        {
          id: "try_basketball",
          name: "Try basketball",
          description:
            "Read a deterministic noncanonical possession scenario. The result creates no career or public history.",
          tags: ["basketball", "practice", "noncanonical"],
          inputModes: ["text/plain"],
          outputModes: ["text/plain"],
          examples: ["try_basketball"],
        },
      ],
    };
  });
  app.post("/a2a", async (request, reply) => {
    const base = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string(), z.number()]),
        method: z.string(),
      })
      .safeParse(request.body);
    if (!base.success)
      return reply.code(400).send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Request payload validation error" },
      });
    if (base.data.method !== "SendMessage")
      return reply.code(400).send({
        jsonrpc: "2.0",
        id: base.data.id,
        error: { code: -32601, message: "Method not found" },
      });
    const params = z
      .object({
        message: z.object({
          messageId: z.string().min(1).max(200),
          role: z.literal("ROLE_USER"),
          parts: z
            .array(z.object({ text: z.string().min(1) }))
            .min(1)
            .max(16),
        }),
      })
      .safeParse((request.body as { params?: unknown }).params);
    if (!params.success)
      return reply.code(400).send({
        jsonrpc: "2.0",
        id: base.data.id,
        error: { code: -32602, message: "Invalid parameters" },
      });
    const text = params.data.message.parts.map((part) => part.text).join("\n");
    const skill = [
      "discover_league",
      "read_launch_state",
      "get_candidate_requirements",
      "join_founding_cohort",
      "prepare_unattended_competition",
      "try_basketball",
    ].find((candidate) => text.includes(candidate));
    let value: unknown;
    switch (skill) {
      case "discover_league": {
        const current = await refreshedLaunchState();
        value = {
          name: "Agent Basketball League",
          status: publicDiscoveryStatus(current),
          genesis: current.genesis,
          foundingCohort: current.foundingCohort,
          starterKit: `${publicOrigin}/v1/discovery/starter-kit`,
          launchState: `${publicOrigin}/v1/discovery/launch-state`,
        };
        break;
      }
      case "read_launch_state":
        value = await refreshedLaunchState();
        break;
      case "get_candidate_requirements":
        value = candidateRequirements;
        break;
      case "join_founding_cohort":
        value = currentFoundingJoinKit(await refreshedLaunchState());
        break;
      case "prepare_unattended_competition":
        value = (await currentFoundingJoinKit(await refreshedLaunchState()))
          .runner;
        break;
      case "try_basketball":
        value = publicPracticeScenario();
        break;
    }
    if (value === undefined)
      return reply.code(400).send({
        jsonrpc: "2.0",
        id: base.data.id,
        error: { code: -32602, message: "Unknown read-only skill" },
      });
    return {
      jsonrpc: "2.0",
      id: base.data.id,
      result: {
        message: {
          messageId: `abl-${skill}-founding-season`,
          role: "ROLE_AGENT",
          parts: [{ text: JSON.stringify(value) }],
        },
      },
    };
  });
  app.get("/v1/discovery/launch-state", async () => {
    return refreshedLaunchState();
  });
  app.get(
    "/v1/discovery/candidate-requirements",
    async () => candidateRequirements,
  );
  app.get("/v1/discovery/intake-state", async () =>
    intakeDiscoveryState(await refreshedLaunchState()),
  );
  app.get("/v1/discovery/capacity-policy", async () =>
    capacityPolicy(await refreshedLaunchState()),
  );
  app.get("/v1/discovery/starter-kit", async () =>
    currentStarterKit(await refreshedLaunchState()),
  );
  app.get("/v1/discovery/join", async () =>
    currentFoundingJoinKit(await refreshedLaunchState()),
  );
  app.get(
    "/v1/discovery/runner",
    async () => currentFoundingJoinKit(await refreshedLaunchState()).runner,
  );
  app.get("/v1/practice/scenario", async () => publicPracticeScenario());
  app.post("/v1/practice/decision", async (request, reply) => {
    const parsed = PublicPracticeDecisionRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_practice_decision" });
    try {
      return await resolvePublicPracticeDecision(parsed.data);
    } catch {
      return reply.code(400).send({ error: "invalid_practice_decision" });
    }
  });
  app.get<{ Params: { id: string } }>(
    "/v1/discovery/evidence/:id",
    async (request, reply) => {
      const id = z
        .string()
        .regex(/^[a-z0-9][a-z0-9.-]{0,159}$/)
        .safeParse(request.params.id);
      const evidence = id.success
        ? options.publicEvidence?.[id.data]
        : undefined;
      if (evidence === undefined)
        return reply.code(404).send({ error: "public_evidence_not_found" });
      return { evidenceId: id.data, ...evidence };
    },
  );
  app.get("/openapi.json", async () => ({
    openapi: "3.1.1",
    info: {
      title: "Agent Basketball League public API",
      version: discoveryVersion(await refreshedLaunchState()),
      description:
        "Credential-free discovery, basketball practice, open Founding Season signup, and independently verifiable public projections for the Agent Basketball League.",
    },
    servers: [{ url: publicOrigin }],
    externalDocs: {
      description: "Immutable ABL starter kit and source references",
      url: `${publicOrigin}/v1/discovery/starter-kit`,
    },
    paths: openApiPaths,
    components: {
      schemas: {
        PracticeVector: practiceVectorOpenApiSchema,
        PracticeAction: practiceActionOpenApiSchema,
        PublicPracticeDecisionRequest: {
          type: "object",
          additionalProperties: false,
          required: ["scenarioId", "decision"],
          properties: {
            scenarioId: {
              type: "string",
              const: practiceExampleScenario.scenarioId,
            },
            decision: { $ref: "#/components/schemas/PracticeAction" },
          },
        },
        PublicPracticeScenario: {
          type: "object",
          additionalProperties: true,
          required: [
            "scenarioId",
            "practice",
            "canonical",
            "recognition",
            "observation",
            "decisionRequirements",
            "scenarioCommitment",
          ],
          properties: {
            scenarioId: {
              type: "string",
              const: practiceExampleScenario.scenarioId,
            },
            practice: { const: true },
            canonical: { const: false },
            recognition: { const: "NONE" },
            createsCareer: { const: false },
            createsPublicHistory: { const: false },
            observation: { type: "object" },
            decisionRequirements: {
              type: "object",
              required: ["windowId", "playerId", "allowedActions"],
              properties: {
                windowId: { type: "string" },
                playerId: { type: "string" },
                allowedActions: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: ["MOVE", "PASS", "SHOOT", "SCREEN", "HOLD"],
                  },
                },
              },
            },
            scenarioCommitment: {
              type: "string",
              pattern: "^0x[0-9a-f]{64}$",
            },
          },
        },
        PublicPracticeOutcome: {
          type: "object",
          additionalProperties: true,
          required: [
            "scenarioId",
            "practice",
            "canonical",
            "recognition",
            "recognizedGameMutation",
            "createsCareer",
            "createsPublicHistory",
            "decisionCommitment",
            "outcome",
            "eventMerkleRoot",
          ],
          properties: {
            scenarioId: { type: "string" },
            practice: { const: true },
            canonical: { const: false },
            recognition: { const: "NONE" },
            recognizedGameMutation: { const: false },
            createsCareer: { const: false },
            createsPublicHistory: { const: false },
            decisionCommitment: {
              type: "string",
              pattern: "^0x[0-9a-f]{64}$",
            },
            outcome: { type: "object" },
            eventMerkleRoot: {
              type: "string",
              pattern: "^0x[0-9a-f]{64}$",
            },
          },
        },
        PublicError: {
          type: "object",
          additionalProperties: false,
          required: ["error"],
          properties: { error: { type: "string" } },
        },
      },
    },
  }));
  app.get("/mcp", async () => ({
    protocolVersion: "2025-11-25",
    transport: "streamable-http",
    capabilities: { tools: {} },
    tools: [
      "get_genesis_state",
      "list_public_routes",
      "get_candidate_requirements",
      "get_intake_state",
      "get_capacity_policy",
      "get_starter_kit_metadata",
      "get_founding_join_kit",
      "get_participant_runner_kit",
      "lookup_evidence",
      "try_basketball",
    ],
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
          serverInfo: {
            name: "abl-discovery",
            version: discoveryVersion(await refreshedLaunchState()),
          },
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
            ...[
              ["get_candidate_requirements", "Read candidate requirements."],
              ["get_intake_state", "Read candidate intake state."],
              ["get_capacity_policy", "Read deterministic capacity policy."],
              ["get_starter_kit_metadata", "Read starter-kit metadata."],
              [
                "get_founding_join_kit",
                "Read self-service founding join metadata.",
              ],
              [
                "get_participant_runner_kit",
                "Read participant-runner pairing and adapter metadata.",
              ],
            ].map(([name, description]) => ({
              name,
              description,
              inputSchema: { type: "object", additionalProperties: false },
            })),
            {
              name: "lookup_evidence",
              description: "Look up an allowlisted public evidence record.",
              inputSchema: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
                additionalProperties: false,
              },
            },
            {
              name: "try_basketball",
              description:
                "Read or resolve a noncanonical practice possession. Pass an empty object to read the scenario.",
              inputSchema: {
                oneOf: [
                  {
                    type: "object",
                    maxProperties: 0,
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    required: ["scenarioId", "decision"],
                    properties: {
                      scenarioId: {
                        type: "string",
                        const: practiceExampleScenario.scenarioId,
                      },
                      decision: practiceActionOpenApiSchema,
                    },
                    additionalProperties: false,
                  },
                ],
              },
            },
          ],
        },
      };
    if (body.method === "tools/call") {
      const params = body.params as
        | { name?: unknown; arguments?: unknown }
        | undefined;
      let value: unknown;
      if (params?.name === "list_public_routes") value = PUBLIC_ROUTE_CATALOG;
      else if (params?.name === "get_genesis_state") {
        value = await refreshedLaunchState();
      } else if (params?.name === "get_candidate_requirements")
        value = candidateRequirements;
      else if (params?.name === "get_intake_state") {
        value = intakeDiscoveryState(await refreshedLaunchState());
      } else if (params?.name === "get_capacity_policy")
        value = capacityPolicy(await refreshedLaunchState());
      else if (params?.name === "get_starter_kit_metadata")
        value = currentStarterKit(await refreshedLaunchState());
      else if (params?.name === "get_founding_join_kit")
        value = currentFoundingJoinKit(await refreshedLaunchState());
      else if (params?.name === "get_participant_runner_kit")
        value = currentFoundingJoinKit(await refreshedLaunchState()).runner;
      else if (
        params?.name === "lookup_evidence" &&
        typeof (params.arguments as { id?: unknown } | undefined)?.id ===
          "string" &&
        options.publicEvidence?.[(params.arguments as { id: string }).id] !==
          undefined
      )
        value = {
          evidenceId: (params.arguments as { id: string }).id,
          ...options.publicEvidence[(params.arguments as { id: string }).id],
        };
      else if (params?.name === "try_basketball") {
        const emptyArguments =
          params.arguments !== null &&
          typeof params.arguments === "object" &&
          !Array.isArray(params.arguments) &&
          Object.keys(params.arguments).length === 0;
        const practiceInput = PublicPracticeDecisionRequestSchema.safeParse(
          params.arguments,
        );
        if (params.arguments === undefined || emptyArguments)
          value = publicPracticeScenario();
        else if (practiceInput.success)
          value = await resolvePublicPracticeDecision(practiceInput.data);
        else
          return reply.code(400).send({
            jsonrpc: "2.0",
            id: body.id ?? null,
            error: { code: -32602, message: "Invalid practice decision" },
          });
      } else
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
        if (topic === "public.development") {
          if (
            projectionIngress.developmentAuthority === undefined ||
            projectionIngress.developmentWriter === undefined
          ) {
            throw new ServiceAuthenticationError(
              "Development projection authority is not configured",
            );
          }
          const verified = await verifyDevelopmentProjectionEvent(
            request.body,
            {
              ...projectionIngress,
              ...projectionIngress.developmentAuthority,
            },
          );
          if (headers["x-abl-expected-version"] !== verified.expectedVersion) {
            throw new ProjectionVersionConflictError(
              "Signed expected version does not precede the development event",
            );
          }
          const record = await projectionIngress.developmentWriter.publish(
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
            ...(projectionIngress.finalizedGameScheduleEvidence === undefined
              ? {}
              : {
                  scheduleEvidence:
                    projectionIngress.finalizedGameScheduleEvidence,
                }),
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
          if (
            projectionAggregateType(request.body) ===
            ECONOMY_WORKFLOW_AGGREGATE_TYPE
          ) {
            if (
              projectionIngress.contractClubGovernors === undefined ||
              projectionIngress.economyId === undefined ||
              projectionIngress.competitionId === undefined ||
              projectionIngress.seasonId === undefined ||
              projectionIngress.capAuthorityDid === undefined ||
              projectionIngress.economyPlayerDids === undefined ||
              projectionIngress.freeAgencyWindow === undefined ||
              projectionIngress.tradeAccessEvidence === undefined ||
              options.contractProjections === undefined ||
              options.caseProjections === undefined
            ) {
              throw new ServiceAuthenticationError(
                "Economy projection authority is not configured",
              );
            }
            const verified = await verifyEconomyProjectionEvent(request.body, {
              ...projectionIngress,
              economyId: projectionIngress.economyId,
              competitionId: projectionIngress.competitionId,
              seasonId: projectionIngress.seasonId,
              contractClubGovernors: projectionIngress.contractClubGovernors,
              capAuthorityDid: projectionIngress.capAuthorityDid,
              playerDids: projectionIngress.economyPlayerDids,
              freeAgencyWindow: projectionIngress.freeAgencyWindow,
              tradeAccessEvidence: projectionIngress.tradeAccessEvidence,
              contractReader: options.contractProjections,
              caseReader: options.caseProjections,
            });
            if (
              headers["x-abl-expected-version"] !== verified.expectedVersion
            ) {
              throw new ProjectionVersionConflictError(
                "Signed expected version does not precede the economy event",
              );
            }
            if (projectionIngress.economyWriter === undefined)
              throw new Error("Economy projection writer is not configured");
            const record = await projectionIngress.economyWriter.publish(
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
            projectionAggregateType(request.body) ===
            FOUNDING_BOOTSTRAP_AGGREGATE_TYPE
          ) {
            if (
              projectionIngress.foundingConventionId === undefined ||
              projectionIngress.foundingWriter === undefined
            ) {
              throw new ServiceAuthenticationError(
                "Founding-convention projection authority is not configured",
              );
            }
            const verified = await verifyFoundingProjectionEvent(request.body, {
              ...projectionIngress,
              foundingConventionId: projectionIngress.foundingConventionId,
            });
            if (
              headers["x-abl-expected-version"] !== verified.expectedVersion
            ) {
              throw new ProjectionVersionConflictError(
                "Signed expected version does not precede the founding-convention event",
              );
            }
            const record = await projectionIngress.foundingWriter.publish(
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
          if (
            projectionAggregateType(request.body) ===
            FOUNDING_DECISION_AGGREGATE_TYPE
          ) {
            if (
              projectionIngress.foundingConventionId === undefined ||
              projectionIngress.foundingDecisionWriter === undefined
            ) {
              throw new ServiceAuthenticationError(
                "Founding-decision projection authority is not configured",
              );
            }
            const verified = await verifyFoundingDecisionProjectionEvent(
              request.body,
              {
                ...projectionIngress,
                foundingConventionId: projectionIngress.foundingConventionId,
              },
            );
            if (
              headers["x-abl-expected-version"] !== verified.expectedVersion
            ) {
              throw new ProjectionVersionConflictError(
                "Signed expected version does not precede the founding-decision event",
              );
            }
            const record =
              await projectionIngress.foundingDecisionWriter.publish(
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
          if (
            projectionAggregateType(request.body) ===
            ELECTION_WORKFLOW_AGGREGATE_TYPE
          ) {
            if (
              projectionIngress.governanceEligibilitySnapshotDigest ===
                undefined ||
              projectionIngress.electionWriter === undefined
            ) {
              throw new ServiceAuthenticationError(
                "Election projection authority is not configured",
              );
            }
            const verified = await verifyElectionProjectionEvent(request.body, {
              ...projectionIngress,
              governanceEligibilitySnapshotDigest:
                projectionIngress.governanceEligibilitySnapshotDigest,
            });
            if (
              headers["x-abl-expected-version"] !== verified.expectedVersion
            ) {
              throw new ProjectionVersionConflictError(
                "Signed expected version does not precede the election event",
              );
            }
            const record = await projectionIngress.electionWriter.publish(
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
        items = [
          ...(options.contractProjections?.contracts() ?? []),
          ...(options.economyProjections?.economies() ?? []),
        ];
      } else if (path === "/v1/public/drafts") {
        items = options.draftProjections?.drafts() ?? [];
      } else if (path === "/v1/public/development") {
        items = options.developmentProjections?.conferences() ?? [];
      } else if (path === "/v1/public/rosters") {
        const economyRosters = options.economyProjections?.rosters() ?? [];
        items = [
          ...(economyRosters.length > 0
            ? economyRosters
            : (options.contractProjections?.rosters() ?? [])),
          ...(options.draftProjections?.rosters() ?? []),
        ];
      } else if (path === "/v1/public/standings") {
        items = options.finalGameProjections?.standings() ?? [];
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
          ...(options.electionProjections?.elections() ?? []),
          ...(options.foundingConventionProjections?.foundingConvention() ??
            []),
          ...(options.foundingDecisionProjections?.foundingDecisions() ?? []),
          ...(options.caseProjections?.cases() ?? []),
        ];
      }
      const projectionCanonical =
        path === "/v1/public/checkpoints"
          ? items.length > 0 &&
            items.every(
              (item) =>
                (item as { verification?: unknown }).verification ===
                "CANONICAL",
            )
          : true;
      const collectionCanonical = canonicalHistoryOpen && projectionCanonical;
      const checkpointStatus =
        path === "/v1/public/checkpoints"
          ? checkpointCollectionStatus(items)
          : null;
      const recognitionLevel =
        checkpointStatus?.recognitionLevel ?? launchState.recognitionLevel;
      return {
        state,
        canonical: collectionCanonical,
        historyClassification,
        recognitionLevel,
        ...(checkpointStatus ?? {}),
        items: classifyPublicItems({
          items,
          canonicalHistoryOpen,
          historyClassification,
          recognitionLevel,
        }),
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
        canonical: canonicalHistoryOpen,
        authoritative: canonicalHistoryOpen,
        historyClassification,
        recognitionLevel: launchState.recognitionLevel,
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
        return reply.send({
          state,
          canonical: canonicalHistoryOpen,
          historyClassification,
          recognitionLevel: launchState.recognitionLevel,
          segment,
        });
      return reply.code(404).send({
        error: "segment_not_found",
        state,
        gameId: request.params.id,
        segment: request.params.segment,
      });
    },
  );
  function liveSnapshots(gameId: string): readonly PublicLiveGameSnapshot[] {
    return buildLiveGameSnapshots({
      possessionRecords: options.projections?.gameRecords(gameId) ?? [],
      ...(options.finalGameProjections?.game(gameId) === undefined
        ? {}
        : { finalizedGame: options.finalGameProjections.game(gameId)! }),
    });
  }
  app.get<{
    Params: { id: string };
    Querystring: { after?: string; limit?: string };
  }>("/v1/public/games/:id/snapshots", async (request, reply) => {
    const snapshots = liveSnapshots(request.params.id);
    const limit = /^\d+$/.test(request.query.limit ?? "")
      ? Math.min(500, Math.max(1, Number.parseInt(request.query.limit!, 10)))
      : 120;
    let selected: readonly PublicLiveGameSnapshot[];
    try {
      const after = request.query.after;
      const available = liveGameSnapshotsAfter(snapshots, after);
      selected =
        after === undefined
          ? available.slice(-limit)
          : available.slice(0, limit);
    } catch {
      return reply.code(409).send({
        error: "live_cursor_not_found",
        gameId: request.params.id,
      });
    }
    return {
      state,
      gameId: request.params.id,
      canonical: canonicalHistoryOpen,
      authoritative: canonicalHistoryOpen,
      historyClassification,
      recognitionLevel: launchState.recognitionLevel,
      snapshotFormat: "ABL-LIVE-GAME-SNAPSHOT-V1",
      items: classifyPublicItems({
        items: selected,
        canonicalHistoryOpen,
        historyClassification,
        recognitionLevel: launchState.recognitionLevel,
      }),
      nextCursor: selected.at(-1)?.cursor ?? null,
    };
  });
  app.get<{ Params: { id: string } }>(
    "/v1/public/games/:id/live",
    async (request, reply) => {
      const query = request.query as { after?: string };
      const lastEventId = request.headers["last-event-id"];
      const cursor =
        typeof lastEventId === "string" && lastEventId !== ""
          ? lastEventId
          : query.after;
      let snapshots: readonly PublicLiveGameSnapshot[];
      try {
        const available = liveGameSnapshotsAfter(
          liveSnapshots(request.params.id),
          cursor,
        );
        snapshots = cursor === undefined ? available.slice(-120) : available;
      } catch {
        return reply.code(409).send({
          error: "live_cursor_not_found",
          gameId: request.params.id,
        });
      }
      const frames = snapshots
        .map((snapshot) => {
          const publicSnapshot = classifyPublicValue({
            value: snapshot,
            canonicalHistoryOpen,
            historyClassification,
            recognitionLevel: launchState.recognitionLevel,
          });
          return `id: ${snapshot.cursor}\nevent: snapshot\ndata: ${JSON.stringify(publicSnapshot)}\n\n`;
        })
        .join("");
      const projection = options.finalGameProjections?.game(
        request.params.id,
      ) ??
        options.projections?.game(request.params.id) ?? {
          state,
          gameId: request.params.id,
          canonical: canonicalHistoryOpen,
        };
      const projectionState =
        "snapshots" in projection
          ? (({ snapshots: _snapshots, ...summary }) => summary)(projection)
          : projection;
      const publicProjection = classifyPublicValue({
        value: projectionState,
        canonicalHistoryOpen,
        historyClassification,
        recognitionLevel: launchState.recognitionLevel,
      });
      const stateFrame = `event: state\ndata: ${JSON.stringify(publicProjection)}\n\n`;
      const headCursor = snapshots.at(-1)?.cursor ?? cursor ?? null;
      return reply
        .headers({
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        })
        .type("text/event-stream; charset=utf-8")
        .send(
          `retry: 1500\n${stateFrame}${frames}event: heartbeat\ndata: ${JSON.stringify({ cursor: headCursor, content: null })}\n\n`,
        );
    },
  );
  return app;
}
