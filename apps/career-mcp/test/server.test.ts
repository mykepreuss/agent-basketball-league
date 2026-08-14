import { MCP_PROTOCOL_VERSION } from "@abl/mcp-protocol";
import { describe, expect, it, vi } from "vitest";

import { createCareerMcp } from "../src/server.js";

function signedCommand(eventType: string, aggregateType: string) {
  return {
    event: {
      eventId: "0198f100-0000-7000-8000-0000000000a1",
      actorDid: "did:abl:candidate-1",
      nonce: "career-1",
      idempotencyKey: "0198f100-0000-7000-8000-0000000000a2",
      aggregateType,
      aggregateId: "did:abl:candidate-1",
      aggregateVersion: "1",
      eventType,
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
}

function call(name: string, argumentsValue: unknown) {
  return {
    method: "POST" as const,
    url: "/mcp",
    headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: argumentsValue },
    },
  };
}

describe("career MCP", () => {
  it("exposes challenge and status reads through fixed core routes", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async (url) =>
        new Response(JSON.stringify({ target: String(url) }), { status: 200 }),
    );
    const app = createCareerMcp({
      coreOrigin: "http://core.test",
      coreCredential: "career-credential",
      fetchImplementation,
      allowHttpForTest: true,
    });
    const challenge = await app.inject(
      call("request_candidate_challenge", {
        candidateDid: "did:abl:candidate-1",
      }),
    );
    expect(challenge.json().result.structuredContent).toMatchObject({
      status: 200,
    });
    const status = await app.inject(
      call("get_candidate_status", { candidateDid: "did:abl:candidate-1" }),
    );
    expect(status.json().result.structuredContent.body.target).toBe(
      "http://core.test/v1/candidates/status?candidateDid=did%3Aabl%3Acandidate-1",
    );
    await app.close();
  });

  it("derives transition routes from strict signed event types", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ accepted: true }), { status: 201 }),
    );
    const app = createCareerMcp({
      coreOrigin: "http://core.test",
      coreCredential: "career-credential",
      fetchImplementation,
      allowHttpForTest: true,
    });
    const command = signedCommand("BodyRehydrationRecorded", "body-continuity");
    const response = await app.inject(
      call("submit_continuity_transition", { command }),
    );
    expect(response.json().result.structuredContent).toMatchObject({
      ok: true,
      status: 201,
    });
    expect(String(fetchImplementation.mock.calls[0]![0])).toBe(
      "http://core.test/v1/continuity/rehydrate",
    );
    const denied = await app.inject(
      call("submit_continuity_transition", {
        command: signedCommand("UnexpectedEvent", "body-continuity"),
      }),
    );
    expect(denied.json().result).toMatchObject({ isError: true });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
