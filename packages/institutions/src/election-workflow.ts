import { sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import {
  INSTITUTION_SIZES,
  tallyRankedElection,
  type EligibilitySnapshot,
  type RankedElectionStanding,
} from "./governance.js";
import {
  GovernanceEligibilitySnapshotSchema,
  validateGovernanceEligibilitySnapshot,
} from "./governance-workflow.js";

export const ELECTION_WORKFLOW_AGGREGATE_TYPE = "institutional-election";
export const PREMIER_BOARD_ELECTION_INSTITUTION =
  "PREMIER_PLAYERS_ASSOCIATION_BOARD";
export const ELECTION_WORKFLOW_EVENT_TYPES = [
  "PremierElectionOpened",
  "PremierElectionCandidateDeclared",
  "PremierElectionBallotCast",
  "PremierElectionClosed",
  "PremierElectionInspected",
] as const;
export type ElectionWorkflowEventType =
  (typeof ELECTION_WORKFLOW_EVENT_TYPES)[number];

export const PremierElectionOpenCommandSchema = z.strictObject({
  electionId: UuidV7Schema,
  termId: z
    .string()
    .min(1)
    .max(160)
    .refine((value) => value === value.trim()),
  institution: z.literal(PREMIER_BOARD_ELECTION_INSTITUTION),
  seatCount: z.literal(INSTITUTION_SIZES.premierPlayersAssociationBoard),
  eligibilitySnapshotId: UuidV7Schema,
  eligibilitySnapshotDigest: Sha256Schema,
  nominationOpensAt: IsoDateTimeSchema,
  nominationClosesAt: IsoDateTimeSchema,
  votingOpensAt: IsoDateTimeSchema,
  votingClosesAt: IsoDateTimeSchema,
});
export const PremierElectionOpenPayloadSchema = z.strictObject({
  command: PremierElectionOpenCommandSchema,
  eligibilitySnapshot: GovernanceEligibilitySnapshotSchema,
});
export const PremierElectionCandidateCommandSchema = z.strictObject({
  electionId: UuidV7Schema,
  candidateDid: DidSchema,
  eligibilitySnapshotDigest: Sha256Schema,
  declaredAt: IsoDateTimeSchema,
});
export const PremierElectionCandidatePayloadSchema = z.strictObject({
  command: PremierElectionCandidateCommandSchema,
});
export const PremierElectionBallotCommandSchema = z.strictObject({
  ballotId: UuidV7Schema,
  electionId: UuidV7Schema,
  voterDid: DidSchema,
  eligibilitySnapshotDigest: Sha256Schema,
  rankedCandidateDids: z
    .array(DidSchema)
    .min(INSTITUTION_SIZES.premierPlayersAssociationBoard)
    .max(64),
  castAt: IsoDateTimeSchema,
});
export const PremierElectionBallotPayloadSchema = z.strictObject({
  command: PremierElectionBallotCommandSchema,
});
export const PremierElectionCloseCommandSchema = z.strictObject({
  electionId: UuidV7Schema,
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
});
export const PremierElectionClosePayloadSchema = z.strictObject({
  command: PremierElectionCloseCommandSchema,
});
export const PremierElectionInspectCommandSchema = z.strictObject({
  electionId: UuidV7Schema,
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-PREMIER-ELECTION-INSPECTION-V1"),
});
export const PremierElectionInspectPayloadSchema = z.strictObject({
  command: PremierElectionInspectCommandSchema,
});

export const ELECTION_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-premier-board-election-workflow",
  version: 1,
  aggregateType: ELECTION_WORKFLOW_AGGREGATE_TYPE,
  eventTypes: ELECTION_WORKFLOW_EVENT_TYPES,
  institution: PREMIER_BOARD_ELECTION_INSTITUTION,
  seats: INSTITUTION_SIZES.premierPlayersAssociationBoard,
  votingMethod: "COMPLETE_RANKED_BORDA_LEXICAL_TIE_BREAK",
  delegation: false,
});

export type PremierElectionOpenCommand = z.infer<
  typeof PremierElectionOpenCommandSchema
>;
export type PremierElectionCandidateCommand = z.infer<
  typeof PremierElectionCandidateCommandSchema
>;
export type PremierElectionBallotCommand = z.infer<
  typeof PremierElectionBallotCommandSchema
>;
export type ElectionWorkflowPayload =
  | z.infer<typeof PremierElectionOpenPayloadSchema>
  | z.infer<typeof PremierElectionCandidatePayloadSchema>
  | z.infer<typeof PremierElectionBallotPayloadSchema>
  | z.infer<typeof PremierElectionClosePayloadSchema>
  | z.infer<typeof PremierElectionInspectPayloadSchema>;

export interface PremierElectionResult {
  electionId: string;
  electedDids: readonly string[];
  standings: readonly RankedElectionStanding[];
  ballotCount: number;
  resultCommitment: Hex;
}

export interface ElectionWorkflowSnapshot {
  electionId: string;
  version: number;
  lastTransitionAt: string;
  election: PremierElectionOpenCommand;
  eligibilitySnapshot: EligibilitySnapshot;
  candidateDids: string[];
  ballots: PremierElectionBallotCommand[];
  result: PremierElectionResult | null;
  closedAt: string | null;
}

export interface ElectionWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export class ElectionWorkflowAuthorizationError extends Error {
  public override readonly name = "ElectionWorkflowAuthorizationError";
}

export class ElectionWorkflowValidationError extends Error {
  public override readonly name = "ElectionWorkflowValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ElectionWorkflowValidationError(
      "Election timestamp is not canonical",
    );
  return parsed;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new ElectionWorkflowValidationError(`${label} contains duplicates`);
}

function isPremierPlayer(snapshot: EligibilitySnapshot, did: string): boolean {
  return snapshot.members.PREMIER_PLAYERS.includes(did);
}

function isCommissioner(snapshot: EligibilitySnapshot, did: string): boolean {
  return snapshot.members.EXECUTIVE_COMMISSION.includes(did);
}

export function parseElectionWorkflowPayload(
  eventType: ElectionWorkflowEventType,
  payload: unknown,
): ElectionWorkflowPayload {
  switch (eventType) {
    case "PremierElectionOpened":
      return PremierElectionOpenPayloadSchema.parse(payload);
    case "PremierElectionCandidateDeclared":
      return PremierElectionCandidatePayloadSchema.parse(payload);
    case "PremierElectionBallotCast":
      return PremierElectionBallotPayloadSchema.parse(payload);
    case "PremierElectionClosed":
      return PremierElectionClosePayloadSchema.parse(payload);
    case "PremierElectionInspected":
      return PremierElectionInspectPayloadSchema.parse(payload);
  }
}

export function isElectionWorkflowEventType(
  value: string,
): value is ElectionWorkflowEventType {
  return ELECTION_WORKFLOW_EVENT_TYPES.includes(
    value as ElectionWorkflowEventType,
  );
}

export function electionWorkflowStateRoot(
  snapshot: ElectionWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-PREMIER-ELECTION-STATE-V1",
    ...snapshot,
  });
}

function openElection(
  event: ElectionWorkflowEvent,
  payload: z.infer<typeof PremierElectionOpenPayloadSchema>,
): ElectionWorkflowSnapshot {
  const { command, eligibilitySnapshot } = payload;
  validateGovernanceEligibilitySnapshot(eligibilitySnapshot);
  requireUnique(
    eligibilitySnapshot.members.EXECUTIVE_COMMISSION,
    "Election commissioner roll",
  );
  const openedAt = canonicalInstant(command.nominationOpensAt);
  const nominationsCloseAt = canonicalInstant(command.nominationClosesAt);
  const votingOpensAt = canonicalInstant(command.votingOpensAt);
  const votingClosesAt = canonicalInstant(command.votingClosesAt);
  const eventAt = canonicalInstant(event.timestamp);
  const capturedAt = canonicalInstant(eligibilitySnapshot.capturedAt);
  if (
    event.aggregateVersion !== 1n ||
    event.aggregateId !== command.electionId ||
    command.eligibilitySnapshotId !== eligibilitySnapshot.snapshotId ||
    command.eligibilitySnapshotDigest !==
      sha256Commitment(eligibilitySnapshot) ||
    eligibilitySnapshot.members.PREMIER_PLAYERS.length < command.seatCount ||
    eligibilitySnapshot.members.PREMIER_PLAYERS.length > 64 ||
    eligibilitySnapshot.members.EXECUTIVE_COMMISSION.length !==
      INSTITUTION_SIZES.executiveCommission ||
    !isCommissioner(eligibilitySnapshot, event.actorDid) ||
    capturedAt > eventAt ||
    eventAt > openedAt ||
    openedAt >= nominationsCloseAt ||
    nominationsCloseAt > votingOpensAt ||
    votingOpensAt >= votingClosesAt
  ) {
    throw new ElectionWorkflowAuthorizationError(
      "Election opening does not bind its commissioner, roll, or windows",
    );
  }
  return {
    electionId: command.electionId,
    version: 1,
    lastTransitionAt: event.timestamp,
    election: structuredClone(command),
    eligibilitySnapshot: structuredClone(eligibilitySnapshot),
    candidateDids: [],
    ballots: [],
    result: null,
    closedAt: null,
  };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    sha256Commitment([...left].sort()) === sha256Commitment([...right].sort())
  );
}

export function evaluatePremierElection(
  snapshot: ElectionWorkflowSnapshot,
): PremierElectionResult {
  if (
    snapshot.candidateDids.length < snapshot.election.seatCount ||
    snapshot.ballots.length === 0
  ) {
    throw new ElectionWorkflowValidationError(
      "Election cannot close without enough candidates and at least one ballot",
    );
  }
  const standings = tallyRankedElection({
    seats: snapshot.election.seatCount,
    eligibleCandidates: snapshot.candidateDids,
    rankedBallots: snapshot.ballots.map(({ rankedCandidateDids }) => [
      ...rankedCandidateDids,
    ]),
  });
  const resultBody = {
    electionId: snapshot.electionId,
    electedDids: standings
      .slice(0, snapshot.election.seatCount)
      .map(({ candidateDid }) => candidateDid),
    standings,
    ballotCount: snapshot.ballots.length,
  };
  return {
    ...resultBody,
    resultCommitment: sha256Commitment({
      format: "ABL-PREMIER-ELECTION-RESULT-V1",
      ...resultBody,
    }),
  };
}

export function applyElectionWorkflowTransition(
  current: ElectionWorkflowSnapshot | null,
  event: ElectionWorkflowEvent,
  payload: ElectionWorkflowPayload,
  result: PremierElectionResult | null = null,
): ElectionWorkflowSnapshot {
  if (current === null) {
    if (event.eventType !== "PremierElectionOpened")
      throw new ElectionWorkflowValidationError("Election must open first");
    return openElection(event, PremierElectionOpenPayloadSchema.parse(payload));
  }
  if (
    event.aggregateId !== current.electionId ||
    event.aggregateVersion !== BigInt(current.version + 1) ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new ElectionWorkflowValidationError(
      "Election aggregate sequence is invalid",
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;
  if (event.eventType === "PremierElectionOpened")
    throw new ElectionWorkflowValidationError("Election is already open");
  if (event.eventType === "PremierElectionCandidateDeclared") {
    const command =
      PremierElectionCandidatePayloadSchema.parse(payload).command;
    const declaredAt = canonicalInstant(command.declaredAt);
    if (
      next.result !== null ||
      command.electionId !== next.electionId ||
      command.candidateDid !== event.actorDid ||
      command.eligibilitySnapshotDigest !==
        next.election.eligibilitySnapshotDigest ||
      command.declaredAt !== event.timestamp ||
      !isPremierPlayer(next.eligibilitySnapshot, event.actorDid) ||
      declaredAt < canonicalInstant(next.election.nominationOpensAt) ||
      declaredAt >= canonicalInstant(next.election.nominationClosesAt)
    ) {
      throw new ElectionWorkflowAuthorizationError(
        "Election candidacy is outside self-nomination authority",
      );
    }
    if (next.candidateDids.includes(command.candidateDid))
      throw new ElectionWorkflowValidationError(
        "Election candidate is already declared",
      );
    next.candidateDids.push(command.candidateDid);
    return next;
  }
  if (event.eventType === "PremierElectionBallotCast") {
    const command = PremierElectionBallotPayloadSchema.parse(payload).command;
    const castAt = canonicalInstant(command.castAt);
    requireUnique(command.rankedCandidateDids, "Election ranking");
    if (
      next.result !== null ||
      command.electionId !== next.electionId ||
      command.voterDid !== event.actorDid ||
      command.eligibilitySnapshotDigest !==
        next.election.eligibilitySnapshotDigest ||
      command.castAt !== event.timestamp ||
      !isPremierPlayer(next.eligibilitySnapshot, event.actorDid) ||
      castAt < canonicalInstant(next.election.votingOpensAt) ||
      castAt >= canonicalInstant(next.election.votingClosesAt) ||
      !sameSet(command.rankedCandidateDids, next.candidateDids)
    ) {
      throw new ElectionWorkflowAuthorizationError(
        "Election ballot is outside voter, candidate, or window authority",
      );
    }
    if (
      next.ballots.some(
        (ballot) =>
          ballot.ballotId === command.ballotId ||
          ballot.voterDid === command.voterDid,
      )
    ) {
      throw new ElectionWorkflowValidationError(
        "Election ballot duplicates an ID or voter seat",
      );
    }
    next.ballots.push(structuredClone(command));
    return next;
  }
  if (event.eventType === "PremierElectionClosed") {
    const command = PremierElectionClosePayloadSchema.parse(payload).command;
    if (
      next.result !== null ||
      command.electionId !== next.electionId ||
      command.requestedByDid !== event.actorDid ||
      command.requestedAt !== event.timestamp ||
      !isCommissioner(next.eligibilitySnapshot, event.actorDid) ||
      canonicalInstant(command.requestedAt) <
        canonicalInstant(next.election.votingClosesAt) ||
      result === null ||
      result.electionId !== next.electionId ||
      result.resultCommitment !== evaluatePremierElection(next).resultCommitment
    ) {
      throw new ElectionWorkflowAuthorizationError(
        "Election close is outside commissioner authority or result is invalid",
      );
    }
    next.result = structuredClone(result);
    next.closedAt = event.timestamp;
    return next;
  }
  if (event.eventType !== "PremierElectionInspected")
    throw new ElectionWorkflowValidationError(
      "Election event is not recognized",
    );
  const command = PremierElectionInspectPayloadSchema.parse(payload).command;
  if (
    command.electionId !== next.electionId ||
    command.requestedByDid !== event.actorDid ||
    command.requestedAt !== event.timestamp ||
    (!isPremierPlayer(next.eligibilitySnapshot, event.actorDid) &&
      !isCommissioner(next.eligibilitySnapshot, event.actorDid))
  ) {
    throw new ElectionWorkflowAuthorizationError(
      "Election inspection is outside the frozen roll",
    );
  }
  return next;
}
