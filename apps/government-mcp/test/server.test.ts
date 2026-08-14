import { MCP_PROTOCOL_VERSION } from "@abl/mcp-protocol";
import { describe, expect, it, vi } from "vitest";

import { createGovernmentMcp } from "../src/server.js";

const command = {
  event: {
    eventId: "0198f100-0000-7000-8000-000000000091",
    actorDid: "did:abl:voter-1",
    nonce: "governance-1",
    idempotencyKey: "0198f100-0000-7000-8000-000000000092",
    aggregateType: "governance-proposal",
    aggregateId: "proposal-1",
    aggregateVersion: "1",
    eventType: "GovernanceProposalRegistered",
    previousEventHash: null,
    payloadCommitment: `0x${"1".repeat(64)}`,
    payload: {},
    stateRoot: `0x${"2".repeat(64)}`,
    schemaDigest: `0x${"3".repeat(64)}`,
    timestamp: "2026-08-13T10:00:00.000Z",
    eventHash: `0x${"4".repeat(64)}`,
  },
  signatures: [`0x${"5".repeat(130)}`],
};

describe("government MCP", () => {
  it("forwards signed commands unchanged over a fixed route", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ accepted: true, canonical: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const app = createGovernmentMcp({
      coreOrigin: "http://core.test",
      coreCredential: "government-credential",
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
          name: "register_proposal",
          arguments: { command },
        },
      },
    });
    expect(response.json().result.structuredContent).toEqual({
      ok: true,
      status: 201,
      body: { accepted: true, canonical: true },
    });
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      "http://core.test/v1/governance/proposals/register",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer government-credential",
    );
    expect(JSON.parse(String(init?.body))).toEqual(command);
    await app.close();
  });

  it("does not accept an unsigned ballot", async () => {
    const app = createGovernmentMcp({
      coreOrigin: "http://core.test",
      coreCredential: "government-credential",
      fetchImplementation: vi.fn<typeof fetch>(),
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
          name: "cast_ballot",
          arguments: { command: { event: command.event, signatures: [] } },
        },
      },
    });
    expect(response.json().result).toMatchObject({ isError: true });
    await app.close();
  });
});
