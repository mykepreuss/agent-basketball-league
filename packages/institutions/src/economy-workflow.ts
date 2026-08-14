import { sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import {
  caseWorkflowStateRoot,
  type CaseWorkflowSnapshot,
} from "./case-workflow.js";
import { evaluateCapSheet } from "./economy.js";

const ClubIdSchema = z.string().min(1).max(160);
const AggregateVersionSchema = z.string().regex(/^[1-9]\d*$/);

export const ECONOMY_WORKFLOW_AGGREGATE_TYPE = "season-economy";
export const ECONOMY_WORKFLOW_EVENT_TYPES = [
  "CapSheetCertified",
  "ContractTraded",
  "ContractWaived",
  "FreeAgencyOpened",
  "FreeAgentSigned",
  "EconomyInspected",
] as const;
export type EconomyWorkflowEventType =
  (typeof ECONOMY_WORKFLOW_EVENT_TYPES)[number];

export const EconomyCapMechanismSchema = z.enum([
  "STANDARD_CAP",
  "DRAFT_SCALE",
  "MINIMUM",
  "NON_TAXPAYER_MLE",
  "TAXPAYER_MLE",
  "ROOM_MLE",
]);

export const ActivePlayingRightSchema = z.strictObject({
  playerDid: DidSchema,
  transactionId: UuidV7Schema,
  consentId: UuidV7Schema,
  clubId: ClubIdSchema,
  seasons: z.number().int().min(1).max(5),
  courtCredits: z.number().int().nonnegative(),
  capMechanism: EconomyCapMechanismSchema,
  termsCommitment: Sha256Schema,
  effectiveAt: IsoDateTimeSchema,
  origin: z.enum(["INITIAL_CONTRACT", "TRADE", "FREE_AGENCY"]),
});

export const InitialContractRightSchema = ActivePlayingRightSchema.extend({
  origin: z.literal("INITIAL_CONTRACT"),
  sourceAggregateVersion: AggregateVersionSchema,
  sourceEventHash: Sha256Schema,
  sourceStateRoot: Sha256Schema,
});

export const WaiverChargeSchema = z.strictObject({
  playerDid: DidSchema,
  waiverTransactionId: UuidV7Schema,
  clubId: ClubIdSchema,
  courtCredits: z.number().int().nonnegative(),
  effectiveAt: IsoDateTimeSchema,
});

const CapLineSchema = z.strictObject({
  playerDid: DidSchema,
  transactionId: UuidV7Schema,
  courtCredits: z.number().int().nonnegative(),
  capMechanism: EconomyCapMechanismSchema,
});
const WaiverLineSchema = z.strictObject({
  playerDid: DidSchema,
  waiverTransactionId: UuidV7Schema,
  courtCredits: z.number().int().nonnegative(),
});
const ExceptionUseSchema = z.strictObject({
  kind: z.enum(["NON_TAXPAYER_MLE", "TAXPAYER_MLE", "ROOM_MLE"]),
  amount: z.number().int().nonnegative(),
});
const CapEvaluationSchema = z.strictObject({
  payroll: z.number().int().nonnegative(),
  capSpace: z.number().int().nonnegative(),
  belowMinimum: z.boolean(),
  taxDue: z.number().int().nonnegative(),
  aboveFirstApron: z.boolean(),
  aboveSecondApron: z.boolean(),
  currency: z.literal("NONCASH_COURT_CREDITS"),
  tokenized: z.literal(false),
});
export const CertifiedClubCapSheetSchema = z.strictObject({
  clubId: ClubIdSchema,
  activeContracts: z.array(CapLineSchema),
  waiverCharges: z.array(WaiverLineSchema),
  exceptionUses: z.array(ExceptionUseSchema),
  evaluation: CapEvaluationSchema,
  sheetCommitment: Sha256Schema,
});
export const EconomyCapCertificationSchema = z.strictObject({
  certificationId: UuidV7Schema,
  economyId: z.string().min(1).max(320),
  certifiedByDid: DidSchema,
  certifiedAt: IsoDateTimeSchema,
  clubAuthoritySnapshotDigest: Sha256Schema,
  clubSheets: z.array(CertifiedClubCapSheetSchema).length(4),
  certificationCommitment: Sha256Schema,
});

export const TradeAccessEvidenceSchema = z.strictObject({
  evidenceId: UuidV7Schema,
  transactionId: UuidV7Schema,
  playerDid: DidSchema,
  fromClubId: ClubIdSchema,
  toClubId: ClubIdSchema,
  priorGrantCommitment: Sha256Schema,
  nextGrantCommitment: Sha256Schema,
  revokedAt: IsoDateTimeSchema,
  rotatedAt: IsoDateTimeSchema,
  grantedAt: IsoDateTimeSchema,
  evidenceCommitment: Sha256Schema,
});

export const AdverseContractActionEvidenceSchema = z.strictObject({
  caseId: UuidV7Schema,
  caseAggregateVersion: AggregateVersionSchema,
  caseHeadEventHash: Sha256Schema,
  caseStateRoot: Sha256Schema,
  rulingId: UuidV7Schema,
  adverseActionCommitment: Sha256Schema,
});

const EconomyTransactionBaseSchema = z.strictObject({
  transactionId: UuidV7Schema,
  playerDid: DidSchema,
  fromTeamId: ClubIdSchema.nullable(),
  toTeamId: ClubIdSchema.nullable(),
  seasons: z.number().int().min(0).max(5),
  courtCredits: z.number().int().nonnegative(),
  capMechanism: z.string().min(1).max(80),
  termsCommitment: Sha256Schema,
  consentRecordId: UuidV7Schema.optional(),
  effectiveAt: IsoDateTimeSchema,
});

export const EconomyInitializationCommandSchema = z.strictObject({
  economyId: z.string().min(1).max(320),
  competitionId: z.string().min(1).max(160),
  seasonId: z.string().min(1).max(160),
  clubIds: z.array(ClubIdSchema).length(4),
  initialRights: z.array(InitialContractRightSchema),
  certification: EconomyCapCertificationSchema,
});
export const EconomyInitializationPayloadSchema = z.strictObject({
  command: EconomyInitializationCommandSchema,
});

export const ContractTradeCommandSchema = z.strictObject({
  transaction: EconomyTransactionBaseSchema.extend({
    kind: z.literal("TRADE"),
    fromTeamId: ClubIdSchema,
    toTeamId: ClubIdSchema,
    seasons: z.number().int().min(1).max(5),
    capMechanism: EconomyCapMechanismSchema,
    consentRecordId: UuidV7Schema,
  }),
  sourceTransactionId: UuidV7Schema,
  accessEvidence: TradeAccessEvidenceSchema,
  authorizedByDids: z.tuple([DidSchema, DidSchema, DidSchema, DidSchema]),
  completedAt: IsoDateTimeSchema,
  certification: EconomyCapCertificationSchema,
});
export const ContractTradePayloadSchema = z.strictObject({
  command: ContractTradeCommandSchema,
});

export const ContractWaiverCommandSchema = z.strictObject({
  transaction: EconomyTransactionBaseSchema.extend({
    kind: z.literal("WAIVE"),
    fromTeamId: ClubIdSchema,
    toTeamId: z.null(),
    seasons: z.literal(0),
    capMechanism: z.literal("WAIVER"),
  }),
  sourceTransactionId: UuidV7Schema,
  authorization: z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("MUTUAL"),
      authorizedByDids: z.tuple([DidSchema, DidSchema, DidSchema]),
    }),
    z.strictObject({
      mode: z.literal("ADVERSE_RULING"),
      authorizedByDids: z.tuple([DidSchema, DidSchema]),
      evidence: AdverseContractActionEvidenceSchema,
    }),
  ]),
  completedAt: IsoDateTimeSchema,
  certification: EconomyCapCertificationSchema,
});
export const ContractWaiverPayloadSchema = z.strictObject({
  command: ContractWaiverCommandSchema,
});

export const FreeAgencyOpenCommandSchema = z.strictObject({
  freeAgencyId: UuidV7Schema,
  playerDid: DidSchema,
  sourceWaiverTransactionId: UuidV7Schema,
  windowOpensAt: IsoDateTimeSchema,
  windowClosesAt: IsoDateTimeSchema,
  windowCommitment: Sha256Schema,
  openedAt: IsoDateTimeSchema,
});
export const FreeAgencyOpenPayloadSchema = z.strictObject({
  command: FreeAgencyOpenCommandSchema,
});

export const FreeAgentSigningCommandSchema = z.strictObject({
  transaction: EconomyTransactionBaseSchema.extend({
    kind: z.literal("SIGN"),
    fromTeamId: z.null(),
    toTeamId: ClubIdSchema,
    seasons: z.number().int().min(1).max(5),
    capMechanism: EconomyCapMechanismSchema,
    consentRecordId: UuidV7Schema,
  }),
  freeAgencyId: UuidV7Schema,
  authorizedByDids: z.tuple([DidSchema, DidSchema, DidSchema]),
  completedAt: IsoDateTimeSchema,
  certification: EconomyCapCertificationSchema,
});
export const FreeAgentSigningPayloadSchema = z.strictObject({
  command: FreeAgentSigningCommandSchema,
});

export const EconomyInspectionCommandSchema = z.strictObject({
  economyId: z.string().min(1).max(320),
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-SEASON-ECONOMY-INSPECTION-V1"),
});
export const EconomyInspectionPayloadSchema = z.strictObject({
  command: EconomyInspectionCommandSchema,
});

export type EconomyInitializationCommand = z.infer<
  typeof EconomyInitializationCommandSchema
>;
export type EconomyCapCertification = z.infer<
  typeof EconomyCapCertificationSchema
>;
export type ContractTradeCommand = z.infer<typeof ContractTradeCommandSchema>;
export type ContractWaiverCommand = z.infer<typeof ContractWaiverCommandSchema>;
export type FreeAgencyOpenCommand = z.infer<typeof FreeAgencyOpenCommandSchema>;
export type FreeAgentSigningCommand = z.infer<
  typeof FreeAgentSigningCommandSchema
>;
export type TradeAccessEvidence = z.infer<typeof TradeAccessEvidenceSchema>;
export type AdverseContractActionEvidence = z.infer<
  typeof AdverseContractActionEvidenceSchema
>;
export type ActivePlayingRight = z.infer<typeof ActivePlayingRightSchema>;
export type WaiverCharge = z.infer<typeof WaiverChargeSchema>;
export type EconomyWorkflowPayload =
  | z.infer<typeof EconomyInitializationPayloadSchema>
  | z.infer<typeof ContractTradePayloadSchema>
  | z.infer<typeof ContractWaiverPayloadSchema>
  | z.infer<typeof FreeAgencyOpenPayloadSchema>
  | z.infer<typeof FreeAgentSigningPayloadSchema>
  | z.infer<typeof EconomyInspectionPayloadSchema>;

export interface EconomyWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface EconomyTransactionRecord {
  kind: "TRADE" | "WAIVE" | "FREE_AGENT_SIGNING";
  command:
    | ContractTradeCommand
    | ContractWaiverCommand
    | FreeAgentSigningCommand;
}

export interface FreeAgencyRecord extends FreeAgencyOpenCommand {
  status: "OPEN" | "SIGNED";
  signingTransactionId: string | null;
}

export interface EconomyWorkflowSnapshot {
  economyId: string;
  competitionId: string;
  seasonId: string;
  clubIds: string[];
  version: number;
  lastTransitionAt: string;
  initialContractSources: z.infer<typeof InitialContractRightSchema>[];
  rights: ActivePlayingRight[];
  waiverCharges: WaiverCharge[];
  freeAgency: FreeAgencyRecord[];
  transactions: EconomyTransactionRecord[];
  latestCapCertification: EconomyCapCertification;
}

export interface TradeAccessEvidenceReader {
  tradeAccessEvidence(evidenceId: string): Promise<TradeAccessEvidence | null>;
}

export interface AdverseContractCaseRecord {
  snapshot: CaseWorkflowSnapshot;
  aggregateVersion: string;
  headEventHash: string;
  stateRoot: string;
}

export interface AdverseContractCaseReader {
  adverseContractCase(
    caseId: string,
    headEventHash: string,
  ): Promise<AdverseContractCaseRecord | null>;
}

export class EconomyWorkflowAuthorizationError extends Error {
  public override readonly name = "EconomyWorkflowAuthorizationError";
}

export class EconomyWorkflowValidationError extends Error {
  public override readonly name = "EconomyWorkflowValidationError";
}

export const ECONOMY_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-season-economy-workflow",
  version: 1,
  aggregateType: ECONOMY_WORKFLOW_AGGREGATE_TYPE,
  eventTypes: ECONOMY_WORKFLOW_EVENT_TYPES,
  playerTradeConsent: "ALWAYS_REQUIRED",
  adverseWaiver: "FINAL_DUE_PROCESS_RULING_REQUIRED",
  tradeAccessOrder: ["REVOKE", "ROTATE", "GRANT"],
  capCertification: "EVERY_CAP_AFFECTING_TRANSITION",
  currency: "NONCASH_COURT_CREDITS",
});

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new EconomyWorkflowValidationError(
      "Economy timestamp is not canonical",
    );
  return parsed;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new EconomyWorkflowValidationError(`${label} contains duplicates`);
}

function requireSorted(values: readonly string[], label: string): void {
  if (values.some((value, index) => index > 0 && value <= values[index - 1]!))
    throw new EconomyWorkflowValidationError(`${label} is not sorted`);
}

function exceptionKind(
  capMechanism: string,
): z.infer<typeof ExceptionUseSchema>["kind"] | null {
  if (
    capMechanism === "NON_TAXPAYER_MLE" ||
    capMechanism === "TAXPAYER_MLE" ||
    capMechanism === "ROOM_MLE"
  ) {
    return capMechanism;
  }
  return null;
}

function sheetCommitment(
  sheet: Omit<z.infer<typeof CertifiedClubCapSheetSchema>, "sheetCommitment">,
): Hex {
  return sha256Commitment({ format: "ABL-CLUB-CAP-SHEET-V1", ...sheet });
}

export function economyCapCertificationCommitment(
  certification: Omit<EconomyCapCertification, "certificationCommitment">,
): Hex {
  return sha256Commitment({
    format: "ABL-SEASON-CAP-CERTIFICATION-V1",
    ...certification,
  });
}

export function tradeAccessEvidenceCommitment(
  evidence: Omit<TradeAccessEvidence, "evidenceCommitment">,
): Hex {
  return sha256Commitment({
    format: "ABL-TRADE-ACCESS-EVIDENCE-V1",
    ...evidence,
  });
}

export function createTradeAccessEvidenceReader(
  input: unknown,
): TradeAccessEvidenceReader {
  const records = z.array(TradeAccessEvidenceSchema).parse(input);
  const byId = new Map<string, TradeAccessEvidence>();
  for (const record of records) {
    const { evidenceCommitment, ...body } = record;
    if (
      evidenceCommitment !== tradeAccessEvidenceCommitment(body) ||
      byId.has(record.evidenceId)
    ) {
      throw new EconomyWorkflowValidationError(
        "Trade access evidence registry is invalid",
      );
    }
    byId.set(record.evidenceId, structuredClone(record));
  }
  return {
    async tradeAccessEvidence(evidenceId) {
      const record = byId.get(evidenceId);
      return record === undefined ? null : structuredClone(record);
    },
  };
}

export async function requireTradeAccessEvidence(
  claimed: TradeAccessEvidence,
  reader: TradeAccessEvidenceReader,
): Promise<void> {
  const stored = await reader.tradeAccessEvidence(claimed.evidenceId);
  const parsed = TradeAccessEvidenceSchema.safeParse(stored);
  if (
    !parsed.success ||
    sha256Commitment(parsed.data) !== sha256Commitment(claimed)
  ) {
    throw new EconomyWorkflowAuthorizationError(
      "Trade access evidence is absent or does not match",
    );
  }
}

export async function requireAdverseContractCase(
  input: {
    evidence: AdverseContractActionEvidence;
    playerDid: string;
    actionCommitment: string;
    authorizedAt: string;
  },
  reader: AdverseContractCaseReader,
): Promise<void> {
  const record = await reader.adverseContractCase(
    input.evidence.caseId,
    input.evidence.caseHeadEventHash,
  );
  if (record === null) {
    throw new EconomyWorkflowAuthorizationError(
      "Adverse contract action lacks a due-process case",
    );
  }
  const { snapshot } = record;
  const ruling = snapshot.ruling;
  const appealRuling = snapshot.appealRuling;
  const appealPending = snapshot.appeal !== null && appealRuling === null;
  const meritsFinal =
    snapshot.appeal === null &&
    ruling !== null &&
    canonicalInstant(input.authorizedAt) >=
      canonicalInstant(ruling.appealDeadline);
  const appealAffirmed =
    appealRuling?.disposition === "AFFIRM" &&
    canonicalInstant(input.authorizedAt) >=
      canonicalInstant(appealRuling.issuedAt);
  if (
    record.aggregateVersion !== input.evidence.caseAggregateVersion ||
    record.headEventHash !== input.evidence.caseHeadEventHash ||
    record.stateRoot !== input.evidence.caseStateRoot ||
    caseWorkflowStateRoot(snapshot) !== input.evidence.caseStateRoot ||
    snapshot.filing.caseClass !== "CONTRACT" ||
    snapshot.filing.affectedAgentDid !== input.playerDid ||
    ruling === null ||
    ruling.rulingId !== input.evidence.rulingId ||
    ruling.disposition !== "ADVERSE_ACTION" ||
    ruling.adverseActionCommitment !== input.actionCommitment ||
    input.evidence.adverseActionCommitment !== input.actionCommitment ||
    appealPending ||
    (!meritsFinal && !appealAffirmed)
  ) {
    throw new EconomyWorkflowAuthorizationError(
      "Adverse contract action is not authorized by a final exact ruling",
    );
  }
}

export function economyTransactionTermsCommitment(input: {
  kind: "TRADE" | "WAIVE" | "SIGN";
  playerDid: string;
  fromTeamId: string | null;
  toTeamId: string | null;
  seasons: number;
  courtCredits: number;
  capMechanism: string;
  effectiveAt: string;
  sourceTransactionId: string | null;
}): Hex {
  return sha256Commitment({
    format: "ABL-SEASON-ECONOMY-TRANSACTION-TERMS-V1",
    ...input,
  });
}

export function adverseWaiverActionCommitment(input: {
  transactionId: string;
  playerDid: string;
  fromTeamId: string;
  sourceTransactionId: string;
  waiverChargeCourtCredits: number;
  effectiveAt: string;
}): Hex {
  return sha256Commitment({
    format: "ABL-ADVERSE-CONTRACT-WAIVER-V1",
    ...input,
  });
}

export function freeAgencyWindowCommitment(input: {
  economyId: string;
  opensAt: string;
  closesAt: string;
}): Hex {
  return sha256Commitment({
    format: "ABL-FREE-AGENCY-WINDOW-V1",
    ...input,
  });
}

function expectedClubSheets(input: {
  clubIds: readonly string[];
  rights: readonly ActivePlayingRight[];
  waiverCharges: readonly WaiverCharge[];
}): z.infer<typeof CertifiedClubCapSheetSchema>[] {
  return input.clubIds.map((clubId) => {
    const activeContracts = input.rights
      .filter((right) => right.clubId === clubId)
      .map(({ playerDid, transactionId, courtCredits, capMechanism }) => ({
        playerDid,
        transactionId,
        courtCredits,
        capMechanism,
      }))
      .sort((left, right) => left.playerDid.localeCompare(right.playerDid));
    const waiverCharges = input.waiverCharges
      .filter((charge) => charge.clubId === clubId)
      .map(({ playerDid, waiverTransactionId, courtCredits }) => ({
        playerDid,
        waiverTransactionId,
        courtCredits,
      }))
      .sort((left, right) =>
        left.waiverTransactionId.localeCompare(right.waiverTransactionId),
      );
    const exceptionUses = activeContracts
      .map((contract) => {
        const kind = exceptionKind(contract.capMechanism);
        return kind === null ? null : { kind, amount: contract.courtCredits };
      })
      .filter((use) => use !== null);
    const evaluation = evaluateCapSheet({
      clubId,
      salaries: [
        ...activeContracts.map(({ courtCredits }) => courtCredits),
        ...waiverCharges.map(({ courtCredits }) => courtCredits),
      ],
      exceptionUses,
    });
    const body = {
      clubId,
      activeContracts,
      waiverCharges,
      exceptionUses,
      evaluation,
    };
    return { ...body, sheetCommitment: sheetCommitment(body) };
  });
}

export function createEconomyCapCertification(input: {
  certificationId: string;
  economyId: string;
  certifiedByDid: string;
  certifiedAt: string;
  clubAuthoritySnapshotDigest: string;
  clubIds: readonly string[];
  rights: readonly ActivePlayingRight[];
  waiverCharges: readonly WaiverCharge[];
}): EconomyCapCertification {
  const body = {
    certificationId: input.certificationId,
    economyId: input.economyId,
    certifiedByDid: input.certifiedByDid,
    certifiedAt: input.certifiedAt,
    clubAuthoritySnapshotDigest: input.clubAuthoritySnapshotDigest,
    clubSheets: expectedClubSheets(input),
  };
  return EconomyCapCertificationSchema.parse({
    ...body,
    certificationCommitment: economyCapCertificationCommitment(body),
  });
}

function validateCertification(
  certification: EconomyCapCertification,
  state: {
    economyId: string;
    clubIds: readonly string[];
    rights: readonly ActivePlayingRight[];
    waiverCharges: readonly WaiverCharge[];
  },
  timestamp: string,
): void {
  const parsed = EconomyCapCertificationSchema.parse(certification);
  const expected = createEconomyCapCertification({
    certificationId: parsed.certificationId,
    economyId: state.economyId,
    certifiedByDid: parsed.certifiedByDid,
    certifiedAt: timestamp,
    clubAuthoritySnapshotDigest: parsed.clubAuthoritySnapshotDigest,
    clubIds: state.clubIds,
    rights: state.rights,
    waiverCharges: state.waiverCharges,
  });
  if (sha256Commitment(parsed) !== sha256Commitment(expected))
    throw new EconomyWorkflowValidationError(
      "Cap certification does not match the complete economy state",
    );
}

function validateInitialRights(
  clubIds: readonly string[],
  rights: readonly z.infer<typeof InitialContractRightSchema>[],
): void {
  const playerDids = rights.map(({ playerDid }) => playerDid);
  const transactionIds = rights.map(({ transactionId }) => transactionId);
  const consentIds = rights.map(({ consentId }) => consentId);
  requireUnique(playerDids, "Initial contract players");
  requireUnique(transactionIds, "Initial contract transactions");
  requireUnique(consentIds, "Initial contract consents");
  requireSorted(playerDids, "Initial contract players");
  if (rights.some(({ clubId }) => !clubIds.includes(clubId)))
    throw new EconomyWorkflowValidationError(
      "Initial contract targets an undeclared club",
    );
}

function requireFreshTransactionIdentifiers(
  snapshot: EconomyWorkflowSnapshot,
  transaction: z.infer<typeof EconomyTransactionBaseSchema>,
): void {
  const transactionIds = [
    ...snapshot.initialContractSources.map(
      ({ transactionId }) => transactionId,
    ),
    ...snapshot.transactions.map(
      (record) => record.command.transaction.transactionId,
    ),
  ];
  const consentIds = [
    ...snapshot.initialContractSources.map(({ consentId }) => consentId),
    ...snapshot.transactions
      .map((record) => record.command.transaction.consentRecordId)
      .filter((consentId) => consentId !== undefined),
  ];
  if (
    transactionIds.includes(transaction.transactionId) ||
    (transaction.consentRecordId !== undefined &&
      consentIds.includes(transaction.consentRecordId))
  ) {
    throw new EconomyWorkflowValidationError(
      "Economy transaction or consent identifier was already used",
    );
  }
}

function nextSnapshot(
  current: EconomyWorkflowSnapshot,
  event: EconomyWorkflowEvent,
): EconomyWorkflowSnapshot {
  if (
    event.aggregateId !== current.economyId ||
    event.aggregateVersion !== BigInt(current.version + 1) ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new EconomyWorkflowValidationError(
      "Economy aggregate sequence is invalid",
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;
  return next;
}

function currentRight(
  snapshot: EconomyWorkflowSnapshot,
  playerDid: string,
  sourceTransactionId: string,
): ActivePlayingRight {
  const right = snapshot.rights.find(({ playerDid: did }) => did === playerDid);
  if (right === undefined || right.transactionId !== sourceTransactionId)
    throw new EconomyWorkflowValidationError(
      "Economy transaction does not target the current playing right",
    );
  return right;
}

function validateTradeAccessEvidence(
  evidence: TradeAccessEvidence,
  transaction: z.infer<typeof ContractTradeCommandSchema>["transaction"],
  completedAt: string,
): void {
  const { evidenceCommitment, ...body } =
    TradeAccessEvidenceSchema.parse(evidence);
  if (
    evidenceCommitment !== tradeAccessEvidenceCommitment(body) ||
    body.transactionId !== transaction.transactionId ||
    body.playerDid !== transaction.playerDid ||
    body.fromClubId !== transaction.fromTeamId ||
    body.toClubId !== transaction.toTeamId ||
    canonicalInstant(body.revokedAt) > canonicalInstant(body.rotatedAt) ||
    canonicalInstant(body.rotatedAt) > canonicalInstant(body.grantedAt) ||
    canonicalInstant(body.grantedAt) > canonicalInstant(completedAt)
  ) {
    throw new EconomyWorkflowValidationError(
      "Trade access evidence does not prove revoke-rotate-grant order",
    );
  }
}

function validateTerms(
  transaction: z.infer<typeof EconomyTransactionBaseSchema> & {
    kind: "TRADE" | "WAIVE" | "SIGN";
  },
  sourceTransactionId: string | null,
): void {
  if (
    transaction.termsCommitment !==
    economyTransactionTermsCommitment({
      kind: transaction.kind,
      playerDid: transaction.playerDid,
      fromTeamId: transaction.fromTeamId,
      toTeamId: transaction.toTeamId,
      seasons: transaction.seasons,
      courtCredits: transaction.courtCredits,
      capMechanism: transaction.capMechanism,
      effectiveAt: transaction.effectiveAt,
      sourceTransactionId,
    })
  ) {
    throw new EconomyWorkflowValidationError(
      "Economy transaction terms commitment is invalid",
    );
  }
}

function rightFromTransaction(
  transaction:
    | z.infer<typeof ContractTradeCommandSchema>["transaction"]
    | z.infer<typeof FreeAgentSigningCommandSchema>["transaction"],
  origin: ActivePlayingRight["origin"],
): ActivePlayingRight {
  return ActivePlayingRightSchema.parse({
    playerDid: transaction.playerDid,
    transactionId: transaction.transactionId,
    consentId: transaction.consentRecordId,
    clubId: transaction.toTeamId,
    seasons: transaction.seasons,
    courtCredits: transaction.courtCredits,
    capMechanism: transaction.capMechanism,
    termsCommitment: transaction.termsCommitment,
    effectiveAt: transaction.effectiveAt,
    origin,
  });
}

export function parseEconomyWorkflowPayload(
  eventType: EconomyWorkflowEventType,
  payload: unknown,
): EconomyWorkflowPayload {
  switch (eventType) {
    case "CapSheetCertified":
      return EconomyInitializationPayloadSchema.parse(payload);
    case "ContractTraded":
      return ContractTradePayloadSchema.parse(payload);
    case "ContractWaived":
      return ContractWaiverPayloadSchema.parse(payload);
    case "FreeAgencyOpened":
      return FreeAgencyOpenPayloadSchema.parse(payload);
    case "FreeAgentSigned":
      return FreeAgentSigningPayloadSchema.parse(payload);
    case "EconomyInspected":
      return EconomyInspectionPayloadSchema.parse(payload);
  }
}

export function economyWorkflowStateRoot(
  snapshot: EconomyWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-SEASON-ECONOMY-STATE-V1",
    ...snapshot,
  });
}

export function applyEconomyWorkflowTransition(
  current: EconomyWorkflowSnapshot | null,
  event: EconomyWorkflowEvent,
  payload: EconomyWorkflowPayload,
): EconomyWorkflowSnapshot {
  if (current === null) {
    if (
      event.aggregateVersion !== 1n ||
      event.eventType !== "CapSheetCertified"
    )
      throw new EconomyWorkflowValidationError(
        "Season economy must begin with a complete cap certification",
      );
    const command = EconomyInitializationPayloadSchema.parse(payload).command;
    canonicalInstant(event.timestamp);
    requireUnique(command.clubIds, "Economy clubs");
    requireSorted(command.clubIds, "Economy clubs");
    validateInitialRights(command.clubIds, command.initialRights);
    if (
      event.aggregateId !== command.economyId ||
      event.actorDid !== command.certification.certifiedByDid ||
      event.timestamp !== command.certification.certifiedAt
    ) {
      throw new EconomyWorkflowAuthorizationError(
        "Initial cap certification does not bind its economy authority",
      );
    }
    const rights = command.initialRights.map(
      ({
        sourceAggregateVersion: _sourceAggregateVersion,
        sourceEventHash: _sourceEventHash,
        sourceStateRoot: _sourceStateRoot,
        ...right
      }) => ActivePlayingRightSchema.parse(right),
    );
    validateCertification(
      command.certification,
      {
        economyId: command.economyId,
        clubIds: command.clubIds,
        rights,
        waiverCharges: [],
      },
      event.timestamp,
    );
    return {
      economyId: command.economyId,
      competitionId: command.competitionId,
      seasonId: command.seasonId,
      clubIds: structuredClone(command.clubIds),
      version: 1,
      lastTransitionAt: event.timestamp,
      initialContractSources: structuredClone(command.initialRights),
      rights,
      waiverCharges: [],
      freeAgency: [],
      transactions: [],
      latestCapCertification: structuredClone(command.certification),
    };
  }

  const next = nextSnapshot(current, event);
  if (event.eventType === "ContractTraded") {
    const command = ContractTradePayloadSchema.parse(payload).command;
    const transaction = command.transaction;
    requireFreshTransactionIdentifiers(next, transaction);
    const source = currentRight(
      next,
      transaction.playerDid,
      command.sourceTransactionId,
    );
    validateTerms(transaction, command.sourceTransactionId);
    validateTradeAccessEvidence(
      command.accessEvidence,
      transaction,
      command.completedAt,
    );
    if (
      event.actorDid !== command.authorizedByDids[0] ||
      event.timestamp !== command.completedAt ||
      transaction.fromTeamId !== source.clubId ||
      transaction.toTeamId === source.clubId ||
      !next.clubIds.includes(transaction.toTeamId) ||
      transaction.seasons !== source.seasons ||
      transaction.courtCredits !== source.courtCredits ||
      transaction.capMechanism !== source.capMechanism ||
      canonicalInstant(transaction.effectiveAt) <
        canonicalInstant(command.completedAt)
    ) {
      throw new EconomyWorkflowValidationError(
        "Trade does not preserve the current consented contract terms",
      );
    }
    next.rights = next.rights.filter(
      ({ playerDid }) => playerDid !== transaction.playerDid,
    );
    next.rights.push(rightFromTransaction(transaction, "TRADE"));
    next.rights.sort((left, right) =>
      left.playerDid.localeCompare(right.playerDid),
    );
    next.transactions.push({
      kind: "TRADE",
      command: structuredClone(command),
    });
    validateCertification(command.certification, next, event.timestamp);
    next.latestCapCertification = structuredClone(command.certification);
    return next;
  }

  if (event.eventType === "ContractWaived") {
    const command = ContractWaiverPayloadSchema.parse(payload).command;
    const transaction = command.transaction;
    requireFreshTransactionIdentifiers(next, transaction);
    const source = currentRight(
      next,
      transaction.playerDid,
      command.sourceTransactionId,
    );
    validateTerms(transaction, command.sourceTransactionId);
    if (
      event.actorDid !== command.authorization.authorizedByDids[0] ||
      event.timestamp !== command.completedAt ||
      transaction.fromTeamId !== source.clubId ||
      transaction.courtCredits > source.courtCredits ||
      canonicalInstant(transaction.effectiveAt) <
        canonicalInstant(command.completedAt) ||
      (command.authorization.mode === "MUTUAL" &&
        transaction.consentRecordId === undefined) ||
      (command.authorization.mode === "ADVERSE_RULING" &&
        (transaction.consentRecordId !== undefined ||
          command.authorization.evidence.adverseActionCommitment !==
            adverseWaiverActionCommitment({
              transactionId: transaction.transactionId,
              playerDid: transaction.playerDid,
              fromTeamId: transaction.fromTeamId,
              sourceTransactionId: command.sourceTransactionId,
              waiverChargeCourtCredits: transaction.courtCredits,
              effectiveAt: transaction.effectiveAt,
            })))
    ) {
      throw new EconomyWorkflowValidationError(
        "Waiver lacks player consent or exact adverse-action authority",
      );
    }
    next.rights = next.rights.filter(
      ({ playerDid }) => playerDid !== transaction.playerDid,
    );
    if (transaction.courtCredits > 0) {
      next.waiverCharges.push({
        playerDid: transaction.playerDid,
        waiverTransactionId: transaction.transactionId,
        clubId: transaction.fromTeamId,
        courtCredits: transaction.courtCredits,
        effectiveAt: transaction.effectiveAt,
      });
      next.waiverCharges.sort((left, right) =>
        left.waiverTransactionId.localeCompare(right.waiverTransactionId),
      );
    }
    next.transactions.push({
      kind: "WAIVE",
      command: structuredClone(command),
    });
    validateCertification(command.certification, next, event.timestamp);
    next.latestCapCertification = structuredClone(command.certification);
    return next;
  }

  if (event.eventType === "FreeAgencyOpened") {
    const command = FreeAgencyOpenPayloadSchema.parse(payload).command;
    const sourceWaiver = next.transactions.find(
      (record) =>
        record.kind === "WAIVE" &&
        record.command.transaction.transactionId ===
          command.sourceWaiverTransactionId,
    );
    if (
      event.actorDid !== command.playerDid ||
      event.timestamp !== command.openedAt ||
      sourceWaiver?.command.transaction.playerDid !== command.playerDid ||
      next.rights.some(({ playerDid }) => playerDid === command.playerDid) ||
      next.freeAgency.some(
        ({ freeAgencyId, sourceWaiverTransactionId }) =>
          freeAgencyId === command.freeAgencyId ||
          sourceWaiverTransactionId === command.sourceWaiverTransactionId,
      ) ||
      next.freeAgency.some(
        ({ playerDid, status }) =>
          playerDid === command.playerDid && status === "OPEN",
      ) ||
      command.windowCommitment !==
        freeAgencyWindowCommitment({
          economyId: next.economyId,
          opensAt: command.windowOpensAt,
          closesAt: command.windowClosesAt,
        }) ||
      canonicalInstant(command.windowOpensAt) >
        canonicalInstant(command.openedAt) ||
      canonicalInstant(command.openedAt) >=
        canonicalInstant(command.windowClosesAt)
    ) {
      throw new EconomyWorkflowValidationError(
        "Free agency opening lacks an eligible waived player or open window",
      );
    }
    next.freeAgency.push({
      ...structuredClone(command),
      status: "OPEN",
      signingTransactionId: null,
    });
    return next;
  }

  if (event.eventType === "FreeAgentSigned") {
    const command = FreeAgentSigningPayloadSchema.parse(payload).command;
    const transaction = command.transaction;
    requireFreshTransactionIdentifiers(next, transaction);
    const freeAgency = next.freeAgency.find(
      ({ freeAgencyId }) => freeAgencyId === command.freeAgencyId,
    );
    validateTerms(transaction, null);
    if (
      event.actorDid !== command.authorizedByDids[0] ||
      event.timestamp !== command.completedAt ||
      freeAgency === undefined ||
      freeAgency.status !== "OPEN" ||
      freeAgency.playerDid !== transaction.playerDid ||
      transaction.fromTeamId !== null ||
      !next.clubIds.includes(transaction.toTeamId) ||
      next.rights.some(
        ({ playerDid }) => playerDid === transaction.playerDid,
      ) ||
      canonicalInstant(command.completedAt) <
        canonicalInstant(freeAgency.openedAt) ||
      canonicalInstant(command.completedAt) >=
        canonicalInstant(freeAgency.windowClosesAt) ||
      canonicalInstant(transaction.effectiveAt) <
        canonicalInstant(command.completedAt)
    ) {
      throw new EconomyWorkflowValidationError(
        "Free-agent signing lacks an open player-controlled window",
      );
    }
    next.rights.push(rightFromTransaction(transaction, "FREE_AGENCY"));
    next.rights.sort((left, right) =>
      left.playerDid.localeCompare(right.playerDid),
    );
    freeAgency.status = "SIGNED";
    freeAgency.signingTransactionId = transaction.transactionId;
    next.transactions.push({
      kind: "FREE_AGENT_SIGNING",
      command: structuredClone(command),
    });
    validateCertification(command.certification, next, event.timestamp);
    next.latestCapCertification = structuredClone(command.certification);
    return next;
  }

  if (event.eventType === "EconomyInspected") {
    const command = EconomyInspectionPayloadSchema.parse(payload).command;
    if (
      command.economyId !== next.economyId ||
      command.requestedByDid !== event.actorDid ||
      command.requestedAt !== event.timestamp
    ) {
      throw new EconomyWorkflowAuthorizationError(
        "Economy inspection is outside career authority",
      );
    }
    return next;
  }

  throw new EconomyWorkflowValidationError(
    "Economy history cannot be reinitialized",
  );
}
