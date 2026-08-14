import {
  DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
  DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
  SEASON_ZERO_MOBILITY_POLICY,
  applyDevelopmentWorkflowTransition,
  createDevelopmentFormationEvidence,
  developmentTierCbaExecutableDigest,
  developmentWorkflowStateRoot,
  expectedDevelopmentSignerDids,
  type DevelopmentCharterCommand,
  type DevelopmentWorkflowEventType,
  type DevelopmentWorkflowPayload,
  type DevelopmentWorkflowSnapshot,
} from "@abl/institutions";
import { InMemoryCanonicalStore } from "@abl/database";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import { createLiveCoreApi } from "../src/server.js";

const start = Date.parse("2026-08-13T08:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);
const uuid = (sequence: number) =>
  `0198f700-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
const conferenceId = "development-conference-1";
const competitionId = "abl-rehearsal";
const seasonId = "season-zero";
const charterAuthorityDid = "did:abl:development-charter-authority";
const refereeAuthorityDid = "did:abl:development-referee-capacity";
const replayAuthorityDid = "did:abl:development-replay-capacity";
const resourceAuthorityDid = "did:abl:development-resource-capacity";
const rehearsalAuthorityDid = "did:abl:development-rehearsal-office";
const premierClubGovernors = {
  "premier-club-1": "did:abl:premier-governor-1",
};
const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
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

function charter(): DevelopmentCharterCommand {
  const stableClubs = clubs();
  const players = stableClubs
    .flatMap(({ playerDids }) => [...playerDids])
    .sort();
  const tierCba = {
    proposalId: uuid(1),
    closeEventId: uuid(2),
    executableChangeDigest: developmentTierCbaExecutableDigest({
      conferenceId,
      mobilityPolicyCommitment: SEASON_ZERO_MOBILITY_POLICY.policyCommitment,
    }),
  };
  const formationEvidence = createDevelopmentFormationEvidence({
    evidenceId: uuid(3),
    conferenceId,
    evidenceClass: "LOCAL_REHEARSAL",
    refereeCapacityCommitment: digest("core-referee-capacity"),
    replayCapacityCommitment: digest("core-replay-capacity"),
    refereeAuthorityDid,
    replayAuthorityDid,
    prepaidCompetitionEnvelopeCommitment: digest("core-prepaid-envelope"),
    blaxelQuotaReservationCommitment: digest("core-quota"),
    resourceAuthorityDid,
    rehearsalCommitments: {
      game: digest("core-game-rehearsal"),
      memory: digest("core-memory-rehearsal"),
      government: digest("core-government-rehearsal"),
      safety: digest("core-safety-rehearsal"),
    },
    rehearsalAuthorityDid,
    livePlatformEvidenceVerified: false,
  });
  return {
    conferenceId,
    competitionId,
    seasonId,
    clubs: stableClubs,
    consentingEligiblePlayerDids: players,
    tierCba,
    mobilityPolicy: SEASON_ZERO_MOBILITY_POLICY,
    formationEvidence,
    authorizedByDids: [
      charterAuthorityDid,
      ...players,
      ...stableClubs.map(({ governorDid }) => governorDid),
      ...stableClubs.map(({ coachDid }) => coachDid),
      refereeAuthorityDid,
      replayAuthorityDid,
      resourceAuthorityDid,
      rehearsalAuthorityDid,
    ],
    charteredAt: iso(0),
  };
}

function identities(dids: readonly string[]) {
  return new Map<string, SigningIdentity>(
    dids.map((did, index) => [
      did,
      createSigningIdentity(
        `0x${(index + 1).toString(16).padStart(64, "0")}` as `0x${string}`,
      ),
    ]),
  );
}

function transitionEvent(
  version: number,
  eventType: DevelopmentWorkflowEventType,
  actorDid: string,
  timestamp: string,
) {
  return {
    actorDid,
    aggregateId: conferenceId,
    aggregateVersion: BigInt(version),
    eventType,
    timestamp,
  };
}

function canonicalDevelopmentEvent(input: {
  version: number;
  eventType: DevelopmentWorkflowEventType;
  payload: DevelopmentWorkflowPayload;
  priorSnapshot: DevelopmentWorkflowSnapshot | null;
  previousEventHash: `0x${string}` | null;
  timestamp: string;
}): { event: CanonicalEvent; snapshot: DevelopmentWorkflowSnapshot } {
  const actorDid = input.payload.command.authorizedByDids[0]!;
  const snapshot = applyDevelopmentWorkflowTransition(
    input.priorSnapshot,
    transitionEvent(input.version, input.eventType, actorDid, input.timestamp),
    input.payload,
  );
  const event = createCanonicalEvent({
    eventId: uuid(100 + input.version * 2),
    actorDid,
    nonce: `development-core-${input.version}`,
    idempotencyKey: uuid(101 + input.version * 2),
    aggregateType: DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: conferenceId,
    aggregateVersion: BigInt(input.version),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: developmentWorkflowStateRoot(snapshot),
    schemaDigest: DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  });
  return { event, snapshot };
}

async function command(
  event: CanonicalEvent,
  signerDids: readonly string[],
  signers: ReadonlyMap<string, SigningIdentity>,
) {
  return {
    event: { ...event, aggregateVersion: event.aggregateVersion.toString() },
    signatures: await Promise.all(
      signerDids.map((did) =>
        signCanonicalEvent(signers.get(did)!, domain, event),
      ),
    ),
  };
}

describe("development conference command service", () => {
  it("persists the full charter and every signed mobility path across restart", async () => {
    const charterCommand = charter();
    const premierTierCba = {
      proposalId: uuid(30),
      closeEventId: uuid(31),
      executableChangeDigest: digest("core-premier-tier-cba"),
    };
    const signerAuthority = { charterAuthorityDid, premierClubGovernors };
    const charterPayload = { command: charterCommand };
    const charterSignerDids = expectedDevelopmentSignerDids(
      "DevelopmentConferenceChartered",
      charterPayload,
      signerAuthority,
    );
    const signers = identities([
      ...charterSignerDids,
      premierClubGovernors["premier-club-1"],
    ]);
    const admittedAgents = new Map(
      [...signers].map(([did, identity]) => [
        did,
        {
          signerAddress: identity.address,
          allowedAggregateTypes: [DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE],
        },
      ]),
    );
    const store = new InMemoryCanonicalStore();
    const now = { value: start };
    const resourceScheduleRatification = async (proposalId: string) => {
      if (proposalId === charterCommand.tierCba.proposalId) {
        return {
          proposalId,
          proposalClass: "TIER_CBA",
          tier: "DEVELOPMENT" as const,
          executableChangeDigest: charterCommand.tierCba.executableChangeDigest,
          passed: true,
          closeEventId: charterCommand.tierCba.closeEventId,
        };
      }
      if (proposalId === premierTierCba.proposalId) {
        return {
          proposalId,
          proposalClass: "TIER_CBA",
          tier: "PREMIER" as const,
          executableChangeDigest: premierTierCba.executableChangeDigest,
          passed: true,
          closeEventId: premierTierCba.closeEventId,
        };
      }
      return null;
    };
    const options = {
      store,
      domain,
      admittedAgents,
      competitionId,
      seasonId,
      now: () => now.value,
      development: {
        conferenceId,
        charterAuthorityDid,
        premierClubGovernors,
        tierCbaRatification: { resourceScheduleRatification },
      },
    };
    const app = createLiveCoreApi(options);
    const chartered = canonicalDevelopmentEvent({
      version: 1,
      eventType: "DevelopmentConferenceChartered",
      payload: charterPayload,
      priorSnapshot: null,
      previousEventHash: null,
      timestamp: charterCommand.charteredAt,
    });
    const charterRequest = await command(
      chartered.event,
      charterSignerDids,
      signers,
    );
    const charterResponse = await app.inject({
      method: "POST",
      url: "/v1/development/charter",
      payload: charterRequest,
    });
    expect(charterResponse.statusCode).toBe(201);
    expect(charterResponse.json()).toMatchObject({
      accepted: true,
      aggregateVersion: "1",
      recognizedGenesisConference: false,
      livePlatformEvidenceVerified: false,
      playingRightsMutation: false,
    });

    now.value += 1_000;
    const playerDid = charterCommand.clubs[0]!.playerDids[0]!;
    const eligibilityPayload = {
      command: {
        decisionId: uuid(20),
        kind: "PREMIER_ELIGIBILITY" as const,
        candidate: {
          playerDid,
          completedDevelopmentGames: 9,
          combineBps: 6_000,
          optedIn: true,
          goodStanding: true,
          currentContractStatus: "EXPIRED" as const,
          registeredAt: iso(500),
        },
        eligibilityEvidenceCommitment: digest("core-eligibility"),
        authorizedByDids: [playerDid, charterAuthorityDid] as [string, string],
        authorizedAt: iso(1_000),
      },
    };
    const eligibility = canonicalDevelopmentEvent({
      version: 2,
      eventType: "DevelopmentPremierEligibilityRecorded",
      payload: eligibilityPayload,
      priorSnapshot: chartered.snapshot,
      previousEventHash: chartered.event.eventHash,
      timestamp: eligibilityPayload.command.authorizedAt,
    });
    const eligibilitySignerDids = expectedDevelopmentSignerDids(
      "DevelopmentPremierEligibilityRecorded",
      eligibilityPayload,
      signerAuthority,
    );
    const eligibilityRequest = await command(
      eligibility.event,
      eligibilitySignerDids,
      signers,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/development/premier-eligibility",
          payload: eligibilityRequest,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await store.pendingProjectionEvents(10, "public.development")).map(
        ({ aggregateVersion }) => aggregateVersion,
      ),
    ).toEqual([1n, 2n]);

    const unsigned = await app.inject({
      method: "POST",
      url: "/v1/development/premier-eligibility",
      payload: { ...eligibilityRequest, signatures: [] },
    });
    expect(unsigned.statusCode).toBe(400);
    const substituted = await app.inject({
      method: "POST",
      url: "/v1/development/premier-eligibility",
      payload: {
        ...eligibilityRequest,
        signatures: [
          eligibilityRequest.signatures[1],
          eligibilityRequest.signatures[0],
        ],
      },
    });
    expect(substituted.statusCode).toBe(403);

    async function submitMobility(input: {
      version: number;
      eventType: DevelopmentWorkflowEventType;
      path: string;
      payload: DevelopmentWorkflowPayload;
      priorSnapshot: DevelopmentWorkflowSnapshot;
      previousEventHash: `0x${string}`;
      timestamp: string;
    }) {
      now.value = Date.parse(input.timestamp);
      const built = canonicalDevelopmentEvent({
        version: input.version,
        eventType: input.eventType,
        payload: input.payload,
        priorSnapshot: input.priorSnapshot,
        previousEventHash: input.previousEventHash,
        timestamp: input.timestamp,
      });
      const signerDids = expectedDevelopmentSignerDids(
        input.eventType,
        input.payload,
        signerAuthority,
      );
      const request = await command(built.event, signerDids, signers);
      const response = await app.inject({
        method: "POST",
        url: input.path,
        payload: request,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        aggregateVersion: String(input.version),
        playingRightsMutation: false,
      });
      return { ...built, request };
    }

    const candidate = {
      playerDid,
      completedDevelopmentGames: 9,
      combineBps: 6_000,
      optedIn: true,
      goodStanding: true,
      currentContractStatus: "EXPIRED" as const,
      registeredAt: iso(500),
    };
    const callUpPayload = {
      command: {
        decisionId: uuid(21),
        kind: "CALL_UP" as const,
        candidate,
        premierClubId: "premier-club-1",
        premierRosterVacancyCommitment: digest("core-premier-vacancy"),
        days: 30,
        authorizedByDids: [
          playerDid,
          premierClubGovernors["premier-club-1"],
          charterAuthorityDid,
        ] as [string, string, string],
        authorizedAt: iso(2_000),
      },
    };
    const callUp = await submitMobility({
      version: 3,
      eventType: "DevelopmentCallUpAuthorized",
      path: "/v1/development/call-ups",
      payload: callUpPayload,
      priorSnapshot: eligibility.snapshot,
      previousEventHash: eligibility.event.eventHash,
      timestamp: callUpPayload.command.authorizedAt,
    });

    const developmentClub = charterCommand.clubs[0]!;
    const replacementPayload = {
      command: {
        decisionId: uuid(22),
        kind: "REPLACEMENT_CONTRACT" as const,
        playerDid,
        developmentClubId: developmentClub.clubId,
        developmentGovernorDid: developmentClub.governorDid,
        injuryVacancyCommitment: digest("core-injury-vacancy"),
        seasons: 1,
        authorizedByDids: [
          playerDid,
          developmentClub.governorDid,
          charterAuthorityDid,
        ] as [string, string, string],
        authorizedAt: iso(3_000),
      },
    };
    const replacement = await submitMobility({
      version: 4,
      eventType: "DevelopmentReplacementAuthorized",
      path: "/v1/development/replacements",
      payload: replacementPayload,
      priorSnapshot: callUp.snapshot,
      previousEventHash: callUp.event.eventHash,
      timestamp: replacementPayload.command.authorizedAt,
    });

    const freeAgencyPayload = {
      command: {
        decisionId: uuid(23),
        kind: "FREE_AGENCY" as const,
        candidate,
        windowOpenedAt: iso(0),
        authorizedByDids: [playerDid, charterAuthorityDid] as [string, string],
        authorizedAt: iso(4_000),
      },
    };
    const freeAgency = await submitMobility({
      version: 5,
      eventType: "DevelopmentFreeAgencyAuthorized",
      path: "/v1/development/free-agency",
      payload: freeAgencyPayload,
      priorSnapshot: replacement.snapshot,
      previousEventHash: replacement.event.eventHash,
      timestamp: freeAgencyPayload.command.authorizedAt,
    });

    const tradePayload = {
      command: {
        decisionId: uuid(24),
        kind: "CROSS_TIER_TRADE" as const,
        playerDid,
        developmentClubId: developmentClub.clubId,
        developmentGovernorDid: developmentClub.governorDid,
        premierClubId: "premier-club-1",
        premierTierCba,
        tradeTermsCommitment: digest("core-cross-tier-trade"),
        authorizedByDids: [
          playerDid,
          developmentClub.governorDid,
          premierClubGovernors["premier-club-1"],
          charterAuthorityDid,
        ] as [string, string, string, string],
        authorizedAt: iso(5_000),
      },
    };
    const trade = await submitMobility({
      version: 6,
      eventType: "DevelopmentCrossTierTradeAuthorized",
      path: "/v1/development/trades",
      payload: tradePayload,
      priorSnapshot: freeAgency.snapshot,
      previousEventHash: freeAgency.event.eventHash,
      timestamp: tradePayload.command.authorizedAt,
    });
    expect(
      (await store.pendingProjectionEvents(10, "public.development")).map(
        ({ aggregateVersion }) => aggregateVersion,
      ),
    ).toEqual([1n, 2n, 3n, 4n, 5n, 6n]);
    await app.close();

    const restarted = createLiveCoreApi(options);
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/v1/development/trades",
          payload: trade.request,
        })
      ).statusCode,
    ).toBe(200);
    await restarted.close();
  });
});
