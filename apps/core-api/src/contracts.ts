import {
  validateContractDuration,
  type ContractStatus,
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
import {
  ContractTransactionSchema,
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
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

const aggregateType = "career-contracts";
const eventTypes = [
  "ContractOffered",
  "ContractResponded",
  "ContractsInspected",
] as const;
export type ContractWorkflowEventType = (typeof eventTypes)[number];

export const ContractClubGovernorsSchema = z.record(
  z.string().min(1).max(160),
  DidSchema,
);
const ContractOfferSchema = ContractTransactionSchema.omit({
  consentRecordId: true,
}).extend({
  kind: z.literal("SIGN"),
  fromTeamId: z.null(),
  toTeamId: z.string().min(1).max(160),
  seasons: z.number().int().min(1).max(5),
  capMechanism: z.enum(["STANDARD_CAP", "DRAFT_SCALE", "MINIMUM"]),
});
const OfferPayloadSchema = z.strictObject({
  command: ContractOfferSchema,
  offeredByDid: DidSchema,
  offeredAt: IsoDateTimeSchema,
  clubAuthoritySnapshotDigest: Sha256Schema,
});
const ContractResponseSchema = z.strictObject({
  consentId: UuidV7Schema,
  agentDid: DidSchema,
  subjectType: z.literal("PLAYER_CONTRACT"),
  subjectId: UuidV7Schema,
  decision: z.enum(["CONSENT", "REFUSE"]),
  scope: z.tuple([z.literal("PLAYING_RIGHTS")]),
  proposalCommitment: Sha256Schema,
  recordedAt: IsoDateTimeSchema,
});
const ResponsePayloadSchema = z.strictObject({
  command: ContractResponseSchema,
});
const InspectionCommandSchema = z.strictObject({
  playerDid: DidSchema,
  requestedByDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-CONTRACT-INSPECTION-V1"),
});
const InspectionPayloadSchema = z.strictObject({
  command: InspectionCommandSchema,
});

export const CONTRACT_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-career-contract-workflow",
  version: 1,
  aggregateType,
  eventTypes,
  initialSigningOnly: true,
  playerRefusalFinal: true,
  liveCapSheetVerified: false,
});

type ContractOffer = z.infer<typeof ContractOfferSchema>;
type OfferPayload = z.infer<typeof OfferPayloadSchema>;
type ContractResponse = z.infer<typeof ContractResponseSchema>;
export type ContractWorkflowPayload =
  | OfferPayload
  | z.infer<typeof ResponsePayloadSchema>
  | z.infer<typeof InspectionPayloadSchema>;

export interface ContractWorkflowRecord {
  transaction: ContractOffer;
  offeredByDid: string;
  offeredAt: string;
  clubAuthoritySnapshotDigest: Hex;
  status: Extract<ContractStatus, "OFFERED" | "ACTIVE" | "REFUSED">;
  consent: ContractResponse | null;
}

export interface ContractWorkflowSnapshot {
  playerDid: string;
  version: number;
  lastTransitionAt: string;
  contracts: ContractWorkflowRecord[];
}

export interface ContractRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  clubGovernors: Readonly<Record<string, string>>;
  now?: () => number;
}

interface ContractAggregate {
  records: StoredCanonicalEvent[];
  snapshot: ContractWorkflowSnapshot | null;
}

class ContractAuthorizationError extends Error {
  public override readonly name = "ContractAuthorizationError";
}

class ContractValidationError extends Error {
  public override readonly name = "ContractValidationError";
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ContractValidationError("Contract timestamp is not canonical");
  return parsed;
}

function candidateOptions(
  options: ContractRehearsalOptions,
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

function normalizedClubGovernors(
  clubGovernors: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(clubGovernors).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function contractClubAuthoritySnapshotDigest(
  clubGovernors: Readonly<Record<string, string>>,
): Hex {
  return sha256Commitment({
    format: "ABL-CONTRACT-CLUB-AUTHORITY-SNAPSHOT-V1",
    clubGovernors: normalizedClubGovernors(clubGovernors),
  });
}

export function contractOfferCommitment(record: {
  transaction: ContractOffer;
  offeredByDid: string;
  offeredAt: string;
  clubAuthoritySnapshotDigest: Hex;
}): Hex {
  return sha256Commitment({
    format: "ABL-CONTRACT-OFFER-COMMITMENT-V1",
    transaction: record.transaction,
    offeredByDid: record.offeredByDid,
    offeredAt: record.offeredAt,
    clubAuthoritySnapshotDigest: record.clubAuthoritySnapshotDigest,
  });
}

function validateOffer(
  playerDid: string,
  event: CanonicalEvent,
  payload: OfferPayload,
): void {
  const { command } = payload;
  const offeredAt = canonicalInstant(payload.offeredAt);
  const effectiveAt = canonicalInstant(command.effectiveAt);
  try {
    validateContractDuration(command.seasons);
  } catch (error) {
    throw new ContractValidationError(
      error instanceof Error ? error.message : "Contract terms are invalid",
    );
  }
  if (
    command.playerDid !== playerDid ||
    payload.offeredByDid !== event.actorDid ||
    payload.offeredAt !== event.timestamp ||
    effectiveAt < offeredAt
  ) {
    throw new ContractValidationError(
      "Contract offer does not bind its parties or effective time",
    );
  }
}

function validateResponse(
  snapshot: ContractWorkflowSnapshot,
  event: CanonicalEvent,
  response: ContractResponse,
): ContractWorkflowRecord {
  const recordedAt = canonicalInstant(response.recordedAt);
  const contract = snapshot.contracts.find(
    ({ transaction }) => transaction.transactionId === response.subjectId,
  );
  if (
    contract === undefined ||
    contract.status !== "OFFERED" ||
    response.agentDid !== snapshot.playerDid ||
    event.actorDid !== snapshot.playerDid ||
    response.recordedAt !== event.timestamp ||
    response.proposalCommitment !== contractOfferCommitment(contract) ||
    recordedAt > canonicalInstant(contract.transaction.effectiveAt)
  ) {
    throw new ContractValidationError(
      "Contract response does not bind an open offer or its player",
    );
  }
  if (
    response.decision === "CONSENT" &&
    snapshot.contracts.some(({ status }) => status === "ACTIVE")
  ) {
    throw new ContractValidationError(
      "Initial-signing rehearsal cannot overlap an active contract",
    );
  }
  return contract;
}

function parsePayload(
  eventType: ContractWorkflowEventType,
  payload: unknown,
): ContractWorkflowPayload {
  switch (eventType) {
    case "ContractOffered":
      return OfferPayloadSchema.parse(payload);
    case "ContractResponded":
      return ResponsePayloadSchema.parse(payload);
    case "ContractsInspected":
      return InspectionPayloadSchema.parse(payload);
  }
}

function isEventType(value: string): value is ContractWorkflowEventType {
  return eventTypes.includes(value as ContractWorkflowEventType);
}

export function contractWorkflowStateRoot(
  snapshot: ContractWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-CAREER-CONTRACT-STATE-V1",
    ...snapshot,
  });
}

export function contractConsentHistoryCommitment(
  playerDid: string,
  snapshot: ContractWorkflowSnapshot | null,
): Hex {
  return sha256Commitment({
    format: "ABL-CONTRACT-CONSENT-HISTORY-V1",
    playerDid,
    consents:
      snapshot?.contracts.flatMap(({ transaction, consent }) =>
        consent === null
          ? []
          : [{ transactionId: transaction.transactionId, consent }],
      ) ?? [],
  });
}

export function compositeCareerConsentHistoryCommitment(
  admissionConsentHistoryCommitment: Hex,
  contractConsentCommitment: Hex,
): Hex {
  return sha256Commitment({
    format: "ABL-COMPOSITE-CONSENT-HISTORY-V1",
    admissionConsentHistoryCommitment,
    contractConsentCommitment,
  });
}

function workflowRecord(offer: OfferPayload): ContractWorkflowRecord {
  return {
    transaction: structuredClone(offer.command),
    offeredByDid: offer.offeredByDid,
    offeredAt: offer.offeredAt,
    clubAuthoritySnapshotDigest: offer.clubAuthoritySnapshotDigest as Hex,
    status: "OFFERED",
    consent: null,
  };
}

export function applyContractWorkflowTransition(
  current: ContractWorkflowSnapshot | null,
  event: CanonicalEvent,
  payload: ContractWorkflowPayload,
): ContractWorkflowSnapshot {
  if (current === null) {
    if (
      event.aggregateVersion !== 1n ||
      event.eventType !== "ContractOffered"
    ) {
      throw new ContractValidationError(
        "Career contract history must begin with an offer",
      );
    }
    const offer = OfferPayloadSchema.parse(payload);
    validateOffer(event.aggregateId, event, offer);
    return {
      playerDid: event.aggregateId,
      version: 1,
      lastTransitionAt: event.timestamp,
      contracts: [workflowRecord(offer)],
    };
  }
  if (
    event.aggregateVersion !== BigInt(current.version + 1) ||
    event.aggregateId !== current.playerDid ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(current.lastTransitionAt)
  ) {
    throw new ContractValidationError(
      "Career contract aggregate sequence is invalid",
    );
  }
  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;

  if (event.eventType === "ContractOffered") {
    const offer = OfferPayloadSchema.parse(payload);
    validateOffer(next.playerDid, event, offer);
    if (
      next.contracts.some(
        ({ transaction }) =>
          transaction.transactionId === offer.command.transactionId,
      )
    ) {
      throw new ContractValidationError(
        "Contract transaction ID is not unique",
      );
    }
    next.contracts.push(workflowRecord(offer));
    return next;
  }
  if (event.eventType === "ContractResponded") {
    const response = ResponsePayloadSchema.parse(payload).command;
    if (
      next.contracts.some(
        ({ consent }) => consent?.consentId === response.consentId,
      )
    ) {
      throw new ContractValidationError("Contract consent ID is not unique");
    }
    const contract = validateResponse(next, event, response);
    contract.status = response.decision === "CONSENT" ? "ACTIVE" : "REFUSED";
    contract.consent = structuredClone(response);
    return next;
  }
  if (event.eventType === "ContractsInspected") {
    const inspection = InspectionPayloadSchema.parse(payload).command;
    const participatingGovernors = new Set(
      next.contracts.map(({ offeredByDid }) => offeredByDid),
    );
    if (
      inspection.playerDid !== next.playerDid ||
      inspection.requestedByDid !== event.actorDid ||
      inspection.requestedAt !== event.timestamp ||
      (event.actorDid !== next.playerDid &&
        !participatingGovernors.has(event.actorDid))
    ) {
      throw new ContractAuthorizationError(
        "Contract inspection is outside party authority",
      );
    }
    return next;
  }
  throw new ContractValidationError("Contract history cannot be re-registered");
}

async function requireCareerSignature(
  options: ContractRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  at: string,
): Promise<void> {
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
    throw new ContractAuthorizationError("Contract signature is invalid");
  }
  if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new ContractAuthorizationError(
      "Contract signer is not the current career key",
    );
}

async function requireOfferAuthority(
  options: ContractRehearsalOptions,
  event: CanonicalEvent,
  offer: OfferPayload,
): Promise<void> {
  if (
    options.clubGovernors[offer.command.toTeamId] !== event.actorDid ||
    event.actorDid === offer.command.playerDid ||
    offer.clubAuthoritySnapshotDigest !==
      contractClubAuthoritySnapshotDigest(options.clubGovernors)
  ) {
    throw new ContractAuthorizationError(
      "Contract offer lacks configured club-governor authority",
    );
  }
  try {
    await readCandidateCareerAuthority(
      candidateOptions(options),
      offer.command.playerDid,
      event.timestamp,
    );
  } catch {
    throw new ContractAuthorizationError(
      "Contract offer targets a career not admitted when offered",
    );
  }
}

async function replayContractAggregate(
  options: ContractRehearsalOptions,
  playerDid: string,
): Promise<ContractAggregate> {
  const records = await options.store.readAggregate(aggregateType, playerDid);
  let snapshot: ContractWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== aggregateType ||
      event.aggregateId !== playerDid ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isEventType(event.eventType) ||
      event.schemaDigest !== CONTRACT_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new ContractAuthorizationError(
        "Stored contract aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new ContractAuthorizationError(
        "Stored contract event content is invalid",
      );
    }
    let payload: ContractWorkflowPayload;
    try {
      payload = parsePayload(event.eventType, event.payload);
    } catch {
      throw new ContractAuthorizationError(
        "Stored contract event payload is malformed",
      );
    }
    await requireCareerSignature(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    if (event.eventType === "ContractOffered") {
      await requireOfferAuthority(
        options,
        event,
        OfferPayloadSchema.parse(payload),
      );
    }
    try {
      snapshot = applyContractWorkflowTransition(snapshot, event, payload);
    } catch (error) {
      if (error instanceof ContractAuthorizationError) throw error;
      throw new ContractAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored contract transition is invalid",
      );
    }
    if (contractWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new ContractAuthorizationError(
        "Stored contract state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

export async function readContractConsentHistory(
  options: ContractRehearsalOptions,
  playerDid: string,
): Promise<Hex> {
  const aggregate = await replayContractAggregate(options, playerDid);
  return contractConsentHistoryCommitment(playerDid, aggregate.snapshot);
}

function appendInput(
  options: ContractRehearsalOptions,
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
    outboxTopic: "public.contracts",
  };
}

function contractError(error: unknown): { status: number; code: string } {
  if (
    error instanceof ContractAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "contract_authorization_denied" };
  }
  if (error instanceof z.ZodError || error instanceof ContractValidationError)
    return { status: 400, code: "invalid_contract_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "contract_aggregate_conflict" };
  }
  return { status: 500, code: "contract_failure" };
}

export function installContractRehearsalRoutes(
  app: FastifyInstance,
  options: ContractRehearsalOptions,
): void {
  const clubGovernors = ContractClubGovernorsSchema.parse(
    options.clubGovernors,
  );
  if (Object.keys(clubGovernors).length === 0)
    throw new Error("Contract rehearsal requires at least one club governor");
  if (
    new Set(Object.values(clubGovernors)).size !==
    Object.keys(clubGovernors).length
  ) {
    throw new Error("Contract rehearsal club governors must be distinct");
  }
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: ContractWorkflowEventType;
  }> = [
    { path: "/v1/contracts/offer", eventType: "ContractOffered" },
    { path: "/v1/contracts/respond", eventType: "ContractResponded" },
    { path: "/v1/contracts/inspect", eventType: "ContractsInspected" },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new ContractValidationError(
            "Contract event content is invalid",
          );
        }
        if (
          event.aggregateType !== aggregateType ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== CONTRACT_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new ContractAuthorizationError(
            "Contract event is outside route authority",
          );
        }
        const payload = parsePayload(route.eventType, event.payload);
        const aggregate = await replayContractAggregate(
          options,
          event.aggregateId,
        );
        const currentTime = now();
        const currentAt = new Date(currentTime).toISOString();
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        await requireCareerSignature(
          options,
          event,
          parsed.signatures[0]!,
          currentAt,
        );
        if (route.eventType !== "ContractsInspected") {
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
              "Contract aggregate version already has different content",
            );
          }
          if (
            route.eventType === "ContractsInspected" &&
            existing !== aggregate.records.at(-1)
          ) {
            throw new CanonicalConflictError(
              "Historical contract inspection cannot return newer state",
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
            throw new ContractValidationError(
              "Contract event timestamp is outside the accepted window",
            );
          }
          const previousHash = aggregate.records.at(-1)?.eventHash ?? null;
          if (event.previousEventHash !== previousHash)
            throw new HashChainConflictError(
              "Contract previous event hash is invalid",
            );
          if (route.eventType === "ContractOffered") {
            const offer = OfferPayloadSchema.parse(payload);
            await requireOfferAuthority(options, event, offer);
            await requireCareerOperational(
              options,
              offer.command.playerDid,
              currentAt,
            );
          }
          responseSnapshot = applyContractWorkflowTransition(
            aggregate.snapshot,
            event,
            payload,
          );
          if (contractWorkflowStateRoot(responseSnapshot) !== event.stateRoot)
            throw new ContractValidationError("Contract state root is invalid");
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisContract: false,
          initialSigningOnly: true,
          liveCapSheetVerified: false,
          clubAuthoritySource: "CONFIGURED_REHEARSAL_SNAPSHOT",
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        const responseStatus = result.duplicate ? 200 : 201;
        if (route.eventType === "ContractsInspected") {
          return reply.code(responseStatus).send({
            ...response,
            contracts: responseSnapshot,
          });
        }
        if (route.eventType === "ContractResponded") {
          const responseCommand = ResponsePayloadSchema.parse(payload).command;
          const contract = responseSnapshot?.contracts.find(
            ({ transaction }) =>
              transaction.transactionId === responseCommand.subjectId,
          );
          return reply.code(responseStatus).send({
            ...response,
            contractStatus: contract?.status ?? null,
          });
        }
        if (route.eventType === "ContractOffered") {
          const offer = OfferPayloadSchema.parse(payload);
          return reply.code(responseStatus).send({
            ...response,
            proposalCommitment: contractOfferCommitment({
              transaction: offer.command,
              offeredByDid: offer.offeredByDid,
              offeredAt: offer.offeredAt,
              clubAuthoritySnapshotDigest:
                offer.clubAuthoritySnapshotDigest as Hex,
            }),
          });
        }
        return reply.code(responseStatus).send(response);
      } catch (error) {
        const response = contractError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.post("/v1/contracts/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
