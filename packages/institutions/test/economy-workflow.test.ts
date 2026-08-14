import { sha256Commitment } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  COURT_CREDIT_LIMITS,
  applyEconomyWorkflowTransition,
  caseWorkflowStateRoot,
  createEconomyCapCertification,
  economyTransactionTermsCommitment,
  economyWorkflowStateRoot,
  evaluateCapSheet,
  freeAgencyWindowCommitment,
  requireAdverseContractCase,
  tradeAccessEvidenceCommitment,
  type ActivePlayingRight,
  type CaseWorkflowSnapshot,
  type EconomyWorkflowEvent,
  type EconomyWorkflowSnapshot,
} from "../src/index.js";

const epoch = Date.parse("2026-08-13T00:00:00.000Z");
const at = (minutes: number) =>
  new Date(epoch + minutes * 60_000).toISOString();
const uuid = (suffix: string) =>
  `00000000-0000-7000-8000-${suffix.padStart(12, "0")}`;
const digest = (value: unknown) => sha256Commitment(value);
const economyId = "premier:season-zero";
const competitionId = "premier";
const seasonId = "season-zero";
const capAuthorityDid = "did:abl:cap-office";
const clubIds = ["club-a", "club-b", "club-c", "club-d"];
const authorityDigest = digest({ clubIds, governors: "frozen" });

function event(
  version: number,
  eventType: string,
  actorDid: string,
  timestamp: string,
): EconomyWorkflowEvent {
  return {
    actorDid,
    aggregateId: economyId,
    aggregateVersion: BigInt(version),
    eventType,
    timestamp,
  };
}

function initialRight(
  index: number,
  clubId: string,
): ActivePlayingRight & {
  origin: "INITIAL_CONTRACT";
  sourceAggregateVersion: string;
  sourceEventHash: `0x${string}`;
  sourceStateRoot: `0x${string}`;
} {
  return {
    playerDid: `did:abl:player-${index}`,
    transactionId: uuid(`1${index}`),
    consentId: uuid(`2${index}`),
    clubId,
    seasons: 2,
    courtCredits: 20_000,
    capMechanism: "DRAFT_SCALE",
    termsCommitment: digest({ index, terms: true }),
    effectiveAt: at(60),
    origin: "INITIAL_CONTRACT",
    sourceAggregateVersion: "2",
    sourceEventHash: digest({ index, event: true }),
    sourceStateRoot: digest({ index, state: true }),
  };
}

function initialize(): EconomyWorkflowSnapshot {
  const initialRights = clubIds.map((clubId, index) =>
    initialRight(index + 1, clubId),
  );
  const certification = createEconomyCapCertification({
    certificationId: uuid("1"),
    economyId,
    certifiedByDid: capAuthorityDid,
    certifiedAt: at(0),
    clubAuthoritySnapshotDigest: authorityDigest,
    clubIds,
    rights: initialRights,
    waiverCharges: [],
  });
  return applyEconomyWorkflowTransition(
    null,
    event(1, "CapSheetCertified", capAuthorityDid, at(0)),
    {
      command: {
        economyId,
        competitionId,
        seasonId,
        clubIds,
        initialRights,
        certification,
      },
    },
  );
}

describe("season economy workflow", () => {
  it("initializes only from a complete deterministic four-club cap certificate", () => {
    const snapshot = initialize();
    expect(snapshot.rights).toHaveLength(4);
    expect(snapshot.latestCapCertification.clubSheets).toHaveLength(4);
    expect(snapshot.latestCapCertification.clubSheets[0]).toMatchObject({
      clubId: "club-a",
      evaluation: {
        payroll: 20_000,
        currency: "NONCASH_COURT_CREDITS",
        tokenized: false,
      },
    });
    expect(economyWorkflowStateRoot(snapshot)).toMatch(/^0x[0-9a-f]{64}$/);

    const malformed = structuredClone(snapshot.latestCapCertification);
    malformed.clubSheets[0]!.evaluation.payroll += 1;
    expect(() =>
      applyEconomyWorkflowTransition(
        null,
        event(1, "CapSheetCertified", capAuthorityDid, at(0)),
        {
          command: {
            economyId,
            competitionId,
            seasonId,
            clubIds,
            initialRights: clubIds.map((clubId, index) =>
              initialRight(index + 1, clubId),
            ),
            certification: malformed,
          },
        },
      ),
    ).toThrow("complete economy state");
  });

  it("requires player-authorized trade terms, revoke-rotate-grant evidence, and recertification", () => {
    const snapshot = initialize();
    const source = snapshot.rights[0]!;
    const completedAt = at(10);
    const transaction = {
      transactionId: uuid("30"),
      kind: "TRADE" as const,
      playerDid: source.playerDid,
      fromTeamId: source.clubId,
      toTeamId: "club-b",
      seasons: source.seasons,
      courtCredits: source.courtCredits,
      capMechanism: source.capMechanism,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "TRADE",
        playerDid: source.playerDid,
        fromTeamId: source.clubId,
        toTeamId: "club-b",
        seasons: source.seasons,
        courtCredits: source.courtCredits,
        capMechanism: source.capMechanism,
        effectiveAt: at(20),
        sourceTransactionId: source.transactionId,
      }),
      consentRecordId: uuid("31"),
      effectiveAt: at(20),
    };
    const evidenceBody = {
      evidenceId: uuid("32"),
      transactionId: transaction.transactionId,
      playerDid: transaction.playerDid,
      fromClubId: transaction.fromTeamId,
      toClubId: transaction.toTeamId,
      priorGrantCommitment: digest("prior-grant"),
      nextGrantCommitment: digest("next-grant"),
      revokedAt: at(7),
      rotatedAt: at(8),
      grantedAt: at(9),
    };
    const accessEvidence = {
      ...evidenceBody,
      evidenceCommitment: tradeAccessEvidenceCommitment(evidenceBody),
    };
    const rights = snapshot.rights.map((right) =>
      right.playerDid === transaction.playerDid
        ? {
            playerDid: transaction.playerDid,
            transactionId: transaction.transactionId,
            consentId: transaction.consentRecordId,
            clubId: transaction.toTeamId,
            seasons: transaction.seasons,
            courtCredits: transaction.courtCredits,
            capMechanism: transaction.capMechanism,
            termsCommitment: transaction.termsCommitment,
            effectiveAt: transaction.effectiveAt,
            origin: "TRADE" as const,
          }
        : right,
    );
    const certification = createEconomyCapCertification({
      certificationId: uuid("33"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: completedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights,
      waiverCharges: [],
    });
    const command = {
      transaction,
      sourceTransactionId: source.transactionId,
      accessEvidence,
      authorizedByDids: [
        "did:abl:governor-a",
        "did:abl:governor-b",
        source.playerDid,
        capAuthorityDid,
      ] as [string, string, string, string],
      completedAt,
      certification,
    };
    const traded = applyEconomyWorkflowTransition(
      snapshot,
      event(2, "ContractTraded", "did:abl:governor-a", completedAt),
      { command },
    );
    expect(
      traded.rights.find(({ playerDid }) => playerDid === source.playerDid),
    ).toMatchObject({ clubId: "club-b", origin: "TRADE" });
    expect(
      traded.latestCapCertification.clubSheets.find(
        ({ clubId }) => clubId === "club-b",
      ),
    ).toMatchObject({ evaluation: { payroll: 40_000 } });

    expect(() =>
      applyEconomyWorkflowTransition(
        snapshot,
        event(2, "ContractTraded", "did:abl:governor-a", completedAt),
        {
          command: {
            ...command,
            accessEvidence: {
              ...accessEvidence,
              rotatedAt: at(6),
            },
          },
        },
      ),
    ).toThrow("revoke-rotate-grant");

    expect(() =>
      applyEconomyWorkflowTransition(
        snapshot,
        event(2, "ContractTraded", "did:abl:governor-a", completedAt),
        {
          command: {
            ...command,
            transaction: {
              ...command.transaction,
              transactionId: source.transactionId,
            },
          },
        },
      ),
    ).toThrow("identifier was already used");
  });

  it("supports mutual waiver, player-opened free agency, and a new consented signing", () => {
    let snapshot = initialize();
    const source = snapshot.rights[0]!;
    const waivedAt = at(10);
    const waiverTransaction = {
      transactionId: uuid("40"),
      kind: "WAIVE" as const,
      playerDid: source.playerDid,
      fromTeamId: source.clubId,
      toTeamId: null,
      seasons: 0 as const,
      courtCredits: 5_000,
      capMechanism: "WAIVER" as const,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "WAIVE",
        playerDid: source.playerDid,
        fromTeamId: source.clubId,
        toTeamId: null,
        seasons: 0,
        courtCredits: 5_000,
        capMechanism: "WAIVER",
        effectiveAt: at(20),
        sourceTransactionId: source.transactionId,
      }),
      consentRecordId: uuid("41"),
      effectiveAt: at(20),
    };
    const waiverCharge = {
      playerDid: source.playerDid,
      waiverTransactionId: waiverTransaction.transactionId,
      clubId: source.clubId,
      courtCredits: waiverTransaction.courtCredits,
      effectiveAt: waiverTransaction.effectiveAt,
    };
    const postWaiverRights = snapshot.rights.filter(
      ({ playerDid }) => playerDid !== source.playerDid,
    );
    const waiverCertification = createEconomyCapCertification({
      certificationId: uuid("42"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: waivedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights: postWaiverRights,
      waiverCharges: [waiverCharge],
    });
    snapshot = applyEconomyWorkflowTransition(
      snapshot,
      event(2, "ContractWaived", "did:abl:governor-a", waivedAt),
      {
        command: {
          transaction: waiverTransaction,
          sourceTransactionId: source.transactionId,
          authorization: {
            mode: "MUTUAL",
            authorizedByDids: [
              "did:abl:governor-a",
              source.playerDid,
              capAuthorityDid,
            ],
          },
          completedAt: waivedAt,
          certification: waiverCertification,
        },
      },
    );
    expect(
      snapshot.rights.some(({ playerDid }) => playerDid === source.playerDid),
    ).toBe(false);
    expect(snapshot.waiverCharges).toEqual([waiverCharge]);

    const openedAt = at(30);
    const closesAt = at(60);
    const freeAgencyId = uuid("43");
    snapshot = applyEconomyWorkflowTransition(
      snapshot,
      event(3, "FreeAgencyOpened", source.playerDid, openedAt),
      {
        command: {
          freeAgencyId,
          playerDid: source.playerDid,
          sourceWaiverTransactionId: waiverTransaction.transactionId,
          windowOpensAt: at(25),
          windowClosesAt: closesAt,
          windowCommitment: freeAgencyWindowCommitment({
            economyId,
            opensAt: at(25),
            closesAt,
          }),
          openedAt,
        },
      },
    );
    expect(snapshot.freeAgency[0]).toMatchObject({ status: "OPEN" });

    const signedAt = at(40);
    const signing = {
      transactionId: uuid("44"),
      kind: "SIGN" as const,
      playerDid: source.playerDid,
      fromTeamId: null,
      toTeamId: "club-c",
      seasons: 3,
      courtCredits: COURT_CREDIT_LIMITS.roomMidLevel,
      capMechanism: "ROOM_MLE" as const,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "SIGN",
        playerDid: source.playerDid,
        fromTeamId: null,
        toTeamId: "club-c",
        seasons: 3,
        courtCredits: COURT_CREDIT_LIMITS.roomMidLevel,
        capMechanism: "ROOM_MLE",
        effectiveAt: at(50),
        sourceTransactionId: null,
      }),
      consentRecordId: uuid("45"),
      effectiveAt: at(50),
    };
    const signedRight = {
      playerDid: signing.playerDid,
      transactionId: signing.transactionId,
      consentId: signing.consentRecordId,
      clubId: signing.toTeamId,
      seasons: signing.seasons,
      courtCredits: signing.courtCredits,
      capMechanism: signing.capMechanism,
      termsCommitment: signing.termsCommitment,
      effectiveAt: signing.effectiveAt,
      origin: "FREE_AGENCY" as const,
    };
    const signingCertification = createEconomyCapCertification({
      certificationId: uuid("46"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: signedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights: [...snapshot.rights, signedRight].sort((left, right) =>
        left.playerDid.localeCompare(right.playerDid),
      ),
      waiverCharges: snapshot.waiverCharges,
    });
    snapshot = applyEconomyWorkflowTransition(
      snapshot,
      event(4, "FreeAgentSigned", "did:abl:governor-c", signedAt),
      {
        command: {
          transaction: signing,
          freeAgencyId,
          authorizedByDids: [
            "did:abl:governor-c",
            source.playerDid,
            capAuthorityDid,
          ],
          completedAt: signedAt,
          certification: signingCertification,
        },
      },
    );
    expect(
      snapshot.rights.find(({ playerDid }) => playerDid === source.playerDid),
    ).toMatchObject({ clubId: "club-c", origin: "FREE_AGENCY" });
    expect(snapshot.freeAgency[0]).toMatchObject({
      status: "SIGNED",
      signingTransactionId: signing.transactionId,
    });
  });

  it("aggregates repeated exception uses before applying the fixed limit", () => {
    expect(() =>
      evaluateCapSheet({
        clubId: "club-a",
        salaries: [10_000],
        exceptionUses: [
          { kind: "ROOM_MLE", amount: 5_000 },
          { kind: "ROOM_MLE", amount: 5_000 },
        ],
      }),
    ).toThrow("fixed limit");
  });

  it("authorizes an adverse waiver only after the exact ruling becomes final", async () => {
    const playerDid = "did:abl:player-1";
    const actionCommitment = digest("adverse-waiver-action");
    const caseId = uuid("90");
    const rulingId = uuid("91");
    const appealId = uuid("92");
    const base: CaseWorkflowSnapshot = {
      caseId,
      version: 6,
      lastTransitionAt: at(5),
      filing: {
        caseId,
        caseClass: "CONTRACT",
        complainantDid: "did:abl:club-a",
        affectedAgentDid: playerDid,
        respondentInstitution: "Premier Club A",
        allegationsPublicCommitment: digest("allegations"),
        protectedEvidenceCommitment: digest("evidence"),
        requestedReliefCommitment: actionCommitment,
        filedAt: at(0),
      },
      notice: null,
      representative: null,
      evidenceAccess: null,
      response: null,
      ruling: {
        rulingId,
        caseId,
        rulingClass: "MERITS",
        participatingTribunalDids: [
          "did:abl:tribunal-1",
          "did:abl:tribunal-2",
          "did:abl:tribunal-3",
        ],
        recusedTribunalDids: [],
        disposition: "ADVERSE_ACTION",
        reasonedPublicCommitment: digest("ruling"),
        protectedEvidenceCommitment: digest("evidence"),
        adverseActionCommitment: actionCommitment,
        appealDeadline: at(10),
        issuedAt: at(5),
      },
      appeal: null,
      appealRuling: null,
    };

    const authorize = async (
      snapshot: CaseWorkflowSnapshot,
      authorizedAt: string,
    ) => {
      const caseStateRoot = caseWorkflowStateRoot(snapshot);
      const caseHeadEventHash = digest({ caseId, version: snapshot.version });
      await requireAdverseContractCase(
        {
          evidence: {
            caseId,
            caseAggregateVersion: String(snapshot.version),
            caseHeadEventHash,
            caseStateRoot,
            rulingId,
            adverseActionCommitment: actionCommitment,
          },
          playerDid,
          actionCommitment,
          authorizedAt,
        },
        {
          async adverseContractCase(requestedCaseId, requestedHead) {
            return requestedCaseId === caseId &&
              requestedHead === caseHeadEventHash
              ? {
                  snapshot,
                  aggregateVersion: String(snapshot.version),
                  headEventHash: caseHeadEventHash,
                  stateRoot: caseStateRoot,
                }
              : null;
          },
        },
      );
    };

    await expect(authorize(base, at(9))).rejects.toThrow("final exact ruling");
    await expect(authorize(base, at(10))).resolves.toBeUndefined();

    const pendingAppeal: CaseWorkflowSnapshot = {
      ...base,
      version: 7,
      lastTransitionAt: at(8),
      appeal: {
        appealId,
        caseId,
        appellantDid: playerDid,
        groundsCommitment: digest("appeal"),
        filedAt: at(8),
      },
    };
    await expect(authorize(pendingAppeal, at(20))).rejects.toThrow(
      "final exact ruling",
    );

    const affirmed: CaseWorkflowSnapshot = {
      ...pendingAppeal,
      version: 8,
      lastTransitionAt: at(15),
      appealRuling: {
        rulingId: uuid("93"),
        appealId,
        caseId,
        participatingTribunalDids: [
          "did:abl:appeals-1",
          "did:abl:appeals-2",
          "did:abl:appeals-3",
        ],
        recusedTribunalDids: [],
        disposition: "AFFIRM",
        reasonedPublicCommitment: digest("affirmed"),
        issuedAt: at(15),
      },
    };
    await expect(authorize(affirmed, at(14))).rejects.toThrow(
      "final exact ruling",
    );
    await expect(authorize(affirmed, at(15))).resolves.toBeUndefined();

    const reversed: CaseWorkflowSnapshot = {
      ...affirmed,
      appealRuling: {
        ...affirmed.appealRuling!,
        disposition: "REVERSE",
      },
    };
    await expect(authorize(reversed, at(20))).rejects.toThrow(
      "final exact ruling",
    );
  });
});
