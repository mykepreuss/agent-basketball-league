import {
  DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
  DEVELOPMENT_WORKFLOW_EVENT_TYPES,
  DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST,
  DevelopmentCharterPayloadSchema,
  DevelopmentWorkflowAuthorizationError,
  DevelopmentWorkflowValidationError,
  applyDevelopmentWorkflowTransition,
  developmentWorkflowAuthorizedDids,
  developmentWorkflowStateRoot,
  expectedDevelopmentSignerDids,
  parseDevelopmentWorkflowPayload,
  requireDevelopmentWorkflowRatifications,
  type DevelopmentWorkflowEventType,
  type DevelopmentWorkflowPayload,
  type DevelopmentWorkflowSignerAuthority,
  type DevelopmentWorkflowSnapshot,
  type ResourceScheduleRatificationReader,
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
  SignedCanonicalAssemblyCommandSchema,
  canonicalEventFromStored,
  materializeCanonicalEvent,
} from "./canonical-command.js";

export interface DevelopmentAdmittedAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

export interface DevelopmentRehearsalOptions
  extends DevelopmentWorkflowSignerAuthority {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<string, DevelopmentAdmittedAuthority>;
  competitionId: string;
  seasonId: string;
  conferenceId: string;
  tierCbaRatification: ResourceScheduleRatificationReader;
  now?: () => number;
}

interface DevelopmentAggregate {
  records: StoredCanonicalEvent[];
  snapshot: DevelopmentWorkflowSnapshot | null;
}

function isEventType(value: string): value is DevelopmentWorkflowEventType {
  return DEVELOPMENT_WORKFLOW_EVENT_TYPES.includes(
    value as DevelopmentWorkflowEventType,
  );
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new DevelopmentWorkflowValidationError(
      "Development timestamp is not canonical",
    );
  return parsed;
}

async function verifySignatures(
  options: DevelopmentRehearsalOptions,
  event: CanonicalEvent,
  eventType: DevelopmentWorkflowEventType,
  payload: DevelopmentWorkflowPayload,
  signatures: readonly string[],
): Promise<void> {
  const signerDids = expectedDevelopmentSignerDids(eventType, payload, {
    charterAuthorityDid: options.charterAuthorityDid,
    premierClubGovernors: options.premierClubGovernors,
  });
  if (
    signerDids.some((did) => typeof did !== "string" || did === "") ||
    new Set(signerDids).size !== signerDids.length ||
    signatures.length !== signerDids.length ||
    event.actorDid !== signerDids[0] ||
    sha256Commitment(developmentWorkflowAuthorizedDids(payload)) !==
      sha256Commitment(signerDids)
  ) {
    throw new DevelopmentWorkflowAuthorizationError(
      "Development command lacks its exact ordered independent careers",
    );
  }
  const authorities = signerDids.map((did) => {
    const authority = options.admittedAgents.get(did);
    if (
      authority === undefined ||
      !authority.allowedAggregateTypes.includes(
        DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
      )
    ) {
      throw new DevelopmentWorkflowAuthorizationError(
        "Development signer lacks admitted aggregate authority",
      );
    }
    return authority;
  });
  const addresses = authorities.map(({ signerAddress }) =>
    signerAddress.toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length)
    throw new DevelopmentWorkflowAuthorizationError(
      "Development signers alias a career key",
    );
  await Promise.all(
    authorities.map(async ({ signerAddress }, index) => {
      try {
        const recovered = await recoverCanonicalEventSigner(
          options.domain,
          event,
          signatures[index] as Hex,
        );
        if (recovered.toLowerCase() !== signerAddress.toLowerCase())
          throw new Error("wrong signer");
      } catch {
        throw new DevelopmentWorkflowAuthorizationError(
          "Development signature does not match its ordered career",
        );
      }
    }),
  );
}

async function verifyExternalAuthority(
  options: DevelopmentRehearsalOptions,
  eventType: DevelopmentWorkflowEventType,
  payload: DevelopmentWorkflowPayload,
): Promise<void> {
  if (eventType === "DevelopmentConferenceChartered") {
    const { command } = DevelopmentCharterPayloadSchema.parse(payload);
    if (
      command.conferenceId !== options.conferenceId ||
      command.competitionId !== options.competitionId ||
      command.seasonId !== options.seasonId
    ) {
      throw new DevelopmentWorkflowAuthorizationError(
        "Development charter is outside the configured conference",
      );
    }
  }
  await requireDevelopmentWorkflowRatifications(
    eventType,
    payload,
    options.tierCbaRatification,
  );
}

async function replayDevelopmentAggregate(
  options: DevelopmentRehearsalOptions,
): Promise<DevelopmentAggregate> {
  const records = await options.store.readAggregate(
    DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
    options.conferenceId,
  );
  let snapshot: DevelopmentWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE ||
      event.aggregateId !== options.conferenceId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isEventType(event.eventType) ||
      event.schemaDigest !== DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      !Number.isFinite(occurredAt) ||
      occurredAt < previousTimestamp
    ) {
      throw new DevelopmentWorkflowAuthorizationError(
        "Stored development aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new DevelopmentWorkflowAuthorizationError(
        "Stored development event content is invalid",
      );
    }
    let payload: DevelopmentWorkflowPayload;
    try {
      payload = parseDevelopmentWorkflowPayload(event.eventType, event.payload);
    } catch {
      throw new DevelopmentWorkflowAuthorizationError(
        "Stored development payload is malformed",
      );
    }
    await verifySignatures(
      options,
      event,
      event.eventType,
      payload,
      record.signatures as string[],
    );
    await verifyExternalAuthority(options, event.eventType, payload);
    snapshot = applyDevelopmentWorkflowTransition(snapshot, event, payload);
    if (developmentWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new DevelopmentWorkflowAuthorizationError(
        "Stored development state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

function appendInput(
  options: DevelopmentRehearsalOptions,
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
    outboxTopic: "public.development",
  };
}

function developmentError(error: unknown): { status: number; code: string } {
  if (error instanceof DevelopmentWorkflowAuthorizationError)
    return { status: 403, code: "development_authorization_denied" };
  if (
    error instanceof z.ZodError ||
    error instanceof DevelopmentWorkflowValidationError
  ) {
    return { status: 400, code: "invalid_development_request" };
  }
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "development_aggregate_conflict" };
  }
  return { status: 500, code: "development_failure" };
}

export function installDevelopmentRehearsalRoutes(
  app: FastifyInstance,
  options: DevelopmentRehearsalOptions,
): void {
  if (
    options.conferenceId === "" ||
    options.charterAuthorityDid === "" ||
    Object.keys(options.premierClubGovernors).length === 0 ||
    new Set(Object.values(options.premierClubGovernors)).size !==
      Object.keys(options.premierClubGovernors).length
  ) {
    throw new DevelopmentWorkflowValidationError(
      "Development configuration lacks independent charter and premier club authority",
    );
  }
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: DevelopmentWorkflowEventType;
  }> = [
    {
      path: "/v1/development/charter",
      eventType: "DevelopmentConferenceChartered",
    },
    {
      path: "/v1/development/premier-eligibility",
      eventType: "DevelopmentPremierEligibilityRecorded",
    },
    {
      path: "/v1/development/call-ups",
      eventType: "DevelopmentCallUpAuthorized",
    },
    {
      path: "/v1/development/replacements",
      eventType: "DevelopmentReplacementAuthorized",
    },
    {
      path: "/v1/development/free-agency",
      eventType: "DevelopmentFreeAgencyAuthorized",
    },
    {
      path: "/v1/development/trades",
      eventType: "DevelopmentCrossTierTradeAuthorized",
    },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalAssemblyCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new DevelopmentWorkflowValidationError(
            "Development event content is invalid",
          );
        }
        if (
          event.aggregateType !== DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE ||
          event.aggregateId !== options.conferenceId ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new DevelopmentWorkflowAuthorizationError(
            "Development event is outside route authority",
          );
        }
        const payload = parseDevelopmentWorkflowPayload(
          route.eventType,
          event.payload,
        );
        const aggregate = await replayDevelopmentAggregate(options);
        const existing = aggregate.records.find(
          ({ aggregateVersion }) => aggregateVersion === event.aggregateVersion,
        );
        await verifySignatures(
          options,
          event,
          route.eventType,
          payload,
          parsed.signatures,
        );
        await verifyExternalAuthority(options, route.eventType, payload);
        let responseSnapshot = aggregate.snapshot;
        if (existing !== undefined) {
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Development aggregate version already has different content",
            );
          }
        } else {
          const occurredAt = canonicalInstant(event.timestamp);
          const latestOccurredAt =
            aggregate.records.at(-1)?.occurredAt.getTime() ??
            Number.NEGATIVE_INFINITY;
          if (occurredAt < latestOccurredAt || occurredAt > now() + 60_000)
            throw new DevelopmentWorkflowValidationError(
              "Development event timestamp is outside the accepted window",
            );
          if (
            event.previousEventHash !==
            (aggregate.records.at(-1)?.eventHash ?? null)
          ) {
            throw new HashChainConflictError(
              "Development previous event hash is invalid",
            );
          }
          responseSnapshot = applyDevelopmentWorkflowTransition(
            aggregate.snapshot,
            event,
            payload,
          );
          if (
            developmentWorkflowStateRoot(responseSnapshot) !== event.stateRoot
          ) {
            throw new DevelopmentWorkflowValidationError(
              "Development state root is invalid",
            );
          }
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        return reply.code(result.duplicate ? 200 : 201).send({
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisConference: false,
          livePlatformEvidenceVerified: false,
          playingRightsMutation: false,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          decisionCount: responseSnapshot?.mobilityDecisions.length ?? 0,
          duplicate: result.duplicate,
        });
      } catch (error) {
        const response = developmentError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }
}
