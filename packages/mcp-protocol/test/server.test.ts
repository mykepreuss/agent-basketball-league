import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MCP_PROTOCOL_VERSION,
  McpToolExecutionError,
  createMcpServer,
  defineMcpTool,
} from "../src/index.js";

function createTestServer() {
  return createMcpServer({
    name: "test-mcp",
    version: "1.0.0",
    allowedOrigins: new Set(["https://arena.example"]),
    tools: [
      defineMcpTool({
        name: "echo",
        description: "Echo a bounded value.",
        inputSchema: z.strictObject({ value: z.string().min(1).max(20) }),
        execute: ({ value }) => ({ value }),
      }),
      defineMcpTool({
        name: "reject",
        description: "Return a structured application error.",
        inputSchema: z.strictObject({}),
        execute: () => {
          throw new McpToolExecutionError({ error: "rejected", status: 409 });
        },
      }),
    ],
  });
}

describe("MCP streamable HTTP server", () => {
  it("negotiates the stable protocol and exposes strict tool schemas", async () => {
    const app = createTestServer();
    const initialized = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
    });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.json().result.protocolVersion).toBe(
      MCP_PROTOCOL_VERSION,
    );
    const listed = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(listed.json().result.tools[0].inputSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["value"],
    });
    await app.close();
  });

  it("validates origins, protocol headers, and tool inputs", async () => {
    const app = createTestServer();
    const denied = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { origin: "https://attacker.example" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(denied.statusCode).toBe(403);
    const missingVersion = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(missingVersion.statusCode).toBe(400);
    const invalidInitialize = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
    });
    expect(invalidInitialize.statusCode).toBe(400);
    const invalid = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "echo", arguments: {} },
      },
    });
    expect(invalid.json().result).toMatchObject({ isError: true });
    await app.close();
  });

  it("executes tools and accepts initialized notifications", async () => {
    const app = createTestServer();
    const called = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: { name: "echo", arguments: { value: "hello" } },
      },
    });
    expect(called.json().result.structuredContent).toEqual({ value: "hello" });
    const rejected = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: "call-2",
        method: "tools/call",
        params: { name: "reject", arguments: {} },
      },
    });
    expect(rejected.json().result).toMatchObject({
      isError: true,
      structuredContent: { error: "rejected", status: 409 },
    });
    const notification = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    expect(notification.statusCode).toBe(202);
    expect(notification.body).toBe("");
    const serverEvents = await app.inject({ method: "GET", url: "/mcp" });
    expect(serverEvents.statusCode).toBe(405);
    expect(serverEvents.headers.allow).toBe("POST");
    await app.close();
  });
});
