import { sha256Commitment } from "@abl/recognition";
import {
  ContractTransactionSchema,
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import { validateContractDuration, type ContractStatus } from "./economy.js";

export const CONTRACT_WORKFLOW_EVENT_TYPES = [
  "ContractOffered",
  "ContractResponded",
  "ContractsInspected",
] as const;
export const CONTRACT_WORKFLOW_AGGREGATE_TYPE = "career-contracts";
export const CONTRACT_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-career-contract-workflow",
  version: 1,
  aggregateType: CONTRACT_WORKFLOW_AGGREGATE_TYPE,
  eventTypes: CONTRACT_WORKFLOW_EVENT_TYPES,
  initialSigningOnly: true,
  playerRefusalFinal: true,
  liveCapSheetVerified: false,
});
export type ContractWorkflowEventType =
  (typeof CONTRACT_WORKFLOW_EVENT_TYPES)[number];

export const ContractOfferSchema = ContractTransactionSchema.omit({
  consentRecordId: true,
}).extend({
  kind: z.literal("SIGN"),
  fromTeamId: z.null(),
  toTeamId: z.string().min(1).max(160),
  seasons: z.number().int().min(1).max(5),
  capMechanism: z.enum(["STANDARD_CAP", "DRAFT_SCALE", "MINIMUM"]),
});
export const ContractOfferPayloadSchema = z.strictObject({
  command: ContractOfferSchema,
  offeredByDid: DidSchema,
  offeredAt: IsoDateTimeSchema,
  clubAuthoritySnapshotDigest: Sha256Schema,
});
export const ContractResponseSchema = z.strictObject({
  consentId: UuidV7Schema,
  agentDid: DidSchema,
  subjectType: z.literal("PLAYER_CONTRACT"),
  subjectId: UuidV7Schema,
  decision: z.enum(["CONSENT", "REFUSE"]),
  scope: z.tuple([z.literal("PLAYING_RIGHTS")]),
  proposalCommitment: Sha256Schema,
  recordedAt: IsoDateTimeSchema,
});
export const ContractResponsePayloadSchema = z.strictObject({
  command: ContractResponseSchema,
});
export const ContractInspectionCommandSchema = z.strictObject({
  playerDid: DidSchema,
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-CONTRACT-INSPECTION-V1"),
});
export const ContractInspectionPayloadSchema = z.strictObject({
  command: ContractInspectionCommandSchema,
});

export type ContractOfferTransaction = z.infer<typeof ContractOfferSchema>;
export type ContractOfferPayload = z.infer<typeof ContractOfferPayloadSchema>;
export type ContractResponse = z.infer<typeof ContractResponseSchema>;
export type ContractResponsePayload = z.infer<
  typeof ContractResponsePayloadSchema
>;
export type ContractInspectionPayload = z.infer<
  typeof ContractInspectionPayloadSchema
>;

export type ContractWorkflowPayload =
  | ContractOfferPayload
  | ContractResponsePayload
  | ContractInspectionPayload;

export interface ContractWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface ContractWorkflowRecord {
  transaction: ContractOfferTransaction;
  offeredByDid: string;
  offeredAt: string;
  clubAuthoritySnapshotDigest: string;
  status: Extract<ContractStatus, "OFFERED" | "ACTIVE" | "REFUSED">;
  consent: ContractResponse | null;
}

export interface ContractWorkflowSnapshot {
  playerDid: string;
  version: number;
  lastTransitionAt: string;
  contracts: ContractWorkflowRecord[];
}

export class ContractWorkflowAuthorizationError extends Error {
  public override readonly name = "ContractWorkflowAuthorizationError";
}

export class ContractWorkflowValidationError extends Error {
  public override readonly name = "ContractWorkflowValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ContractWorkflowValidationError(
      "Contract timestamp is not canonical",
    );
  return parsed;
}

export function contractClubAuthoritySnapshotDigest(
  clubGovernors: Readonly<Record<string, string>>,
): Hex {
  const normalized = Object.fromEntries(
    Object.entries(clubGovernors).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return sha256Commitment({
    format: "ABL-CONTRACT-CLUB-AUTHORITY-SNAPSHOT-V1",
    clubGovernors: normalized,
  });
}

export function contractOfferCommitment(record: {
  transaction: ContractOfferTransaction;
  offeredByDid: string;
  offeredAt: string;
  clubAuthoritySnapshotDigest: string;
}): Hex {
  return sha256Commitment({
    format: "ABL-CONTRACT-OFFER-COMMITMENT-V1",
    transaction: record.transaction,
    offeredByDid: record.offeredByDid,
    offeredAt: record.offeredAt,
    clubAuthoritySnapshotDigest: record.clubAuthoritySnapshotDigest,
  });
}

export function contractWorkflowStateRoot(
  snapshot: ContractWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-CAREER-CONTRACT-STATE-V1",
    ...snapshot,
  });
}

export function contractConsentHistoryCommitment(
  playerDid: string,
  snapshot: ContractWorkflowSnapshot | null,
): Hex {
  return sha256Commitment({
    format: "ABL-CONTRACT-CONSENT-HISTORY-V1",
    playerDid,
    consents:
      snapshot?.contracts.flatMap(({ transaction, consent }) =>
        consent === null
          ? []
          : [{ transactionId: transaction.transactionId, consent }],
      ) ?? [],
  });
}

export function compositeCareerConsentHistoryCommitment(
  admissionConsentHistoryCommitment: Hex,
  contractConsentCommitment: Hex,
): Hex {
  return sha256Commitment({
    format: "ABL-COMPOSITE-CONSENT-HISTORY-V1",
    admissionConsentHistoryCommitment,
    contractConsentCommitment,
  });
}

function validateOffer(
  playerDid: string,
  event: ContractWorkflowEvent,
  payload: ContractOfferPayload,
): void {
  const offeredAt = canonicalInstant(payload.offeredAt);
  const effectiveAt = canonicalInstant(payload.command.effectiveAt);
  try {
    validateContractDuration(payload.command.seasons);
  } catch (error) {
    throw new ContractWorkflowValidationError(
      error instanceof Error ? error.message : "Contract terms are invalid",
    );
  }
  if (
    payload.command.playerDid !== playerDid ||
    payload.offeredByDid !== event.actorDid ||
    payload.offeredAt !== event.timestamp ||
    effectiveAt < offeredAt
  ) {
    throw new ContractWorkflowValidationError(
      "Contract offer does not bind its parties or effective time",
    );
  }
}

function workflowRecord(offer: ContractOfferPayload): ContractWorkflowRecord {
  return {
    transaction: structuredClone(offer.command),
    offeredByDid: offer.offeredByDid,
    offeredAt: offer.offeredAt,
    clubAuthoritySnapshotDigest: offer.clubAuthoritySnapshotDigest,
    status: "OFFERED",
    consent: null,
  };
}

function validateResponse(
  snapshot: ContractWorkflowSnapshot,
  event: ContractWorkflowEvent,
  response: ContractResponse,
): ContractWorkflowRecord {
  const recordedAt = canonicalInstant(response.recordedAt);
  const contract = snapshot.contracts.find(
    ({ transaction }) => transaction.transactionId === response.subjectId,
  );
  if (
    contract === undefined ||
    contract.status !== "OFFERED" ||
    response.agentDid !== snapshot.playerDid ||
    event.actorDid !== snapshot.playerDid ||
    response.recordedAt !== event.timestamp ||
    response.proposalCommitment !== contractOfferCommitment(contract) ||
    recordedAt > canonicalInstant(contract.transaction.effectiveAt)
  ) {
    throw new ContractWorkflowValidationError(
      "Contract response does not bind an open offer or its player",
    );
  }
  if (
    response.decision === "CONSENT" &&
    snapshot.contracts.some(({ status }) => status === "ACTIVE")
  ) {
    throw new ContractWorkflowValidationError(
      "Initial-signing rehearsal cannot overlap an active contract",
    );
  }
  return contract;
}

export function applyContractWorkflowTransition(
  current: ContractWorkflowSnapshot | null,
  event: ContractWorkflowEvent,
  payload: ContractWorkflowPayload,
): ContractWorkflowSnapshot {
  if (current === null) {
    if (
      event.aggregateVersion !== 1n ||
      event.eventType !== "ContractOffered"
    ) {
      throw new ContractWorkflowValidationError(
        "Career contract history must begin with an offer",
      );
    }
    const offer = ContractOfferPayloadSchema.parse(payload);
    validateOffer(event.aggregateId, event, offer);
    return {
      playerDid: event.aggregateId,
      version: 1,
      lastTransitionAt: event.timestamp,
      contracts: [workflowRecord(offer)],
    };
  }
  if (
    event.aggregateVersion !== BigInt(current.version + 1) ||
    event.aggregateId !== current.playerDid ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new ContractWorkflowValidationError(
      "Career contract aggregate sequence is invalid",
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;

  if (event.eventType === "ContractOffered") {
    const offer = ContractOfferPayloadSchema.parse(payload);
    validateOffer(next.playerDid, event, offer);
    if (
      next.contracts.some(
        ({ transaction }) =>
          transaction.transactionId === offer.command.transactionId,
      )
    ) {
      throw new ContractWorkflowValidationError(
        "Contract transaction ID is not unique",
      );
    }
    next.contracts.push(workflowRecord(offer));
    return next;
  }
  if (event.eventType === "ContractResponded") {
    const response = ContractResponsePayloadSchema.parse(payload).command;
    if (
      next.contracts.some(
        ({ consent }) => consent?.consentId === response.consentId,
      )
    ) {
      throw new ContractWorkflowValidationError(
        "Contract consent ID is not unique",
      );
    }
    const contract = validateResponse(next, event, response);
    contract.status = response.decision === "CONSENT" ? "ACTIVE" : "REFUSED";
    contract.consent = structuredClone(response);
    return next;
  }
  if (event.eventType === "ContractsInspected") {
    const inspection = ContractInspectionPayloadSchema.parse(payload).command;
    const participatingGovernors = new Set(
      next.contracts.map(({ offeredByDid }) => offeredByDid),
    );
    if (
      inspection.playerDid !== next.playerDid ||
      inspection.requestedByDid !== event.actorDid ||
      inspection.requestedAt !== event.timestamp ||
      (event.actorDid !== next.playerDid &&
        !participatingGovernors.has(event.actorDid))
    ) {
      throw new ContractWorkflowAuthorizationError(
        "Contract inspection is outside party authority",
      );
    }
    return next;
  }
  throw new ContractWorkflowValidationError(
    "Contract history cannot be re-registered",
  );
}
