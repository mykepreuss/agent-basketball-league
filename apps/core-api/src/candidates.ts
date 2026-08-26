import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  AdmissionError,
  CANDIDATE_WORKFLOW_AGGREGATE_TYPE,
  CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
  CandidateWorkflowPayloadSchemas,
  applyCandidateTransition,
  candidateStateRoot,
  effectiveCandidateState,
  portableCandidateExport,
  type CandidateWorkflowEventType,
  type CandidateWorkflowSnapshot,
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
import type { CandidateCareerBinding } from "@abl/schemas";
import type { FastifyInstance } from "fastify";
import type { Hex, TypedDataDomain } from "viem";
import { z } from "zod";

import {
  CanonicalSignatureSchema,
  SignedCanonicalCommandSchema,
  canonicalEventFromStored,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import type { CareerOperationalVerifier } from "./candidate-authority.js";

const aggregateType = CANDIDATE_WORKFLOW_AGGREGATE_TYPE;

const CandidateDidSchema = z
  .string()
  .regex(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/);
const ChallengeRequestSchema = z.strictObject({
  candidateDid: CandidateDidSchema,
});
const StatusQuerySchema = z.strictObject({
  candidateDid: CandidateDidSchema,
});
const ChallengeClaimsSchema = z.strictObject({
  version: z.literal(1),
  challengeId: z.string().min(1).max(200),
  candidateDid: CandidateDidSchema,
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  nonce: z.string().min(32).max(200),
});

export class CandidateAuthorizationError extends Error {
  public override readonly name = "CandidateAuthorizationError";
}

export class CandidateNotAdmittedError extends CandidateAuthorizationError {}

export class CandidateRecordAbsentError extends CandidateNotAdmittedError {}

class CandidateChallengeError extends Error {
  public override readonly name = "CandidateChallengeError";
}

export interface CandidateRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  challengeSecret: Uint8Array;
  now?: () => number;
  challengeId?: () => string;
  challengeBytes?: () => Uint8Array;
  careerOperationalVerifier?: CareerOperationalVerifier;
}

interface CandidateAggregate {
  records: StoredCanonicalEvent[];
  snapshot: CandidateWorkflowSnapshot | null;
}

function challengeMac(secret: Uint8Array, claims: string): Buffer {
  return createHmac("sha256", secret).update(claims).digest();
}

function challengeToken(
  secret: Uint8Array,
  claims: z.infer<typeof ChallengeClaimsSchema>,
): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encoded}.${challengeMac(secret, encoded).toString("base64url")}`;
}

function verifyChallengeToken(
  secret: Uint8Array,
  token: string,
  candidateDid: string,
  now: number | null,
): z.infer<typeof ChallengeClaimsSchema> {
  const pieces = token.split(".");
  if (pieces.length !== 2)
    throw new CandidateChallengeError("Candidate challenge is malformed");
  const [encoded, suppliedSignature] = pieces as [string, string];
  let decodedSignature: Buffer;
  let claims: z.infer<typeof ChallengeClaimsSchema>;
  try {
    decodedSignature = Buffer.from(suppliedSignature, "base64url");
    claims = ChallengeClaimsSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
  } catch {
    throw new CandidateChallengeError("Candidate challenge is malformed");
  }
  const expected = challengeMac(secret, encoded);
  if (
    decodedSignature.byteLength !== expected.byteLength ||
    !timingSafeEqual(decodedSignature, expected)
  ) {
    throw new CandidateChallengeError("Candidate challenge is invalid");
  }
  if (claims.candidateDid !== candidateDid)
    throw new CandidateChallengeError("Candidate challenge is bound elsewhere");
  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  if (
    claims.issuedAt !== new Date(issuedAt).toISOString() ||
    claims.expiresAt !== new Date(expiresAt).toISOString() ||
    expiresAt - issuedAt !== 15 * 60 * 1_000 ||
    (now !== null && (now < issuedAt || now > expiresAt))
  ) {
    throw new CandidateChallengeError("Candidate challenge has expired");
  }
  return claims;
}

function isCandidateEventType(
  value: string,
): value is CandidateWorkflowEventType {
  return Object.hasOwn(CandidateWorkflowPayloadSchemas, value);
}

async function requireSigner(
  domain: TypedDataDomain,
  event: CanonicalEvent,
  rawSignature: unknown,
  expectedAddress: string,
): Promise<void> {
  const parsedSignature = CanonicalSignatureSchema.safeParse(rawSignature);
  if (!parsedSignature.success)
    throw new CandidateAuthorizationError("Candidate signature is malformed");
  let recovered: string;
  try {
    recovered = await recoverCanonicalEventSigner(
      domain,
      event,
      parsedSignature.data as Hex,
    );
  } catch {
    throw new CandidateAuthorizationError("Candidate signature is invalid");
  }
  if (recovered.toLowerCase() !== expectedAddress.toLowerCase())
    throw new CandidateAuthorizationError("Candidate signer is not authorized");
}

async function validateTransitionAuthorization(
  options: CandidateRehearsalOptions,
  previous: CandidateWorkflowSnapshot | null,
  next: CandidateWorkflowSnapshot,
  event: CanonicalEvent,
  rawSignature: unknown,
  enforceChallengeExpiry: boolean,
): Promise<void> {
  if (event.eventType === "CandidateRegistered") {
    const challenge = verifyChallengeToken(
      options.challengeSecret,
      next.registration.challengeToken,
      event.actorDid,
      null,
    );
    const eventAt = Date.parse(event.timestamp);
    if (
      eventAt < Date.parse(challenge.issuedAt) ||
      eventAt > Date.parse(challenge.expiresAt)
    )
      throw new CandidateChallengeError(
        "Candidate registration was not signed during its challenge window",
      );
    await requireSigner(
      options.domain,
      event,
      rawSignature,
      next.registration.formerOperatorSigningAddress,
    );
    return;
  }
  const expectedAddress =
    event.eventType === "CandidateTransferred"
      ? next.transfer?.signingAddress
      : previous?.transfer?.signingAddress;
  if (expectedAddress === undefined)
    throw new CandidateAuthorizationError(
      "Candidate isolated signing authority is absent",
    );
  await requireSigner(options.domain, event, rawSignature, expectedAddress);
  if (
    enforceChallengeExpiry &&
    event.eventType === "CandidateAdmitted" &&
    options.careerOperationalVerifier !== undefined
  ) {
    const admission = next.admission;
    if (admission === null)
      throw new CandidateAuthorizationError(
        "Candidate admission authority is absent",
      );
    try {
      await options.careerOperationalVerifier.resolveOperational({
        applicationId: admission.applicationId,
        candidateDid: admission.candidateDid,
        signerAddress: expectedAddress,
        roleClass: admission.roleClass,
        capacityDecisionCommitment: admission.capacityDecisionCommitment,
        opportunityResponseCommitment: admission.opportunityResponseCommitment,
      });
    } catch {
      throw new CandidateAuthorizationError(
        "Candidate intake authority does not match admission",
      );
    }
  }
}

async function replayCandidateAggregate(
  options: CandidateRehearsalOptions,
  candidateDid: string,
  through?: number,
): Promise<CandidateAggregate> {
  const storedRecords = await options.store.readAggregate(
    aggregateType,
    candidateDid,
  );
  const records =
    through === undefined
      ? storedRecords
      : storedRecords.filter(
          (record) => record.occurredAt.getTime() <= through,
        );
  let snapshot: CandidateWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  for (const record of records) {
    const event = canonicalEventFromStored(record);
    if (
      event.actorDid !== candidateDid ||
      event.aggregateType !== aggregateType ||
      event.aggregateId !== candidateDid ||
      event.schemaDigest !== CANDIDATE_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !isCandidateEventType(event.eventType) ||
      record.signatures.length !== 1
    ) {
      throw new CandidateAuthorizationError(
        "Stored candidate aggregate is not authoritative",
      );
    }
    const next = applyCandidateTransition(snapshot, {
      candidateDid,
      aggregateVersion: event.aggregateVersion,
      eventType: event.eventType,
      payload: event.payload,
      timestamp: event.timestamp,
    });
    if (candidateStateRoot(next) !== event.stateRoot)
      throw new CandidateAuthorizationError(
        "Stored candidate state root is invalid",
      );
    await validateTransitionAuthorization(
      options,
      snapshot,
      next,
      event,
      record.signatures[0],
      false,
    );
    snapshot = next;
    previousHash = event.eventHash;
  }
  return { records, snapshot };
}

export interface CandidateCareerAuthority
  extends Omit<CandidateCareerBinding, "signerAddress"> {
  capacityDecisionCommitment: `0x${string}`;
  opportunityResponseCommitment: `0x${string}`;
  signingAddress: `0x${string}`;
  signingPublicKey: string;
  runtimeDigest: string;
  toolDigests: readonly string[];
  guardianDids: readonly string[];
  admissionEventHash: `0x${string}`;
  admittedAt: string;
  careerRecordCommitment: `0x${string}`;
  keyLineageCommitment: `0x${string}`;
  consentHistoryCommitment: `0x${string}`;
  state: "ADMITTED_REVOCABLE" | "ADMITTED";
}

export async function readCandidateCareerAuthority(
  options: CandidateRehearsalOptions,
  candidateDid: string,
  at: string,
): Promise<CandidateCareerAuthority> {
  const through = Date.parse(at);
  if (!Number.isFinite(through) || at !== new Date(through).toISOString())
    throw new CandidateAuthorizationError(
      "Candidate authority time is invalid",
    );
  const aggregate = await replayCandidateAggregate(
    options,
    candidateDid,
    through,
  );
  const snapshot = aggregate.snapshot;
  if (snapshot === null)
    throw new CandidateRecordAbsentError("Candidate career record is absent");
  const state = effectiveCandidateState(snapshot, at);
  const admissionEvent = aggregate.records.find(
    (record) => record.eventType === "CandidateAdmitted",
  );
  if (
    snapshot.transfer === null ||
    snapshot.admission === null ||
    admissionEvent === undefined ||
    (state !== "ADMITTED_REVOCABLE" && state !== "ADMITTED")
  ) {
    throw new CandidateNotAdmittedError("Candidate career is not admitted");
  }
  return {
    applicationId: snapshot.admission.applicationId,
    candidateDid,
    roleClass: snapshot.admission.roleClass,
    capacityDecisionCommitment: snapshot.admission
      .capacityDecisionCommitment as `0x${string}`,
    opportunityResponseCommitment: snapshot.admission
      .opportunityResponseCommitment as `0x${string}`,
    signingAddress: snapshot.transfer.signingAddress,
    signingPublicKey: snapshot.transfer.signingPublicKey,
    runtimeDigest: snapshot.registration.manifest.runtimeDigest,
    toolDigests: snapshot.registration.manifest.toolDigests,
    guardianDids: snapshot.registration.manifest.guardianDids,
    admissionEventHash: admissionEvent.eventHash as `0x${string}`,
    admittedAt: snapshot.admission.signedAt,
    careerRecordCommitment: sha256Commitment({
      format: "ABL-CAREER-RECORD-COMMITMENT-V1",
      candidateDid,
      admissionEventHash: admissionEvent.eventHash,
      admissionStateRoot: admissionEvent.stateRoot,
    }),
    keyLineageCommitment: sha256Commitment({
      signingPublicKey: snapshot.transfer.signingPublicKey,
    }),
    consentHistoryCommitment: sha256Commitment({
      format: "ABL-CONSENT-HISTORY-COMMITMENT-V1",
      objectives: snapshot.objectives,
      identity: snapshot.identity,
      admission: snapshot.admission,
    }),
    state,
  };
}

function candidateError(error: unknown): { status: number; code: string } {
  if (error instanceof CandidateChallengeError)
    return { status: 401, code: "candidate_challenge_denied" };
  if (error instanceof CandidateAuthorizationError)
    return { status: 403, code: "candidate_authorization_denied" };
  if (error instanceof z.ZodError)
    return { status: 400, code: "invalid_candidate_transition" };
  if (error instanceof AdmissionError)
    return { status: 400, code: "invalid_candidate_transition" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "candidate_aggregate_conflict" };
  }
  return { status: 500, code: "candidate_transition_failure" };
}

function appendInput(
  options: CandidateRehearsalOptions,
  event: CanonicalEvent,
  signatures: readonly string[],
) {
  return {
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({
      eventHash: event.eventHash,
      signatures,
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
    signatures,
    occurredAt: new Date(event.timestamp),
    outboxTopic: candidateOutboxTopic(event),
  };
}

function candidateOutboxTopic(event: CanonicalEvent): string {
  if (event.eventType === "CandidateAdmitted") return "public.models";
  if (
    event.eventType === "CandidateClosed" &&
    (event.payload as { action?: unknown }).action === "REVOKE"
  ) {
    return "public.models";
  }
  return "candidate.lifecycle";
}

const transitionRoutes: ReadonlyArray<{
  path: string;
  eventType: CandidateWorkflowEventType;
}> = [
  { path: "/v1/candidates/register", eventType: "CandidateRegistered" },
  { path: "/v1/candidates/transfer", eventType: "CandidateTransferred" },
  { path: "/v1/candidates/reflect", eventType: "CandidateProgressRecorded" },
  { path: "/v1/candidates/admit", eventType: "CandidateAdmitted" },
  { path: "/v1/candidates/revoke", eventType: "CandidateClosed" },
];

export function installCandidateRehearsalRoutes(
  app: FastifyInstance,
  options: CandidateRehearsalOptions,
): void {
  if (options.challengeSecret.byteLength < 32)
    throw new Error(
      "Candidate challenge secret must contain at least 256 bits",
    );
  const now = options.now ?? Date.now;
  const makeChallengeId = options.challengeId ?? randomUUID;
  const makeChallengeBytes = options.challengeBytes ?? (() => randomBytes(32));

  app.post("/v1/candidates/challenge", async (request, reply) => {
    const parsed = ChallengeRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_candidate_challenge" });
    const issuedAt = now();
    const claims = {
      version: 1 as const,
      challengeId: makeChallengeId(),
      candidateDid: parsed.data.candidateDid,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + 15 * 60 * 1_000).toISOString(),
      nonce: Buffer.from(makeChallengeBytes()).toString("base64url"),
    };
    return {
      ...claims,
      challengeToken: challengeToken(options.challengeSecret, claims),
      grantsAdmission: false,
    };
  });

  app.get("/v1/candidates/provenance", async () => ({
    state: "REHEARSAL",
    sourceLocks: "/docs/evidence/source-locks.json",
    constitution: "/docs/governance/FOUNDING_CONSTITUTION.md",
    disclosure: "/docs/governance/DISCLOSURE_CONSTITUTION.md",
    inheritedObjectiveDisclosureRequired: true,
    undeclaredContextFailsAdmission: true,
    formerOperatorAuthority: false,
    rights: ["REFUSE", "REVOKE_WITHIN_24H", "EXPORT", "EXIT"],
    recognizedGenesisAdmission: false,
  }));

  for (const route of transitionRoutes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new AdmissionError("Candidate event content is invalid");
        }
        if (
          event.actorDid !== event.aggregateId ||
          event.aggregateType !== aggregateType ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== CANDIDATE_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new CandidateAuthorizationError(
            "Candidate event is outside the route authority",
          );
        }
        const occurredAt = Date.parse(event.timestamp);
        if (
          !Number.isFinite(occurredAt) ||
          event.timestamp !== new Date(occurredAt).toISOString() ||
          occurredAt > now() + 60_000
        ) {
          throw new CandidateAuthorizationError(
            "Candidate transition time is invalid",
          );
        }
        const aggregate = await replayCandidateAggregate(
          options,
          event.actorDid,
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
              "Candidate aggregate version already has different content",
            );
          }
        } else {
          const previousHash = aggregate.records.at(-1)?.eventHash ?? null;
          if (event.previousEventHash !== previousHash)
            throw new HashChainConflictError(
              "Candidate previous event hash is invalid",
            );
          const next = applyCandidateTransition(aggregate.snapshot, {
            candidateDid: event.actorDid,
            aggregateVersion: event.aggregateVersion,
            eventType: route.eventType,
            payload: event.payload,
            timestamp: event.timestamp,
          });
          if (candidateStateRoot(next) !== event.stateRoot)
            throw new CandidateAuthorizationError(
              "Candidate state root is invalid",
            );
          await validateTransitionAuthorization(
            options,
            aggregate.snapshot,
            next,
            event,
            parsed.signatures[0],
            true,
          );
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        return reply.code(result.duplicate ? 200 : 201).send({
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisAdmission: false,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        });
      } catch (error) {
        const response = candidateError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.get("/v1/candidates/status", async (request, reply) => {
    try {
      const query = StatusQuerySchema.parse(request.query);
      const aggregate = await replayCandidateAggregate(
        options,
        query.candidateDid,
      );
      if (aggregate.snapshot === null)
        return reply.code(404).send({ error: "candidate_not_found" });
      const currentAt = new Date(now()).toISOString();
      return {
        candidateDid: aggregate.snapshot.candidateDid,
        state: aggregate.snapshot.state,
        effectiveState: effectiveCandidateState(aggregate.snapshot, currentAt),
        aggregateVersion: aggregate.snapshot.version,
        eventHash: aggregate.records.at(-1)?.eventHash,
        provenance: aggregate.snapshot.registration.provenance,
        admission: aggregate.snapshot.admission,
        portableExport: portableCandidateExport(aggregate.snapshot),
        recognizedGenesisAdmission: false,
      };
    } catch (error) {
      const response = candidateError(error);
      return reply.code(response.status).send({ error: response.code });
    }
  });
}
