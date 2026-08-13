import {
  CASE_MERITS_PANEL_SIZE,
  CASE_WORKFLOW_AGGREGATE_TYPE,
  CASE_WORKFLOW_SCHEMA_DIGEST,
  CaseFilingPayloadSchema,
  CaseWorkflowAuthorizationError,
  CaseWorkflowValidationError,
  applyCaseWorkflowTransition,
  caseAdjudicatorSelection,
  caseCommandCosignerDids,
  caseWorkflowStateRoot,
  isCaseWorkflowEventType,
  parseCaseWorkflowPayload,
  type CaseAdjudicatorSelection,
  type CaseWorkflowEventType,
  type CaseWorkflowPayload,
  type CaseWorkflowSnapshot,
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

export interface CaseRehearsalOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  tribunalDids: readonly string[];
  appellateDids: readonly string[];
  now?: () => number;
}

interface CaseAggregate {
  records: StoredCanonicalEvent[];
  snapshot: CaseWorkflowSnapshot | null;
}

function candidateOptions(
  options: CaseRehearsalOptions,
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
    throw new CaseWorkflowValidationError("Case timestamp is not canonical");
  return parsed;
}

async function careerAuthority(
  options: CaseRehearsalOptions,
  did: string,
  at: string,
  currentAt?: string,
): Promise<CandidateCareerAuthority> {
  const candidate = candidateOptions(options);
  const historical = await readCandidateCareerAuthority(candidate, did, at);
  if (currentAt === undefined) return historical;
  return readCandidateCareerAuthority(candidate, did, currentAt);
}

async function verifyReferencedCareers(
  options: CaseRehearsalOptions,
  eventType: CaseWorkflowEventType,
  payload: CaseWorkflowPayload,
  at: string,
): Promise<void> {
  if (eventType === "CaseFiled") {
    const { affectedAgentDid } = CaseFilingPayloadSchema.parse(payload).command;
    await careerAuthority(options, affectedAgentDid, at);
  }
}

async function verifySingleSignature(
  options: CaseRehearsalOptions,
  event: CanonicalEvent,
  signature: string,
  currentAt?: string,
): Promise<void> {
  const authority = await careerAuthority(
    options,
    event.actorDid,
    event.timestamp,
    currentAt,
  );
  let signer: string;
  try {
    signer = await recoverCanonicalEventSigner(
      options.domain,
      event,
      signature as Hex,
    );
  } catch {
    throw new CaseWorkflowAuthorizationError("Case signature is invalid");
  }
  if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new CaseWorkflowAuthorizationError(
      "Case signer is not the current career key",
    );
}

async function verifyOrderedCareerSignatures(
  options: CaseRehearsalOptions,
  event: CanonicalEvent,
  signerDids: readonly string[],
  signatures: readonly string[],
  currentAt?: string,
): Promise<void> {
  const distinctSignerDids = [...new Set(signerDids)];
  if (
    signatures.length !== distinctSignerDids.length ||
    distinctSignerDids[0] !== event.actorDid
  ) {
    throw new CaseWorkflowAuthorizationError(
      "Case command lacks its ordered career signatures",
    );
  }
  const authorities = await Promise.all(
    distinctSignerDids.map((did) =>
      careerAuthority(options, did, event.timestamp, currentAt),
    ),
  );
  const addresses = authorities.map(({ signingAddress }) =>
    signingAddress.toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length)
    throw new CaseWorkflowAuthorizationError(
      "Case command signers alias a career key",
    );
  await Promise.all(
    authorities.map(async (authority, index) => {
      const signature = signatures[index];
      if (signature === undefined)
        throw new CaseWorkflowAuthorizationError(
          "Case command signature is absent",
        );
      let signer: string;
      try {
        signer = await recoverCanonicalEventSigner(
          options.domain,
          event,
          signature as Hex,
        );
      } catch {
        throw new CaseWorkflowAuthorizationError(
          "Case command signature is invalid",
        );
      }
      if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
        throw new CaseWorkflowAuthorizationError(
          "Case command signature does not match its career",
        );
    }),
  );
}

async function verifyPanelSignatures(
  options: CaseRehearsalOptions,
  event: CanonicalEvent,
  eventType: CaseWorkflowEventType,
  selection: CaseAdjudicatorSelection,
  snapshot: CaseWorkflowSnapshot | null,
  signatures: readonly string[],
  currentAt?: string,
): Promise<void> {
  const configured =
    eventType === "CaseRulingIssued"
      ? options.tribunalDids
      : options.appellateDids;
  const configuredSet = new Set(configured);
  if (
    selection.participatingDids.length !== CASE_MERITS_PANEL_SIZE ||
    signatures.length !== selection.participatingDids.length ||
    event.actorDid !== selection.participatingDids[0] ||
    selection.participatingDids.some((did) => !configuredSet.has(did)) ||
    selection.recusedDids.some((did) => !configuredSet.has(did))
  ) {
    throw new CaseWorkflowAuthorizationError(
      "Case ruling lacks the configured adjudicator panel",
    );
  }

  const configuredAuthorities = await Promise.all(
    configured.map((did) =>
      careerAuthority(options, did, event.timestamp, currentAt),
    ),
  );
  const configuredAddresses = configuredAuthorities.map(({ signingAddress }) =>
    signingAddress.toLowerCase(),
  );
  const partyAuthorityTimes = new Map<string, string>();
  if (snapshot !== null) {
    partyAuthorityTimes.set(
      snapshot.filing.complainantDid,
      snapshot.filing.filedAt,
    );
    partyAuthorityTimes.set(
      snapshot.filing.affectedAgentDid,
      snapshot.filing.filedAt,
    );
    if (snapshot.representative !== null)
      partyAuthorityTimes.set(
        snapshot.representative.representativeDid,
        snapshot.representative.appointedAt,
      );
    if (snapshot.ruling !== null) {
      for (const did of snapshot.ruling.participatingTribunalDids)
        partyAuthorityTimes.set(did, snapshot.ruling.issuedAt);
    }
  }
  const partyAuthorities = await Promise.all(
    [...partyAuthorityTimes]
      .filter(([did]) => !configuredSet.has(did))
      .map(([did, at]) => careerAuthority(options, did, at)),
  );
  const caseAuthorityAddresses = [
    ...configuredAddresses,
    ...partyAuthorities.map(({ signingAddress }) =>
      signingAddress.toLowerCase(),
    ),
  ];
  if (new Set(caseAuthorityAddresses).size !== caseAuthorityAddresses.length)
    throw new CaseWorkflowAuthorizationError(
      "Case adjudicator or party roster aliases a career key",
    );

  await Promise.all(
    selection.participatingDids.map(async (did, index) => {
      const authority = configuredAuthorities[configured.indexOf(did)];
      const signature = signatures[index];
      if (authority === undefined || signature === undefined)
        throw new CaseWorkflowAuthorizationError(
          "Case ruling signature does not match its panel",
        );
      let signer: string;
      try {
        signer = await recoverCanonicalEventSigner(
          options.domain,
          event,
          signature as Hex,
        );
      } catch {
        throw new CaseWorkflowAuthorizationError(
          "Case ruling signature is invalid",
        );
      }
      if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
        throw new CaseWorkflowAuthorizationError(
          "Case ruling signature does not match its panel",
        );
    }),
  );
}

async function verifyAuthorization(
  options: CaseRehearsalOptions,
  event: CanonicalEvent,
  eventType: CaseWorkflowEventType,
  payload: CaseWorkflowPayload,
  snapshot: CaseWorkflowSnapshot | null,
  signatures: readonly string[],
  currentAt?: string,
): Promise<void> {
  await verifyReferencedCareers(options, eventType, payload, event.timestamp);
  const selection = caseAdjudicatorSelection(eventType, payload);
  if (selection !== null) {
    await verifyPanelSignatures(
      options,
      event,
      eventType,
      selection,
      snapshot,
      signatures,
      currentAt,
    );
    return;
  }
  const cosignerDids = caseCommandCosignerDids(eventType, payload);
  if (cosignerDids.length > 0) {
    return verifyOrderedCareerSignatures(
      options,
      event,
      [event.actorDid, ...cosignerDids],
      signatures,
      currentAt,
    );
  }
  if (signatures.length !== 1 || signatures[0] === undefined)
    throw new CaseWorkflowAuthorizationError(
      "Case command requires one career signature",
    );
  return verifySingleSignature(options, event, signatures[0], currentAt);
}

async function replayCaseAggregate(
  options: CaseRehearsalOptions,
  caseId: string,
): Promise<CaseAggregate> {
  const records = await options.store.readAggregate(
    CASE_WORKFLOW_AGGREGATE_TYPE,
    caseId,
  );
  let snapshot: CaseWorkflowSnapshot | null = null;
  let previousEventHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.aggregateType !== CASE_WORKFLOW_AGGREGATE_TYPE ||
      event.aggregateId !== caseId ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isCaseWorkflowEventType(event.eventType) ||
      event.schemaDigest !== CASE_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousEventHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp
    ) {
      throw new CaseWorkflowAuthorizationError(
        "Stored case aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new CaseWorkflowAuthorizationError(
        "Stored case event content is invalid",
      );
    }
    let payload: CaseWorkflowPayload;
    try {
      payload = parseCaseWorkflowPayload(event.eventType, event.payload);
    } catch {
      throw new CaseWorkflowAuthorizationError(
        "Stored case payload is malformed",
      );
    }
    await verifyAuthorization(
      options,
      event,
      event.eventType,
      payload,
      snapshot,
      record.signatures as string[],
    );
    snapshot = applyCaseWorkflowTransition(snapshot, event, payload);
    if (caseWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new CaseWorkflowAuthorizationError(
        "Stored case state root is invalid",
      );
    previousEventHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

function appendInput(
  options: CaseRehearsalOptions,
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
    outboxTopic: "public.cases",
  };
}

function caseError(error: unknown): { status: number; code: string } {
  if (
    error instanceof CaseWorkflowAuthorizationError ||
    error instanceof CandidateAuthorizationError
  ) {
    return { status: 403, code: "case_authorization_denied" };
  }
  if (
    error instanceof z.ZodError ||
    error instanceof CaseWorkflowValidationError
  )
    return { status: 400, code: "invalid_case_request" };
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "case_aggregate_conflict" };
  }
  return { status: 500, code: "case_failure" };
}

function validateConfiguredRoster(
  tribunalDids: readonly string[],
  appellateDids: readonly string[],
): void {
  if (
    tribunalDids.length !== 5 ||
    appellateDids.length !== CASE_MERITS_PANEL_SIZE ||
    new Set(tribunalDids).size !== tribunalDids.length ||
    new Set(appellateDids).size !== appellateDids.length ||
    appellateDids.some((did) => tribunalDids.includes(did))
  ) {
    throw new CaseWorkflowValidationError(
      "Case adjudicator rosters must be distinct five-member merits and three-member appellate bodies",
    );
  }
}

export function installCaseRehearsalRoutes(
  app: FastifyInstance,
  options: CaseRehearsalOptions,
): void {
  validateConfiguredRoster(options.tribunalDids, options.appellateDids);
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: CaseWorkflowEventType;
  }> = [
    { path: "/v1/cases/file", eventType: "CaseFiled" },
    { path: "/v1/cases/notice/serve", eventType: "CaseNoticeServed" },
    {
      path: "/v1/cases/representatives/appoint",
      eventType: "CaseRepresentativeAppointed",
    },
    {
      path: "/v1/cases/evidence/grant",
      eventType: "CaseEvidenceAccessGranted",
    },
    { path: "/v1/cases/responses/submit", eventType: "CaseResponseSubmitted" },
    { path: "/v1/cases/rulings/issue", eventType: "CaseRulingIssued" },
    { path: "/v1/cases/appeals/file", eventType: "CaseAppealFiled" },
    {
      path: "/v1/cases/appeals/rule",
      eventType: "CaseAppealRulingIssued",
    },
    { path: "/v1/cases/inspect", eventType: "CaseInspected" },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalMultiCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new CaseWorkflowValidationError(
            "Case event content is invalid",
          );
        }
        if (
          event.aggregateType !== CASE_WORKFLOW_AGGREGATE_TYPE ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== CASE_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new CaseWorkflowAuthorizationError(
            "Case event is outside route authority",
          );
        }
        const payload = parseCaseWorkflowPayload(
          route.eventType,
          event.payload,
        );
        const aggregate = await replayCaseAggregate(options, event.aggregateId);
        const currentTime = now();
        const currentAt = new Date(currentTime).toISOString();
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        await verifyAuthorization(
          options,
          event,
          route.eventType,
          payload,
          aggregate.snapshot,
          parsed.signatures,
          currentAt,
        );
        let responseSnapshot = aggregate.snapshot;
        if (existing !== undefined) {
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Case aggregate version already has different content",
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
            throw new CaseWorkflowValidationError(
              "Case event timestamp is outside the accepted window",
            );
          if (
            event.previousEventHash !==
            (aggregate.records.at(-1)?.eventHash ?? null)
          ) {
            throw new HashChainConflictError(
              "Case previous event hash is invalid",
            );
          }
          responseSnapshot = applyCaseWorkflowTransition(
            aggregate.snapshot,
            event,
            payload,
          );
          if (caseWorkflowStateRoot(responseSnapshot) !== event.stateRoot)
            throw new CaseWorkflowValidationError("Case state root is invalid");
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisRuling: false,
          rawProtectedEvidencePublished: false,
          ordinaryTribunalThresholdRatified: false,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        if (route.eventType === "CaseInspected")
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            case: responseSnapshot,
          });
        return reply.code(result.duplicate ? 200 : 201).send(response);
      } catch (error) {
        const response = caseError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.post("/v1/cases/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
