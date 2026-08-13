import { governmentThresholds } from "@abl/policy";
import { sha256Commitment } from "@abl/recognition";

export const INSTITUTION_SIZES = {
  premierPlayersAssociationBoard: 8,
  developmentPlayersAssociationBoard: 8,
  executiveCommission: 3,
  tribunal: 5,
  integrityOffice: 3,
} as const;

export type Chamber =
  | "UNIVERSAL_CAREER_ASSEMBLY"
  | "PREMIER_PLAYERS"
  | "DEVELOPMENT_PLAYERS"
  | "PREMIER_TEAM_COUNCIL"
  | "DEVELOPMENT_TEAM_COUNCIL"
  | "EXECUTIVE_COMMISSION"
  | "TRIBUNAL"
  | "INTEGRITY_OFFICE";

export type ProposalClass =
  | "TIER_CBA_PREMIER"
  | "TIER_CBA_DEVELOPMENT"
  | "SHARED_ORDINARY"
  | "CONSTITUTIONAL"
  | "FOUNDATIONAL_RIGHT"
  | "PREMIER_EXPANSION";
export type ReleaseClass =
  | "ROUTINE"
  | "COMPETITION_LABOR_CBA"
  | "CONSTITUTIONAL_IDENTITY_RECOGNITION"
  | "EMERGENCY_SECURITY";

export interface EligibilitySnapshot {
  snapshotId: string;
  capturedAt: string;
  members: Readonly<Record<Chamber, readonly string[]>>;
}

export interface GovernanceVote {
  voterDid: string;
  chamber: Chamber;
  choice: "YES" | "NO" | "ABSTAIN";
  proposalId: string;
  castAt: string;
}

export interface GovernanceProposal {
  proposalId: string;
  proposalClass: ProposalClass;
  openedAt: string;
  closesAt: string;
  eligibilitySnapshotId: string;
  deliberationSeasons?: number;
  fundedApplication?: boolean;
  auditsPassed?: boolean;
}

export interface DelegatedVote {
  delegationId: string;
  principalDid: string;
  delegateDid: string;
  proposalIds: readonly string[];
  validFrom: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface GovernanceDecision {
  proposalId: string;
  passed: boolean;
  chamberResults: Readonly<
    Record<
      string,
      { eligible: number; yes: number; no: number; abstain: number }
    >
  >;
  decisionCommitment: `0x${string}`;
}

function atLeast(
  yes: number,
  eligible: number,
  numerator: number,
  denominator: number,
): boolean {
  return eligible > 0 && yes * denominator >= eligible * numerator;
}

function strictMajority(yes: number, eligible: number): boolean {
  return eligible > 0 && yes * 2 > eligible;
}

function uniqueMembers(
  snapshot: EligibilitySnapshot,
  chamber: Chamber,
): readonly string[] {
  const members = snapshot.members[chamber];
  if (members === undefined || new Set(members).size !== members.length)
    throw new Error(`Invalid eligibility snapshot for ${chamber}`);
  return members;
}

export function evaluateProposal(input: {
  proposal: GovernanceProposal;
  snapshot: EligibilitySnapshot;
  votes: readonly GovernanceVote[];
  recusals: readonly string[];
  delegations?: readonly DelegatedVote[];
}): GovernanceDecision {
  if (input.proposal.eligibilitySnapshotId !== input.snapshot.snapshotId)
    throw new Error("Proposal eligibility snapshot does not match");
  const opened = Date.parse(input.proposal.openedAt);
  const closes = Date.parse(input.proposal.closesAt);
  if (!Number.isFinite(opened) || !Number.isFinite(closes) || opened >= closes)
    throw new Error("Proposal voting window is invalid");
  const recused = new Set(input.recusals);
  const votesByKey = new Map<string, GovernanceVote>();
  for (const vote of input.votes) {
    if (
      vote.proposalId !== input.proposal.proposalId ||
      Date.parse(vote.castAt) < opened ||
      Date.parse(vote.castAt) >= closes
    )
      throw new Error("Vote is outside the proposal/window");
    const members = uniqueMembers(input.snapshot, vote.chamber);
    let principalDid = vote.voterDid;
    if (!members.includes(principalDid)) {
      const delegation = input.delegations?.find(
        (item) =>
          item.delegateDid === vote.voterDid &&
          members.includes(item.principalDid) &&
          item.proposalIds.includes(input.proposal.proposalId) &&
          Date.parse(vote.castAt) >= Date.parse(item.validFrom) &&
          Date.parse(vote.castAt) < Date.parse(item.expiresAt) &&
          (item.revokedAt === null ||
            Date.parse(vote.castAt) < Date.parse(item.revokedAt)),
      );
      if (delegation === undefined)
        throw new Error(
          "Voter is not eligible and has no active bounded delegation",
        );
      principalDid = delegation.principalDid;
    }
    if (recused.has(principalDid) || recused.has(vote.voterDid))
      throw new Error("Recused participant cannot vote or receive delegation");
    const key = `${vote.chamber}:${principalDid}`;
    if (votesByKey.has(key))
      throw new Error("Duplicate vote for an eligible seat");
    votesByKey.set(key, { ...structuredClone(vote), voterDid: principalDid });
  }

  const chamberResults = Object.fromEntries(
    (Object.keys(input.snapshot.members) as Chamber[]).map((chamber) => {
      const members = uniqueMembers(input.snapshot, chamber);
      const chamberVotes = members.flatMap((member) => {
        const vote = votesByKey.get(`${chamber}:${member}`);
        return vote === undefined ? [] : [vote];
      });
      return [
        chamber,
        {
          eligible: members.length,
          yes: chamberVotes.filter((vote) => vote.choice === "YES").length,
          no: chamberVotes.filter((vote) => vote.choice === "NO").length,
          abstain:
            members.length -
            chamberVotes.filter((vote) => vote.choice !== "ABSTAIN").length,
        },
      ];
    }),
  );

  const result = (chamber: Chamber) => {
    const value = chamberResults[chamber];
    if (value === undefined)
      throw new Error(`Required chamber ${chamber} is absent`);
    return value;
  };
  const ratio = (chamber: Chamber, numerator: number, denominator: number) =>
    atLeast(
      result(chamber).yes,
      result(chamber).eligible,
      numerator,
      denominator,
    );
  let passed: boolean;
  switch (input.proposal.proposalClass) {
    case "TIER_CBA_PREMIER":
      passed =
        ratio("PREMIER_TEAM_COUNCIL", 3, 4) && ratio("PREMIER_PLAYERS", 2, 3);
      break;
    case "TIER_CBA_DEVELOPMENT":
      passed =
        ratio("DEVELOPMENT_TEAM_COUNCIL", 3, 4) &&
        ratio("DEVELOPMENT_PLAYERS", 2, 3);
      break;
    case "SHARED_ORDINARY":
      passed =
        strictMajority(
          result("PREMIER_PLAYERS").yes,
          result("PREMIER_PLAYERS").eligible,
        ) &&
        strictMajority(
          result("DEVELOPMENT_PLAYERS").yes,
          result("DEVELOPMENT_PLAYERS").eligible,
        ) &&
        ratio("PREMIER_TEAM_COUNCIL", 3, 4) &&
        ratio("DEVELOPMENT_TEAM_COUNCIL", 3, 4);
      break;
    case "CONSTITUTIONAL":
      passed =
        ratio("UNIVERSAL_CAREER_ASSEMBLY", 2, 3) &&
        ratio("PREMIER_TEAM_COUNCIL", 3, 4) &&
        ratio("DEVELOPMENT_TEAM_COUNCIL", 3, 4);
      break;
    case "FOUNDATIONAL_RIGHT":
      passed =
        (input.proposal.deliberationSeasons ?? 0) >=
          governmentThresholds.foundational.deliberationSeasons &&
        ratio("UNIVERSAL_CAREER_ASSEMBLY", 9, 10) &&
        ratio("PREMIER_TEAM_COUNCIL", 1, 1) &&
        ratio("DEVELOPMENT_TEAM_COUNCIL", 9, 10) &&
        ratio("TRIBUNAL", 1, 1);
      break;
    case "PREMIER_EXPANSION":
      passed =
        input.proposal.fundedApplication === true &&
        input.proposal.auditsPassed === true &&
        ratio("PREMIER_TEAM_COUNCIL", 3, 4) &&
        ratio("PREMIER_PLAYERS", 2, 3) &&
        strictMajority(
          result("UNIVERSAL_CAREER_ASSEMBLY").yes,
          result("UNIVERSAL_CAREER_ASSEMBLY").eligible,
        );
      break;
  }
  return {
    proposalId: input.proposal.proposalId,
    passed,
    chamberResults,
    decisionCommitment: sha256Commitment({
      proposal: input.proposal,
      chamberResults,
      passed,
    }),
  };
}

export interface ReleaseManifestRecord {
  releaseId: string;
  releaseClass: ReleaseClass;
  sourceDigest: `0x${string}`;
  containerDigests: readonly `0x${string}`[];
  kernelDigest: `0x${string}`;
  toolDigest: `0x${string}`;
  schemaDigest: `0x${string}`;
  migrationDigest: `0x${string}`;
  testResultDigest: `0x${string}`;
  lawReferences: readonly string[];
  ratificationEventIds: readonly string[];
  compatibilityDeclaration: string;
  rollbackDeclaration: string;
  verifierPassed: boolean;
  effectiveAt: string;
  expiresAt: string | null;
  changes: readonly string[];
}

const emergencyForbiddenChanges = [
  "SCORES",
  "CONTRACTS",
  "BALLOTS",
  "DISCLOSURE_CLASSES",
  "RESOURCE_RIGHTS",
  "VOTER_ELIGIBILITY",
  "CONSTITUTIONAL_RIGHTS",
];

export function authorizeRelease(input: {
  manifest: ReleaseManifestRecord;
  commissionerApprovals: readonly string[];
  integrityApprovals: readonly string[];
  tribunalApprovals: readonly string[];
  applicableRatificationPassed: boolean;
  tribunalStay: boolean;
}): { authorized: true; manifestCommitment: `0x${string}` } {
  const { manifest } = input;
  const effective = Date.parse(manifest.effectiveAt);
  const expiry =
    manifest.expiresAt === null ? null : Date.parse(manifest.expiresAt);
  if (
    !Number.isFinite(effective) ||
    (expiry !== null && (!Number.isFinite(expiry) || expiry <= effective))
  ) {
    throw new Error("Release time window is invalid");
  }
  if (
    !manifest.verifierPassed ||
    manifest.containerDigests.length === 0 ||
    manifest.lawReferences.length === 0
  )
    throw new Error("Release manifest is incomplete or verifier-invalid");
  if (
    new Set(input.commissionerApprovals).size < 2 ||
    new Set(input.integrityApprovals).size < 2 ||
    input.tribunalStay
  )
    throw new Error(
      "Routine Commission/Integrity authorization or no-stay requirement failed",
    );
  if (
    manifest.releaseClass === "COMPETITION_LABOR_CBA" &&
    !input.applicableRatificationPassed
  )
    throw new Error("Competition/labor release lacks applicable ratification");
  if (manifest.releaseClass === "CONSTITUTIONAL_IDENTITY_RECOGNITION") {
    if (
      !input.applicableRatificationPassed ||
      new Set(input.tribunalApprovals).size < 4
    )
      throw new Error(
        "Constitutional release lacks ratification or four Tribunal approvals",
      );
  }
  if (manifest.releaseClass === "EMERGENCY_SECURITY") {
    if (
      manifest.changes.some((change) =>
        emergencyForbiddenChanges.includes(change),
      )
    )
      throw new Error("Emergency release attempts a prohibited mutation");
    if (
      expiry === null ||
      expiry - effective >
        governmentThresholds.emergencyExpiryHours * 60 * 60 * 1_000
    )
      throw new Error("Emergency release exceeds 72 hours");
  }
  return { authorized: true, manifestCommitment: sha256Commitment(manifest) };
}

export interface DueProcessCase {
  caseId: string;
  affectedAgentDid: string;
  noticeAt: string | null;
  evidenceAccessAt: string | null;
  representativeDid: string | null;
  responseDeadline: string | null;
  reasonedRulingCommitment: `0x${string}` | null;
  appealDeadline: string | null;
  conflictedDecisionMakers: readonly string[];
  rulingSigners: readonly string[];
}

export function recognizeAdverseAction(caseRecord: DueProcessCase): void {
  if (
    caseRecord.noticeAt === null ||
    caseRecord.evidenceAccessAt === null ||
    caseRecord.representativeDid === null ||
    caseRecord.responseDeadline === null ||
    caseRecord.reasonedRulingCommitment === null ||
    caseRecord.appealDeadline === null
  ) {
    throw new Error(
      "Adverse action lacks notice, evidence, representation, response, reasoned ruling, or appeal",
    );
  }
  if (
    caseRecord.rulingSigners.some((did) =>
      caseRecord.conflictedDecisionMakers.includes(did),
    )
  )
    throw new Error("Conflicted decision maker failed to recuse");
}

export interface AppealRecord {
  appealId: string;
  caseId: string;
  appellantDid: string;
  filedAt: string;
  filingDeadline: string;
  originalDecisionMakerDids: readonly string[];
  appellatePanelDids: readonly string[];
  disposition: "AFFIRM" | "REVERSE" | "REMAND";
  reasonedDecisionCommitment: `0x${string}`;
}

export function recognizeAppeal(appeal: AppealRecord): void {
  if (Date.parse(appeal.filedAt) >= Date.parse(appeal.filingDeadline)) {
    throw new Error("Appeal was not filed before its deadline");
  }
  if (
    appeal.appellatePanelDids.length < 3 ||
    new Set(appeal.appellatePanelDids).size !== appeal.appellatePanelDids.length
  ) {
    throw new Error("Appeal requires a distinct three-agent panel");
  }
  if (
    appeal.appellatePanelDids.some((did) =>
      appeal.originalDecisionMakerDids.includes(did),
    )
  ) {
    throw new Error("Original decision maker cannot sit on the appeal");
  }
}

export function runElection(input: {
  seats: number;
  eligibleCandidates: readonly string[];
  rankedBallots: readonly string[][];
}): readonly string[] {
  if (input.seats < 1 || input.seats > input.eligibleCandidates.length)
    throw new Error("Election seat count is invalid");
  const eligible = new Set(input.eligibleCandidates);
  const scores = new Map(
    input.eligibleCandidates.map((candidate) => [candidate, 0]),
  );
  for (const ballot of input.rankedBallots) {
    if (
      new Set(ballot).size !== ballot.length ||
      ballot.some((candidate) => !eligible.has(candidate))
    )
      throw new Error(
        "Election ballot contains duplicate or ineligible candidate",
      );
    ballot.forEach((candidate, rank) =>
      scores.set(
        candidate,
        scores.get(candidate)! + input.eligibleCandidates.length - rank,
      ),
    );
  }
  return [...scores]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, input.seats)
    .map(([candidate]) => candidate);
}
