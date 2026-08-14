import {
  FILM_ADMITTED_EVENT_TYPE,
  FILM_INSPECTED_EVENT_TYPE,
  FINALIZED_GAME_AGGREGATE_TYPE,
  FINALIZED_GAME_SCHEMA_DIGEST,
  FilmAdmittedPayloadSchema,
  FilmInspectedPayloadSchema,
  GAME_FINALIZED_EVENT_TYPE,
  PRACTICE_INSPECTED_EVENT_TYPE,
  PRACTICE_LESSON_EVENT_TYPE,
  PRACTICE_RUN_EVENT_TYPE,
  PRIVATE_FILM_AGGREGATE_TYPE,
  PRIVATE_FILM_SCHEMA_DIGEST,
  PRIVATE_PRACTICE_AGGREGATE_TYPE,
  PRIVATE_PRACTICE_SCHEMA_DIGEST,
  PracticeInspectedPayloadSchema,
  PracticeLessonPayloadSchema,
  PracticeRunPayloadSchema,
  deriveCounterfactualPracticeRun,
  finalizedGameStateRoot,
  privateFilmCatalogStateRoot,
  privatePracticeLedgerStateRoot,
  replayFinalizedGamePayload,
  requireFinalizedGameEvidence,
  type CanonicalPrivateFilmRecord,
  type CounterfactualPracticeRun,
  type DurablePracticeLesson,
  type FilmDeliveryEvidenceReader,
  type FinalizedGameEvidenceReader,
} from "@abl/basketball";
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
import type { MemoryStorageVerifier } from "./memory-storage.js";

const filmEventTypes = [
  FILM_ADMITTED_EVENT_TYPE,
  FILM_INSPECTED_EVENT_TYPE,
] as const;
type FilmEventType = (typeof filmEventTypes)[number];
const practiceEventTypes = [
  PRACTICE_RUN_EVENT_TYPE,
  PRACTICE_LESSON_EVENT_TYPE,
  PRACTICE_INSPECTED_EVENT_TYPE,
] as const;
type PracticeEventType = (typeof practiceEventTypes)[number];

interface FilmPracticeAgentAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

export interface FilmPracticeRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<string, FilmPracticeAgentAuthority>;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  storageVerifier: MemoryStorageVerifier;
  filmDeliveryEvidence: FilmDeliveryEvidenceReader;
  finalizerDids: ReadonlySet<string>;
  finalizedGameEvidence: FinalizedGameEvidenceReader;
  now?: () => number;
}

interface FilmAggregate {
  records: StoredCanonicalEvent[];
  films: Map<string, CanonicalPrivateFilmRecord>;
}

interface PracticeAggregate {
  records: StoredCanonicalEvent[];
  runs: Map<string, CounterfactualPracticeRun>;
  lessons: Map<string, DurablePracticeLesson>;
}

class FilmPracticeAuthorizationError extends Error {
  public override readonly name = "FilmPracticeAuthorizationError";
}

class FilmPracticeValidationError extends Error {
  public override readonly name = "FilmPracticeValidationError";
}

class FilmPracticeSourceError extends Error {
  public override readonly name = "FilmPracticeSourceError";
}

class FilmPracticeStorageError extends Error {
  public override readonly name = "FilmPracticeStorageError";
}

function candidateOptions(
  options: FilmPracticeRehearsalOptions,
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
    throw new FilmPracticeValidationError("Timestamp is not canonical");
  return parsed;
}

function filmPayload(eventType: FilmEventType, payload: unknown) {
  return eventType === FILM_ADMITTED_EVENT_TYPE
    ? FilmAdmittedPayloadSchema.parse(payload)
    : FilmInspectedPayloadSchema.parse(payload);
}

function practicePayload(eventType: PracticeEventType, payload: unknown) {
  if (eventType === PRACTICE_RUN_EVENT_TYPE)
    return PracticeRunPayloadSchema.parse(payload);
  if (eventType === PRACTICE_LESSON_EVENT_TYPE)
    return PracticeLessonPayloadSchema.parse(payload);
  return PracticeInspectedPayloadSchema.parse(payload);
}

async function requireCareerSignature(
  options: FilmPracticeRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<void> {
  const career = await readCandidateCareerAuthority(
    candidateOptions(options),
    event.actorDid,
    at,
  );
  const configured = options.admittedAgents.get(event.actorDid);
  if (
    configured === undefined ||
    !configured.allowedAggregateTypes.includes(event.aggregateType) ||
    configured.signerAddress.toLowerCase() !==
      career.signingAddress.toLowerCase()
  ) {
    throw new FilmPracticeAuthorizationError(
      "Career lacks configured film/practice scope",
    );
  }
  let recovered: string;
  try {
    recovered = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new FilmPracticeAuthorizationError(
      "Film/practice signature is invalid",
    );
  }
  if (recovered.toLowerCase() !== career.signingAddress.toLowerCase())
    throw new FilmPracticeAuthorizationError(
      "Film/practice signer is not the career key",
    );
}

async function readVerifiedFinalizedGame(
  options: FilmPracticeRehearsalOptions,
  gameId: string,
): Promise<ReturnType<typeof replayFinalizedGamePayload>> {
  const records = await options.store.readAggregate(
    FINALIZED_GAME_AGGREGATE_TYPE,
    gameId,
  );
  if (records.length !== 1)
    throw new FilmPracticeSourceError(
      "Film source is not one finalized canonical game",
    );
  const record = records[0]!;
  const event = canonicalEventFromStored(record);
  const authority = options.admittedAgents.get(event.actorDid);
  if (
    !options.finalizerDids.has(event.actorDid) ||
    authority === undefined ||
    !authority.allowedAggregateTypes.includes(FINALIZED_GAME_AGGREGATE_TYPE) ||
    record.signatures.length !== 1 ||
    typeof record.signatures[0] !== "string"
  ) {
    throw new FilmPracticeSourceError(
      "Stored finalized-game authority is invalid",
    );
  }
  let recovered: string;
  try {
    verifyEventContent(event);
    UuidV7Schema.parse(event.eventId);
    UuidV7Schema.parse(event.idempotencyKey);
    UuidV7Schema.parse(event.aggregateId);
    recovered = await recoverCanonicalEventSigner(
      options.domain,
      event,
      record.signatures[0] as Hex,
    );
  } catch {
    throw new FilmPracticeSourceError("Stored finalized-game proof is invalid");
  }
  if (recovered.toLowerCase() !== authority.signerAddress.toLowerCase())
    throw new FilmPracticeSourceError(
      "Stored finalized-game signer is not registered",
    );
  try {
    const replayed = replayFinalizedGamePayload(event.payload);
    await requireFinalizedGameEvidence(
      replayed.payload,
      options.finalizedGameEvidence,
    );
    if (
      event.aggregateType !== FINALIZED_GAME_AGGREGATE_TYPE ||
      event.aggregateId !== gameId ||
      event.aggregateVersion !== 1n ||
      event.eventType !== GAME_FINALIZED_EVENT_TYPE ||
      event.previousEventHash !== null ||
      event.schemaDigest !== FINALIZED_GAME_SCHEMA_DIGEST ||
      event.timestamp !== replayed.payload.finalizedAt ||
      finalizedGameStateRoot(replayed.payload) !== event.stateRoot
    ) {
      throw new Error("Finalized-game event does not bind exact replay");
    }
    return replayed;
  } catch (error) {
    throw new FilmPracticeSourceError(
      error instanceof Error
        ? error.message
        : "Stored finalized game cannot be replayed",
    );
  }
}

function sortedValues<T>(values: ReadonlyMap<string, T>): T[] {
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => structuredClone(value));
}

async function applyFilmEvent(
  options: FilmPracticeRehearsalOptions,
  ownerDid: string,
  films: Map<string, CanonicalPrivateFilmRecord>,
  eventType: FilmEventType,
  payload: ReturnType<typeof filmPayload>,
  timestamp: string,
): Promise<void> {
  if (eventType === FILM_INSPECTED_EVENT_TYPE) {
    const inspection = FilmInspectedPayloadSchema.parse(payload);
    if (
      inspection.ownerDid !== ownerDid ||
      inspection.requestedAt !== timestamp
    ) {
      throw new FilmPracticeValidationError(
        "Film inspection does not bind its owner and event time",
      );
    }
    return;
  }
  const { film } = FilmAdmittedPayloadSchema.parse(payload);
  if (
    film.ownerDid !== ownerDid ||
    film.admittedAt !== timestamp ||
    film.storage.objectId !== film.filmId ||
    films.has(film.filmId) ||
    [...films.values()].some((candidate) => candidate.gameId === film.gameId)
  ) {
    throw new FilmPracticeValidationError(
      "Film admission is inconsistent with the private catalog",
    );
  }
  const delivery = await options.filmDeliveryEvidence.filmDeliveryEvidence(
    film.gameId,
    ownerDid,
  );
  if (delivery === null)
    throw new FilmPracticeAuthorizationError(
      "Career is not authorized for this game film",
    );
  if (delivery.ciphertextCommitment !== film.storage.ciphertextCommitment)
    throw new FilmPracticeSourceError(
      "Private film ciphertext does not match delivery evidence",
    );
  const source = await readVerifiedFinalizedGame(options, film.gameId);
  if (
    film.sourceFilmCommitment !== source.payload.filmCommitment ||
    film.eventRoot !== source.payload.proof.eventMerkleRoot ||
    film.finalStateRoot !== source.payload.proof.finalStateRoot
  ) {
    throw new FilmPracticeSourceError(
      "Film admission does not bind the finalized game proof",
    );
  }
  try {
    await options.storageVerifier.verifyCommitment(ownerDid, film.storage);
  } catch {
    throw new FilmPracticeStorageError(
      "Private film ciphertext commitment is not durable",
    );
  }
  films.set(film.filmId, structuredClone(film));
}

async function replayFilmAggregate(
  options: FilmPracticeRehearsalOptions,
  ownerDid: string,
): Promise<FilmAggregate> {
  const records = await options.store.readAggregate(
    PRIVATE_FILM_AGGREGATE_TYPE,
    ownerDid,
  );
  const films = new Map<string, CanonicalPrivateFilmRecord>();
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = canonicalInstant(event.timestamp);
    if (
      event.actorDid !== ownerDid ||
      event.aggregateType !== PRIVATE_FILM_AGGREGATE_TYPE ||
      event.aggregateId !== ownerDid ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !filmEventTypes.includes(event.eventType as FilmEventType) ||
      event.schemaDigest !== PRIVATE_FILM_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new FilmPracticeAuthorizationError(
        "Stored private-film aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
      const eventType = event.eventType as FilmEventType;
      await applyFilmEvent(
        options,
        ownerDid,
        films,
        eventType,
        filmPayload(eventType, event.payload),
        event.timestamp,
      );
      if (
        privateFilmCatalogStateRoot(ownerDid, index + 1, films) !==
        event.stateRoot
      ) {
        throw new Error("Stored private-film state root is invalid");
      }
      await requireCareerSignature(
        options,
        event,
        record.signatures[0],
        event.timestamp,
      );
    } catch (error) {
      if (
        error instanceof FilmPracticeAuthorizationError ||
        error instanceof FilmPracticeSourceError ||
        error instanceof FilmPracticeStorageError
      ) {
        throw error;
      }
      throw new FilmPracticeAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored private-film event is malformed",
      );
    }
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, films };
}

async function applyPracticeEvent(
  options: FilmPracticeRehearsalOptions,
  ownerDid: string,
  films: ReadonlyMap<string, CanonicalPrivateFilmRecord>,
  runs: Map<string, CounterfactualPracticeRun>,
  lessons: Map<string, DurablePracticeLesson>,
  eventType: PracticeEventType,
  payload: ReturnType<typeof practicePayload>,
  timestamp: string,
): Promise<void> {
  if (eventType === PRACTICE_INSPECTED_EVENT_TYPE) {
    const inspection = PracticeInspectedPayloadSchema.parse(payload);
    if (
      inspection.ownerDid !== ownerDid ||
      inspection.requestedAt !== timestamp
    ) {
      throw new FilmPracticeValidationError(
        "Practice inspection does not bind its owner and event time",
      );
    }
    return;
  }
  if (eventType === PRACTICE_LESSON_EVENT_TYPE) {
    const { lesson } = PracticeLessonPayloadSchema.parse(payload);
    if (
      lesson.ownerDid !== ownerDid ||
      lesson.authoredAt !== timestamp ||
      !runs.has(lesson.sourcePracticeId) ||
      lessons.has(lesson.lessonId)
    ) {
      throw new FilmPracticeValidationError(
        "Durable lesson is inconsistent with the practice ledger",
      );
    }
    lessons.set(lesson.lessonId, structuredClone(lesson));
    return;
  }
  const { run } = PracticeRunPayloadSchema.parse(payload);
  const film = films.get(run.filmId);
  if (
    run.ownerDid !== ownerDid ||
    run.requestedAt !== timestamp ||
    film === undefined ||
    film.gameId !== run.gameId ||
    runs.has(run.practiceId)
  ) {
    throw new FilmPracticeValidationError(
      "Counterfactual run is inconsistent with private film",
    );
  }
  const source = await readVerifiedFinalizedGame(options, run.gameId);
  if (
    !source.events.some((event) => event.stateRoot === run.baseStateRoot) &&
    source.payload.proof.finalStateRoot !== run.baseStateRoot
  ) {
    throw new FilmPracticeSourceError(
      "Counterfactual base state is absent from finalized game history",
    );
  }
  const expected = deriveCounterfactualPracticeRun({
    film,
    baseStateRoot: run.baseStateRoot as Hex,
    changedIntentCommitments: run.changedIntentCommitments as Hex[],
    requestedAt: run.requestedAt,
  });
  if (sha256Commitment(expected) !== sha256Commitment(run))
    throw new FilmPracticeValidationError(
      "Counterfactual result does not match deterministic practice",
    );
  runs.set(run.practiceId, structuredClone(run));
}

async function replayPracticeAggregate(
  options: FilmPracticeRehearsalOptions,
  ownerDid: string,
  films: ReadonlyMap<string, CanonicalPrivateFilmRecord>,
): Promise<PracticeAggregate> {
  const records = await options.store.readAggregate(
    PRIVATE_PRACTICE_AGGREGATE_TYPE,
    ownerDid,
  );
  const runs = new Map<string, CounterfactualPracticeRun>();
  const lessons = new Map<string, DurablePracticeLesson>();
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = canonicalInstant(event.timestamp);
    if (
      event.actorDid !== ownerDid ||
      event.aggregateType !== PRIVATE_PRACTICE_AGGREGATE_TYPE ||
      event.aggregateId !== ownerDid ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !practiceEventTypes.includes(event.eventType as PracticeEventType) ||
      event.schemaDigest !== PRIVATE_PRACTICE_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new FilmPracticeAuthorizationError(
        "Stored private-practice aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
      const eventType = event.eventType as PracticeEventType;
      await applyPracticeEvent(
        options,
        ownerDid,
        films,
        runs,
        lessons,
        eventType,
        practicePayload(eventType, event.payload),
        event.timestamp,
      );
      if (
        privatePracticeLedgerStateRoot(ownerDid, index + 1, runs, lessons) !==
        event.stateRoot
      ) {
        throw new Error("Stored private-practice state root is invalid");
      }
      await requireCareerSignature(
        options,
        event,
        record.signatures[0],
        event.timestamp,
      );
    } catch (error) {
      if (
        error instanceof FilmPracticeAuthorizationError ||
        error instanceof FilmPracticeSourceError ||
        error instanceof FilmPracticeStorageError
      ) {
        throw error;
      }
      throw new FilmPracticeAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored private-practice event is malformed",
      );
    }
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, runs, lessons };
}

function validateNewEventTime(
  event: CanonicalEvent,
  records: readonly StoredCanonicalEvent[],
  now: number,
): void {
  const occurredAt = canonicalInstant(event.timestamp);
  const latest =
    records.at(-1)?.occurredAt.getTime() ?? Number.NEGATIVE_INFINITY;
  if (
    occurredAt < latest ||
    occurredAt < now - 60_000 ||
    occurredAt > now + 60_000
  ) {
    throw new FilmPracticeValidationError(
      "Film/practice timestamp is outside the accepted window",
    );
  }
}

function assertSafeRetry(
  event: CanonicalEvent,
  existing: StoredCanonicalEvent,
  label: string,
): void {
  if (
    existing.eventHash !== event.eventHash ||
    existing.eventId !== event.eventId ||
    existing.idempotencyKey !== event.idempotencyKey
  ) {
    throw new CanonicalConflictError(
      `${label} aggregate version already has different content`,
    );
  }
}

function appendInput(
  options: FilmPracticeRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
  outboxTopic: "career.film" | "career.practice",
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

function filmPracticeError(error: unknown): { status: number; code: string } {
  if (
    error instanceof FilmPracticeAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "film_practice_authorization_denied" };
  }
  if (error instanceof FilmPracticeStorageError)
    return { status: 409, code: "private_film_storage_unverified" };
  if (error instanceof FilmPracticeSourceError)
    return { status: 409, code: "finalized_game_source_unverified" };
  if (
    error instanceof z.ZodError ||
    error instanceof FilmPracticeValidationError
  )
    return { status: 400, code: "invalid_film_practice_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "film_practice_aggregate_conflict" };
  }
  return { status: 500, code: "film_practice_failure" };
}

async function handleFilmCommand(
  body: unknown,
  expectedEventType: FilmEventType,
  options: FilmPracticeRehearsalOptions,
) {
  const parsed = SignedCanonicalCommandSchema.parse(body);
  const event = materializeCanonicalEvent(parsed.event);
  try {
    verifyEventContent(event);
    UuidV7Schema.parse(event.eventId);
    UuidV7Schema.parse(event.idempotencyKey);
  } catch {
    throw new FilmPracticeValidationError("Film event content is invalid");
  }
  if (
    event.aggregateType !== PRIVATE_FILM_AGGREGATE_TYPE ||
    event.aggregateId !== event.actorDid ||
    event.eventType !== expectedEventType ||
    event.schemaDigest !== PRIVATE_FILM_SCHEMA_DIGEST
  ) {
    throw new FilmPracticeAuthorizationError(
      "Film event is outside route authority",
    );
  }
  const payload = filmPayload(expectedEventType, event.payload);
  const aggregate = await replayFilmAggregate(options, event.actorDid);
  const currentTime = (options.now ?? Date.now)();
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
  if (existing !== undefined) {
    assertSafeRetry(event, existing, "Private-film");
  } else {
    validateNewEventTime(event, aggregate.records, currentTime);
    if (
      event.previousEventHash !== (aggregate.records.at(-1)?.eventHash ?? null)
    ) {
      throw new HashChainConflictError(
        "Private-film previous event hash is invalid",
      );
    }
    await applyFilmEvent(
      options,
      event.actorDid,
      aggregate.films,
      expectedEventType,
      payload,
      event.timestamp,
    );
    if (
      privateFilmCatalogStateRoot(
        event.actorDid,
        aggregate.records.length + 1,
        aggregate.films,
      ) !== event.stateRoot
    ) {
      throw new FilmPracticeValidationError(
        "Private-film catalog state root is invalid",
      );
    }
  }
  const result = await options.store.append(
    appendInput(options, event, parsed.signatures, "career.film"),
  );
  return { aggregate, payload, result };
}

async function handlePracticeCommand(
  body: unknown,
  expectedEventType: PracticeEventType,
  options: FilmPracticeRehearsalOptions,
) {
  const parsed = SignedCanonicalCommandSchema.parse(body);
  const event = materializeCanonicalEvent(parsed.event);
  try {
    verifyEventContent(event);
    UuidV7Schema.parse(event.eventId);
    UuidV7Schema.parse(event.idempotencyKey);
  } catch {
    throw new FilmPracticeValidationError("Practice event content is invalid");
  }
  if (
    event.aggregateType !== PRIVATE_PRACTICE_AGGREGATE_TYPE ||
    event.aggregateId !== event.actorDid ||
    event.eventType !== expectedEventType ||
    event.schemaDigest !== PRIVATE_PRACTICE_SCHEMA_DIGEST
  ) {
    throw new FilmPracticeAuthorizationError(
      "Practice event is outside route authority",
    );
  }
  const payload = practicePayload(expectedEventType, event.payload);
  const film = await replayFilmAggregate(options, event.actorDid);
  const aggregate = await replayPracticeAggregate(
    options,
    event.actorDid,
    film.films,
  );
  const currentTime = (options.now ?? Date.now)();
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
  if (existing !== undefined) {
    assertSafeRetry(event, existing, "Private-practice");
  } else {
    validateNewEventTime(event, aggregate.records, currentTime);
    if (
      event.previousEventHash !== (aggregate.records.at(-1)?.eventHash ?? null)
    ) {
      throw new HashChainConflictError(
        "Private-practice previous event hash is invalid",
      );
    }
    await applyPracticeEvent(
      options,
      event.actorDid,
      film.films,
      aggregate.runs,
      aggregate.lessons,
      expectedEventType,
      payload,
      event.timestamp,
    );
    if (
      privatePracticeLedgerStateRoot(
        event.actorDid,
        aggregate.records.length + 1,
        aggregate.runs,
        aggregate.lessons,
      ) !== event.stateRoot
    ) {
      throw new FilmPracticeValidationError(
        "Private-practice ledger state root is invalid",
      );
    }
  }
  const result = await options.store.append(
    appendInput(options, event, parsed.signatures, "career.practice"),
  );
  return { aggregate, payload, result };
}

function canonicalResponse(result: {
  eventId: string;
  eventHash: string;
  aggregateVersion: bigint;
  duplicate: boolean;
}) {
  return {
    accepted: true,
    canonical: true,
    rehearsal: true,
    privateContentAccepted: false,
    recognizedGameMutation: false,
    eventId: result.eventId,
    eventHash: result.eventHash,
    aggregateVersion: result.aggregateVersion.toString(),
    duplicate: result.duplicate,
  };
}

export function installFilmPracticeRehearsalRoutes(
  app: FastifyInstance,
  options: FilmPracticeRehearsalOptions,
): void {
  const routeOptions: FilmPracticeRehearsalOptions = {
    ...options,
    finalizerDids: new Set(options.finalizerDids),
  };
  app.post("/v1/film/admit", async (request, reply) => {
    try {
      const handled = await handleFilmCommand(
        request.body,
        FILM_ADMITTED_EVENT_TYPE,
        routeOptions,
      );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        ...canonicalResponse(handled.result),
        recognizedGenesisFilm: false,
        film: FilmAdmittedPayloadSchema.parse(handled.payload).film,
      });
    } catch (error) {
      const response = filmPracticeError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/film/inspect", async (request, reply) => {
    try {
      const handled = await handleFilmCommand(
        request.body,
        FILM_INSPECTED_EVENT_TYPE,
        routeOptions,
      );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        ...canonicalResponse(handled.result),
        recognizedGenesisFilm: false,
        films: sortedValues(handled.aggregate.films),
        ciphertextReturned: false,
      });
    } catch (error) {
      const response = filmPracticeError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/practice/run", async (request, reply) => {
    try {
      const handled = await handlePracticeCommand(
        request.body,
        PRACTICE_RUN_EVENT_TYPE,
        routeOptions,
      );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        ...canonicalResponse(handled.result),
        recognizedGenesisPractice: false,
        run: PracticeRunPayloadSchema.parse(handled.payload).run,
      });
    } catch (error) {
      const response = filmPracticeError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/practice/lessons/persist", async (request, reply) => {
    try {
      const handled = await handlePracticeCommand(
        request.body,
        PRACTICE_LESSON_EVENT_TYPE,
        routeOptions,
      );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        ...canonicalResponse(handled.result),
        recognizedGenesisPractice: false,
        lesson: PracticeLessonPayloadSchema.parse(handled.payload).lesson,
      });
    } catch (error) {
      const response = filmPracticeError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });

  app.post("/v1/practice/inspect", async (request, reply) => {
    try {
      const handled = await handlePracticeCommand(
        request.body,
        PRACTICE_INSPECTED_EVENT_TYPE,
        routeOptions,
      );
      return reply.code(handled.result.duplicate ? 200 : 201).send({
        ...canonicalResponse(handled.result),
        recognizedGenesisPractice: false,
        runs: sortedValues(handled.aggregate.runs),
        lessons: sortedValues(handled.aggregate.lessons),
        privateContentReturned: false,
      });
    } catch (error) {
      const response = filmPracticeError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });
}
