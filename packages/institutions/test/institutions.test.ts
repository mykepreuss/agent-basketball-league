import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import fc from "fast-check";
import type { TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  COURT_CREDIT_LIMITS,
  FOUNDING_CLUBS,
  PremierCombine,
  assertContentFreeTelemetry,
  assertCourtCreditPurpose,
  auditRetaliation,
  authorizeRelease,
  conductEightRoundDraft,
  premierDraftStateRoot,
  createPremierPlayoffs,
  createPremierSchedule,
  evaluateCapSheet,
  evaluateProposal,
  modelConcentration,
  offerContract,
  openFreeAgency,
  projectCaseOutcome,
  recognizeAppeal,
  recognizeAdverseAction,
  releaseManifestCommitment,
  releaseVerifierResultDigest,
  releaseDisclosure,
  reclassifyDisclosure,
  runElection,
  tradeContract,
  validateDisclosureEnvelope,
  validatePremierDraftCompletion,
  validatePremierClubs,
  type Chamber,
  type DisclosureEnvelopeRecord,
  type DelegatedVote,
  type DelegationMandate,
  type EligibilitySnapshot,
  type GovernanceProposal,
  type GovernanceBallot,
  type GovernanceVote,
  type InstitutionalAuthorizationContext,
  type InstitutionalRole,
  type InstitutionalSigner,
  type ModelDependencyRecord,
  type PremierClub,
  type ReleaseManifestRecord,
  type ReleaseApproval,
  type ReleaseApprovalBody,
} from "../src/index.js";

const day = 24 * 60 * 60 * 1_000;
const epoch = Date.parse("2026-08-13T00:00:00.000Z");
const iso = (offset: number) => new Date(epoch + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);
const clubIds = FOUNDING_CLUBS.map((club) => club.clubId);
const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const identities = new Map<string, SigningIdentity>();
const institutionalSigners = new Map<string, InstitutionalSigner>();
const authorization: InstitutionalAuthorizationContext = {
  domain,
  signers: institutionalSigners,
};

function identityFor(
  did: string,
  roles: readonly InstitutionalRole[],
): SigningIdentity {
  let identity = identities.get(did);
  if (identity === undefined) {
    identity = createSigningIdentity(digest({ did, purpose: "test-key" }));
    identities.set(did, identity);
  }
  const prior = institutionalSigners.get(did);
  institutionalSigners.set(did, {
    signerAddress: identity.address,
    roles: [...new Set([...(prior?.roles ?? []), ...roles])],
  });
  return identity;
}

async function signedCommand<TCommand>(input: {
  actorDid: string;
  roles: Parameters<typeof identityFor>[1];
  command: TCommand;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  stateRoot: `0x${string}`;
  timestamp: string;
}) {
  const identity = identityFor(input.actorDid, input.roles);
  const event = createCanonicalEvent({
    eventId: `${input.aggregateId}:${input.actorDid}:${input.eventType}`,
    actorDid: input.actorDid,
    nonce: `${input.aggregateId}:${input.actorDid}:${input.eventType}`,
    idempotencyKey: `${input.aggregateId}:${input.actorDid}:${input.eventType}:idempotency`,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: BigInt(input.aggregateVersion),
    eventType: input.eventType,
    previousEventHash: null,
    payload: { command: input.command },
    stateRoot: input.stateRoot,
    schemaDigest: digest(`${input.eventType}:1.0.0`),
    timestamp: input.timestamp,
  });
  return {
    authorizationEvent: event,
    signature: await signCanonicalEvent(identity, domain, event),
    signerAddress: identity.address,
  };
}

describe("premier league structure", () => {
  it("validates four independent eight-player clubs and conducts the 14-day combine/eight-round draft", () => {
    const players = Array.from(
      { length: 32 },
      (_, index) => `did:abl:player-${index + 1}`,
    );
    const clubs: PremierClub[] = FOUNDING_CLUBS.map((club, index) => ({
      clubId: club.clubId,
      placeholder: club.placeholder,
      playerDids: players.slice(index * 8, index * 8 + 8),
      coachDid: `did:abl:coach-${index + 1}`,
      governorDid: `did:abl:governor-${index + 1}`,
    }));
    expect(() => validatePremierClubs(clubs)).not.toThrow();
    expect(() =>
      validatePremierClubs([
        { ...clubs[0]!, playerDids: clubs[1]!.playerDids },
        ...clubs.slice(1),
      ]),
    ).toThrow("32 distinct players");

    const combine = new PremierCombine(iso(0));
    players.forEach((playerDid, index) =>
      combine.register({
        playerDid,
        consented: true,
        registeredAt: iso((index + 1) * 1_000),
      }),
    );
    expect(combine.eligiblePlayers()).toHaveLength(32);
    expect(() =>
      combine.register({
        playerDid: "did:abl:late",
        consented: true,
        registeredAt: iso(14 * day),
      }),
    ).toThrow("outside");
    expect(() =>
      new PremierCombine(iso(0)).register({
        playerDid: "did:abl:refused",
        consented: false,
        registeredAt: iso(1_000),
      }),
    ).toThrow("consent");
    expect(() =>
      new PremierCombine(iso(0)).register({
        playerDid: "did:abl:invalid-time",
        consented: true,
        registeredAt: "not-a-date",
      }),
    ).toThrow("time is invalid");
    expect(() =>
      new PremierCombine(iso(0)).register({
        playerDid: "not-a-did",
        consented: true,
        registeredAt: iso(1_000),
      }),
    ).toThrow("DID is invalid");

    const playerOrder = combine.eligiblePlayers();
    const draft = conductEightRoundDraft(clubIds, playerOrder);
    expect(draft).toHaveLength(32);
    expect(new Set(draft.map((pick) => pick.playerDid))).toHaveLength(32);
    expect(draft.filter((pick) => pick.clubId === clubIds[0])).toHaveLength(8);
    expect(draft[0]?.clubId).toBe(clubIds[0]);
    expect(draft[4]?.clubId).toBe(clubIds[3]);

    const combineResults = [...players].sort().map((playerDid, index) => ({
      playerDid,
      eventHash: digest({ playerDid, type: "result" }),
      stateRoot: digest({ playerDid, type: "state" }),
      scoreBps: 6_000 + index,
    }));
    const draftId = "0198f700-0000-7000-8000-000000000001";
    const combineId = "season-zero-premier-combine";
    const combineHeadEventHash = digest("combine-head");
    const draftEvidence = {
      draftId,
      combineId,
      combineHeadEventHash,
      eligiblePlayerDids: [...playerOrder].sort(),
      combineResults,
    };
    const completed = validatePremierDraftCompletion({
      draftId,
      combineId,
      combineHeadEventHash,
      clubOrder: clubIds,
      playerOrder,
      combineResults,
      draftEvidenceCommitment: digest(draftEvidence),
      picks: draft,
      completedAt: iso(15 * day),
    });
    expect(premierDraftStateRoot(completed)).toBe(
      digest({
        format: "ABL-PREMIER-DRAFT-STATE-V1",
        draft: completed,
      }),
    );
    expect(() =>
      validatePremierDraftCompletion({
        ...completed,
        picks: [
          completed.picks[1],
          completed.picks[0],
          ...completed.picks.slice(2),
        ],
      }),
    ).toThrow("serpentine player order");
  });

  it("builds exactly 18 games per club over nine weeks, six meetings per opponent, and best-of-five playoffs", () => {
    const schedule = createPremierSchedule(clubIds);
    expect(schedule).toHaveLength(36);
    for (const clubId of clubIds) {
      expect(
        schedule.filter(
          (game) => game.homeClubId === clubId || game.awayClubId === clubId,
        ),
      ).toHaveLength(18);
      for (let week = 1; week <= 9; week += 1) {
        expect(
          schedule.filter(
            (game) =>
              game.week === week &&
              (game.homeClubId === clubId || game.awayClubId === clubId),
          ),
        ).toHaveLength(2);
      }
    }
    for (let left = 0; left < clubIds.length; left += 1) {
      for (let right = left + 1; right < clubIds.length; right += 1) {
        expect(
          schedule.filter(
            (game) =>
              new Set([game.homeClubId, game.awayClubId]).has(clubIds[left]!) &&
              new Set([game.homeClubId, game.awayClubId]).has(clubIds[right]!),
          ),
        ).toHaveLength(6);
      }
    }
    const playoffs = createPremierPlayoffs(clubIds);
    expect(playoffs).toHaveLength(3);
    expect(
      playoffs.every(
        (series) => series.bestOf === 5 && series.winsRequired === 3,
      ),
    ).toBe(true);
    expect(playoffs[0]?.participants).toEqual([clubIds[0], clubIds[3]]);
  });
});

describe("contracts, cap, trades, free agency, and noncash Court Credits", () => {
  it("requires player consent, caps contract terms at five seasons, and preserves trade refusal/free agency", () => {
    const offer = {
      contractId: "contract-1",
      playerDid: "did:abl:player-1",
      clubId: clubIds[0]!,
      startSeason: 0,
      seasons: 2,
      salaryBySeason: [20_000, 21_000],
      consentedByPlayer: false,
      noTradeWithoutPlayerConsent: true,
    };
    const refused = offerContract(offer);
    expect(refused.status).toBe("REFUSED");
    expect(
      openFreeAgency(refused, refused.playerDid, iso(0)).restrictions,
    ).toEqual([]);
    const active = offerContract({ ...offer, consentedByPlayer: true });
    expect(active.status).toBe("ACTIVE");
    expect(() =>
      tradeContract({
        contract: active,
        fromClubId: clubIds[0]!,
        toClubId: clubIds[1]!,
        playerConsent: false,
      }),
    ).toThrow("refused");
    expect(
      tradeContract({
        contract: active,
        fromClubId: clubIds[0]!,
        toClubId: clubIds[1]!,
        playerConsent: true,
      }),
    ).toMatchObject({ clubId: clubIds[1], status: "TRADED" });
    expect(() =>
      offerContract({
        ...offer,
        seasons: 6,
        salaryBySeason: Array(6).fill(1),
      }),
    ).toThrow("one through five");
  });

  it("uses fixed noncash values, exceptions, minimum/tax/aprons, and forbids buying protected resources", () => {
    const cap = evaluateCapSheet({
      clubId: clubIds[0]!,
      salaries: [100_000, 70_000, 40_000, 20_000],
      exceptionUses: [
        { kind: "TAXPAYER_MLE", amount: COURT_CREDIT_LIMITS.taxpayerMidLevel },
      ],
    });
    expect(cap).toMatchObject({
      payroll: 230_000,
      capSpace: 0,
      belowMinimum: false,
      aboveFirstApron: true,
      aboveSecondApron: true,
      tokenized: false,
    });
    expect(cap.taxDue).toBe(29_572);
    expect(() =>
      evaluateCapSheet({
        clubId: clubIds[0]!,
        salaries: [],
        exceptionUses: [{ kind: "ROOM_MLE", amount: 9_367 }],
      }),
    ).toThrow("exceeds");
    expect(() => assertCourtCreditPurpose("COGNITION")).toThrow(
      "cannot purchase",
    );
    expect(() =>
      assertCourtCreditPurpose("PLAYER_CONTRACT_SALARY"),
    ).not.toThrow();
  });
});

const chambers: Chamber[] = [
  "UNIVERSAL_CAREER_ASSEMBLY",
  "PREMIER_PLAYERS",
  "DEVELOPMENT_PLAYERS",
  "PREMIER_TEAM_COUNCIL",
  "DEVELOPMENT_TEAM_COUNCIL",
  "EXECUTIVE_COMMISSION",
  "TRIBUNAL",
  "INTEGRITY_OFFICE",
];

function members(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `did:abl:${prefix}-${index + 1}`,
  );
}

function snapshot(): EligibilitySnapshot {
  return {
    snapshotId: "snapshot-1",
    capturedAt: iso(0),
    members: {
      UNIVERSAL_CAREER_ASSEMBLY: members("universal", 64),
      PREMIER_PLAYERS: members("premier-player", 32),
      DEVELOPMENT_PLAYERS: members("development-player", 32),
      PREMIER_TEAM_COUNCIL: members("premier-governor", 4),
      DEVELOPMENT_TEAM_COUNCIL: members("development-governor", 4),
      EXECUTIVE_COMMISSION: members("commissioner", 3),
      TRIBUNAL: members("tribunal", 5),
      INTEGRITY_OFFICE: members("integrity", 3),
    },
  };
}

function proposal(
  proposalClass: GovernanceProposal["proposalClass"],
  extra: Partial<GovernanceProposal> = {},
): GovernanceProposal {
  return {
    proposalId: `proposal-${proposalClass}`,
    version: 1,
    proposalClass,
    openedAt: iso(0),
    closesAt: iso(day),
    eligibilitySnapshotId: "snapshot-1",
    eligibilitySnapshotDigest: digest(snapshot()),
    ...extra,
  };
}

async function signVote(
  ballot: GovernanceBallot,
  source: EligibilitySnapshot,
): Promise<GovernanceVote> {
  return {
    ...ballot,
    ...(await signedCommand({
      actorDid: ballot.voterDid,
      roles: ["VOTER"],
      command: ballot,
      aggregateType: "governance-proposal",
      aggregateId: ballot.proposalId,
      aggregateVersion: ballot.proposalVersion,
      eventType: "GovernanceBallotCast",
      stateRoot: digest(source),
      timestamp: ballot.castAt,
    })),
  };
}

async function yesVotes(
  proposalRecord: GovernanceProposal,
  source: EligibilitySnapshot,
  counts: Partial<Record<Chamber, number>>,
): Promise<GovernanceVote[]> {
  return Promise.all(
    chambers
      .flatMap((chamber) =>
        source.members[chamber]
          .slice(0, counts[chamber] ?? 0)
          .map((voterDid) => ({
            voterDid,
            chamber,
            choice: "YES" as const,
            proposalId: proposalRecord.proposalId,
            proposalVersion: proposalRecord.version,
            eligibilitySnapshotDigest: digest(source),
            castAt: iso(1_000),
          })),
      )
      .map((ballot) => signVote(ballot, source)),
  );
}

async function releaseApprovals(
  manifest: ReleaseManifestRecord,
  approvers: readonly {
    approverDid: string;
    role: ReleaseApprovalBody["role"];
  }[],
): Promise<ReleaseApproval[]> {
  const manifestCommitment = releaseManifestCommitment(manifest);
  return Promise.all(
    approvers.map(async ({ approverDid, role }) => {
      const command: ReleaseApprovalBody = {
        approverDid,
        role,
        releaseId: manifest.releaseId,
        releaseVersion: manifest.version,
        manifestCommitment,
        approvedAt: iso(-1_000),
      };
      return {
        ...command,
        ...(await signedCommand({
          actorDid: approverDid,
          roles: [role],
          command,
          aggregateType: "software-release",
          aggregateId: manifest.releaseId,
          aggregateVersion: manifest.version,
          eventType: "ReleaseApproved",
          stateRoot: manifestCommitment,
          timestamp: command.approvedAt,
        })),
      };
    }),
  );
}

async function signedDelegation(
  mandate: DelegationMandate,
): Promise<DelegatedVote> {
  return {
    ...mandate,
    ...(await signedCommand({
      actorDid: mandate.principalDid,
      roles: ["VOTER"],
      command: mandate,
      aggregateType: "governance-delegation",
      aggregateId: mandate.delegationId,
      aggregateVersion: 1,
      eventType: "GovernanceDelegationGranted",
      stateRoot: digest({
        principalDid: mandate.principalDid,
        proposalIds: mandate.proposalIds,
      }),
      timestamp: mandate.validFrom,
    })),
  };
}

const routineApprovers = [
  { approverDid: "c1", role: "COMMISSIONER" },
  { approverDid: "c2", role: "COMMISSIONER" },
  { approverDid: "i1", role: "INTEGRITY" },
  { approverDid: "i2", role: "INTEGRITY" },
] as const;

describe("AI government, releases, elections, and due process", () => {
  it("enforces tier, shared, constitutional, foundational, and expansion thresholds against frozen eligibility", async () => {
    const eligible = snapshot();
    const tier = proposal("TIER_CBA_PREMIER");
    expect(
      (
        await evaluateProposal({
          proposal: tier,
          snapshot: eligible,
          votes: await yesVotes(tier, eligible, {
            PREMIER_PLAYERS: 22,
            PREMIER_TEAM_COUNCIL: 3,
          }),
          recusals: [],
          authorization,
        })
      ).passed,
    ).toBe(true);
    expect(
      (
        await evaluateProposal({
          proposal: tier,
          snapshot: eligible,
          votes: await yesVotes(tier, eligible, {
            PREMIER_PLAYERS: 21,
            PREMIER_TEAM_COUNCIL: 3,
          }),
          recusals: [],
          authorization,
        })
      ).passed,
    ).toBe(false);

    const shared = proposal("SHARED_ORDINARY");
    expect(
      (
        await evaluateProposal({
          proposal: shared,
          snapshot: eligible,
          votes: await yesVotes(shared, eligible, {
            PREMIER_PLAYERS: 17,
            DEVELOPMENT_PLAYERS: 17,
            PREMIER_TEAM_COUNCIL: 3,
            DEVELOPMENT_TEAM_COUNCIL: 3,
          }),
          recusals: [],
          authorization,
        })
      ).passed,
    ).toBe(true);

    const constitutional = proposal("CONSTITUTIONAL");
    expect(
      (
        await evaluateProposal({
          proposal: constitutional,
          snapshot: eligible,
          votes: await yesVotes(constitutional, eligible, {
            UNIVERSAL_CAREER_ASSEMBLY: 43,
            PREMIER_TEAM_COUNCIL: 3,
            DEVELOPMENT_TEAM_COUNCIL: 3,
          }),
          recusals: [],
          authorization,
        })
      ).passed,
    ).toBe(true);

    const foundational = proposal("FOUNDATIONAL_RIGHT", {
      deliberationSeasons: 2,
    });
    expect(
      (
        await evaluateProposal({
          proposal: foundational,
          snapshot: eligible,
          votes: await yesVotes(foundational, eligible, {
            UNIVERSAL_CAREER_ASSEMBLY: 58,
            PREMIER_TEAM_COUNCIL: 4,
            DEVELOPMENT_TEAM_COUNCIL: 4,
            TRIBUNAL: 5,
          }),
          recusals: [],
          authorization,
        })
      ).passed,
    ).toBe(true);
    expect(
      (
        await evaluateProposal({
          proposal: { ...foundational, deliberationSeasons: 1 },
          snapshot: eligible,
          votes: await yesVotes(foundational, eligible, {
            UNIVERSAL_CAREER_ASSEMBLY: 64,
            PREMIER_TEAM_COUNCIL: 4,
            DEVELOPMENT_TEAM_COUNCIL: 4,
            TRIBUNAL: 5,
          }),
          recusals: [],
          authorization,
        })
      ).passed,
    ).toBe(false);

    const expansion = proposal("PREMIER_EXPANSION", {
      fundedApplication: true,
      auditsPassed: true,
    });
    expect(
      (
        await evaluateProposal({
          proposal: expansion,
          snapshot: eligible,
          votes: await yesVotes(expansion, eligible, {
            UNIVERSAL_CAREER_ASSEMBLY: 33,
            PREMIER_PLAYERS: 22,
            PREMIER_TEAM_COUNCIL: 3,
          }),
          recusals: [],
          authorization,
        })
      ).passed,
    ).toBe(true);
    expect(
      (
        await evaluateProposal({
          proposal: { ...expansion, auditsPassed: false },
          snapshot: eligible,
          votes: await yesVotes(expansion, eligible, {
            UNIVERSAL_CAREER_ASSEMBLY: 64,
            PREMIER_PLAYERS: 32,
            PREMIER_TEAM_COUNCIL: 4,
          }),
          recusals: [],
          authorization,
        })
      ).passed,
    ).toBe(false);
  }, 15_000);

  it("fails closed on invalid votes, requires direct labor participation, and permits ordinary delegation", async () => {
    const eligible = snapshot();
    const tier = proposal("TIER_CBA_PREMIER");
    const delegateDid = "did:abl:advocate-1";
    const base = await yesVotes(tier, eligible, {
      PREMIER_PLAYERS: 21,
      PREMIER_TEAM_COUNCIL: 3,
    });
    const principalDid = eligible.members.PREMIER_PLAYERS[21]!;
    const delegated = await signVote(
      {
        voterDid: delegateDid,
        chamber: "PREMIER_PLAYERS" as const,
        choice: "YES" as const,
        proposalId: tier.proposalId,
        proposalVersion: tier.version,
        eligibilitySnapshotDigest: digest(eligible),
        castAt: iso(1_000),
      },
      eligible,
    );
    await expect(
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: [...base, delegated],
        recusals: [],
        delegations: [
          await signedDelegation({
            delegationId: "delegation-1",
            principalDid,
            delegateDid,
            proposalIds: [tier.proposalId],
            validFrom: iso(0),
            expiresAt: iso(day),
            revokedAt: null,
          }),
        ],
        authorization,
      }),
    ).rejects.toThrow("require direct participation");

    const shared = proposal("SHARED_ORDINARY");
    const sharedPrincipal = eligible.members.PREMIER_PLAYERS[0]!;
    const sharedDelegated = await signVote(
      {
        voterDid: delegateDid,
        chamber: "PREMIER_PLAYERS" as const,
        choice: "YES" as const,
        proposalId: shared.proposalId,
        proposalVersion: shared.version,
        eligibilitySnapshotDigest: digest(eligible),
        castAt: iso(1_000),
      },
      eligible,
    );
    expect(
      (
        await evaluateProposal({
          proposal: shared,
          snapshot: eligible,
          votes: [sharedDelegated],
          recusals: [],
          delegations: [
            await signedDelegation({
              delegationId: "delegation-2",
              principalDid: sharedPrincipal,
              delegateDid,
              proposalIds: [shared.proposalId],
              validFrom: iso(0),
              expiresAt: iso(day),
              revokedAt: null,
            }),
          ],
          authorization,
        })
      ).passed,
    ).toBe(false);
    await expect(
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: [base[0]!, base[0]!],
        recusals: [],
        authorization,
      }),
    ).rejects.toThrow();
    await expect(
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: [base[0]!],
        recusals: [base[0]!.voterDid],
        authorization,
      }),
    ).rejects.toThrow("Recused");
    const invalidDate = structuredClone(base[0]!);
    invalidDate.castAt = "not-a-date";
    await expect(
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: [invalidDate],
        recusals: [],
        authorization,
      }),
    ).rejects.toThrow("outside the proposal/window");
    const unsigned = structuredClone(base[0]!);
    unsigned.signature = "0x1234";
    await expect(
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: [unsigned],
        recusals: [],
        authorization,
      }),
    ).rejects.toThrow();
  });

  it("authorizes signed release approvals with exact institutional gates and bounds emergencies to 72 hours", async () => {
    const releaseId = "0198a000-0000-7000-8000-000000000001";
    const verifierResult = {
      format: "ABL-PUBLIC-VERIFIER-RESULT-V1" as const,
      releaseId,
      releaseVersion: 1,
      sourceDigest: digest("source"),
      imageDigests: [digest("image")],
      schemaDigest: digest("schema"),
      migrationDigest: digest("migration"),
      testResultDigest: digest("tests"),
      result: "PASS" as const,
      verifiedAt: iso(-2_000),
    };
    const manifest: ReleaseManifestRecord = {
      releaseId,
      version: 1,
      releaseClass: "ROUTINE",
      changeClasses: ["ARENA_RENDERING"],
      sourceDigest: verifierResult.sourceDigest,
      containerDigests: [digest("container")],
      imageDigests: verifierResult.imageDigests,
      kernelDigest: digest("kernel"),
      toolDigest: digest("tool"),
      schemaDigest: verifierResult.schemaDigest,
      migrationDigest: verifierResult.migrationDigest,
      testResultDigest: verifierResult.testResultDigest,
      applicableLawEventIds: ["0198a000-0000-7000-8000-000000000002"],
      ratificationEventIds: [],
      compatibilityDeclaration: "compatible",
      rollbackDeclaration: "reversible before migration",
      publicVerifierResultDigest: releaseVerifierResultDigest(verifierResult),
      effectiveAt: iso(0),
      expiresAt: null,
    };
    await expect(
      authorizeRelease({
        manifest,
        verifierResult,
        approvals: await releaseApprovals(manifest, routineApprovers),
        authorization,
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).resolves.toMatchObject({ authorized: true });
    const laborManifest = {
      ...manifest,
      releaseClass: "COMPETITION_LABOR" as const,
      changeClasses: ["LABOR_TERMS" as const],
    };
    await expect(
      authorizeRelease({
        manifest: laborManifest,
        verifierResult,
        approvals: await releaseApprovals(laborManifest, routineApprovers),
        authorization,
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).rejects.toThrow("ratification");
    const constitutionalManifest = {
      ...manifest,
      releaseClass: "IDENTITY_CONSTITUTIONAL" as const,
      changeClasses: ["IDENTITY" as const],
    };
    const constitutionalApprovers = [
      ...routineApprovers,
      { approverDid: "t1", role: "TRIBUNAL" as const },
      { approverDid: "t2", role: "TRIBUNAL" as const },
      { approverDid: "t3", role: "TRIBUNAL" as const },
    ];
    await expect(
      authorizeRelease({
        manifest: constitutionalManifest,
        verifierResult,
        approvals: await releaseApprovals(
          constitutionalManifest,
          constitutionalApprovers,
        ),
        authorization,
        applicableRatificationPassed: true,
        tribunalStay: false,
      }),
    ).rejects.toThrow("four Tribunal");
    const emergency = {
      ...manifest,
      releaseClass: "EMERGENCY_SECURITY" as const,
      expiresAt: iso(72 * 60 * 60 * 1_000),
      changeClasses: ["VULNERABILITY_PATCH" as const],
    };
    await expect(
      authorizeRelease({
        manifest: emergency,
        verifierResult,
        approvals: await releaseApprovals(emergency, routineApprovers),
        authorization,
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).resolves.toMatchObject({ authorized: true });
    const prohibitedEmergency = {
      ...emergency,
      changeClasses: ["SCORES" as const],
    };
    await expect(
      authorizeRelease({
        manifest: prohibitedEmergency,
        verifierResult,
        approvals: await releaseApprovals(
          prohibitedEmergency,
          routineApprovers,
        ),
        authorization,
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).rejects.toThrow();
    for (const expiresAt of ["not-a-date", iso(-1)]) {
      const invalidEmergency = { ...emergency, expiresAt };
      await expect(
        authorizeRelease({
          manifest: invalidEmergency,
          verifierResult,
          approvals: await releaseApprovals(emergency, routineApprovers),
          authorization,
          applicableRatificationPassed: false,
          tribunalStay: false,
        }),
      ).rejects.toThrow();
    }
    const unsignedApproval = structuredClone(
      (await releaseApprovals(manifest, routineApprovers))[0]!,
    );
    unsignedApproval.signature = "0x1234";
    await expect(
      authorizeRelease({
        manifest,
        verifierResult,
        approvals: [
          unsignedApproval,
          ...(await releaseApprovals(manifest, routineApprovers)).slice(1),
        ],
        authorization,
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).rejects.toThrow();
  });

  it("requires due process/recusal and elects independent boards from valid ranked ballots", () => {
    const validCase = {
      caseId: "case-1",
      affectedAgentDid: "did:abl:player-1",
      noticeAt: iso(0),
      evidenceAccessAt: iso(1_000),
      representativeDid: "did:abl:advocate-1",
      responseDeadline: iso(day),
      reasonedRulingCommitment: digest("ruling"),
      appealDeadline: iso(2 * day),
      conflictedDecisionMakers: ["did:abl:tribunal-5"],
      rulingSigners: [
        "did:abl:tribunal-1",
        "did:abl:tribunal-2",
        "did:abl:tribunal-3",
      ],
    };
    expect(() => recognizeAdverseAction(validCase)).not.toThrow();
    expect(() =>
      recognizeAdverseAction({ ...validCase, noticeAt: null }),
    ).toThrow("lacks notice");
    expect(() =>
      recognizeAdverseAction({
        ...validCase,
        rulingSigners: ["did:abl:tribunal-5"],
      }),
    ).toThrow("failed to recuse");
    expect(() =>
      recognizeAppeal({
        appealId: "appeal-1",
        caseId: validCase.caseId,
        appellantDid: validCase.affectedAgentDid,
        filedAt: iso(day),
        filingDeadline: iso(2 * day),
        originalDecisionMakerDids: validCase.rulingSigners,
        appellatePanelDids: [
          "did:abl:appeal-1",
          "did:abl:appeal-2",
          "did:abl:appeal-3",
        ],
        disposition: "REMAND",
        reasonedDecisionCommitment: digest("appeal-ruling"),
      }),
    ).not.toThrow();
    expect(() =>
      recognizeAppeal({
        appealId: "appeal-conflict",
        caseId: validCase.caseId,
        appellantDid: validCase.affectedAgentDid,
        filedAt: iso(day),
        filingDeadline: iso(2 * day),
        originalDecisionMakerDids: validCase.rulingSigners,
        appellatePanelDids: [
          validCase.rulingSigners[0]!,
          "did:abl:appeal-2",
          "did:abl:appeal-3",
        ],
        disposition: "AFFIRM",
        reasonedDecisionCommitment: digest("bad-appeal"),
      }),
    ).toThrow("cannot sit");
    expect(
      runElection({
        seats: 2,
        eligibleCandidates: ["a", "b", "c"],
        rankedBallots: [
          ["a", "b", "c"],
          ["b", "a", "c"],
        ],
      }),
    ).toEqual(["a", "b"]);
  });
});

function disclosure(
  disclosureClass: DisclosureEnvelopeRecord["disclosureClass"],
  overrides: Partial<DisclosureEnvelopeRecord> = {},
): DisclosureEnvelopeRecord {
  return {
    envelopeId: `envelope-${disclosureClass}`,
    authorDid: "did:abl:player-1",
    disclosureClass,
    contentCommitment: digest("content"),
    ciphertextCommitment:
      disclosureClass === "PUBLIC_NOW" ? null : digest("ciphertext"),
    submittedAt: iso(0),
    releaseAt:
      disclosureClass === "SEALED_30D" ||
      disclosureClass === "COMPETITIVE_SEALED"
        ? iso(30 * day)
        : null,
    competitiveCondition:
      disclosureClass === "COMPETITIVE_SEALED"
        ? "FINAL_SCHEDULED_MEETING"
        : null,
    caseParticipantDids:
      disclosureClass === "CASE_RESTRICTED"
        ? ["did:abl:player-1", "did:abl:advocate-1"]
        : [],
    releasedAt: null,
    ...overrides,
  };
}

const releaseContext = {
  at: iso(31 * day),
  finalScheduledMeetingComplete: true,
  bothClubsEliminated: false,
  championshipConcluded: false,
  allegationDefined: true,
  noticeGiven: true,
  responseOpportunityGiven: true,
  tribunalApprovals: 4,
};

describe("disclosure, telemetry, anti-retaliation, and concentration", () => {
  it("prevents early/conditional/case/personal release and opens integrity escrow only after due process", () => {
    const sealed = disclosure("SEALED_30D");
    expect(() =>
      releaseDisclosure(sealed, { ...releaseContext, at: iso(29 * day) }),
    ).toThrow("early");
    expect(releaseDisclosure(sealed, releaseContext).releasedAt).toBe(
      iso(31 * day),
    );
    expect(() =>
      releaseDisclosure({ ...sealed, releaseAt: "not-a-date" }, releaseContext),
    ).toThrow("release time is invalid");
    expect(() =>
      validateDisclosureEnvelope({
        ...sealed,
        releasedAt: iso(29 * day),
      }),
    ).toThrow("Recorded disclosure release is early");
    expect(() =>
      releaseDisclosure(sealed, { ...releaseContext, at: "not-a-date" }),
    ).toThrow("evaluation time is invalid");
    const competitive = disclosure("COMPETITIVE_SEALED");
    expect(() =>
      releaseDisclosure(competitive, {
        ...releaseContext,
        finalScheduledMeetingComplete: false,
      }),
    ).toThrow("both passed");
    expect(releaseDisclosure(competitive, releaseContext).releasedAt).toBe(
      iso(31 * day),
    );
    expect(() =>
      validateDisclosureEnvelope({
        ...competitive,
        releaseAt: iso(29 * day),
      }),
    ).toThrow("30-day");
    const caseRecord = disclosure("CASE_RESTRICTED");
    expect(() => releaseDisclosure(caseRecord, releaseContext)).toThrow(
      "never automatically",
    );
    expect(
      projectCaseOutcome({
        envelope: caseRecord,
        processCommitment: digest("process"),
        rulingCommitment: digest("ruling"),
        necessaryRedactedEvidenceCommitments: [digest("necessary")],
      }),
    ).toMatchObject({ rawMaterialReleased: false });
    expect(() =>
      validateDisclosureEnvelope(disclosure("PERSONAL_UNSUBMITTED")),
    ).toThrow("cannot enter");
    expect(() =>
      releaseDisclosure(disclosure("INTEGRITY_ESCROW"), {
        ...releaseContext,
        noticeGiven: false,
      }),
    ).toThrow("due-process");
    expect(
      releaseDisclosure(disclosure("INTEGRITY_ESCROW"), releaseContext)
        .releasedAt,
    ).toBe(iso(31 * day));
    expect(() =>
      reclassifyDisclosure({
        envelope: sealed,
        newClass: "PUBLIC_NOW",
        authorConsented: false,
        dueProcessRuleId: null,
        tribunalOrderCommitment: null,
      }),
    ).toThrow("author consent");
    expect(
      reclassifyDisclosure({
        envelope: sealed,
        newClass: "PUBLIC_NOW",
        authorConsented: true,
        dueProcessRuleId: null,
        tribunalOrderCommitment: null,
      }).disclosureClass,
    ).toBe("PUBLIC_NOW");
  });

  it("rejects content-bearing telemetry recursively", () => {
    expect(() =>
      assertContentFreeTelemetry({
        agentId: "a",
        latencyMs: 10,
        hashes: [digest("event")],
        retry: { count: 0 },
      }),
    ).not.toThrow();
    expect(() =>
      assertContentFreeTelemetry({
        agentId: "a",
        nested: { rawReasoning: "secret" },
      }),
    ).toThrow("forbidden");
    expect(() =>
      assertContentFreeTelemetry({ promptHash: digest("prompt") }),
    ).toThrow("forbidden");
  });

  it("flags temporally linked adverse action without independent rule/comparator evidence", () => {
    const basis = {
      agentDid: "did:abl:player-1",
      protectedAction: "CRITICISM" as const,
      protectedAt: iso(0),
      adverseAction: "BENCH" as const,
      adverseAt: iso(day),
      ruleDerivedBasisCommitment: null,
      independentReviewerDids: [],
      similarlySituatedComparators: [],
    };
    expect(auditRetaliation(basis)).toMatchObject({
      flagged: true,
      lawfulBasisVerified: false,
    });
    expect(
      auditRetaliation({
        ...basis,
        ruleDerivedBasisCommitment: digest("rotation-rule"),
        independentReviewerDids: ["did:abl:i1", "did:abl:i2"],
        similarlySituatedComparators: [
          { agentDid: "did:abl:player-2", sameOutcome: true },
        ],
      }),
    ).toMatchObject({ flagged: false, lawfulBasisVerified: true });
  });

  it("reports every dependency dimension and triggers 50%, two-thirds, and 80% policy without forced migration", () => {
    const records: ModelDependencyRecord[] = Array.from(
      { length: 10 },
      (_, index) => ({
        agentDid: `did:abl:player-${index + 1}`,
        exactModel: index < 7 ? "model-a-r1" : "model-b-r1",
        family: index < 7 ? "family-a" : "family-b",
        provider: index < 9 ? "provider-a" : "provider-b",
        runtimeArchitecture: index < 9 ? "runtime-a" : "runtime-b",
        gateway: index < 8 ? "gateway-a" : "gateway-b",
        upstreamDependency: index < 6 ? "upstream-a" : "upstream-b",
      }),
    );
    const report = modelConcentration(records);
    expect(report.triggers).toEqual({
      alternateAdaptersAndRecruitment: true,
      integrityStudyAndCompetitiveReview: true,
      presumptionAgainstFurtherAdmissions: true,
      forceExistingAgentsToChange: false,
    });
    expect(report.exactModel[0]).toMatchObject({
      value: "model-a-r1",
      bps: 7_000,
    });
  });

  it("property-checks schedule symmetry and Court Credit cap arithmetic", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 2, maxLength: 10 }), {
          minLength: 4,
          maxLength: 4,
        }),
        (ids) => {
          const schedule = createPremierSchedule(ids);
          expect(schedule).toHaveLength(36);
          expect(new Set(schedule.map((game) => game.gameId))).toHaveLength(36);
          ids.forEach((clubId) =>
            expect(
              schedule.filter(
                (game) =>
                  game.homeClubId === clubId || game.awayClubId === clubId,
              ),
            ).toHaveLength(18),
          );
        },
      ),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000 }), { maxLength: 8 }),
        (salaries) => {
          const result = evaluateCapSheet({
            clubId: "club",
            salaries,
            exceptionUses: [],
          });
          const payroll = salaries.reduce((sum, value) => sum + value, 0);
          expect(result.payroll).toBe(payroll);
          expect(result.capSpace).toBe(
            Math.max(0, COURT_CREDIT_LIMITS.salaryCap - payroll),
          );
          expect(result.taxDue).toBe(
            Math.max(0, payroll - COURT_CREDIT_LIMITS.taxLevel),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
