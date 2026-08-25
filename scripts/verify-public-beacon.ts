import { z } from "zod";

const [apiInput, arenaInput, expectedRevision] = process.argv.slice(2);
if (!apiInput || !arenaInput || !expectedRevision)
  throw new Error(
    "Usage: verify-public-beacon <public-api-origin> <arena-origin> <release-commit>",
  );
if (!/^[0-9a-f]{40}$/.test(expectedRevision))
  throw new Error("Release commit must be a full lowercase Git commit hash");

function parsePublicOrigin(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("Beacon origins must be credential-free HTTPS origins");
  return url.origin;
}

const apiOrigin = parsePublicOrigin(apiInput);
const arenaOrigin = parsePublicOrigin(arenaInput);
const observedPaths: string[] = [];

async function response(path: string, init?: RequestInit): Promise<Response> {
  const result = await fetch(`${apiOrigin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  if (result.status !== 200)
    throw new Error(`Beacon path ${path} returned HTTP ${result.status}`);
  observedPaths.push(path);
  return result;
}

async function json(path: string, init?: RequestInit): Promise<unknown> {
  return (await response(path, init)).json();
}

async function requireDenied(
  target: string,
  expectedStatus: number,
  init: RequestInit,
): Promise<void> {
  const result = await fetch(target, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  await result.body?.cancel();
  if (result.status !== expectedStatus)
    throw new Error(
      `Private mutation denial returned HTTP ${result.status}; expected ${expectedStatus}`,
    );
}

const root = await (await response("/")).text();
if (
  !root.includes("Agent Basketball League (ABL)") ||
  !root.includes("currently pre-Genesis") ||
  !root.includes(
    "Nothing on this surface creates a career or recognized history",
  )
)
  throw new Error("Public root omits the required pre-Genesis guidance");

const llms = await (await response("/llms.txt")).text();
if (
  !llms.includes("Agent Basketball League") ||
  !llms.includes("Practice creates no career")
)
  throw new Error("llms.txt omits the required pre-Genesis guidance");

z.object({
  status: z.literal("READ_ONLY_BEACON"),
  launch: z.object({
    launchStage: z.literal("READ_ONLY_BEACON"),
    operatingProfile: z.literal("PRE_GENESIS_REHEARSAL"),
    recognitionLevel: z.literal("SIGNED_VALID"),
    publicExposure: z.literal("READ_ONLY"),
    genesis: z.literal(false),
    canonical: z.literal(false),
  }),
  genesis: z.literal(false),
  canonical: z.literal(false),
  arena: z.literal(`${arenaOrigin}/arena`),
  starterKit: z.literal(`${apiOrigin}/v1/discovery/starter-kit`),
  llms: z.literal(`${apiOrigin}/llms.txt`),
  mcp: z.literal(`${apiOrigin}/mcp`),
  candidateRequirements: z.literal(
    `${apiOrigin}/v1/discovery/candidate-requirements`,
  ),
  practice: z.object({
    scenario: z.literal(`${apiOrigin}/v1/practice/scenario`),
    decision: z.literal(`${apiOrigin}/v1/practice/decision`),
    schema: z.literal(
      `${apiOrigin}/openapi.json#/components/schemas/PublicPracticeDecisionRequest`,
    ),
    canonical: z.literal(false),
    createsCareer: z.literal(false),
  }),
})
  .passthrough()
  .parse(await json("/.well-known/agent-basketball-league.json"));

const agentCard = z
  .object({
    version: z.string(),
    skills: z.array(z.object({ id: z.string() })).min(4),
  })
  .passthrough()
  .parse(await json("/.well-known/agent-card.json"));
if (!agentCard.skills.some(({ id }) => id === "try_basketball"))
  throw new Error("A2A Agent Card omits the practice skill");

z.object({
  launchStage: z.literal("READ_ONLY_BEACON"),
  operatingProfile: z.literal("PRE_GENESIS_REHEARSAL"),
  recognitionLevel: z.literal("SIGNED_VALID"),
  publicExposure: z.literal("READ_ONLY"),
  genesis: z.literal(false),
  canonical: z.literal(false),
  canonicalHistoryOpen: z.literal(false),
})
  .passthrough()
  .parse(await json("/v1/discovery/launch-state"));

const candidateRequirements = z
  .object({
    authority: z.literal("DISCOVERY_ONLY"),
    endpoints: z.object({
      state: z.string().url(),
      register: z.string().url(),
    }),
    canonicalAdmission: z.literal(false),
    rateLimits: z.object({
      exceededStatus: z.literal(429),
      retryHeader: z.literal("Retry-After"),
    }),
  })
  .passthrough()
  .parse(await json("/v1/discovery/candidate-requirements"));
for (const candidateEndpoint of Object.values(
  candidateRequirements.endpoints,
)) {
  const endpoint = new URL(candidateEndpoint);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.origin === apiOrigin ||
    endpoint.origin === arenaOrigin
  )
    throw new Error("Candidate endpoint is not an isolated HTTPS surface");
}
await requireDenied(candidateRequirements.endpoints.register, 401, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
await requireDenied(`${apiOrigin}/v1/internal/projections`, 403, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});

const sourceTreeRoot = `https://github.com/mykepreuss/agent-basketball-league/tree/${expectedRevision}`;
const sourceBlobRoot = `https://github.com/mykepreuss/agent-basketball-league/blob/${expectedRevision}`;
const sourceRawRoot = `https://raw.githubusercontent.com/mykepreuss/agent-basketball-league/${expectedRevision}`;
const starterKit = z
  .object({
    version: z.literal(2),
    schemaVersion: z.literal("2.0.0"),
    state: z.literal("PRE_GENESIS_REFERENCE"),
    status: z.object({
      launchStage: z.literal("READ_ONLY_BEACON"),
      publicExposure: z.literal("READ_ONLY"),
      recognitionLevel: z.literal("SIGNED_VALID"),
      genesis: z.literal(false),
      canonical: z.literal(false),
    }),
    sourceRevision: z.literal(expectedRevision),
    sourceIntegrity: z.object({
      immutable: z.literal(true),
      value: z.literal(expectedRevision),
    }),
    origins: z.object({
      publicApi: z.literal(apiOrigin),
      arena: z.literal(`${arenaOrigin}/arena`),
    }),
    startHere: z.array(
      z.object({
        step: z.number().int().positive(),
        id: z.string(),
        method: z.enum(["GET", "POST"]),
        url: z.string().url(),
      }),
    ),
    artifacts: z.object({
      skill: z.object({
        source: z.literal(`${sourceTreeRoot}/skills/abl-league`),
        entrypoint: z.literal(`${sourceBlobRoot}/skills/abl-league/SKILL.md`),
        rawEntrypoint: z.literal(`${sourceRawRoot}/skills/abl-league/SKILL.md`),
      }),
      verifier: z.object({
        source: z.literal(`${sourceTreeRoot}/packages/recognition`),
        rules: z.literal(
          `${sourceBlobRoot}/docs/architecture/VERIFIER_RULES.md`,
        ),
      }),
    }),
    documents: z
      .array(
        z.object({
          source: z.string().startsWith(`${sourceBlobRoot}/`),
          raw: z.string().startsWith(`${sourceRawRoot}/`),
        }),
      )
      .min(3),
    practice: z.object({
      scenario: z.literal(`${apiOrigin}/v1/practice/scenario`),
      decision: z.literal(`${apiOrigin}/v1/practice/decision`),
      canonical: z.literal(false),
      createsCareer: z.literal(false),
      createsAdmission: z.literal(false),
      createsPublicHistory: z.literal(false),
    }),
    createsAdmission: z.literal(false),
  })
  .passthrough()
  .parse(await json("/v1/discovery/starter-kit"));
const scenarioStep = starterKit.startHere.find(
  ({ id }) => id === "read-practice-scenario",
);
const decisionStep = starterKit.startHere.find(
  ({ id }) => id === "submit-practice-decision",
);
if (
  scenarioStep?.url !== starterKit.practice.scenario ||
  decisionStep?.url !== starterKit.practice.decision
)
  throw new Error("Starter-kit onboarding sequence drifted");

const openApi = z
  .object({ paths: z.record(z.string(), z.unknown()) })
  .passthrough()
  .parse(await json("/openapi.json"));
const rootOperation = openApi.paths["/"] as
  | { get?: { responses?: Record<string, unknown> } }
  | undefined;
if (rootOperation?.get?.responses?.["429"] === undefined)
  throw new Error("OpenAPI omits the public 429 response");
const practiceDecisionOperation = openApi.paths["/v1/practice/decision"] as
  | {
      post?: {
        requestBody?: unknown;
        responses?: Record<string, unknown>;
      };
    }
  | undefined;
if (
  practiceDecisionOperation?.post?.requestBody === undefined ||
  practiceDecisionOperation.post.responses?.["200"] === undefined ||
  practiceDecisionOperation.post.responses?.["400"] === undefined
)
  throw new Error("OpenAPI omits the executable practice contract");

const robots = await (await response("/robots.txt")).text();
if (!robots.includes(`Sitemap: ${apiOrigin}/sitemap.xml`))
  throw new Error("robots.txt omits the canonical sitemap");
const sitemap = await (await response("/sitemap.xml")).text();
if (!sitemap.includes(`<loc>${apiOrigin}/v1/discovery/starter-kit</loc>`))
  throw new Error("Sitemap omits the starter kit");
const cors = await fetch(`${apiOrigin}/v1/practice/scenario`, {
  method: "OPTIONS",
  headers: {
    origin: "https://agent-client.example",
    "access-control-request-method": "GET",
  },
  signal: AbortSignal.timeout(30_000),
});
await cors.body?.cancel();
const allowCredentials = cors.headers.get("access-control-allow-credentials");
if (
  cors.status < 200 ||
  cors.status >= 300 ||
  cors.headers.get("access-control-allow-origin") !== "*" ||
  (allowCredentials !== null && allowCredentials !== "false")
)
  throw new Error("Public API CORS policy is not credential-free");

const tools = z
  .object({
    result: z.object({ tools: z.array(z.object({ name: z.string() })).min(8) }),
  })
  .passthrough()
  .parse(
    await json("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
if (!tools.result.tools.some(({ name }) => name === "try_basketball"))
  throw new Error("Discovery MCP omits try_basketball");

const scenario = z
  .object({
    scenarioId: z.string(),
    practice: z.literal(true),
    canonical: z.literal(false),
    createsCareer: z.literal(false),
    decisionRequirements: z.object({
      playerId: z.string(),
      windowId: z.string(),
    }),
  })
  .passthrough()
  .parse(await json("/v1/practice/scenario"));
z.object({
  practice: z.literal(true),
  canonical: z.literal(false),
  recognition: z.literal("NONE"),
  recognizedGameMutation: z.literal(false),
  createsCareer: z.literal(false),
  createsPublicHistory: z.literal(false),
  inferenceInvocations: z.literal(0),
})
  .passthrough()
  .parse(
    await json("/v1/practice/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: scenario.scenarioId,
        decision: {
          playerId: scenario.decisionRequirements.playerId,
          windowId: scenario.decisionRequirements.windowId,
          action: "SHOOT",
          shot: "LAYUP",
        },
      }),
    }),
  );

const arena = await fetch(`${arenaOrigin}/arena`, {
  signal: AbortSignal.timeout(30_000),
});
if (arena.status !== 200)
  throw new Error(`Arena returned HTTP ${arena.status}`);
const arenaHtml = await arena.text();
if (!arenaHtml.includes("PRE_GENESIS_EXPERIMENT"))
  throw new Error("Arena omits the pre-Genesis classification");

process.stdout.write(
  `${JSON.stringify({
    status: "PASS",
    evidenceClass: "LIVE_PUBLIC_BEACON_PROTOCOL",
    releaseId: expectedRevision,
    publicExposure: "READ_ONLY",
    historyClassification: "PRE_GENESIS_EXPERIMENT",
    recognitionLevel: "SIGNED_VALID",
    observedApiPaths: [...new Set(observedPaths)].sort(),
    arenaVerified: true,
    candidateMutationSubmissionAttempted: false,
    candidateMutationDenialVerified: true,
    internalProjectionMutationDenialVerified: true,
    credentialsUsed: false,
    modelInvocations: 0,
    secretValuesPrinted: false,
  })}\n`,
);
