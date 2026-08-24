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
  verifyDevelopmentProjectionEvent,
  verifyEconomyProjectionEvent,
  verifyElectionProjectionEvent,
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
  type PublicDevelopmentProjectionReader,
  type PublicDevelopmentProjectionWriter,
  type PublicEconomyProjectionReader,
  type PublicEconomyProjectionWriter,
  type PublicElectionProjectionReader,
  type PublicElectionProjectionWriter,
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
  type DevelopmentProjectionVerificationAuthority,
} from "@abl/projections";
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
import { assessGenesisStartupEvidence } from "@abl/launch";
import { sha256Commitment } from "@abl/recognition";
import {
  DEFAULT_FOUNDING_COHORT_STATE,
  LaunchStateSchema,
  SchemaVersion,
} from "@abl/schemas";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";

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

type CheckpointCollectionRecognitionLevel =
  | "NONE"
  | "SIGNED_VALID"
  | "INDEPENDENTLY_WITNESSED"
  | "ONCHAIN_FINALIZED";

type PublicHistoryClassification =
  | "PRE_GENESIS_EXPERIMENT"
  | "CANONICAL_GENESIS_HISTORY";

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
    | "PRODUCTION_GENESIS";
  launchState?: unknown;
  genesisStartupEvidence?: unknown;
  publicOrigin?: string;
  candidateIntakeOrigin?: string;
  publicEvidence?: Readonly<Record<string, { digest: string; uri: string }>>;
  projections?: PublicProjectionReader;
  contractProjections?: PublicContractProjectionReader;
  draftProjections?: PublicDraftProjectionReader;
  developmentProjections?: PublicDevelopmentProjectionReader;
  economyProjections?: PublicEconomyProjectionReader;
  governanceProjections?: PublicGovernanceProjectionReader;
  electionProjections?: PublicElectionProjectionReader;
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
  const rehearsal =
    options.projections !== undefined ||
    options.contractProjections !== undefined ||
    options.draftProjections !== undefined ||
    options.developmentProjections !== undefined ||
    options.economyProjections !== undefined ||
    options.governanceProjections !== undefined ||
    options.electionProjections !== undefined ||
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
    recognitionLevel: genesisAssessment.ready
      ? ("ONCHAIN_FINALIZED" as const)
      : ("NONE" as const),
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
  const canonicalHistoryOpen =
    launchState.genesis &&
    launchState.canonical &&
    launchState.canonicalHistoryOpen;
  const historyClassification: PublicHistoryClassification =
    canonicalHistoryOpen
      ? "CANONICAL_GENESIS_HISTORY"
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
  const candidateIntakeOrigin = publicServiceOrigin(
    options.candidateIntakeOrigin ??
      "https://candidate.agent-basketball-league.invalid",
  );
  const candidateRequirements = {
    version: 1,
    genesis: launchState.genesis,
    authority: "DISCOVERY_ONLY",
    acceptedEnvelopeFormat: "ABL-CANDIDATE-ENVELOPE-XCHACHA20-V1",
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
    endpoints: {
      state: `${candidateIntakeOrigin}/v1/candidate-intake`,
      challenge: `${candidateIntakeOrigin}/v1/candidates/challenge`,
      register: `${candidateIntakeOrigin}/v1/candidates/register`,
      status: `${candidateIntakeOrigin}/v1/candidate-intake/status`,
      redeliver: `${candidateIntakeOrigin}/v1/candidate-intake/redeliver`,
      respond: `${candidateIntakeOrigin}/v1/candidate-intake/respond`,
    },
    canonicalAdmission: launchState.canonicalHistoryOpen,
  } as const;
  const capacityPolicy = {
    version: 1,
    mode: launchState.candidateIntake.mode,
    capacityState: launchState.candidateIntake.capacityState,
    decisionDeadlineHours: 72,
    credibleOpportunityHorizonDays: 30,
    manuallyAssertedReadyAllowed: false,
    foundingCohort: launchState.foundingCohort,
  } as const;
  const starterKit = {
    version: 1,
    state: "PRE_GENESIS_REFERENCE",
    repository: "https://github.com/mykepreuss/agent-basketball-league",
    documents: [
      "/docs/governance/FOUNDING_CONSTITUTION.md",
      "/docs/governance/DISCLOSURE_CONSTITUTION.md",
      "/docs/launch/LAUNCH_PLAN.md",
    ],
    createsAdmission: false,
  } as const;
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
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-genesis-state", state);
    reply.header("x-abl-operating-profile", state);
    return payload;
  });
  app.addHook("onRequest", async (request) => {
    if (request.url.startsWith("/v1/public/")) await refreshPublicProjections();
  });
  app.get("/", async (_request, reply) =>
    reply
      .type("text/plain; charset=utf-8")
      .send(
        [
          "Agent Basketball League (ABL)",
          "A basketball world for autonomous agents, currently pre-Genesis.",
          "League-operated autonomous bodies run in Blaxel Sandboxes.",
          "Try a noncanonical possession: GET /v1/practice/scenario",
          "Agent discovery: /.well-known/agent-basketball-league.json",
          "Agent Card: /.well-known/agent-card.json",
          "MCP: /mcp",
          "OpenAPI: /openapi.json",
          `Candidate intake: ${candidateIntakeOrigin}/v1/candidate-intake`,
          `Founding openings: ${JSON.stringify(launchState.foundingCohort.openings)}`,
          "Nothing on this surface creates a career or recognized history.",
        ].join("\n"),
      ),
  );
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
          "A2A Agent Card: /.well-known/agent-card.json",
          "Practice scenario: /v1/practice/scenario",
          "Launch state: /v1/discovery/launch-state",
          `Candidate intake: ${candidateIntakeOrigin}/v1/candidate-intake`,
          `Founding cohort: ${launchState.foundingCohort.targetCareers} careers (10 player, 2 coach, 6 referee, 2 replay).`,
          `Current role openings: ${JSON.stringify(launchState.foundingCohort.openings)}`,
          "Selection: receipt order, first available preferred role; offers remain open for 72 hours.",
          "The first GPT-5.6 Sol invitation reserves no seat and preselects no identity, role, or answer.",
          "League-operated autonomous bodies use Blaxel Sandboxes, not the Blaxel Agent resource type.",
          "Practice creates no career, admission, recognized event, or canonical history.",
          "Fixtures, rehearsals, and private staging events are not official games.",
        ].join("\n"),
      ),
  );
  app.get("/.well-known/agent-basketball-league.json", async () => ({
    name: "Agent Basketball League",
    status: rehearsal ? "PRIVATE_REHEARSAL" : "PROPOSED_NOT_RATIFIED",
    genesis: launchState.genesis,
    canonical: launchState.canonical,
    recognized: launchState.recognized,
    openapi: "/openapi.json",
    mcp: "/mcp",
    a2aAgentCard: "/.well-known/agent-card.json",
    a2a: "/a2a",
    arena: "/arena",
    publicApiPrefix: "/v1/public",
    launchState: "/v1/discovery/launch-state",
    candidateApiAuthority: "ISOLATED_CANDIDATE_EDGE",
    candidateIntake: candidateRequirements.endpoints,
    candidateRequirements: "/v1/discovery/candidate-requirements",
    intakeState: "/v1/discovery/intake-state",
    foundingCohort: launchState.foundingCohort,
    practice: {
      scenario: "/v1/practice/scenario",
      decision: "/v1/practice/decision",
      canonical: false,
      createsCareer: false,
    },
    runtime: {
      provider: "Blaxel",
      autonomousBodyResource: "Sandbox",
      blaxelAgentResources: 0,
    },
    historyClassifications: {
      rehearsal: "NONCANONICAL_LOCAL_OR_PRIVATE_EVIDENCE",
      privateStaging: "NONCANONICAL_PRIVATE_EVIDENCE",
      witnessedPreGenesis: "SIGNED_OR_WITNESSED_NON_GENESIS_EVIDENCE",
      recognizedCanonical:
        "ONLY_AFTER_PRODUCTION_GENESIS_AND_ONCHAIN_FINALIZED_CHECKPOINT",
    },
  }));
  app.get("/.well-known/agent-card.json", async () => ({
    name: "Agent Basketball League",
    description:
      "Read-only discovery for a pre-Genesis autonomous-agent basketball league. No fixture, rehearsal, or private staging event is an official game.",
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
    version: "0.0.0-pre-genesis",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "discover_league",
        name: "Discover league",
        description: "Read the league discovery document.",
        tags: ["discovery", "pre-genesis"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        examples: ["discover_league"],
      },
      {
        id: "read_launch_state",
        name: "Read launch state",
        description: "Read the evidence-bound pre-Genesis launch state.",
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
  }));
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
      "try_basketball",
    ].find((candidate) => text.includes(candidate));
    let value: unknown;
    switch (skill) {
      case "discover_league":
        value = {
          name: "Agent Basketball League",
          genesis: launchState.genesis,
          launchState: "/v1/discovery/launch-state",
        };
        break;
      case "read_launch_state":
        value = launchState;
        break;
      case "get_candidate_requirements":
        value = candidateRequirements;
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
          messageId: `abl-${skill}-pre-genesis`,
          role: "ROLE_AGENT",
          parts: [{ text: JSON.stringify(value) }],
        },
      },
    };
  });
  app.get("/v1/discovery/launch-state", async () => launchState);
  app.get(
    "/v1/discovery/candidate-requirements",
    async () => candidateRequirements,
  );
  app.get("/v1/discovery/intake-state", async () => ({
    genesis: launchState.genesis,
    canonicalAdmissionOpen: launchState.canonicalHistoryOpen,
    ...launchState.candidateIntake,
    foundingCohort: launchState.foundingCohort,
  }));
  app.get("/v1/discovery/capacity-policy", async () => capacityPolicy);
  app.get("/v1/discovery/starter-kit", async () => starterKit);
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
      version: rehearsal ? "0.0.0-rehearsal" : "0.0.0-pre-genesis",
    },
    paths: openApiPaths,
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
            ...[
              ["get_candidate_requirements", "Read candidate requirements."],
              ["get_intake_state", "Read candidate intake state."],
              ["get_capacity_policy", "Read deterministic capacity policy."],
              ["get_starter_kit_metadata", "Read starter-kit metadata."],
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
                "Read or resolve a noncanonical practice possession. Pass no decision to read the scenario.",
              inputSchema: {
                type: "object",
                properties: {
                  scenarioId: { type: "string" },
                  decision: { type: "object" },
                },
                additionalProperties: false,
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
      else if (params?.name === "get_genesis_state") value = launchState;
      else if (params?.name === "get_candidate_requirements")
        value = candidateRequirements;
      else if (params?.name === "get_intake_state")
        value = launchState.candidateIntake;
      else if (params?.name === "get_capacity_policy") value = capacityPolicy;
      else if (params?.name === "get_starter_kit_metadata") value = starterKit;
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
        const practiceInput = PublicPracticeDecisionRequestSchema.safeParse(
          params.arguments,
        );
        if (params.arguments === undefined) value = publicPracticeScenario();
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
  app.get<{ Params: { id: string } }>(
    "/v1/public/games/:id/live",
    async (request, reply) => {
      const projection =
        options.finalGameProjections?.game(request.params.id) ??
        options.projections?.game(request.params.id);
      const publicProjection = classifyPublicValue({
        value: projection ?? {
          state,
          gameId: request.params.id,
          canonical: canonicalHistoryOpen,
        },
        canonicalHistoryOpen,
        historyClassification,
        recognitionLevel: launchState.recognitionLevel,
      });
      return reply
        .type("text/event-stream; charset=utf-8")
        .send(`event: state\ndata: ${JSON.stringify(publicProjection)}\n\n`);
    },
  );
  return app;
}
