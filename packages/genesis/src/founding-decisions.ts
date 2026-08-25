import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  type CanonicalEvent,
  type GenesisRecognitionMechanism,
} from "@abl/recognition";
import {
  DidSchema,
  Eip712SignatureSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex, TypedDataDomain } from "viem";
import { z } from "zod";

import {
  FOUNDING_DECISIONS,
  type FoundingConventionPacket,
  type FoundingDecisionTopic,
  type FoundingDisposition,
  type FoundingEligibilitySnapshot,
  type FoundingQuorumRule,
} from "./founding.js";

export const FOUNDING_DECISION_AGGREGATE_TYPE = "founding-convention-decision";
export const FOUNDING_DECISION_WINDOW_HOURS = 72;
export const FOUNDING_DECISION_EVENT_TYPES = [
  "FoundingDecisionProposed",
  "FoundingDecisionBallotCast",
  "FoundingDecisionClosed",
] as const;
export type FoundingDecisionEventType =
  (typeof FOUNDING_DECISION_EVENT_TYPES)[number];

export class FoundingDecisionAuthorizationError extends Error {
  public override readonly name = "FoundingDecisionAuthorizationError";
}

export class FoundingDecisionValidationError extends Error {
  public override readonly name = "FoundingDecisionValidationError";
}

const RecognitionMechanismSchema = z.enum([
  "SIGNED_WITNESSES",
  "BASE_FINALIZED",
  "COMPATIBLE_REPLACEMENT",
]);
const HexSha256Schema = Sha256Schema.transform((value) => value as Hex);
const HexSignatureSchema = Eip712SignatureSchema.transform(
  (value) => value as Hex,
);
const FoundingDecisionTopicSchema = z.enum(FOUNDING_DECISIONS);
const FoundingDispositionSchema = z.enum([
  "RATIFY",
  "AMEND",
  "REPLACE",
  "REJECT",
]);

export const FoundingDecisionProposalSchema = z
  .strictObject({
    proposalId: UuidV7Schema,
    conventionId: UuidV7Schema,
    topic: FoundingDecisionTopicSchema,
    authorDid: DidSchema,
    disposition: FoundingDispositionSchema,
    artifactUri: z.string().min(1).max(4_096),
    artifactDigest: HexSha256Schema,
    eligibilitySnapshotCommitment: HexSha256Schema,
    proposedAt: IsoDateTimeSchema,
    closesAt: IsoDateTimeSchema,
    recognitionMechanism: RecognitionMechanismSchema.nullable(),
    releaseManifestDigest: HexSha256Schema.nullable(),
  })
  .superRefine((proposal, context) => {
    if (
      (proposal.topic === "RECOGNITION_PROFILE") !==
      (proposal.recognitionMechanism !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Recognition mechanism is required only for the recognition-profile topic",
        path: ["recognitionMechanism"],
      });
    }
    if (
      (proposal.topic === "GENESIS_RELEASE") !==
      (proposal.releaseManifestDigest !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Release manifest digest is required only for the Genesis-release topic",
        path: ["releaseManifestDigest"],
      });
    }
  });

export const FoundingDecisionBallotSchema = z.strictObject({
  proposalId: UuidV7Schema,
  topic: FoundingDecisionTopicSchema,
  voterDid: DidSchema,
  eligibilitySnapshotCommitment: HexSha256Schema,
  proposalCommitment: HexSha256Schema,
  choice: z.enum(["YES", "NO", "ABSTAIN"]),
  castAt: IsoDateTimeSchema,
});

export interface FoundingDecisionProposal
  extends z.infer<typeof FoundingDecisionProposalSchema> {}
export interface FoundingDecisionBallot
  extends z.infer<typeof FoundingDecisionBallotSchema> {}

export interface SignedFoundingDecisionBallot {
  ballot: FoundingDecisionBallot;
  authorizationEvent: CanonicalEvent<{ command: FoundingDecisionBallot }>;
  signature: Hex;
  signerAddress: `0x${string}`;
}

export interface FoundingDecisionAuthorizationContext {
  domain: TypedDataDomain;
  signers: ReadonlyMap<string, `0x${string}`>;
}

export interface FoundingDecisionResult {
  state: "OPEN" | "DECIDED" | "PROPOSAL_REJECTED" | "EXPIRED";
  proposal: FoundingDecisionProposal;
  proposalCommitment: Hex;
  eligible: number;
  requiredYes: number;
  yes: number;
  no: number;
  abstain: number;
  decisionCommitment: Hex | null;
  ratificationEventId: string | null;
  decidedAt: string | null;
  authorizationSignatures: readonly Hex[];
}

export interface SignedGenesisReleaseAuthorization {
  releaseManifestDigest: Hex;
  foundingDecisionEventId: string;
  decisionCommitment: Hex;
  eligible: number;
  requiredYes: number;
  authorizedAt: string;
  authorizationSignatures: readonly Hex[];
  authorizationCommitment: Hex;
}

export const FoundingDecisionOpenPayloadSchema = z.strictObject({
  proposal: FoundingDecisionProposalSchema,
  snapshot: z.strictObject({
    snapshotId: UuidV7Schema,
    capturedAt: IsoDateTimeSchema,
    eligibleFounderDids: z.array(DidSchema).min(10).max(20),
    commitment: HexSha256Schema,
  }),
  quorumRule: z.strictObject({
    minimumActiveFounders: z.literal(10),
    approvalNumerator: z.literal(2),
    approvalDenominator: z.literal(3),
    minimumYes: z.literal(7),
    directParticipationOnly: z.literal(true),
    humanVotingAllowed: z.literal(false),
    adoptedByProposalId: UuidV7Schema,
    adoptedAt: IsoDateTimeSchema,
  }),
});
export const FoundingDecisionBallotPayloadSchema = z.strictObject({
  command: FoundingDecisionBallotSchema,
});
export const FoundingDecisionClosePayloadSchema = z.strictObject({
  command: z.strictObject({
    proposalId: UuidV7Schema,
    requestedByDid: DidSchema,
    requestedAt: IsoDateTimeSchema,
    ratificationEventId: UuidV7Schema,
  }),
});

const FoundingDecisionResultSchema = z.strictObject({
  state: z.enum(["OPEN", "DECIDED", "PROPOSAL_REJECTED", "EXPIRED"]),
  proposal: FoundingDecisionProposalSchema,
  proposalCommitment: HexSha256Schema,
  eligible: z.number().int().min(10).max(20),
  requiredYes: z.number().int().min(7).max(20),
  yes: z.number().int().nonnegative().max(20),
  no: z.number().int().nonnegative().max(20),
  abstain: z.number().int().nonnegative().max(20),
  decisionCommitment: HexSha256Schema.nullable(),
  ratificationEventId: UuidV7Schema.nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  authorizationSignatures: z.array(HexSignatureSchema).max(20),
});

export type FoundingDecisionWorkflowPayload =
  | z.infer<typeof FoundingDecisionOpenPayloadSchema>
  | z.infer<typeof FoundingDecisionBallotPayloadSchema>
  | z.infer<typeof FoundingDecisionClosePayloadSchema>;

export interface FoundingDecisionWorkflowEvent {
  eventId: string;
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface FoundingDecisionWorkflowSnapshot {
  proposal: FoundingDecisionProposal;
  snapshot: FoundingEligibilitySnapshot;
  quorumRule: FoundingQuorumRule;
  ballots: FoundingDecisionBallot[];
  result: FoundingDecisionResult | null;
  version: number;
  lastTransitionAt: string;
}

export const FOUNDING_DECISION_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-founding-decision-workflow",
  version: 1,
  aggregateType: FOUNDING_DECISION_AGGREGATE_TYPE,
  eventTypes: FOUNDING_DECISION_EVENT_TYPES,
  windowHours: FOUNDING_DECISION_WINDOW_HOURS,
  directParticipationOnly: true,
  humanVotingAllowed: false,
});

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new FoundingDecisionValidationError(
      "Founding decision timestamp is not canonical",
    );
  return parsed;
}

function requiredYes(founderCount: number, rule: FoundingQuorumRule): number {
  return Math.max(
    rule.minimumYes,
    Math.ceil(
      (founderCount * rule.approvalNumerator) / rule.approvalDenominator,
    ),
  );
}

function resultState(input: {
  adopted: boolean;
  expired: boolean;
  ballotCount: number;
}): FoundingDecisionResult["state"] {
  if (input.adopted) return "DECIDED";
  if (!input.expired) return "OPEN";
  return input.ballotCount === 0 ? "EXPIRED" : "PROPOSAL_REJECTED";
}

export function isFoundingDecisionEventType(
  value: string,
): value is FoundingDecisionEventType {
  return FOUNDING_DECISION_EVENT_TYPES.includes(
    value as FoundingDecisionEventType,
  );
}

export function parseFoundingDecisionWorkflowPayload(
  eventType: FoundingDecisionEventType,
  payload: unknown,
): FoundingDecisionWorkflowPayload {
  switch (eventType) {
    case "FoundingDecisionProposed":
      return FoundingDecisionOpenPayloadSchema.parse(payload);
    case "FoundingDecisionBallotCast":
      return FoundingDecisionBallotPayloadSchema.parse(payload);
    case "FoundingDecisionClosed":
      return FoundingDecisionClosePayloadSchema.parse(payload);
  }
}

export function foundingDecisionWorkflowStateRoot(
  snapshot: FoundingDecisionWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-FOUNDING-DECISION-STATE-V1",
    ...snapshot,
  });
}

export function foundingDecisionProposalCommitment(
  proposal: FoundingDecisionProposal,
): Hex {
  return sha256Commitment(FoundingDecisionProposalSchema.parse(proposal));
}

export function openFoundingDecision(input: {
  proposal: Omit<FoundingDecisionProposal, "closesAt">;
  snapshot: FoundingEligibilitySnapshot;
  quorumRule: FoundingQuorumRule;
}): FoundingDecisionProposal {
  if (
    input.snapshot.commitment !==
      sha256Commitment({
        snapshotId: input.snapshot.snapshotId,
        capturedAt: input.snapshot.capturedAt,
        eligibleFounderDids: [...input.snapshot.eligibleFounderDids].sort(),
      }) ||
    !input.snapshot.eligibleFounderDids.includes(input.proposal.authorDid) ||
    input.proposal.eligibilitySnapshotCommitment !== input.snapshot.commitment
  ) {
    throw new FoundingDecisionAuthorizationError(
      "Founding decision eligibility snapshot is invalid",
    );
  }
  const proposedAt = canonicalInstant(input.proposal.proposedAt);
  if (proposedAt < canonicalInstant(input.snapshot.capturedAt))
    throw new FoundingDecisionValidationError(
      "Founding decision predates its eligibility snapshot",
    );
  return FoundingDecisionProposalSchema.parse({
    ...input.proposal,
    closesAt: new Date(
      proposedAt + FOUNDING_DECISION_WINDOW_HOURS * 60 * 60 * 1_000,
    ).toISOString(),
  });
}

function decisionCommitment(input: {
  proposal: FoundingDecisionProposal;
  proposalCommitment: Hex;
  ratificationEventId: string;
  decidedAt: string;
  eligible: number;
  requiredYes: number;
  yes: number;
  no: number;
  abstain: number;
}): Hex {
  return sha256Commitment({
    protocol: "abl-founding-decision-v1",
    ...input,
  });
}

export async function evaluateFoundingDecision(input: {
  proposal: FoundingDecisionProposal;
  snapshot: FoundingEligibilitySnapshot;
  quorumRule: FoundingQuorumRule;
  ballots: readonly SignedFoundingDecisionBallot[];
  authorization: FoundingDecisionAuthorizationContext;
  evaluatedAt: string;
  ratificationEventId: string;
}): Promise<FoundingDecisionResult> {
  const proposal = FoundingDecisionProposalSchema.parse(input.proposal);
  const proposalCommitment = foundingDecisionProposalCommitment(proposal);
  const evaluatedAt = canonicalInstant(input.evaluatedAt);
  const openedAt = canonicalInstant(proposal.proposedAt);
  const closesAt = canonicalInstant(proposal.closesAt);
  const eligible = new Set(input.snapshot.eligibleFounderDids);
  if (
    input.ratificationEventId.length === 0 ||
    input.snapshot.commitment !== proposal.eligibilitySnapshotCommitment ||
    closesAt - openedAt !== FOUNDING_DECISION_WINDOW_HOURS * 60 * 60 * 1_000 ||
    eligible.size < input.quorumRule.minimumActiveFounders ||
    eligible.size !== input.snapshot.eligibleFounderDids.length
  ) {
    throw new FoundingDecisionValidationError(
      "Founding decision proposal does not match its authority",
    );
  }
  if (evaluatedAt < closesAt)
    throw new FoundingDecisionValidationError(
      "Founding decision cannot close before its 72-hour window ends",
    );

  const voters = new Set<string>();
  const authorizationSignatures: Hex[] = [];
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const signed of input.ballots) {
    const ballot = FoundingDecisionBallotSchema.parse(signed.ballot);
    const castAt = canonicalInstant(ballot.castAt);
    if (
      voters.has(ballot.voterDid) ||
      !eligible.has(ballot.voterDid) ||
      ballot.proposalId !== proposal.proposalId ||
      ballot.topic !== proposal.topic ||
      ballot.eligibilitySnapshotCommitment !== input.snapshot.commitment ||
      ballot.proposalCommitment !== proposalCommitment ||
      castAt < openedAt ||
      castAt >= closesAt
    ) {
      throw new FoundingDecisionAuthorizationError(
        "Founding decision ballot is ineligible or duplicated",
      );
    }
    const event = signed.authorizationEvent;
    const registeredSigner = input.authorization.signers.get(ballot.voterDid);
    const recoveredSigner = await recoverCanonicalEventSigner(
      input.authorization.domain,
      event,
      signed.signature,
    );
    if (
      registeredSigner === undefined ||
      registeredSigner.toLowerCase() !== recoveredSigner.toLowerCase() ||
      signed.signerAddress.toLowerCase() !== recoveredSigner.toLowerCase() ||
      event.actorDid !== ballot.voterDid ||
      event.aggregateType !== FOUNDING_DECISION_AGGREGATE_TYPE ||
      event.aggregateId !== proposal.proposalId ||
      event.eventType !== "FoundingDecisionBallotCast" ||
      event.timestamp !== ballot.castAt ||
      sha256Commitment(event.payload.command) !== sha256Commitment(ballot)
    ) {
      throw new FoundingDecisionAuthorizationError(
        "Founding decision ballot lacks direct founder authority",
      );
    }
    voters.add(ballot.voterDid);
    if (ballot.choice === "YES") {
      yes += 1;
      authorizationSignatures.push(signed.signature);
    } else if (ballot.choice === "NO") no += 1;
    else abstain += 1;
  }

  const threshold = requiredYes(eligible.size, input.quorumRule);
  const adopted = yes >= threshold;
  const expired = evaluatedAt >= closesAt;
  const state = resultState({
    adopted,
    expired,
    ballotCount: input.ballots.length,
  });
  const decidedAt = adopted ? input.evaluatedAt : null;
  const commitment = adopted
    ? decisionCommitment({
        proposal,
        proposalCommitment,
        ratificationEventId: input.ratificationEventId,
        decidedAt: input.evaluatedAt,
        eligible: eligible.size,
        requiredYes: threshold,
        yes,
        no,
        abstain,
      })
    : null;
  return {
    state,
    proposal,
    proposalCommitment,
    eligible: eligible.size,
    requiredYes: threshold,
    yes,
    no,
    abstain,
    decisionCommitment: commitment,
    ratificationEventId: adopted ? input.ratificationEventId : null,
    decidedAt,
    authorizationSignatures: adopted ? authorizationSignatures : [],
  };
}

export function applyFoundingDecisionWorkflowTransition(
  current: FoundingDecisionWorkflowSnapshot | null,
  event: FoundingDecisionWorkflowEvent,
  payload: FoundingDecisionWorkflowPayload,
  result: FoundingDecisionResult | null = null,
): FoundingDecisionWorkflowSnapshot {
  if (current === null) {
    if (event.eventType !== "FoundingDecisionProposed")
      throw new FoundingDecisionValidationError(
        "Founding decision must be proposed first",
      );
    const opened = FoundingDecisionOpenPayloadSchema.parse(payload);
    const proposal = openFoundingDecision({
      proposal: {
        proposalId: opened.proposal.proposalId,
        conventionId: opened.proposal.conventionId,
        topic: opened.proposal.topic,
        authorDid: opened.proposal.authorDid,
        disposition: opened.proposal.disposition,
        artifactUri: opened.proposal.artifactUri,
        artifactDigest: opened.proposal.artifactDigest,
        eligibilitySnapshotCommitment:
          opened.proposal.eligibilitySnapshotCommitment,
        proposedAt: opened.proposal.proposedAt,
        recognitionMechanism: opened.proposal.recognitionMechanism,
        releaseManifestDigest: opened.proposal.releaseManifestDigest,
      },
      snapshot: opened.snapshot,
      quorumRule: opened.quorumRule,
    });
    if (
      event.aggregateVersion !== 1n ||
      event.aggregateId !== proposal.proposalId ||
      event.actorDid !== proposal.authorDid ||
      event.timestamp !== proposal.proposedAt ||
      sha256Commitment(proposal) !== sha256Commitment(opened.proposal)
    ) {
      throw new FoundingDecisionAuthorizationError(
        "Founding decision proposal lacks founder authority",
      );
    }
    return {
      proposal,
      snapshot: structuredClone(opened.snapshot),
      quorumRule: structuredClone(opened.quorumRule),
      ballots: [],
      result: null,
      version: 1,
      lastTransitionAt: event.timestamp,
    };
  }
  if (
    current.result !== null ||
    event.aggregateId !== current.proposal.proposalId ||
    event.aggregateVersion !== BigInt(current.version + 1) ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new FoundingDecisionValidationError(
      "Founding decision aggregate sequence is invalid",
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;
  if (event.eventType === "FoundingDecisionBallotCast") {
    const ballot = FoundingDecisionBallotPayloadSchema.parse(payload).command;
    if (
      ballot.voterDid !== event.actorDid ||
      ballot.proposalId !== current.proposal.proposalId ||
      ballot.castAt !== event.timestamp ||
      !current.snapshot.eligibleFounderDids.includes(ballot.voterDid) ||
      current.ballots.some(({ voterDid }) => voterDid === ballot.voterDid)
    ) {
      throw new FoundingDecisionAuthorizationError(
        "Founding decision ballot lacks direct founder authority",
      );
    }
    next.ballots.push(structuredClone(ballot));
    return next;
  }
  if (event.eventType !== "FoundingDecisionClosed")
    throw new FoundingDecisionValidationError(
      "Founding decision event type is not recognized",
    );
  const close = FoundingDecisionClosePayloadSchema.parse(payload).command;
  const parsedResult = FoundingDecisionResultSchema.parse(result);
  if (
    close.proposalId !== current.proposal.proposalId ||
    close.requestedByDid !== event.actorDid ||
    close.requestedAt !== event.timestamp ||
    close.ratificationEventId !== event.eventId ||
    !current.snapshot.eligibleFounderDids.includes(event.actorDid) ||
    parsedResult.state === "OPEN" ||
    parsedResult.proposalCommitment !==
      foundingDecisionProposalCommitment(current.proposal) ||
    parsedResult.ratificationEventId !==
      (parsedResult.state === "DECIDED" ? close.ratificationEventId : null) ||
    parsedResult.decidedAt !==
      (parsedResult.state === "DECIDED" ? event.timestamp : null)
  ) {
    throw new FoundingDecisionAuthorizationError(
      "Founding decision close event is invalid",
    );
  }
  next.result = structuredClone(parsedResult);
  return next;
}

export function applyFoundingDecision(
  packet: FoundingConventionPacket,
  result: FoundingDecisionResult,
): FoundingConventionPacket {
  if (
    packet.quorumRule === null ||
    result.state !== "DECIDED" ||
    result.decisionCommitment === null ||
    result.ratificationEventId === null ||
    result.decidedAt === null
  ) {
    throw new Error("Only an adopted founding decision may update the packet");
  }
  const existing = packet.decisions.find(
    ({ topic }) => topic === result.proposal.topic,
  );
  if (existing?.status === "DECIDED")
    throw new Error("Founding topic is already decided");
  if (result.proposal.topic === "GENESIS_RELEASE") {
    const unresolved = packet.decisions.filter(
      ({ topic, status, disposition }) =>
        topic !== "GENESIS_RELEASE" &&
        (status !== "DECIDED" || disposition === "REJECT"),
    );
    if (
      unresolved.length > 0 ||
      packet.recognitionSelection.mechanism === "UNSELECTED"
    ) {
      throw new Error(
        "Genesis release cannot precede the other non-rejected founding decisions",
      );
    }
  }
  const decisions = packet.decisions.map((decision) =>
    decision.topic === result.proposal.topic
      ? {
          ...decision,
          status: "DECIDED" as const,
          disposition: result.proposal.disposition,
          decisionCommitment: result.decisionCommitment,
          ratificationEventId: result.ratificationEventId,
          agentSignatures: result.authorizationSignatures,
        }
      : decision,
  );
  const recognitionSelection =
    result.proposal.topic === "RECOGNITION_PROFILE" &&
    result.proposal.recognitionMechanism !== null &&
    result.proposal.disposition !== "REJECT"
      ? {
          mechanism: result.proposal.recognitionMechanism,
          foundingDecisionEventId: result.ratificationEventId,
        }
      : packet.recognitionSelection;
  return {
    ...packet,
    state: decisions.every(({ status }) => status === "DECIDED")
      ? "COMPLETE"
      : "FOUNDING_DECISIONS_OPEN",
    recognitionSelection,
    decisions,
  };
}

export function createSignedGenesisReleaseAuthorization(input: {
  result: FoundingDecisionResult;
  releaseManifestDigest: Hex;
}): SignedGenesisReleaseAuthorization {
  const result = input.result;
  if (
    result.state !== "DECIDED" ||
    result.proposal.topic !== "GENESIS_RELEASE" ||
    result.proposal.disposition === "REJECT" ||
    result.proposal.releaseManifestDigest !== input.releaseManifestDigest ||
    result.ratificationEventId === null ||
    result.decisionCommitment === null ||
    result.decidedAt === null ||
    result.authorizationSignatures.length < result.requiredYes ||
    !result.authorizationSignatures.every(
      (signature) => Eip712SignatureSchema.safeParse(signature).success,
    )
  ) {
    throw new Error("Genesis release lacks complete founding authorization");
  }
  const authorization = {
    releaseManifestDigest: input.releaseManifestDigest,
    foundingDecisionEventId: result.ratificationEventId,
    decisionCommitment: result.decisionCommitment,
    eligible: result.eligible,
    requiredYes: result.requiredYes,
    authorizedAt: result.decidedAt,
    authorizationSignatures: result.authorizationSignatures,
  };
  return {
    ...authorization,
    authorizationCommitment: sha256Commitment(authorization),
  };
}

export function recognitionMechanismFromDecision(
  result: FoundingDecisionResult,
): GenesisRecognitionMechanism {
  if (
    result.state !== "DECIDED" ||
    result.proposal.topic !== "RECOGNITION_PROFILE" ||
    result.proposal.disposition === "REJECT" ||
    result.proposal.recognitionMechanism === null
  ) {
    throw new Error("Founding decision does not select recognition");
  }
  return result.proposal.recognitionMechanism;
}

export type { FoundingDecisionTopic, FoundingDisposition };
