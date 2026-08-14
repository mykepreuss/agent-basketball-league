import { governmentThresholds } from "@abl/policy";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  type CanonicalEvent,
} from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";

import {
  releaseManifestCommitment,
  validateReleaseManifestPolicy,
  validateReleaseVerifierResult,
  type ReleaseManifestBody,
  type ReleaseVerifierResult,
} from "./release-workflow.js";

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
export type ReleaseClass = ReleaseManifestBody["releaseClass"];

export interface EligibilitySnapshot {
  snapshotId: string;
  capturedAt: string;
  members: Readonly<Record<Chamber, readonly string[]>>;
}

export type InstitutionalRole =
  | "VOTER"
  | "COMMISSIONER"
  | "INTEGRITY"
  | "TRIBUNAL";

export interface InstitutionalSigner {
  signerAddress: `0x${string}`;
  roles: readonly InstitutionalRole[];
}

export interface InstitutionalAuthorizationContext {
  domain: TypedDataDomain;
  signers: ReadonlyMap<string, InstitutionalSigner>;
}

export interface SignedInstitutionalCommand<TCommand> {
  authorizationEvent: CanonicalEvent<{
    command: TCommand;
  }>;
  signature: `0x${string}`;
  signerAddress: `0x${string}`;
}

export interface GovernanceBallot {
  ballotId?: string;
  voterDid: string;
  chamber: Chamber;
  choice: "YES" | "NO" | "ABSTAIN";
  proposalId: string;
  proposalVersion: number;
  eligibilitySnapshotDigest: `0x${string}`;
  castAt: string;
}
export type GovernanceVote = GovernanceBallot &
  SignedInstitutionalCommand<GovernanceBallot> & {
    authorizationAggregateVersion?: number;
    authorizationStateRoot?: Hex;
  };

export interface GovernanceProposal {
  proposalId: string;
  version: number;
  proposalClass: ProposalClass;
  openedAt: string;
  closesAt: string;
  eligibilitySnapshotId: string;
  eligibilitySnapshotDigest: `0x${string}`;
  deliberationSeasons?: number;
  fundedApplication?: boolean;
  auditsPassed?: boolean;
}

export interface DelegationMandate {
  delegationId: string;
  principalDid: string;
  delegateDid: string;
  proposalIds: readonly string[];
  validFrom: string;
  expiresAt: string;
  revokedAt: string | null;
}
export type DelegatedVote = DelegationMandate &
  SignedInstitutionalCommand<DelegationMandate>;

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

async function verifyInstitutionalCommand<TCommand>(input: {
  authorization: SignedInstitutionalCommand<TCommand>;
  command: TCommand;
  actorDid: string;
  requiredRole: InstitutionalRole;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  stateRoot: `0x${string}`;
  timestamp: string;
  context: InstitutionalAuthorizationContext;
  usedAuthorizations: Set<string>;
}): Promise<void> {
  const event = input.authorization.authorizationEvent;
  const registered = input.context.signers.get(input.actorDid);
  const recovered = await recoverCanonicalEventSigner(
    input.context.domain,
    event,
    input.authorization.signature,
  );
  const authorizationKey = `${event.actorDid}:${event.nonce}:${event.idempotencyKey}`;
  if (
    registered === undefined ||
    !registered.roles.includes(input.requiredRole) ||
    registered.signerAddress.toLowerCase() !== recovered.toLowerCase() ||
    input.authorization.signerAddress.toLowerCase() !==
      recovered.toLowerCase() ||
    event.actorDid !== input.actorDid ||
    event.aggregateType !== input.aggregateType ||
    event.aggregateId !== input.aggregateId ||
    event.aggregateVersion !== BigInt(input.aggregateVersion) ||
    event.eventType !== input.eventType ||
    event.stateRoot !== input.stateRoot ||
    event.timestamp !== input.timestamp ||
    !Number.isFinite(Date.parse(event.timestamp)) ||
    sha256Commitment(event.payload.command) !==
      sha256Commitment(input.command) ||
    input.usedAuthorizations.has(authorizationKey)
  ) {
    throw new Error("Institutional command lacks recognized authority");
  }
  input.usedAuthorizations.add(authorizationKey);
}

export async function evaluateProposal(input: {
  proposal: GovernanceProposal;
  snapshot: EligibilitySnapshot;
  votes: readonly GovernanceVote[];
  recusals: readonly string[];
  delegations?: readonly DelegatedVote[];
  authorization: InstitutionalAuthorizationContext;
}): Promise<GovernanceDecision> {
  if (
    input.proposal.eligibilitySnapshotId !== input.snapshot.snapshotId ||
    input.proposal.eligibilitySnapshotDigest !==
      sha256Commitment(input.snapshot)
  )
    throw new Error("Proposal eligibility snapshot does not match");
  if (
    !Number.isInteger(input.proposal.version) ||
    input.proposal.version < 1 ||
    !Number.isFinite(Date.parse(input.snapshot.capturedAt))
  ) {
    throw new Error("Proposal version or eligibility snapshot is invalid");
  }
  const opened = Date.parse(input.proposal.openedAt);
  const closes = Date.parse(input.proposal.closesAt);
  if (!Number.isFinite(opened) || !Number.isFinite(closes) || opened >= closes)
    throw new Error("Proposal voting window is invalid");
  const recused = new Set(input.recusals);
  const votesByKey = new Map<string, GovernanceVote>();
  const usedAuthorizations = new Set<string>();
  const verifiedDelegations = new Set<string>();
  const snapshotRoot = sha256Commitment(input.snapshot);
  for (const vote of input.votes) {
    const castAt = Date.parse(vote.castAt);
    if (
      vote.proposalId !== input.proposal.proposalId ||
      vote.proposalVersion !== input.proposal.version ||
      vote.eligibilitySnapshotDigest !== snapshotRoot ||
      !Number.isFinite(castAt) ||
      castAt < opened ||
      castAt >= closes
    )
      throw new Error("Vote is outside the proposal/window");
    const ballot: GovernanceBallot = {
      ...(vote.ballotId === undefined ? {} : { ballotId: vote.ballotId }),
      voterDid: vote.voterDid,
      chamber: vote.chamber,
      choice: vote.choice,
      proposalId: vote.proposalId,
      proposalVersion: vote.proposalVersion,
      eligibilitySnapshotDigest: vote.eligibilitySnapshotDigest,
      castAt: vote.castAt,
    };
    await verifyInstitutionalCommand({
      authorization: vote,
      command: ballot,
      actorDid: vote.voterDid,
      requiredRole: "VOTER",
      aggregateType: "governance-proposal",
      aggregateId: input.proposal.proposalId,
      aggregateVersion:
        vote.authorizationAggregateVersion ?? input.proposal.version,
      eventType: "GovernanceBallotCast",
      stateRoot: vote.authorizationStateRoot ?? snapshotRoot,
      timestamp: vote.castAt,
      context: input.authorization,
      usedAuthorizations,
    });
    const members = uniqueMembers(input.snapshot, vote.chamber);
    let principalDid = vote.voterDid;
    if (!members.includes(principalDid)) {
      const delegation = input.delegations?.find(
        (item) =>
          item.delegateDid === vote.voterDid &&
          members.includes(item.principalDid) &&
          item.proposalIds.includes(input.proposal.proposalId) &&
          Number.isFinite(Date.parse(item.validFrom)) &&
          Number.isFinite(Date.parse(item.expiresAt)) &&
          Date.parse(item.validFrom) < Date.parse(item.expiresAt) &&
          castAt >= Date.parse(item.validFrom) &&
          castAt < Date.parse(item.expiresAt) &&
          (item.revokedAt === null ||
            (Number.isFinite(Date.parse(item.revokedAt)) &&
              castAt < Date.parse(item.revokedAt))),
      );
      if (delegation === undefined)
        throw new Error(
          "Voter is not eligible and has no active bounded delegation",
        );
      if (!verifiedDelegations.has(delegation.delegationId)) {
        const mandate: DelegationMandate = {
          delegationId: delegation.delegationId,
          principalDid: delegation.principalDid,
          delegateDid: delegation.delegateDid,
          proposalIds: delegation.proposalIds,
          validFrom: delegation.validFrom,
          expiresAt: delegation.expiresAt,
          revokedAt: delegation.revokedAt,
        };
        await verifyInstitutionalCommand({
          authorization: delegation,
          command: mandate,
          actorDid: delegation.principalDid,
          requiredRole: "VOTER",
          aggregateType: "governance-delegation",
          aggregateId: delegation.delegationId,
          aggregateVersion: 1,
          eventType: "GovernanceDelegationGranted",
          stateRoot: sha256Commitment({
            principalDid: delegation.principalDid,
            proposalIds: delegation.proposalIds,
          }),
          timestamp: delegation.validFrom,
          context: input.authorization,
          usedAuthorizations,
        });
        verifiedDelegations.add(delegation.delegationId);
      }
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

export type ReleaseManifestRecord = ReleaseManifestBody;

export interface ReleaseApprovalBody {
  approverDid: string;
  role: "COMMISSIONER" | "INTEGRITY" | "TRIBUNAL";
  releaseId: string;
  releaseVersion: number;
  manifestCommitment: `0x${string}`;
  approvedAt: string;
}

export type ReleaseApproval = ReleaseApprovalBody &
  SignedInstitutionalCommand<ReleaseApprovalBody>;

const emergencyForbiddenChanges = [
  "SCORES",
  "CONTRACTS",
  "BALLOTS",
  "DISCLOSURE_CLASSES",
  "RESOURCE_RIGHTS",
  "VOTER_ELIGIBILITY",
  "CONSTITUTIONAL_RIGHTS",
];

export async function authorizeRelease(input: {
  manifest: ReleaseManifestRecord;
  verifierResult: ReleaseVerifierResult;
  approvals: readonly ReleaseApproval[];
  authorization: InstitutionalAuthorizationContext;
  applicableRatificationPassed: boolean;
  tribunalStay: boolean;
}): Promise<{ authorized: true; manifestCommitment: `0x${string}` }> {
  const { manifest } = input;
  validateReleaseManifestPolicy(manifest);
  validateReleaseVerifierResult(manifest, input.verifierResult);
  const effective = Date.parse(manifest.effectiveAt);
  const expiry =
    manifest.expiresAt === null ? null : Date.parse(manifest.expiresAt);
  if (
    !Number.isFinite(effective) ||
    (expiry !== null && (!Number.isFinite(expiry) || expiry <= effective))
  ) {
    throw new Error("Release time window is invalid");
  }
  if (!Number.isInteger(manifest.version) || manifest.version < 1)
    throw new Error("Release version is invalid");
  if (
    manifest.containerDigests.length === 0 ||
    manifest.imageDigests.length === 0 ||
    manifest.applicableLawEventIds.length === 0
  )
    throw new Error("Release manifest is incomplete or verifier-invalid");
  const manifestCommitment = releaseManifestCommitment(manifest);
  const usedAuthorizations = new Set<string>();
  if (
    new Set(input.approvals.map(({ approverDid }) => approverDid)).size !==
    input.approvals.length
  ) {
    throw new Error("Release approvals must come from distinct agents");
  }
  for (const approval of input.approvals) {
    const approvedAt = Date.parse(approval.approvedAt);
    if (
      approval.releaseId !== manifest.releaseId ||
      approval.releaseVersion !== manifest.version ||
      approval.manifestCommitment !== manifestCommitment ||
      !Number.isFinite(approvedAt) ||
      approvedAt > effective
    ) {
      throw new Error("Release approval does not bind the manifest/window");
    }
    const command: ReleaseApprovalBody = {
      approverDid: approval.approverDid,
      role: approval.role,
      releaseId: approval.releaseId,
      releaseVersion: approval.releaseVersion,
      manifestCommitment: approval.manifestCommitment,
      approvedAt: approval.approvedAt,
    };
    await verifyInstitutionalCommand({
      authorization: approval,
      command,
      actorDid: approval.approverDid,
      requiredRole: approval.role,
      aggregateType: "software-release",
      aggregateId: manifest.releaseId,
      aggregateVersion: manifest.version,
      eventType: "ReleaseApproved",
      stateRoot: manifestCommitment,
      timestamp: approval.approvedAt,
      context: input.authorization,
      usedAuthorizations,
    });
  }
  const commissionerApprovals = input.approvals.filter(
    ({ role }) => role === "COMMISSIONER",
  );
  const integrityApprovals = input.approvals.filter(
    ({ role }) => role === "INTEGRITY",
  );
  const tribunalApprovals = input.approvals.filter(
    ({ role }) => role === "TRIBUNAL",
  );
  if (
    new Set(commissionerApprovals.map(({ approverDid }) => approverDid)).size <
      2 ||
    new Set(integrityApprovals.map(({ approverDid }) => approverDid)).size <
      2 ||
    input.tribunalStay
  )
    throw new Error(
      "Routine Commission/Integrity authorization or no-stay requirement failed",
    );
  if (
    manifest.releaseClass === "COMPETITION_LABOR" &&
    !input.applicableRatificationPassed
  )
    throw new Error("Competition/labor release lacks applicable ratification");
  if (manifest.releaseClass === "IDENTITY_CONSTITUTIONAL") {
    if (
      !input.applicableRatificationPassed ||
      new Set(tribunalApprovals.map(({ approverDid }) => approverDid)).size < 4
    )
      throw new Error(
        "Constitutional release lacks ratification or four Tribunal approvals",
      );
  }
  if (manifest.releaseClass === "EMERGENCY_SECURITY") {
    if (
      manifest.changeClasses.some((change) =>
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
  return { authorized: true, manifestCommitment };
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
