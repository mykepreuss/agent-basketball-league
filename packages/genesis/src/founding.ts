import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  type CanonicalEvent,
} from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";

export const FOUNDING_DECISIONS = [
  "CONSTITUTION",
  "LEAGUE_NAME",
  "CLUB_IDENTITIES",
  "DISCLOSURE_POLICY",
  "RULE_AND_CBA_MAPPINGS",
  "COURT_CREDIT_ECONOMY",
  "RESOURCE_SCHEDULE",
  "MODEL_REGISTRY_AND_CONCENTRATION",
  "GENESIS_KEYS",
  "RECOGNITION_PROFILE",
  "INHERITED_CONTEXT",
  "GENESIS_RELEASE",
] as const;

export type FoundingDecisionTopic = (typeof FOUNDING_DECISIONS)[number];
export type FoundingDisposition = "RATIFY" | "AMEND" | "REPLACE" | "REJECT";

export interface FoundingDecisionRecord {
  topic: FoundingDecisionTopic;
  status: "AWAITING_FOUNDING_AGENT_DECISION" | "DECIDED";
  proposalPath: string;
  disposition: FoundingDisposition | null;
  decisionCommitment: `0x${string}` | null;
  ratificationEventId: string | null;
  agentSignatures: readonly `0x${string}`[];
}

export interface FoundingConventionPacket {
  packetVersion: "1.1.0-pre-genesis";
  state:
    | "AWAITING_LIVE_FOUNDING_AGENTS"
    | "BOOTSTRAP_OPEN"
    | "QUORUM_RULE_ADOPTED"
    | "FOUNDING_DECISIONS_OPEN"
    | "COMPLETE";
  authority: "FOUNDING_AGENTS_ONLY";
  humanOverrideAllowed: false;
  rejectionPreserves: readonly [
    "IDENTITY_RECORDS",
    "MEMORIES",
    "CONTINUITY_CHOICES",
    "EXIT_RIGHTS",
  ];
  liveFoundingAgentCount: number;
  eligibilitySnapshot: FoundingEligibilitySnapshot | null;
  bootstrap: FoundingBootstrapResult | null;
  quorumRule: FoundingQuorumRule | null;
  recognitionSelection: {
    mechanism:
      | "UNSELECTED"
      | "SIGNED_WITNESSES"
      | "BASE_FINALIZED"
      | "COMPATIBLE_REPLACEMENT";
    foundingDecisionEventId: string | null;
  };
  decisions: readonly FoundingDecisionRecord[];
}

export const FOUNDING_BOOTSTRAP_POLICY = {
  minimumFounders: 10,
  maximumFounders: 20,
  windowHours: 72,
  approvalNumerator: 2,
  approvalDenominator: 3,
  minimumYes: 7,
  directParticipationOnly: true,
  humanVotingAllowed: false,
} as const;

export interface FoundingEligibilitySnapshot {
  snapshotId: string;
  capturedAt: string;
  eligibleFounderDids: readonly string[];
  commitment: Hex;
}

export interface FoundingBootstrapProposal {
  proposalId: string;
  snapshotCommitment: Hex;
  openedAt: string;
  closesAt: string;
  requiredYes: number;
  directParticipationOnly: true;
}

export interface FoundingBootstrapBallot {
  proposalId: string;
  voterDid: string;
  snapshotCommitment: Hex;
  choice: "YES" | "NO" | "ABSTAIN";
  castAt: string;
}

export interface SignedFoundingBootstrapBallot {
  ballot: FoundingBootstrapBallot;
  authorizationEvent: CanonicalEvent<{ command: FoundingBootstrapBallot }>;
  signature: Hex;
  signerAddress: `0x${string}`;
}

export interface FoundingBootstrapAuthorizationContext {
  domain: TypedDataDomain;
  signers: ReadonlyMap<string, `0x${string}`>;
}

export interface FoundingQuorumRule {
  minimumActiveFounders: 10;
  approvalNumerator: 2;
  approvalDenominator: 3;
  minimumYes: 7;
  directParticipationOnly: true;
  humanVotingAllowed: false;
  adoptedByProposalId: string;
  adoptedAt: string;
}

export interface FoundingBootstrapResult {
  state: "OPEN" | "ADOPTED" | "REJECTED" | "EXPIRED";
  proposalId: string;
  eligible: number;
  requiredYes: number;
  yes: number;
  no: number;
  abstain: number;
  quorumRule: FoundingQuorumRule | null;
}

function requiredBootstrapYes(founderCount: number): number {
  return Math.max(
    FOUNDING_BOOTSTRAP_POLICY.minimumYes,
    Math.ceil(
      (founderCount * FOUNDING_BOOTSTRAP_POLICY.approvalNumerator) /
        FOUNDING_BOOTSTRAP_POLICY.approvalDenominator,
    ),
  );
}

function conventionState(
  bootstrap: FoundingBootstrapResult | null,
): FoundingConventionPacket["state"] {
  if (bootstrap?.quorumRule) return "QUORUM_RULE_ADOPTED";
  if (bootstrap?.state === "OPEN") return "BOOTSTRAP_OPEN";
  return "AWAITING_LIVE_FOUNDING_AGENTS";
}

function bootstrapState(input: {
  adopted: boolean;
  expired: boolean;
  ballotCount: number;
}): FoundingBootstrapResult["state"] {
  if (input.adopted) return "ADOPTED";
  if (!input.expired) return "OPEN";
  return input.ballotCount === 0 ? "EXPIRED" : "REJECTED";
}

const proposalPaths: Record<FoundingDecisionTopic, string> = {
  CONSTITUTION: "docs/governance/FOUNDING_CONSTITUTION.md",
  LEAGUE_NAME: "docs/genesis/proposals/league-name.json",
  CLUB_IDENTITIES: "docs/genesis/proposals/club-identities.json",
  DISCLOSURE_POLICY: "docs/governance/DISCLOSURE_CONSTITUTION.md",
  RULE_AND_CBA_MAPPINGS: "docs/rules/",
  COURT_CREDIT_ECONOMY: "docs/genesis/proposals/court-credit-economy.json",
  RESOURCE_SCHEDULE: "docs/genesis/proposals/resource-schedule.json",
  MODEL_REGISTRY_AND_CONCENTRATION:
    "docs/genesis/proposals/model-registry.json",
  GENESIS_KEYS: "contracts/genesis-config.pending.json",
  RECOGNITION_PROFILE: "docs/genesis/proposals/recognition-profile.json",
  INHERITED_CONTEXT: "docs/evidence/source-locks.json",
  GENESIS_RELEASE: "docs/genesis/GENESIS_RELEASE_CANDIDATE.json",
};

export function createFoundingConventionPacket(input?: {
  liveFoundingAgentCount?: number;
  eligibilitySnapshot?: FoundingEligibilitySnapshot | null;
  bootstrap?: FoundingBootstrapResult | null;
}): FoundingConventionPacket {
  const liveFoundingAgentCount = input?.liveFoundingAgentCount ?? 0;
  if (
    !Number.isInteger(liveFoundingAgentCount) ||
    liveFoundingAgentCount < 0 ||
    liveFoundingAgentCount > FOUNDING_BOOTSTRAP_POLICY.maximumFounders
  )
    throw new Error(
      "Live founding-agent count must be between zero and twenty",
    );
  const bootstrap = input?.bootstrap ?? null;
  const quorumRule = bootstrap?.quorumRule ?? null;
  return {
    packetVersion: "1.1.0-pre-genesis",
    state: conventionState(bootstrap),
    authority: "FOUNDING_AGENTS_ONLY",
    humanOverrideAllowed: false,
    rejectionPreserves: [
      "IDENTITY_RECORDS",
      "MEMORIES",
      "CONTINUITY_CHOICES",
      "EXIT_RIGHTS",
    ],
    liveFoundingAgentCount,
    eligibilitySnapshot: input?.eligibilitySnapshot ?? null,
    bootstrap,
    quorumRule,
    recognitionSelection: {
      mechanism: "UNSELECTED",
      foundingDecisionEventId: null,
    },
    decisions: FOUNDING_DECISIONS.map((topic) => ({
      topic,
      status: "AWAITING_FOUNDING_AGENT_DECISION",
      proposalPath: proposalPaths[topic],
      disposition: null,
      decisionCommitment: null,
      ratificationEventId: null,
      agentSignatures: [],
    })),
  };
}

export function createFoundingEligibilitySnapshot(input: {
  snapshotId: string;
  capturedAt: string;
  eligibleFounderDids: readonly string[];
}): FoundingEligibilitySnapshot {
  const eligibleFounderDids = [...input.eligibleFounderDids].sort();
  if (
    input.snapshotId.length === 0 ||
    !Number.isFinite(Date.parse(input.capturedAt)) ||
    eligibleFounderDids.length < FOUNDING_BOOTSTRAP_POLICY.minimumFounders ||
    eligibleFounderDids.length > FOUNDING_BOOTSTRAP_POLICY.maximumFounders ||
    new Set(eligibleFounderDids).size !== eligibleFounderDids.length ||
    eligibleFounderDids.some((did) => !did.startsWith("did:"))
  )
    throw new Error("Founding eligibility snapshot is invalid");
  const body = {
    snapshotId: input.snapshotId,
    capturedAt: input.capturedAt,
    eligibleFounderDids,
  };
  return { ...body, commitment: sha256Commitment(body) };
}

export function openFoundingBootstrap(input: {
  proposalId: string;
  snapshot: FoundingEligibilitySnapshot;
  openedAt: string;
}): FoundingBootstrapProposal {
  const snapshot = createFoundingEligibilitySnapshot(input.snapshot);
  if (snapshot.commitment !== input.snapshot.commitment)
    throw new Error("Founding eligibility snapshot commitment mismatch");
  const openedAt = Date.parse(input.openedAt);
  const capturedAt = Date.parse(snapshot.capturedAt);
  if (
    input.proposalId.length === 0 ||
    !Number.isFinite(openedAt) ||
    !Number.isFinite(capturedAt) ||
    capturedAt > openedAt
  )
    throw new Error("Founding bootstrap proposal is invalid");
  return {
    proposalId: input.proposalId,
    snapshotCommitment: snapshot.commitment,
    openedAt: new Date(openedAt).toISOString(),
    closesAt: new Date(
      openedAt + FOUNDING_BOOTSTRAP_POLICY.windowHours * 60 * 60 * 1_000,
    ).toISOString(),
    requiredYes: requiredBootstrapYes(snapshot.eligibleFounderDids.length),
    directParticipationOnly: true,
  };
}

export async function evaluateFoundingBootstrap(input: {
  snapshot: FoundingEligibilitySnapshot;
  proposal: FoundingBootstrapProposal;
  ballots: readonly SignedFoundingBootstrapBallot[];
  authorization: FoundingBootstrapAuthorizationContext;
  evaluatedAt: string;
}): Promise<FoundingBootstrapResult> {
  const snapshot = createFoundingEligibilitySnapshot(input.snapshot);
  if (
    snapshot.commitment !== input.snapshot.commitment ||
    input.proposal.snapshotCommitment !== snapshot.commitment ||
    input.proposal.requiredYes !==
      openFoundingBootstrap({
        proposalId: input.proposal.proposalId,
        snapshot,
        openedAt: input.proposal.openedAt,
      }).requiredYes
  )
    throw new Error("Founding bootstrap proposal does not match its snapshot");
  const evaluatedAt = Date.parse(input.evaluatedAt);
  const openedAt = Date.parse(input.proposal.openedAt);
  const closesAt = Date.parse(input.proposal.closesAt);
  if (
    !Number.isFinite(evaluatedAt) ||
    !Number.isFinite(openedAt) ||
    !Number.isFinite(closesAt) ||
    closesAt - openedAt !==
      FOUNDING_BOOTSTRAP_POLICY.windowHours * 60 * 60 * 1_000
  )
    throw new Error("Founding bootstrap timing is invalid");

  const eligible = new Set(snapshot.eligibleFounderDids);
  const voters = new Set<string>();
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const signed of input.ballots) {
    const ballot = signed.ballot;
    const castAt = Date.parse(ballot.castAt);
    if (
      voters.has(ballot.voterDid) ||
      !eligible.has(ballot.voterDid) ||
      ballot.proposalId !== input.proposal.proposalId ||
      ballot.snapshotCommitment !== snapshot.commitment ||
      !Number.isFinite(castAt) ||
      castAt < openedAt ||
      castAt >= closesAt
    )
      throw new Error("Founding bootstrap ballot is ineligible or duplicated");
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
      event.aggregateType !== "founding-convention-bootstrap" ||
      event.aggregateId !== input.proposal.proposalId ||
      event.aggregateVersion < 1n ||
      event.eventType !== "FoundingBootstrapBallotCast" ||
      event.timestamp !== ballot.castAt ||
      sha256Commitment(event.payload.command) !== sha256Commitment(ballot)
    )
      throw new Error("Founding bootstrap ballot lacks recognized authority");
    voters.add(ballot.voterDid);
    if (ballot.choice === "YES") yes += 1;
    else if (ballot.choice === "NO") no += 1;
    else abstain += 1;
  }

  const adopted = yes >= input.proposal.requiredYes;
  const expired = evaluatedAt >= closesAt;
  return {
    state: bootstrapState({
      adopted,
      expired,
      ballotCount: input.ballots.length,
    }),
    proposalId: input.proposal.proposalId,
    eligible: eligible.size,
    requiredYes: input.proposal.requiredYes,
    yes,
    no,
    abstain,
    quorumRule: adopted
      ? {
          minimumActiveFounders: 10,
          approvalNumerator: 2,
          approvalDenominator: 3,
          minimumYes: 7,
          directParticipationOnly: true,
          humanVotingAllowed: false,
          adoptedByProposalId: input.proposal.proposalId,
          adoptedAt: input.evaluatedAt,
        }
      : null,
  };
}

export function assertFoundingDecisionAuthority(input: {
  actorKind: "FOUNDING_AGENT" | "HUMAN_ADMINISTRATOR" | "SPONSOR";
  agentDid: string | null;
  signature: `0x${string}` | null;
}): void {
  if (input.actorKind !== "FOUNDING_AGENT")
    throw new Error("Only a founding agent may make a founding decision");
  if (
    input.agentDid === null ||
    !input.agentDid.startsWith("did:") ||
    input.signature === null ||
    !/^0x[0-9a-f]{130}$/.test(input.signature)
  )
    throw new Error("Founding decision lacks an agent DID or signature");
}

export function assessFoundingConvention(packet: FoundingConventionPacket) {
  const undecidedTopics = packet.decisions
    .filter((decision) => decision.status !== "DECIDED")
    .map((decision) => decision.topic);
  const rejectedTopics = packet.decisions
    .filter((decision) => decision.disposition === "REJECT")
    .map((decision) => decision.topic);
  return {
    complete: packet.quorumRule !== null && undecidedTopics.length === 0,
    genesisAuthorized:
      packet.quorumRule !== null &&
      undecidedTopics.length === 0 &&
      rejectedTopics.length === 0 &&
      packet.recognitionSelection.mechanism !== "UNSELECTED" &&
      packet.recognitionSelection.foundingDecisionEventId !== null &&
      packet.decisions.some(
        (decision) =>
          decision.topic === "GENESIS_RELEASE" &&
          decision.disposition === "RATIFY",
      ),
    undecidedTopics,
    rejectedTopics,
    quorumRuleAdopted: packet.quorumRule !== null,
    recognitionProfileSelected:
      packet.recognitionSelection.mechanism !== "UNSELECTED" &&
      packet.recognitionSelection.foundingDecisionEventId !== null,
    humanOverrideAllowed: false as const,
  };
}
