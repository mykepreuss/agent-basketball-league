import { MCP_PROTOCOL_VERSION } from "@abl/mcp-protocol";
import {
  possessionInputToWire,
  runFirstPossessionRehearsal,
} from "@abl/basketball";
import { describe, expect, it } from "vitest";

import { createBasketballMcp } from "../src/server.js";

const input = {
  gameId: "0198f100-0000-7000-8000-000000000081",
  roster: {
    home: ["H1", "H2", "H3", "H4", "H5"],
    away: ["A1", "A2", "A3", "A4", "A5"],
  },
  active: {
    home: ["H1", "H2", "H3", "H4", "H5"],
    away: ["A1", "A2", "A3", "A4", "A5"],
  },
  openingPossession: "HOME",
} as const;

describe("basketball MCP", () => {
  it("publishes strict schemas for every basketball tool", async () => {
    const app = createBasketballMcp();
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: { jsonrpc: "2.0", id: "list-1", method: "tools/list" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.tools).toHaveLength(4);
    expect(
      response
        .json()
        .result.tools.every(
          (tool: { inputSchema: { additionalProperties?: boolean } }) =>
            tool.inputSchema.additionalProperties === false,
        ),
    ).toBe(true);
    await app.close();
  });

  it("verifies every autonomous role and resolves a signed possession", async () => {
    const rehearsal = await runFirstPossessionRehearsal({ windowCount: 2 });
    const possession = possessionInputToWire(rehearsal.input);
    const app = createBasketballMcp();
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: "possession-1",
        method: "tools/call",
        params: {
          name: "resolve_signed_possession",
          arguments: { possession },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.structuredContent).toMatchObject({
      finalStateRoot: rehearsal.result.finalStateRoot,
      eventMerkleRoot: rehearsal.result.eventMerkleRoot,
      filmCommitment: rehearsal.result.filmCommitment,
      inferenceInvocations: 0,
    });
    const tampered = structuredClone(possession);
    const signature = tampered.windows[0]!.coaches[0]!.signature;
    tampered.windows[0]!.coaches[0]!.signature =
      `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}` as typeof signature;
    const denied = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: "possession-2",
        method: "tools/call",
        params: {
          name: "resolve_signed_possession",
          arguments: { possession: tampered },
        },
      },
    });
    expect(denied.json().result).toMatchObject({ isError: true });
    await app.close();
  });

  it("resolves commands deterministically without model inference", async () => {
    const app = createBasketballMcp();
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "resolve_game_commands",
          arguments: {
            input,
            commands: [
              {
                type: "SHOT",
                team: "HOME",
                playerId: "H1",
                points: 2,
                made: true,
              },
            ],
          },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.structuredContent).toMatchObject({
      state: { score: { home: 2, away: 0 } },
      commandCount: 1,
      inferenceInvocations: 0,
    });
    await app.close();
  });

  it("fails closed on invalid basketball input", async () => {
    const app = createBasketballMcp();
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "resolve_game_commands",
          arguments: { input, commands: [{ type: "SET_WINNER" }] },
        },
      },
    });
    expect(response.json().result).toMatchObject({ isError: true });
    await app.close();
  });
});
