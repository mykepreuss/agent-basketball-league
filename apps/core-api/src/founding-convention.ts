import {
  FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
  FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST,
  FoundingBootstrapBallotPayloadSchema,
  FoundingBootstrapOpenPayloadSchema,
  FoundingBootstrapWorkflowAuthorizationError,
  FoundingBootstrapWorkflowValidationError,
  applyFoundingBootstrapWorkflowTransition,
  evaluateFoundingBootstrap,
  foundingBootstrapBallotFromAuthorization,
  foundingBootstrapWorkflowStateRoot,
  isFoundingBootstrapEventType,
  parseFoundingBootstrapWorkflowPayload,
  type FoundingBootstrapEventType,
  type FoundingBootstrapWorkflowPayload,
  type FoundingBootstrapWorkflowSnapshot,
  type SignedFoundingBootstrapBallot,
} from "@abl/genesis";
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
import { CareerExitedError, requireCareerOperational } from "./exit-status.js";

export interface FoundingConventionOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<
    string,
    {
      signerAddress: `0x${string}`;
      allowedAggregateTypes: readonly string[];
    }
  >;
  competitionId: string;
  seasonId: string;
  proposalId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  now?: () => number;
}

interface FoundingAggregate {
  records: StoredCanonicalEvent[];
  snapshot: FoundingBootstrapWorkflowSnapshot | null;
  ballots: SignedFoundingBootstrapBallot[];
  ballotSigners: Map<string, `0x${string}`>;
}

function candidateOptions(
  options: FoundingConventionOptions,
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
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString()) {
    throw new FoundingBootstrapWorkflowValidationError(
      "Founding convention timestamp is not canonical",
    );
  }
  return parsed;
}

async function requireCareerSignature(
  options: FoundingConventionOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<CandidateCareerAuthority> {
  const configured = options.admittedAgents.get(event.actorDid);
  if (
    configured === undefined ||
    !configured.allowedAggregateTypes.includes(
      FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
    )
  ) {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding convention actor lacks configured authority",
    );
  }
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
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding convention signature is invalid",
    );
  }
  if (
    signer.toLowerCase() !== authority.signingAddress.toLowerCase() ||
    signer.toLowerCase() !== configured.signerAddress.toLowerCase()
  ) {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding convention signer is not the admitted career key",
    );
  }
  return authority;
}

async function validateFounderSnapshot(
  options: FoundingConventionOptions,
  payload: z.infer<typeof FoundingBootstrapOpenPayloadSchema>,
): Promise<void> {
  if (
    canonicalInstant(payload.snapshot.capturedAt) >
    canonicalInstant(payload.proposal.openedAt)
  ) {
    throw new FoundingBootstrapWorkflowValidationError(
      "Founding eligibility cannot be captured after the proposal opens",
    );
  }
  const configuredFounderDids = [...options.admittedAgents.entries()]
    .filter(([, authority]) =>
      authority.allowedAggregateTypes.includes(
        FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
      ),
    )
    .map(([did]) => did)
    .sort();
  if (
    configuredFounderDids.length !==
      payload.snapshot.eligibleFounderDids.length ||
    configuredFounderDids.some(
      (did, index) => did !== payload.snapshot.eligibleFounderDids[index],
    )
  ) {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding eligibility does not include the complete configured cohort",
    );
  }
  const addresses = await Promise.all(
    payload.snapshot.eligibleFounderDids.map(async (did) => {
      const configured = options.admittedAgents.get(did);
      if (
        configured === undefined ||
        !configured.allowedAggregateTypes.includes(
          FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
        )
      ) {
        throw new Error("Founder lacks configured convention authority");
      }
      const admitted = await readCandidateCareerAuthority(
        candidateOptions(options),
        did,
        payload.snapshot.capturedAt,
      );
      await requireCareerOperational(options, did, payload.snapshot.capturedAt);
      if (
        admitted.signingAddress.toLowerCase() !==
        configured.signerAddress.toLowerCase()
      ) {
        throw new Error("Founder key does not match the admission record");
      }
      return admitted.signingAddress.toLowerCase();
    }),
  ).catch(() => {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding eligibility contains a career not active when captured",
    );
  });
  if (new Set(addresses).size !== addresses.length) {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founding eligibility aliases a career signing key",
    );
  }
}

function registerBallotSigner(
  signers: Map<string, `0x${string}`>,
  voterDid: string,
  signerAddress: `0x${string}`,
): void {
  const prior = signers.get(voterDid);
  if (
    prior !== undefined &&
    prior.toLowerCase() !== signerAddress.toLowerCase()
  ) {
    throw new FoundingBootstrapWorkflowAuthorizationError(
      "Founder key changed inside the frozen bootstrap",
    );
  }
  signers.set(voterDid, signerAddress);
}

async function advanceFoundingAggregate(
  options: FoundingConventionOptions,
  aggregate: Omit<FoundingAggregate, "records">,
  event: CanonicalEvent,
  payload: FoundingBootstrapWorkflowPayload,
  signature: string,
  signerAddress: `0x${string}`,
): Promise<FoundingBootstrapWorkflowSnapshot> {
  let result = null;
  if (event.eventType === "FoundingBootstrapOpened") {
    await validateFounderSnapshot(
      options,
      FoundingBootstrapOpenPayloadSchema.parse(payload),
    );
  } else if (event.eventType === "FoundingBootstrapBallotCast") {
    const ballot = FoundingBootstrapBallotPayloadSchema.parse(payload).command;
    registerBallotSigner(
      aggregate.ballotSigners,
      ballot.voterDid,
      signerAddress,
    );
    aggregate.ballots.push(
      foundingBootstrapBallotFromAuthorization(
        ballot,
        event,
        signature,
        signerAddress,
      ),
    );
  } else if (event.eventType === "FoundingBootstrapClosed") {
    if (aggregate.snapshot === null) {
      throw new FoundingBootstrapWorkflowValidationError(
        "Founding bootstrap close precedes its opening",
      );
    }
    result = await evaluateFoundingBootstrap({
      snapshot: aggregate.snapshot.snapshot,
      proposal: aggregate.snapshot.proposal,
      ballots: aggregate.ballots,
      authorization: {
        domain: options.domain,
        signers: aggregate.ballotSigners,
      },
      evaluatedAt: event.timestamp,
    });
  }
  return applyFoundingBootstrapWorkflowTransition(
    aggregate.snapshot,
    event,
    payload,
    result,
  );
}

async function replayFoundingAggregate(
  options: FoundingConventionOptions,
): Promise<FoundingAggregate> {
  const records = await options.store.readAggregate(
    FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
    options.proposalId,
  );
  const aggregate: FoundingAggregate = {
    records,
    snapshot: null,
    ballots: [],
    ballotSigners: new Map(),
  };
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== FOUNDING_BOOTSTRAP_AGGREGATE_TYPE ||
      event.aggregateId !== options.proposalId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isFoundingBootstrapEventType(event.eventType) ||
      event.schemaDigest !== FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new FoundingBootstrapWorkflowAuthorizationError(
        "Stored founding convention aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new FoundingBootstrapWorkflowAuthorizationError(
        "Stored founding convention event content is invalid",
      );
    }
    const payload = parseFoundingBootstrapWorkflowPayload(
      event.eventType,
      event.payload,
    );
    const authority = await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    aggregate.snapshot = await advanceFoundingAggregate(
      options,
      aggregate,
      event,
      payload,
      record.signatures[0],
      authority.signingAddress,
    );
    if (
      foundingBootstrapWorkflowStateRoot(aggregate.snapshot) !== event.stateRoot
    )
      throw new FoundingBootstrapWorkflowAuthorizationError(
        "Stored founding convention state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return aggregate;
}

function appendInput(
  options: FoundingConventionOptions,
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

function foundingError(error: unknown): { status: number; code: string } {
  if (
    error instanceof FoundingBootstrapWorkflowAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "founding_convention_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof FoundingBootstrapWorkflowValidationError
  ) {
    return { status: 400, code: "invalid_founding_convention_request" };
  }
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "founding_convention_aggregate_conflict" };
  }
  return { status: 500, code: "founding_convention_failure" };
}

export function installFoundingConventionRoutes(
  app: FastifyInstance,
  options: FoundingConventionOptions,
): void {
  const now = options.now ?? Date.now;
  const routes = [
    ["/v1/founding-convention/bootstrap/open", "FoundingBootstrapOpened"],
    ["/v1/founding-convention/bootstrap/vote", "FoundingBootstrapBallotCast"],
    ["/v1/founding-convention/bootstrap/close", "FoundingBootstrapClosed"],
  ] as const satisfies ReadonlyArray<
    readonly [string, FoundingBootstrapEventType]
  >;

  for (const [path, eventType] of routes) {
    app.post(path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new FoundingBootstrapWorkflowValidationError(
            "Founding convention event content is invalid",
          );
        }
        if (
          event.aggregateType !== FOUNDING_BOOTSTRAP_AGGREGATE_TYPE ||
          event.aggregateId !== options.proposalId ||
          event.eventType !== eventType ||
          event.schemaDigest !== FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new FoundingBootstrapWorkflowAuthorizationError(
            "Founding convention event is outside route authority",
          );
        }
        const payload = parseFoundingBootstrapWorkflowPayload(
          eventType,
          event.payload,
        );
        const aggregate = await replayFoundingAggregate(options);
        const currentTime = now();
        const currentAt = new Date(currentTime).toISOString();
        const authority = await requireCareerSignature(
          options,
          event,
          parsed.signatures[0]!,
          currentAt,
        );
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
              "Founding convention version already has different content",
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
            throw new FoundingBootstrapWorkflowValidationError(
              "Founding convention timestamp is outside the accepted window",
            );
          }
          if (
            event.previousEventHash !==
            (aggregate.records.at(-1)?.eventHash ?? null)
          ) {
            throw new HashChainConflictError(
              "Founding convention previous event hash is invalid",
            );
          }
          responseSnapshot = await advanceFoundingAggregate(
            options,
            aggregate,
            event,
            payload,
            parsed.signatures[0]!,
            authority.signingAddress,
          );
          if (
            foundingBootstrapWorkflowStateRoot(responseSnapshot) !==
            event.stateRoot
          ) {
            throw new FoundingBootstrapWorkflowValidationError(
              "Founding convention state root is invalid",
            );
          }
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        return reply.code(result.duplicate ? 200 : 201).send({
          accepted: true,
          duplicate: result.duplicate,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          state: "PRE_GENESIS_EXPERIMENT",
          canonical: false,
          recognitionLevel: "SIGNED_VALID",
          recognizedGenesisConvention: false,
          directBallotsOnly: true,
          humanVotingAllowed: false,
          foundingBootstrap: responseSnapshot,
        });
      } catch (error) {
        const response = foundingError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.post("/v1/founding-convention/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
