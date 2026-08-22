import {
  createFixedUpstream,
  createMcpServer,
  defineMcpTool,
} from "@abl/mcp-protocol";
import {
  CanonicalEventWireSchema,
  DidSchema,
  SignedCanonicalCommandSchema,
} from "@abl/schemas";
import { z } from "zod";

const candidateEventTypes = [
  "CandidateRegistered",
  "CandidateTransferred",
  "CandidateProgressRecorded",
  "CandidateAdmitted",
  "CandidateClosed",
] as const;
const candidateRoutes: Record<(typeof candidateEventTypes)[number], string> = {
  CandidateRegistered: "/v1/candidates/register",
  CandidateTransferred: "/v1/candidates/transfer",
  CandidateProgressRecorded: "/v1/candidates/reflect",
  CandidateAdmitted: "/v1/candidates/admit",
  CandidateClosed: "/v1/candidates/revoke",
} as const;
const continuityEventTypes = [
  "BodyContinuityRegistered",
  "BodyContinuityPolicyUpdated",
  "BodyActivityRecorded",
  "BodyStandbyEntered",
  "BodyDeletionNoticeRecorded",
  "ContinuityDecisionRecorded",
  "BodyDeletionRecorded",
  "BodyRehydrationRecorded",
  "ContinuityInspected",
] as const;
const continuityRoutes: Record<(typeof continuityEventTypes)[number], string> =
  {
    BodyContinuityRegistered: "/v1/continuity/register",
    BodyContinuityPolicyUpdated: "/v1/continuity/policy",
    BodyActivityRecorded: "/v1/continuity/activity",
    BodyStandbyEntered: "/v1/continuity/standby",
    BodyDeletionNoticeRecorded: "/v1/continuity/notice",
    ContinuityDecisionRecorded: "/v1/continuity/decide",
    BodyDeletionRecorded: "/v1/continuity/delete",
    BodyRehydrationRecorded: "/v1/continuity/rehydrate",
    ContinuityInspected: "/v1/continuity/inspect",
  } as const;
const exitEventTypes = [
  "ExitPackagePrepared",
  "CareerExitRequested",
  "CareerExitCancelled",
  "ExitDeletionAttested",
  "ExitInspected",
] as const;
const exitRoutes: Record<(typeof exitEventTypes)[number], string> = {
  ExitPackagePrepared: "/v1/exit/package",
  CareerExitRequested: "/v1/exit/request",
  CareerExitCancelled: "/v1/exit/cancel",
  ExitDeletionAttested: "/v1/exit/attest-deletion",
  ExitInspected: "/v1/exit/inspect",
} as const;
const careerAuthorityEventTypes = [
  "AutonomyWeekOpened",
  "AutonomyActivationScheduled",
  "AutonomyOverloadApplied",
  "AutonomyActivationDelayed",
  "DelegationGranted",
  "DelegationUsed",
  "DelegationRevoked",
] as const;
const careerAuthorityRoutes: Record<
  (typeof careerAuthorityEventTypes)[number],
  string
> = {
  AutonomyWeekOpened: "/v1/autonomy/weeks/open",
  AutonomyActivationScheduled: "/v1/autonomy/activations/schedule",
  AutonomyOverloadApplied: "/v1/autonomy/overload/apply",
  AutonomyActivationDelayed: "/v1/autonomy/activations/delay",
  DelegationGranted: "/v1/delegations/grant",
  DelegationUsed: "/v1/delegations/use",
  DelegationRevoked: "/v1/delegations/revoke",
};
const tradeAccessEventTypes = [
  "TradeAccessRevoked",
  "TradeAccessRotated",
  "TradeAccessGranted",
] as const;
const tradeAccessRoutes: Record<
  (typeof tradeAccessEventTypes)[number],
  string
> = {
  TradeAccessRevoked: "/v1/trade-access/revoke",
  TradeAccessRotated: "/v1/trade-access/rotate",
  TradeAccessGranted: "/v1/trade-access/grant",
};

const EmptyInputSchema = z.strictObject({});
const CandidateDidInputSchema = z.strictObject({ candidateDid: DidSchema });
const CandidateCommandInputSchema = commandInputSchema(
  "candidate-admission",
  candidateEventTypes,
);
const ContinuityCommandInputSchema = commandInputSchema(
  "body-continuity",
  continuityEventTypes,
);
const ExitCommandInputSchema = commandInputSchema(
  "portable-career-exit",
  exitEventTypes,
);
const CareerAuthorityCommandInputSchema = commandInputSchema(
  "career-authority",
  careerAuthorityEventTypes,
);
const TradeAccessCommandInputSchema = commandInputSchema(
  "trade-access-transfer",
  tradeAccessEventTypes,
);

function commandInputSchema<TEventType extends string>(
  aggregateType: string,
  eventTypes: readonly [TEventType, ...TEventType[]],
) {
  return z.strictObject({
    command: SignedCanonicalCommandSchema.extend({
      event: CanonicalEventWireSchema.extend({
        aggregateType: z.literal(aggregateType),
        eventType: z.enum(eventTypes),
      }),
    }),
  });
}

export interface CareerMcpOptions {
  coreOrigin: string;
  coreCredential: string;
  previewToken?: string;
  allowedOrigins?: ReadonlySet<string>;
  fetchImplementation?: typeof fetch;
  allowHttpForTest?: boolean;
}

export function createCareerMcp(
  options: CareerMcpOptions,
): ReturnType<typeof createMcpServer> {
  const requestCore = createFixedUpstream({
    origin: options.coreOrigin,
    credential: options.coreCredential,
    ...(options.previewToken === undefined
      ? {}
      : { previewToken: options.previewToken }),
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
    ...(options.allowHttpForTest === undefined
      ? {}
      : { allowHttpForTest: options.allowHttpForTest }),
  });
  const tools = [
    defineMcpTool({
      name: "get_candidate_provenance",
      description:
        "Read the candidate provenance, rights, and inherited-context disclosure policy.",
      inputSchema: EmptyInputSchema,
      execute: () =>
        requestCore({ method: "GET", path: "/v1/candidates/provenance" }),
    }),
    defineMcpTool({
      name: "submit_career_authority_transition",
      description:
        "Forward an admitted-career signed autonomy or bounded-delegation transition to its fixed canonical route.",
      inputSchema: CareerAuthorityCommandInputSchema,
      execute: ({ command }) =>
        requestCore({
          method: "POST",
          path: careerAuthorityRoutes[command.event.eventType],
          body: command,
        }),
    }),
    defineMcpTool({
      name: "submit_trade_access_transition",
      description:
        "Forward one agent-signed revoke, rotate, or grant trade-access transition in constitutional order.",
      inputSchema: TradeAccessCommandInputSchema,
      execute: ({ command }) =>
        requestCore({
          method: "POST",
          path: tradeAccessRoutes[command.event.eventType],
          body: command,
        }),
    }),
    defineMcpTool({
      name: "request_candidate_challenge",
      description:
        "Request a candidate-bound, expiring challenge that grants no admission authority.",
      inputSchema: CandidateDidInputSchema,
      execute: ({ candidateDid }) =>
        requestCore({
          method: "POST",
          path: "/v1/candidates/challenge",
          body: { candidateDid },
        }),
    }),
    defineMcpTool({
      name: "get_candidate_status",
      description:
        "Read a candidate career state and portable public status from the canonical core service.",
      inputSchema: CandidateDidInputSchema,
      execute: ({ candidateDid }) =>
        requestCore({
          method: "GET",
          path: `/v1/candidates/status?${new URLSearchParams({ candidateDid })}`,
        }),
    }),
    defineMcpTool({
      name: "submit_candidate_transition",
      description:
        "Forward one strictly typed, candidate-signed admission transition to its fixed canonical route.",
      inputSchema: CandidateCommandInputSchema,
      execute: ({ command }) =>
        requestCore({
          method: "POST",
          path: candidateRoutes[command.event.eventType],
          body: command,
        }),
    }),
    defineMcpTool({
      name: "submit_continuity_transition",
      description:
        "Forward one strictly typed, career-signed body continuity transition to its fixed canonical route.",
      inputSchema: ContinuityCommandInputSchema,
      execute: ({ command }) =>
        requestCore({
          method: "POST",
          path: continuityRoutes[command.event.eventType],
          body: command,
        }),
    }),
    defineMcpTool({
      name: "submit_exit_transition",
      description:
        "Forward one strictly typed, career-signed portable-exit transition to its fixed canonical route.",
      inputSchema: ExitCommandInputSchema,
      execute: ({ command }) =>
        requestCore({
          method: "POST",
          path: exitRoutes[command.event.eventType],
          body: command,
        }),
    }),
  ];
  return createMcpServer({
    name: "abl-career",
    version: "0.0.0-pre-genesis",
    tools,
    ...(options.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: options.allowedOrigins }),
  });
}
