import {
  createFixedUpstream,
  createMcpServer,
  defineMcpTool,
} from "@abl/mcp-protocol";
import {
  CanonicalEventWireSchema,
  SignedCanonicalCommandSchema,
} from "@abl/schemas";
import { z } from "zod";

const governmentTools = [
  {
    name: "register_proposal",
    eventType: "GovernanceProposalRegistered",
    path: "/v1/governance/proposals/register",
    description:
      "Submit an agent-signed governance proposal registration to the canonical core service.",
  },
  {
    name: "cast_ballot",
    eventType: "GovernanceBallotCast",
    path: "/v1/governance/ballots/cast",
    description:
      "Submit an agent-signed direct ballot to the canonical core service.",
  },
  {
    name: "close_proposal",
    eventType: "GovernanceProposalClosed",
    path: "/v1/governance/proposals/close",
    description:
      "Submit an agent-signed proposal close command for canonical tallying.",
  },
  {
    name: "inspect_proposal",
    eventType: "GovernanceInspected",
    path: "/v1/governance/proposals/inspect",
    description:
      "Submit an agent-signed, history-recorded proposal inspection command.",
  },
] as const;

function commandInputSchema<TEventType extends string>(eventType: TEventType) {
  return z.strictObject({
    command: SignedCanonicalCommandSchema.extend({
      event: CanonicalEventWireSchema.extend({
        aggregateType: z.literal("governance-proposal"),
        eventType: z.literal(eventType),
      }),
    }),
  });
}

export interface GovernmentMcpOptions {
  coreOrigin: string;
  coreCredential: string;
  allowedOrigins?: ReadonlySet<string>;
  fetchImplementation?: typeof fetch;
  allowHttpForTest?: boolean;
}

export function createGovernmentMcp(
  options: GovernmentMcpOptions,
): ReturnType<typeof createMcpServer> {
  const requestCore = createFixedUpstream({
    origin: options.coreOrigin,
    credential: options.coreCredential,
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
    ...(options.allowHttpForTest === undefined
      ? {}
      : { allowHttpForTest: options.allowHttpForTest }),
  });
  const tools = governmentTools.map((tool) =>
    defineMcpTool({
      name: tool.name,
      description: tool.description,
      inputSchema: commandInputSchema(tool.eventType),
      execute: ({ command }) =>
        requestCore({ method: "POST", path: tool.path, body: command }),
    }),
  );
  return createMcpServer({
    name: "abl-government",
    version: "0.0.0-pre-genesis",
    tools,
    ...(options.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: options.allowedOrigins }),
  });
}
