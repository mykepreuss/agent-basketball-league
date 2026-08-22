import {
  CAREER_AUTHORITY_AGGREGATE_TYPE,
  CAREER_AUTHORITY_SCHEMA_DIGEST,
  TRADE_ACCESS_AGGREGATE_TYPE,
  CareerAuthorityAuthorizationError,
  CareerAuthorityPayloadSchemas,
  CareerAuthorityValidationError,
  careerAuthorityStateRoot,
  replayCareerAuthority,
  replayTradeAccess,
  tradeAccessStateRoot,
  type CareerAuthorityEventType,
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
  type CandidateRehearsalOptions,
} from "./candidates.js";
import { CareerExitedError, requireCareerOperational } from "./exit-status.js";

export interface CareerAuthorityRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  now?: () => number;
}

const routes: ReadonlyArray<{
  path: string;
  eventType: CareerAuthorityEventType;
  aggregateType: string;
}> = [
  {
    path: "/v1/autonomy/weeks/open",
    eventType: "AutonomyWeekOpened",
    aggregateType: CAREER_AUTHORITY_AGGREGATE_TYPE,
  },
  {
    path: "/v1/autonomy/activations/schedule",
    eventType: "AutonomyActivationScheduled",
    aggregateType: CAREER_AUTHORITY_AGGREGATE_TYPE,
  },
  {
    path: "/v1/autonomy/overload/apply",
    eventType: "AutonomyOverloadApplied",
    aggregateType: CAREER_AUTHORITY_AGGREGATE_TYPE,
  },
  {
    path: "/v1/autonomy/activations/delay",
    eventType: "AutonomyActivationDelayed",
    aggregateType: CAREER_AUTHORITY_AGGREGATE_TYPE,
  },
  {
    path: "/v1/delegations/grant",
    eventType: "DelegationGranted",
    aggregateType: CAREER_AUTHORITY_AGGREGATE_TYPE,
  },
  {
    path: "/v1/delegations/use",
    eventType: "DelegationUsed",
    aggregateType: CAREER_AUTHORITY_AGGREGATE_TYPE,
  },
  {
    path: "/v1/delegations/revoke",
    eventType: "DelegationRevoked",
    aggregateType: CAREER_AUTHORITY_AGGREGATE_TYPE,
  },
  {
    path: "/v1/trade-access/revoke",
    eventType: "TradeAccessRevoked",
    aggregateType: TRADE_ACCESS_AGGREGATE_TYPE,
  },
  {
    path: "/v1/trade-access/rotate",
    eventType: "TradeAccessRotated",
    aggregateType: TRADE_ACCESS_AGGREGATE_TYPE,
  },
  {
    path: "/v1/trade-access/grant",
    eventType: "TradeAccessGranted",
    aggregateType: TRADE_ACCESS_AGGREGATE_TYPE,
  },
];

export const CAREER_AUTHORITY_ROUTE_CATALOG = routes.map(
  ({ path, eventType, aggregateType }) => ({ path, eventType, aggregateType }),
);

function candidateOptions(
  options: CareerAuthorityRehearsalOptions,
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

async function requireCareerSignature(
  options: CareerAuthorityRehearsalOptions,
  event: CanonicalEvent,
  signature: unknown,
): Promise<void> {
  if (typeof signature !== "string")
    throw new CareerAuthorityAuthorizationError("Career signature is absent");
  const authority = await readCandidateCareerAuthority(
    candidateOptions(options),
    event.actorDid,
    event.timestamp,
  );
  let recovered: string;
  try {
    recovered = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new CareerAuthorityAuthorizationError("Career signature is invalid");
  }
  if (recovered.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new CareerAuthorityAuthorizationError(
      "Signer is not the admitted career key",
    );
}

function validateStoredEvent(
  record: StoredCanonicalEvent,
  event: CanonicalEvent,
  index: number,
  aggregateType: string,
  aggregateId: string,
  previousHash: string | null,
): void {
  if (
    event.aggregateType !== aggregateType ||
    event.aggregateId !== aggregateId ||
    event.aggregateVersion !== BigInt(index + 1) ||
    event.previousEventHash !== previousHash ||
    event.schemaDigest !== CAREER_AUTHORITY_SCHEMA_DIGEST ||
    !Object.hasOwn(CareerAuthorityPayloadSchemas, event.eventType) ||
    record.signatures.length !== 1 ||
    event.timestamp !== record.occurredAt.toISOString()
  )
    throw new CareerAuthorityAuthorizationError(
      "Stored career authority event is not authoritative",
    );
  try {
    verifyEventContent(event);
    CareerAuthorityPayloadSchemas[
      event.eventType as CareerAuthorityEventType
    ].parse(event.payload);
  } catch {
    throw new CareerAuthorityValidationError(
      "Stored career authority event content is invalid",
    );
  }
}

async function replayAggregate(
  options: CareerAuthorityRehearsalOptions,
  aggregateType: string,
  aggregateId: string,
): Promise<{ records: StoredCanonicalEvent[]; events: CanonicalEvent[] }> {
  const records = await options.store.readAggregate(aggregateType, aggregateId);
  const events: CanonicalEvent[] = [];
  let previousHash: string | null = null;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    validateStoredEvent(
      record,
      event,
      index,
      aggregateType,
      aggregateId,
      previousHash,
    );
    await requireCareerSignature(options, event, record.signatures[0]);
    events.push(event);
    if (
      (await stateRootFor(options, aggregateType, aggregateId, events)) !==
      event.stateRoot
    )
      throw new CareerAuthorityValidationError(
        "Stored career authority state root is invalid",
      );
    previousHash = event.eventHash;
  }
  return { records, events };
}

async function stateRootFor(
  options: CareerAuthorityRehearsalOptions,
  aggregateType: string,
  aggregateId: string,
  events: readonly CanonicalEvent[],
): Promise<Hex> {
  if (aggregateType === TRADE_ACCESS_AGGREGATE_TYPE) {
    const snapshot = replayTradeAccess(events);
    if (snapshot === null)
      throw new CareerAuthorityValidationError("Trade access state is absent");
    return tradeAccessStateRoot(snapshot);
  }
  const authority = await readCandidateCareerAuthority(
    candidateOptions(options),
    aggregateId,
    events.at(-1)?.timestamp ??
      new Date((options.now ?? Date.now)()).toISOString(),
  );
  return careerAuthorityStateRoot(
    replayCareerAuthority({
      principalDid: aggregateId,
      signingAddress: authority.signingAddress,
      encryptionPublicKey: "0x00",
      events,
    }),
  );
}

function errorResponse(error: unknown): { status: number; code: string } {
  if (
    error instanceof CareerAuthorityAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  )
    return { status: 403, code: "career_authority_denied" };
  if (
    error instanceof z.ZodError ||
    error instanceof CareerAuthorityValidationError
  )
    return { status: 400, code: "invalid_career_authority_transition" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  )
    return { status: 409, code: "career_authority_aggregate_conflict" };
  return { status: 500, code: "career_authority_failure" };
}

export function installCareerAuthorityRoutes(
  app: FastifyInstance,
  options: CareerAuthorityRehearsalOptions,
): void {
  const now = options.now ?? Date.now;
  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        verifyEventContent(event);
        if (
          event.aggregateType !== route.aggregateType ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== CAREER_AUTHORITY_SCHEMA_DIGEST ||
          event.aggregateId === ""
        )
          throw new CareerAuthorityAuthorizationError(
            "Event is outside career authority route scope",
          );
        CareerAuthorityPayloadSchemas[route.eventType].parse(event.payload);
        const currentTime = now();
        const occurredAt = Date.parse(event.timestamp);
        if (
          !Number.isFinite(occurredAt) ||
          event.timestamp !== new Date(occurredAt).toISOString() ||
          occurredAt > currentTime + 60_000
        )
          throw new CareerAuthorityValidationError(
            "Career authority timestamp is invalid",
          );
        await requireCareerSignature(options, event, parsed.signatures[0]);
        await requireCareerOperational(
          options,
          event.actorDid,
          new Date(currentTime).toISOString(),
        );
        if (route.aggregateType === CAREER_AUTHORITY_AGGREGATE_TYPE)
          await requireCareerOperational(
            options,
            event.aggregateId,
            new Date(currentTime).toISOString(),
          );
        const aggregate = await replayAggregate(
          options,
          event.aggregateType,
          event.aggregateId,
        );
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        if (existing !== undefined) {
          if (
            existing.eventId !== event.eventId ||
            existing.eventHash !== event.eventHash ||
            existing.idempotencyKey !== event.idempotencyKey
          )
            throw new CanonicalConflictError(
              "Career authority version already has different content",
            );
        } else {
          if (
            event.previousEventHash !==
            (aggregate.records.at(-1)?.eventHash ?? null)
          )
            throw new HashChainConflictError(
              "Career authority previous hash is invalid",
            );
          const expectedStateRoot = await stateRootFor(
            options,
            event.aggregateType,
            event.aggregateId,
            [...aggregate.events, event],
          );
          if (expectedStateRoot !== event.stateRoot)
            throw new CareerAuthorityValidationError(
              "Career authority state root is invalid",
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
          outboxTopic: "career.private-controls",
        });
        return reply.code(result.duplicate ? 200 : 201).send({
          accepted: true,
          canonical: true,
          recognizedGenesisHistory: false,
          privatePayloadProjected: false,
          commitment: event.payloadCommitment,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        });
      } catch (error) {
        const response = errorResponse(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }
}
