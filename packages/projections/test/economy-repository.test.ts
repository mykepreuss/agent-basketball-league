import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ECONOMY_WORKFLOW_AGGREGATE_TYPE,
  ECONOMY_WORKFLOW_SCHEMA_DIGEST,
  CONTRACT_WORKFLOW_SCHEMA_DIGEST,
  applyContractWorkflowTransition,
  applyEconomyWorkflowTransition,
  contractClubAuthoritySnapshotDigest,
  contractOfferCommitment,
  contractWorkflowStateRoot,
  createEconomyCapCertification,
  economyTransactionTermsCommitment,
  economyWorkflowStateRoot,
  freeAgencyWindowCommitment,
  tradeAccessEvidenceCommitment,
  type ContractWorkflowPayload,
  type ContractWorkflowSnapshot,
  type EconomyWorkflowPayload,
  type EconomyWorkflowSnapshot,
  type TradeAccessEvidence,
} from "@abl/institutions";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  ContractProjectionEventEnvelopeSchema,
  EconomyProjectionEventEnvelopeSchema,
  FilePublicContractProjectionRepository,
  FilePublicEconomyProjectionRepository,
  verifyContractProjectionEvent,
  verifyEconomyProjectionEvent,
  type ProjectionVerificationAuthority,
  type PublicCaseProjectionReader,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const epoch = Date.parse("2026-08-13T00:00:00.000Z");
const at = (minutes: number) =>
  new Date(epoch + minutes * 60_000).toISOString();
const uuid = (suffix: string) =>
  `00000000-0000-7000-8000-${suffix.padStart(12, "0")}`;
const digest = (value: unknown) => sha256Commitment(value);
const economyId = "premier:season-zero";
const clubIds = ["club-a", "club-b", "club-c", "club-d"];
const playerDid = "did:abl:economy-player";
const capAuthorityDid = "did:abl:economy-cap";
const governorDids = clubIds.map(
  (_, index) => `did:abl:economy-governor-${index + 1}`,
);
const clubGovernors = Object.fromEntries(
  clubIds.map((clubId, index) => [clubId, governorDids[index]!]),
);
const identities = new Map<string, SigningIdentity>(
  [playerDid, capAuthorityDid, ...governorDids].map((did, index) => [
    did,
    createSigningIdentity(digest({ did, index })),
  ]),
);
const authority: ProjectionVerificationAuthority = {
  domain,
  admittedAgents: new Map(
    [...identities].map(([did, identity]) => [
      did,
      {
        signerAddress: identity.address,
        allowedAggregateTypes:
          did === playerDid || did === governorDids[0]
            ? ["career-contracts", ECONOMY_WORKFLOW_AGGREGATE_TYPE]
            : [ECONOMY_WORKFLOW_AGGREGATE_TYPE],
      },
    ]),
  ),
};

function serializedEvent(event: CanonicalEvent) {
  return { ...event, aggregateVersion: event.aggregateVersion.toString() };
}

async function contractEnvelope(input: {
  actorDid: string;
  playerDid: string;
  version: number;
  eventType: "ContractOffered" | "ContractResponded";
  previousEventHash: Hex | null;
  payload: ContractWorkflowPayload;
  snapshot: ContractWorkflowSnapshot | null;
  timestamp: string;
}) {
  const base = {
    eventId: crypto.randomUUID(),
    actorDid: input.actorDid,
    nonce: `contract-${input.version}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: "career-contracts",
    aggregateId: input.playerDid,
    aggregateVersion: BigInt(input.version),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: CONTRACT_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  };
  const provisional = createCanonicalEvent({ ...base, stateRoot: digest("0") });
  const next = applyContractWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...base,
    stateRoot: contractWorkflowStateRoot(next),
  });
  const signature = await signCanonicalEvent(
    identities.get(input.actorDid)!,
    domain,
    event,
  );
  return {
    next,
    event,
    envelope: ContractProjectionEventEnvelopeSchema.parse({
      version: "1.0.0",
      topic: "public.contracts",
      event: serializedEvent(event),
      signature,
    }),
  };
}

async function economyEnvelope(input: {
  actorDid: string;
  version: number;
  eventType:
    | "CapSheetCertified"
    | "ContractTraded"
    | "ContractWaived"
    | "FreeAgencyOpened"
    | "FreeAgentSigned"
    | "EconomyInspected";
  previousEventHash: Hex | null;
  payload: EconomyWorkflowPayload;
  snapshot: EconomyWorkflowSnapshot | null;
  timestamp: string;
  signerDids: readonly string[];
}) {
  const base = {
    eventId: crypto.randomUUID(),
    actorDid: input.actorDid,
    nonce: `economy-${input.version}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: ECONOMY_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: economyId,
    aggregateVersion: BigInt(input.version),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: ECONOMY_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  };
  const provisional = createCanonicalEvent({ ...base, stateRoot: digest("0") });
  const next = applyEconomyWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...base,
    stateRoot: economyWorkflowStateRoot(next),
  });
  const signatures = await Promise.all(
    input.signerDids.map((did) =>
      signCanonicalEvent(identities.get(did)!, domain, event),
    ),
  );
  return {
    next,
    event,
    envelope: EconomyProjectionEventEnvelopeSchema.parse({
      version: "1.0.0",
      topic: "public.contracts",
      event: serializedEvent(event),
      signatures,
    }),
  };
}

describe("public season economy projections", () => {
  it("independently verifies cap-certified player mobility across restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-economy-projection-"));
    const contractRepository = new FilePublicContractProjectionRepository(
      root,
      {
        verifyAuthorization: (authorization) =>
          verifyContractProjectionEvent(authorization, {
            ...authority,
            contractClubGovernors: clubGovernors,
          }),
      },
    );
    await contractRepository.initialize();
    const authorityDigest = contractClubAuthoritySnapshotDigest(clubGovernors);
    const transaction = {
      transactionId: uuid("1"),
      kind: "SIGN" as const,
      playerDid,
      fromTeamId: null,
      toTeamId: clubIds[0]!,
      seasons: 3,
      courtCredits: 20_000,
      capMechanism: "DRAFT_SCALE" as const,
      termsCommitment: digest("initial-terms"),
      effectiveAt: at(10),
    };
    const offerPayload = {
      command: transaction,
      offeredByDid: governorDids[0]!,
      offeredAt: at(0),
      clubAuthoritySnapshotDigest: authorityDigest,
    };
    const offer = await contractEnvelope({
      actorDid: governorDids[0]!,
      playerDid,
      version: 1,
      eventType: "ContractOffered",
      previousEventHash: null,
      payload: offerPayload,
      snapshot: null,
      timestamp: at(0),
    });
    await contractRepository.publish(offer.envelope, "0", at(0));
    const responsePayload = {
      command: {
        consentId: uuid("2"),
        agentDid: playerDid,
        subjectType: "PLAYER_CONTRACT" as const,
        subjectId: transaction.transactionId,
        decision: "CONSENT" as const,
        scope: ["PLAYING_RIGHTS"] as ["PLAYING_RIGHTS"],
        proposalCommitment: contractOfferCommitment(offer.next.contracts[0]!),
        recordedAt: at(1),
      },
    };
    const response = await contractEnvelope({
      actorDid: playerDid,
      playerDid,
      version: 2,
      eventType: "ContractResponded",
      previousEventHash: offer.event.eventHash,
      payload: responsePayload,
      snapshot: offer.next,
      timestamp: at(1),
    });
    await contractRepository.publish(response.envelope, "1", at(1));

    const initialRight = {
      playerDid,
      transactionId: transaction.transactionId,
      consentId: responsePayload.command.consentId,
      clubId: transaction.toTeamId,
      seasons: transaction.seasons,
      courtCredits: transaction.courtCredits,
      capMechanism: transaction.capMechanism,
      termsCommitment: transaction.termsCommitment,
      effectiveAt: transaction.effectiveAt,
      origin: "INITIAL_CONTRACT" as const,
      sourceAggregateVersion: "2",
      sourceEventHash: response.event.eventHash,
      sourceStateRoot: response.event.stateRoot,
    };
    const initialCertification = createEconomyCapCertification({
      certificationId: uuid("3"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: at(2),
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights: [initialRight],
      waiverCharges: [],
    });
    const initialized = await economyEnvelope({
      actorDid: capAuthorityDid,
      version: 1,
      eventType: "CapSheetCertified",
      previousEventHash: null,
      payload: {
        command: {
          economyId,
          competitionId: "premier",
          seasonId: "season-zero",
          clubIds,
          initialRights: [initialRight],
          certification: initialCertification,
        },
      },
      snapshot: null,
      timestamp: at(2),
      signerDids: [capAuthorityDid, ...governorDids],
    });

    const tradeEvidence = new Map<string, TradeAccessEvidence>();
    const caseReader: PublicCaseProjectionReader = {
      refresh: async () => undefined,
      cases: () => [],
      caseAtHead: () => null,
    };
    const economyAuthority = {
      ...authority,
      economyId,
      competitionId: "premier",
      seasonId: "season-zero",
      contractClubGovernors: clubGovernors,
      capAuthorityDid,
      playerDids: [playerDid],
      freeAgencyWindow: { opensAt: at(20), closesAt: at(40) },
      tradeAccessEvidence: {
        tradeAccessEvidence: async (evidenceId: string) =>
          structuredClone(tradeEvidence.get(evidenceId) ?? null),
      },
      contractReader: contractRepository,
      caseReader,
    };
    const repository = new FilePublicEconomyProjectionRepository(root, {
      verifyAuthorization: (authorization) =>
        verifyEconomyProjectionEvent(authorization, economyAuthority),
    });
    await repository.initialize();
    await expect(
      verifyEconomyProjectionEvent(
        {
          ...initialized.envelope,
          signatures: initialized.envelope.signatures.slice(0, -1),
        },
        economyAuthority,
      ),
    ).rejects.toThrow("ordered careers");
    await repository.publish(initialized.envelope, "0", at(2));

    const completedAt = at(3);
    const tradedTransaction = {
      transactionId: uuid("4"),
      kind: "TRADE" as const,
      playerDid,
      fromTeamId: clubIds[0]!,
      toTeamId: clubIds[1]!,
      seasons: transaction.seasons,
      courtCredits: transaction.courtCredits,
      capMechanism: transaction.capMechanism,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "TRADE",
        playerDid,
        fromTeamId: clubIds[0]!,
        toTeamId: clubIds[1]!,
        seasons: transaction.seasons,
        courtCredits: transaction.courtCredits,
        capMechanism: transaction.capMechanism,
        effectiveAt: at(4),
        sourceTransactionId: transaction.transactionId,
      }),
      consentRecordId: uuid("5"),
      effectiveAt: at(4),
    };
    const evidenceBody = {
      evidenceId: uuid("6"),
      transactionId: tradedTransaction.transactionId,
      playerDid,
      fromClubId: clubIds[0]!,
      toClubId: clubIds[1]!,
      priorGrantCommitment: digest("prior"),
      nextGrantCommitment: digest("next"),
      revokedAt: at(2) + "",
      rotatedAt: new Date(epoch + 2 * 60_000 + 1_000).toISOString(),
      grantedAt: new Date(epoch + 2 * 60_000 + 2_000).toISOString(),
    };
    const accessEvidence = {
      ...evidenceBody,
      evidenceCommitment: tradeAccessEvidenceCommitment(evidenceBody),
    };
    tradeEvidence.set(accessEvidence.evidenceId, accessEvidence);
    const tradedRight = {
      playerDid,
      transactionId: tradedTransaction.transactionId,
      consentId: tradedTransaction.consentRecordId,
      clubId: tradedTransaction.toTeamId,
      seasons: tradedTransaction.seasons,
      courtCredits: tradedTransaction.courtCredits,
      capMechanism: tradedTransaction.capMechanism,
      termsCommitment: tradedTransaction.termsCommitment,
      effectiveAt: tradedTransaction.effectiveAt,
      origin: "TRADE" as const,
    };
    const tradeCertification = createEconomyCapCertification({
      certificationId: uuid("7"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: completedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights: [tradedRight],
      waiverCharges: [],
    });
    const trade = await economyEnvelope({
      actorDid: governorDids[0]!,
      version: 2,
      eventType: "ContractTraded",
      previousEventHash: initialized.event.eventHash,
      payload: {
        command: {
          transaction: tradedTransaction,
          sourceTransactionId: transaction.transactionId,
          accessEvidence,
          authorizedByDids: [
            governorDids[0]!,
            governorDids[1]!,
            playerDid,
            capAuthorityDid,
          ],
          completedAt,
          certification: tradeCertification,
        },
      },
      snapshot: initialized.next,
      timestamp: completedAt,
      signerDids: [
        governorDids[0]!,
        governorDids[1]!,
        playerDid,
        capAuthorityDid,
      ],
    });
    await repository.publish(trade.envelope, "1", at(3));
    expect(repository.rosters()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clubId: clubIds[1],
          rosterKind: "CAP_CERTIFIED_ACTIVE_PLAYING_RIGHTS",
          players: [expect.objectContaining({ playerDid, origin: "TRADE" })],
          capSheet: expect.objectContaining({
            evaluation: expect.objectContaining({ payroll: 20_000 }),
          }),
        }),
      ]),
    );

    const waiverTransaction = {
      transactionId: uuid("8"),
      kind: "WAIVE" as const,
      playerDid,
      fromTeamId: clubIds[1]!,
      toTeamId: null,
      seasons: 0 as const,
      courtCredits: 5_000,
      capMechanism: "WAIVER" as const,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "WAIVE",
        playerDid,
        fromTeamId: clubIds[1]!,
        toTeamId: null,
        seasons: 0,
        courtCredits: 5_000,
        capMechanism: "WAIVER",
        effectiveAt: at(6),
        sourceTransactionId: tradedTransaction.transactionId,
      }),
      consentRecordId: uuid("9"),
      effectiveAt: at(6),
    };
    const waiverCharge = {
      playerDid,
      waiverTransactionId: waiverTransaction.transactionId,
      clubId: clubIds[1]!,
      courtCredits: waiverTransaction.courtCredits,
      effectiveAt: waiverTransaction.effectiveAt,
    };
    const waiverCertification = createEconomyCapCertification({
      certificationId: uuid("10"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: at(5),
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights: [],
      waiverCharges: [waiverCharge],
    });
    const waived = await economyEnvelope({
      actorDid: governorDids[1]!,
      version: 3,
      eventType: "ContractWaived",
      previousEventHash: trade.event.eventHash,
      payload: {
        command: {
          transaction: waiverTransaction,
          sourceTransactionId: tradedTransaction.transactionId,
          authorization: {
            mode: "MUTUAL",
            authorizedByDids: [governorDids[1]!, playerDid, capAuthorityDid],
          },
          completedAt: at(5),
          certification: waiverCertification,
        },
      },
      snapshot: trade.next,
      timestamp: at(5),
      signerDids: [governorDids[1]!, playerDid, capAuthorityDid],
    });
    await repository.publish(waived.envelope, "2", at(5));

    const freeAgencyId = uuid("11");
    const opened = await economyEnvelope({
      actorDid: playerDid,
      version: 4,
      eventType: "FreeAgencyOpened",
      previousEventHash: waived.event.eventHash,
      payload: {
        command: {
          freeAgencyId,
          playerDid,
          sourceWaiverTransactionId: waiverTransaction.transactionId,
          windowOpensAt: at(20),
          windowClosesAt: at(40),
          windowCommitment: freeAgencyWindowCommitment({
            economyId,
            opensAt: at(20),
            closesAt: at(40),
          }),
          openedAt: at(20),
        },
      },
      snapshot: waived.next,
      timestamp: at(20),
      signerDids: [playerDid],
    });
    await repository.publish(opened.envelope, "3", at(20));

    const signingTransaction = {
      transactionId: uuid("12"),
      kind: "SIGN" as const,
      playerDid,
      fromTeamId: null,
      toTeamId: clubIds[2]!,
      seasons: 2,
      courtCredits: 15_000,
      capMechanism: "STANDARD_CAP" as const,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "SIGN",
        playerDid,
        fromTeamId: null,
        toTeamId: clubIds[2]!,
        seasons: 2,
        courtCredits: 15_000,
        capMechanism: "STANDARD_CAP",
        effectiveAt: at(22),
        sourceTransactionId: null,
      }),
      consentRecordId: uuid("13"),
      effectiveAt: at(22),
    };
    const signedRight = {
      playerDid,
      transactionId: signingTransaction.transactionId,
      consentId: signingTransaction.consentRecordId,
      clubId: signingTransaction.toTeamId,
      seasons: signingTransaction.seasons,
      courtCredits: signingTransaction.courtCredits,
      capMechanism: signingTransaction.capMechanism,
      termsCommitment: signingTransaction.termsCommitment,
      effectiveAt: signingTransaction.effectiveAt,
      origin: "FREE_AGENCY" as const,
    };
    const signingCertification = createEconomyCapCertification({
      certificationId: uuid("14"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: at(21),
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds,
      rights: [signedRight],
      waiverCharges: [waiverCharge],
    });
    const signed = await economyEnvelope({
      actorDid: governorDids[2]!,
      version: 5,
      eventType: "FreeAgentSigned",
      previousEventHash: opened.event.eventHash,
      payload: {
        command: {
          transaction: signingTransaction,
          freeAgencyId,
          authorizedByDids: [governorDids[2]!, playerDid, capAuthorityDid],
          completedAt: at(21),
          certification: signingCertification,
        },
      },
      snapshot: opened.next,
      timestamp: at(21),
      signerDids: [governorDids[2]!, playerDid, capAuthorityDid],
    });
    await repository.publish(signed.envelope, "4", at(21));
    expect(repository.rosters()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clubId: clubIds[1],
          players: [],
          waiverCharges: [expect.objectContaining({ playerDid })],
        }),
        expect.objectContaining({
          clubId: clubIds[2],
          players: [
            expect.objectContaining({ playerDid, origin: "FREE_AGENCY" }),
          ],
          capSheet: expect.objectContaining({
            evaluation: expect.objectContaining({ payroll: 15_000 }),
          }),
        }),
      ]),
    );

    const restarted = new FilePublicEconomyProjectionRepository(root, {
      verifyAuthorization: (authorization) =>
        verifyEconomyProjectionEvent(authorization, economyAuthority),
    });
    await restarted.initialize();
    expect(restarted.rosters()).toEqual(repository.rosters());

    const path = join(root, "economy-records", "000000000001.json");
    const record = JSON.parse(await readFile(path, "utf8")) as {
      projection: { rights: Array<{ clubId: string }> };
      recordHash: Hex;
      [key: string]: unknown;
    };
    record.projection.rights[0]!.clubId = clubIds[2]!;
    const { recordHash: _recordHash, ...body } = record;
    record.recordHash = sha256Commitment(body);
    await writeFile(path, `${JSON.stringify(record)}\n`, "utf8");
    const tampered = new FilePublicEconomyProjectionRepository(root, {
      verifyAuthorization: (authorization) =>
        verifyEconomyProjectionEvent(authorization, economyAuthority),
    });
    await expect(tampered.initialize()).rejects.toThrow(
      "does not match its authorization",
    );
  });
});
