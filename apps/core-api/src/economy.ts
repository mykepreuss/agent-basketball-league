import {
  ECONOMY_WORKFLOW_AGGREGATE_TYPE,
  ECONOMY_WORKFLOW_EVENT_TYPES,
  ECONOMY_WORKFLOW_SCHEMA_DIGEST,
  EconomyInitializationPayloadSchema,
  EconomyWorkflowAuthorizationError,
  EconomyWorkflowValidationError,
  ContractTradePayloadSchema,
  ContractWaiverPayloadSchema,
  FreeAgencyOpenPayloadSchema,
  FreeAgentSigningPayloadSchema,
  EconomyInspectionPayloadSchema,
  adverseWaiverActionCommitment,
  applyEconomyWorkflowTransition,
  contractClubAuthoritySnapshotDigest,
  economyWorkflowStateRoot,
  parseEconomyWorkflowPayload,
  requireAdverseContractCase,
  requireTradeAccessEvidence,
  InitialContractRightSchema,
  type EconomyWorkflowEventType,
  type EconomyWorkflowPayload,
  type EconomyWorkflowSnapshot,
  type TradeAccessEvidenceReader,
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
  SignedCanonicalMultiCommandSchema,
  canonicalEventFromStored,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import {
  CandidateAuthorizationError,
  readCandidateCareerAuthority,
  type CandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import { readAdverseContractCase, type CaseRehearsalOptions } from "./cases.js";
import {
  readContractRehearsalState,
  type ContractRehearsalOptions,
} from "./contracts.js";
import { CareerExitedError, requireCareerOperational } from "./exit-status.js";

type InitialContractRight = z.infer<typeof InitialContractRightSchema>;

export interface EconomyAdmittedAuthority {
  signerAddress: `0x${string}`;
  allowedAggregateTypes: readonly string[];
}

export interface EconomyRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  admittedAgents: ReadonlyMap<string, EconomyAdmittedAuthority>;
  competitionId: string;
  seasonId: string;
  economyId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  clubGovernors: Readonly<Record<string, string>>;
  capAuthorityDid: string;
  playerDids: readonly string[];
  freeAgencyWindow: { opensAt: string; closesAt: string };
  tradeAccessEvidence: TradeAccessEvidenceReader;
  cases: Pick<CaseRehearsalOptions, "tribunalDids" | "appellateDids">;
  now?: () => number;
}

interface EconomyAggregate {
  records: StoredCanonicalEvent[];
  snapshot: EconomyWorkflowSnapshot | null;
}

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new EconomyWorkflowValidationError(
      "Economy timestamp is not canonical",
    );
  return parsed;
}

function candidateOptions(
  options: EconomyRehearsalOptions,
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

function contractOptions(
  options: EconomyRehearsalOptions,
): ContractRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    candidateAdmission: options.candidateAdmission,
    clubGovernors: options.clubGovernors,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

function caseOptions(options: EconomyRehearsalOptions): CaseRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    candidateAdmission: options.candidateAdmission,
    tribunalDids: options.cases.tribunalDids,
    appellateDids: options.cases.appellateDids,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

function isEventType(value: string): value is EconomyWorkflowEventType {
  return ECONOMY_WORKFLOW_EVENT_TYPES.includes(
    value as EconomyWorkflowEventType,
  );
}

function activeRight(
  playerDid: string,
  state: Awaited<ReturnType<typeof readContractRehearsalState>>,
): InitialContractRight | null {
  const active =
    state.snapshot?.contracts.filter(({ status }) => status === "ACTIVE") ?? [];
  if (active.length > 1)
    throw new EconomyWorkflowAuthorizationError(
      "Player contract history has overlapping active rights",
    );
  const record = active[0];
  if (record === undefined) return null;
  if (
    record.consent === null ||
    state.headEventHash === null ||
    state.stateRoot === null ||
    record.transaction.toTeamId === null
  ) {
    throw new EconomyWorkflowAuthorizationError(
      "Active player contract lacks canonical consent evidence",
    );
  }
  return {
    playerDid,
    transactionId: record.transaction.transactionId,
    consentId: record.consent.consentId,
    clubId: record.transaction.toTeamId,
    seasons: record.transaction.seasons,
    courtCredits: record.transaction.courtCredits,
    capMechanism: record.transaction.capMechanism,
    termsCommitment: record.transaction.termsCommitment,
    effectiveAt: record.transaction.effectiveAt,
    origin: "INITIAL_CONTRACT",
    sourceAggregateVersion: state.aggregateVersion,
    sourceEventHash: state.headEventHash as `0x${string}`,
    sourceStateRoot: state.stateRoot as `0x${string}`,
  };
}

async function authoritativeInitialRights(
  options: EconomyRehearsalOptions,
): Promise<InitialContractRight[]> {
  const rights = (
    await Promise.all(
      options.playerDids.map(async (playerDid) =>
        activeRight(
          playerDid,
          await readContractRehearsalState(contractOptions(options), playerDid),
        ),
      ),
    )
  )
    .filter((right) => right !== null)
    .sort((left, right) => left.playerDid.localeCompare(right.playerDid));
  return rights;
}

async function requireInitialSources(
  options: EconomyRehearsalOptions,
  claimed: readonly InitialContractRight[],
): Promise<void> {
  const expected = await authoritativeInitialRights(options);
  if (
    expected.length !== options.playerDids.length ||
    sha256Commitment(expected) !== sha256Commitment(claimed)
  ) {
    throw new EconomyWorkflowAuthorizationError(
      "Economy cap certificate omits or substitutes a consented player contract",
    );
  }
  if (options.playerDids.length === 32) {
    for (const clubId of Object.keys(options.clubGovernors)) {
      if (expected.filter((right) => right.clubId === clubId).length !== 8)
        throw new EconomyWorkflowAuthorizationError(
          "Premier cap certificate must contain eight active rights per club",
        );
    }
  }
}

function expectedSignerDids(
  options: EconomyRehearsalOptions,
  eventType: EconomyWorkflowEventType,
  payload: EconomyWorkflowPayload,
): readonly string[] {
  if (eventType === "CapSheetCertified") {
    const command = EconomyInitializationPayloadSchema.parse(payload).command;
    return [
      options.capAuthorityDid,
      ...command.clubIds.map((clubId) => options.clubGovernors[clubId]!),
    ];
  }
  if (eventType === "ContractTraded") {
    const { transaction } = ContractTradePayloadSchema.parse(payload).command;
    return [
      options.clubGovernors[transaction.fromTeamId]!,
      options.clubGovernors[transaction.toTeamId]!,
      transaction.playerDid,
      options.capAuthorityDid,
    ];
  }
  if (eventType === "ContractWaived") {
    const command = ContractWaiverPayloadSchema.parse(payload).command;
    const governor = options.clubGovernors[command.transaction.fromTeamId]!;
    return command.authorization.mode === "MUTUAL"
      ? [governor, command.transaction.playerDid, options.capAuthorityDid]
      : [governor, options.capAuthorityDid];
  }
  if (eventType === "FreeAgencyOpened")
    return [FreeAgencyOpenPayloadSchema.parse(payload).command.playerDid];
  if (eventType === "FreeAgentSigned") {
    const { transaction } =
      FreeAgentSigningPayloadSchema.parse(payload).command;
    return [
      options.clubGovernors[transaction.toTeamId]!,
      transaction.playerDid,
      options.capAuthorityDid,
    ];
  }
  return [EconomyInspectionPayloadSchema.parse(payload).command.requestedByDid];
}

function payloadSignerDids(
  eventType: EconomyWorkflowEventType,
  payload: EconomyWorkflowPayload,
): readonly string[] | null {
  switch (eventType) {
    case "ContractTraded":
      return ContractTradePayloadSchema.parse(payload).command.authorizedByDids;
    case "ContractWaived":
      return ContractWaiverPayloadSchema.parse(payload).command.authorization
        .authorizedByDids;
    case "FreeAgentSigned":
      return FreeAgentSigningPayloadSchema.parse(payload).command
        .authorizedByDids;
    default:
      return null;
  }
}

async function careerAuthority(
  options: EconomyRehearsalOptions,
  did: string,
  at: string,
  currentAt?: string,
): Promise<CandidateCareerAuthority> {
  const configured = options.admittedAgents.get(did);
  if (
    configured === undefined ||
    !configured.allowedAggregateTypes.includes(ECONOMY_WORKFLOW_AGGREGATE_TYPE)
  ) {
    throw new EconomyWorkflowAuthorizationError(
      "Economy signer lacks configured aggregate scope",
    );
  }
  const historical = await readCandidateCareerAuthority(
    candidateOptions(options),
    did,
    at,
  );
  if (
    historical.signingAddress.toLowerCase() !==
    configured.signerAddress.toLowerCase()
  ) {
    throw new EconomyWorkflowAuthorizationError(
      "Economy signer registry aliases its career authority",
    );
  }
  if (currentAt !== undefined) {
    await requireCareerOperational(options, did, currentAt);
  }
  return historical;
}

async function verifySignatures(
  options: EconomyRehearsalOptions,
  event: CanonicalEvent,
  eventType: EconomyWorkflowEventType,
  payload: EconomyWorkflowPayload,
  signatures: readonly string[],
  currentAt?: string,
): Promise<void> {
  const expectedDids = expectedSignerDids(options, eventType, payload);
  if (
    expectedDids.some((did) => did === undefined) ||
    new Set(expectedDids).size !== expectedDids.length ||
    signatures.length !== expectedDids.length ||
    event.actorDid !== expectedDids[0]
  ) {
    throw new EconomyWorkflowAuthorizationError(
      "Economy command lacks its exact ordered independent careers",
    );
  }
  const payloadDids = payloadSignerDids(eventType, payload);
  if (
    payloadDids !== null &&
    sha256Commitment(payloadDids) !== sha256Commitment(expectedDids)
  ) {
    throw new EconomyWorkflowAuthorizationError(
      "Economy command signer roster is not the configured authority",
    );
  }
  const authorities = await Promise.all(
    expectedDids.map((did) =>
      careerAuthority(options, did, event.timestamp, currentAt),
    ),
  );
  const addresses = authorities.map(({ signingAddress }) =>
    signingAddress.toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length)
    throw new EconomyWorkflowAuthorizationError(
      "Economy command signers alias a career key",
    );
  await Promise.all(
    authorities.map(async (authority, index) => {
      try {
        const recovered = await recoverCanonicalEventSigner(
          options.domain,
          event,
          signatures[index] as Hex,
        );
        if (recovered.toLowerCase() !== authority.signingAddress.toLowerCase())
          throw new Error("wrong signer");
      } catch {
        throw new EconomyWorkflowAuthorizationError(
          "Economy signature does not match its ordered career",
        );
      }
    }),
  );
}

async function verifyExternalAuthority(
  options: EconomyRehearsalOptions,
  eventType: EconomyWorkflowEventType,
  payload: EconomyWorkflowPayload,
): Promise<void> {
  const authorityDigest = contractClubAuthoritySnapshotDigest(
    options.clubGovernors,
  );
  if (eventType === "CapSheetCertified") {
    const command = EconomyInitializationPayloadSchema.parse(payload).command;
    if (
      command.economyId !== options.economyId ||
      command.competitionId !== options.competitionId ||
      command.seasonId !== options.seasonId ||
      command.clubIds.join("\u0000") !==
        Object.keys(options.clubGovernors).sort().join("\u0000") ||
      command.certification.certifiedByDid !== options.capAuthorityDid ||
      command.certification.clubAuthoritySnapshotDigest !== authorityDigest
    ) {
      throw new EconomyWorkflowAuthorizationError(
        "Initial cap certificate is outside the configured season economy",
      );
    }
    await requireInitialSources(options, command.initialRights);
    return;
  }
  if (eventType === "ContractTraded") {
    const command = ContractTradePayloadSchema.parse(payload).command;
    if (
      command.certification.certifiedByDid !== options.capAuthorityDid ||
      command.certification.clubAuthoritySnapshotDigest !== authorityDigest
    ) {
      throw new EconomyWorkflowAuthorizationError(
        "Trade lacks configured cap authority",
      );
    }
    await requireTradeAccessEvidence(
      command.accessEvidence,
      options.tradeAccessEvidence,
    );
    return;
  }
  if (eventType === "ContractWaived") {
    const command = ContractWaiverPayloadSchema.parse(payload).command;
    if (
      command.certification.certifiedByDid !== options.capAuthorityDid ||
      command.certification.clubAuthoritySnapshotDigest !== authorityDigest
    ) {
      throw new EconomyWorkflowAuthorizationError(
        "Waiver lacks configured cap authority",
      );
    }
    if (command.authorization.mode === "ADVERSE_RULING") {
      await requireAdverseContractCase(
        {
          evidence: command.authorization.evidence,
          playerDid: command.transaction.playerDid,
          actionCommitment: adverseWaiverActionCommitment({
            transactionId: command.transaction.transactionId,
            playerDid: command.transaction.playerDid,
            fromTeamId: command.transaction.fromTeamId,
            sourceTransactionId: command.sourceTransactionId,
            waiverChargeCourtCredits: command.transaction.courtCredits,
            effectiveAt: command.transaction.effectiveAt,
          }),
          authorizedAt: command.completedAt,
        },
        {
          adverseContractCase: (caseId, headEventHash) =>
            readAdverseContractCase(
              caseOptions(options),
              caseId,
              headEventHash,
            ),
        },
      );
    }
    return;
  }
  if (eventType === "FreeAgencyOpened") {
    const command = FreeAgencyOpenPayloadSchema.parse(payload).command;
    if (
      command.windowOpensAt !== options.freeAgencyWindow.opensAt ||
      command.windowClosesAt !== options.freeAgencyWindow.closesAt
    ) {
      throw new EconomyWorkflowAuthorizationError(
        "Free agency command substitutes the public configured window",
      );
    }
    return;
  }
  if (eventType === "FreeAgentSigned") {
    const command = FreeAgentSigningPayloadSchema.parse(payload).command;
    if (
      command.certification.certifiedByDid !== options.capAuthorityDid ||
      command.certification.clubAuthoritySnapshotDigest !== authorityDigest
    ) {
      throw new EconomyWorkflowAuthorizationError(
        "Free-agent signing lacks configured cap authority",
      );
    }
  }
}

async function replayEconomyAggregate(
  options: EconomyRehearsalOptions,
): Promise<EconomyAggregate> {
  const records = await options.store.readAggregate(
    ECONOMY_WORKFLOW_AGGREGATE_TYPE,
    options.economyId,
  );
  let snapshot: EconomyWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== ECONOMY_WORKFLOW_AGGREGATE_TYPE ||
      event.aggregateId !== options.economyId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isEventType(event.eventType) ||
      event.schemaDigest !== ECONOMY_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      !Number.isFinite(occurredAt) ||
      occurredAt < previousTimestamp
    ) {
      throw new EconomyWorkflowAuthorizationError(
        "Stored economy aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new EconomyWorkflowAuthorizationError(
        "Stored economy event content is invalid",
      );
    }
    let payload: EconomyWorkflowPayload;
    try {
      payload = parseEconomyWorkflowPayload(event.eventType, event.payload);
    } catch {
      throw new EconomyWorkflowAuthorizationError(
        "Stored economy payload is malformed",
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
    try {
      snapshot = applyEconomyWorkflowTransition(snapshot, event, payload);
    } catch (error) {
      if (error instanceof EconomyWorkflowAuthorizationError) throw error;
      throw new EconomyWorkflowAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored economy transition is invalid",
      );
    }
    if (economyWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new EconomyWorkflowAuthorizationError(
        "Stored economy state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  if (snapshot !== null)
    await requireInitialSources(options, snapshot.initialContractSources);
  return { records, snapshot };
}

function appendInput(
  options: EconomyRehearsalOptions,
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

function economyError(error: unknown): { status: number; code: string } {
  if (
    error instanceof EconomyWorkflowAuthorizationError ||
    error instanceof CandidateAuthorizationError ||
    error instanceof CareerExitedError
  ) {
    return { status: 403, code: "economy_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof EconomyWorkflowValidationError
  ) {
    return { status: 400, code: "invalid_economy_request" };
  }
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "economy_aggregate_conflict" };
  }
  return { status: 500, code: "economy_failure" };
}

export function installEconomyRehearsalRoutes(
  app: FastifyInstance,
  options: EconomyRehearsalOptions,
): void {
  const clubIds = Object.keys(options.clubGovernors).sort();
  const signerDids = [
    options.capAuthorityDid,
    ...Object.values(options.clubGovernors),
    ...options.playerDids,
  ];
  const freeAgencyOpensAt = canonicalInstant(options.freeAgencyWindow.opensAt);
  const freeAgencyClosesAt = canonicalInstant(
    options.freeAgencyWindow.closesAt,
  );
  if (
    clubIds.length !== 4 ||
    new Set(Object.values(options.clubGovernors)).size !== 4 ||
    options.playerDids.length === 0 ||
    new Set(options.playerDids).size !== options.playerDids.length ||
    new Set(signerDids).size !== signerDids.length ||
    freeAgencyOpensAt >= freeAgencyClosesAt
  ) {
    throw new EconomyWorkflowValidationError(
      "Economy configuration requires four independent clubs, players, cap authority, and a valid free-agency window",
    );
  }
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: EconomyWorkflowEventType;
  }> = [
    { path: "/v1/contracts/cap/certify", eventType: "CapSheetCertified" },
    { path: "/v1/contracts/trades/complete", eventType: "ContractTraded" },
    { path: "/v1/contracts/waivers/complete", eventType: "ContractWaived" },
    {
      path: "/v1/contracts/free-agency/open",
      eventType: "FreeAgencyOpened",
    },
    {
      path: "/v1/contracts/free-agency/sign",
      eventType: "FreeAgentSigned",
    },
    { path: "/v1/contracts/economy/inspect", eventType: "EconomyInspected" },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalMultiCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new EconomyWorkflowValidationError(
            "Economy event content is invalid",
          );
        }
        if (
          event.aggregateType !== ECONOMY_WORKFLOW_AGGREGATE_TYPE ||
          event.aggregateId !== options.economyId ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== ECONOMY_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new EconomyWorkflowAuthorizationError(
            "Economy event is outside route authority",
          );
        }
        const payload = parseEconomyWorkflowPayload(
          route.eventType,
          event.payload,
        );
        const aggregate = await replayEconomyAggregate(options);
        const currentTime = now();
        const currentAt = new Date(currentTime).toISOString();
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        await verifySignatures(
          options,
          event,
          route.eventType,
          payload,
          parsed.signatures,
          currentAt,
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
              "Economy aggregate version already has different content",
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
          )
            throw new EconomyWorkflowValidationError(
              "Economy event timestamp is outside the accepted window",
            );
          if (
            event.previousEventHash !==
            (aggregate.records.at(-1)?.eventHash ?? null)
          ) {
            throw new HashChainConflictError(
              "Economy previous event hash is invalid",
            );
          }
          responseSnapshot = applyEconomyWorkflowTransition(
            aggregate.snapshot,
            event,
            payload,
          );
          if (economyWorkflowStateRoot(responseSnapshot) !== event.stateRoot)
            throw new EconomyWorkflowValidationError(
              "Economy state root is invalid",
            );
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisEconomy: false,
          currency: "NONCASH_COURT_CREDITS",
          playerTradeConsentRequired: true,
          capCertified: route.eventType !== "FreeAgencyOpened",
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        if (route.eventType === "EconomyInspected")
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            economy: responseSnapshot,
          });
        return reply.code(result.duplicate ? 200 : 201).send(response);
      } catch (error) {
        const response = economyError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }
}
