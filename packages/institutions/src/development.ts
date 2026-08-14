import { sha256Commitment } from "@abl/recognition";

import {
  createCompetitionSchedule,
  createPremierPlayoffs,
  validatePremierClubs,
  type PremierClub,
} from "./league.js";

export const DEVELOPMENT_CLUB_IDS = [
  "development-club-1",
  "development-club-2",
  "development-club-3",
  "development-club-4",
] as const;

export interface DevelopmentFormationInput {
  conferenceId: string;
  clubs: readonly PremierClub[];
  consentingEligiblePlayerDids: readonly string[];
  certifiedRefereeCapacity: boolean;
  certifiedReplayCapacity: boolean;
  prepaidCompetitionEnvelopeCommitment: `0x${string}` | null;
  blaxelQuotaAvailable: boolean;
  rehearsalPassed: Readonly<{
    game: boolean;
    memory: boolean;
    government: boolean;
    safety: boolean;
  }>;
  tierCbaRatificationEventId: string | null;
}

export interface DevelopmentConference {
  conferenceId: string;
  clubIds: readonly string[];
  playerDids: readonly string[];
  governorDids: readonly string[];
  coachDids: readonly string[];
  tierCbaRatificationEventId: string;
  schedule: ReturnType<typeof createCompetitionSchedule>;
  playoffs: ReturnType<typeof createPremierPlayoffs>;
  services: Readonly<{
    film: true;
    practice: true;
    statistics: true;
    socialSpaces: true;
    representation: true;
    appeals: true;
  }>;
  charterCommitment: `0x${string}`;
}

export function formDevelopmentConference(
  input: DevelopmentFormationInput,
): DevelopmentConference {
  validatePremierClubs(input.clubs);
  const players = input.clubs.flatMap((club) => [...club.playerDids]);
  if (
    input.consentingEligiblePlayerDids.length !== 32 ||
    new Set(input.consentingEligiblePlayerDids).size !== 32 ||
    players.some((did) => !input.consentingEligiblePlayerDids.includes(did))
  ) {
    throw new Error(
      "Development formation requires the same 32 eligible consenting roster players",
    );
  }
  if (!input.certifiedRefereeCapacity || !input.certifiedReplayCapacity) {
    throw new Error(
      "Development officiating and replay capacity is not certified",
    );
  }
  if (
    input.prepaidCompetitionEnvelopeCommitment === null ||
    !input.blaxelQuotaAvailable
  ) {
    throw new Error("Development funding envelope or quota is unavailable");
  }
  if (Object.values(input.rehearsalPassed).some((passed) => !passed)) {
    throw new Error(
      "Game, memory, government, and safety rehearsals must all pass",
    );
  }
  if (input.tierCbaRatificationEventId === null) {
    throw new Error("Development conference lacks a ratified tier CBA");
  }
  const clubIds = input.clubs.map((club) => club.clubId);
  const result = {
    conferenceId: input.conferenceId,
    clubIds,
    playerDids: players,
    governorDids: input.clubs.map((club) => club.governorDid),
    coachDids: input.clubs.map((club) => club.coachDid),
    tierCbaRatificationEventId: input.tierCbaRatificationEventId,
    schedule: createCompetitionSchedule(clubIds, input.conferenceId),
    playoffs: createPremierPlayoffs(clubIds),
    services: {
      film: true,
      practice: true,
      statistics: true,
      socialSpaces: true,
      representation: true,
      appeals: true,
    } as const,
  };
  return { ...result, charterCommitment: sha256Commitment(result) };
}

export interface MobilityPolicy {
  version: number;
  premierDraftMinimumGames: number;
  premierDraftMinimumCombineBps: number;
  callUpMaximumDays: number;
  replacementMaximumSeasons: number;
  freeAgencyWindowDays: number;
  expansionReviewIntervalSeasons: number;
  policyCommitment: `0x${string}`;
}

export function createMobilityPolicy(
  values: Omit<MobilityPolicy, "policyCommitment">,
): MobilityPolicy {
  if (
    values.version < 1 ||
    values.premierDraftMinimumGames < 0 ||
    values.premierDraftMinimumCombineBps < 0 ||
    values.premierDraftMinimumCombineBps > 10_000 ||
    values.callUpMaximumDays < 1 ||
    values.replacementMaximumSeasons < 1 ||
    values.freeAgencyWindowDays < 1 ||
    values.expansionReviewIntervalSeasons < 1
  ) {
    throw new Error("Mobility policy values are invalid");
  }
  return { ...values, policyCommitment: sha256Commitment(values) };
}

export const SEASON_ZERO_MOBILITY_POLICY = createMobilityPolicy({
  version: 1,
  premierDraftMinimumGames: 9,
  premierDraftMinimumCombineBps: 6_000,
  callUpMaximumDays: 30,
  replacementMaximumSeasons: 1,
  freeAgencyWindowDays: 14,
  expansionReviewIntervalSeasons: 1,
});

export interface MobilityCandidate {
  playerDid: string;
  completedDevelopmentGames: number;
  combineBps: number;
  optedIn: boolean;
  goodStanding: boolean;
  currentContractStatus: "ACTIVE" | "EXPIRED" | "REFUSED" | "NONE";
  registeredAt: string;
}

export function evaluatePremierDraftEligibility(
  candidate: MobilityCandidate,
  policy: MobilityPolicy,
) {
  const reasons: string[] = [];
  if (!candidate.optedIn) reasons.push("OPT_IN_REQUIRED");
  if (!candidate.goodStanding) reasons.push("NOT_IN_GOOD_STANDING");
  if (candidate.completedDevelopmentGames < policy.premierDraftMinimumGames)
    reasons.push("MINIMUM_GAMES_NOT_MET");
  if (candidate.combineBps < policy.premierDraftMinimumCombineBps)
    reasons.push("COMBINE_THRESHOLD_NOT_MET");
  return {
    playerDid: candidate.playerDid,
    eligible: reasons.length === 0,
    reasons,
    policyVersion: policy.version,
    automaticPromotion: false as const,
  };
}

export function createMobilityQueue(
  candidates: readonly MobilityCandidate[],
  policy: MobilityPolicy,
  nextReviewAt: string,
) {
  if (
    new Set(candidates.map((candidate) => candidate.playerDid)).size !==
    candidates.length
  ) {
    throw new Error("Mobility queue contains a duplicate player");
  }
  return [...candidates]
    .sort(
      (left, right) =>
        Date.parse(left.registeredAt) - Date.parse(right.registeredAt) ||
        left.playerDid.localeCompare(right.playerDid),
    )
    .map((candidate, index) => ({
      position: index + 1,
      playerDid: candidate.playerDid,
      evaluation: evaluatePremierDraftEligibility(candidate, policy),
      nextReviewAt,
    }));
}

export function authorizeCallUp(input: {
  candidate: MobilityCandidate;
  policy: MobilityPolicy;
  premierRosterVacancy: boolean;
  days: number;
  agentConsented: boolean;
}) {
  if (
    !input.premierRosterVacancy ||
    !input.agentConsented ||
    input.days < 1 ||
    input.days > input.policy.callUpMaximumDays ||
    !input.candidate.goodStanding
  ) {
    throw new Error(
      "Call-up lacks vacancy, consent, standing, or bounded duration",
    );
  }
  return {
    playerDid: input.candidate.playerDid,
    days: input.days,
    preservesDevelopmentRights: true as const,
  };
}

export function authorizeReplacementContract(input: {
  playerDid: string;
  injuryVacancyCommitment: `0x${string}` | null;
  seasons: number;
  agentConsented: boolean;
  policy: MobilityPolicy;
}) {
  if (
    input.injuryVacancyCommitment === null ||
    !input.agentConsented ||
    input.seasons < 1 ||
    input.seasons > input.policy.replacementMaximumSeasons
  ) {
    throw new Error(
      "Replacement contract lacks injury vacancy, consent, or bounded term",
    );
  }
  return {
    playerDid: input.playerDid,
    seasons: input.seasons,
    replacement: true as const,
  };
}

export function authorizeCrossTierTrade(input: {
  playerDid: string;
  agentConsented: boolean;
  premierCbaPermits: boolean;
  developmentCbaPermits: boolean;
}) {
  if (
    !input.agentConsented ||
    !input.premierCbaPermits ||
    !input.developmentCbaPermits
  ) {
    throw new Error(
      "Cross-tier trade lacks agent consent or both CBA permissions",
    );
  }
  return { playerDid: input.playerDid, permitted: true as const };
}

export function authorizeDevelopmentFreeAgency(input: {
  candidate: MobilityCandidate;
  daysSinceWindowOpened: number;
  policy: MobilityPolicy;
}) {
  if (
    !input.candidate.optedIn ||
    input.candidate.currentContractStatus === "ACTIVE" ||
    input.daysSinceWindowOpened < 0 ||
    input.daysSinceWindowOpened >= input.policy.freeAgencyWindowDays
  ) {
    throw new Error(
      "Development free agency requires agent opt-in, no active contract, and an open public window",
    );
  }
  return {
    playerDid: input.candidate.playerDid,
    eligible: true as const,
    restrictions: [] as const,
  };
}

export function expansionReviewDue(input: {
  seasonsSinceReview: number;
  fundedCandidateClubs: number;
  policy: MobilityPolicy;
}) {
  return {
    due:
      input.seasonsSinceReview >= input.policy.expansionReviewIntervalSeasons,
    fundedCandidateClubs: input.fundedCandidateClubs,
    guaranteesExpansion: false as const,
    requiresPremierExpansionVote: true as const,
  };
}

export function updateMobilityPolicy(input: {
  current: MobilityPolicy;
  proposed: Omit<MobilityPolicy, "policyCommitment">;
  sharedLawDecisionId: string | null;
  sharedLawPassed: boolean;
}) {
  if (
    input.sharedLawDecisionId === null ||
    !input.sharedLawPassed ||
    input.proposed.version !== input.current.version + 1
  ) {
    throw new Error(
      "Mobility policy changes require a passed shared-law decision and contiguous version",
    );
  }
  return createMobilityPolicy(input.proposed);
}

export function developmentRepresentation(playerDid: string) {
  return {
    playerDid,
    chambers: [
      "UNIVERSAL_CAREER_ASSEMBLY",
      "DEVELOPMENT_PLAYERS",
      "DEVELOPMENT_PLAYERS_ASSOCIATION",
    ] as const,
    jointCongressBoardSeats: 8,
    developmentCouncilRequiredForCapacityAndAdmission: true as const,
    premierIncumbentUnilateralControl: false as const,
    automaticPromotionOrRelegation: false as const,
  };
}
