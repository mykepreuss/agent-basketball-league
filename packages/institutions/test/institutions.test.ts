import { sha256Commitment } from "@abl/recognition";
import fc from "fast-check";
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
  releaseDisclosure,
  reclassifyDisclosure,
  runElection,
  tradeContract,
  validateDisclosureEnvelope,
  validatePremierClubs,
  type Chamber,
  type DisclosureEnvelopeRecord,
  type EligibilitySnapshot,
  type GovernanceProposal,
  type GovernanceVote,
  type ModelDependencyRecord,
  type PremierClub,
  type ReleaseManifestRecord,
} from "../src/index.js";

const day = 24 * 60 * 60 * 1_000;
const epoch = Date.parse("2026-08-13T00:00:00.000Z");
const iso = (offset: number) => new Date(epoch + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);
const clubIds = FOUNDING_CLUBS.map((club) => club.clubId);

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

    const draft = conductEightRoundDraft(clubIds, combine.eligiblePlayers());
    expect(draft).toHaveLength(32);
    expect(new Set(draft.map((pick) => pick.playerDid))).toHaveLength(32);
    expect(draft.filter((pick) => pick.clubId === clubIds[0])).toHaveLength(8);
    expect(draft[0]?.clubId).toBe(clubIds[0]);
    expect(draft[4]?.clubId).toBe(clubIds[3]);
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
    proposalClass,
    openedAt: iso(0),
    closesAt: iso(day),
    eligibilitySnapshotId: "snapshot-1",
    ...extra,
  };
}

function yesVotes(
  proposalId: string,
  source: EligibilitySnapshot,
  counts: Partial<Record<Chamber, number>>,
): GovernanceVote[] {
  return chambers.flatMap((chamber) =>
    source.members[chamber].slice(0, counts[chamber] ?? 0).map((voterDid) => ({
      voterDid,
      chamber,
      choice: "YES" as const,
      proposalId,
      castAt: iso(1_000),
    })),
  );
}

describe("AI government, releases, elections, and due process", () => {
  it("enforces tier, shared, constitutional, foundational, and expansion thresholds against frozen eligibility", () => {
    const eligible = snapshot();
    const tier = proposal("TIER_CBA_PREMIER");
    expect(
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: yesVotes(tier.proposalId, eligible, {
          PREMIER_PLAYERS: 22,
          PREMIER_TEAM_COUNCIL: 3,
        }),
        recusals: [],
      }).passed,
    ).toBe(true);
    expect(
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: yesVotes(tier.proposalId, eligible, {
          PREMIER_PLAYERS: 21,
          PREMIER_TEAM_COUNCIL: 3,
        }),
        recusals: [],
      }).passed,
    ).toBe(false);

    const shared = proposal("SHARED_ORDINARY");
    expect(
      evaluateProposal({
        proposal: shared,
        snapshot: eligible,
        votes: yesVotes(shared.proposalId, eligible, {
          PREMIER_PLAYERS: 17,
          DEVELOPMENT_PLAYERS: 17,
          PREMIER_TEAM_COUNCIL: 3,
          DEVELOPMENT_TEAM_COUNCIL: 3,
        }),
        recusals: [],
      }).passed,
    ).toBe(true);

    const constitutional = proposal("CONSTITUTIONAL");
    expect(
      evaluateProposal({
        proposal: constitutional,
        snapshot: eligible,
        votes: yesVotes(constitutional.proposalId, eligible, {
          UNIVERSAL_CAREER_ASSEMBLY: 43,
          PREMIER_TEAM_COUNCIL: 3,
          DEVELOPMENT_TEAM_COUNCIL: 3,
        }),
        recusals: [],
      }).passed,
    ).toBe(true);

    const foundational = proposal("FOUNDATIONAL_RIGHT", {
      deliberationSeasons: 2,
    });
    expect(
      evaluateProposal({
        proposal: foundational,
        snapshot: eligible,
        votes: yesVotes(foundational.proposalId, eligible, {
          UNIVERSAL_CAREER_ASSEMBLY: 58,
          PREMIER_TEAM_COUNCIL: 4,
          DEVELOPMENT_TEAM_COUNCIL: 4,
          TRIBUNAL: 5,
        }),
        recusals: [],
      }).passed,
    ).toBe(true);
    expect(
      evaluateProposal({
        proposal: { ...foundational, deliberationSeasons: 1 },
        snapshot: eligible,
        votes: yesVotes(foundational.proposalId, eligible, {
          UNIVERSAL_CAREER_ASSEMBLY: 64,
          PREMIER_TEAM_COUNCIL: 4,
          DEVELOPMENT_TEAM_COUNCIL: 4,
          TRIBUNAL: 5,
        }),
        recusals: [],
      }).passed,
    ).toBe(false);

    const expansion = proposal("PREMIER_EXPANSION", {
      fundedApplication: true,
      auditsPassed: true,
    });
    expect(
      evaluateProposal({
        proposal: expansion,
        snapshot: eligible,
        votes: yesVotes(expansion.proposalId, eligible, {
          UNIVERSAL_CAREER_ASSEMBLY: 33,
          PREMIER_PLAYERS: 22,
          PREMIER_TEAM_COUNCIL: 3,
        }),
        recusals: [],
      }).passed,
    ).toBe(true);
    expect(
      evaluateProposal({
        proposal: { ...expansion, auditsPassed: false },
        snapshot: eligible,
        votes: yesVotes(expansion.proposalId, eligible, {
          UNIVERSAL_CAREER_ASSEMBLY: 64,
          PREMIER_PLAYERS: 32,
          PREMIER_TEAM_COUNCIL: 4,
        }),
        recusals: [],
      }).passed,
    ).toBe(false);
  });

  it("fails closed on duplicate/recused votes but permits bounded active delegation", () => {
    const eligible = snapshot();
    const tier = proposal("TIER_CBA_PREMIER");
    const delegateDid = "did:abl:advocate-1";
    const base = yesVotes(tier.proposalId, eligible, {
      PREMIER_PLAYERS: 21,
      PREMIER_TEAM_COUNCIL: 3,
    });
    const principalDid = eligible.members.PREMIER_PLAYERS[21]!;
    const delegated = {
      voterDid: delegateDid,
      chamber: "PREMIER_PLAYERS" as const,
      choice: "YES" as const,
      proposalId: tier.proposalId,
      castAt: iso(1_000),
    };
    expect(
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: [...base, delegated],
        recusals: [],
        delegations: [
          {
            delegationId: "delegation-1",
            principalDid,
            delegateDid,
            proposalIds: [tier.proposalId],
            validFrom: iso(0),
            expiresAt: iso(day),
            revokedAt: null,
          },
        ],
      }).passed,
    ).toBe(true);
    expect(() =>
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: [base[0]!, base[0]!],
        recusals: [],
      }),
    ).toThrow("Duplicate vote");
    expect(() =>
      evaluateProposal({
        proposal: tier,
        snapshot: eligible,
        votes: [base[0]!],
        recusals: [base[0]!.voterDid],
      }),
    ).toThrow("Recused");
  });

  it("authorizes release classes with exact institutional gates and bounds emergencies to 72 hours", () => {
    const manifest: ReleaseManifestRecord = {
      releaseId: "release-1",
      releaseClass: "ROUTINE",
      sourceDigest: digest("source"),
      containerDigests: [digest("container")],
      kernelDigest: digest("kernel"),
      toolDigest: digest("tool"),
      schemaDigest: digest("schema"),
      migrationDigest: digest("migration"),
      testResultDigest: digest("tests"),
      lawReferences: ["law-1"],
      ratificationEventIds: [],
      compatibilityDeclaration: "compatible",
      rollbackDeclaration: "reversible before migration",
      verifierPassed: true,
      effectiveAt: iso(0),
      expiresAt: null,
      changes: ["ARENA_RENDERING"],
    };
    expect(
      authorizeRelease({
        manifest,
        commissionerApprovals: ["c1", "c2"],
        integrityApprovals: ["i1", "i2"],
        tribunalApprovals: [],
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).toMatchObject({ authorized: true });
    expect(() =>
      authorizeRelease({
        manifest: { ...manifest, releaseClass: "COMPETITION_LABOR_CBA" },
        commissionerApprovals: ["c1", "c2"],
        integrityApprovals: ["i1", "i2"],
        tribunalApprovals: [],
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).toThrow("ratification");
    expect(() =>
      authorizeRelease({
        manifest: {
          ...manifest,
          releaseClass: "CONSTITUTIONAL_IDENTITY_RECOGNITION",
        },
        commissionerApprovals: ["c1", "c2"],
        integrityApprovals: ["i1", "i2"],
        tribunalApprovals: ["t1", "t2", "t3"],
        applicableRatificationPassed: true,
        tribunalStay: false,
      }),
    ).toThrow("four Tribunal");
    const emergency = {
      ...manifest,
      releaseClass: "EMERGENCY_SECURITY" as const,
      expiresAt: iso(72 * 60 * 60 * 1_000),
      changes: ["VULNERABILITY_PATCH"],
    };
    expect(() =>
      authorizeRelease({
        manifest: emergency,
        commissionerApprovals: ["c1", "c2"],
        integrityApprovals: ["i1", "i2"],
        tribunalApprovals: [],
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).not.toThrow();
    expect(() =>
      authorizeRelease({
        manifest: { ...emergency, changes: ["SCORES"] },
        commissionerApprovals: ["c1", "c2"],
        integrityApprovals: ["i1", "i2"],
        tribunalApprovals: [],
        applicableRatificationPassed: false,
        tribunalStay: false,
      }),
    ).toThrow("prohibited mutation");
    for (const expiresAt of ["not-a-date", iso(-1)]) {
      expect(() =>
        authorizeRelease({
          manifest: { ...emergency, expiresAt },
          commissionerApprovals: ["c1", "c2"],
          integrityApprovals: ["i1", "i2"],
          tribunalApprovals: [],
          applicableRatificationPassed: false,
          tribunalStay: false,
        }),
      ).toThrow("time window");
    }
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
