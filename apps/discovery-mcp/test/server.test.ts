import { MCP_PROTOCOL_VERSION } from "@abl/mcp-protocol";
import { describe, expect, it, vi } from "vitest";

import { createDiscoveryMcp } from "../src/server.js";

describe("discovery MCP", () => {
  it("reads only allowlisted public API paths", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async (url) =>
        new Response(JSON.stringify({ requested: String(url) }), {
          status: 200,
        }),
    );
    const app = createDiscoveryMcp({
      publicApiOrigin: "http://public.test",
      fetchImplementation,
      allowHttpForTest: true,
    });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_public_collection",
          arguments: { collection: "development" },
        },
      },
    });
    expect(response.json().result.structuredContent.body.requested).toBe(
      "http://public.test/v1/public/development",
    );
    expect(
      new Headers(fetchImplementation.mock.calls[0]![1]?.headers).has(
        "authorization",
      ),
    ).toBe(false);
    await app.close();
  });

  it("rejects arbitrary public paths", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const app = createDiscoveryMcp({
      publicApiOrigin: "http://public.test",
      fetchImplementation,
      allowHttpForTest: true,
    });
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "read_public_collection",
          arguments: { collection: "../../v1/commands" },
        },
      },
    });
    expect(response.json().result).toMatchObject({ isError: true });
    expect(fetchImplementation).not.toHaveBeenCalled();
    await app.close();
  });
});
