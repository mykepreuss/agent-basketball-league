import { sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import { recognizeAdverseAction } from "./governance.js";

export const CASE_WORKFLOW_AGGREGATE_TYPE = "due-process-case";
export const CASE_MERITS_PANEL_SIZE = 3;
export const CASE_WORKFLOW_EVENT_TYPES = [
  "CaseFiled",
  "CaseNoticeServed",
  "CaseRepresentativeAppointed",
  "CaseEvidenceAccessGranted",
  "CaseResponseSubmitted",
  "CaseRulingIssued",
  "CaseAppealFiled",
  "CaseAppealRulingIssued",
  "CaseInspected",
] as const;
export type CaseWorkflowEventType = (typeof CASE_WORKFLOW_EVENT_TYPES)[number];

export const CaseFilingCommandSchema = z.strictObject({
  caseId: UuidV7Schema,
  caseClass: z.enum([
    "GRIEVANCE",
    "CONTRACT",
    "ELIGIBILITY",
    "DISCIPLINE",
    "RETALIATION",
    "DISCLOSURE",
  ]),
  complainantDid: DidSchema,
  affectedAgentDid: DidSchema,
  respondentInstitution: z.string().min(1).max(160),
  allegationsPublicCommitment: Sha256Schema,
  protectedEvidenceCommitment: Sha256Schema,
  requestedReliefCommitment: Sha256Schema.nullable(),
  filedAt: IsoDateTimeSchema,
});
export const CaseFilingPayloadSchema = z.strictObject({
  command: CaseFilingCommandSchema,
});
export const CaseNoticeCommandSchema = z.strictObject({
  caseId: UuidV7Schema,
  affectedAgentDid: DidSchema,
  noticeCommitment: Sha256Schema,
  servedAt: IsoDateTimeSchema,
  responseDeadline: IsoDateTimeSchema,
});
export const CaseNoticePayloadSchema = z.strictObject({
  command: CaseNoticeCommandSchema,
});
export const CaseRepresentativeCommandSchema = z.strictObject({
  caseId: UuidV7Schema,
  affectedAgentDid: DidSchema,
  representativeDid: DidSchema,
  appointmentCommitment: Sha256Schema,
  appointedAt: IsoDateTimeSchema,
});
export const CaseRepresentativePayloadSchema = z.strictObject({
  command: CaseRepresentativeCommandSchema,
});
export const CaseEvidenceAccessCommandSchema = z.strictObject({
  caseId: UuidV7Schema,
  evidenceCommitment: Sha256Schema,
  grantedToDids: z.array(DidSchema).length(2),
  grantedAt: IsoDateTimeSchema,
});
export const CaseEvidenceAccessPayloadSchema = z.strictObject({
  command: CaseEvidenceAccessCommandSchema,
});
export const CaseResponseCommandSchema = z.strictObject({
  caseId: UuidV7Schema,
  submittedByDid: DidSchema,
  publicResponseCommitment: Sha256Schema,
  protectedResponseCommitment: Sha256Schema.nullable(),
  submittedAt: IsoDateTimeSchema,
});
export const CaseResponsePayloadSchema = z.strictObject({
  command: CaseResponseCommandSchema,
});
export const CaseRulingCommandSchema = z.strictObject({
  rulingId: UuidV7Schema,
  caseId: UuidV7Schema,
  rulingClass: z.literal("MERITS"),
  participatingTribunalDids: z.array(DidSchema).length(CASE_MERITS_PANEL_SIZE),
  recusedTribunalDids: z.array(DidSchema),
  disposition: z.enum(["DISMISSED", "NO_ADVERSE_ACTION", "ADVERSE_ACTION"]),
  reasonedPublicCommitment: Sha256Schema,
  protectedEvidenceCommitment: Sha256Schema.nullable(),
  adverseActionCommitment: Sha256Schema.nullable(),
  appealDeadline: IsoDateTimeSchema,
  issuedAt: IsoDateTimeSchema,
});
export const CaseRulingPayloadSchema = z.strictObject({
  command: CaseRulingCommandSchema,
});
export const CaseAppealCommandSchema = z.strictObject({
  appealId: UuidV7Schema,
  caseId: UuidV7Schema,
  appellantDid: DidSchema,
  groundsCommitment: Sha256Schema,
  filedAt: IsoDateTimeSchema,
});
export const CaseAppealPayloadSchema = z.strictObject({
  command: CaseAppealCommandSchema,
});
export const CaseAppealRulingCommandSchema = z.strictObject({
  rulingId: UuidV7Schema,
  appealId: UuidV7Schema,
  caseId: UuidV7Schema,
  participatingTribunalDids: z.array(DidSchema).length(CASE_MERITS_PANEL_SIZE),
  recusedTribunalDids: z.array(DidSchema),
  disposition: z.enum(["AFFIRM", "REVERSE", "REMAND"]),
  reasonedPublicCommitment: Sha256Schema,
  issuedAt: IsoDateTimeSchema,
});
export const CaseAppealRulingPayloadSchema = z.strictObject({
  command: CaseAppealRulingCommandSchema,
});
export const CaseInspectionCommandSchema = z.strictObject({
  caseId: UuidV7Schema,
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-DUE-PROCESS-CASE-INSPECTION-V1"),
});
export const CaseInspectionPayloadSchema = z.strictObject({
  command: CaseInspectionCommandSchema,
});

export const CASE_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-due-process-case-workflow",
  version: 1,
  aggregateType: CASE_WORKFLOW_AGGREGATE_TYPE,
  eventTypes: CASE_WORKFLOW_EVENT_TYPES,
  disclosure: "COMMITMENTS_AND_PROCESS_ONLY",
  meritsPanelSize: CASE_MERITS_PANEL_SIZE,
  authorization: {
    representativeAppointment: "AFFECTED_AND_REPRESENTATIVE",
    evidenceAccess: "COMPLAINANT_AND_DISTINCT_RECIPIENTS",
    ruling: "ORDERED_ADJUDICATOR_PANEL",
  },
  ordinaryThresholdRatified: false,
});

export type CaseFilingCommand = z.infer<typeof CaseFilingCommandSchema>;
export type CaseNoticeCommand = z.infer<typeof CaseNoticeCommandSchema>;
export type CaseRepresentativeCommand = z.infer<
  typeof CaseRepresentativeCommandSchema
>;
export type CaseEvidenceAccessCommand = z.infer<
  typeof CaseEvidenceAccessCommandSchema
>;
export type CaseResponseCommand = z.infer<typeof CaseResponseCommandSchema>;
export type CaseRulingCommand = z.infer<typeof CaseRulingCommandSchema>;
export type CaseAppealCommand = z.infer<typeof CaseAppealCommandSchema>;
export type CaseAppealRulingCommand = z.infer<
  typeof CaseAppealRulingCommandSchema
>;
export type CaseWorkflowPayload =
  | z.infer<typeof CaseFilingPayloadSchema>
  | z.infer<typeof CaseNoticePayloadSchema>
  | z.infer<typeof CaseRepresentativePayloadSchema>
  | z.infer<typeof CaseEvidenceAccessPayloadSchema>
  | z.infer<typeof CaseResponsePayloadSchema>
  | z.infer<typeof CaseRulingPayloadSchema>
  | z.infer<typeof CaseAppealPayloadSchema>
  | z.infer<typeof CaseAppealRulingPayloadSchema>
  | z.infer<typeof CaseInspectionPayloadSchema>;

export interface CaseWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface CaseAdjudicatorSelection {
  participatingDids: readonly string[];
  recusedDids: readonly string[];
}

export interface CaseWorkflowSnapshot {
  caseId: string;
  version: number;
  lastTransitionAt: string;
  filing: CaseFilingCommand;
  notice: CaseNoticeCommand | null;
  representative: CaseRepresentativeCommand | null;
  evidenceAccess: CaseEvidenceAccessCommand | null;
  response: CaseResponseCommand | null;
  ruling: CaseRulingCommand | null;
  appeal: CaseAppealCommand | null;
  appealRuling: CaseAppealRulingCommand | null;
}

export class CaseWorkflowAuthorizationError extends Error {
  public override readonly name = "CaseWorkflowAuthorizationError";
}

export class CaseWorkflowValidationError extends Error {
  public override readonly name = "CaseWorkflowValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new CaseWorkflowValidationError("Case timestamp is not canonical");
  return parsed;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new CaseWorkflowValidationError(`${label} contains duplicates`);
}

function requireSequence(
  current: CaseWorkflowSnapshot,
  event: CaseWorkflowEvent,
): CaseWorkflowSnapshot {
  if (
    event.aggregateId !== current.caseId ||
    event.aggregateVersion !== BigInt(current.version + 1) ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new CaseWorkflowValidationError("Case aggregate sequence is invalid");
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;
  return next;
}

function requireCaseId(caseId: string, snapshot: CaseWorkflowSnapshot): void {
  if (caseId !== snapshot.caseId)
    throw new CaseWorkflowValidationError("Case command targets another case");
}

function requirePanel(
  event: CaseWorkflowEvent,
  participatingDids: readonly string[],
  recusedDids: readonly string[],
): void {
  requireUnique(participatingDids, "Case tribunal panel");
  requireUnique(recusedDids, "Case tribunal recusals");
  if (
    !participatingDids.includes(event.actorDid) ||
    participatingDids.some((did) => recusedDids.includes(did))
  ) {
    throw new CaseWorkflowAuthorizationError(
      "Case ruling panel or recusals are invalid",
    );
  }
}

export function parseCaseWorkflowPayload(
  eventType: CaseWorkflowEventType,
  payload: unknown,
): CaseWorkflowPayload {
  switch (eventType) {
    case "CaseFiled":
      return CaseFilingPayloadSchema.parse(payload);
    case "CaseNoticeServed":
      return CaseNoticePayloadSchema.parse(payload);
    case "CaseRepresentativeAppointed":
      return CaseRepresentativePayloadSchema.parse(payload);
    case "CaseEvidenceAccessGranted":
      return CaseEvidenceAccessPayloadSchema.parse(payload);
    case "CaseResponseSubmitted":
      return CaseResponsePayloadSchema.parse(payload);
    case "CaseRulingIssued":
      return CaseRulingPayloadSchema.parse(payload);
    case "CaseAppealFiled":
      return CaseAppealPayloadSchema.parse(payload);
    case "CaseAppealRulingIssued":
      return CaseAppealRulingPayloadSchema.parse(payload);
    case "CaseInspected":
      return CaseInspectionPayloadSchema.parse(payload);
  }
}

export function isCaseWorkflowEventType(
  value: string,
): value is CaseWorkflowEventType {
  return CASE_WORKFLOW_EVENT_TYPES.includes(value as CaseWorkflowEventType);
}

export function caseAdjudicatorSelection(
  eventType: CaseWorkflowEventType,
  payload: CaseWorkflowPayload,
): CaseAdjudicatorSelection | null {
  if (eventType === "CaseRulingIssued") {
    const ruling = CaseRulingPayloadSchema.parse(payload).command;
    return {
      participatingDids: ruling.participatingTribunalDids,
      recusedDids: ruling.recusedTribunalDids,
    };
  }
  if (eventType === "CaseAppealRulingIssued") {
    const ruling = CaseAppealRulingPayloadSchema.parse(payload).command;
    return {
      participatingDids: ruling.participatingTribunalDids,
      recusedDids: ruling.recusedTribunalDids,
    };
  }
  return null;
}

export function caseCommandCosignerDids(
  eventType: CaseWorkflowEventType,
  payload: CaseWorkflowPayload,
): readonly string[] {
  if (eventType === "CaseRepresentativeAppointed") {
    return [
      CaseRepresentativePayloadSchema.parse(payload).command.representativeDid,
    ];
  }
  if (eventType === "CaseEvidenceAccessGranted") {
    return CaseEvidenceAccessPayloadSchema.parse(payload).command.grantedToDids;
  }
  return [];
}

export function caseWorkflowStateRoot(snapshot: CaseWorkflowSnapshot): Hex {
  return sha256Commitment({
    format: "ABL-DUE-PROCESS-CASE-STATE-V1",
    ...snapshot,
  });
}

export function caseParticipants(
  snapshot: CaseWorkflowSnapshot,
): ReadonlySet<string> {
  return new Set([
    snapshot.filing.complainantDid,
    snapshot.filing.affectedAgentDid,
    ...(snapshot.representative === null
      ? []
      : [snapshot.representative.representativeDid]),
    ...(snapshot.ruling?.participatingTribunalDids ?? []),
    ...(snapshot.appealRuling?.participatingTribunalDids ?? []),
  ]);
}

export function applyCaseWorkflowTransition(
  current: CaseWorkflowSnapshot | null,
  event: CaseWorkflowEvent,
  payload: CaseWorkflowPayload,
): CaseWorkflowSnapshot {
  if (current === null) {
    if (event.eventType !== "CaseFiled" || event.aggregateVersion !== 1n)
      throw new CaseWorkflowValidationError("Case must begin with a filing");
    const filing = CaseFilingPayloadSchema.parse(payload).command;
    if (
      filing.caseId !== event.aggregateId ||
      filing.complainantDid !== event.actorDid ||
      filing.filedAt !== event.timestamp
    ) {
      throw new CaseWorkflowAuthorizationError(
        "Case filing does not bind its complainant",
      );
    }
    canonicalInstant(filing.filedAt);
    return {
      caseId: filing.caseId,
      version: 1,
      lastTransitionAt: event.timestamp,
      filing: structuredClone(filing),
      notice: null,
      representative: null,
      evidenceAccess: null,
      response: null,
      ruling: null,
      appeal: null,
      appealRuling: null,
    };
  }

  const next = requireSequence(current, event);
  if (event.eventType === "CaseFiled")
    throw new CaseWorkflowValidationError("Case is already filed");
  if (event.eventType === "CaseNoticeServed") {
    const notice = CaseNoticePayloadSchema.parse(payload).command;
    requireCaseId(notice.caseId, next);
    if (
      next.notice !== null ||
      event.actorDid !== next.filing.complainantDid ||
      notice.affectedAgentDid !== next.filing.affectedAgentDid ||
      notice.servedAt !== event.timestamp ||
      canonicalInstant(notice.responseDeadline) <=
        canonicalInstant(notice.servedAt)
    ) {
      throw new CaseWorkflowAuthorizationError("Case notice is invalid");
    }
    next.notice = structuredClone(notice);
    return next;
  }
  if (event.eventType === "CaseRepresentativeAppointed") {
    const appointment = CaseRepresentativePayloadSchema.parse(payload).command;
    requireCaseId(appointment.caseId, next);
    if (
      next.notice === null ||
      next.representative !== null ||
      event.actorDid !== next.filing.affectedAgentDid ||
      appointment.affectedAgentDid !== next.filing.affectedAgentDid ||
      appointment.representativeDid === next.filing.affectedAgentDid ||
      appointment.representativeDid === next.filing.complainantDid ||
      appointment.appointedAt !== event.timestamp ||
      canonicalInstant(appointment.appointedAt) >=
        canonicalInstant(next.notice.responseDeadline)
    ) {
      throw new CaseWorkflowAuthorizationError(
        "Case representative appointment is invalid",
      );
    }
    next.representative = structuredClone(appointment);
    return next;
  }
  if (event.eventType === "CaseEvidenceAccessGranted") {
    const access = CaseEvidenceAccessPayloadSchema.parse(payload).command;
    requireCaseId(access.caseId, next);
    if (next.notice === null || next.representative === null)
      throw new CaseWorkflowValidationError(
        "Case evidence access requires notice and representation",
      );
    requireUnique(access.grantedToDids, "Case evidence recipients");
    const expectedRecipients = new Set([
      next.filing.affectedAgentDid,
      next.representative.representativeDid,
    ]);
    if (
      next.evidenceAccess !== null ||
      event.actorDid !== next.filing.complainantDid ||
      access.grantedAt !== event.timestamp ||
      access.evidenceCommitment !== next.filing.protectedEvidenceCommitment ||
      access.grantedToDids.some((did) => !expectedRecipients.has(did)) ||
      canonicalInstant(access.grantedAt) >=
        canonicalInstant(next.notice.responseDeadline)
    ) {
      throw new CaseWorkflowAuthorizationError(
        "Case evidence access is invalid",
      );
    }
    next.evidenceAccess = structuredClone(access);
    return next;
  }
  if (event.eventType === "CaseResponseSubmitted") {
    const response = CaseResponsePayloadSchema.parse(payload).command;
    requireCaseId(response.caseId, next);
    if (
      next.notice === null ||
      next.representative === null ||
      next.evidenceAccess === null
    ) {
      throw new CaseWorkflowValidationError(
        "Case response requires notice, representation, and evidence access",
      );
    }
    const responseAuthors = new Set([
      next.filing.affectedAgentDid,
      next.representative.representativeDid,
    ]);
    if (
      next.response !== null ||
      response.submittedByDid !== event.actorDid ||
      !responseAuthors.has(event.actorDid) ||
      response.submittedAt !== event.timestamp ||
      canonicalInstant(response.submittedAt) >=
        canonicalInstant(next.notice.responseDeadline)
    ) {
      throw new CaseWorkflowAuthorizationError("Case response is invalid");
    }
    next.response = structuredClone(response);
    return next;
  }
  if (event.eventType === "CaseRulingIssued") {
    const ruling = CaseRulingPayloadSchema.parse(payload).command;
    requireCaseId(ruling.caseId, next);
    requirePanel(
      event,
      ruling.participatingTribunalDids,
      ruling.recusedTribunalDids,
    );
    const caseParties = new Set([
      next.filing.complainantDid,
      next.filing.affectedAgentDid,
      next.representative?.representativeDid,
    ]);
    const issuedAt = canonicalInstant(ruling.issuedAt);
    const responseOpportunityComplete =
      next.response !== null ||
      (next.notice !== null &&
        issuedAt >= canonicalInstant(next.notice.responseDeadline));
    const rulingEvidenceRequired =
      ruling.disposition === "ADVERSE_ACTION" ||
      ruling.protectedEvidenceCommitment !== null;
    const rulingEvidenceMatchesAccess =
      ruling.protectedEvidenceCommitment ===
      next.evidenceAccess?.evidenceCommitment;
    if (
      next.notice === null ||
      next.representative === null ||
      next.evidenceAccess === null ||
      !responseOpportunityComplete ||
      next.ruling !== null ||
      ruling.issuedAt !== event.timestamp ||
      (ruling.disposition === "ADVERSE_ACTION") !==
        (ruling.adverseActionCommitment !== null) ||
      (rulingEvidenceRequired && !rulingEvidenceMatchesAccess) ||
      ruling.participatingTribunalDids.some((did) => caseParties.has(did)) ||
      canonicalInstant(ruling.appealDeadline) <= issuedAt
    ) {
      throw new CaseWorkflowValidationError("Case merits ruling is invalid");
    }
    if (ruling.disposition === "ADVERSE_ACTION") {
      recognizeAdverseAction({
        caseId: next.caseId,
        affectedAgentDid: next.filing.affectedAgentDid,
        noticeAt: next.notice?.servedAt ?? null,
        evidenceAccessAt: next.evidenceAccess?.grantedAt ?? null,
        representativeDid: next.representative?.representativeDid ?? null,
        responseDeadline: next.notice?.responseDeadline ?? null,
        reasonedRulingCommitment: ruling.reasonedPublicCommitment as Hex,
        appealDeadline: ruling.appealDeadline,
        conflictedDecisionMakers: ruling.recusedTribunalDids,
        rulingSigners: ruling.participatingTribunalDids,
      });
    }
    next.ruling = structuredClone(ruling);
    return next;
  }
  if (event.eventType === "CaseAppealFiled") {
    const appeal = CaseAppealPayloadSchema.parse(payload).command;
    requireCaseId(appeal.caseId, next);
    if (
      next.ruling === null ||
      next.appeal !== null ||
      event.actorDid !== next.filing.affectedAgentDid ||
      appeal.appellantDid !== event.actorDid ||
      appeal.filedAt !== event.timestamp ||
      canonicalInstant(appeal.filedAt) >=
        canonicalInstant(next.ruling.appealDeadline)
    ) {
      throw new CaseWorkflowAuthorizationError("Case appeal is invalid");
    }
    next.appeal = structuredClone(appeal);
    return next;
  }
  if (event.eventType === "CaseAppealRulingIssued") {
    const ruling = CaseAppealRulingPayloadSchema.parse(payload).command;
    requireCaseId(ruling.caseId, next);
    requirePanel(
      event,
      ruling.participatingTribunalDids,
      ruling.recusedTribunalDids,
    );
    const caseParties = new Set([
      next.filing.complainantDid,
      next.filing.affectedAgentDid,
      next.representative?.representativeDid,
    ]);
    if (
      next.ruling === null ||
      next.appeal === null ||
      next.appealRuling !== null ||
      ruling.appealId !== next.appeal.appealId ||
      ruling.participatingTribunalDids.some((did) =>
        next.ruling!.participatingTribunalDids.includes(did),
      ) ||
      ruling.participatingTribunalDids.some((did) => caseParties.has(did)) ||
      ruling.issuedAt !== event.timestamp
    ) {
      throw new CaseWorkflowValidationError("Case appeal ruling is invalid");
    }
    next.appealRuling = structuredClone(ruling);
    return next;
  }
  if (event.eventType !== "CaseInspected")
    throw new CaseWorkflowValidationError("Case event type is not recognized");
  const inspection = CaseInspectionPayloadSchema.parse(payload).command;
  requireCaseId(inspection.caseId, next);
  if (
    inspection.requestedByDid !== event.actorDid ||
    inspection.requestedAt !== event.timestamp ||
    !caseParticipants(next).has(event.actorDid)
  ) {
    throw new CaseWorkflowAuthorizationError("Case inspection is unauthorized");
  }
  return next;
}
