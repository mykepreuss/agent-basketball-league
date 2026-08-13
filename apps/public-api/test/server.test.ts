import { describe, expect, it } from "vitest";

import { PUBLIC_ROUTE_CATALOG, createPublicApi } from "../src/server.js";

describe("public API", () => {
  it("serves discovery, OpenAPI, and MCP without claiming genesis", async () => {
    const app = createPublicApi();
    const discovery = await app.inject({
      method: "GET",
      url: "/.well-known/agent-basketball-league.json",
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      status: "PROPOSED_NOT_RATIFIED",
      genesis: false,
    });
    const openApi = await app.inject({ method: "GET", url: "/openapi.json" });
    const paths = openApi.json().paths as Record<string, object>;
    expect(Object.keys(paths)).toHaveLength(18);
    expect(Object.keys(paths["/mcp"] ?? {}).sort()).toEqual(["get", "post"]);
    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(mcp.json().result.tools).toHaveLength(2);
    await app.close();
  });

  it("keeps every projection read-only, empty, and noncanonical before genesis", async () => {
    const app = createPublicApi();
    for (const route of PUBLIC_ROUTE_CATALOG.filter(
      (entry) =>
        entry.exposure === "PUBLIC_READ_ONLY" &&
        !entry.path.includes(":segment") &&
        !entry.path.endsWith("/live"),
    )) {
      const response = await app.inject({
        method: route.method,
        url: route.path.replace(":id", "game-1"),
      });
      expect(response.statusCode, route.path).toBe(200);
      expect(response.headers["x-abl-genesis-state"]).toBe("PRE_GENESIS");
      expect(response.body).not.toMatch(/private|credential|database_url/i);
    }
    const live = await app.inject({
      method: "GET",
      url: "/v1/public/games/game-1/live",
    });
    expect(live.headers["content-type"]).toContain("text/event-stream");
    expect(live.body).toContain('"canonical":false');
    await app.close();
  });

  it("rejects malformed MCP and never exposes a mutation route", async () => {
    const app = createPublicApi();
    expect(
      (await app.inject({ method: "POST", url: "/mcp", payload: {} }))
        .statusCode,
    ).toBe(400);
    const unknownTool = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "unknown_tool" },
      },
    });
    expect(unknownTool.statusCode).toBe(400);
    expect(unknownTool.json()).toMatchObject({ error: { code: -32602 } });
    expect(
      PUBLIC_ROUTE_CATALOG.every(
        (route) => route.method === "GET" || route.path === "/mcp",
      ),
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/internal/projections",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("serves verified rehearsal contracts from the durable projection reader", async () => {
    let refreshes = 0;
    const app = createPublicApi({
      contractProjections: {
        refresh: async () => {
          refreshes += 1;
        },
        contracts: () => [
          {
            state: "REHEARSAL",
            canonical: true,
            verification: "CANONICAL_LOCAL_REHEARSAL",
            playerDid: "did:abl:player-public-contract",
            aggregateVersion: "2",
            canonicalEventHash: `0x${"a".repeat(64)}`,
            stateRoot: `0x${"b".repeat(64)}`,
            contracts: [],
            projectedAt: "2026-08-13T10:00:00.000Z",
          },
        ],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/contracts",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-genesis-state"]).toBe("REHEARSAL");
    expect(response.json()).toMatchObject({
      state: "REHEARSAL",
      canonical: true,
      items: [
        {
          playerDid: "did:abl:player-public-contract",
          aggregateVersion: "2",
          canonical: true,
        },
      ],
    });
    expect(refreshes).toBe(1);
    await app.close();
  });
});
