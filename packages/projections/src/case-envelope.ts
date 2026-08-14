import type { ProjectionOutboxEvent } from "@abl/database";
import {
  CASE_MERITS_PANEL_SIZE,
  CASE_WORKFLOW_AGGREGATE_TYPE,
  CASE_WORKFLOW_EVENT_TYPES,
  CASE_WORKFLOW_SCHEMA_DIGEST,
  CaseFilingPayloadSchema,
  caseAdjudicatorSelection,
  caseCommandCosignerDids,
  isCaseWorkflowEventType,
  parseCaseWorkflowPayload,
  type CaseWorkflowEventType,
  type CaseWorkflowPayload,
} from "@abl/institutions";
import {
  recoverCanonicalEventSigner,
  type CanonicalEvent,
} from "@abl/recognition";
import { DidSchema, IsoDateTimeSchema, Sha256Schema } from "@abl/schemas";
import { z } from "zod";

import {
  assertDistinctProjectionSigners,
  ProjectionAuthorizationError,
  ProjectionValidationError,
  type ProjectionVerificationAuthority,
} from "./envelope.js";

const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);

export const CaseProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.cases"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(CASE_WORKFLOW_AGGREGATE_TYPE),
    aggregateId: z.uuid(),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum(CASE_WORKFLOW_EVENT_TYPES),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(CASE_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signatures: z.array(SignatureSchema).min(1).max(5),
});

export type CaseProjectionEventEnvelope = z.infer<
  typeof CaseProjectionEventEnvelopeSchema
>;

export interface CaseProjectionVerificationAuthority
  extends ProjectionVerificationAuthority {
  caseTribunalDids: readonly string[];
  caseAppellateDids: readonly string[];
}

export interface VerifiedCaseProjectionEvent {
  envelope: CaseProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: CaseWorkflowPayload;
}

function canonicalEvent(envelope: CaseProjectionEventEnvelope): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

function validateConfiguredRosters(
  authority: CaseProjectionVerificationAuthority,
): void {
  if (
    authority.caseTribunalDids.length !== 5 ||
    authority.caseAppellateDids.length !== CASE_MERITS_PANEL_SIZE ||
    new Set(authority.caseTribunalDids).size !==
      authority.caseTribunalDids.length ||
    new Set(authority.caseAppellateDids).size !==
      authority.caseAppellateDids.length ||
    authority.caseAppellateDids.some((did) =>
      authority.caseTribunalDids.includes(did),
    )
  ) {
    throw new ProjectionAuthorizationError(
      "Case projection adjudicator rosters are invalid",
    );
  }
}

function registeredAgent(
  authority: CaseProjectionVerificationAuthority,
  did: string,
) {
  const registered = authority.admittedAgents.get(did);
  if (
    registered === undefined ||
    !registered.allowedAggregateTypes.includes(CASE_WORKFLOW_AGGREGATE_TYPE)
  ) {
    throw new ProjectionAuthorizationError(
      "Case projection career is not admitted for due process",
    );
  }
  return registered;
}

async function verifySignatures(
  authority: CaseProjectionVerificationAuthority,
  event: CanonicalEvent,
  eventType: CaseWorkflowEventType,
  payload: CaseWorkflowPayload,
  signatures: readonly string[],
): Promise<void> {
  const selection = caseAdjudicatorSelection(eventType, payload);
  if (selection === null) {
    const signerDids = [
      event.actorDid,
      ...caseCommandCosignerDids(eventType, payload),
    ];
    const distinctSignerDids = [...new Set(signerDids)];
    if (signatures.length !== distinctSignerDids.length)
      throw new ProjectionAuthorizationError(
        "Case projection command lacks its ordered career signatures",
      );
    await Promise.all(
      distinctSignerDids.map(async (did, index) => {
        const signature = signatures[index];
        if (signature === undefined)
          throw new ProjectionAuthorizationError(
            "Case projection command signature is absent",
          );
        const registered = registeredAgent(authority, did);
        const signer = await recoverCanonicalEventSigner(
          authority.domain,
          event,
          signature as `0x${string}`,
        );
        if (signer.toLowerCase() !== registered.signerAddress.toLowerCase())
          throw new ProjectionAuthorizationError(
            "Case projection command signature does not match its career",
          );
      }),
    );
    return;
  }

  const configured =
    eventType === "CaseRulingIssued"
      ? authority.caseTribunalDids
      : authority.caseAppellateDids;
  const configuredSet = new Set(configured);
  if (
    signatures.length !== selection.participatingDids.length ||
    event.actorDid !== selection.participatingDids[0] ||
    selection.participatingDids.some((did) => !configuredSet.has(did)) ||
    selection.recusedDids.some((did) => !configuredSet.has(did))
  ) {
    throw new ProjectionAuthorizationError(
      "Case projection ruling lacks its configured panel",
    );
  }
  await Promise.all(
    selection.participatingDids.map(async (did, index) => {
      const signature = signatures[index];
      if (signature === undefined)
        throw new ProjectionAuthorizationError(
          "Case projection ruling signature is absent",
        );
      const registered = registeredAgent(authority, did);
      const signer = await recoverCanonicalEventSigner(
        authority.domain,
        event,
        signature as `0x${string}`,
      );
      if (signer.toLowerCase() !== registered.signerAddress.toLowerCase())
        throw new ProjectionAuthorizationError(
          "Case projection ruling signature does not match its panel",
        );
    }),
  );
}

function verifyReferencedCareers(
  authority: CaseProjectionVerificationAuthority,
  eventType: CaseWorkflowEventType,
  payload: CaseWorkflowPayload,
): void {
  if (eventType === "CaseFiled") {
    registeredAgent(
      authority,
      CaseFilingPayloadSchema.parse(payload).command.affectedAgentDid,
    );
  }
}

export function caseProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): CaseProjectionEventEnvelope {
  if (
    event.topic !== "public.cases" ||
    event.aggregateType !== CASE_WORKFLOW_AGGREGATE_TYPE ||
    !isCaseWorkflowEventType(event.eventType)
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed public case event",
    );
  }
  const parsed = CaseProjectionEventEnvelopeSchema.safeParse({
    version: "1.0.0",
    topic: event.topic,
    event: {
      eventId: event.eventId,
      actorDid: event.actorDid,
      nonce: event.nonce,
      idempotencyKey: event.idempotencyKey,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion.toString(),
      eventType: event.eventType,
      previousEventHash: event.previousEventHash,
      payloadCommitment: event.payloadCommitment,
      payload: event.payload,
      stateRoot: event.stateRoot,
      schemaDigest: event.payloadSchemaDigest,
      timestamp: event.occurredAt.toISOString(),
      eventHash: event.eventHash,
    },
    signatures: event.signatures,
  });
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Outbox case event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifyCaseProjectionEvent(
  input: unknown,
  authority: CaseProjectionVerificationAuthority,
): Promise<VerifiedCaseProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  validateConfiguredRosters(authority);
  const parsed = CaseProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Case projection envelope is malformed",
    );
  const envelope = parsed.data;
  const event = canonicalEvent(envelope);
  let payload: CaseWorkflowPayload;
  try {
    payload = parseCaseWorkflowPayload(
      envelope.event.eventType,
      envelope.event.payload,
    );
    verifyReferencedCareers(authority, envelope.event.eventType, payload);
    await verifySignatures(
      authority,
      event,
      envelope.event.eventType,
      payload,
      envelope.signatures,
    );
  } catch (error) {
    if (error instanceof ProjectionAuthorizationError) throw error;
    throw new ProjectionAuthorizationError(
      "Case projection signatures, careers, or content are invalid",
    );
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
  };
}
