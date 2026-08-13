import {
  ContinuityWorkflowError,
  ContinuityWorkflowPayloadSchemas,
  applyContinuityWorkflowTransition,
  continuityWorkflowStateRoot,
  type ContinuityWorkflowEventType,
  type ContinuityWorkflowSnapshot,
} from "@abl/career";
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
  type CandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";

const aggregateType = "body-continuity";
const eventTypes = Object.keys(
  ContinuityWorkflowPayloadSchemas,
).sort() as ContinuityWorkflowEventType[];

export const CONTINUITY_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-body-continuity-workflow",
  version: 1,
  aggregateType,
  eventTypes,
  liveEvidenceMode: "PRE_GENESIS_NOT_VERIFIED",
});

class ContinuityAuthorizationError extends Error {
  public override readonly name = "ContinuityAuthorizationError";
}

class ContinuityValidationError extends Error {
  public override readonly name = "ContinuityValidationError";
}

export interface ContinuityRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  recognizedImageDigests: ReadonlySet<string>;
  now?: () => number;
}

interface ContinuityAggregate {
  records: StoredCanonicalEvent[];
  snapshot: ContinuityWorkflowSnapshot | null;
}

function candidateOptions(
  options: ContinuityRehearsalOptions,
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

function isEventType(value: string): value is ContinuityWorkflowEventType {
  return eventTypes.includes(value as ContinuityWorkflowEventType);
}

function parsePayload(
  eventType: ContinuityWorkflowEventType,
  payload: unknown,
) {
  return ContinuityWorkflowPayloadSchemas[eventType].parse(payload);
}

function manifestFromPayload(
  eventType: ContinuityWorkflowEventType,
  payload: ReturnType<typeof parsePayload>,
) {
  if (eventType === "BodyContinuityRegistered")
    return ContinuityWorkflowPayloadSchemas.BodyContinuityRegistered.parse(
      payload,
    ).manifest;
  if (eventType === "BodyDeletionRecorded")
    return ContinuityWorkflowPayloadSchemas.BodyDeletionRecorded.parse(payload)
      .manifest;
  if (eventType === "BodyRehydrationRecorded")
    return ContinuityWorkflowPayloadSchemas.BodyRehydrationRecorded.parse(
      payload,
    ).manifest;
  return null;
}

function validateRecognizedImage(
  options: ContinuityRehearsalOptions,
  eventType: ContinuityWorkflowEventType,
  payload: ReturnType<typeof parsePayload>,
): void {
  const manifest = manifestFromPayload(eventType, payload);
  if (
    manifest !== null &&
    !options.recognizedImageDigests.has(manifest.sandboxImageDigest)
  ) {
    throw new ContinuityAuthorizationError(
      "Body manifest image is not recognized",
    );
  }
}

function validateRegistrationAuthority(
  eventType: ContinuityWorkflowEventType,
  payload: ReturnType<typeof parsePayload>,
  authority: CandidateCareerAuthority,
): void {
  if (eventType !== "BodyContinuityRegistered") return;
  const registration =
    ContinuityWorkflowPayloadSchemas.BodyContinuityRegistered.parse(payload);
  if (
    sha256Commitment(registration.guardianDids) !==
      sha256Commitment(authority.guardianDids) ||
    registration.manifest.runtimeDigest !== authority.runtimeDigest ||
    sha256Commitment(registration.manifest.toolDigests) !==
      sha256Commitment(authority.toolDigests) ||
    registration.manifest.signingKeyLineageCommitment !==
      sha256Commitment({ signingPublicKey: authority.signingPublicKey })
  ) {
    throw new ContinuityAuthorizationError(
      "Continuity registration does not match admitted career provenance",
    );
  }
}

async function requireCareerSignature(
  options: ContinuityRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<CandidateCareerAuthority> {
  const authority = await readCandidateCareerAuthority(
    candidateOptions(options),
    event.actorDid,
    at,
  );
  let signer: string;
  try {
    signer = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new ContinuityAuthorizationError("Continuity signature is invalid");
  }
  if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new ContinuityAuthorizationError(
      "Continuity signer is not the career key",
    );
  return authority;
}

async function replayContinuityAggregate(
  options: ContinuityRehearsalOptions,
  agentDid: string,
): Promise<ContinuityAggregate> {
  const records = await options.store.readAggregate(aggregateType, agentDid);
  let snapshot: ContinuityWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.actorDid !== agentDid ||
      event.aggregateType !== aggregateType ||
      event.aggregateId !== agentDid ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isEventType(event.eventType) ||
      event.schemaDigest !== CONTINUITY_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new ContinuityAuthorizationError(
        "Stored continuity aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new ContinuityAuthorizationError(
        "Stored continuity event content is invalid",
      );
    }
    let payload: ReturnType<typeof parsePayload>;
    try {
      payload = parsePayload(event.eventType, event.payload);
    } catch {
      throw new ContinuityAuthorizationError(
        "Stored continuity event payload is malformed",
      );
    }
    const authority = await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    validateRegistrationAuthority(event.eventType, payload, authority);
    validateRecognizedImage(options, event.eventType, payload);
    try {
      snapshot = applyContinuityWorkflowTransition(snapshot, {
        eventId: event.eventId,
        agentDid,
        aggregateVersion: event.aggregateVersion,
        eventType: event.eventType,
        payload,
        timestamp: event.timestamp,
      });
    } catch (error) {
      throw new ContinuityAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored continuity event is malformed",
      );
    }
    if (continuityWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new ContinuityAuthorizationError(
        "Stored continuity state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

function appendInput(
  options: ContinuityRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
) {
  return {
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({ eventHash: event.eventHash, signatures }),
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
    signatures,
    occurredAt: new Date(event.timestamp),
    outboxTopic: "career.continuity",
  };
}

function continuityError(error: unknown): { status: number; code: string } {
  if (
    error instanceof ContinuityAuthorizationError ||
    error instanceof CandidateAuthorizationError
  ) {
    return { status: 403, code: "continuity_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof ContinuityWorkflowError ||
    error instanceof ContinuityValidationError
  ) {
    return { status: 400, code: "invalid_continuity_request" };
  }
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "continuity_aggregate_conflict" };
  }
  return { status: 500, code: "continuity_failure" };
}

export function installContinuityRehearsalRoutes(
  app: FastifyInstance,
  options: ContinuityRehearsalOptions,
): void {
  if (
    options.recognizedImageDigests.size === 0 ||
    [...options.recognizedImageDigests].some(
      (digest) => !/^0x[0-9a-f]{64}$/.test(digest),
    )
  )
    throw new Error("At least one recognized body image digest is required");
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: ContinuityWorkflowEventType;
  }> = [
    {
      path: "/v1/continuity/register",
      eventType: "BodyContinuityRegistered",
    },
    {
      path: "/v1/continuity/policy",
      eventType: "BodyContinuityPolicyUpdated",
    },
    {
      path: "/v1/continuity/activity",
      eventType: "BodyActivityRecorded",
    },
    {
      path: "/v1/continuity/standby",
      eventType: "BodyStandbyEntered",
    },
    {
      path: "/v1/continuity/notice",
      eventType: "BodyDeletionNoticeRecorded",
    },
    {
      path: "/v1/continuity/decide",
      eventType: "ContinuityDecisionRecorded",
    },
    {
      path: "/v1/continuity/delete",
      eventType: "BodyDeletionRecorded",
    },
    {
      path: "/v1/continuity/rehydrate",
      eventType: "BodyRehydrationRecorded",
    },
    {
      path: "/v1/continuity/inspect",
      eventType: "ContinuityInspected",
    },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new ContinuityValidationError(
            "Continuity event content is invalid",
          );
        }
        if (
          event.actorDid !== event.aggregateId ||
          event.aggregateType !== aggregateType ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== CONTINUITY_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new ContinuityAuthorizationError(
            "Continuity event is outside route authority",
          );
        }
        const payload = parsePayload(route.eventType, event.payload);
        const aggregate = await replayContinuityAggregate(
          options,
          event.actorDid,
        );
        const currentTime = now();
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        let responseSnapshot = aggregate.snapshot;
        if (existing !== undefined) {
          await requireCareerSignature(
            options,
            event,
            parsed.signatures[0]!,
            new Date(currentTime).toISOString(),
          );
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Continuity aggregate version already has different content",
            );
          }
          if (
            route.eventType === "ContinuityInspected" &&
            existing !== aggregate.records.at(-1)
          ) {
            throw new CanonicalConflictError(
              "Historical continuity inspection cannot return newer state",
            );
          }
        } else {
          const occurredAt = Date.parse(event.timestamp);
          const latestOccurredAt =
            aggregate.records.at(-1)?.occurredAt.getTime() ??
            Number.NEGATIVE_INFINITY;
          if (
            !Number.isFinite(occurredAt) ||
            event.timestamp !== new Date(occurredAt).toISOString() ||
            occurredAt < latestOccurredAt ||
            occurredAt > currentTime + 60_000
          ) {
            throw new ContinuityValidationError(
              "Continuity event timestamp is outside the accepted window",
            );
          }
          const authority = await requireCareerSignature(
            options,
            event,
            parsed.signatures[0]!,
            new Date(currentTime).toISOString(),
          );
          validateRegistrationAuthority(route.eventType, payload, authority);
          validateRecognizedImage(options, route.eventType, payload);
          const previousHash = aggregate.records.at(-1)?.eventHash ?? null;
          if (event.previousEventHash !== previousHash)
            throw new HashChainConflictError(
              "Continuity previous event hash is invalid",
            );
          try {
            responseSnapshot = applyContinuityWorkflowTransition(
              aggregate.snapshot,
              {
                eventId: event.eventId,
                agentDid: event.actorDid,
                aggregateVersion: event.aggregateVersion,
                eventType: route.eventType,
                payload,
                timestamp: event.timestamp,
              },
            );
          } catch (error) {
            if (error instanceof ContinuityWorkflowError) throw error;
            throw new ContinuityValidationError(
              "Continuity transition is malformed",
            );
          }
          if (continuityWorkflowStateRoot(responseSnapshot) !== event.stateRoot)
            throw new ContinuityValidationError(
              "Continuity state root is invalid",
            );
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisContinuity: false,
          livePlatformEvidenceVerified: false,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        if (route.eventType === "ContinuityInspected")
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            continuity: responseSnapshot,
          });
        return reply.code(result.duplicate ? 200 : 201).send(response);
      } catch (error) {
        const response = continuityError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.post("/v1/continuity/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
