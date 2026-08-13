import {
  evaluateProposal,
  type Chamber,
  type EligibilitySnapshot,
  type GovernanceBallot,
  type GovernanceDecision,
  type GovernanceProposal,
  type GovernanceVote,
  type InstitutionalAuthorizationContext,
  type InstitutionalSigner,
} from "@abl/institutions";
import {
  CanonicalConflictError,
  HashChainConflictError,
  IdempotencyConflictError,
  NonceReplayError,
  type CanonicalStore,
  type StoredCanonicalEvent,
} from "@abl/database";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  verifyEventContent,
  type CanonicalEvent,
} from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { FastifyInstance } from "fastify";
import type { Hex, TypedDataDomain } from "viem";
import { z } from "zod";

import {
  SignedCanonicalCommandSchema,
  canonicalEventFromStored,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import {
  CandidateAuthorizationError,
  readCandidateCareerAuthority,
  type CandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import { CareerExitedError, requireCareerOperational } from "./exit-status.js";

const aggregateType = "governance-proposal";
const chambers = [
  "UNIVERSAL_CAREER_ASSEMBLY",
  "PREMIER_PLAYERS",
  "DEVELOPMENT_PLAYERS",
  "PREMIER_TEAM_COUNCIL",
  "DEVELOPMENT_TEAM_COUNCIL",
  "EXECUTIVE_COMMISSION",
  "TRIBUNAL",
  "INTEGRITY_OFFICE",
] as const satisfies readonly Chamber[];
const eventTypes = [
  "GovernanceProposalRegistered",
  "GovernanceBallotCast",
  "GovernanceProposalClosed",
  "GovernanceInspected",
] as const;
export type GovernanceWorkflowEventType = (typeof eventTypes)[number];

const ChamberSchema = z.enum(chambers);
export const GovernanceEligibilitySnapshotSchema = z.strictObject({
  snapshotId: UuidV7Schema,
  capturedAt: IsoDateTimeSchema,
  members: z.strictObject(
    Object.fromEntries(
      chambers.map((chamber) => [chamber, z.array(DidSchema)]),
    ) as Record<Chamber, z.ZodArray<typeof DidSchema>>,
  ),
});
const ProposalCommandSchema = z.strictObject({
  proposalId: UuidV7Schema,
  version: z.number().int().positive(),
  proposerDid: DidSchema,
  institution: z.string().min(1).max(160),
  proposalClass: z.enum([
    "TIER_CBA",
    "SHARED_ORDINARY",
    "CONSTITUTIONAL",
    "FOUNDATIONAL_RIGHT",
    "EXPANSION",
  ]),
  tier: z.enum(["PREMIER", "DEVELOPMENT"]).optional(),
  title: z.string().min(1).max(300),
  textCommitment: Sha256Schema,
  executableChangeDigest: Sha256Schema.nullable(),
  opensAt: IsoDateTimeSchema,
  closesAt: IsoDateTimeSchema,
  eligibilitySnapshotDigest: Sha256Schema,
  deliberationSeasons: z.number().int().nonnegative().optional(),
  fundedApplication: z.boolean().optional(),
  auditsPassed: z.boolean().optional(),
});
const ProposalRegistrationCommandSchema = z.strictObject({
  proposal: ProposalCommandSchema,
  eligibilitySnapshot: GovernanceEligibilitySnapshotSchema,
  recusedDids: z.array(DidSchema),
});
const BallotCommandSchema = z.strictObject({
  ballotId: UuidV7Schema,
  voterDid: DidSchema,
  chamber: ChamberSchema,
  choice: z.enum(["YES", "NO", "ABSTAIN"]),
  proposalId: UuidV7Schema,
  proposalVersion: z.number().int().positive(),
  eligibilitySnapshotDigest: Sha256Schema,
  castAt: IsoDateTimeSchema,
});
const BallotPayloadSchema = z.strictObject({ command: BallotCommandSchema });
const CloseCommandSchema = z.strictObject({
  proposalId: UuidV7Schema,
  proposalVersion: z.number().int().positive(),
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
});
const ClosePayloadSchema = z.strictObject({ command: CloseCommandSchema });
const InspectCommandSchema = z.strictObject({
  proposalId: UuidV7Schema,
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-GOVERNANCE-INSPECTION-V1"),
});
const InspectPayloadSchema = z.strictObject({ command: InspectCommandSchema });

export const GOVERNANCE_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-governance-proposal-workflow",
  version: 1,
  aggregateType,
  eventTypes,
  directBallotsOnly: true,
  eligibilityMode: "CONFIGURED_REHEARSAL_SNAPSHOT",
});

type ProposalCommand = z.infer<typeof ProposalCommandSchema>;
type BallotCommand = z.infer<typeof BallotCommandSchema>;
type ProposalRegistrationCommand = z.infer<
  typeof ProposalRegistrationCommandSchema
>;
export type GovernanceWorkflowPayload =
  | ProposalRegistrationCommand
  | z.infer<typeof BallotPayloadSchema>
  | z.infer<typeof ClosePayloadSchema>
  | z.infer<typeof InspectPayloadSchema>;

export interface GovernanceWorkflowSnapshot {
  proposalId: string;
  version: number;
  lastTransitionAt: string;
  proposal: ProposalCommand;
  eligibilitySnapshot: EligibilitySnapshot;
  recusedDids: string[];
  ballots: BallotCommand[];
  decision: GovernanceDecision | null;
  closedAt: string | null;
}

export interface GovernanceRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  eligibilitySnapshot: EligibilitySnapshot;
  now?: () => number;
}

interface GovernanceAggregate {
  records: StoredCanonicalEvent[];
  snapshot: GovernanceWorkflowSnapshot | null;
  votes: GovernanceVote[];
  authorization: MutableInstitutionalAuthorizationContext;
}

interface MutableInstitutionalAuthorizationContext
  extends Omit<InstitutionalAuthorizationContext, "signers"> {
  signers: Map<string, InstitutionalSigner>;
}

class GovernanceAuthorizationError extends Error {
  public override readonly name = "GovernanceAuthorizationError";
}

class GovernanceValidationError extends Error {
  public override readonly name = "GovernanceValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new GovernanceValidationError(
      "Governance timestamp is not canonical",
    );
  return parsed;
}

function candidateOptions(
  options: GovernanceRehearsalOptions,
): CandidateRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    ...options.candidateAdmission,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new GovernanceValidationError(`${label} contains duplicates`);
}

function validateEligibilitySnapshot(snapshot: EligibilitySnapshot): void {
  canonicalInstant(snapshot.capturedAt);
  for (const chamber of chambers)
    unique(snapshot.members[chamber], `${chamber} eligibility`);
  const tierPlayers = new Set([
    ...snapshot.members.PREMIER_PLAYERS,
    ...snapshot.members.DEVELOPMENT_PLAYERS,
  ]);
  if (
    tierPlayers.size !==
      snapshot.members.PREMIER_PLAYERS.length +
        snapshot.members.DEVELOPMENT_PLAYERS.length ||
    sha256Commitment([...tierPlayers].sort()) !==
      sha256Commitment([...snapshot.members.UNIVERSAL_CAREER_ASSEMBLY].sort())
  ) {
    throw new GovernanceValidationError(
      "Universal assembly must exactly contain both disjoint player tiers",
    );
  }
}

function validateProposalCommand(
  registration: ProposalRegistrationCommand,
  actorDid: string,
  aggregateId: string,
  timestamp: string,
): void {
  const { proposal, eligibilitySnapshot, recusedDids } = registration;
  validateEligibilitySnapshot(eligibilitySnapshot);
  unique(recusedDids, "Governance recusals");
  const openedAt = canonicalInstant(proposal.opensAt);
  const closesAt = canonicalInstant(proposal.closesAt);
  const capturedAt = canonicalInstant(eligibilitySnapshot.capturedAt);
  const registeredAt = canonicalInstant(timestamp);
  if (
    proposal.proposerDid !== actorDid ||
    proposal.proposalId !== aggregateId ||
    proposal.version !== 1 ||
    proposal.eligibilitySnapshotDigest !==
      sha256Commitment(eligibilitySnapshot) ||
    capturedAt > registeredAt ||
    registeredAt > openedAt ||
    openedAt >= closesAt
  ) {
    throw new GovernanceValidationError(
      "Governance proposal does not bind its proposer, snapshot, or window",
    );
  }
  if (
    (proposal.proposalClass === "TIER_CBA") !==
    (proposal.tier !== undefined)
  ) {
    throw new GovernanceValidationError(
      "Tier CBA proposals must select exactly one tier",
    );
  }
  const allMembers = new Set(
    chambers.flatMap((chamber) => eligibilitySnapshot.members[chamber]),
  );
  if (!allMembers.has(actorDid))
    throw new GovernanceAuthorizationError(
      "Proposal author is outside the eligibility snapshot",
    );
  if (recusedDids.some((did) => !allMembers.has(did)))
    throw new GovernanceValidationError(
      "Governance recusal is outside the eligibility snapshot",
    );
}

function domainProposalClass(
  proposal: ProposalCommand,
): GovernanceProposal["proposalClass"] {
  switch (proposal.proposalClass) {
    case "TIER_CBA":
      return proposal.tier === "PREMIER"
        ? "TIER_CBA_PREMIER"
        : "TIER_CBA_DEVELOPMENT";
    case "EXPANSION":
      return "PREMIER_EXPANSION";
    default:
      return proposal.proposalClass;
  }
}

function toDomainProposal(
  snapshot: GovernanceWorkflowSnapshot,
): GovernanceProposal {
  const { proposal } = snapshot;
  return {
    proposalId: proposal.proposalId,
    version: proposal.version,
    proposalClass: domainProposalClass(proposal),
    openedAt: proposal.opensAt,
    closesAt: proposal.closesAt,
    eligibilitySnapshotId: snapshot.eligibilitySnapshot.snapshotId,
    eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest as Hex,
    ...(proposal.deliberationSeasons === undefined
      ? {}
      : { deliberationSeasons: proposal.deliberationSeasons }),
    ...(proposal.fundedApplication === undefined
      ? {}
      : { fundedApplication: proposal.fundedApplication }),
    ...(proposal.auditsPassed === undefined
      ? {}
      : { auditsPassed: proposal.auditsPassed }),
  };
}

function parsePayload(
  eventType: GovernanceWorkflowEventType,
  payload: unknown,
): GovernanceWorkflowPayload {
  switch (eventType) {
    case "GovernanceProposalRegistered":
      return ProposalRegistrationCommandSchema.parse(payload);
    case "GovernanceBallotCast":
      return BallotPayloadSchema.parse(payload);
    case "GovernanceProposalClosed":
      return ClosePayloadSchema.parse(payload);
    case "GovernanceInspected":
      return InspectPayloadSchema.parse(payload);
  }
}

function isEventType(value: string): value is GovernanceWorkflowEventType {
  return eventTypes.includes(value as GovernanceWorkflowEventType);
}

function isEligible(snapshot: EligibilitySnapshot, agentDid: string): boolean {
  return chambers.some((chamber) =>
    snapshot.members[chamber].includes(agentDid),
  );
}

export function governanceWorkflowStateRoot(
  snapshot: GovernanceWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-GOVERNANCE-PROPOSAL-STATE-V1",
    ...snapshot,
  });
}

function applyRegistration(
  event: CanonicalEvent,
  registration: ProposalRegistrationCommand,
): GovernanceWorkflowSnapshot {
  if (event.aggregateVersion !== 1n)
    throw new GovernanceValidationError(
      "Governance proposal registration must be version one",
    );
  validateProposalCommand(
    registration,
    event.actorDid,
    event.aggregateId,
    event.timestamp,
  );
  return {
    proposalId: registration.proposal.proposalId,
    version: 1,
    lastTransitionAt: event.timestamp,
    proposal: structuredClone(registration.proposal),
    eligibilitySnapshot: structuredClone(registration.eligibilitySnapshot),
    recusedDids: [...registration.recusedDids],
    ballots: [],
    decision: null,
    closedAt: null,
  };
}

export function applyGovernanceWorkflowTransition(
  current: GovernanceWorkflowSnapshot | null,
  event: CanonicalEvent,
  payload: GovernanceWorkflowPayload,
  decision: GovernanceDecision | null = null,
): GovernanceWorkflowSnapshot {
  if (current === null) {
    if (event.eventType !== "GovernanceProposalRegistered")
      throw new GovernanceValidationError(
        "Governance proposal must be registered first",
      );
    return applyRegistration(
      event,
      ProposalRegistrationCommandSchema.parse(payload),
    );
  }
  if (
    event.aggregateVersion !== BigInt(current.version + 1) ||
    event.aggregateId !== current.proposalId ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new GovernanceValidationError(
      "Governance aggregate sequence is invalid",
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;

  if (event.eventType === "GovernanceProposalRegistered")
    throw new GovernanceValidationError("Governance proposal already exists");
  if (event.eventType === "GovernanceBallotCast") {
    if (next.decision !== null)
      throw new GovernanceValidationError(
        "Closed proposal cannot accept ballots",
      );
    const ballot = BallotPayloadSchema.parse(payload).command;
    const castAt = canonicalInstant(ballot.castAt);
    if (
      ballot.voterDid !== event.actorDid ||
      ballot.proposalId !== next.proposalId ||
      ballot.proposalVersion !== next.proposal.version ||
      ballot.eligibilitySnapshotDigest !==
        next.proposal.eligibilitySnapshotDigest ||
      ballot.castAt !== event.timestamp ||
      castAt < canonicalInstant(next.proposal.opensAt) ||
      castAt >= canonicalInstant(next.proposal.closesAt) ||
      !next.eligibilitySnapshot.members[ballot.chamber].includes(
        ballot.voterDid,
      ) ||
      next.recusedDids.includes(ballot.voterDid)
    ) {
      throw new GovernanceAuthorizationError(
        "Governance ballot is outside voter, snapshot, or window authority",
      );
    }
    if (
      next.ballots.some(
        (prior) =>
          prior.ballotId === ballot.ballotId ||
          (prior.chamber === ballot.chamber &&
            prior.voterDid === ballot.voterDid),
      )
    ) {
      throw new GovernanceValidationError(
        "Governance ballot duplicates an ID or eligible seat",
      );
    }
    next.ballots.push(structuredClone(ballot));
    return next;
  }
  if (event.eventType === "GovernanceProposalClosed") {
    const close = ClosePayloadSchema.parse(payload).command;
    if (
      next.decision !== null ||
      close.proposalId !== next.proposalId ||
      close.proposalVersion !== next.proposal.version ||
      close.requestedByDid !== event.actorDid ||
      close.requestedAt !== event.timestamp ||
      canonicalInstant(close.requestedAt) <
        canonicalInstant(next.proposal.closesAt) ||
      !isEligible(next.eligibilitySnapshot, event.actorDid) ||
      decision === null ||
      decision.proposalId !== next.proposalId
    ) {
      throw new GovernanceValidationError(
        "Governance close request or deterministic decision is invalid",
      );
    }
    next.decision = structuredClone(decision);
    next.closedAt = event.timestamp;
    return next;
  }
  const inspection = InspectPayloadSchema.parse(payload).command;
  if (
    inspection.proposalId !== next.proposalId ||
    inspection.requestedByDid !== event.actorDid ||
    inspection.requestedAt !== event.timestamp ||
    !isEligible(next.eligibilitySnapshot, event.actorDid)
  ) {
    throw new GovernanceAuthorizationError(
      "Governance inspection is outside proposal authority",
    );
  }
  return next;
}

async function requireCareerSignature(
  options: GovernanceRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<CandidateCareerAuthority> {
  const authority = await readCandidateCareerAuthority(
    candidateOptions(options),
    event.actorDid,
    at,
  );
  let signer: string;
  try {
    signer = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new GovernanceAuthorizationError(
      "Governance event signature is invalid",
    );
  }
  if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new GovernanceAuthorizationError(
      "Governance signer is not the career key",
    );
  return authority;
}

function registerVoter(
  authorization: MutableInstitutionalAuthorizationContext,
  voterDid: string,
  signerAddress: `0x${string}`,
): void {
  const prior = authorization.signers.get(voterDid);
  if (
    prior !== undefined &&
    prior.signerAddress.toLowerCase() !== signerAddress.toLowerCase()
  ) {
    throw new GovernanceAuthorizationError(
      "Governance voter key changed inside a frozen proposal",
    );
  }
  authorization.signers.set(voterDid, {
    signerAddress,
    roles: ["VOTER"],
  });
}

function governanceVote(
  ballot: BallotCommand,
  event: CanonicalEvent,
  signature: string,
  signerAddress: `0x${string}`,
): GovernanceVote {
  const command: GovernanceBallot = {
    ballotId: ballot.ballotId,
    voterDid: ballot.voterDid,
    chamber: ballot.chamber,
    choice: ballot.choice,
    proposalId: ballot.proposalId,
    proposalVersion: ballot.proposalVersion,
    eligibilitySnapshotDigest: ballot.eligibilitySnapshotDigest as Hex,
    castAt: ballot.castAt,
  };
  return {
    ...command,
    authorizationEvent: event as CanonicalEvent<{ command: GovernanceBallot }>,
    signature: signature as Hex,
    signerAddress,
    authorizationAggregateVersion: Number(event.aggregateVersion),
    authorizationStateRoot: event.stateRoot,
  };
}

async function evaluate(
  snapshot: GovernanceWorkflowSnapshot,
  votes: readonly GovernanceVote[],
  authorization: InstitutionalAuthorizationContext,
): Promise<GovernanceDecision> {
  return evaluateProposal({
    proposal: toDomainProposal(snapshot),
    snapshot: snapshot.eligibilitySnapshot,
    votes,
    recusals: snapshot.recusedDids,
    authorization,
  });
}

async function validateConfiguredSnapshotMembers(
  options: GovernanceRehearsalOptions,
  snapshot: EligibilitySnapshot,
): Promise<void> {
  if (
    sha256Commitment(snapshot) !== sha256Commitment(options.eligibilitySnapshot)
  ) {
    throw new GovernanceAuthorizationError(
      "Proposal does not use the configured rehearsal eligibility snapshot",
    );
  }
  const members = new Set(
    chambers.flatMap((chamber) => snapshot.members[chamber]),
  );
  try {
    await Promise.all(
      [...members].map((memberDid) =>
        readCandidateCareerAuthority(
          candidateOptions(options),
          memberDid,
          snapshot.capturedAt,
        ),
      ),
    );
  } catch {
    throw new GovernanceAuthorizationError(
      "Eligibility snapshot contains a career not admitted when captured",
    );
  }
}

async function replayGovernanceAggregate(
  options: GovernanceRehearsalOptions,
  proposalId: string,
): Promise<GovernanceAggregate> {
  const records = await options.store.readAggregate(aggregateType, proposalId);
  let snapshot: GovernanceWorkflowSnapshot | null = null;
  const votes: GovernanceVote[] = [];
  const authorization: MutableInstitutionalAuthorizationContext = {
    domain: options.domain,
    signers: new Map(),
  };
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== aggregateType ||
      event.aggregateId !== proposalId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isEventType(event.eventType) ||
      event.schemaDigest !== GOVERNANCE_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new GovernanceAuthorizationError(
        "Stored governance aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new GovernanceAuthorizationError(
        "Stored governance event content is invalid",
      );
    }
    let payload: GovernanceWorkflowPayload;
    try {
      payload = parsePayload(event.eventType, event.payload);
    } catch {
      throw new GovernanceAuthorizationError(
        "Stored governance event payload is malformed",
      );
    }
    const authority = await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    let decision: GovernanceDecision | null = null;
    if (event.eventType === "GovernanceProposalRegistered") {
      const registration = ProposalRegistrationCommandSchema.parse(payload);
      await validateConfiguredSnapshotMembers(
        options,
        registration.eligibilitySnapshot,
      );
    } else if (event.eventType === "GovernanceBallotCast") {
      const ballot = BallotPayloadSchema.parse(payload).command;
      registerVoter(authorization, ballot.voterDid, authority.signingAddress);
      votes.push(
        governanceVote(
          ballot,
          event,
          record.signatures[0],
          authority.signingAddress,
        ),
      );
    } else if (event.eventType === "GovernanceProposalClosed") {
      if (snapshot === null)
        throw new GovernanceAuthorizationError(
          "Stored governance close precedes proposal",
        );
      try {
        decision = await evaluate(snapshot, votes, authorization);
      } catch (error) {
        throw new GovernanceAuthorizationError(
          error instanceof Error
            ? error.message
            : "Stored governance decision is invalid",
        );
      }
    }
    try {
      snapshot = applyGovernanceWorkflowTransition(
        snapshot,
        event,
        payload,
        decision,
      );
    } catch (error) {
      if (error instanceof GovernanceAuthorizationError) throw error;
      throw new GovernanceAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored governance transition is malformed",
      );
    }
    if (governanceWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new GovernanceAuthorizationError(
        "Stored governance state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot, votes, authorization };
}

function appendInput(
  options: GovernanceRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
) {
  return {
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({ eventHash: event.eventHash, signatures }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: event.aggregateVersion - 1n,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    eventType: event.eventType,
    previousEventHash: event.previousEventHash,
    eventHash: event.eventHash,
    payloadSchemaDigest: event.schemaDigest,
    payloadCommitment: event.payloadCommitment,
    payload: event.payload,
    stateRoot: event.stateRoot,
    signatures,
    occurredAt: new Date(event.timestamp),
    outboxTopic: "public.governance",
  };
}

function governanceError(error: unknown): { status: number; code: string } {
  if (
    error instanceof GovernanceAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "governance_authorization_denied" };
  }
  if (error instanceof z.ZodError || error instanceof GovernanceValidationError)
    return { status: 400, code: "invalid_governance_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "governance_aggregate_conflict" };
  }
  return { status: 500, code: "governance_failure" };
}

export function installGovernanceRehearsalRoutes(
  app: FastifyInstance,
  options: GovernanceRehearsalOptions,
): void {
  const configuredSnapshot = GovernanceEligibilitySnapshotSchema.parse(
    options.eligibilitySnapshot,
  );
  validateEligibilitySnapshot(configuredSnapshot);
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: GovernanceWorkflowEventType;
  }> = [
    {
      path: "/v1/governance/proposals/register",
      eventType: "GovernanceProposalRegistered",
    },
    {
      path: "/v1/governance/ballots/cast",
      eventType: "GovernanceBallotCast",
    },
    {
      path: "/v1/governance/proposals/close",
      eventType: "GovernanceProposalClosed",
    },
    {
      path: "/v1/governance/proposals/inspect",
      eventType: "GovernanceInspected",
    },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new GovernanceValidationError(
            "Governance event content is invalid",
          );
        }
        if (
          event.aggregateType !== aggregateType ||
          event.aggregateId === "" ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== GOVERNANCE_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new GovernanceAuthorizationError(
            "Governance event is outside route authority",
          );
        }
        const payload = parsePayload(route.eventType, event.payload);
        const aggregate = await replayGovernanceAggregate(
          options,
          event.aggregateId,
        );
        const currentTime = now();
        const currentAt = new Date(currentTime).toISOString();
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        const authority = await requireCareerSignature(
          options,
          event,
          parsed.signatures[0]!,
          currentAt,
        );
        if (route.eventType !== "GovernanceInspected") {
          await requireCareerOperational(options, event.actorDid, currentAt);
        }
        let responseSnapshot = aggregate.snapshot;
        if (existing !== undefined) {
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Governance aggregate version already has different content",
            );
          }
          if (
            route.eventType === "GovernanceInspected" &&
            existing !== aggregate.records.at(-1)
          ) {
            throw new CanonicalConflictError(
              "Historical governance inspection cannot return newer state",
            );
          }
        } else {
          const occurredAt = canonicalInstant(event.timestamp);
          const latestOccurredAt =
            aggregate.records.at(-1)?.occurredAt.getTime() ??
            Number.NEGATIVE_INFINITY;
          if (
            occurredAt < latestOccurredAt ||
            occurredAt > currentTime + 60_000
          ) {
            throw new GovernanceValidationError(
              "Governance event timestamp is outside the accepted window",
            );
          }
          const previousHash = aggregate.records.at(-1)?.eventHash ?? null;
          if (event.previousEventHash !== previousHash)
            throw new HashChainConflictError(
              "Governance previous event hash is invalid",
            );
          let decision: GovernanceDecision | null = null;
          if (route.eventType === "GovernanceProposalRegistered") {
            const registration =
              ProposalRegistrationCommandSchema.parse(payload);
            await validateConfiguredSnapshotMembers(
              options,
              registration.eligibilitySnapshot,
            );
          } else if (route.eventType === "GovernanceProposalClosed") {
            if (aggregate.snapshot === null)
              throw new GovernanceValidationError(
                "Governance proposal is absent",
              );
            try {
              decision = await evaluate(
                aggregate.snapshot,
                aggregate.votes,
                aggregate.authorization,
              );
            } catch (error) {
              throw new GovernanceValidationError(
                error instanceof Error
                  ? error.message
                  : "Governance tally failed",
              );
            }
          } else if (route.eventType === "GovernanceBallotCast") {
            registerVoter(
              aggregate.authorization,
              event.actorDid,
              authority.signingAddress,
            );
          }
          responseSnapshot = applyGovernanceWorkflowTransition(
            aggregate.snapshot,
            event,
            payload,
            decision,
          );
          if (governanceWorkflowStateRoot(responseSnapshot) !== event.stateRoot)
            throw new GovernanceValidationError(
              "Governance state root is invalid",
            );
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisGovernance: false,
          eligibilitySource: "CONFIGURED_REHEARSAL_SNAPSHOT",
          directBallotsOnly: true,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        if (route.eventType === "GovernanceInspected") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            governance: responseSnapshot,
          });
        }
        if (route.eventType === "GovernanceProposalClosed") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            decision: responseSnapshot?.decision ?? null,
          });
        }
        return reply.code(result.duplicate ? 200 : 201).send(response);
      } catch (error) {
        const response = governanceError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.post("/v1/governance/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
