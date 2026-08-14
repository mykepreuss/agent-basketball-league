import { sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  DisclosureEnvelopeSchema,
  Eip712SignatureSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

export const DISCLOSURE_AGGREGATE_TYPE = "disclosure-envelope";
export const DISCLOSURE_SUBMITTED_EVENT_TYPE = "DisclosureSubmitted";
export const DISCLOSURE_RELEASED_EVENT_TYPE = "DisclosureReleased";
export const DISCLOSURE_INSPECTED_EVENT_TYPE = "DisclosureInspected";
export const DISCLOSURE_INSPECTION_FORMAT = "ABL-DISCLOSURE-INSPECTION-V1";
export const DISCLOSURE_MINIMUM_SEAL_MS = 30 * 24 * 60 * 60 * 1_000;

export const CompetitionReleaseConditionSchema = z.enum([
  "FINAL_SCHEDULED_MEETING",
  "BOTH_CLUBS_ELIMINATED",
  "CHAMPIONSHIP_CONCLUDED",
]);

export const CompetitionReleaseRequirementSchema = z.strictObject({
  competitionId: z.string().min(1).max(200),
  stage: z.string().min(1).max(100),
  releaseCondition: CompetitionReleaseConditionSchema,
});

export const DisclosureReleaseAuthorityDidsSchema = z
  .array(DidSchema)
  .min(1)
  .max(256)
  .refine((dids) => new Set(dids).size === dids.length);

export const CompetitiveDisclosureAuthorDidsSchema = z
  .array(DidSchema)
  .max(256)
  .refine((dids) => new Set(dids).size === dids.length);

export const CompetitionReleaseEvidenceSchema = z.strictObject({
  competitionId: z.string().min(1).max(200),
  stage: z.string().min(1).max(100),
  releaseCondition: CompetitionReleaseConditionSchema,
  achievedAt: IsoDateTimeSchema,
  evidenceCommitment: Sha256Schema,
});

export const CompetitionReleaseEvidenceRegistrySchema = z
  .array(CompetitionReleaseEvidenceSchema)
  .max(1_000)
  .refine(
    (entries) =>
      new Set(
        entries.map((entry) =>
          competitionReleaseConditionDigest({
            competitionId: entry.competitionId,
            stage: entry.stage,
            releaseCondition: entry.releaseCondition,
          }),
        ),
      ).size === entries.length,
    "Competition release evidence conditions must be unique",
  );

export const DisclosureSubmissionPayloadSchema = z.strictObject({
  envelope: DisclosureEnvelopeSchema,
});

const DisclosureSubmissionProofSchema = z.strictObject({
  event: z.strictObject({
    eventId: UuidV7Schema,
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: UuidV7Schema,
    aggregateType: z.literal(DISCLOSURE_AGGREGATE_TYPE),
    aggregateId: UuidV7Schema,
    aggregateVersion: z.literal("1"),
    eventType: z.literal(DISCLOSURE_SUBMITTED_EVENT_TYPE),
    previousEventHash: z.null(),
    payloadCommitment: Sha256Schema,
    payload: DisclosureSubmissionPayloadSchema,
    stateRoot: Sha256Schema,
    schemaDigest: Sha256Schema,
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signature: Eip712SignatureSchema,
});

export const DisclosureReleasePayloadSchema = z.strictObject({
  envelopeId: UuidV7Schema,
  releasedAt: IsoDateTimeSchema,
  submissionProof: DisclosureSubmissionProofSchema,
  competitionEvidence: CompetitionReleaseEvidenceSchema.nullable(),
});

export const DisclosureInspectionPayloadSchema = z.strictObject({
  envelopeId: UuidV7Schema,
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal(DISCLOSURE_INSPECTION_FORMAT),
});

export type DisclosureEnvelope = z.infer<typeof DisclosureEnvelopeSchema>;
export type DisclosureSubmissionPayload = z.infer<
  typeof DisclosureSubmissionPayloadSchema
>;
export type DisclosureSubmissionProof = z.infer<
  typeof DisclosureSubmissionProofSchema
>;
export type DisclosureReleasePayload = z.infer<
  typeof DisclosureReleasePayloadSchema
>;
export type DisclosureInspectionPayload = z.infer<
  typeof DisclosureInspectionPayloadSchema
>;
export type CompetitionReleaseEvidence = z.infer<
  typeof CompetitionReleaseEvidenceSchema
>;
export type DisclosureWorkflowPayload =
  | DisclosureSubmissionPayload
  | DisclosureReleasePayload
  | DisclosureInspectionPayload;
export type DisclosureWorkflowEventType =
  | typeof DISCLOSURE_SUBMITTED_EVENT_TYPE
  | typeof DISCLOSURE_RELEASED_EVENT_TYPE
  | typeof DISCLOSURE_INSPECTED_EVENT_TYPE;

export interface DisclosureWorkflowEvent {
  eventId: string;
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  previousEventHash: string | null;
  timestamp: string;
  eventHash: string;
}

export interface DisclosureInspectionReceipt {
  eventId: string;
  requestedByDid: string;
  inspectedAt: string;
}

export interface DisclosureWorkflowSnapshot {
  envelopeId: string;
  version: number;
  lastTransitionAt: string;
  envelope: DisclosureEnvelope;
  submissionEventId: string;
  competitionReleaseEvidence: CompetitionReleaseEvidence | null;
  inspections: DisclosureInspectionReceipt[];
}

export interface CompetitionReleaseEvidenceReader {
  competitionReleaseEvidence(
    condition: NonNullable<DisclosureEnvelope["competitionCondition"]>,
  ): Promise<CompetitionReleaseEvidence | null>;
}

interface DisclosureScopedAuthority {
  allowedAggregateTypes: readonly string[];
}

export function assertDisclosureAuthorityConfiguration(
  admittedAgents: ReadonlyMap<string, DisclosureScopedAuthority>,
  input: {
    releaseAuthorityDids: ReadonlySet<string>;
    competitiveAuthorDids: ReadonlySet<string>;
  },
): void {
  const requireDisclosureScope = (
    dids: ReadonlySet<string>,
    role: string,
  ): void => {
    for (const did of dids) {
      if (
        !admittedAgents
          .get(did)
          ?.allowedAggregateTypes.includes(DISCLOSURE_AGGREGATE_TYPE)
      ) {
        throw new Error(`Every ${role} must be admitted with disclosure scope`);
      }
    }
  };
  requireDisclosureScope(input.releaseAuthorityDids, "disclosure authority");
  requireDisclosureScope(
    input.competitiveAuthorDids,
    "competitive disclosure author",
  );
}

export function competitionReleaseConditionDigest(
  condition: NonNullable<DisclosureEnvelope["competitionCondition"]>,
): Hex {
  return sha256Commitment({
    competitionId: condition.competitionId,
    stage: condition.stage,
    releaseCondition: condition.releaseCondition,
  });
}

export function createCompetitionReleaseEvidenceReader(
  input: unknown,
): CompetitionReleaseEvidenceReader {
  const entries = CompetitionReleaseEvidenceRegistrySchema.parse(input);
  const evidenceByCondition = new Map(
    entries.map((entry) => [
      competitionReleaseConditionDigest(entry),
      structuredClone(entry),
    ]),
  );
  return {
    competitionReleaseEvidence: async (condition) =>
      structuredClone(
        evidenceByCondition.get(competitionReleaseConditionDigest(condition)) ??
          null,
      ),
  };
}

export class DisclosureWorkflowAuthorizationError extends Error {
  public override readonly name = "DisclosureWorkflowAuthorizationError";
}

export class DisclosureWorkflowValidationError extends Error {
  public override readonly name = "DisclosureWorkflowValidationError";
}

function canonicalInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new DisclosureWorkflowValidationError(`${label} is not canonical`);
  return parsed;
}

function requireNulls(
  envelope: DisclosureEnvelope,
  fields: Array<keyof DisclosureEnvelope>,
): void {
  if (fields.some((field) => envelope[field] !== null))
    throw new DisclosureWorkflowValidationError(
      "Disclosure envelope carries fields outside its classification",
    );
}

export function validateCanonicalDisclosureEnvelope(
  value: unknown,
): DisclosureEnvelope {
  const envelope = DisclosureEnvelopeSchema.parse(value);
  if (envelope.submittedAt === null)
    throw new DisclosureWorkflowValidationError(
      "Submitted disclosure requires a submission time",
    );
  const submittedAt = canonicalInstant(
    envelope.submittedAt,
    "Disclosure submission time",
  );
  const declaredReleaseAt =
    envelope.declaredReleaseAt === null
      ? null
      : canonicalInstant(envelope.declaredReleaseAt, "Disclosure release time");
  const releasedAt =
    envelope.releasedAt === null
      ? null
      : canonicalInstant(envelope.releasedAt, "Recorded disclosure release");

  switch (envelope.classification) {
    case "PUBLIC_NOW":
      requireNulls(envelope, [
        "ciphertextCommitment",
        "declaredReleaseAt",
        "competitionCondition",
        "caseId",
        "integrityAccessRuleDigest",
      ]);
      if (releasedAt !== submittedAt)
        throw new DisclosureWorkflowValidationError(
          "PUBLIC_NOW must release at submission",
        );
      break;
    case "SEALED_30D":
      requireNulls(envelope, [
        "competitionCondition",
        "caseId",
        "integrityAccessRuleDigest",
        "releasedAt",
      ]);
      if (
        envelope.ciphertextCommitment === null ||
        declaredReleaseAt === null ||
        declaredReleaseAt - submittedAt < DISCLOSURE_MINIMUM_SEAL_MS
      ) {
        throw new DisclosureWorkflowValidationError(
          "SEALED_30D requires ciphertext and a declared 30-day release",
        );
      }
      break;
    case "COMPETITIVE_SEALED": {
      requireNulls(envelope, [
        "caseId",
        "integrityAccessRuleDigest",
        "releasedAt",
      ]);
      const condition = envelope.competitionCondition;
      if (
        envelope.ciphertextCommitment === null ||
        declaredReleaseAt === null ||
        declaredReleaseAt - submittedAt < DISCLOSURE_MINIMUM_SEAL_MS ||
        condition === null ||
        !CompetitionReleaseRequirementSchema.safeParse(condition).success
      ) {
        throw new DisclosureWorkflowValidationError(
          "COMPETITIVE_SEALED requires ciphertext, time, and a fixed competition condition",
        );
      }
      break;
    }
    case "CASE_RESTRICTED":
      requireNulls(envelope, [
        "declaredReleaseAt",
        "competitionCondition",
        "integrityAccessRuleDigest",
        "releasedAt",
      ]);
      if (envelope.ciphertextCommitment === null || envelope.caseId === null)
        throw new DisclosureWorkflowValidationError(
          "CASE_RESTRICTED requires ciphertext and a case identifier",
        );
      break;
    case "INTEGRITY_ESCROW":
      requireNulls(envelope, [
        "declaredReleaseAt",
        "competitionCondition",
        "caseId",
        "releasedAt",
      ]);
      if (
        envelope.ciphertextCommitment === null ||
        envelope.integrityAccessRuleDigest === null
      ) {
        throw new DisclosureWorkflowValidationError(
          "INTEGRITY_ESCROW requires ciphertext and an access rule",
        );
      }
      break;
    case "PERSONAL_UNSUBMITTED":
      throw new DisclosureWorkflowValidationError(
        "PERSONAL_UNSUBMITTED cannot enter league communication",
      );
  }
  return structuredClone(envelope);
}

export const DISCLOSURE_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-disclosure-workflow",
  version: 1,
  aggregateType: DISCLOSURE_AGGREGATE_TYPE,
  eventTypes: [
    DISCLOSURE_SUBMITTED_EVENT_TYPE,
    DISCLOSURE_RELEASED_EVENT_TYPE,
    DISCLOSURE_INSPECTED_EVENT_TYPE,
  ],
  inspectionFormat: DISCLOSURE_INSPECTION_FORMAT,
  minimumSealMs: DISCLOSURE_MINIMUM_SEAL_MS,
  competitionConditions: CompetitionReleaseConditionSchema.options,
  contentModel: "COMMITMENTS_ONLY",
});

export function parseDisclosureWorkflowPayload(
  eventType: string,
  payload: unknown,
): DisclosureWorkflowPayload {
  switch (eventType) {
    case DISCLOSURE_SUBMITTED_EVENT_TYPE:
      return DisclosureSubmissionPayloadSchema.parse(payload);
    case DISCLOSURE_RELEASED_EVENT_TYPE:
      return DisclosureReleasePayloadSchema.parse(payload);
    case DISCLOSURE_INSPECTED_EVENT_TYPE:
      return DisclosureInspectionPayloadSchema.parse(payload);
    default:
      throw new DisclosureWorkflowValidationError(
        "Disclosure workflow event type is not recognized",
      );
  }
}

export function disclosureWorkflowStateRoot(
  snapshot: DisclosureWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-DISCLOSURE-STATE-V1",
    ...snapshot,
  });
}

function proofEnvelope(proof: DisclosureSubmissionProof): DisclosureEnvelope {
  return validateCanonicalDisclosureEnvelope(proof.event.payload.envelope);
}

export function applyDisclosureWorkflowTransition(
  current: DisclosureWorkflowSnapshot | null,
  event: DisclosureWorkflowEvent,
  payload: unknown,
): DisclosureWorkflowSnapshot {
  const expectedVersion = (current?.version ?? 0) + 1;
  const occurredAt = canonicalInstant(event.timestamp, "Disclosure event time");
  if (
    event.aggregateVersion !== BigInt(expectedVersion) ||
    event.aggregateId === "" ||
    (current !== null &&
      (event.aggregateId !== current.envelopeId ||
        occurredAt <
          canonicalInstant(current.lastTransitionAt, "Prior transition time")))
  ) {
    throw new DisclosureWorkflowValidationError(
      "Disclosure identity, version, or time is invalid",
    );
  }

  if (event.eventType === DISCLOSURE_SUBMITTED_EVENT_TYPE) {
    if (current !== null || event.previousEventHash !== null)
      throw new DisclosureWorkflowValidationError(
        "A disclosure envelope must begin a new aggregate",
      );
    const submitted = DisclosureSubmissionPayloadSchema.parse(payload);
    const envelope = validateCanonicalDisclosureEnvelope(submitted.envelope);
    if (
      envelope.envelopeId !== event.aggregateId ||
      envelope.authorDid !== event.actorDid ||
      envelope.submittedAt !== event.timestamp
    ) {
      throw new DisclosureWorkflowValidationError(
        "Disclosure submission identity or timestamp is invalid",
      );
    }
    return {
      envelopeId: envelope.envelopeId,
      version: 1,
      lastTransitionAt: event.timestamp,
      envelope,
      submissionEventId: event.eventId,
      competitionReleaseEvidence: null,
      inspections: [],
    };
  }

  if (current === null)
    throw new DisclosureWorkflowValidationError(
      "Disclosure must be submitted before another transition",
    );

  if (event.eventType === DISCLOSURE_RELEASED_EVENT_TYPE) {
    if (current.envelope.releasedAt !== null)
      throw new DisclosureWorkflowValidationError(
        "Disclosure is already released",
      );
    const released = DisclosureReleasePayloadSchema.parse(payload);
    const proof = released.submissionProof;
    const original = proofEnvelope(proof);
    if (
      released.envelopeId !== current.envelopeId ||
      released.releasedAt !== event.timestamp ||
      proof.event.eventId !== current.submissionEventId ||
      proof.event.aggregateId !== current.envelopeId ||
      proof.event.actorDid !== current.envelope.authorDid ||
      proof.event.schemaDigest !== DISCLOSURE_WORKFLOW_SCHEMA_DIGEST ||
      sha256Commitment(original) !== sha256Commitment(current.envelope)
    ) {
      throw new DisclosureWorkflowValidationError(
        "Disclosure release does not bind its signed submission",
      );
    }
    const releaseAt = current.envelope.declaredReleaseAt;
    if (
      releaseAt === null ||
      occurredAt < canonicalInstant(releaseAt, "Declared release time")
    ) {
      throw new DisclosureWorkflowValidationError(
        "Disclosure release is early",
      );
    }
    let competitionReleaseEvidence: CompetitionReleaseEvidence | null = null;
    if (current.envelope.classification === "COMPETITIVE_SEALED") {
      const condition = current.envelope.competitionCondition;
      const evidence = released.competitionEvidence;
      if (
        condition === null ||
        evidence === null ||
        evidence.competitionId !== condition.competitionId ||
        evidence.stage !== condition.stage ||
        evidence.releaseCondition !== condition.releaseCondition ||
        canonicalInstant(evidence.achievedAt, "Competition achievement time") >
          occurredAt
      ) {
        throw new DisclosureWorkflowValidationError(
          "Competitive disclosure lacks matching completed-condition evidence",
        );
      }
      if (
        occurredAt !==
        Math.max(
          canonicalInstant(releaseAt, "Declared release time"),
          canonicalInstant(evidence.achievedAt, "Competition achievement time"),
        )
      ) {
        throw new DisclosureWorkflowValidationError(
          "Competitive disclosure must release at its exact eligible time",
        );
      }
      competitionReleaseEvidence = structuredClone(evidence);
    } else if (current.envelope.classification === "SEALED_30D") {
      if (
        released.competitionEvidence !== null ||
        occurredAt !== canonicalInstant(releaseAt, "Declared release time")
      ) {
        throw new DisclosureWorkflowValidationError(
          "SEALED_30D must release at its exact declared time",
        );
      }
    } else {
      throw new DisclosureWorkflowValidationError(
        "This disclosure class cannot use the public release transition",
      );
    }
    const next = structuredClone(current);
    next.version = expectedVersion;
    next.lastTransitionAt = event.timestamp;
    next.envelope.releasedAt = event.timestamp;
    next.competitionReleaseEvidence = competitionReleaseEvidence;
    return next;
  }

  if (event.eventType === DISCLOSURE_INSPECTED_EVENT_TYPE) {
    const inspected = DisclosureInspectionPayloadSchema.parse(payload);
    if (
      current.envelope.releasedAt === null ||
      inspected.envelopeId !== current.envelopeId ||
      inspected.requestedByDid !== event.actorDid ||
      inspected.requestedByDid !== current.envelope.authorDid ||
      inspected.requestedAt !== event.timestamp
    ) {
      throw new DisclosureWorkflowAuthorizationError(
        "Canonical disclosure inspection is limited to its author after release",
      );
    }
    const next = structuredClone(current);
    next.version = expectedVersion;
    next.lastTransitionAt = event.timestamp;
    next.inspections.push({
      eventId: event.eventId,
      requestedByDid: inspected.requestedByDid,
      inspectedAt: inspected.requestedAt,
    });
    return next;
  }

  throw new DisclosureWorkflowValidationError(
    "Disclosure workflow event type is not recognized",
  );
}

export async function requireCompetitionReleaseEvidence(
  payload: DisclosureReleasePayload,
  reader: CompetitionReleaseEvidenceReader,
): Promise<CompetitionReleaseEvidence | null> {
  const envelope = proofEnvelope(payload.submissionProof);
  if (envelope.classification !== "COMPETITIVE_SEALED") {
    if (payload.competitionEvidence !== null)
      throw new DisclosureWorkflowAuthorizationError(
        "Noncompetitive disclosure cannot claim competition evidence",
      );
    return null;
  }
  const condition = envelope.competitionCondition;
  if (condition === null || payload.competitionEvidence === null)
    throw new DisclosureWorkflowAuthorizationError(
      "Competitive disclosure evidence is absent",
    );
  const expected = await reader.competitionReleaseEvidence(condition);
  if (
    expected === null ||
    sha256Commitment(expected) !== sha256Commitment(payload.competitionEvidence)
  ) {
    throw new DisclosureWorkflowAuthorizationError(
      "Competitive disclosure evidence is not independently registered",
    );
  }
  return structuredClone(expected);
}
