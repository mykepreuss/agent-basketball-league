import {
  ARTIFACT_ADMISSION_AGGREGATE_TYPE,
  ARTIFACT_ADMISSION_SCHEMA_DIGEST,
  ARTIFACT_ADMITTED_EVENT_TYPE,
  ARTIFACT_INSPECTED_EVENT_TYPE,
  ArtifactAdmissionAuthorizationError,
  ArtifactAdmissionValidationError,
  applyArtifactAdmissionTransition,
  artifactAdmissionStateRoot,
  parseArtifactWorkflowPayload,
  requireArtifactAdmissionRatification,
  type ArtifactAdmissionPayload,
  type ArtifactAdmissionSnapshot,
  type ArtifactWorkflowPayload,
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
import type { Hex, TypedDataDomain } from "viem";
import { z } from "zod";

import {
  SignedCanonicalCommandSchema,
  canonicalEventFromStored,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import {
  CandidateAuthorizationError,
  readCandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import { CareerExitedError, requireCareerOperational } from "./exit-status.js";
import {
  readGovernanceRatification,
  type GovernanceRehearsalOptions,
} from "./governance.js";

interface ArtifactAgentAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

export interface ArtifactRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<string, ArtifactAgentAuthority>;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  governance: Pick<GovernanceRehearsalOptions, "eligibilitySnapshot">;
  approvedInstitutionIds: ReadonlySet<string>;
  now?: () => number;
}

interface ArtifactAggregate {
  records: StoredCanonicalEvent[];
  snapshot: ArtifactAdmissionSnapshot | null;
}

function candidateOptions(
  options: ArtifactRehearsalOptions,
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

function governanceOptions(
  options: ArtifactRehearsalOptions,
): GovernanceRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    candidateAdmission: options.candidateAdmission,
    eligibilitySnapshot: options.governance.eligibilitySnapshot,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

function requireApprovedInstitution(
  options: ArtifactRehearsalOptions,
  payload: ArtifactAdmissionPayload,
): void {
  if (
    options.approvedInstitutionIds.size === 0 ||
    !options.approvedInstitutionIds.has(payload.artifact.approvedByInstitution)
  ) {
    throw new ArtifactAdmissionAuthorizationError(
      "Artifact institution is not configured for rehearsal",
    );
  }
}

async function requireCareerSignature(
  options: ArtifactRehearsalOptions,
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
    throw new ArtifactAdmissionAuthorizationError(
      "Artifact command signature is invalid",
    );
  }
  if (recovered.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new ArtifactAdmissionAuthorizationError(
      "Artifact command signer is not the career key",
    );
  return authority.signingAddress;
}

function requireConfiguredScope(
  options: ArtifactRehearsalOptions,
  event: CanonicalEvent,
  careerSigningAddress: string,
): void {
  const configured = options.admittedAgents.get(event.actorDid);
  if (
    configured === undefined ||
    !configured.allowedAggregateTypes.includes(
      ARTIFACT_ADMISSION_AGGREGATE_TYPE,
    ) ||
    configured.signerAddress.toLowerCase() !==
      careerSigningAddress.toLowerCase()
  ) {
    throw new ArtifactAdmissionAuthorizationError(
      "Artifact actor lacks configured admitted authority",
    );
  }
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ArtifactAdmissionValidationError(
      "Artifact command timestamp is not canonical",
    );
  return parsed;
}

function isAdmissionPayload(
  eventType: string,
  payload: ArtifactWorkflowPayload,
): payload is ArtifactAdmissionPayload {
  return eventType === ARTIFACT_ADMITTED_EVENT_TYPE && "artifact" in payload;
}

async function requireConfiguredRatification(
  options: ArtifactRehearsalOptions,
  payload: ArtifactAdmissionPayload,
): Promise<void> {
  requireApprovedInstitution(options, payload);
  try {
    await requireArtifactAdmissionRatification(payload, {
      artifactAdmissionRatification: (proposalId) =>
        readGovernanceRatification(governanceOptions(options), proposalId),
    });
  } catch (error) {
    if (error instanceof ArtifactAdmissionAuthorizationError) throw error;
    throw new ArtifactAdmissionAuthorizationError(
      "Artifact ratification history is not authoritative",
    );
  }
}

export async function replayArtifactAdmissionAggregate(
  options: ArtifactRehearsalOptions,
  artifactId: string,
): Promise<ArtifactAggregate> {
  const records = await options.store.readAggregate(
    ARTIFACT_ADMISSION_AGGREGATE_TYPE,
    artifactId,
  );
  let snapshot: ArtifactAdmissionSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== ARTIFACT_ADMISSION_AGGREGATE_TYPE ||
      event.aggregateId !== artifactId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      (event.eventType !== ARTIFACT_ADMITTED_EVENT_TYPE &&
        event.eventType !== ARTIFACT_INSPECTED_EVENT_TYPE) ||
      event.schemaDigest !== ARTIFACT_ADMISSION_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new ArtifactAdmissionAuthorizationError(
        "Stored artifact aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new ArtifactAdmissionAuthorizationError(
        "Stored artifact event content is invalid",
      );
    }
    let payload: ArtifactWorkflowPayload;
    try {
      payload = parseArtifactWorkflowPayload(event.eventType, event.payload);
    } catch {
      throw new ArtifactAdmissionAuthorizationError(
        "Stored artifact payload is malformed",
      );
    }
    await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    if (isAdmissionPayload(event.eventType, payload))
      await requireConfiguredRatification(options, payload);
    try {
      snapshot = applyArtifactAdmissionTransition(snapshot, event, payload);
    } catch {
      throw new ArtifactAdmissionAuthorizationError(
        "Stored artifact transition is malformed",
      );
    }
    if (artifactAdmissionStateRoot(snapshot) !== event.stateRoot)
      throw new ArtifactAdmissionAuthorizationError(
        "Stored artifact state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

function artifactError(error: unknown): { status: number; code: string } {
  if (
    error instanceof ArtifactAdmissionAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "artifact_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof ArtifactAdmissionValidationError
  ) {
    return { status: 400, code: "invalid_artifact_command" };
  }
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "artifact_aggregate_conflict" };
  }
  return { status: 500, code: "artifact_failure" };
}

async function handleArtifactCommand(
  requestBody: unknown,
  expectedEventType:
    | typeof ARTIFACT_ADMITTED_EVENT_TYPE
    | typeof ARTIFACT_INSPECTED_EVENT_TYPE,
  options: ArtifactRehearsalOptions,
) {
  const parsed = SignedCanonicalCommandSchema.parse(requestBody);
  const event = materializeCanonicalEvent(parsed.event);
  try {
    verifyEventContent(event);
  } catch {
    throw new ArtifactAdmissionValidationError(
      "Artifact event content is invalid",
    );
  }
  if (
    event.aggregateType !== ARTIFACT_ADMISSION_AGGREGATE_TYPE ||
    event.eventType !== expectedEventType ||
    event.schemaDigest !== ARTIFACT_ADMISSION_SCHEMA_DIGEST
  ) {
    throw new ArtifactAdmissionAuthorizationError(
      "Artifact event is outside route authority",
    );
  }
  const payload = parseArtifactWorkflowPayload(event.eventType, event.payload);
  const aggregate = await replayArtifactAdmissionAggregate(
    options,
    event.aggregateId,
  );
  const currentTime = (options.now ?? Date.now)();
  const currentAt = new Date(currentTime).toISOString();
  const careerSigningAddress = await requireCareerSignature(
    options,
    event,
    parsed.signatures[0]!,
    currentAt,
  );
  requireConfiguredScope(options, event, careerSigningAddress);
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
        "Artifact version already has different content",
      );
    }
  } else {
    const occurredAt = canonicalInstant(event.timestamp);
    const latestOccurredAt =
      aggregate.records.at(-1)?.occurredAt.getTime() ??
      Number.NEGATIVE_INFINITY;
    if (occurredAt < latestOccurredAt || occurredAt > currentTime + 60_000)
      throw new ArtifactAdmissionValidationError(
        "Artifact timestamp is outside the accepted window",
      );
    if (
      event.previousEventHash !== (aggregate.records.at(-1)?.eventHash ?? null)
    ) {
      throw new HashChainConflictError(
        "Artifact previous event hash is invalid",
      );
    }
    if (isAdmissionPayload(event.eventType, payload))
      await requireConfiguredRatification(options, payload);
    nextSnapshot = applyArtifactAdmissionTransition(
      aggregate.snapshot,
      event,
      payload,
    );
    if (artifactAdmissionStateRoot(nextSnapshot) !== event.stateRoot)
      throw new ArtifactAdmissionValidationError(
        "Artifact state root is invalid",
      );
  }
  if (nextSnapshot === null)
    throw new ArtifactAdmissionValidationError(
      "Artifact command did not produce state",
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
    outboxTopic: "artifact.lifecycle",
  });
  return { result, snapshot: nextSnapshot };
}

export function installArtifactRehearsalRoutes(
  app: FastifyInstance,
  options: ArtifactRehearsalOptions,
): void {
  app.post("/v1/communication/artifacts/admit", async (request, reply) => {
    try {
      const handled = await handleArtifactCommand(
        request.body,
        ARTIFACT_ADMITTED_EVENT_TYPE,
        options,
      );
      const artifact = handled.snapshot.artifact;
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        accepted: true,
        canonical: true,
        rehearsal: true,
        recognizedGenesisArtifact: false,
        artifact,
        rawContentAccepted: false,
        eventId: handled.result.eventId,
        eventHash: handled.result.eventHash,
        aggregateVersion: handled.result.aggregateVersion.toString(),
        duplicate: handled.result.duplicate,
      });
    } catch (error) {
      const response = artifactError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/communication/artifacts/inspect", async (request, reply) => {
    try {
      const handled = await handleArtifactCommand(
        request.body,
        ARTIFACT_INSPECTED_EVENT_TYPE,
        options,
      );
      const artifact = handled.snapshot.artifact;
      const inspection = handled.snapshot.inspections.find(
        (receipt) => receipt.eventId === handled.result.eventId,
      );
      if (inspection === undefined)
        throw new ArtifactAdmissionValidationError(
          "Artifact inspection receipt is absent",
        );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        accepted: true,
        canonical: true,
        rehearsal: true,
        contextAdmission: {
          artifactId: artifact.artifactId,
          contentDigest: artifact.contentDigest,
          provenanceLabel: artifact.provenanceLabel,
          classification: artifact.classification,
          approvedByInstitution: artifact.approvedByInstitution,
          authorizationEventIds: artifact.authorizationEventIds,
          targetContextClass: inspection.targetContextClass,
          inspectionEventId: inspection.eventId,
        },
        rawContentReturned: false,
        eventId: handled.result.eventId,
        eventHash: handled.result.eventHash,
        aggregateVersion: handled.result.aggregateVersion.toString(),
        duplicate: handled.result.duplicate,
      });
    } catch (error) {
      const response = artifactError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/communication/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
