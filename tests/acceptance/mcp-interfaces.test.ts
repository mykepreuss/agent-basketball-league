import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { createBasketballMcp } from "../../apps/basketball-mcp/src/server.js";
import { createCareerMcp } from "../../apps/career-mcp/src/server.js";
import { createCoreApi } from "../../apps/core-api/src/server.js";
import { createDiscoveryMcp } from "../../apps/discovery-mcp/src/server.js";
import { createGovernmentMcp } from "../../apps/government-mcp/src/server.js";
import { createPublicApi } from "../../apps/public-api/src/server.js";
import {
  possessionInputToWire,
  runFirstPossessionRehearsal,
} from "../../packages/basketball/src/index.js";
import { MCP_PROTOCOL_VERSION } from "../../packages/mcp-protocol/src/index.js";

function callTool(name: string, argumentsValue: unknown, id: number) {
  return {
    method: "POST" as const,
    url: "/mcp",
    headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION },
    payload: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: argumentsValue },
    },
  };
}

function origin(server: { address(): AddressInfo | string | null }): string {
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Test service did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

function signedGovernmentCommand() {
  return {
    event: {
      eventId: "0198f100-0000-7000-8000-0000000000b1",
      actorDid: "did:abl:voter-1",
      nonce: "government-interface-1",
      idempotencyKey: "0198f100-0000-7000-8000-0000000000b2",
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
}

describe("actual MCP service interfaces", () => {
  it("crosses real public/core sockets and resolves signed basketball", async () => {
    const core = createCoreApi({
      now: () => Date.parse("2026-08-13T10:00:00.000Z"),
      challengeId: () => "mcp-challenge-1",
      challengeBytes: () => new Uint8Array(32).fill(9),
    });
    const publicApi = createPublicApi();
    await Promise.all([
      core.listen({ host: "127.0.0.1", port: 0 }),
      publicApi.listen({ host: "127.0.0.1", port: 0 }),
    ]);
    const career = createCareerMcp({
      coreOrigin: origin(core.server),
      coreCredential: "acceptance-career-credential",
      allowHttpForTest: true,
    });
    const government = createGovernmentMcp({
      coreOrigin: origin(core.server),
      coreCredential: "acceptance-government-credential",
      allowHttpForTest: true,
    });
    const discovery = createDiscoveryMcp({
      publicApiOrigin: origin(publicApi.server),
      allowHttpForTest: true,
    });
    const basketball = createBasketballMcp();
    try {
      const challenge = await career.inject(
        callTool(
          "request_candidate_challenge",
          { candidateDid: "did:abl:mcp-candidate" },
          1,
        ),
      );
      expect(challenge.json().result.structuredContent).toMatchObject({
        ok: true,
        status: 200,
        body: {
          challengeId: "mcp-challenge-1",
          candidateDid: "did:abl:mcp-candidate",
          grantsAdmission: false,
        },
      });

      const genesis = await discovery.inject(
        callTool("get_genesis_state", {}, 2),
      );
      expect(genesis.json().result.structuredContent).toMatchObject({
        ok: true,
        status: 200,
        body: {
          genesis: false,
          status: "LOCAL_GATE_1",
          launch: {
            launchStage: "LOCAL_GATE_1",
            operatingProfile: "PRE_GENESIS_CLOSED",
          },
        },
      });

      const gatedGovernment = await government.inject(
        callTool(
          "register_proposal",
          { command: signedGovernmentCommand() },
          3,
        ),
      );
      expect(gatedGovernment.json().result).toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          status: 503,
          body: {
            error: "genesis_not_authorized",
            canonicalWriteAccepted: false,
          },
        },
      });

      const possession = await runFirstPossessionRehearsal({ windowCount: 2 });
      const resolved = await basketball.inject(
        callTool(
          "resolve_signed_possession",
          { possession: possessionInputToWire(possession.input) },
          4,
        ),
      );
      expect(resolved.json().result.structuredContent).toMatchObject({
        finalStateRoot: possession.result.finalStateRoot,
        eventMerkleRoot: possession.result.eventMerkleRoot,
        inferenceInvocations: 0,
      });
    } finally {
      await Promise.all([
        career.close(),
        government.close(),
        discovery.close(),
        basketball.close(),
        publicApi.close(),
        core.close(),
      ]);
    }
  });
});
