import {
  GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  GOVERNANCE_WORKFLOW_CHAMBERS,
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  GovernanceBallotPayloadSchema as BallotPayloadSchema,
  GovernanceEligibilitySnapshotSchema,
  GovernanceProposalRegistrationPayloadSchema as ProposalRegistrationCommandSchema,
  GovernanceWorkflowAuthorizationError as GovernanceAuthorizationError,
  GovernanceWorkflowValidationError as GovernanceValidationError,
  applyGovernanceWorkflowTransition,
  evaluateGovernanceWorkflowDecision,
  governanceVoteFromAuthorization,
  governanceWorkflowStateRoot,
  isGovernanceWorkflowEventType,
  parseGovernanceWorkflowPayload,
  validateGovernanceEligibilitySnapshot,
  type EligibilitySnapshot,
  type GovernanceDecision,
  type GovernanceVote,
  type GovernanceWorkflowEventType,
  type GovernanceWorkflowPayload,
  type GovernanceWorkflowSnapshot,
  type InstitutionalAuthorizationContext,
  type InstitutionalSigner,
  type ResourceScheduleRatification,
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
  type CandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import { CareerExitedError, requireCareerOperational } from "./exit-status.js";

const aggregateType = GOVERNANCE_WORKFLOW_AGGREGATE_TYPE;
const chambers = GOVERNANCE_WORKFLOW_CHAMBERS;
export {
  GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  GovernanceEligibilitySnapshotSchema,
  applyGovernanceWorkflowTransition,
  governanceWorkflowStateRoot,
};
export type {
  GovernanceWorkflowEventType,
  GovernanceWorkflowPayload,
  GovernanceWorkflowSnapshot,
};

export interface GovernanceRehearsalOptions {
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

interface GovernanceAggregate {
  records: StoredCanonicalEvent[];
  snapshot: GovernanceWorkflowSnapshot | null;
  votes: GovernanceVote[];
  authorization: MutableInstitutionalAuthorizationContext;
}

interface MutableInstitutionalAuthorizationContext
  extends Omit<InstitutionalAuthorizationContext, "signers"> {
  signers: Map<string, InstitutionalSigner>;
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new GovernanceValidationError(
      "Governance timestamp is not canonical",
    );
  return parsed;
}

function candidateOptions(
  options: GovernanceRehearsalOptions,
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
  options: GovernanceRehearsalOptions,
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
    throw new GovernanceAuthorizationError(
      "Governance event signature is invalid",
    );
  }
  if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new GovernanceAuthorizationError(
      "Governance signer is not the career key",
    );
  return authority;
}

function registerVoter(
  authorization: MutableInstitutionalAuthorizationContext,
  voterDid: string,
  signerAddress: `0x${string}`,
): void {
  const prior = authorization.signers.get(voterDid);
  if (
    prior !== undefined &&
    prior.signerAddress.toLowerCase() !== signerAddress.toLowerCase()
  ) {
    throw new GovernanceAuthorizationError(
      "Governance voter key changed inside a frozen proposal",
    );
  }
  authorization.signers.set(voterDid, {
    signerAddress,
    roles: ["VOTER"],
  });
}

async function validateConfiguredSnapshotMembers(
  options: GovernanceRehearsalOptions,
  snapshot: EligibilitySnapshot,
): Promise<void> {
  if (
    sha256Commitment(snapshot) !== sha256Commitment(options.eligibilitySnapshot)
  ) {
    throw new GovernanceAuthorizationError(
      "Proposal does not use the configured rehearsal eligibility snapshot",
    );
  }
  const members = new Set(
    chambers.flatMap((chamber) => snapshot.members[chamber]),
  );
  try {
    const authorities = await Promise.all(
      [...members].map((memberDid) =>
        readCandidateCareerAuthority(
          candidateOptions(options),
          memberDid,
          snapshot.capturedAt,
        ),
      ),
    );
    const signingAddresses = authorities.map(({ signingAddress }) =>
      signingAddress.toLowerCase(),
    );
    if (new Set(signingAddresses).size !== signingAddresses.length)
      throw new Error("Governance eligibility aliases a career key");
  } catch {
    throw new GovernanceAuthorizationError(
      "Eligibility snapshot contains a career not admitted when captured",
    );
  }
}

async function replayGovernanceAggregate(
  options: GovernanceRehearsalOptions,
  proposalId: string,
): Promise<GovernanceAggregate> {
  const records = await options.store.readAggregate(aggregateType, proposalId);
  let snapshot: GovernanceWorkflowSnapshot | null = null;
  const votes: GovernanceVote[] = [];
  const authorization: MutableInstitutionalAuthorizationContext = {
    domain: options.domain,
    signers: new Map(),
  };
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== aggregateType ||
      event.aggregateId !== proposalId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isGovernanceWorkflowEventType(event.eventType) ||
      event.schemaDigest !== GOVERNANCE_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new GovernanceAuthorizationError(
        "Stored governance aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new GovernanceAuthorizationError(
        "Stored governance event content is invalid",
      );
    }
    let payload: GovernanceWorkflowPayload;
    try {
      payload = parseGovernanceWorkflowPayload(event.eventType, event.payload);
    } catch {
      throw new GovernanceAuthorizationError(
        "Stored governance event payload is malformed",
      );
    }
    const authority = await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    let decision: GovernanceDecision | null = null;
    if (event.eventType === "GovernanceProposalRegistered") {
      const registration = ProposalRegistrationCommandSchema.parse(payload);
      await validateConfiguredSnapshotMembers(
        options,
        registration.eligibilitySnapshot,
      );
    } else if (event.eventType === "GovernanceBallotCast") {
      const ballot = BallotPayloadSchema.parse(payload).command;
      registerVoter(authorization, ballot.voterDid, authority.signingAddress);
      votes.push(
        governanceVoteFromAuthorization(
          ballot,
          event,
          record.signatures[0],
          authority.signingAddress,
        ),
      );
    } else if (event.eventType === "GovernanceProposalClosed") {
      if (snapshot === null)
        throw new GovernanceAuthorizationError(
          "Stored governance close precedes proposal",
        );
      try {
        decision = await evaluateGovernanceWorkflowDecision(
          snapshot,
          votes,
          authorization,
        );
      } catch (error) {
        throw new GovernanceAuthorizationError(
          error instanceof Error
            ? error.message
            : "Stored governance decision is invalid",
        );
      }
    }
    try {
      snapshot = applyGovernanceWorkflowTransition(
        snapshot,
        event,
        payload,
        decision,
      );
    } catch (error) {
      if (error instanceof GovernanceAuthorizationError) throw error;
      throw new GovernanceAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored governance transition is malformed",
      );
    }
    if (governanceWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new GovernanceAuthorizationError(
        "Stored governance state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot, votes, authorization };
}

export async function readResourceScheduleRatification(
  options: GovernanceRehearsalOptions,
  proposalId: string,
): Promise<ResourceScheduleRatification | null> {
  const aggregate = await replayGovernanceAggregate(options, proposalId);
  const snapshot = aggregate.snapshot;
  if (snapshot?.decision === null || snapshot?.decision === undefined)
    return null;
  const closeRecord = aggregate.records.find(
    (record) => record.eventType === "GovernanceProposalClosed",
  );
  if (closeRecord === undefined) return null;
  return {
    proposalId: snapshot.proposalId,
    proposalClass: snapshot.proposal.proposalClass,
    executableChangeDigest: snapshot.proposal.executableChangeDigest,
    passed: snapshot.decision.passed,
    closeEventId: closeRecord.eventId,
  };
}

function appendInput(
  options: GovernanceRehearsalOptions,
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

function governanceError(error: unknown): { status: number; code: string } {
  if (
    error instanceof GovernanceAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "governance_authorization_denied" };
  }
  if (error instanceof z.ZodError || error instanceof GovernanceValidationError)
    return { status: 400, code: "invalid_governance_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "governance_aggregate_conflict" };
  }
  return { status: 500, code: "governance_failure" };
}

export function installGovernanceRehearsalRoutes(
  app: FastifyInstance,
  options: GovernanceRehearsalOptions,
): void {
  const configuredSnapshot = GovernanceEligibilitySnapshotSchema.parse(
    options.eligibilitySnapshot,
  );
  validateGovernanceEligibilitySnapshot(configuredSnapshot);
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: GovernanceWorkflowEventType;
  }> = [
    {
      path: "/v1/governance/proposals/register",
      eventType: "GovernanceProposalRegistered",
    },
    {
      path: "/v1/governance/ballots/cast",
      eventType: "GovernanceBallotCast",
    },
    {
      path: "/v1/governance/proposals/close",
      eventType: "GovernanceProposalClosed",
    },
    {
      path: "/v1/governance/proposals/inspect",
      eventType: "GovernanceInspected",
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
          throw new GovernanceValidationError(
            "Governance event content is invalid",
          );
        }
        if (
          event.aggregateType !== aggregateType ||
          event.aggregateId === "" ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== GOVERNANCE_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new GovernanceAuthorizationError(
            "Governance event is outside route authority",
          );
        }
        const payload = parseGovernanceWorkflowPayload(
          route.eventType,
          event.payload,
        );
        const aggregate = await replayGovernanceAggregate(
          options,
          event.aggregateId,
        );
        const currentTime = now();
        const currentAt = new Date(currentTime).toISOString();
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        const authority = await requireCareerSignature(
          options,
          event,
          parsed.signatures[0]!,
          currentAt,
        );
        if (route.eventType !== "GovernanceInspected") {
          await requireCareerOperational(options, event.actorDid, currentAt);
        }
        let responseSnapshot = aggregate.snapshot;
        if (existing !== undefined) {
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Governance aggregate version already has different content",
            );
          }
          if (
            route.eventType === "GovernanceInspected" &&
            existing !== aggregate.records.at(-1)
          ) {
            throw new CanonicalConflictError(
              "Historical governance inspection cannot return newer state",
            );
          }
        } else {
          const occurredAt = canonicalInstant(event.timestamp);
          const latestOccurredAt =
            aggregate.records.at(-1)?.occurredAt.getTime() ??
            Number.NEGATIVE_INFINITY;
          if (
            occurredAt < latestOccurredAt ||
            occurredAt > currentTime + 60_000
          ) {
            throw new GovernanceValidationError(
              "Governance event timestamp is outside the accepted window",
            );
          }
          const previousHash = aggregate.records.at(-1)?.eventHash ?? null;
          if (event.previousEventHash !== previousHash)
            throw new HashChainConflictError(
              "Governance previous event hash is invalid",
            );
          let decision: GovernanceDecision | null = null;
          if (route.eventType === "GovernanceProposalRegistered") {
            const registration =
              ProposalRegistrationCommandSchema.parse(payload);
            await validateConfiguredSnapshotMembers(
              options,
              registration.eligibilitySnapshot,
            );
          } else if (route.eventType === "GovernanceProposalClosed") {
            if (aggregate.snapshot === null)
              throw new GovernanceValidationError(
                "Governance proposal is absent",
              );
            try {
              decision = await evaluateGovernanceWorkflowDecision(
                aggregate.snapshot,
                aggregate.votes,
                aggregate.authorization,
              );
            } catch (error) {
              throw new GovernanceValidationError(
                error instanceof Error
                  ? error.message
                  : "Governance tally failed",
              );
            }
          } else if (route.eventType === "GovernanceBallotCast") {
            registerVoter(
              aggregate.authorization,
              event.actorDid,
              authority.signingAddress,
            );
          }
          responseSnapshot = applyGovernanceWorkflowTransition(
            aggregate.snapshot,
            event,
            payload,
            decision,
          );
          if (governanceWorkflowStateRoot(responseSnapshot) !== event.stateRoot)
            throw new GovernanceValidationError(
              "Governance state root is invalid",
            );
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisGovernance: false,
          eligibilitySource: "CONFIGURED_REHEARSAL_SNAPSHOT",
          directBallotsOnly: true,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        if (route.eventType === "GovernanceInspected") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            governance: responseSnapshot,
          });
        }
        if (route.eventType === "GovernanceProposalClosed") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            decision: responseSnapshot?.decision ?? null,
          });
        }
        return reply.code(result.duplicate ? 200 : 201).send(response);
      } catch (error) {
        const response = governanceError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.post("/v1/governance/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
