import {
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  ResourceScheduleAuthorizationError,
  ResourceScheduleValidationError,
  applyResourceScheduleTransition,
  parseResourceSchedulePublicationPayload,
  requireResourceScheduleRatification,
  resourceScheduleStateRoot,
  type ResourceSchedulePublicationPayload,
  type ResourceScheduleSnapshot,
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
  readResourceScheduleRatification,
  type GovernanceRehearsalOptions,
} from "./governance.js";

export interface ResourceScheduleRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  governance: Pick<GovernanceRehearsalOptions, "eligibilitySnapshot">;
  now?: () => number;
}

interface ResourceScheduleAggregate {
  records: StoredCanonicalEvent[];
  snapshot: ResourceScheduleSnapshot | null;
}

function candidateOptions(
  options: ResourceScheduleRehearsalOptions,
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
  options: ResourceScheduleRehearsalOptions,
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

async function requireCareerSignature(
  options: ResourceScheduleRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<void> {
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
    throw new ResourceScheduleAuthorizationError(
      "Resource schedule signature is invalid",
    );
  }
  if (recovered.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new ResourceScheduleAuthorizationError(
      "Resource schedule signer is not the career key",
    );
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ResourceScheduleValidationError(
      "Resource schedule timestamp is not canonical",
    );
  return parsed;
}

async function requireConfiguredRatification(
  options: ResourceScheduleRehearsalOptions,
  payload: ResourceSchedulePublicationPayload,
): Promise<void> {
  try {
    await requireResourceScheduleRatification(payload, {
      resourceScheduleRatification: (proposalId) =>
        readResourceScheduleRatification(
          governanceOptions(options),
          proposalId,
        ),
    });
  } catch (error) {
    if (error instanceof ResourceScheduleAuthorizationError) throw error;
    throw new ResourceScheduleAuthorizationError(
      "Resource schedule ratification history is not authoritative",
    );
  }
}

async function replayResourceScheduleAggregate(
  options: ResourceScheduleRehearsalOptions,
  scheduleId: string,
): Promise<ResourceScheduleAggregate> {
  const records = await options.store.readAggregate(
    RESOURCE_SCHEDULE_AGGREGATE_TYPE,
    scheduleId,
  );
  let snapshot: ResourceScheduleSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== RESOURCE_SCHEDULE_AGGREGATE_TYPE ||
      event.aggregateId !== scheduleId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      event.eventType !== RESOURCE_SCHEDULE_EVENT_TYPE ||
      event.schemaDigest !== RESOURCE_SCHEDULE_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new ResourceScheduleAuthorizationError(
        "Stored resource schedule aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new ResourceScheduleAuthorizationError(
        "Stored resource schedule event content is invalid",
      );
    }
    let payload: ResourceSchedulePublicationPayload;
    try {
      payload = parseResourceSchedulePublicationPayload(event.payload);
    } catch {
      throw new ResourceScheduleAuthorizationError(
        "Stored resource schedule payload is malformed",
      );
    }
    await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    await requireConfiguredRatification(options, payload);
    try {
      snapshot = applyResourceScheduleTransition(snapshot, event, payload);
    } catch {
      throw new ResourceScheduleAuthorizationError(
        "Stored resource schedule transition is malformed",
      );
    }
    if (resourceScheduleStateRoot(snapshot) !== event.stateRoot)
      throw new ResourceScheduleAuthorizationError(
        "Stored resource schedule state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

function resourceScheduleError(error: unknown): {
  status: number;
  code: string;
} {
  if (
    error instanceof ResourceScheduleAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "resource_schedule_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof ResourceScheduleValidationError
  ) {
    return { status: 400, code: "invalid_resource_schedule" };
  }
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "resource_schedule_aggregate_conflict" };
  }
  return { status: 500, code: "resource_schedule_failure" };
}

export function installResourceScheduleRehearsalRoutes(
  app: FastifyInstance,
  options: ResourceScheduleRehearsalOptions,
): void {
  const now = options.now ?? Date.now;
  app.post("/v1/resources/schedules/publish", async (request, reply) => {
    try {
      const parsed = SignedCanonicalCommandSchema.parse(request.body);
      const event = materializeCanonicalEvent(parsed.event);
      try {
        verifyEventContent(event);
      } catch {
        throw new ResourceScheduleValidationError(
          "Resource schedule event content is invalid",
        );
      }
      if (
        event.aggregateType !== RESOURCE_SCHEDULE_AGGREGATE_TYPE ||
        event.aggregateId === "" ||
        event.eventType !== RESOURCE_SCHEDULE_EVENT_TYPE ||
        event.schemaDigest !== RESOURCE_SCHEDULE_SCHEMA_DIGEST
      ) {
        throw new ResourceScheduleAuthorizationError(
          "Resource schedule event is outside route authority",
        );
      }
      const payload = parseResourceSchedulePublicationPayload(event.payload);
      const aggregate = await replayResourceScheduleAggregate(
        options,
        event.aggregateId,
      );
      const currentTime = now();
      const currentAt = new Date(currentTime).toISOString();
      await requireCareerSignature(
        options,
        event,
        parsed.signatures[0]!,
        currentAt,
      );
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
            "Resource schedule version already has different content",
          );
        }
      } else {
        const occurredAt = canonicalInstant(event.timestamp);
        const latestOccurredAt =
          aggregate.records.at(-1)?.occurredAt.getTime() ??
          Number.NEGATIVE_INFINITY;
        if (occurredAt < latestOccurredAt || occurredAt > currentTime + 60_000)
          throw new ResourceScheduleValidationError(
            "Resource schedule timestamp is outside the accepted window",
          );
        if (
          event.previousEventHash !==
          (aggregate.records.at(-1)?.eventHash ?? null)
        ) {
          throw new HashChainConflictError(
            "Resource schedule previous event hash is invalid",
          );
        }
        await requireConfiguredRatification(options, payload);
        nextSnapshot = applyResourceScheduleTransition(
          aggregate.snapshot,
          event,
          payload,
        );
        if (resourceScheduleStateRoot(nextSnapshot) !== event.stateRoot)
          throw new ResourceScheduleValidationError(
            "Resource schedule state root is invalid",
          );
      }
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
        outboxTopic: "public.resources",
      });
      return reply.code(result.duplicate ? 200 : 201).send({
        accepted: true,
        canonical: true,
        rehearsal: true,
        recognizedGenesisResources: false,
        ratificationSource: "PASSED_REHEARSAL_CONSTITUTIONAL_PROPOSAL",
        schedule: nextSnapshot?.schedule ?? payload.schedule,
        eventId: result.eventId,
        eventHash: result.eventHash,
        aggregateVersion: result.aggregateVersion.toString(),
        duplicate: result.duplicate,
      });
    } catch (error) {
      const response = resourceScheduleError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/resources/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
