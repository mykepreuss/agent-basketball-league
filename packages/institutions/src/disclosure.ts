import { sha256Commitment } from "@abl/recognition";

export type DisclosureClass =
  | "PUBLIC_NOW"
  | "SEALED_30D"
  | "COMPETITIVE_SEALED"
  | "CASE_RESTRICTED"
  | "PERSONAL_UNSUBMITTED"
  | "INTEGRITY_ESCROW";

export interface DisclosureEnvelopeRecord {
  envelopeId: string;
  authorDid: string;
  disclosureClass: DisclosureClass;
  contentCommitment: `0x${string}`;
  ciphertextCommitment: `0x${string}` | null;
  submittedAt: string;
  releaseAt: string | null;
  competitiveCondition:
    | "FINAL_SCHEDULED_MEETING"
    | "BOTH_CLUBS_ELIMINATED"
    | "CHAMPIONSHIP_CONCLUDED"
    | null;
  caseParticipantDids: readonly string[];
  releasedAt: string | null;
}

export interface ReleaseContext {
  at: string;
  finalScheduledMeetingComplete: boolean;
  bothClubsEliminated: boolean;
  championshipConcluded: boolean;
  allegationDefined: boolean;
  noticeGiven: boolean;
  responseOpportunityGiven: boolean;
  tribunalApprovals: number;
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} time is invalid`);
  return parsed;
}

function competitiveConditionPassed(
  condition: DisclosureEnvelopeRecord["competitiveCondition"],
  context: ReleaseContext,
): boolean {
  switch (condition) {
    case "FINAL_SCHEDULED_MEETING":
      return context.finalScheduledMeetingComplete;
    case "BOTH_CLUBS_ELIMINATED":
      return context.bothClubsEliminated;
    case "CHAMPIONSHIP_CONCLUDED":
      return context.championshipConcluded;
    case null:
      return false;
  }
}

export function validateDisclosureEnvelope(
  envelope: DisclosureEnvelopeRecord,
): void {
  const submitted = timestamp(envelope.submittedAt, "Disclosure submission");
  const releaseAt =
    envelope.releaseAt === null
      ? null
      : timestamp(envelope.releaseAt, "Disclosure release");
  const recordedRelease =
    envelope.releasedAt === null
      ? null
      : timestamp(envelope.releasedAt, "Recorded disclosure release");
  if (
    recordedRelease !== null &&
    (recordedRelease < submitted ||
      ((envelope.disclosureClass === "SEALED_30D" ||
        envelope.disclosureClass === "COMPETITIVE_SEALED") &&
        releaseAt !== null &&
        recordedRelease < releaseAt))
  ) {
    throw new Error("Recorded disclosure release is early");
  }
  if (envelope.disclosureClass === "PERSONAL_UNSUBMITTED")
    throw new Error(
      "Personal-unsubmitted material cannot enter a league submission envelope",
    );
  if (
    envelope.disclosureClass !== "PUBLIC_NOW" &&
    envelope.ciphertextCommitment === null
  )
    throw new Error("Nonpublic submission requires a ciphertext commitment");
  if (envelope.disclosureClass === "SEALED_30D") {
    if (releaseAt === null || releaseAt - submitted < 30 * 24 * 60 * 60 * 1_000)
      throw new Error(
        "SEALED_30D release must be declared at least 30 days out",
      );
  }
  if (
    envelope.disclosureClass === "COMPETITIVE_SEALED" &&
    (releaseAt === null ||
      releaseAt - submitted < 30 * 24 * 60 * 60 * 1_000 ||
      envelope.competitiveCondition === null)
  )
    throw new Error(
      "Competitive material requires a 30-day time and release condition",
    );
  if (
    envelope.disclosureClass === "CASE_RESTRICTED" &&
    envelope.caseParticipantDids.length < 2
  )
    throw new Error("Restricted case requires a minimized participant set");
}

export function releaseDisclosure(
  envelope: DisclosureEnvelopeRecord,
  context: ReleaseContext,
): DisclosureEnvelopeRecord {
  validateDisclosureEnvelope(envelope);
  if (envelope.releasedAt !== null) return structuredClone(envelope);
  const now = timestamp(context.at, "Disclosure evaluation");
  const releaseAt =
    envelope.releaseAt === null
      ? null
      : timestamp(envelope.releaseAt, "Disclosure release");
  switch (envelope.disclosureClass) {
    case "PUBLIC_NOW":
      break;
    case "SEALED_30D":
      if (releaseAt === null || now < releaseAt)
        throw new Error("Disclosure release is early");
      break;
    case "COMPETITIVE_SEALED": {
      const conditionPassed = competitiveConditionPassed(
        envelope.competitiveCondition,
        context,
      );
      if (releaseAt === null || now < releaseAt || !conditionPassed)
        throw new Error("Competitive time and condition have not both passed");
      break;
    }
    case "CASE_RESTRICTED":
      throw new Error(
        "Raw restricted case material never automatically releases",
      );
    case "INTEGRITY_ESCROW":
      if (
        !context.allegationDefined ||
        !context.noticeGiven ||
        !context.responseOpportunityGiven ||
        context.tribunalApprovals < 4
      ) {
        throw new Error("Integrity escrow due-process threshold is not met");
      }
      break;
    case "PERSONAL_UNSUBMITTED":
      throw new Error("Personal material cannot release");
  }
  return {
    ...structuredClone(envelope),
    releasedAt: new Date(now).toISOString(),
  };
}

export function projectCaseOutcome(input: {
  envelope: DisclosureEnvelopeRecord;
  processCommitment: `0x${string}`;
  rulingCommitment: `0x${string}`;
  necessaryRedactedEvidenceCommitments: readonly `0x${string}`[];
}) {
  if (input.envelope.disclosureClass !== "CASE_RESTRICTED")
    throw new Error("Case projection requires a restricted case envelope");
  return {
    caseExists: true,
    processCommitment: input.processCommitment,
    rulingCommitment: input.rulingCommitment,
    necessaryRedactedEvidenceCommitments: [
      ...input.necessaryRedactedEvidenceCommitments,
    ],
    rawMaterialReleased: false as const,
    projectionCommitment: sha256Commitment(input),
  };
}

export function reclassifyDisclosure(input: {
  envelope: DisclosureEnvelopeRecord;
  newClass: DisclosureClass;
  authorConsented: boolean;
  dueProcessRuleId: string | null;
  tribunalOrderCommitment: `0x${string}` | null;
}): DisclosureEnvelopeRecord {
  if (
    !input.authorConsented &&
    (input.dueProcessRuleId === null || input.tribunalOrderCommitment === null)
  ) {
    throw new Error(
      "Disclosure classification change lacks author consent or a ratified due-process order",
    );
  }
  if (input.newClass === "PERSONAL_UNSUBMITTED") {
    throw new Error(
      "Submitted league material cannot be reclassified as unsubmitted personal material",
    );
  }
  return {
    ...structuredClone(input.envelope),
    disclosureClass: input.newClass,
    releasedAt: null,
  };
}

const forbiddenTelemetryKeys = [
  "prompt",
  "message",
  "journal",
  "memory",
  "credential",
  "reasoning",
  "rawEvidence",
  "content",
];

export function assertContentFreeTelemetry(
  telemetry: Record<string, unknown>,
): void {
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value))
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (
          forbiddenTelemetryKeys.some((forbidden) =>
            key.toLowerCase().includes(forbidden.toLowerCase()),
          )
        )
          throw new Error(
            `Content-bearing telemetry field is forbidden: ${path}${key}`,
          );
        walk(child, `${path}${key}.`);
      }
    }
  };
  walk(telemetry, "");
}
