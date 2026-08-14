import {
  RELEASE_WORKFLOW_AGGREGATE_TYPE,
  RELEASE_WORKFLOW_SCHEMA_DIGEST,
  ReleaseApprovalPayloadSchema,
  ReleaseProposalPayloadSchema,
  ReleaseStayPayloadSchema,
  ReleaseWorkflowAuthorizationError,
  ReleaseWorkflowValidationError,
  applyReleaseWorkflowTransition,
  authorizedReleaseManifest,
  isReleaseWorkflowEventType,
  parseReleaseWorkflowPayload,
  releaseInstitutionalDids,
  releaseRoleDids,
  releaseWorkflowStateRoot,
  requireRegisteredReleaseVerifierResult,
  requireReleaseRatifications,
  validateReleaseInstitutionalRoster,
  type ReleaseInstitutionalRoster,
  type ReleaseWorkflowEventType,
  type ReleaseWorkflowPayload,
  type ReleaseWorkflowSnapshot,
  type ReleaseVerifierResultReader,
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
  SignedCanonicalMultiCommandSchema,
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

export interface ReleaseRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<
    string,
    { allowedAggregateTypes: readonly string[] }
  >;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  governance: Pick<GovernanceRehearsalOptions, "eligibilitySnapshot">;
  institutionalRoster: ReleaseInstitutionalRoster;
  verifierResults: ReleaseVerifierResultReader;
  now?: () => number;
}

interface ReleaseAggregate {
  records: StoredCanonicalEvent[];
  snapshot: ReleaseWorkflowSnapshot | null;
}

function candidateOptions(
  options: ReleaseRehearsalOptions,
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
  options: ReleaseRehearsalOptions,
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

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ReleaseWorkflowValidationError(
      "Release timestamp is not canonical",
    );
  return parsed;
}

async function careerSigningAddress(
  options: ReleaseRehearsalOptions,
  agentDid: string,
  at: string,
): Promise<`0x${string}`> {
  return (
    await readCandidateCareerAuthority(candidateOptions(options), agentDid, at)
  ).signingAddress;
}

function requireReleaseScope(
  options: ReleaseRehearsalOptions,
  agentDid: string,
): void {
  if (
    !options.admittedAgents
      .get(agentDid)
      ?.allowedAggregateTypes.includes(RELEASE_WORKFLOW_AGGREGATE_TYPE)
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Release actor is not admitted for software-release commands",
    );
  }
}

async function requireSingleCareerSignature(
  options: ReleaseRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
): Promise<void> {
  const expected = await careerSigningAddress(
    options,
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
    throw new ReleaseWorkflowAuthorizationError(
      "Release event signature is invalid",
    );
  }
  if (recovered.toLowerCase() !== expected.toLowerCase())
    throw new ReleaseWorkflowAuthorizationError(
      "Release event signer is not the actor career key",
    );
}

async function requireStaySignatures(
  options: ReleaseRehearsalOptions,
  event: CanonicalEvent,
  payload: ReleaseWorkflowPayload,
  signatures: readonly unknown[],
): Promise<void> {
  const stay = ReleaseStayPayloadSchema.parse(payload).command;
  if (
    signatures.length !== stay.participatingTribunalDids.length ||
    stay.participatingTribunalDids.some(
      (did) => !options.institutionalRoster.tribunalDids.includes(did),
    ) ||
    stay.recusedTribunalDids.some(
      (did) => !options.institutionalRoster.tribunalDids.includes(did),
    )
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Release stay signatures are outside the tribunal roster",
    );
  }
  const expected = await Promise.all(
    stay.participatingTribunalDids.map((did) =>
      careerSigningAddress(options, did, event.timestamp),
    ),
  );
  let recovered: string[];
  try {
    recovered = await Promise.all(
      signatures.map((signature) =>
        recoverCanonicalEventSigner(options.domain, event, signature as Hex),
      ),
    );
  } catch {
    throw new ReleaseWorkflowAuthorizationError(
      "Release stay signature is invalid",
    );
  }
  const normalizedExpected = expected.map((address) => address.toLowerCase());
  const normalizedRecovered = recovered.map((address) => address.toLowerCase());
  if (
    new Set(normalizedExpected).size !== normalizedExpected.length ||
    new Set(normalizedRecovered).size !== normalizedRecovered.length ||
    normalizedExpected.some((address) => !normalizedRecovered.includes(address))
  ) {
    throw new ReleaseWorkflowAuthorizationError(
      "Release stay does not have the declared tribunal career keys",
    );
  }
}

async function requireReleaseEventAuthority(
  options: ReleaseRehearsalOptions,
  event: CanonicalEvent,
  payload: ReleaseWorkflowPayload,
  signatures: readonly unknown[],
): Promise<void> {
  const signerDids = releaseSignerDids(
    event.eventType as ReleaseWorkflowEventType,
    payload,
    event.actorDid,
  );
  signerDids.forEach((did) => requireReleaseScope(options, did));
  if (event.eventType === "ReleaseStayed") {
    await requireStaySignatures(options, event, payload, signatures);
    return;
  }
  if (signatures.length !== 1 || typeof signatures[0] !== "string")
    throw new ReleaseWorkflowAuthorizationError(
      "Release event requires exactly one actor signature",
    );
  await requireSingleCareerSignature(options, event, signatures[0]);
  if (
    event.eventType === "ReleaseProposed" ||
    event.eventType === "ReleaseAuthorized"
  ) {
    const officeDids = releaseInstitutionalDids(options.institutionalRoster);
    officeDids.forEach((did) => requireReleaseScope(options, did));
    const officeAddresses = await Promise.all(
      officeDids.map((did) =>
        careerSigningAddress(options, did, event.timestamp),
      ),
    );
    if (
      new Set(officeAddresses.map((address) => address.toLowerCase())).size !==
      officeAddresses.length
    ) {
      throw new ReleaseWorkflowAuthorizationError(
        "Release institutional roster aliases a career key",
      );
    }
  }
  if (event.eventType === "ReleaseApproved") {
    const approval = ReleaseApprovalPayloadSchema.parse(payload).command;
    if (
      !releaseRoleDids(options.institutionalRoster, approval.role).includes(
        event.actorDid,
      )
    ) {
      throw new ReleaseWorkflowAuthorizationError(
        "Release approver does not hold the declared institutional role",
      );
    }
  }
}

function releaseSignerDids(
  eventType: ReleaseWorkflowEventType,
  payload: ReleaseWorkflowPayload,
  actorDid: string,
): readonly string[] {
  if (eventType !== "ReleaseStayed") return [actorDid];
  return ReleaseStayPayloadSchema.parse(payload).command
    .participatingTribunalDids;
}

function releaseStatus(
  snapshot: ReleaseWorkflowSnapshot,
): "AUTHORIZED_LOCAL_REHEARSAL" | "STAYED" | "PENDING_AUTHORIZATION" {
  if (snapshot.authorizedAt !== null) return "AUTHORIZED_LOCAL_REHEARSAL";
  if (snapshot.stay !== null) return "STAYED";
  return "PENDING_AUTHORIZATION";
}

async function requireRatifications(
  options: ReleaseRehearsalOptions,
  snapshot: ReleaseWorkflowSnapshot,
): Promise<void> {
  await requireReleaseRatifications(snapshot, {
    releaseRatification: (proposalId) =>
      readResourceScheduleRatification(governanceOptions(options), proposalId),
  });
}

async function requireVerifierEvidence(
  options: ReleaseRehearsalOptions,
  eventType: ReleaseWorkflowEventType,
  payload: ReleaseWorkflowPayload,
): Promise<void> {
  if (eventType !== "ReleaseProposed") return;
  const proposal = ReleaseProposalPayloadSchema.parse(payload);
  await requireRegisteredReleaseVerifierResult(
    proposal.manifest,
    proposal.verifierResult,
    options.verifierResults,
  );
}

async function replayReleaseAggregate(
  options: ReleaseRehearsalOptions,
  releaseId: string,
): Promise<ReleaseAggregate> {
  const records = await options.store.readAggregate(
    RELEASE_WORKFLOW_AGGREGATE_TYPE,
    releaseId,
  );
  let snapshot: ReleaseWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== RELEASE_WORKFLOW_AGGREGATE_TYPE ||
      event.aggregateId !== releaseId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isReleaseWorkflowEventType(event.eventType) ||
      event.schemaDigest !== RELEASE_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp
    ) {
      throw new ReleaseWorkflowAuthorizationError(
        "Stored release aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new ReleaseWorkflowAuthorizationError(
        "Stored release event content is invalid",
      );
    }
    let payload: ReleaseWorkflowPayload;
    try {
      payload = parseReleaseWorkflowPayload(event.eventType, event.payload);
    } catch {
      throw new ReleaseWorkflowAuthorizationError(
        "Stored release payload is malformed",
      );
    }
    await requireReleaseEventAuthority(
      options,
      event,
      payload,
      record.signatures,
    );
    await requireVerifierEvidence(options, event.eventType, payload);
    try {
      snapshot = applyReleaseWorkflowTransition(snapshot, event, payload);
    } catch (error) {
      if (error instanceof ReleaseWorkflowAuthorizationError) throw error;
      throw new ReleaseWorkflowAuthorizationError(
        "Stored release transition is malformed",
      );
    }
    if (releaseWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new ReleaseWorkflowAuthorizationError(
        "Stored release state root is invalid",
      );
    if (event.eventType === "ReleaseAuthorized")
      await requireRatifications(options, snapshot);
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

function approvalSignatures(
  records: readonly StoredCanonicalEvent[],
): string[] {
  return records
    .filter((record) => record.eventType === "ReleaseApproved")
    .map((record) => record.signatures[0])
    .filter((signature): signature is string => typeof signature === "string");
}

function releaseError(error: unknown): { status: number; code: string } {
  if (
    error instanceof ReleaseWorkflowAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "release_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof ReleaseWorkflowValidationError
  )
    return { status: 400, code: "invalid_release_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "release_aggregate_conflict" };
  }
  return { status: 500, code: "release_failure" };
}

export function installReleaseRehearsalRoutes(
  app: FastifyInstance,
  options: ReleaseRehearsalOptions,
): void {
  validateReleaseInstitutionalRoster(options.institutionalRoster);
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: ReleaseWorkflowEventType;
    multiSignature: boolean;
  }> = [
    {
      path: "/v1/releases/propose",
      eventType: "ReleaseProposed",
      multiSignature: false,
    },
    {
      path: "/v1/releases/approve",
      eventType: "ReleaseApproved",
      multiSignature: false,
    },
    {
      path: "/v1/releases/stay",
      eventType: "ReleaseStayed",
      multiSignature: true,
    },
    {
      path: "/v1/releases/authorize",
      eventType: "ReleaseAuthorized",
      multiSignature: false,
    },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = (
          route.multiSignature
            ? SignedCanonicalMultiCommandSchema
            : SignedCanonicalCommandSchema
        ).parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new ReleaseWorkflowValidationError(
            "Release event content is invalid",
          );
        }
        if (
          event.aggregateType !== RELEASE_WORKFLOW_AGGREGATE_TYPE ||
          event.aggregateId === "" ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== RELEASE_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new ReleaseWorkflowAuthorizationError(
            "Release event is outside route authority",
          );
        }
        const payload = parseReleaseWorkflowPayload(
          route.eventType,
          event.payload,
        );
        await requireVerifierEvidence(options, route.eventType, payload);
        const aggregate = await replayReleaseAggregate(
          options,
          event.aggregateId,
        );
        const currentTime = now();
        const currentAt = new Date(currentTime).toISOString();
        const occurredAt = canonicalInstant(event.timestamp);
        if (occurredAt > currentTime + 60_000)
          throw new ReleaseWorkflowAuthorizationError(
            "Release event is too far in the future",
          );
        await requireReleaseEventAuthority(
          options,
          event,
          payload,
          parsed.signatures,
        );
        const signerDids = releaseSignerDids(
          route.eventType,
          payload,
          event.actorDid,
        );
        await Promise.all(
          signerDids.map((did) =>
            requireCareerOperational(options, did, currentAt),
          ),
        );
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        let snapshot = aggregate.snapshot;
        if (existing !== undefined) {
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Release aggregate version already has different content",
            );
          }
        } else {
          snapshot = applyReleaseWorkflowTransition(snapshot, event, payload);
          if (releaseWorkflowStateRoot(snapshot) !== event.stateRoot)
            throw new ReleaseWorkflowValidationError(
              "Release event state root is invalid",
            );
          if (route.eventType === "ReleaseAuthorized")
            await requireRatifications(options, snapshot);
          await options.store.append({
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
            occurredAt: new Date(occurredAt),
            outboxTopic: "public.releases",
          });
        }
        if (snapshot === null)
          throw new ReleaseWorkflowValidationError(
            "Release workflow has no state",
          );
        const authorizationSignatures = approvalSignatures(aggregate.records);
        if (
          existing === undefined &&
          event.eventType === "ReleaseApproved" &&
          typeof parsed.signatures[0] === "string"
        ) {
          authorizationSignatures.push(parsed.signatures[0]);
        }
        return reply.code(existing === undefined ? 201 : 200).send({
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisRelease: false,
          aggregateVersion: snapshot.version.toString(),
          status: releaseStatus(snapshot),
          manifest:
            snapshot.authorizedAt === null
              ? null
              : authorizedReleaseManifest(snapshot, authorizationSignatures),
          duplicate: existing !== undefined,
        });
      } catch (error) {
        const response = releaseError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }
}
