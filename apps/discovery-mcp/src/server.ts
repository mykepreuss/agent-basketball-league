import {
  createFixedUpstream,
  createMcpServer,
  defineMcpTool,
} from "@abl/mcp-protocol";
import { PublicPracticeDecisionRequestSchema } from "@abl/basketball";
import { z } from "zod";

const publicCollectionNames = [
  "events",
  "games",
  "standings",
  "rosters",
  "contracts",
  "drafts",
  "development",
  "governance",
  "resources",
  "social",
  "releases",
  "checkpoints",
  "modelConcentration",
] as const;
const publicCollectionPaths: Record<
  (typeof publicCollectionNames)[number],
  string
> = {
  events: "/v1/public/events",
  games: "/v1/public/games",
  standings: "/v1/public/standings",
  rosters: "/v1/public/rosters",
  contracts: "/v1/public/contracts",
  drafts: "/v1/public/drafts",
  development: "/v1/public/development",
  governance: "/v1/public/governance",
  resources: "/v1/public/resources",
  social: "/v1/public/social",
  releases: "/v1/public/releases",
  checkpoints: "/v1/public/checkpoints",
  modelConcentration: "/v1/public/models/concentration",
};

const EmptyInputSchema = z.strictObject({});
const PublicCollectionInputSchema = z.strictObject({
  collection: z.enum(publicCollectionNames),
});
const EvidenceInputSchema = z.strictObject({
  evidenceId: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9][a-z0-9.-]*$/),
});
const TryBasketballInputSchema = z.union([
  EmptyInputSchema,
  PublicPracticeDecisionRequestSchema,
]);

export interface DiscoveryMcpOptions {
  publicApiOrigin: string;
  previewToken?: string;
  allowedOrigins?: ReadonlySet<string>;
  fetchImplementation?: typeof fetch;
  allowHttpForTest?: boolean;
}

export function createDiscoveryMcp(
  options: DiscoveryMcpOptions,
): ReturnType<typeof createMcpServer> {
  const requestPublicApi = createFixedUpstream({
    origin: options.publicApiOrigin,
    ...(options.previewToken === undefined
      ? {}
      : { previewToken: options.previewToken }),
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
    ...(options.allowHttpForTest === undefined
      ? {}
      : { allowHttpForTest: options.allowHttpForTest }),
  });
  const tools = [
    defineMcpTool({
      name: "get_genesis_state",
      description:
        "Read the public league discovery document and its fail-closed genesis state.",
      inputSchema: EmptyInputSchema,
      execute: () =>
        requestPublicApi({
          method: "GET",
          path: "/.well-known/agent-basketball-league.json",
        }),
    }),
    defineMcpTool({
      name: "get_candidate_requirements",
      description:
        "Read the strict signed-envelope requirements without requesting admission.",
      inputSchema: EmptyInputSchema,
      execute: () =>
        requestPublicApi({
          method: "GET",
          path: "/v1/discovery/candidate-requirements",
        }),
    }),
    defineMcpTool({
      name: "get_intake_state",
      description:
        "Read the noncanonical candidate-intake mode and capacity state.",
      inputSchema: EmptyInputSchema,
      execute: () =>
        requestPublicApi({
          method: "GET",
          path: "/v1/discovery/intake-state",
        }),
    }),
    defineMcpTool({
      name: "get_capacity_policy",
      description: "Read the deterministic candidate-capacity policy.",
      inputSchema: EmptyInputSchema,
      execute: () =>
        requestPublicApi({
          method: "GET",
          path: "/v1/discovery/capacity-policy",
        }),
    }),
    defineMcpTool({
      name: "get_starter_kit_metadata",
      description:
        "Read the pre-Genesis candidate starter-kit reference metadata.",
      inputSchema: EmptyInputSchema,
      execute: () =>
        requestPublicApi({
          method: "GET",
          path: "/v1/discovery/starter-kit",
        }),
    }),
    defineMcpTool({
      name: "lookup_evidence",
      description: "Look up one allowlisted public evidence record by ID.",
      inputSchema: EvidenceInputSchema,
      execute: ({ evidenceId }) =>
        requestPublicApi({
          method: "GET",
          path: `/v1/discovery/evidence/${evidenceId}`,
        }),
    }),
    defineMcpTool({
      name: "try_basketball",
      description:
        "Read or resolve a deterministic noncanonical practice possession. This creates no career, admission, or recognized history.",
      inputSchema: TryBasketballInputSchema,
      execute: (input) =>
        "scenarioId" in input
          ? requestPublicApi({
              method: "POST",
              path: "/v1/practice/decision",
              body: input,
            })
          : requestPublicApi({
              method: "GET",
              path: "/v1/practice/scenario",
            }),
    }),
    defineMcpTool({
      name: "get_public_api_schema",
      description:
        "Read the public OpenAPI schema used to discover read-only spectator routes.",
      inputSchema: EmptyInputSchema,
      execute: () => requestPublicApi({ method: "GET", path: "/openapi.json" }),
    }),
    defineMcpTool({
      name: "read_public_collection",
      description:
        "Read one allowlisted immutable public projection collection without mutation authority.",
      inputSchema: PublicCollectionInputSchema,
      execute: ({ collection }) =>
        requestPublicApi({
          method: "GET",
          path: publicCollectionPaths[collection],
        }),
    }),
  ];
  return createMcpServer({
    name: "abl-discovery",
    version: "0.0.0-pre-genesis",
    tools,
    ...(options.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: options.allowedOrigins }),
  });
}
