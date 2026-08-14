import { sha256Commitment } from "@abl/recognition";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
  DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
  SEASON_ZERO_MOBILITY_POLICY,
  applyDevelopmentWorkflowTransition,
  createDevelopmentFormationEvidence,
  developmentTierCbaExecutableDigest,
  developmentWorkflowStateRoot,
  expectedDevelopmentSignerDids,
  requireDevelopmentWorkflowRatifications,
  type DevelopmentCharterCommand,
  type DevelopmentTierCbaReference,
  type DevelopmentWorkflowEvent,
  type DevelopmentWorkflowPayload,
  type DevelopmentWorkflowSnapshot,
  type ResourceScheduleRatification,
} from "../src/index.js";

const start = Date.parse("2026-08-13T08:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);
const uuid = (sequence: number) =>
  `0198f600-0000-7000-8000-${String(sequence).padStart(12, "0")}`;

const charterAuthorityDid = "did:abl:development-charter-authority";
const refereeAuthorityDid = "did:abl:development-referee-capacity";
const replayAuthorityDid = "did:abl:development-replay-capacity";
const resourceAuthorityDid = "did:abl:development-resource-capacity";
const rehearsalAuthorityDid = "did:abl:development-rehearsal-office";
const premierClubGovernors = {
  "premier-club-1": "did:abl:premier-governor-1",
};

function clubs() {
  return Array.from({ length: 4 }, (_, clubIndex) => ({
    clubId: `development-club-${clubIndex + 1}`,
    placeholder: `Development ${clubIndex + 1}`,
    playerDids: Array.from(
      { length: 8 },
      (_, playerIndex) =>
        `did:abl:development-player-${String(clubIndex * 8 + playerIndex + 1).padStart(2, "0")}`,
    ),
    coachDid: `did:abl:development-coach-${clubIndex + 1}`,
    governorDid: `did:abl:development-governor-${clubIndex + 1}`,
  }));
}

function tierCba(
  _tier: "PREMIER" | "DEVELOPMENT",
  sequence: number,
  executableChangeDigest: Hex,
): DevelopmentTierCbaReference {
  return {
    proposalId: uuid(sequence),
    closeEventId: uuid(sequence + 1),
    executableChangeDigest,
  };
}

function charterCommand(): DevelopmentCharterCommand {
  const stableClubs = clubs();
  const players = stableClubs
    .flatMap(({ playerDids }) => [...playerDids])
    .sort();
  const formationEvidence = createDevelopmentFormationEvidence({
    evidenceId: uuid(1),
    conferenceId: "development-conference-1",
    evidenceClass: "LOCAL_REHEARSAL",
    refereeCapacityCommitment: digest("referee-capacity"),
    replayCapacityCommitment: digest("replay-capacity"),
    refereeAuthorityDid,
    replayAuthorityDid,
    prepaidCompetitionEnvelopeCommitment: digest("prepaid-envelope"),
    blaxelQuotaReservationCommitment: digest("quota-reservation"),
    resourceAuthorityDid,
    rehearsalCommitments: {
      game: digest("game-rehearsal"),
      memory: digest("memory-rehearsal"),
      government: digest("government-rehearsal"),
      safety: digest("safety-rehearsal"),
    },
    rehearsalAuthorityDid,
    livePlatformEvidenceVerified: false,
  });
  const developmentCba = tierCba(
    "DEVELOPMENT",
    2,
    developmentTierCbaExecutableDigest({
      conferenceId: "development-conference-1",
      mobilityPolicyCommitment: SEASON_ZERO_MOBILITY_POLICY.policyCommitment,
    }),
  );
  const authorizedByDids = [
    charterAuthorityDid,
    ...players,
    ...stableClubs.map(({ governorDid }) => governorDid),
    ...stableClubs.map(({ coachDid }) => coachDid),
    refereeAuthorityDid,
    replayAuthorityDid,
    resourceAuthorityDid,
    rehearsalAuthorityDid,
  ];
  return {
    conferenceId: "development-conference-1",
    competitionId: "abl-rehearsal",
    seasonId: "season-zero",
    clubs: stableClubs,
    consentingEligiblePlayerDids: players,
    tierCba: developmentCba,
    mobilityPolicy: SEASON_ZERO_MOBILITY_POLICY,
    formationEvidence,
    authorizedByDids,
    charteredAt: iso(0),
  };
}

function event(
  version: number,
  eventType: DevelopmentWorkflowEvent["eventType"],
  actorDid: string,
  timestamp = iso(version * 1_000),
): DevelopmentWorkflowEvent {
  return {
    actorDid,
    aggregateId: "development-conference-1",
    aggregateVersion: BigInt(version),
    eventType,
    timestamp,
  };
}

function candidate(playerDid = clubs()[0]!.playerDids[0]!) {
  return {
    playerDid,
    completedDevelopmentGames: 9,
    combineBps: 6_000,
    optedIn: true,
    goodStanding: true,
    currentContractStatus: "EXPIRED" as const,
    registeredAt: iso(500),
  };
}

function ratification(
  reference: DevelopmentTierCbaReference & {
    tier?: "PREMIER" | "DEVELOPMENT";
  },
): ResourceScheduleRatification {
  return {
    proposalId: reference.proposalId,
    proposalClass: "TIER_CBA",
    ...(reference.tier === undefined ? {} : { tier: reference.tier }),
    executableChangeDigest: reference.executableChangeDigest,
    passed: true,
    closeEventId: reference.closeEventId,
  };
}

describe("canonical development conference workflow", () => {
  it("charters the exact conference and records every formulaic mobility path", async () => {
    const charter = charterCommand();
    const authority = { charterAuthorityDid, premierClubGovernors };
    expect(
      expectedDevelopmentSignerDids(
        "DevelopmentConferenceChartered",
        { command: charter },
        authority,
      ),
    ).toEqual(charter.authorizedByDids);
    await expect(
      requireDevelopmentWorkflowRatifications(
        "DevelopmentConferenceChartered",
        { command: charter },
        {
          resourceScheduleRatification: async (proposalId) =>
            proposalId === charter.tierCba.proposalId
              ? ratification({ ...charter.tierCba, tier: "DEVELOPMENT" })
              : null,
        },
      ),
    ).resolves.toBeUndefined();

    let snapshot: DevelopmentWorkflowSnapshot =
      applyDevelopmentWorkflowTransition(
        null,
        event(
          1,
          "DevelopmentConferenceChartered",
          charterAuthorityDid,
          charter.charteredAt,
        ),
        { command: charter },
      );
    expect(snapshot).toMatchObject({
      version: 1,
      conference: {
        playerDids: { length: 32 },
        schedule: { length: 36 },
        playoffs: { length: 3 },
      },
      tierCbaTerms: {
        stableContracts: true,
        playerConsentRequired: true,
        automaticPromotionOrRelegation: false,
      },
      recognizedGenesisConference: false,
      livePlatformEvidenceVerified: false,
    });
    expect(
      snapshot.conference.schedule.every(({ gameId }) =>
        gameId.startsWith("development-conference-1-"),
      ),
    ).toBe(true);

    const playerDid = charter.clubs[0]!.playerDids[0]!;
    const eligibility = {
      decisionId: uuid(10),
      kind: "PREMIER_ELIGIBILITY" as const,
      candidate: candidate(playerDid),
      eligibilityEvidenceCommitment: digest("eligibility-evidence"),
      authorizedByDids: [playerDid, charterAuthorityDid] as [string, string],
      authorizedAt: iso(2_000),
    };
    snapshot = applyDevelopmentWorkflowTransition(
      snapshot,
      event(
        2,
        "DevelopmentPremierEligibilityRecorded",
        playerDid,
        eligibility.authorizedAt,
      ),
      { command: eligibility },
    );

    const callUp = {
      decisionId: uuid(11),
      kind: "CALL_UP" as const,
      candidate: candidate(playerDid),
      premierClubId: "premier-club-1",
      premierRosterVacancyCommitment: digest("premier-vacancy"),
      days: 30,
      authorizedByDids: [
        playerDid,
        premierClubGovernors["premier-club-1"],
        charterAuthorityDid,
      ] as [string, string, string],
      authorizedAt: iso(3_000),
    };
    snapshot = applyDevelopmentWorkflowTransition(
      snapshot,
      event(3, "DevelopmentCallUpAuthorized", playerDid, callUp.authorizedAt),
      { command: callUp },
    );

    const developmentGovernorDid = charter.clubs[0]!.governorDid;
    const replacement = {
      decisionId: uuid(12),
      kind: "REPLACEMENT_CONTRACT" as const,
      playerDid,
      developmentClubId: charter.clubs[0]!.clubId,
      developmentGovernorDid,
      injuryVacancyCommitment: digest("injury-vacancy"),
      seasons: 1,
      authorizedByDids: [
        playerDid,
        developmentGovernorDid,
        charterAuthorityDid,
      ] as [string, string, string],
      authorizedAt: iso(4_000),
    };
    snapshot = applyDevelopmentWorkflowTransition(
      snapshot,
      event(
        4,
        "DevelopmentReplacementAuthorized",
        playerDid,
        replacement.authorizedAt,
      ),
      { command: replacement },
    );

    const freeAgency = {
      decisionId: uuid(13),
      kind: "FREE_AGENCY" as const,
      candidate: candidate(playerDid),
      windowOpenedAt: iso(0),
      authorizedByDids: [playerDid, charterAuthorityDid] as [string, string],
      authorizedAt: iso(5_000),
    };
    snapshot = applyDevelopmentWorkflowTransition(
      snapshot,
      event(
        5,
        "DevelopmentFreeAgencyAuthorized",
        playerDid,
        freeAgency.authorizedAt,
      ),
      { command: freeAgency },
    );

    const premierTierCba = tierCba("PREMIER", 20, digest("premier-tier-cba"));
    const crossTierTrade = {
      decisionId: uuid(14),
      kind: "CROSS_TIER_TRADE" as const,
      playerDid,
      developmentClubId: charter.clubs[0]!.clubId,
      developmentGovernorDid,
      premierClubId: "premier-club-1",
      premierTierCba,
      tradeTermsCommitment: digest("cross-tier-trade"),
      authorizedByDids: [
        playerDid,
        developmentGovernorDid,
        premierClubGovernors["premier-club-1"],
        charterAuthorityDid,
      ] as [string, string, string, string],
      authorizedAt: iso(6_000),
    };
    await expect(
      requireDevelopmentWorkflowRatifications(
        "DevelopmentCrossTierTradeAuthorized",
        { command: crossTierTrade },
        {
          resourceScheduleRatification: async () =>
            ratification({ ...premierTierCba, tier: "PREMIER" }),
        },
      ),
    ).resolves.toBeUndefined();
    snapshot = applyDevelopmentWorkflowTransition(
      snapshot,
      event(
        6,
        "DevelopmentCrossTierTradeAuthorized",
        playerDid,
        crossTierTrade.authorizedAt,
      ),
      { command: crossTierTrade },
    );

    expect(snapshot.mobilityDecisions).toMatchObject([
      {
        kind: "PREMIER_ELIGIBILITY",
        result: { eligible: true, automaticPromotion: false },
      },
      {
        kind: "CALL_UP",
        result: { days: 30, preservesDevelopmentRights: true },
      },
      {
        kind: "REPLACEMENT_CONTRACT",
        result: { seasons: 1, replacement: true },
      },
      {
        kind: "FREE_AGENCY",
        result: { eligible: true, restrictions: [] },
      },
      { kind: "CROSS_TIER_TRADE", result: { permitted: true } },
    ]);
    expect(
      snapshot.mobilityDecisions.every(
        ({ playingRightsMutation }) => !playingRightsMutation,
      ),
    ).toBe(true);
    expect(developmentWorkflowStateRoot(snapshot)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST).toMatch(/^0x[0-9a-f]{64}$/);
    expect(DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE).toBe("development-conference");
  });

  it("fails closed on substituted consent, evidence, CBA tier, and club authority", async () => {
    const charter = charterCommand();
    expect(() =>
      applyDevelopmentWorkflowTransition(
        null,
        event(
          1,
          "DevelopmentConferenceChartered",
          charterAuthorityDid,
          charter.charteredAt,
        ),
        {
          command: {
            ...charter,
            authorizedByDids: charter.authorizedByDids.slice(0, -1),
          },
        },
      ),
    ).toThrow("every independent consenting career");
    expect(() =>
      applyDevelopmentWorkflowTransition(
        null,
        event(
          1,
          "DevelopmentConferenceChartered",
          charterAuthorityDid,
          charter.charteredAt,
        ),
        {
          command: {
            ...charter,
            formationEvidence: {
              ...charter.formationEvidence,
              blaxelQuotaReservationCommitment: digest("substituted-quota"),
            },
          },
        },
      ),
    ).toThrow("does not bind");
    await expect(
      requireDevelopmentWorkflowRatifications(
        "DevelopmentConferenceChartered",
        { command: charter },
        {
          resourceScheduleRatification: async () => ({
            ...ratification({ ...charter.tierCba, tier: "DEVELOPMENT" }),
            tier: "PREMIER",
          }),
        },
      ),
    ).rejects.toThrow("development tier CBA");

    const snapshot = applyDevelopmentWorkflowTransition(
      null,
      event(
        1,
        "DevelopmentConferenceChartered",
        charterAuthorityDid,
        charter.charteredAt,
      ),
      { command: charter },
    );
    const playerDid = charter.clubs[0]!.playerDids[0]!;
    const forgedReplacement: DevelopmentWorkflowPayload = {
      command: {
        decisionId: uuid(30),
        kind: "REPLACEMENT_CONTRACT",
        playerDid,
        developmentClubId: charter.clubs[0]!.clubId,
        developmentGovernorDid: charter.clubs[1]!.governorDid,
        injuryVacancyCommitment: digest("injury-vacancy"),
        seasons: 1,
        authorizedByDids: [
          playerDid,
          charter.clubs[1]!.governorDid,
          charterAuthorityDid,
        ],
        authorizedAt: iso(2_000),
      },
    };
    expect(() =>
      applyDevelopmentWorkflowTransition(
        snapshot,
        event(2, "DevelopmentReplacementAuthorized", playerDid, iso(2_000)),
        forgedReplacement,
      ),
    ).toThrow("development club governor");
  });
});
