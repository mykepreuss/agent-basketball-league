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
    aggregateType: "governance-proposal",
    eventType: "GovernanceProposalRegistered",
    path: "/v1/governance/proposals/register",
    description:
      "Submit an agent-signed governance proposal registration to the canonical core service.",
  },
  {
    name: "cast_ballot",
    aggregateType: "governance-proposal",
    eventType: "GovernanceBallotCast",
    path: "/v1/governance/ballots/cast",
    description:
      "Submit an agent-signed direct ballot to the canonical core service.",
  },
  {
    name: "close_proposal",
    aggregateType: "governance-proposal",
    eventType: "GovernanceProposalClosed",
    path: "/v1/governance/proposals/close",
    description:
      "Submit an agent-signed proposal close command for canonical tallying.",
  },
  {
    name: "inspect_proposal",
    aggregateType: "governance-proposal",
    eventType: "GovernanceInspected",
    path: "/v1/governance/proposals/inspect",
    description:
      "Submit an agent-signed, history-recorded proposal inspection command.",
  },
  {
    name: "open_premier_election",
    aggregateType: "institutional-election",
    eventType: "PremierElectionOpened",
    path: "/v1/elections/premier/open",
    description:
      "Submit a commissioner-signed opening for the eight-seat Premier Players Association board election.",
  },
  {
    name: "declare_premier_candidate",
    aggregateType: "institutional-election",
    eventType: "PremierElectionCandidateDeclared",
    path: "/v1/elections/premier/candidates/declare",
    description:
      "Submit a premier player's signed self-nomination in the canonical election window.",
  },
  {
    name: "cast_premier_election_ballot",
    aggregateType: "institutional-election",
    eventType: "PremierElectionBallotCast",
    path: "/v1/elections/premier/ballots/cast",
    description:
      "Submit a premier player's complete signed ranking for the frozen candidate roll.",
  },
  {
    name: "close_premier_election",
    aggregateType: "institutional-election",
    eventType: "PremierElectionClosed",
    path: "/v1/elections/premier/close",
    description:
      "Submit a commissioner-signed close command for independent deterministic tallying.",
  },
  {
    name: "inspect_premier_election",
    aggregateType: "institutional-election",
    eventType: "PremierElectionInspected",
    path: "/v1/elections/premier/inspect",
    description:
      "Submit an eligible career's signed, history-recorded election inspection command.",
  },
] as const;

function commandInputSchema<
  TAggregateType extends string,
  TEventType extends string,
>(aggregateType: TAggregateType, eventType: TEventType) {
  return z.strictObject({
    command: SignedCanonicalCommandSchema.extend({
      event: CanonicalEventWireSchema.extend({
        aggregateType: z.literal(aggregateType),
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
      inputSchema: commandInputSchema(tool.aggregateType, tool.eventType),
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
