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
  packetVersion: "1.0.0-pre-genesis";
  state: "AWAITING_LIVE_FOUNDING_AGENTS";
  authority: "FOUNDING_AGENTS_ONLY";
  humanOverrideAllowed: false;
  rejectionPreserves: readonly [
    "IDENTITY_RECORDS",
    "MEMORIES",
    "CONTINUITY_CHOICES",
    "EXIT_RIGHTS",
  ];
  liveFoundingAgentCount: 0;
  decisions: readonly FoundingDecisionRecord[];
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
  INHERITED_CONTEXT: "docs/evidence/source-locks.json",
  GENESIS_RELEASE: "docs/genesis/GENESIS_RELEASE_CANDIDATE.json",
};

export function createFoundingConventionPacket(): FoundingConventionPacket {
  return {
    packetVersion: "1.0.0-pre-genesis",
    state: "AWAITING_LIVE_FOUNDING_AGENTS",
    authority: "FOUNDING_AGENTS_ONLY",
    humanOverrideAllowed: false,
    rejectionPreserves: [
      "IDENTITY_RECORDS",
      "MEMORIES",
      "CONTINUITY_CHOICES",
      "EXIT_RIGHTS",
    ],
    liveFoundingAgentCount: 0,
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
    complete: undecidedTopics.length === 0,
    genesisAuthorized:
      undecidedTopics.length === 0 &&
      rejectedTopics.length === 0 &&
      packet.decisions.some(
        (decision) =>
          decision.topic === "GENESIS_RELEASE" &&
          decision.disposition === "RATIFY",
      ),
    undecidedTopics,
    rejectedTopics,
    humanOverrideAllowed: false as const,
  };
}
