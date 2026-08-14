import {
  ELECTION_WORKFLOW_AGGREGATE_TYPE,
  ELECTION_WORKFLOW_SCHEMA_DIGEST,
  ElectionWorkflowAuthorizationError,
  ElectionWorkflowValidationError,
  GovernanceEligibilitySnapshotSchema,
  PremierElectionOpenPayloadSchema,
  applyElectionWorkflowTransition,
  electionWorkflowStateRoot,
  evaluatePremierElection,
  isElectionWorkflowEventType,
  parseElectionWorkflowPayload,
  type ElectionWorkflowEventType,
  type ElectionWorkflowPayload,
  type ElectionWorkflowSnapshot,
  type EligibilitySnapshot,
  type PremierElectionResult,
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

export interface ElectionRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  eligibilitySnapshot: EligibilitySnapshot;
  now?: () => number;
}

interface ElectionAggregate {
  records: StoredCanonicalEvent[];
  snapshot: ElectionWorkflowSnapshot | null;
}

function candidateOptions(
  options: ElectionRehearsalOptions,
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
  options: ElectionRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<void> {
  const authority = await readCandidateCareerAuthority(
    candidateOptions(options),
    event.actorDid,
    at,
  );
  let signer: `0x${string}`;
  try {
    signer = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new ElectionWorkflowAuthorizationError(
      "Election event signature is invalid",
    );
  }
  if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new ElectionWorkflowAuthorizationError(
      "Election signer is not the career key",
    );
}

async function validateConfiguredSnapshotMembers(
  options: ElectionRehearsalOptions,
  snapshot: EligibilitySnapshot,
): Promise<void> {
  if (
    sha256Commitment(snapshot) !== sha256Commitment(options.eligibilitySnapshot)
  ) {
    throw new ElectionWorkflowAuthorizationError(
      "Election does not use the configured rehearsal eligibility snapshot",
    );
  }
  const members = new Set(Object.values(snapshot.members).flat());
  try {
    const authorities = await Promise.all(
      [...members].map((did) =>
        readCandidateCareerAuthority(
          candidateOptions(options),
          did,
          snapshot.capturedAt,
        ),
      ),
    );
    const addresses = authorities.map(({ signingAddress }) =>
      signingAddress.toLowerCase(),
    );
    if (new Set(addresses).size !== addresses.length)
      throw new Error("Election roll aliases a career key");
  } catch {
    throw new ElectionWorkflowAuthorizationError(
      "Election roll contains a career not admitted when captured",
    );
  }
}

async function replayElectionAggregate(
  options: ElectionRehearsalOptions,
  electionId: string,
): Promise<ElectionAggregate> {
  const records = await options.store.readAggregate(
    ELECTION_WORKFLOW_AGGREGATE_TYPE,
    electionId,
  );
  let snapshot: ElectionWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== ELECTION_WORKFLOW_AGGREGATE_TYPE ||
      event.aggregateId !== electionId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isElectionWorkflowEventType(event.eventType) ||
      event.schemaDigest !== ELECTION_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      !Number.isFinite(occurredAt) ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new ElectionWorkflowAuthorizationError(
        "Stored election aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new ElectionWorkflowAuthorizationError(
        "Stored election event content is invalid",
      );
    }
    let payload: ElectionWorkflowPayload;
    try {
      payload = parseElectionWorkflowPayload(event.eventType, event.payload);
    } catch {
      throw new ElectionWorkflowAuthorizationError(
        "Stored election event payload is malformed",
      );
    }
    await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    if (event.eventType === "PremierElectionOpened") {
      const opened =
        PremierElectionOpenPayloadSchema.parse(payload).eligibilitySnapshot;
      await validateConfiguredSnapshotMembers(options, opened);
    }
    let result: PremierElectionResult | null = null;
    if (event.eventType === "PremierElectionClosed") {
      if (snapshot === null)
        throw new ElectionWorkflowAuthorizationError(
          "Stored election close precedes its opening",
        );
      result = evaluatePremierElection(snapshot);
    }
    try {
      snapshot = applyElectionWorkflowTransition(
        snapshot,
        event,
        payload,
        result,
      );
    } catch (error) {
      throw new ElectionWorkflowAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored election transition is malformed",
      );
    }
    if (electionWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new ElectionWorkflowAuthorizationError(
        "Stored election state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ElectionWorkflowValidationError(
      "Election timestamp is not canonical",
    );
  return parsed;
}

function appendInput(
  options: ElectionRehearsalOptions,
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
    outboxTopic: "public.governance",
  };
}

function electionError(error: unknown): { status: number; code: string } {
  if (
    error instanceof ElectionWorkflowAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "election_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof ElectionWorkflowValidationError
  )
    return { status: 400, code: "invalid_election_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "election_aggregate_conflict" };
  }
  return { status: 500, code: "election_failure" };
}

export function installElectionRehearsalRoutes(
  app: FastifyInstance,
  options: ElectionRehearsalOptions,
): void {
  GovernanceEligibilitySnapshotSchema.parse(options.eligibilitySnapshot);
  const now = options.now ?? Date.now;
  const routes = [
    ["/v1/elections/premier/open", "PremierElectionOpened"],
    [
      "/v1/elections/premier/candidates/declare",
      "PremierElectionCandidateDeclared",
    ],
    ["/v1/elections/premier/ballots/cast", "PremierElectionBallotCast"],
    ["/v1/elections/premier/close", "PremierElectionClosed"],
    ["/v1/elections/premier/inspect", "PremierElectionInspected"],
  ] as const satisfies ReadonlyArray<
    readonly [string, ElectionWorkflowEventType]
  >;

  for (const [path, eventType] of routes) {
    app.post(path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new ElectionWorkflowValidationError(
            "Election event content is invalid",
          );
        }
        if (
          event.aggregateType !== ELECTION_WORKFLOW_AGGREGATE_TYPE ||
          event.aggregateId === "" ||
          event.eventType !== eventType ||
          event.schemaDigest !== ELECTION_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new ElectionWorkflowAuthorizationError(
            "Election event is outside route authority",
          );
        }
        const payload = parseElectionWorkflowPayload(eventType, event.payload);
        const aggregate = await replayElectionAggregate(
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
        if (eventType !== "PremierElectionInspected")
          await requireCareerOperational(options, event.actorDid, currentAt);
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        let responseSnapshot = aggregate.snapshot;
        if (existing !== undefined) {
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Election aggregate version already has different content",
            );
          }
          if (
            eventType === "PremierElectionInspected" &&
            existing !== aggregate.records.at(-1)
          ) {
            throw new CanonicalConflictError(
              "Historical election inspection cannot return newer state",
            );
          }
        } else {
          const occurredAt = canonicalInstant(event.timestamp);
          if (
            occurredAt <
              (aggregate.records.at(-1)?.occurredAt.getTime() ??
                Number.NEGATIVE_INFINITY) ||
            occurredAt > currentTime + 60_000
          ) {
            throw new ElectionWorkflowValidationError(
              "Election event timestamp is outside the accepted window",
            );
          }
          if (
            event.previousEventHash !==
            (aggregate.records.at(-1)?.eventHash ?? null)
          ) {
            throw new HashChainConflictError(
              "Election previous event hash is invalid",
            );
          }
          if (eventType === "PremierElectionOpened") {
            const opened =
              PremierElectionOpenPayloadSchema.parse(
                payload,
              ).eligibilitySnapshot;
            await validateConfiguredSnapshotMembers(options, opened);
          }
          const result =
            eventType === "PremierElectionClosed"
              ? aggregate.snapshot === null
                ? null
                : evaluatePremierElection(aggregate.snapshot)
              : null;
          responseSnapshot = applyElectionWorkflowTransition(
            aggregate.snapshot,
            event,
            payload,
            result,
          );
          if (electionWorkflowStateRoot(responseSnapshot) !== event.stateRoot)
            throw new ElectionWorkflowValidationError(
              "Election state root is invalid",
            );
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisElection: false,
          electionMethod: "COMPLETE_RANKED_BORDA_LEXICAL_TIE_BREAK",
          directBallotsOnly: true,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        if (eventType === "PremierElectionClosed") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            result: responseSnapshot?.result ?? null,
          });
        }
        if (eventType === "PremierElectionInspected") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            election: responseSnapshot,
          });
        }
        return reply.code(result.duplicate ? 200 : 201).send(response);
      } catch (error) {
        const response = electionError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.post("/v1/elections/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
