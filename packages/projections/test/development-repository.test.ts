import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
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

import {
  FilePublicDevelopmentProjectionRepository,
  FilePublicProjectionRepository,
  PublicProjectionWorker,
  verifyDevelopmentProjectionEvent,
  type DevelopmentProjectionEventEnvelope,
  type DevelopmentProjectionRecord,
  type DevelopmentProjectionVerificationAuthority,
} from "../src/index.js";

const start = Date.parse("2026-08-13T09:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);
const uuid = (sequence: number) =>
  `0198f800-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
const conferenceId = "development-conference-1";
const competitionId = "abl-rehearsal";
const seasonId = "season-zero";
const charterAuthorityDid = "did:abl:development-charter-authority";
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
  const formationEvidence = createDevelopmentFormationEvidence({
    evidenceId: uuid(1),
    conferenceId,
    evidenceClass: "LOCAL_REHEARSAL",
    refereeCapacityCommitment: digest("projection-referee-capacity"),
    replayCapacityCommitment: digest("projection-replay-capacity"),
    refereeAuthorityDid: "did:abl:development-referee-capacity",
    replayAuthorityDid: "did:abl:development-replay-capacity",
    prepaidCompetitionEnvelopeCommitment: digest("projection-envelope"),
    blaxelQuotaReservationCommitment: digest("projection-quota"),
    resourceAuthorityDid: "did:abl:development-resource-capacity",
    rehearsalCommitments: {
      game: digest("projection-game-rehearsal"),
      memory: digest("projection-memory-rehearsal"),
      government: digest("projection-government-rehearsal"),
      safety: digest("projection-safety-rehearsal"),
    },
    rehearsalAuthorityDid: "did:abl:development-rehearsal-office",
    livePlatformEvidenceVerified: false,
  });
  const tierCba = {
    proposalId: uuid(2),
    closeEventId: uuid(3),
    executableChangeDigest: developmentTierCbaExecutableDigest({
      conferenceId,
      mobilityPolicyCommitment: SEASON_ZERO_MOBILITY_POLICY.policyCommitment,
    }),
  };
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
      formationEvidence.refereeAuthorityDid,
      formationEvidence.replayAuthorityDid,
      formationEvidence.resourceAuthorityDid,
      formationEvidence.rehearsalAuthorityDid,
    ],
    charteredAt: iso(0),
  };
}

function identities(dids: readonly string[]) {
  return new Map<string, SigningIdentity>(
    dids.map((did, index) => [
      did,
      createSigningIdentity(
        `0x${(index + 101).toString(16).padStart(64, "0")}` as `0x${string}`,
      ),
    ]),
  );
}

function buildEvent(input: {
  version: number;
  eventType: DevelopmentWorkflowEventType;
  payload: DevelopmentWorkflowPayload;
  priorSnapshot: DevelopmentWorkflowSnapshot | null;
  previousEventHash: `0x${string}` | null;
  timestamp: string;
}) {
  const actorDid = input.payload.command.authorizedByDids[0]!;
  const transitionEvent = {
    actorDid,
    aggregateId: conferenceId,
    aggregateVersion: BigInt(input.version),
    eventType: input.eventType,
    timestamp: input.timestamp,
  };
  const snapshot = applyDevelopmentWorkflowTransition(
    input.priorSnapshot,
    transitionEvent,
    input.payload,
  );
  const event = createCanonicalEvent({
    eventId: uuid(100 + input.version * 2),
    actorDid,
    nonce: `development-projection-${input.version}`,
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

async function envelope(
  event: CanonicalEvent,
  signerDids: readonly string[],
  signers: ReadonlyMap<string, SigningIdentity>,
): Promise<DevelopmentProjectionEventEnvelope> {
  return {
    version: "1.0.0",
    topic: "public.development",
    event: {
      ...event,
      aggregateType: DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
      aggregateVersion: event.aggregateVersion.toString(),
      eventType: event.eventType as DevelopmentWorkflowEventType,
      schemaDigest: DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
    },
    signatures: await Promise.all(
      signerDids.map((did) =>
        signCanonicalEvent(signers.get(did)!, domain, event),
      ),
    ),
  };
}

async function append(
  store: InMemoryCanonicalStore,
  event: CanonicalEvent,
  signatures: readonly string[],
) {
  await store.append({
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: digest({ eventHash: event.eventHash, signatures }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: event.aggregateVersion - 1n,
    competitionId,
    seasonId,
    eventType: event.eventType,
    previousEventHash: event.previousEventHash,
    eventHash: event.eventHash,
    payloadSchemaDigest: event.schemaDigest,
    payloadCommitment: event.payloadCommitment,
    payload: event.payload,
    stateRoot: event.stateRoot,
    signatures,
    occurredAt: new Date(event.timestamp),
    outboxTopic: "public.development",
  });
}

describe("durable development conference projections", () => {
  it("independently verifies, projects, restarts, and detects tampering", async () => {
    const charterCommand = charter();
    const premierTierCba = {
      proposalId: uuid(30),
      closeEventId: uuid(31),
      executableChangeDigest: digest("projection-premier-tier-cba"),
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
    const authority: DevelopmentProjectionVerificationAuthority = {
      domain,
      admittedAgents: new Map(
        [...signers].map(([did, identity]) => [
          did,
          {
            signerAddress: identity.address,
            allowedAggregateTypes: [DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE],
          },
        ]),
      ),
      conferenceId,
      competitionId,
      seasonId,
      charterAuthorityDid,
      premierClubGovernors,
      tierCbaRatification: { resourceScheduleRatification },
    };
    const chartered = buildEvent({
      version: 1,
      eventType: "DevelopmentConferenceChartered",
      payload: charterPayload,
      priorSnapshot: null,
      previousEventHash: null,
      timestamp: charterCommand.charteredAt,
    });
    const charterEnvelope = await envelope(
      chartered.event,
      charterSignerDids,
      signers,
    );
    await expect(
      verifyDevelopmentProjectionEvent(charterEnvelope, authority),
    ).resolves.toMatchObject({ expectedVersion: "0" });

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
        eligibilityEvidenceCommitment: digest("projection-eligibility"),
        authorizedByDids: [playerDid, charterAuthorityDid] as [string, string],
        authorizedAt: iso(1_000),
      },
    };
    const eligibility = buildEvent({
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
    const eligibilityEnvelope = await envelope(
      eligibility.event,
      eligibilitySignerDids,
      signers,
    );

    async function buildEnvelope(input: {
      version: number;
      eventType: DevelopmentWorkflowEventType;
      payload: DevelopmentWorkflowPayload;
      priorSnapshot: DevelopmentWorkflowSnapshot;
      previousEventHash: `0x${string}`;
      timestamp: string;
    }) {
      const built = buildEvent(input);
      const signerDids = expectedDevelopmentSignerDids(
        input.eventType,
        input.payload,
        signerAuthority,
      );
      return {
        ...built,
        envelope: await envelope(built.event, signerDids, signers),
      };
    }

    const candidate = eligibilityPayload.command.candidate;
    const callUpPayload = {
      command: {
        decisionId: uuid(21),
        kind: "CALL_UP" as const,
        candidate,
        premierClubId: "premier-club-1",
        premierRosterVacancyCommitment: digest("projection-premier-vacancy"),
        days: 30,
        authorizedByDids: [
          playerDid,
          premierClubGovernors["premier-club-1"],
          charterAuthorityDid,
        ] as [string, string, string],
        authorizedAt: iso(2_000),
      },
    };
    const callUp = await buildEnvelope({
      version: 3,
      eventType: "DevelopmentCallUpAuthorized",
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
        injuryVacancyCommitment: digest("projection-injury-vacancy"),
        seasons: 1,
        authorizedByDids: [
          playerDid,
          developmentClub.governorDid,
          charterAuthorityDid,
        ] as [string, string, string],
        authorizedAt: iso(3_000),
      },
    };
    const replacement = await buildEnvelope({
      version: 4,
      eventType: "DevelopmentReplacementAuthorized",
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
        windowOpenedAt: charterCommand.charteredAt,
        authorizedByDids: [playerDid, charterAuthorityDid] as [string, string],
        authorizedAt: iso(4_000),
      },
    };
    const freeAgency = await buildEnvelope({
      version: 5,
      eventType: "DevelopmentFreeAgencyAuthorized",
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
        tradeTermsCommitment: digest("projection-cross-tier-trade"),
        authorizedByDids: [
          playerDid,
          developmentClub.governorDid,
          premierClubGovernors["premier-club-1"],
          charterAuthorityDid,
        ] as [string, string, string, string],
        authorizedAt: iso(5_000),
      },
    };
    const trade = await buildEnvelope({
      version: 6,
      eventType: "DevelopmentCrossTierTradeAuthorized",
      payload: tradePayload,
      priorSnapshot: freeAgency.snapshot,
      previousEventHash: freeAgency.event.eventHash,
      timestamp: tradePayload.command.authorizedAt,
    });

    const root = await mkdtemp(join(tmpdir(), "abl-development-projection-"));
    const store = new InMemoryCanonicalStore();
    await append(store, chartered.event, charterEnvelope.signatures);
    await append(store, eligibility.event, eligibilityEnvelope.signatures);
    for (const item of [callUp, replacement, freeAgency, trade])
      await append(store, item.event, item.envelope.signatures);
    const development = new FilePublicDevelopmentProjectionRepository(root, {
      verifyAuthorization: (authorization) =>
        verifyDevelopmentProjectionEvent(authorization, authority),
      now: () => new Date(iso(2_000)),
    });
    const possession = new FilePublicProjectionRepository(root);
    await Promise.all([development.initialize(), possession.initialize()]);
    const worker = new PublicProjectionWorker({
      store,
      writer: possession,
      developmentWriter: development,
      domain,
      admittedAgents: authority.admittedAgents,
      developmentAuthority: {
        conferenceId,
        competitionId,
        seasonId,
        charterAuthorityDid,
        premierClubGovernors,
        tierCbaRatification: authority.tierCbaRatification,
      },
      now: () => new Date(iso(2_000)),
    });
    expect(await worker.drain()).toBe(6);
    expect(development.conferences()).toMatchObject([
      {
        conferenceId,
        aggregateVersion: "6",
        conference: { schedule: { length: 36 }, playoffs: { length: 3 } },
        mobilityDecisions: [
          {
            kind: "PREMIER_ELIGIBILITY",
            result: { eligible: true, automaticPromotion: false },
            playingRightsMutation: false,
          },
          {
            kind: "CALL_UP",
            result: { days: 30, preservesDevelopmentRights: true },
            playingRightsMutation: false,
          },
          {
            kind: "REPLACEMENT_CONTRACT",
            result: { seasons: 1, replacement: true },
            playingRightsMutation: false,
          },
          {
            kind: "FREE_AGENCY",
            result: { eligible: true, restrictions: [] },
            playingRightsMutation: false,
          },
          {
            kind: "CROSS_TIER_TRADE",
            result: { permitted: true },
            playingRightsMutation: false,
          },
        ],
      },
    ]);

    const restarted = new FilePublicDevelopmentProjectionRepository(root, {
      verifyAuthorization: (authorization) =>
        verifyDevelopmentProjectionEvent(authorization, authority),
    });
    await restarted.initialize();
    expect(restarted.conferences()).toEqual(development.conferences());

    const path = join(root, "development-records", "000000000001.json");
    const tampered = JSON.parse(
      await readFile(path, "utf8"),
    ) as DevelopmentProjectionRecord;
    tampered.projection.mobilityDecisions[0]!.result = { eligible: false };
    const { recordHash: _recordHash, ...withoutHash } = tampered;
    tampered.recordHash = digest(withoutHash);
    await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(
      new FilePublicDevelopmentProjectionRepository(root, {
        verifyAuthorization: (authorization) =>
          verifyDevelopmentProjectionEvent(authorization, authority),
      }).initialize(),
    ).rejects.toThrow("does not match its authorization");
  }, 15_000);
});
