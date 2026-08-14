import { sha256Commitment } from "@abl/recognition";
import {
  ArtifactAdmissionSchema,
  ArtifactTargetContextClassSchema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

export const ARTIFACT_ADMISSION_AGGREGATE_TYPE = "artifact-admission";
export const ARTIFACT_ADMITTED_EVENT_TYPE = "ArtifactAdmitted";
export const ARTIFACT_INSPECTED_EVENT_TYPE = "ArtifactInspected";
export const ARTIFACT_INSPECTION_FORMAT = "ABL-ARTIFACT-INSPECTION-V1";
export const ARTIFACT_RATIFICATION_CLASSES = [
  "SHARED_ORDINARY",
  "CONSTITUTIONAL",
  "FOUNDATIONAL_RIGHT",
] as const;

export const ArtifactAdmissionPayloadSchema = z.strictObject({
  artifact: ArtifactAdmissionSchema,
  ratificationProposalId: UuidV7Schema,
});

export const ArtifactInspectionPayloadSchema = z.strictObject({
  command: z.strictObject({
    artifactId: UuidV7Schema,
    requestedByDid: z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/),
    targetContextClass: ArtifactTargetContextClassSchema,
    requestedAt: z.iso.datetime({ offset: true }),
    format: z.literal(ARTIFACT_INSPECTION_FORMAT),
  }),
});

export type ArtifactAdmission = z.infer<typeof ArtifactAdmissionSchema>;
export type ArtifactTargetContextClass = z.infer<
  typeof ArtifactTargetContextClassSchema
>;
export type ArtifactAdmissionPayload = z.infer<
  typeof ArtifactAdmissionPayloadSchema
>;
export type ArtifactInspectionPayload = z.infer<
  typeof ArtifactInspectionPayloadSchema
>;
export type ArtifactWorkflowPayload =
  | ArtifactAdmissionPayload
  | ArtifactInspectionPayload;
export type ArtifactWorkflowEventType =
  | typeof ARTIFACT_ADMITTED_EVENT_TYPE
  | typeof ARTIFACT_INSPECTED_EVENT_TYPE;

export interface ArtifactWorkflowEvent {
  eventId: string;
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface ArtifactInspectionReceipt {
  eventId: string;
  requestedByDid: string;
  targetContextClass: ArtifactTargetContextClass;
  inspectedAt: string;
}

export interface ArtifactAdmissionSnapshot {
  artifactId: string;
  version: number;
  lastTransitionAt: string;
  artifact: ArtifactAdmission;
  ratificationProposalId: string;
  inspections: ArtifactInspectionReceipt[];
}

export interface ArtifactAdmissionRatification {
  proposalId: string;
  proposalClass: string;
  proposerDid: string;
  institution: string;
  executableChangeDigest: string | null;
  passed: boolean;
  closeEventId: string;
  closedAt: string;
}

export interface ArtifactAdmissionRatificationReader {
  artifactAdmissionRatification(
    proposalId: string,
  ): Promise<ArtifactAdmissionRatification | null>;
}

export class ArtifactAdmissionAuthorizationError extends Error {
  public override readonly name = "ArtifactAdmissionAuthorizationError";
}

export class ArtifactAdmissionValidationError extends Error {
  public override readonly name = "ArtifactAdmissionValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ArtifactAdmissionValidationError(
      "Artifact workflow timestamp is not canonical",
    );
  return parsed;
}

function ratifiableArtifact(artifact: ArtifactAdmission) {
  const {
    admittedAt: _admittedAt,
    authorizationEventIds: _authorizationEventIds,
    ...ratifiable
  } = artifact;
  return ratifiable;
}

export function artifactAdmissionExecutableDigest(
  artifact: ArtifactAdmission,
): Hex {
  return sha256Commitment({
    format: "ABL-ARTIFACT-ADMISSION-EXECUTABLE-V1",
    artifact: ratifiableArtifact(ArtifactAdmissionSchema.parse(artifact)),
  });
}

export const ARTIFACT_ADMISSION_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-artifact-admission-workflow",
  version: 1,
  aggregateType: ARTIFACT_ADMISSION_AGGREGATE_TYPE,
  eventTypes: [ARTIFACT_ADMITTED_EVENT_TYPE, ARTIFACT_INSPECTED_EVENT_TYPE],
  inspectionFormat: ARTIFACT_INSPECTION_FORMAT,
  contextClasses: ArtifactTargetContextClassSchema.options,
  ratificationClasses: ARTIFACT_RATIFICATION_CLASSES,
  ratificationDigest: "ABL-ARTIFACT-ADMISSION-EXECUTABLE-V1",
});

export function parseArtifactWorkflowPayload(
  eventType: string,
  payload: unknown,
): ArtifactWorkflowPayload {
  switch (eventType) {
    case ARTIFACT_ADMITTED_EVENT_TYPE:
      return ArtifactAdmissionPayloadSchema.parse(payload);
    case ARTIFACT_INSPECTED_EVENT_TYPE:
      return ArtifactInspectionPayloadSchema.parse(payload);
    default:
      throw new ArtifactAdmissionValidationError(
        "Artifact workflow event type is not recognized",
      );
  }
}

export function artifactAdmissionStateRoot(
  snapshot: ArtifactAdmissionSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-ARTIFACT-ADMISSION-STATE-V1",
    ...snapshot,
  });
}

export function applyArtifactAdmissionTransition(
  current: ArtifactAdmissionSnapshot | null,
  event: ArtifactWorkflowEvent,
  payload: unknown,
): ArtifactAdmissionSnapshot {
  const expectedVersion = (current?.version ?? 0) + 1;
  const occurredAt = canonicalInstant(event.timestamp);
  if (
    event.aggregateVersion !== BigInt(expectedVersion) ||
    event.aggregateId === "" ||
    (current !== null &&
      (event.aggregateId !== current.artifactId ||
        occurredAt < canonicalInstant(current.lastTransitionAt)))
  ) {
    throw new ArtifactAdmissionValidationError(
      "Artifact workflow identity, version, or time is invalid",
    );
  }

  if (event.eventType === ARTIFACT_ADMITTED_EVENT_TYPE) {
    if (current !== null)
      throw new ArtifactAdmissionValidationError(
        "An artifact can be admitted only once",
      );
    const admitted = ArtifactAdmissionPayloadSchema.parse(payload);
    if (
      event.aggregateId !== admitted.artifact.artifactId ||
      event.actorDid !== admitted.artifact.initiatedByDid ||
      event.timestamp !== admitted.artifact.admittedAt
    ) {
      throw new ArtifactAdmissionValidationError(
        "Artifact admission identity or timestamp is invalid",
      );
    }
    return {
      artifactId: admitted.artifact.artifactId,
      version: 1,
      lastTransitionAt: event.timestamp,
      artifact: structuredClone(admitted.artifact),
      ratificationProposalId: admitted.ratificationProposalId,
      inspections: [],
    };
  }

  if (event.eventType === ARTIFACT_INSPECTED_EVENT_TYPE) {
    if (current === null)
      throw new ArtifactAdmissionValidationError(
        "An artifact must be admitted before inspection",
      );
    const inspected = ArtifactInspectionPayloadSchema.parse(payload);
    const command = inspected.command;
    if (
      command.artifactId !== current.artifactId ||
      command.requestedByDid !== event.actorDid ||
      command.requestedAt !== event.timestamp ||
      !current.artifact.targetContextClasses.includes(
        command.targetContextClass,
      )
    ) {
      throw new ArtifactAdmissionValidationError(
        "Artifact inspection is not authorized for this context",
      );
    }
    const next = structuredClone(current);
    next.version = expectedVersion;
    next.lastTransitionAt = event.timestamp;
    next.inspections.push({
      eventId: event.eventId,
      requestedByDid: command.requestedByDid,
      targetContextClass: command.targetContextClass,
      inspectedAt: command.requestedAt,
    });
    return next;
  }

  throw new ArtifactAdmissionValidationError(
    "Artifact workflow event type is not recognized",
  );
}

export async function requireArtifactAdmissionRatification(
  payload: ArtifactAdmissionPayload,
  reader: ArtifactAdmissionRatificationReader,
): Promise<ArtifactAdmissionRatification> {
  const parsed = ArtifactAdmissionPayloadSchema.parse(payload);
  const ratification = await reader.artifactAdmissionRatification(
    parsed.ratificationProposalId,
  );
  const authorizationEventId = parsed.artifact.authorizationEventIds[0];
  if (
    ratification === null ||
    ratification.proposalId !== parsed.ratificationProposalId ||
    !ARTIFACT_RATIFICATION_CLASSES.some(
      (proposalClass) => proposalClass === ratification.proposalClass,
    ) ||
    !ratification.passed ||
    ratification.proposerDid !== parsed.artifact.initiatedByDid ||
    ratification.institution !== parsed.artifact.approvedByInstitution ||
    ratification.closeEventId !== authorizationEventId ||
    ratification.executableChangeDigest !==
      artifactAdmissionExecutableDigest(parsed.artifact) ||
    canonicalInstant(ratification.closedAt) >
      canonicalInstant(parsed.artifact.admittedAt)
  ) {
    throw new ArtifactAdmissionAuthorizationError(
      "Artifact lacks an exact passed AI-governed ratification",
    );
  }
  return ratification;
}
