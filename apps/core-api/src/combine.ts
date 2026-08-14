import { PremierCombine } from "@abl/institutions";
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
  CandidateNotAdmittedError,
  readCandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import { CareerExitedError, requireCareerOperational } from "./exit-status.js";

const aggregateType = "premier-combine";
const eventType = "CombineRegistrationAccepted";

export const CombineRegistrationSchema = z.strictObject({
  combineId: z.string().min(1).max(200),
  playerDid: z.string().regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/),
  consented: z.literal(true),
  registeredAt: z.iso.datetime({ offset: true }),
  candidateAdmissionEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
});

const CombineStatusSchema = z.strictObject({
  combineId: z.string().min(1).max(200),
});

export const COMBINE_REGISTRATION_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-premier-combine-registration",
  version: 1,
  eventType,
  affirmativeConsentRequired: true,
  windowDays: 14,
});

class CombineAuthorizationError extends Error {
  public override readonly name = "CombineAuthorizationError";
}

class CombineValidationError extends Error {
  public override readonly name = "CombineValidationError";
}

export interface CombineRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  combineId: string;
  openedAt: string;
  now?: () => number;
}

interface CombineAggregate {
  records: StoredCanonicalEvent[];
  combine: PremierCombine;
  registrations: Array<z.infer<typeof CombineRegistrationSchema>>;
}

function candidateOptions(
  options: CombineRehearsalOptions,
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

function combineSnapshot(
  options: CombineRehearsalOptions,
  combine: PremierCombine,
  registrations: readonly z.infer<typeof CombineRegistrationSchema>[],
  version: number,
) {
  return {
    combineId: options.combineId,
    openedAt: combine.openedAt,
    closesAt: combine.closesAt,
    version,
    registrations,
  };
}

async function requireCareerSignature(
  options: CombineRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  candidateAdmissionEventHash: string,
): Promise<void> {
  const authority = await readCandidateCareerAuthority(
    candidateOptions(options),
    event.actorDid,
    event.timestamp,
  );
  if (authority.admissionEventHash !== candidateAdmissionEventHash)
    throw new CombineAuthorizationError(
      "Combine consent is bound to another admission",
    );
  let recovered: string;
  try {
    recovered = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new CombineAuthorizationError("Combine signature is invalid");
  }
  if (recovered.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new CombineAuthorizationError("Combine signer is not the career key");
}

async function replayCombine(
  options: CombineRehearsalOptions,
): Promise<CombineAggregate> {
  const records = await options.store.readAggregate(
    aggregateType,
    options.combineId,
  );
  const combine = new PremierCombine(options.openedAt);
  const registrations: Array<z.infer<typeof CombineRegistrationSchema>> = [];
  let previousHash: string | null = null;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    if (
      event.aggregateType !== aggregateType ||
      event.aggregateId !== options.combineId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      event.eventType !== eventType ||
      event.schemaDigest !== COMBINE_REGISTRATION_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new CombineAuthorizationError(
        "Stored combine aggregate is not authoritative",
      );
    }
    let registration: z.infer<typeof CombineRegistrationSchema>;
    try {
      registration = CombineRegistrationSchema.parse(event.payload);
    } catch {
      throw new CombineAuthorizationError(
        "Stored combine registration is malformed",
      );
    }
    if (
      registration.combineId !== options.combineId ||
      registration.playerDid !== event.actorDid ||
      registration.registeredAt !== event.timestamp
    ) {
      throw new CombineAuthorizationError(
        "Stored combine registration is inconsistent",
      );
    }
    try {
      combine.register(registration);
      await requireCareerSignature(
        options,
        event,
        record.signatures[0],
        registration.candidateAdmissionEventHash,
      );
    } catch (error) {
      if (error instanceof CombineAuthorizationError) throw error;
      throw new CombineAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored combine registration is invalid",
      );
    }
    registrations.push(registration);
    if (
      sha256Commitment(
        combineSnapshot(options, combine, registrations, index + 1),
      ) !== event.stateRoot
    ) {
      throw new CombineAuthorizationError(
        "Stored combine state root is invalid",
      );
    }
    previousHash = event.eventHash;
  }
  return { records, combine, registrations };
}

function combineError(error: unknown): { status: number; code: string } {
  if (
    error instanceof CombineAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "combine_authorization_denied" };
  }
  if (error instanceof z.ZodError || error instanceof CombineValidationError)
    return { status: 400, code: "invalid_combine_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "combine_aggregate_conflict" };
  }
  return { status: 500, code: "combine_failure" };
}

function appendInput(
  options: CombineRehearsalOptions,
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
    outboxTopic: "combine.lifecycle",
  };
}

async function currentEligiblePlayers(
  options: CombineRehearsalOptions,
  registrations: readonly z.infer<typeof CombineRegistrationSchema>[],
  at: string,
): Promise<string[]> {
  const eligible = await Promise.all(
    registrations.map(async (registration) => {
      try {
        const authority = await readCandidateCareerAuthority(
          candidateOptions(options),
          registration.playerDid,
          at,
        );
        await requireCareerOperational(options, registration.playerDid, at);
        return authority.admissionEventHash ===
          registration.candidateAdmissionEventHash
          ? registration.playerDid
          : null;
      } catch (error) {
        if (
          !(error instanceof CandidateNotAdmittedError) &&
          !(error instanceof CareerExitedError)
        ) {
          throw error;
        }
        return null;
      }
    }),
  );
  return eligible.filter(
    (playerDid): playerDid is string => playerDid !== null,
  );
}

function windowState(combine: PremierCombine, now: number) {
  if (now < Date.parse(combine.openedAt)) return "SCHEDULED" as const;
  if (now >= Date.parse(combine.closesAt)) return "CLOSED" as const;
  return "OPEN" as const;
}

export interface CombineRehearsalState {
  combineId: string;
  openedAt: string;
  closesAt: string;
  registrations: readonly z.infer<typeof CombineRegistrationSchema>[];
  eligiblePlayers: readonly string[];
  aggregateVersion: number;
  headEventHash: Hex | null;
  registrationEventHashes: Readonly<Record<string, Hex>>;
}

export async function readCombineRehearsalState(
  options: CombineRehearsalOptions,
  at: string,
): Promise<CombineRehearsalState> {
  const aggregate = await replayCombine(options);
  return {
    combineId: options.combineId,
    openedAt: aggregate.combine.openedAt,
    closesAt: aggregate.combine.closesAt,
    registrations: structuredClone(aggregate.registrations),
    eligiblePlayers: await currentEligiblePlayers(
      options,
      aggregate.registrations,
      at,
    ),
    aggregateVersion: aggregate.records.length,
    headEventHash:
      (aggregate.records.at(-1)?.eventHash as Hex | undefined) ?? null,
    registrationEventHashes: Object.fromEntries(
      aggregate.registrations.map((registration, index) => [
        registration.playerDid,
        aggregate.records[index]!.eventHash as Hex,
      ]),
    ),
  };
}

export function installCombineRehearsalRoutes(
  app: FastifyInstance,
  options: CombineRehearsalOptions,
): void {
  if (options.combineId.length < 1 || options.combineId.length > 200)
    throw new Error("Combine ID is invalid");
  const openedAt = Date.parse(options.openedAt);
  if (
    !Number.isFinite(openedAt) ||
    options.openedAt !== new Date(openedAt).toISOString()
  ) {
    throw new Error("Combine opening time must be canonical");
  }
  const now = options.now ?? Date.now;

  app.post("/v1/combine/register", async (request, reply) => {
    try {
      const parsed = SignedCanonicalCommandSchema.parse(request.body);
      const event = materializeCanonicalEvent(parsed.event);
      try {
        verifyEventContent(event);
      } catch {
        throw new CombineValidationError("Combine event content is invalid");
      }
      if (
        event.aggregateType !== aggregateType ||
        event.aggregateId !== options.combineId ||
        event.eventType !== eventType ||
        event.schemaDigest !== COMBINE_REGISTRATION_SCHEMA_DIGEST
      ) {
        throw new CombineAuthorizationError(
          "Combine event is outside route authority",
        );
      }
      const registration = CombineRegistrationSchema.parse(event.payload);
      const occurredAt = Date.parse(event.timestamp);
      if (
        registration.combineId !== options.combineId ||
        registration.playerDid !== event.actorDid ||
        registration.registeredAt !== event.timestamp ||
        !Number.isFinite(occurredAt) ||
        event.timestamp !== new Date(occurredAt).toISOString() ||
        occurredAt > now() + 60_000
      ) {
        throw new CombineValidationError(
          "Combine registration is inconsistent",
        );
      }
      const aggregate = await replayCombine(options);
      await requireCareerOperational(
        options,
        event.actorDid,
        new Date(now()).toISOString(),
      );
      const existing = aggregate.records.find(
        (record) => record.aggregateVersion === event.aggregateVersion,
      );
      if (existing !== undefined) {
        if (
          existing.eventHash !== event.eventHash ||
          existing.eventId !== event.eventId ||
          existing.idempotencyKey !== event.idempotencyKey
        ) {
          throw new CanonicalConflictError(
            "Combine aggregate version already has different content",
          );
        }
      } else {
        const previousHash = aggregate.records.at(-1)?.eventHash ?? null;
        if (event.previousEventHash !== previousHash)
          throw new HashChainConflictError(
            "Combine previous event hash is invalid",
          );
        try {
          aggregate.combine.register(registration);
        } catch (error) {
          throw new CombineValidationError(
            error instanceof Error
              ? error.message
              : "Combine registration failed",
          );
        }
        await requireCareerSignature(
          options,
          event,
          parsed.signatures[0]!,
          registration.candidateAdmissionEventHash,
        );
        const snapshot = combineSnapshot(
          options,
          aggregate.combine,
          [...aggregate.registrations, registration],
          aggregate.records.length + 1,
        );
        if (sha256Commitment(snapshot) !== event.stateRoot)
          throw new CombineValidationError("Combine state root is invalid");
      }
      const result = await options.store.append(
        appendInput(options, event, parsed.signatures),
      );
      return reply.code(result.duplicate ? 200 : 201).send({
        accepted: true,
        canonical: true,
        rehearsal: true,
        recognizedGenesisCombine: false,
        eventId: result.eventId,
        eventHash: result.eventHash,
        aggregateVersion: result.aggregateVersion.toString(),
        duplicate: result.duplicate,
      });
    } catch (error) {
      const response = combineError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/combine/status", async (request, reply) => {
    try {
      const status = CombineStatusSchema.parse(request.body);
      if (status.combineId !== options.combineId)
        return reply.code(404).send({ error: "combine_not_found" });
      const aggregate = await replayCombine(options);
      const currentTime = now();
      const currentAt = new Date(currentTime).toISOString();
      return {
        combineId: options.combineId,
        state: windowState(aggregate.combine, currentTime),
        openedAt: aggregate.combine.openedAt,
        closesAt: aggregate.combine.closesAt,
        aggregateVersion: aggregate.records.length,
        eventHash: aggregate.records.at(-1)?.eventHash ?? null,
        registeredPlayers: aggregate.registrations.map(
          (registration) => registration.playerDid,
        ),
        eligiblePlayers: await currentEligiblePlayers(
          options,
          aggregate.registrations,
          currentAt,
        ),
        recognizedGenesisCombine: false,
      };
    } catch (error) {
      const response = combineError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });
}
