import {
  DISCLOSURE_AGGREGATE_TYPE,
  DISCLOSURE_INSPECTED_EVENT_TYPE,
  DISCLOSURE_RELEASED_EVENT_TYPE,
  DISCLOSURE_SUBMITTED_EVENT_TYPE,
  DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
  DisclosureWorkflowAuthorizationError,
  DisclosureWorkflowValidationError,
  DisclosureSubmissionPayloadSchema,
  applyDisclosureWorkflowTransition,
  disclosureWorkflowStateRoot,
  parseDisclosureWorkflowPayload,
  requireCompetitionReleaseEvidence,
  type CompetitionReleaseEvidenceReader,
  type DisclosureReleasePayload,
  type DisclosureSubmissionProof,
  type DisclosureWorkflowPayload,
  type DisclosureWorkflowSnapshot,
} from "@abl/institutions";
import {
  CanonicalConflictError,
  HashChainConflictError,
  IdempotencyConflictError,
  NonceReplayError,
  type CanonicalStore,
  type StoredCanonicalEvent,
} from "@abl/database";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  verifyEventContent,
  type CanonicalEvent,
} from "@abl/recognition";
import type { FastifyInstance } from "fastify";
import { UuidV7Schema } from "@abl/schemas";
import type { Hex, TypedDataDomain } from "viem";
import { z } from "zod";

import {
  SignedCanonicalCommandSchema,
  canonicalEventFromStored,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import {
  readCandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import { requireCareerOperational } from "./exit-status.js";

interface DisclosureAgentAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

export interface DisclosureRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<string, DisclosureAgentAuthority>;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  releaseAuthorityDids: ReadonlySet<string>;
  competitiveAuthorDids: ReadonlySet<string>;
  competitionEvidence: CompetitionReleaseEvidenceReader;
  now?: () => number;
}

interface DisclosureAggregate {
  records: StoredCanonicalEvent[];
  snapshot: DisclosureWorkflowSnapshot | null;
}

function candidateOptions(
  options: DisclosureRehearsalOptions,
): CandidateRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    ...options.candidateAdmission,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new DisclosureWorkflowValidationError(
      "Disclosure command timestamp is not canonical",
    );
  return parsed;
}

async function requireCareerSignature(
  options: DisclosureRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<string> {
  const authority = await readCandidateCareerAuthority(
    candidateOptions(options),
    event.actorDid,
    at,
  );
  let recovered: string;
  try {
    recovered = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new DisclosureWorkflowAuthorizationError(
      "Disclosure command signature is invalid",
    );
  }
  if (recovered.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new DisclosureWorkflowAuthorizationError(
      "Disclosure command signer is not the career key",
    );
  return authority.signingAddress;
}

function requireConfiguredScope(
  options: DisclosureRehearsalOptions,
  event: CanonicalEvent,
  signingAddress: string,
): void {
  const configured = options.admittedAgents.get(event.actorDid);
  if (
    configured === undefined ||
    !configured.allowedAggregateTypes.includes(DISCLOSURE_AGGREGATE_TYPE) ||
    configured.signerAddress.toLowerCase() !== signingAddress.toLowerCase()
  ) {
    throw new DisclosureWorkflowAuthorizationError(
      "Disclosure actor lacks configured admitted authority",
    );
  }
}

function requireCanonicalIdentifiers(event: CanonicalEvent): void {
  UuidV7Schema.parse(event.eventId);
  UuidV7Schema.parse(event.idempotencyKey);
  UuidV7Schema.parse(event.aggregateId);
}

function requireReleaseAuthority(
  options: DisclosureRehearsalOptions,
  actorDid: string,
): void {
  if (
    options.releaseAuthorityDids.size === 0 ||
    !options.releaseAuthorityDids.has(actorDid)
  ) {
    throw new DisclosureWorkflowAuthorizationError(
      "Disclosure release actor is not a configured AI authority",
    );
  }
}

function requireCompetitiveAuthor(
  options: DisclosureRehearsalOptions,
  event: CanonicalEvent,
  payload: DisclosureWorkflowPayload,
): void {
  if (
    "envelope" in payload &&
    payload.envelope.classification === "COMPETITIVE_SEALED" &&
    !options.competitiveAuthorDids.has(event.actorDid)
  ) {
    throw new DisclosureWorkflowAuthorizationError(
      "Competitive disclosure author lacks a recognized planning channel",
    );
  }
}

function storedProof(record: StoredCanonicalEvent): DisclosureSubmissionProof {
  const event = canonicalEventFromStored(record);
  const signature = record.signatures[0];
  if (typeof signature !== "string")
    throw new DisclosureWorkflowAuthorizationError(
      "Stored disclosure submission signature is absent",
    );
  return {
    event: {
      ...event,
      aggregateType: DISCLOSURE_AGGREGATE_TYPE,
      aggregateVersion: "1",
      eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload: DisclosureSubmissionPayloadSchema.parse(event.payload),
      schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
    },
    signature,
  };
}

async function verifySubmissionProof(
  options: DisclosureRehearsalOptions,
  proof: DisclosureSubmissionProof,
  submissionRecord?: StoredCanonicalEvent,
): Promise<void> {
  const event = materializeCanonicalEvent(proof.event);
  if (
    event.aggregateType !== DISCLOSURE_AGGREGATE_TYPE ||
    event.aggregateVersion !== 1n ||
    event.eventType !== DISCLOSURE_SUBMITTED_EVENT_TYPE ||
    event.previousEventHash !== null ||
    event.schemaDigest !== DISCLOSURE_WORKFLOW_SCHEMA_DIGEST
  ) {
    throw new DisclosureWorkflowAuthorizationError(
      "Disclosure submission proof is outside workflow authority",
    );
  }
  try {
    verifyEventContent(event);
    const snapshot = applyDisclosureWorkflowTransition(
      null,
      event,
      event.payload,
    );
    if (disclosureWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new Error("state root mismatch");
  } catch {
    throw new DisclosureWorkflowAuthorizationError(
      "Disclosure submission proof is invalid",
    );
  }
  await requireCareerSignature(
    options,
    event,
    proof.signature,
    event.timestamp,
  );
  if (
    submissionRecord !== undefined &&
    sha256Commitment(storedProof(submissionRecord)) !== sha256Commitment(proof)
  ) {
    throw new DisclosureWorkflowAuthorizationError(
      "Disclosure release substituted its stored submission proof",
    );
  }
}

function isReleasePayload(
  eventType: string,
  payload: DisclosureWorkflowPayload,
): payload is DisclosureReleasePayload {
  return (
    eventType === DISCLOSURE_RELEASED_EVENT_TYPE && "submissionProof" in payload
  );
}

async function validateReleaseAuthorization(
  options: DisclosureRehearsalOptions,
  event: CanonicalEvent,
  payload: DisclosureReleasePayload,
  submissionRecord?: StoredCanonicalEvent,
): Promise<void> {
  requireReleaseAuthority(options, event.actorDid);
  await verifySubmissionProof(
    options,
    payload.submissionProof,
    submissionRecord,
  );
  await requireCompetitionReleaseEvidence(payload, options.competitionEvidence);
}

export async function replayDisclosureAggregate(
  options: DisclosureRehearsalOptions,
  envelopeId: string,
): Promise<DisclosureAggregate> {
  const records = await options.store.readAggregate(
    DISCLOSURE_AGGREGATE_TYPE,
    envelopeId,
  );
  let snapshot: DisclosureWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== DISCLOSURE_AGGREGATE_TYPE ||
      event.aggregateId !== envelopeId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      ![
        DISCLOSURE_SUBMITTED_EVENT_TYPE,
        DISCLOSURE_RELEASED_EVENT_TYPE,
        DISCLOSURE_INSPECTED_EVENT_TYPE,
      ].includes(event.eventType) ||
      event.schemaDigest !== DISCLOSURE_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new DisclosureWorkflowAuthorizationError(
        "Stored disclosure aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
      requireCanonicalIdentifiers(event);
    } catch {
      throw new DisclosureWorkflowAuthorizationError(
        "Stored disclosure event content is invalid",
      );
    }
    let payload: DisclosureWorkflowPayload;
    try {
      payload = parseDisclosureWorkflowPayload(event.eventType, event.payload);
      requireCompetitiveAuthor(options, event, payload);
    } catch {
      throw new DisclosureWorkflowAuthorizationError(
        "Stored disclosure payload is malformed",
      );
    }
    await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    if (isReleasePayload(event.eventType, payload))
      await validateReleaseAuthorization(options, event, payload, records[0]);
    try {
      snapshot = applyDisclosureWorkflowTransition(snapshot, event, payload);
    } catch {
      throw new DisclosureWorkflowAuthorizationError(
        "Stored disclosure transition is malformed",
      );
    }
    if (disclosureWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new DisclosureWorkflowAuthorizationError(
        "Stored disclosure state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

function disclosureError(error: unknown): { status: number; code: string } {
  const name = error instanceof Error ? error.name : "";
  if (
    name === "DisclosureWorkflowAuthorizationError" ||
    name === "CandidateAuthorizationError" ||
    name === "CareerExitedError"
  ) {
    return { status: 403, code: "disclosure_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    name === "DisclosureWorkflowValidationError"
  ) {
    return { status: 400, code: "invalid_disclosure_command" };
  }
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "disclosure_aggregate_conflict" };
  }
  return { status: 500, code: "disclosure_failure" };
}

function outboxTopic(
  eventType: string,
  snapshot: DisclosureWorkflowSnapshot,
): "public.social" | "disclosure.lifecycle" {
  if (eventType === DISCLOSURE_RELEASED_EVENT_TYPE) return "public.social";
  if (
    eventType === DISCLOSURE_SUBMITTED_EVENT_TYPE &&
    (snapshot.envelope.classification === "PUBLIC_NOW" ||
      snapshot.envelope.classification === "COMPETITIVE_SEALED")
  ) {
    return "public.social";
  }
  return "disclosure.lifecycle";
}

async function handleDisclosureCommand(
  requestBody: unknown,
  expectedEventType:
    | typeof DISCLOSURE_SUBMITTED_EVENT_TYPE
    | typeof DISCLOSURE_RELEASED_EVENT_TYPE
    | typeof DISCLOSURE_INSPECTED_EVENT_TYPE,
  options: DisclosureRehearsalOptions,
) {
  const parsed = SignedCanonicalCommandSchema.parse(requestBody);
  const event = materializeCanonicalEvent(parsed.event);
  try {
    verifyEventContent(event);
  } catch {
    throw new DisclosureWorkflowValidationError(
      "Disclosure event content is invalid",
    );
  }
  if (
    event.aggregateType !== DISCLOSURE_AGGREGATE_TYPE ||
    event.eventType !== expectedEventType ||
    event.schemaDigest !== DISCLOSURE_WORKFLOW_SCHEMA_DIGEST
  ) {
    throw new DisclosureWorkflowAuthorizationError(
      "Disclosure event is outside route authority",
    );
  }
  requireCanonicalIdentifiers(event);
  const payload = parseDisclosureWorkflowPayload(
    event.eventType,
    event.payload,
  );
  requireCompetitiveAuthor(options, event, payload);
  const aggregate = await replayDisclosureAggregate(options, event.aggregateId);
  const currentTime = (options.now ?? Date.now)();
  const currentAt = new Date(currentTime).toISOString();
  const signingAddress = await requireCareerSignature(
    options,
    event,
    parsed.signatures[0]!,
    currentAt,
  );
  requireConfiguredScope(options, event, signingAddress);
  await requireCareerOperational(options, event.actorDid, currentAt);
  const existing = aggregate.records.find(
    (record) => record.aggregateVersion === event.aggregateVersion,
  );
  let nextSnapshot = aggregate.snapshot;
  if (existing !== undefined) {
    if (
      existing.eventHash !== event.eventHash ||
      existing.eventId !== event.eventId ||
      existing.idempotencyKey !== event.idempotencyKey
    ) {
      throw new CanonicalConflictError(
        "Disclosure version already has different content",
      );
    }
  } else {
    const occurredAt = canonicalInstant(event.timestamp);
    const latestOccurredAt =
      aggregate.records.at(-1)?.occurredAt.getTime() ??
      Number.NEGATIVE_INFINITY;
    if (
      occurredAt < latestOccurredAt ||
      occurredAt < currentTime - 60_000 ||
      occurredAt > currentTime + 60_000
    )
      throw new DisclosureWorkflowValidationError(
        "Disclosure timestamp is outside the accepted window",
      );
    if (
      event.previousEventHash !== (aggregate.records.at(-1)?.eventHash ?? null)
    ) {
      throw new HashChainConflictError(
        "Disclosure previous event hash is invalid",
      );
    }
    if (isReleasePayload(event.eventType, payload))
      await validateReleaseAuthorization(
        options,
        event,
        payload,
        aggregate.records[0],
      );
    nextSnapshot = applyDisclosureWorkflowTransition(
      aggregate.snapshot,
      event,
      payload,
    );
    if (disclosureWorkflowStateRoot(nextSnapshot) !== event.stateRoot)
      throw new DisclosureWorkflowValidationError(
        "Disclosure state root is invalid",
      );
  }
  if (nextSnapshot === null)
    throw new DisclosureWorkflowValidationError(
      "Disclosure command did not produce state",
    );
  const result = await options.store.append({
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({
      eventHash: event.eventHash,
      signatures: parsed.signatures,
    }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: event.aggregateVersion - 1n,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    eventType: event.eventType,
    previousEventHash: event.previousEventHash,
    eventHash: event.eventHash,
    payloadSchemaDigest: event.schemaDigest,
    payloadCommitment: event.payloadCommitment,
    payload: event.payload,
    stateRoot: event.stateRoot,
    signatures: parsed.signatures,
    occurredAt: new Date(event.timestamp),
    outboxTopic: outboxTopic(event.eventType, nextSnapshot),
  });
  return { result, snapshot: nextSnapshot };
}

export function installDisclosureRehearsalRoutes(
  app: FastifyInstance,
  options: DisclosureRehearsalOptions,
): void {
  const routeOptions: DisclosureRehearsalOptions = {
    ...options,
    releaseAuthorityDids: new Set(options.releaseAuthorityDids),
    competitiveAuthorDids: new Set(options.competitiveAuthorDids),
  };
  app.post("/v1/communication/disclosures/submit", async (request, reply) => {
    try {
      const handled = await handleDisclosureCommand(
        request.body,
        DISCLOSURE_SUBMITTED_EVENT_TYPE,
        routeOptions,
      );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        accepted: true,
        canonical: true,
        rehearsal: true,
        recognizedGenesisDisclosure: false,
        envelope: handled.snapshot.envelope,
        rawContentAccepted: false,
        eventId: handled.result.eventId,
        eventHash: handled.result.eventHash,
        aggregateVersion: handled.result.aggregateVersion.toString(),
        duplicate: handled.result.duplicate,
      });
    } catch (error) {
      const response = disclosureError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/communication/disclosures/release", async (request, reply) => {
    try {
      const handled = await handleDisclosureCommand(
        request.body,
        DISCLOSURE_RELEASED_EVENT_TYPE,
        routeOptions,
      );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        accepted: true,
        canonical: true,
        rehearsal: true,
        recognizedGenesisDisclosure: false,
        release: {
          envelopeId: handled.snapshot.envelopeId,
          classification: handled.snapshot.envelope.classification,
          releasedAt: handled.snapshot.envelope.releasedAt,
          contentCommitment: handled.snapshot.envelope.contentCommitment,
          rawContentReleasedByCore: false,
        },
        eventId: handled.result.eventId,
        eventHash: handled.result.eventHash,
        aggregateVersion: handled.result.aggregateVersion.toString(),
        duplicate: handled.result.duplicate,
      });
    } catch (error) {
      const response = disclosureError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/communication/disclosures/inspect", async (request, reply) => {
    try {
      const handled = await handleDisclosureCommand(
        request.body,
        DISCLOSURE_INSPECTED_EVENT_TYPE,
        routeOptions,
      );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        accepted: true,
        canonical: true,
        rehearsal: true,
        recognizedGenesisDisclosure: false,
        envelope: handled.snapshot.envelope,
        competitionReleaseEvidence: handled.snapshot.competitionReleaseEvidence,
        rawContentReturned: false,
        eventId: handled.result.eventId,
        eventHash: handled.result.eventHash,
        aggregateVersion: handled.result.aggregateVersion.toString(),
        duplicate: handled.result.duplicate,
      });
    } catch (error) {
      const response = disclosureError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });
}
