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
  createFoundingEligibilitySnapshot,
  openFoundingBootstrap,
  type FoundingBootstrapBallot,
  type FoundingBootstrapProposal,
  type FoundingBootstrapResult,
  type FoundingEligibilitySnapshot,
  type SignedFoundingBootstrapBallot,
} from "./founding.js";

const HexSha256Schema = Sha256Schema.transform((value) => value as Hex);

export const FOUNDING_BOOTSTRAP_AGGREGATE_TYPE =
  "founding-convention-bootstrap";
export const FOUNDING_BOOTSTRAP_EVENT_TYPES = [
  "FoundingBootstrapOpened",
  "FoundingBootstrapBallotCast",
  "FoundingBootstrapClosed",
] as const;
export type FoundingBootstrapEventType =
  (typeof FOUNDING_BOOTSTRAP_EVENT_TYPES)[number];

export const FoundingEligibilitySnapshotSchema = z.strictObject({
  snapshotId: UuidV7Schema,
  capturedAt: IsoDateTimeSchema,
  eligibleFounderDids: z.array(DidSchema).min(10).max(26),
  commitment: HexSha256Schema,
});
export const FoundingBootstrapProposalSchema = z.strictObject({
  proposalId: UuidV7Schema,
  snapshotCommitment: HexSha256Schema,
  openedAt: IsoDateTimeSchema,
  closesAt: IsoDateTimeSchema,
  requiredYes: z.number().int().min(7).max(26),
  directParticipationOnly: z.literal(true),
});
export const FoundingBootstrapBallotSchema = z.strictObject({
  proposalId: UuidV7Schema,
  voterDid: DidSchema,
  snapshotCommitment: HexSha256Schema,
  choice: z.enum(["YES", "NO", "ABSTAIN"]),
  castAt: IsoDateTimeSchema,
});
export const FoundingBootstrapResultSchema = z.strictObject({
  state: z.enum(["OPEN", "ADOPTED", "REJECTED", "EXPIRED"]),
  proposalId: UuidV7Schema,
  eligible: z.number().int().min(10).max(26),
  requiredYes: z.number().int().min(7).max(26),
  yes: z.number().int().nonnegative().max(26),
  no: z.number().int().nonnegative().max(26),
  abstain: z.number().int().nonnegative().max(26),
  quorumRule: z
    .strictObject({
      minimumActiveFounders: z.literal(10),
      approvalNumerator: z.literal(2),
      approvalDenominator: z.literal(3),
      minimumYes: z.literal(7),
      directParticipationOnly: z.literal(true),
      humanVotingAllowed: z.literal(false),
      adoptedByProposalId: UuidV7Schema,
      adoptedAt: IsoDateTimeSchema,
    })
    .nullable(),
});
export const FoundingBootstrapOpenPayloadSchema = z.strictObject({
  snapshot: FoundingEligibilitySnapshotSchema,
  proposal: FoundingBootstrapProposalSchema,
});
export const FoundingBootstrapBallotPayloadSchema = z.strictObject({
  command: FoundingBootstrapBallotSchema,
});
export const FoundingBootstrapClosePayloadSchema = z.strictObject({
  command: z.strictObject({
    proposalId: UuidV7Schema,
    requestedByDid: DidSchema,
    requestedAt: IsoDateTimeSchema,
  }),
});

export const FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-founding-convention-bootstrap-workflow",
  version: 2,
  aggregateType: FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
  eventTypes: FOUNDING_BOOTSTRAP_EVENT_TYPES,
  replacementPolicy: {
    additionalFounders: 2,
    cooldownDays: 7,
    parallelProposalsAllowed: false,
  },
  directParticipationOnly: true,
  humanVotingAllowed: false,
});

export type FoundingBootstrapOpenPayload = z.infer<
  typeof FoundingBootstrapOpenPayloadSchema
>;
export type FoundingBootstrapClosePayload = z.infer<
  typeof FoundingBootstrapClosePayloadSchema
>;
export type FoundingBootstrapWorkflowPayload =
  | FoundingBootstrapOpenPayload
  | z.infer<typeof FoundingBootstrapBallotPayloadSchema>
  | FoundingBootstrapClosePayload;

export interface FoundingBootstrapWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface FoundingBootstrapAttempt {
  snapshot: FoundingEligibilitySnapshot;
  proposal: FoundingBootstrapProposal;
  ballots: FoundingBootstrapBallot[];
  result: FoundingBootstrapResult | null;
  closedAt: string | null;
}

export interface FoundingBootstrapWorkflowSnapshot
  extends FoundingBootstrapAttempt {
  conventionId: string;
  proposalId: string;
  version: number;
  lastTransitionAt: string;
  previousAttempts: FoundingBootstrapAttempt[];
}

export class FoundingBootstrapWorkflowAuthorizationError extends Error {
  public override readonly name = "FoundingBootstrapWorkflowAuthorizationError";
}

export class FoundingBootstrapWorkflowValidationError extends Error {
  public override readonly name = "FoundingBootstrapWorkflowValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new FoundingBootstrapWorkflowValidationError(
      "Founding bootstrap timestamp is not canonical",
    );
  return parsed;
}

function deterministicOpen(payload: FoundingBootstrapOpenPayload): {
  snapshot: FoundingEligibilitySnapshot;
  proposal: FoundingBootstrapProposal;
} {
  const snapshot = createFoundingEligibilitySnapshot(payload.snapshot);
  const proposal = openFoundingBootstrap({
    proposalId: payload.proposal.proposalId,
    snapshot,
    openedAt: payload.proposal.openedAt,
  });
  if (
    sha256Commitment(snapshot) !== sha256Commitment(payload.snapshot) ||
    sha256Commitment(proposal) !== sha256Commitment(payload.proposal)
  ) {
    throw new FoundingBootstrapWorkflowValidationError(
      "Founding bootstrap open payload is not deterministic",
    );
  }
  return { snapshot, proposal };
}

export function parseFoundingBootstrapWorkflowPayload(
  eventType: FoundingBootstrapEventType,
  payload: unknown,
): FoundingBootstrapWorkflowPayload {
  switch (eventType) {
    case "FoundingBootstrapOpened":
      return FoundingBootstrapOpenPayloadSchema.parse(payload);
    case "FoundingBootstrapBallotCast":
      return FoundingBootstrapBallotPayloadSchema.parse(payload);
    case "FoundingBootstrapClosed":
      return FoundingBootstrapClosePayloadSchema.parse(payload);
  }
}

export function isFoundingBootstrapEventType(
  value: string,
): value is FoundingBootstrapEventType {
  return FOUNDING_BOOTSTRAP_EVENT_TYPES.includes(
    value as FoundingBootstrapEventType,
  );
}

export function foundingBootstrapWorkflowStateRoot(
  snapshot: FoundingBootstrapWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-FOUNDING-BOOTSTRAP-STATE-V2",
    ...snapshot,
  });
}

function openWorkflow(
  event: FoundingBootstrapWorkflowEvent,
  payload: FoundingBootstrapOpenPayload,
): FoundingBootstrapWorkflowSnapshot {
  const opened = deterministicOpen(payload);
  if (
    event.aggregateVersion !== 1n ||
    event.timestamp !== opened.proposal.openedAt ||
    !opened.snapshot.eligibleFounderDids.includes(event.actorDid)
  ) {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding bootstrap open event lacks founder authority",
    );
  }
  return {
    conventionId: event.aggregateId,
    proposalId: opened.proposal.proposalId,
    version: 1,
    lastTransitionAt: event.timestamp,
    snapshot: opened.snapshot,
    proposal: opened.proposal,
    ballots: [],
    result: null,
    closedAt: null,
    previousAttempts: [],
  };
}

function currentAttempt(
  snapshot: FoundingBootstrapWorkflowSnapshot,
): FoundingBootstrapAttempt {
  return structuredClone({
    snapshot: snapshot.snapshot,
    proposal: snapshot.proposal,
    ballots: snapshot.ballots,
    result: snapshot.result,
    closedAt: snapshot.closedAt,
  });
}

function openReplacement(
  current: FoundingBootstrapWorkflowSnapshot,
  event: FoundingBootstrapWorkflowEvent,
  payload: FoundingBootstrapOpenPayload,
): FoundingBootstrapWorkflowSnapshot {
  const opened = deterministicOpen(payload);
  const priorResult = current.result;
  if (
    priorResult === null ||
    priorResult.state === "OPEN" ||
    priorResult.state === "ADOPTED" ||
    event.timestamp !== opened.proposal.openedAt ||
    !opened.snapshot.eligibleFounderDids.includes(event.actorDid)
  ) {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding bootstrap replacement is not authorized",
    );
  }
  const priorProposalIds = new Set([
    current.proposalId,
    ...current.previousAttempts.map(({ proposal }) => proposal.proposalId),
  ]);
  const priorFounders = new Set(current.snapshot.eligibleFounderDids);
  const hasTwoAdditionalFounders =
    opened.snapshot.eligibleFounderDids.filter((did) => !priorFounders.has(did))
      .length >= 2;
  const sevenDaysElapsed =
    canonicalInstant(opened.proposal.openedAt) >=
    canonicalInstant(current.proposal.closesAt) + 7 * 24 * 60 * 60 * 1_000;
  if (
    priorProposalIds.has(opened.proposal.proposalId) ||
    (!hasTwoAdditionalFounders && !sevenDaysElapsed)
  ) {
    throw new FoundingBootstrapWorkflowValidationError(
      "Founding bootstrap replacement cooldown is not satisfied",
    );
  }
  return {
    conventionId: current.conventionId,
    proposalId: opened.proposal.proposalId,
    version: current.version + 1,
    lastTransitionAt: event.timestamp,
    snapshot: opened.snapshot,
    proposal: opened.proposal,
    ballots: [],
    result: null,
    closedAt: null,
    previousAttempts: [
      ...structuredClone(current.previousAttempts),
      currentAttempt(current),
    ],
  };
}

export function applyFoundingBootstrapWorkflowTransition(
  current: FoundingBootstrapWorkflowSnapshot | null,
  event: FoundingBootstrapWorkflowEvent,
  payload: FoundingBootstrapWorkflowPayload,
  result: FoundingBootstrapResult | null = null,
): FoundingBootstrapWorkflowSnapshot {
  if (current === null) {
    if (event.eventType !== "FoundingBootstrapOpened")
      throw new FoundingBootstrapWorkflowValidationError(
        "Founding bootstrap must be opened first",
      );
    return openWorkflow(
      event,
      FoundingBootstrapOpenPayloadSchema.parse(payload),
    );
  }
  if (
    event.aggregateVersion !== BigInt(current.version + 1) ||
    event.aggregateId !== current.conventionId ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new FoundingBootstrapWorkflowValidationError(
      "Founding bootstrap aggregate sequence is invalid",
    );
  }
  if (event.eventType === "FoundingBootstrapOpened") {
    return openReplacement(
      current,
      event,
      FoundingBootstrapOpenPayloadSchema.parse(payload),
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;
  if (event.eventType === "FoundingBootstrapBallotCast") {
    if (next.result !== null)
      throw new FoundingBootstrapWorkflowValidationError(
        "Closed founding bootstrap cannot accept ballots",
      );
    const ballot = FoundingBootstrapBallotPayloadSchema.parse(payload).command;
    const castAt = canonicalInstant(ballot.castAt);
    if (
      ballot.voterDid !== event.actorDid ||
      ballot.proposalId !== next.proposalId ||
      ballot.snapshotCommitment !== next.snapshot.commitment ||
      ballot.castAt !== event.timestamp ||
      castAt < canonicalInstant(next.proposal.openedAt) ||
      castAt >= canonicalInstant(next.proposal.closesAt) ||
      !next.snapshot.eligibleFounderDids.includes(ballot.voterDid)
    ) {
      throw new FoundingBootstrapWorkflowAuthorizationError(
        "Founding bootstrap ballot lacks direct founder authority",
      );
    }
    if (next.ballots.some(({ voterDid }) => voterDid === ballot.voterDid))
      throw new FoundingBootstrapWorkflowValidationError(
        "Founding bootstrap founder already voted",
      );
    next.ballots.push(structuredClone(ballot));
    return next;
  }
  if (event.eventType !== "FoundingBootstrapClosed")
    throw new FoundingBootstrapWorkflowValidationError(
      "Founding bootstrap event type is not recognized",
    );
  const close = FoundingBootstrapClosePayloadSchema.parse(payload).command;
  const parsedResult = FoundingBootstrapResultSchema.parse(result);
  if (
    next.result !== null ||
    close.proposalId !== next.proposalId ||
    close.requestedByDid !== event.actorDid ||
    close.requestedAt !== event.timestamp ||
    canonicalInstant(close.requestedAt) <
      canonicalInstant(next.proposal.closesAt) ||
    !next.snapshot.eligibleFounderDids.includes(event.actorDid) ||
    parsedResult.proposalId !== next.proposalId ||
    parsedResult.state === "OPEN"
  ) {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding bootstrap close event is invalid",
    );
  }
  next.result = structuredClone(parsedResult);
  next.closedAt = event.timestamp;
  return next;
}

export function foundingBootstrapBallotFromAuthorization(
  ballot: FoundingBootstrapBallot,
  event: CanonicalEvent,
  signature: string,
  signerAddress: `0x${string}`,
): SignedFoundingBootstrapBallot {
  return {
    ballot: structuredClone(ballot),
    authorizationEvent: event as CanonicalEvent<{
      command: FoundingBootstrapBallot;
    }>,
    signature: signature as Hex,
    signerAddress,
  };
}
