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
      previewToken: "private-preview",
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
    expect(
      new Headers(fetchImplementation.mock.calls[0]![1]?.headers).get(
        "x-blaxel-preview-token",
      ),
    ).toBe("private-preview");
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

  it("exposes the complete read-only launch discovery tool set", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (url) =>
      Promise.resolve(
        new Response(JSON.stringify({ requested: String(url) }), {
          status: 200,
        }),
      ),
    );
    const app = createDiscoveryMcp({
      publicApiOrigin: "http://public.test",
      fetchImplementation,
      allowHttpForTest: true,
    });
    const tools = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: { jsonrpc: "2.0", id: 3, method: "tools/list" },
    });
    expect(
      tools
        .json()
        .result.tools.map(({ name }: { name: string }) => name)
        .sort(),
    ).toEqual(
      [
        "get_capacity_policy",
        "get_candidate_requirements",
        "get_founding_join_kit",
        "get_genesis_state",
        "get_intake_state",
        "get_participant_runner_kit",
        "get_public_api_schema",
        "get_starter_kit_metadata",
        "lookup_evidence",
        "read_public_collection",
        "try_basketball",
      ].sort(),
    );
    const evidence = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "lookup_evidence",
          arguments: { evidenceId: "gate-1-exact-runtime" },
        },
      },
    });
    expect(evidence.json().result.structuredContent.body.requested).toBe(
      "http://public.test/v1/discovery/evidence/gate-1-exact-runtime",
    );
    const practice = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "try_basketball", arguments: {} },
      },
    });
    expect(practice.json().result.structuredContent.body.requested).toBe(
      "http://public.test/v1/practice/scenario",
    );
    await app.close();
  });
});
