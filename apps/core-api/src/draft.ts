import {
  COMBINE_RESULT_AGGREGATE_TYPE,
  COMBINE_RESULT_CERTIFIED_EVENT_TYPE,
  COMBINE_RESULT_SCHEMA_DIGEST,
  CombineResultPayloadSchema,
  PREMIER_DRAFT_AGGREGATE_TYPE,
  PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
  PREMIER_DRAFT_SCHEMA_DIGEST,
  combineResultStateRoot,
  premierDraftStateRoot,
  requirePremierDraftEvidence,
  validatePremierDraftCompletion,
  type CombineResultPayload,
  type PremierDraftCompletedPayload,
  type PremierDraftEvidenceReader,
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
import { UuidV7Schema } from "@abl/schemas";
import type { FastifyInstance } from "fastify";
import type { Hex, TypedDataDomain } from "viem";
import { z } from "zod";

import {
  SignedCanonicalMultiCommandSchema,
  canonicalEventFromStored,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import {
  CandidateAuthorizationError,
  readCandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import {
  readCombineRehearsalState,
  type CombineRehearsalOptions,
  type CombineRehearsalState,
} from "./combine.js";
import { CareerExitedError, requireCareerOperational } from "./exit-status.js";

interface DraftAgentAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

export interface DraftRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<string, DraftAgentAuthority>;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  combine: Pick<CombineRehearsalOptions, "combineId" | "openedAt">;
  combineOfficialDid: string;
  draftAuthorityDid: string;
  clubGovernors: Readonly<Record<string, string>>;
  draftEvidence: PremierDraftEvidenceReader;
  now?: () => number;
}

class DraftAuthorizationError extends Error {
  public override readonly name = "DraftAuthorizationError";
}

class DraftValidationError extends Error {
  public override readonly name = "DraftValidationError";
}

function candidateOptions(
  options: DraftRehearsalOptions,
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

function combineOptions(
  options: DraftRehearsalOptions,
): CombineRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    candidateAdmission: options.candidateAdmission,
    ...options.combine,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new DraftValidationError("Draft timestamp is not canonical");
  return parsed;
}

async function careerSigningAddress(
  options: DraftRehearsalOptions,
  did: string,
  aggregateType: string,
  at: string,
): Promise<`0x${string}`> {
  const career = await readCandidateCareerAuthority(
    candidateOptions(options),
    did,
    at,
  );
  const configured = options.admittedAgents.get(did);
  if (
    configured === undefined ||
    !configured.allowedAggregateTypes.includes(aggregateType) ||
    configured.signerAddress.toLowerCase() !==
      career.signingAddress.toLowerCase()
  ) {
    throw new DraftAuthorizationError(
      "Draft participant lacks configured aggregate scope",
    );
  }
  return career.signingAddress;
}

async function requireOrderedSignatures(
  options: DraftRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
  signerDids: readonly string[],
  at: string,
): Promise<void> {
  if (
    signatures.length !== signerDids.length ||
    new Set(signerDids).size !== signerDids.length
  ) {
    throw new DraftAuthorizationError(
      "Draft command signer roster is malformed",
    );
  }
  const expected = await Promise.all(
    signerDids.map((did) =>
      careerSigningAddress(options, did, event.aggregateType, at),
    ),
  );
  if (
    new Set(expected.map((address) => address.toLowerCase())).size !==
    expected.length
  )
    throw new DraftAuthorizationError("Draft signer keys must be distinct");
  const recovered = await Promise.all(
    signatures.map(async (signature) => {
      try {
        return await recoverCanonicalEventSigner(
          options.domain,
          event,
          signature as Hex,
        );
      } catch {
        throw new DraftAuthorizationError("Draft signature is invalid");
      }
    }),
  );
  if (
    recovered.some(
      (address, index) =>
        address.toLowerCase() !== expected[index]!.toLowerCase(),
    )
  ) {
    throw new DraftAuthorizationError(
      "Draft signatures do not match the ordered authority roster",
    );
  }
}

async function validateCombineResultAgainstState(
  options: DraftRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
  combine: CombineRehearsalState,
): Promise<CombineResultPayload> {
  const payload = CombineResultPayloadSchema.parse(event.payload);
  const registration = combine.registrations.find(
    ({ playerDid }) => playerDid === payload.playerDid,
  );
  if (
    event.actorDid !== payload.playerDid ||
    event.aggregateType !== COMBINE_RESULT_AGGREGATE_TYPE ||
    event.aggregateId !== `${options.combine.combineId}:${payload.playerDid}` ||
    event.aggregateVersion !== 1n ||
    event.eventType !== COMBINE_RESULT_CERTIFIED_EVENT_TYPE ||
    event.previousEventHash !== null ||
    event.schemaDigest !== COMBINE_RESULT_SCHEMA_DIGEST ||
    payload.combineId !== options.combine.combineId ||
    payload.certifiedByDid !== options.combineOfficialDid ||
    payload.completedAt !== event.timestamp ||
    registration === undefined ||
    !combine.eligiblePlayers.includes(payload.playerDid) ||
    combine.registrationEventHashes[payload.playerDid] !==
      payload.registrationEventHash ||
    canonicalInstant(payload.completedAt) <
      canonicalInstant(registration.registeredAt) ||
    canonicalInstant(payload.completedAt) >=
      canonicalInstant(combine.closesAt) ||
    combineResultStateRoot(payload) !== event.stateRoot
  ) {
    throw new DraftValidationError(
      "Combine result does not bind an eligible registration",
    );
  }
  await requireOrderedSignatures(
    options,
    event,
    signatures,
    [payload.playerDid, options.combineOfficialDid],
    event.timestamp,
  );
  return payload;
}

async function validateCombineResult(
  options: DraftRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
): Promise<CombineResultPayload> {
  const combine = await readCombineRehearsalState(
    combineOptions(options),
    event.timestamp,
  );
  return validateCombineResultAgainstState(options, event, signatures, combine);
}

async function readVerifiedCombineResult(
  options: DraftRehearsalOptions,
  playerDid: string,
  combine: CombineRehearsalState,
): Promise<{ event: CanonicalEvent; payload: CombineResultPayload }> {
  const records = await options.store.readAggregate(
    COMBINE_RESULT_AGGREGATE_TYPE,
    `${options.combine.combineId}:${playerDid}`,
  );
  if (
    records.length !== 1 ||
    records[0]!.signatures.length !== 2 ||
    records[0]!.signatures.some((signature) => typeof signature !== "string")
  ) {
    throw new DraftAuthorizationError(
      "Stored combine result is not authoritative",
    );
  }
  const event = canonicalEventFromStored(records[0]!);
  try {
    verifyEventContent(event);
    const payload = await validateCombineResultAgainstState(
      options,
      event,
      records[0]!.signatures as string[],
      combine,
    );
    return { event, payload };
  } catch (error) {
    if (
      error instanceof DraftAuthorizationError ||
      error instanceof CandidateAuthorizationError
    ) {
      throw error;
    }
    throw new DraftAuthorizationError(
      error instanceof Error
        ? error.message
        : "Stored combine result is invalid",
    );
  }
}

async function validateDraftCompletion(
  options: DraftRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
): Promise<PremierDraftCompletedPayload> {
  let payload: PremierDraftCompletedPayload;
  try {
    payload = validatePremierDraftCompletion(event.payload);
  } catch (error) {
    throw new DraftValidationError(
      error instanceof Error ? error.message : "Premier draft is invalid",
    );
  }
  const combine = await readCombineRehearsalState(
    combineOptions(options),
    event.timestamp,
  );
  const configuredClubs = Object.keys(options.clubGovernors);
  if (
    event.actorDid !== options.draftAuthorityDid ||
    event.aggregateType !== PREMIER_DRAFT_AGGREGATE_TYPE ||
    event.aggregateId !== payload.draftId ||
    event.aggregateVersion !== 1n ||
    event.eventType !== PREMIER_DRAFT_COMPLETED_EVENT_TYPE ||
    event.previousEventHash !== null ||
    event.schemaDigest !== PREMIER_DRAFT_SCHEMA_DIGEST ||
    payload.combineId !== options.combine.combineId ||
    payload.completedAt !== event.timestamp ||
    canonicalInstant(payload.completedAt) <
      canonicalInstant(combine.closesAt) ||
    combine.headEventHash === null ||
    payload.combineHeadEventHash !== combine.headEventHash ||
    combine.eligiblePlayers.length !== 32 ||
    new Set([...combine.eligiblePlayers, ...payload.playerOrder]).size !== 32 ||
    configuredClubs.length !== 4 ||
    new Set([...configuredClubs, ...payload.clubOrder]).size !== 4 ||
    premierDraftStateRoot(payload) !== event.stateRoot
  ) {
    throw new DraftValidationError(
      "Premier draft does not bind the closed combine and configured clubs",
    );
  }
  const results = await Promise.all(
    payload.playerOrder.map((playerDid) =>
      readVerifiedCombineResult(options, playerDid, combine),
    ),
  );
  const resultByPlayer = new Map(
    results.map((result) => [result.payload.playerDid, result]),
  );
  for (const proof of payload.combineResults) {
    const result = resultByPlayer.get(proof.playerDid);
    if (
      result === undefined ||
      result.event.eventHash !== proof.eventHash ||
      result.event.stateRoot !== proof.stateRoot ||
      result.payload.scoreBps !== proof.scoreBps
    ) {
      throw new DraftValidationError(
        "Premier draft combine-result proof is invalid",
      );
    }
  }
  try {
    await requirePremierDraftEvidence(payload, options.draftEvidence);
  } catch (error) {
    throw new DraftValidationError(
      error instanceof Error ? error.message : "Draft evidence is invalid",
    );
  }
  const signerDids = [
    options.draftAuthorityDid,
    ...payload.clubOrder.map((clubId) => options.clubGovernors[clubId]!),
  ];
  await requireOrderedSignatures(
    options,
    event,
    signatures,
    signerDids,
    event.timestamp,
  );
  return payload;
}

function appendInput(
  options: DraftRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
  outboxTopic: "combine.results" | "public.draft",
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
    outboxTopic,
  };
}

function safeRetry(
  event: CanonicalEvent,
  existing: StoredCanonicalEvent,
): void {
  if (
    existing.eventHash !== event.eventHash ||
    existing.eventId !== event.eventId ||
    existing.idempotencyKey !== event.idempotencyKey
  ) {
    throw new CanonicalConflictError(
      "Combine/draft aggregate already contains different content",
    );
  }
}

function draftError(error: unknown): { status: number; code: string } {
  if (
    error instanceof DraftAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "draft_authorization_denied" };
  }
  if (error instanceof z.ZodError || error instanceof DraftValidationError)
    return { status: 400, code: "invalid_draft_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "draft_aggregate_conflict" };
  }
  return { status: 500, code: "draft_failure" };
}

function validateCommandEnvelope(event: CanonicalEvent): void {
  try {
    verifyEventContent(event);
    UuidV7Schema.parse(event.eventId);
    UuidV7Schema.parse(event.idempotencyKey);
  } catch {
    throw new DraftValidationError("Combine/draft event content is invalid");
  }
}

function response(result: {
  eventId: string;
  eventHash: string;
  aggregateVersion: bigint;
  duplicate: boolean;
}) {
  return {
    accepted: true,
    canonical: true,
    rehearsal: true,
    recognizedGenesisDraft: false,
    eventId: result.eventId,
    eventHash: result.eventHash,
    aggregateVersion: result.aggregateVersion.toString(),
    duplicate: result.duplicate,
  };
}

export function installDraftRehearsalRoutes(
  app: FastifyInstance,
  options: DraftRehearsalOptions,
): void {
  const now = options.now ?? Date.now;
  app.post("/v1/combine/results/certify", async (request, reply) => {
    try {
      const parsed = SignedCanonicalMultiCommandSchema.parse(request.body);
      const event = materializeCanonicalEvent(parsed.event);
      validateCommandEnvelope(event);
      const currentTime = now();
      const occurredAt = canonicalInstant(event.timestamp);
      if (Math.abs(currentTime - occurredAt) > 60_000)
        throw new DraftValidationError(
          "Combine result timestamp is outside the accepted window",
        );
      await requireCareerOperational(
        options,
        event.actorDid,
        new Date(currentTime).toISOString(),
      );
      const existing = (
        await options.store.readAggregate(
          event.aggregateType,
          event.aggregateId,
        )
      ).find((record) => record.aggregateVersion === event.aggregateVersion);
      let payload: CombineResultPayload;
      if (existing !== undefined) {
        safeRetry(event, existing);
        payload = await validateCombineResult(
          options,
          event,
          parsed.signatures,
        );
      } else {
        payload = await validateCombineResult(
          options,
          event,
          parsed.signatures,
        );
      }
      const result = await options.store.append(
        appendInput(options, event, parsed.signatures, "combine.results"),
      );
      return reply.code(result.duplicate ? 200 : 201).send({
        ...response(result),
        result: payload,
      });
    } catch (error) {
      const failure = draftError(error);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });

  app.post("/v1/combine/draft/complete", async (request, reply) => {
    try {
      const parsed = SignedCanonicalMultiCommandSchema.parse(request.body);
      const event = materializeCanonicalEvent(parsed.event);
      validateCommandEnvelope(event);
      const currentTime = now();
      const occurredAt = canonicalInstant(event.timestamp);
      if (Math.abs(currentTime - occurredAt) > 60_000)
        throw new DraftValidationError(
          "Draft completion timestamp is outside the accepted window",
        );
      const signerDids = [
        options.draftAuthorityDid,
        ...Object.values(options.clubGovernors),
      ];
      await Promise.all(
        signerDids.map((did) =>
          requireCareerOperational(
            options,
            did,
            new Date(currentTime).toISOString(),
          ),
        ),
      );
      const existing = (
        await options.store.readAggregate(
          event.aggregateType,
          event.aggregateId,
        )
      ).find((record) => record.aggregateVersion === event.aggregateVersion);
      let payload: PremierDraftCompletedPayload;
      if (existing !== undefined) {
        safeRetry(event, existing);
        payload = await validateDraftCompletion(
          options,
          event,
          parsed.signatures,
        );
      } else {
        payload = await validateDraftCompletion(
          options,
          event,
          parsed.signatures,
        );
      }
      const result = await options.store.append(
        appendInput(options, event, parsed.signatures, "public.draft"),
      );
      return reply.code(result.duplicate ? 200 : 201).send({
        ...response(result),
        draft: payload,
      });
    } catch (error) {
      const failure = draftError(error);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
}
