import { sha256Commitment, type CanonicalEvent } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import {
  evaluateProposal,
  type Chamber,
  type EligibilitySnapshot,
  type GovernanceBallot,
  type GovernanceDecision,
  type GovernanceProposal,
  type GovernanceVote,
  type InstitutionalAuthorizationContext,
} from "./governance.js";

export const GOVERNANCE_WORKFLOW_AGGREGATE_TYPE = "governance-proposal";
export const GOVERNANCE_WORKFLOW_CHAMBERS = [
  "UNIVERSAL_CAREER_ASSEMBLY",
  "PREMIER_PLAYERS",
  "DEVELOPMENT_PLAYERS",
  "PREMIER_TEAM_COUNCIL",
  "DEVELOPMENT_TEAM_COUNCIL",
  "EXECUTIVE_COMMISSION",
  "TRIBUNAL",
  "INTEGRITY_OFFICE",
] as const satisfies readonly Chamber[];
export const GOVERNANCE_WORKFLOW_EVENT_TYPES = [
  "GovernanceProposalRegistered",
  "GovernanceBallotCast",
  "GovernanceProposalClosed",
  "GovernanceInspected",
] as const;
export type GovernanceWorkflowEventType =
  (typeof GOVERNANCE_WORKFLOW_EVENT_TYPES)[number];

const ChamberSchema = z.enum(GOVERNANCE_WORKFLOW_CHAMBERS);
export const GovernanceEligibilitySnapshotSchema = z.strictObject({
  snapshotId: UuidV7Schema,
  capturedAt: IsoDateTimeSchema,
  members: z.strictObject(
    Object.fromEntries(
      GOVERNANCE_WORKFLOW_CHAMBERS.map((chamber) => [
        chamber,
        z.array(DidSchema),
      ]),
    ) as Record<Chamber, z.ZodArray<typeof DidSchema>>,
  ),
});
export const GovernanceProposalCommandSchema = z.strictObject({
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
export const GovernanceProposalRegistrationPayloadSchema = z.strictObject({
  proposal: GovernanceProposalCommandSchema,
  eligibilitySnapshot: GovernanceEligibilitySnapshotSchema,
  recusedDids: z.array(DidSchema),
});
export const GovernanceBallotCommandSchema = z.strictObject({
  ballotId: UuidV7Schema,
  voterDid: DidSchema,
  chamber: ChamberSchema,
  choice: z.enum(["YES", "NO", "ABSTAIN"]),
  proposalId: UuidV7Schema,
  proposalVersion: z.number().int().positive(),
  eligibilitySnapshotDigest: Sha256Schema,
  castAt: IsoDateTimeSchema,
});
export const GovernanceBallotPayloadSchema = z.strictObject({
  command: GovernanceBallotCommandSchema,
});
export const GovernanceCloseCommandSchema = z.strictObject({
  proposalId: UuidV7Schema,
  proposalVersion: z.number().int().positive(),
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
});
export const GovernanceClosePayloadSchema = z.strictObject({
  command: GovernanceCloseCommandSchema,
});
export const GovernanceInspectCommandSchema = z.strictObject({
  proposalId: UuidV7Schema,
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-GOVERNANCE-INSPECTION-V1"),
});
export const GovernanceInspectPayloadSchema = z.strictObject({
  command: GovernanceInspectCommandSchema,
});

export const GOVERNANCE_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-governance-proposal-workflow",
  version: 1,
  aggregateType: GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  eventTypes: GOVERNANCE_WORKFLOW_EVENT_TYPES,
  directBallotsOnly: true,
  eligibilityMode: "CONFIGURED_REHEARSAL_SNAPSHOT",
});

export type GovernanceProposalCommand = z.infer<
  typeof GovernanceProposalCommandSchema
>;
export type GovernanceBallotCommand = z.infer<
  typeof GovernanceBallotCommandSchema
>;
export type GovernanceProposalRegistrationPayload = z.infer<
  typeof GovernanceProposalRegistrationPayloadSchema
>;
export type GovernanceWorkflowPayload =
  | GovernanceProposalRegistrationPayload
  | z.infer<typeof GovernanceBallotPayloadSchema>
  | z.infer<typeof GovernanceClosePayloadSchema>
  | z.infer<typeof GovernanceInspectPayloadSchema>;

export interface GovernanceWorkflowSnapshot {
  proposalId: string;
  version: number;
  lastTransitionAt: string;
  proposal: GovernanceProposalCommand;
  eligibilitySnapshot: EligibilitySnapshot;
  recusedDids: string[];
  ballots: GovernanceBallotCommand[];
  decision: GovernanceDecision | null;
  closedAt: string | null;
}

export interface GovernanceWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export class GovernanceWorkflowAuthorizationError extends Error {
  public override readonly name = "GovernanceWorkflowAuthorizationError";
}

export class GovernanceWorkflowValidationError extends Error {
  public override readonly name = "GovernanceWorkflowValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new GovernanceWorkflowValidationError(
      "Governance timestamp is not canonical",
    );
  return parsed;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new GovernanceWorkflowValidationError(`${label} contains duplicates`);
}

export function validateGovernanceEligibilitySnapshot(
  snapshot: EligibilitySnapshot,
): void {
  canonicalInstant(snapshot.capturedAt);
  for (const chamber of GOVERNANCE_WORKFLOW_CHAMBERS)
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
    throw new GovernanceWorkflowValidationError(
      "Universal assembly must exactly contain both disjoint player tiers",
    );
  }
}

function validateProposalRegistration(
  registration: GovernanceProposalRegistrationPayload,
  actorDid: string,
  aggregateId: string,
  timestamp: string,
): void {
  const { proposal, eligibilitySnapshot, recusedDids } = registration;
  validateGovernanceEligibilitySnapshot(eligibilitySnapshot);
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
    throw new GovernanceWorkflowValidationError(
      "Governance proposal does not bind its proposer, snapshot, or window",
    );
  }
  if (
    (proposal.proposalClass === "TIER_CBA") !==
    (proposal.tier !== undefined)
  ) {
    throw new GovernanceWorkflowValidationError(
      "Tier CBA proposals must select exactly one tier",
    );
  }
  const allMembers = new Set(
    GOVERNANCE_WORKFLOW_CHAMBERS.flatMap(
      (chamber) => eligibilitySnapshot.members[chamber],
    ),
  );
  if (!allMembers.has(actorDid))
    throw new GovernanceWorkflowAuthorizationError(
      "Proposal author is outside the eligibility snapshot",
    );
  if (recusedDids.some((did) => !allMembers.has(did)))
    throw new GovernanceWorkflowValidationError(
      "Governance recusal is outside the eligibility snapshot",
    );
}

function isEligible(snapshot: EligibilitySnapshot, agentDid: string): boolean {
  return GOVERNANCE_WORKFLOW_CHAMBERS.some((chamber) =>
    snapshot.members[chamber].includes(agentDid),
  );
}

export function parseGovernanceWorkflowPayload(
  eventType: GovernanceWorkflowEventType,
  payload: unknown,
): GovernanceWorkflowPayload {
  switch (eventType) {
    case "GovernanceProposalRegistered":
      return GovernanceProposalRegistrationPayloadSchema.parse(payload);
    case "GovernanceBallotCast":
      return GovernanceBallotPayloadSchema.parse(payload);
    case "GovernanceProposalClosed":
      return GovernanceClosePayloadSchema.parse(payload);
    case "GovernanceInspected":
      return GovernanceInspectPayloadSchema.parse(payload);
  }
}

export function isGovernanceWorkflowEventType(
  value: string,
): value is GovernanceWorkflowEventType {
  return GOVERNANCE_WORKFLOW_EVENT_TYPES.includes(
    value as GovernanceWorkflowEventType,
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

function registerProposal(
  event: GovernanceWorkflowEvent,
  registration: GovernanceProposalRegistrationPayload,
): GovernanceWorkflowSnapshot {
  if (event.aggregateVersion !== 1n)
    throw new GovernanceWorkflowValidationError(
      "Governance proposal registration must be version one",
    );
  validateProposalRegistration(
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
  event: GovernanceWorkflowEvent,
  payload: GovernanceWorkflowPayload,
  decision: GovernanceDecision | null = null,
): GovernanceWorkflowSnapshot {
  if (current === null) {
    if (event.eventType !== "GovernanceProposalRegistered")
      throw new GovernanceWorkflowValidationError(
        "Governance proposal must be registered first",
      );
    return registerProposal(
      event,
      GovernanceProposalRegistrationPayloadSchema.parse(payload),
    );
  }
  if (
    event.aggregateVersion !== BigInt(current.version + 1) ||
    event.aggregateId !== current.proposalId ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new GovernanceWorkflowValidationError(
      "Governance aggregate sequence is invalid",
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;

  if (event.eventType === "GovernanceProposalRegistered")
    throw new GovernanceWorkflowValidationError(
      "Governance proposal already exists",
    );
  if (event.eventType === "GovernanceBallotCast") {
    if (next.decision !== null)
      throw new GovernanceWorkflowValidationError(
        "Closed proposal cannot accept ballots",
      );
    const ballot = GovernanceBallotPayloadSchema.parse(payload).command;
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
      throw new GovernanceWorkflowAuthorizationError(
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
      throw new GovernanceWorkflowValidationError(
        "Governance ballot duplicates an ID or eligible seat",
      );
    }
    next.ballots.push(structuredClone(ballot));
    return next;
  }
  if (event.eventType === "GovernanceProposalClosed") {
    const close = GovernanceClosePayloadSchema.parse(payload).command;
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
      throw new GovernanceWorkflowValidationError(
        "Governance close request or deterministic decision is invalid",
      );
    }
    next.decision = structuredClone(decision);
    next.closedAt = event.timestamp;
    return next;
  }
  if (event.eventType !== "GovernanceInspected")
    throw new GovernanceWorkflowValidationError(
      "Governance event type is not recognized",
    );
  const inspection = GovernanceInspectPayloadSchema.parse(payload).command;
  if (
    inspection.proposalId !== next.proposalId ||
    inspection.requestedByDid !== event.actorDid ||
    inspection.requestedAt !== event.timestamp ||
    !isEligible(next.eligibilitySnapshot, event.actorDid)
  ) {
    throw new GovernanceWorkflowAuthorizationError(
      "Governance inspection is outside proposal authority",
    );
  }
  return next;
}

function domainProposalClass(
  proposal: GovernanceProposalCommand,
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

function domainProposal(
  snapshot: GovernanceWorkflowSnapshot,
): GovernanceProposal {
  const { proposal } = snapshot;
  const result: GovernanceProposal = {
    proposalId: proposal.proposalId,
    version: proposal.version,
    proposalClass: domainProposalClass(proposal),
    openedAt: proposal.opensAt,
    closesAt: proposal.closesAt,
    eligibilitySnapshotId: snapshot.eligibilitySnapshot.snapshotId,
    eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest as Hex,
  };
  if (proposal.deliberationSeasons !== undefined)
    result.deliberationSeasons = proposal.deliberationSeasons;
  if (proposal.fundedApplication !== undefined)
    result.fundedApplication = proposal.fundedApplication;
  if (proposal.auditsPassed !== undefined)
    result.auditsPassed = proposal.auditsPassed;
  return result;
}

export function governanceVoteFromAuthorization(
  ballot: GovernanceBallotCommand,
  event: CanonicalEvent,
  signature: string,
  signerAddress: `0x${string}`,
): GovernanceVote {
  const command: GovernanceBallot = {
    ...ballot,
    eligibilitySnapshotDigest: ballot.eligibilitySnapshotDigest as Hex,
  };
  return {
    ...command,
    authorizationEvent: event as CanonicalEvent<{
      command: GovernanceBallot;
    }>,
    signature: signature as Hex,
    signerAddress,
    authorizationAggregateVersion: Number(event.aggregateVersion),
    authorizationStateRoot: event.stateRoot,
  };
}

export async function evaluateGovernanceWorkflowDecision(
  snapshot: GovernanceWorkflowSnapshot,
  votes: readonly GovernanceVote[],
  authorization: InstitutionalAuthorizationContext,
): Promise<GovernanceDecision> {
  return evaluateProposal({
    proposal: domainProposal(snapshot),
    snapshot: snapshot.eligibilitySnapshot,
    votes,
    recusals: snapshot.recusedDids,
    authorization,
  });
}
