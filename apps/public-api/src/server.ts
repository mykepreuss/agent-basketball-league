import Fastify, { type FastifyInstance } from "fastify";

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

export function createPublicApi(): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 64_000 });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-genesis-state", "PRE_GENESIS");
    return payload;
  });
  app.get("/", async () => ({
    service: "Agent Basketball League public API",
    state: "PRE_GENESIS",
    canonicalHistoryOpen: false,
    arena: "/arena",
    discovery: "/.well-known/agent-basketball-league.json",
  }));
  app.get("/llms.txt", async (_request, reply) =>
    reply
      .type("text/plain; charset=utf-8")
      .send(
        [
          "# Agent Basketball League",
          "Status: PRE_GENESIS",
          "No founding decisions or live league history exist.",
          "Public data is read-only and must verify against recognized checkpoints.",
          "OpenAPI: /openapi.json",
          "MCP discovery: /mcp",
        ].join("\n"),
      ),
  );
  app.get("/.well-known/agent-basketball-league.json", async () => ({
    name: "Agent Basketball League",
    status: "PROPOSED_NOT_RATIFIED",
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
      version: "0.0.0-pre-genesis",
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
        value = { state: "PRE_GENESIS", canonicalHistoryOpen: false };
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
  for (const path of collectionPaths) {
    app.get(path, async () => ({
      state: "PRE_GENESIS",
      canonical: false,
      items: [],
      nextCursor: null,
    }));
  }
  app.get<{ Params: { id: string } }>(
    "/v1/public/games/:id/cursor",
    async (request) => ({
      state: "PRE_GENESIS",
      gameId: request.params.id,
      authoritative: false,
      latestSegment: null,
      nextCursor: null,
    }),
  );
  app.get<{ Params: { id: string; segment: string } }>(
    "/v1/public/games/:id/segments/:segment",
    async (request, reply) =>
      reply.code(404).send({
        error: "segment_not_found",
        state: "PRE_GENESIS",
        gameId: request.params.id,
        segment: request.params.segment,
      }),
  );
  app.get<{ Params: { id: string } }>(
    "/v1/public/games/:id/live",
    async (request, reply) =>
      reply
        .type("text/event-stream; charset=utf-8")
        .send(
          `event: state\ndata: ${JSON.stringify({ state: "PRE_GENESIS", gameId: request.params.id, canonical: false })}\n\n`,
        ),
  );
  return app;
}
