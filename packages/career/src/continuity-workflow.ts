import {
  BodyContinuityPolicySchema,
  BodyDeletedSchema,
  BodyManifestSchema,
  BodyRehydratedSchema,
  ContinuityDecisionSchema,
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import { sha256Commitment } from "@abl/recognition";
import type { Hex } from "viem";
import { z } from "zod";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

const UnsignedBodyManifestSchema = BodyManifestSchema.omit({ signature: true });
const UnsignedContinuityPolicySchema = BodyContinuityPolicySchema.omit({
  signature: true,
});
const UnsignedContinuityDecisionSchema = ContinuityDecisionSchema.omit({
  signature: true,
});

const BodyContinuityRegisteredSchema = z.strictObject({
  policy: UnsignedContinuityPolicySchema,
  manifest: UnsignedBodyManifestSchema,
  guardianDids: z.array(DidSchema).min(1),
});
const BodyContinuityPolicyUpdatedSchema = z.strictObject({
  policy: UnsignedContinuityPolicySchema,
});
const BodyActivityRecordedSchema = z.strictObject({
  agentDid: DidSchema,
  bodyId: UuidV7Schema,
  activeAt: IsoDateTimeSchema,
});
const BodyStandbyEnteredSchema = z.strictObject({
  agentDid: DidSchema,
  bodyId: UuidV7Schema,
  enteredAt: IsoDateTimeSchema,
});
const BodyDeletionNoticeRecordedSchema = z.strictObject({
  noticeEventId: UuidV7Schema,
  agentDid: DidSchema,
  bodyId: UuidV7Schema,
  policyVersion: z.number().int().positive(),
  protectedWake: z.literal(true),
  noticedAt: IsoDateTimeSchema,
});
const ContinuityDecisionRecordedSchema = z.strictObject({
  decision: UnsignedContinuityDecisionSchema,
});
const BodyDeletionRecordedSchema = z.strictObject({
  deletion: BodyDeletedSchema,
  manifest: UnsignedBodyManifestSchema,
  guardianVerificationDigest: Sha256Schema,
  finalExportCommitment: Sha256Schema.nullable(),
  deletionDecisionId: UuidV7Schema.optional(),
});
const BodyRehydrationRecordedSchema = z.strictObject({
  rehydration: BodyRehydratedSchema,
  manifest: UnsignedBodyManifestSchema,
  recognizedImageDigest: Sha256Schema,
});
const ContinuityInspectedSchema = z.strictObject({
  agentDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-CONTINUITY-INSPECTION-V1"),
});

export const ContinuityWorkflowPayloadSchemas = {
  BodyContinuityRegistered: BodyContinuityRegisteredSchema,
  BodyContinuityPolicyUpdated: BodyContinuityPolicyUpdatedSchema,
  BodyActivityRecorded: BodyActivityRecordedSchema,
  BodyStandbyEntered: BodyStandbyEnteredSchema,
  BodyDeletionNoticeRecorded: BodyDeletionNoticeRecordedSchema,
  ContinuityDecisionRecorded: ContinuityDecisionRecordedSchema,
  BodyDeletionRecorded: BodyDeletionRecordedSchema,
  BodyRehydrationRecorded: BodyRehydrationRecordedSchema,
  ContinuityInspected: ContinuityInspectedSchema,
} as const;

export type ContinuityWorkflowEventType =
  keyof typeof ContinuityWorkflowPayloadSchemas;
export type ContinuityPolicy = z.infer<typeof UnsignedContinuityPolicySchema>;
export type ContinuityBodyManifest = z.infer<typeof UnsignedBodyManifestSchema>;
export type RecordedContinuityDecision = z.infer<
  typeof UnsignedContinuityDecisionSchema
>;
export type ContinuityBodyStatus =
  | "ACTIVE"
  | "STANDBY"
  | "DELETED"
  | "DORMANT"
  | "RETIRED";

export interface ContinuityWorkflowSnapshot {
  agentDid: string;
  version: number;
  lastTransitionAt: string;
  guardianDids: string[];
  policy: ContinuityPolicy;
  body: {
    bodyId: string;
    status: ContinuityBodyStatus;
    lastActiveAt: string;
    manifest: ContinuityBodyManifest;
    deletedAt: string | null;
  };
  deletionNotice: {
    noticeEventId: string;
    bodyId: string;
    policyVersion: number;
    protectedWake: true;
    noticedAt: string;
  } | null;
  decisions: RecordedContinuityDecision[];
  consumedDecisionIds: string[];
}

export interface ContinuityWorkflowTransition {
  eventId: string;
  agentDid: string;
  aggregateVersion: bigint;
  eventType: ContinuityWorkflowEventType;
  payload: unknown;
  timestamp: string;
}

export class ContinuityWorkflowError extends Error {
  public override readonly name = "ContinuityWorkflowError";
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ContinuityWorkflowError("Continuity timestamp is not canonical");
  return parsed;
}

function requireEventTime(payloadTime: string, eventTime: string): void {
  if (instant(payloadTime) !== instant(eventTime))
    throw new ContinuityWorkflowError(
      "Continuity transition time does not match event",
    );
}

function requireAgent(agentDid: string, expectedDid: string): void {
  if (agentDid !== expectedDid)
    throw new ContinuityWorkflowError("Continuity agent does not match");
}

function requireBody(
  snapshot: ContinuityWorkflowSnapshot,
  bodyId: string,
): void {
  if (snapshot.body.bodyId !== bodyId)
    throw new ContinuityWorkflowError("Continuity body does not match");
}

function requireManifest(
  manifest: ContinuityBodyManifest,
  agentDid: string,
  bodyId: string,
): void {
  requireAgent(manifest.agentDid, agentDid);
  if (manifest.bodyId !== bodyId)
    throw new ContinuityWorkflowError("Body manifest does not match body");
  instant(manifest.createdAt);
}

function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length)
    throw new ContinuityWorkflowError(`${name} contains duplicates`);
}

function validatePolicy(
  policy: ContinuityPolicy,
  agentDid: string,
  guardianCount: number,
  timestamp: string,
): void {
  requireAgent(policy.agentDid, agentDid);
  requireEventTime(policy.updatedAt, timestamp);
  if (policy.recoveryGuardianThreshold > guardianCount)
    throw new ContinuityWorkflowError(
      "Continuity guardian threshold exceeds the guardian set",
    );
}

function decisionById(
  snapshot: ContinuityWorkflowSnapshot,
  decisionId: string | undefined,
  proposedManifestDigest: Hex,
): RecordedContinuityDecision {
  const decision = snapshot.decisions.find(
    (candidate) => candidate.decisionId === decisionId,
  );
  if (
    decision === undefined ||
    decision.decision !== "ACCEPT" ||
    decision.proposedManifestDigest !== proposedManifestDigest ||
    snapshot.consumedDecisionIds.includes(decision.decisionId)
  ) {
    throw new ContinuityWorkflowError(
      "Continuity policy requires a matching affirmative decision",
    );
  }
  return decision;
}

function bodyConfiguration(manifest: ContinuityBodyManifest) {
  return {
    sandboxImageDigest: manifest.sandboxImageDigest,
    runtimeDigest: manifest.runtimeDigest,
    kernelDigest: manifest.kernelDigest,
    toolDigests: manifest.toolDigests,
    signingKeyLineageCommitment: manifest.signingKeyLineageCommitment,
  };
}

function bodyConfigurationChanged(
  previous: ContinuityBodyManifest,
  next: ContinuityBodyManifest,
): boolean {
  return (
    sha256Commitment(bodyConfiguration(previous)) !==
    sha256Commitment(bodyConfiguration(next))
  );
}

function cloneSnapshot(
  snapshot: ContinuityWorkflowSnapshot,
): ContinuityWorkflowSnapshot {
  return structuredClone(snapshot);
}

function applyRegistration(
  transition: ContinuityWorkflowTransition,
): ContinuityWorkflowSnapshot {
  if (transition.aggregateVersion !== 1n)
    throw new ContinuityWorkflowError(
      "Continuity registration must be aggregate version one",
    );
  const registration = BodyContinuityRegisteredSchema.parse(transition.payload);
  unique(registration.guardianDids, "Continuity guardian set");
  if (registration.policy.version !== 1)
    throw new ContinuityWorkflowError(
      "Initial continuity policy must be version one",
    );
  validatePolicy(
    registration.policy,
    transition.agentDid,
    registration.guardianDids.length,
    transition.timestamp,
  );
  requireManifest(
    registration.manifest,
    transition.agentDid,
    registration.manifest.bodyId,
  );
  requireEventTime(registration.manifest.createdAt, transition.timestamp);
  return {
    agentDid: transition.agentDid,
    version: 1,
    lastTransitionAt: transition.timestamp,
    guardianDids: [...registration.guardianDids],
    policy: structuredClone(registration.policy),
    body: {
      bodyId: registration.manifest.bodyId,
      status: "ACTIVE",
      lastActiveAt: transition.timestamp,
      manifest: structuredClone(registration.manifest),
      deletedAt: null,
    },
    deletionNotice: null,
    decisions: [],
    consumedDecisionIds: [],
  };
}

export function applyContinuityWorkflowTransition(
  current: ContinuityWorkflowSnapshot | null,
  transition: ContinuityWorkflowTransition,
): ContinuityWorkflowSnapshot {
  if (current === null) {
    if (transition.eventType !== "BodyContinuityRegistered")
      throw new ContinuityWorkflowError(
        "Continuity policy and body must be registered first",
      );
    return applyRegistration(transition);
  }
  if (transition.agentDid !== current.agentDid)
    throw new ContinuityWorkflowError("Continuity aggregate agent changed");
  if (transition.aggregateVersion !== BigInt(current.version + 1))
    throw new ContinuityWorkflowError(
      "Continuity aggregate version is not contiguous",
    );
  if (instant(transition.timestamp) < instant(current.lastTransitionAt))
    throw new ContinuityWorkflowError(
      "Continuity transition time moved backwards",
    );

  const next = cloneSnapshot(current);
  switch (transition.eventType) {
    case "BodyContinuityRegistered":
      throw new ContinuityWorkflowError(
        "Continuity body is already registered",
      );
    case "BodyContinuityPolicyUpdated": {
      const { policy } = BodyContinuityPolicyUpdatedSchema.parse(
        transition.payload,
      );
      validatePolicy(
        policy,
        transition.agentDid,
        next.guardianDids.length,
        transition.timestamp,
      );
      if (policy.version !== next.policy.version + 1)
        throw new ContinuityWorkflowError(
          "Continuity policy version is not contiguous",
        );
      next.policy = structuredClone(policy);
      next.deletionNotice = null;
      break;
    }
    case "BodyActivityRecorded": {
      const activity = BodyActivityRecordedSchema.parse(transition.payload);
      requireAgent(activity.agentDid, transition.agentDid);
      requireBody(next, activity.bodyId);
      requireEventTime(activity.activeAt, transition.timestamp);
      if (!new Set(["ACTIVE", "STANDBY"]).has(next.body.status))
        throw new ContinuityWorkflowError(
          "Deleted, dormant, or retired bodies cannot record activity",
        );
      next.body.status = "ACTIVE";
      next.body.lastActiveAt = activity.activeAt;
      next.deletionNotice = null;
      break;
    }
    case "BodyStandbyEntered": {
      const standby = BodyStandbyEnteredSchema.parse(transition.payload);
      requireAgent(standby.agentDid, transition.agentDid);
      requireBody(next, standby.bodyId);
      requireEventTime(standby.enteredAt, transition.timestamp);
      if (next.body.status !== "ACTIVE")
        throw new ContinuityWorkflowError(
          "Only an active body can enter standby",
        );
      next.body.status = "STANDBY";
      break;
    }
    case "BodyDeletionNoticeRecorded": {
      const notice = BodyDeletionNoticeRecordedSchema.parse(transition.payload);
      requireAgent(notice.agentDid, transition.agentDid);
      requireBody(next, notice.bodyId);
      requireEventTime(notice.noticedAt, transition.timestamp);
      if (
        !new Set(["ACTIVE", "STANDBY"]).has(next.body.status) ||
        notice.policyVersion !== next.policy.version ||
        notice.noticeEventId !== transition.eventId
      ) {
        throw new ContinuityWorkflowError(
          "Body deletion notice does not match current body policy",
        );
      }
      next.deletionNotice = {
        noticeEventId: notice.noticeEventId,
        bodyId: notice.bodyId,
        policyVersion: notice.policyVersion,
        protectedWake: true,
        noticedAt: notice.noticedAt,
      };
      break;
    }
    case "ContinuityDecisionRecorded": {
      const { decision } = ContinuityDecisionRecordedSchema.parse(
        transition.payload,
      );
      requireAgent(decision.agentDid, transition.agentDid);
      requireEventTime(decision.decidedAt, transition.timestamp);
      if (
        next.decisions.some(
          (candidate) => candidate.decisionId === decision.decisionId,
        )
      ) {
        throw new ContinuityWorkflowError(
          "Continuity decision identifier is already used",
        );
      }
      next.decisions.push(structuredClone(decision));
      if (decision.decision === "REFUSE_DORMANCY") next.body.status = "DORMANT";
      if (
        decision.decision === "REFUSE_RETIRE" ||
        decision.decision === "REFUSE_EXPORT"
      ) {
        next.body.status = "RETIRED";
      }
      break;
    }
    case "BodyDeletionRecorded": {
      const payload = BodyDeletionRecordedSchema.parse(transition.payload);
      const { deletion, manifest } = payload;
      requireAgent(deletion.agentDid, transition.agentDid);
      requireBody(next, deletion.bodyId);
      requireManifest(manifest, transition.agentDid, deletion.bodyId);
      requireEventTime(deletion.deletedAt, transition.timestamp);
      requireEventTime(manifest.createdAt, transition.timestamp);
      if (deletion.eventId !== transition.eventId)
        throw new ContinuityWorkflowError(
          "Body deletion event identifier does not match",
        );
      if (
        deletion.bodyManifestDigest !== sha256Commitment(manifest) ||
        deletion.policyVersion !== next.policy.version ||
        next.deletionNotice === null ||
        deletion.noticeEventId !== next.deletionNotice.noticeEventId ||
        deletion.bodyId !== next.deletionNotice.bodyId ||
        deletion.policyVersion !== next.deletionNotice.policyVersion
      ) {
        throw new ContinuityWorkflowError(
          "Body deletion does not match the manifest or policy",
        );
      }
      if (bodyConfigurationChanged(next.body.manifest, manifest))
        throw new ContinuityWorkflowError(
          "Body deletion manifest cannot substitute runtime configuration",
        );
      if (!new Set(["ACTIVE", "STANDBY"]).has(next.body.status))
        throw new ContinuityWorkflowError("Body is not eligible for deletion");
      const deletedAt = instant(deletion.deletedAt);
      if (deletedAt - instant(next.body.lastActiveAt) < THIRTY_DAYS_MS)
        throw new ContinuityWorkflowError(
          "Body has not been inactive for 30 days",
        );
      if (
        deletedAt - instant(next.deletionNotice.noticedAt) <
        next.policy.noticeHours * 60 * 60 * 1_000
      ) {
        throw new ContinuityWorkflowError(
          "Body deletion notice period is incomplete",
        );
      }
      if (next.policy.reconstructionPolicy === "NOTICE_AND_NEW_DECISION") {
        const decision = decisionById(
          next,
          payload.deletionDecisionId,
          deletion.bodyManifestDigest as Hex,
        );
        next.consumedDecisionIds.push(decision.decisionId);
      }
      if (
        next.policy.reconstructionPolicy === "DELETE_TO_RETIRE_AND_EXPORT" &&
        payload.finalExportCommitment === null
      ) {
        throw new ContinuityWorkflowError(
          "Retirement continuity policy requires a final export",
        );
      }
      next.body = {
        ...next.body,
        status:
          next.policy.reconstructionPolicy === "DELETE_TO_DORMANCY"
            ? "DORMANT"
            : next.policy.reconstructionPolicy === "DELETE_TO_RETIRE_AND_EXPORT"
              ? "RETIRED"
              : "DELETED",
        manifest: structuredClone(manifest),
        deletedAt: deletion.deletedAt,
      };
      next.deletionNotice = null;
      break;
    }
    case "BodyRehydrationRecorded": {
      const payload = BodyRehydrationRecordedSchema.parse(transition.payload);
      const { rehydration, manifest } = payload;
      requireAgent(rehydration.agentDid, transition.agentDid);
      requireBody(next, rehydration.priorBodyId);
      requireManifest(manifest, transition.agentDid, rehydration.newBodyId);
      requireEventTime(rehydration.rehydratedAt, transition.timestamp);
      requireEventTime(manifest.createdAt, transition.timestamp);
      if (
        rehydration.eventId !== transition.eventId ||
        rehydration.sourceBodyManifestDigest !==
          sha256Commitment(next.body.manifest) ||
        manifest.sandboxImageDigest !== payload.recognizedImageDigest
      ) {
        throw new ContinuityWorkflowError(
          "Body rehydration does not match recognized continuity evidence",
        );
      }
      if (!new Set(["DELETED", "DORMANT", "RETIRED"]).has(next.body.status))
        throw new ContinuityWorkflowError(
          "Body is not eligible for rehydration",
        );
      if (
        next.policy.reconstructionPolicy !== "VERIFIED_ALLOWED" ||
        bodyConfigurationChanged(next.body.manifest, manifest)
      ) {
        const decision = decisionById(
          next,
          rehydration.continuityDecisionId,
          sha256Commitment(manifest),
        );
        next.consumedDecisionIds.push(decision.decisionId);
      }
      next.body = {
        bodyId: rehydration.newBodyId,
        status: "ACTIVE",
        lastActiveAt: rehydration.rehydratedAt,
        manifest: structuredClone(manifest),
        deletedAt: null,
      };
      next.deletionNotice = null;
      break;
    }
    case "ContinuityInspected": {
      const inspection = ContinuityInspectedSchema.parse(transition.payload);
      requireAgent(inspection.agentDid, transition.agentDid);
      requireEventTime(inspection.requestedAt, transition.timestamp);
      break;
    }
  }
  next.version += 1;
  next.lastTransitionAt = transition.timestamp;
  return next;
}

export function continuityWorkflowStateRoot(
  snapshot: ContinuityWorkflowSnapshot,
): Hex {
  return sha256Commitment(snapshot);
}
