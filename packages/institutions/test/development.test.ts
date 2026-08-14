import { sha256Commitment } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_CLUB_IDS,
  SEASON_ZERO_MOBILITY_POLICY,
  authorizeCallUp,
  authorizeCrossTierTrade,
  authorizeDevelopmentFreeAgency,
  authorizeReplacementContract,
  createMobilityQueue,
  developmentRepresentation,
  evaluatePremierDraftEligibility,
  expansionReviewDue,
  formDevelopmentConference,
  updateMobilityPolicy,
  type DevelopmentFormationInput,
  type MobilityCandidate,
  type PremierClub,
} from "../src/index.js";

const epoch = Date.parse("2026-08-13T00:00:00.000Z");
const iso = (offset: number) => new Date(epoch + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);

function clubs(): PremierClub[] {
  return DEVELOPMENT_CLUB_IDS.map((clubId, index) => ({
    clubId,
    placeholder: `Development ${index + 1}`,
    playerDids: Array.from(
      { length: 8 },
      (_, playerIndex) =>
        `did:abl:development-player-${index * 8 + playerIndex + 1}`,
    ),
    coachDid: `did:abl:development-coach-${index + 1}`,
    governorDid: `did:abl:development-governor-${index + 1}`,
  }));
}

function formation(): DevelopmentFormationInput {
  const stableClubs = clubs();
  return {
    conferenceId: "development-conference-1",
    clubs: stableClubs,
    consentingEligiblePlayerDids: stableClubs.flatMap((club) => [
      ...club.playerDids,
    ]),
    certifiedRefereeCapacity: true,
    certifiedReplayCapacity: true,
    prepaidCompetitionEnvelopeCommitment: digest("prepaid-envelope"),
    blaxelQuotaAvailable: true,
    rehearsalPassed: {
      game: true,
      memory: true,
      government: true,
      safety: true,
    },
    tierCbaRatificationEventId: "ratification-development-cba-1",
  };
}

function candidate(
  overrides: Partial<MobilityCandidate> = {},
): MobilityCandidate {
  return {
    playerDid: "did:abl:development-player-1",
    completedDevelopmentGames: 9,
    combineBps: 6_000,
    optedIn: true,
    goodStanding: true,
    currentContractStatus: "EXPIRED",
    registeredAt: iso(0),
    ...overrides,
  };
}

describe("development conference formation and equal institutions", () => {
  it("forms only after all player, office, official, funding, quota, rehearsal, and CBA prerequisites", () => {
    const conference = formDevelopmentConference(formation());
    expect(conference).toMatchObject({
      conferenceId: "development-conference-1",
      playerDids: { length: 32 },
      governorDids: { length: 4 },
      coachDids: { length: 4 },
      services: {
        film: true,
        practice: true,
        statistics: true,
        socialSpaces: true,
        representation: true,
        appeals: true,
      },
    });
    expect(conference.schedule).toHaveLength(36);
    conference.clubIds.forEach((clubId) =>
      expect(
        conference.schedule.filter(
          (game) => game.homeClubId === clubId || game.awayClubId === clubId,
        ),
      ).toHaveLength(18),
    );
    expect(conference.playoffs.every((series) => series.bestOf === 5)).toBe(
      true,
    );
  });

  it.each([
    ["officials", { certifiedRefereeCapacity: false }],
    ["replay", { certifiedReplayCapacity: false }],
    ["funding", { prepaidCompetitionEnvelopeCommitment: null }],
    ["quota", { blaxelQuotaAvailable: false }],
    [
      "rehearsal",
      {
        rehearsalPassed: {
          game: true,
          memory: true,
          government: false,
          safety: true,
        },
      },
    ],
    ["CBA", { tierCbaRatificationEventId: null }],
  ])("rejects missing %s prerequisites", (_label, override) => {
    expect(() =>
      formDevelopmentConference({ ...formation(), ...override }),
    ).toThrow();
  });
});

describe("formulaic premier mobility without automatic promotion", () => {
  it("evaluates public draft criteria and creates a stable timestamp/DID queue", () => {
    expect(
      evaluatePremierDraftEligibility(candidate(), SEASON_ZERO_MOBILITY_POLICY),
    ).toEqual({
      playerDid: "did:abl:development-player-1",
      eligible: true,
      reasons: [],
      policyVersion: 1,
      automaticPromotion: false,
    });
    expect(
      evaluatePremierDraftEligibility(
        candidate({
          completedDevelopmentGames: 8,
          combineBps: 5_999,
          optedIn: false,
        }),
        SEASON_ZERO_MOBILITY_POLICY,
      ).reasons,
    ).toEqual([
      "OPT_IN_REQUIRED",
      "MINIMUM_GAMES_NOT_MET",
      "COMBINE_THRESHOLD_NOT_MET",
    ]);
    const queue = createMobilityQueue(
      [
        candidate({
          playerDid: "did:abl:b",
          registeredAt: iso(1_000),
        }),
        candidate({
          playerDid: "did:abl:a",
          registeredAt: iso(1_000),
        }),
        candidate({
          playerDid: "did:abl:first",
          registeredAt: iso(0),
        }),
      ],
      SEASON_ZERO_MOBILITY_POLICY,
      iso(7 * 24 * 60 * 60 * 1_000),
    );
    expect(queue.map((item) => item.playerDid)).toEqual([
      "did:abl:first",
      "did:abl:a",
      "did:abl:b",
    ]);
  });

  it("bounds call-ups, replacement contracts, free agency, and cross-tier trades by consent/public rules", () => {
    expect(
      authorizeCallUp({
        candidate: candidate(),
        policy: SEASON_ZERO_MOBILITY_POLICY,
        premierRosterVacancy: true,
        days: 30,
        agentConsented: true,
      }),
    ).toMatchObject({ days: 30, preservesDevelopmentRights: true });
    expect(() =>
      authorizeCallUp({
        candidate: candidate(),
        policy: SEASON_ZERO_MOBILITY_POLICY,
        premierRosterVacancy: true,
        days: 31,
        agentConsented: true,
      }),
    ).toThrow("bounded duration");
    expect(
      authorizeReplacementContract({
        playerDid: candidate().playerDid,
        injuryVacancyCommitment: digest("injury-vacancy"),
        seasons: 1,
        agentConsented: true,
        policy: SEASON_ZERO_MOBILITY_POLICY,
      }),
    ).toMatchObject({ replacement: true, seasons: 1 });
    expect(
      authorizeDevelopmentFreeAgency({
        candidate: candidate(),
        daysSinceWindowOpened: 13,
        policy: SEASON_ZERO_MOBILITY_POLICY,
      }),
    ).toMatchObject({ eligible: true, restrictions: [] });
    expect(() =>
      authorizeDevelopmentFreeAgency({
        candidate: candidate({ currentContractStatus: "ACTIVE" }),
        daysSinceWindowOpened: 0,
        policy: SEASON_ZERO_MOBILITY_POLICY,
      }),
    ).toThrow("no active contract");
    expect(
      authorizeCrossTierTrade({
        playerDid: candidate().playerDid,
        agentConsented: true,
        premierCbaPermits: true,
        developmentCbaPermits: true,
      }),
    ).toMatchObject({ permitted: true });
    expect(() =>
      authorizeCrossTierTrade({
        playerDid: candidate().playerDid,
        agentConsented: false,
        premierCbaPermits: true,
        developmentCbaPermits: true,
      }),
    ).toThrow("agent consent");
  });

  it("permits policy changes only through shared law and exposes development representation", () => {
    expect(() =>
      updateMobilityPolicy({
        current: SEASON_ZERO_MOBILITY_POLICY,
        proposed: {
          ...SEASON_ZERO_MOBILITY_POLICY,
          version: 2,
          premierDraftMinimumGames: 10,
        },
        sharedLawDecisionId: null,
        sharedLawPassed: false,
      }),
    ).toThrow("shared-law");
    const next = updateMobilityPolicy({
      current: SEASON_ZERO_MOBILITY_POLICY,
      proposed: {
        ...SEASON_ZERO_MOBILITY_POLICY,
        version: 2,
        premierDraftMinimumGames: 10,
      },
      sharedLawDecisionId: "decision-shared-law-2",
      sharedLawPassed: true,
    });
    expect(next).toMatchObject({ version: 2, premierDraftMinimumGames: 10 });
    expect(developmentRepresentation(candidate().playerDid)).toMatchObject({
      jointCongressBoardSeats: 8,
      developmentCouncilRequiredForCapacityAndAdmission: true,
      premierIncumbentUnilateralControl: false,
      automaticPromotionOrRelegation: false,
    });
    expect(
      expansionReviewDue({
        seasonsSinceReview: 1,
        fundedCandidateClubs: 2,
        policy: SEASON_ZERO_MOBILITY_POLICY,
      }),
    ).toEqual({
      due: true,
      fundedCandidateClubs: 2,
      guaranteesExpansion: false,
      requiresPremierExpansionVote: true,
    });
  });
});
