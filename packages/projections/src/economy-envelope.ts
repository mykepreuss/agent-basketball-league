import type { ProjectionOutboxEvent } from "@abl/database";
import {
  ECONOMY_WORKFLOW_AGGREGATE_TYPE,
  ECONOMY_WORKFLOW_EVENT_TYPES,
  ECONOMY_WORKFLOW_SCHEMA_DIGEST,
  EconomyInitializationPayloadSchema,
  EconomyInspectionPayloadSchema,
  EconomyWorkflowAuthorizationError,
  EconomyWorkflowValidationError,
  ContractTradePayloadSchema,
  ContractWaiverPayloadSchema,
  FreeAgencyOpenPayloadSchema,
  FreeAgentSigningPayloadSchema,
  adverseWaiverActionCommitment,
  contractClubAuthoritySnapshotDigest,
  parseEconomyWorkflowPayload,
  requireAdverseContractCase,
  requireTradeAccessEvidence,
  type EconomyWorkflowEventType,
  type EconomyWorkflowPayload,
  type TradeAccessEvidenceReader,
} from "@abl/institutions";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  type CanonicalEvent,
} from "@abl/recognition";
import { DidSchema, IsoDateTimeSchema, Sha256Schema } from "@abl/schemas";
import { z } from "zod";

import type { PublicCaseProjectionReader } from "./case-repository.js";
import type { PublicContractProjectionReader } from "./contract-repository.js";
import {
  assertDistinctProjectionSigners,
  ProjectionAuthorizationError,
  ProjectionValidationError,
  type ProjectionVerificationAuthority,
} from "./envelope.js";

const SignatureSchema = z.string().regex(/^0x[0-9a-f]{130}$/);
export const EconomyProjectionEventEnvelopeSchema = z.strictObject({
  version: z.literal("1.0.0"),
  topic: z.literal("public.contracts"),
  event: z.strictObject({
    eventId: z.uuid(),
    actorDid: DidSchema,
    nonce: z.string().min(1).max(78),
    idempotencyKey: z.uuid(),
    aggregateType: z.literal(ECONOMY_WORKFLOW_AGGREGATE_TYPE),
    aggregateId: z.string().min(1).max(320),
    aggregateVersion: z.string().regex(/^[1-9]\d*$/),
    eventType: z.enum(ECONOMY_WORKFLOW_EVENT_TYPES),
    previousEventHash: Sha256Schema.nullable(),
    payloadCommitment: Sha256Schema,
    payload: z.unknown(),
    stateRoot: Sha256Schema,
    schemaDigest: z.literal(ECONOMY_WORKFLOW_SCHEMA_DIGEST),
    timestamp: IsoDateTimeSchema,
    eventHash: Sha256Schema,
  }),
  signatures: z.array(SignatureSchema).min(1).max(5),
});

export type EconomyProjectionEventEnvelope = z.infer<
  typeof EconomyProjectionEventEnvelopeSchema
>;

export interface VerifiedEconomyProjectionEvent {
  envelope: EconomyProjectionEventEnvelope;
  event: CanonicalEvent;
  expectedVersion: string;
  payload: EconomyWorkflowPayload;
}

export interface EconomyProjectionVerificationAuthority
  extends ProjectionVerificationAuthority {
  economyId: string;
  competitionId: string;
  seasonId: string;
  contractClubGovernors: Readonly<Record<string, string>>;
  capAuthorityDid: string;
  playerDids: readonly string[];
  freeAgencyWindow: { opensAt: string; closesAt: string };
  tradeAccessEvidence: TradeAccessEvidenceReader;
  contractReader: PublicContractProjectionReader;
  caseReader: PublicCaseProjectionReader;
}

function canonicalEvent(
  envelope: EconomyProjectionEventEnvelope,
): CanonicalEvent {
  return {
    ...envelope.event,
    aggregateVersion: BigInt(envelope.event.aggregateVersion),
  } as CanonicalEvent;
}

function expectedSignerDids(
  authority: EconomyProjectionVerificationAuthority,
  eventType: EconomyWorkflowEventType,
  payload: EconomyWorkflowPayload,
): readonly string[] {
  if (eventType === "CapSheetCertified") {
    const command = EconomyInitializationPayloadSchema.parse(payload).command;
    return [
      authority.capAuthorityDid,
      ...command.clubIds.map(
        (clubId) => authority.contractClubGovernors[clubId]!,
      ),
    ];
  }
  if (eventType === "ContractTraded") {
    const { transaction } = ContractTradePayloadSchema.parse(payload).command;
    return [
      authority.contractClubGovernors[transaction.fromTeamId]!,
      authority.contractClubGovernors[transaction.toTeamId]!,
      transaction.playerDid,
      authority.capAuthorityDid,
    ];
  }
  if (eventType === "ContractWaived") {
    const command = ContractWaiverPayloadSchema.parse(payload).command;
    const governor =
      authority.contractClubGovernors[command.transaction.fromTeamId]!;
    return command.authorization.mode === "MUTUAL"
      ? [governor, command.transaction.playerDid, authority.capAuthorityDid]
      : [governor, authority.capAuthorityDid];
  }
  if (eventType === "FreeAgencyOpened")
    return [FreeAgencyOpenPayloadSchema.parse(payload).command.playerDid];
  if (eventType === "FreeAgentSigned") {
    const { transaction } =
      FreeAgentSigningPayloadSchema.parse(payload).command;
    return [
      authority.contractClubGovernors[transaction.toTeamId]!,
      transaction.playerDid,
      authority.capAuthorityDid,
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

function initialRightsFromPublicContracts(
  authority: EconomyProjectionVerificationAuthority,
) {
  const byPlayer = new Map(
    authority.contractReader
      .contracts()
      .map((projection) => [projection.playerDid, projection]),
  );
  return authority.playerDids
    .map((playerDid) => {
      const projection = byPlayer.get(playerDid);
      const active =
        projection?.contracts.filter(({ status }) => status === "ACTIVE") ?? [];
      if (active.length !== 1 || projection === undefined) return null;
      const record = active[0]!;
      if (record.consent === null || record.transaction.toTeamId === null)
        return null;
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
        origin: "INITIAL_CONTRACT" as const,
        sourceAggregateVersion: projection.aggregateVersion,
        sourceEventHash: projection.canonicalEventHash,
        sourceStateRoot: projection.stateRoot,
      };
    })
    .filter((right) => right !== null)
    .sort((left, right) => left.playerDid.localeCompare(right.playerDid));
}

async function verifyExternalAuthority(
  authority: EconomyProjectionVerificationAuthority,
  eventType: EconomyWorkflowEventType,
  payload: EconomyWorkflowPayload,
): Promise<void> {
  const authorityDigest = contractClubAuthoritySnapshotDigest(
    authority.contractClubGovernors,
  );
  if (eventType === "CapSheetCertified") {
    const command = EconomyInitializationPayloadSchema.parse(payload).command;
    const expectedRights = initialRightsFromPublicContracts(authority);
    if (
      command.economyId !== authority.economyId ||
      command.competitionId !== authority.competitionId ||
      command.seasonId !== authority.seasonId ||
      command.clubIds.join("\u0000") !==
        Object.keys(authority.contractClubGovernors).sort().join("\u0000") ||
      command.certification.certifiedByDid !== authority.capAuthorityDid ||
      command.certification.clubAuthoritySnapshotDigest !== authorityDigest ||
      expectedRights.length !== authority.playerDids.length ||
      sha256Commitment(expectedRights) !==
        sha256Commitment(command.initialRights)
    ) {
      throw new ProjectionAuthorizationError(
        "Economy projection cap certificate omits or substitutes authority",
      );
    }
    if (authority.playerDids.length === 32) {
      for (const clubId of Object.keys(authority.contractClubGovernors)) {
        if (
          expectedRights.filter((right) => right.clubId === clubId).length !== 8
        ) {
          throw new ProjectionAuthorizationError(
            "Premier economy projection lacks eight rights per club",
          );
        }
      }
    }
    return;
  }
  if (eventType === "ContractTraded") {
    const command = ContractTradePayloadSchema.parse(payload).command;
    if (
      command.certification.certifiedByDid !== authority.capAuthorityDid ||
      command.certification.clubAuthoritySnapshotDigest !== authorityDigest
    ) {
      throw new ProjectionAuthorizationError(
        "Economy projection trade lacks cap authority",
      );
    }
    await requireTradeAccessEvidence(
      command.accessEvidence,
      authority.tradeAccessEvidence,
    );
    return;
  }
  if (eventType === "ContractWaived") {
    const command = ContractWaiverPayloadSchema.parse(payload).command;
    if (
      command.certification.certifiedByDid !== authority.capAuthorityDid ||
      command.certification.clubAuthoritySnapshotDigest !== authorityDigest
    ) {
      throw new ProjectionAuthorizationError(
        "Economy projection waiver lacks cap authority",
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
          adverseContractCase: async (caseId, headEventHash) => {
            const projection = authority.caseReader.caseAtHead(
              caseId,
              headEventHash,
            );
            if (projection === null) return null;
            const {
              recordType: _recordType,
              state: _state,
              canonical: _canonical,
              verification: _verification,
              processStatus: _processStatus,
              aggregateVersion,
              canonicalEventHash,
              stateRoot,
              projectedAt: _projectedAt,
              ...snapshot
            } = projection;
            return {
              snapshot,
              aggregateVersion,
              headEventHash: canonicalEventHash,
              stateRoot,
            };
          },
        },
      );
    }
    return;
  }
  if (eventType === "FreeAgencyOpened") {
    const command = FreeAgencyOpenPayloadSchema.parse(payload).command;
    if (
      command.windowOpensAt !== authority.freeAgencyWindow.opensAt ||
      command.windowClosesAt !== authority.freeAgencyWindow.closesAt
    ) {
      throw new ProjectionAuthorizationError(
        "Economy projection substitutes the public free-agency window",
      );
    }
    return;
  }
  if (eventType === "FreeAgentSigned") {
    const command = FreeAgentSigningPayloadSchema.parse(payload).command;
    if (
      command.certification.certifiedByDid !== authority.capAuthorityDid ||
      command.certification.clubAuthoritySnapshotDigest !== authorityDigest
    ) {
      throw new ProjectionAuthorizationError(
        "Economy projection signing lacks cap authority",
      );
    }
  }
}

export function economyProjectionEnvelopeFromOutbox(
  event: ProjectionOutboxEvent,
): EconomyProjectionEventEnvelope {
  if (
    event.topic !== "public.contracts" ||
    event.aggregateType !== ECONOMY_WORKFLOW_AGGREGATE_TYPE ||
    !ECONOMY_WORKFLOW_EVENT_TYPES.includes(
      event.eventType as EconomyWorkflowEventType,
    )
  ) {
    throw new ProjectionValidationError(
      "Outbox event is not an admissible signed economy event",
    );
  }
  const parsed = EconomyProjectionEventEnvelopeSchema.safeParse({
    version: "1.0.0",
    topic: event.topic,
    event: {
      eventId: event.eventId,
      actorDid: event.actorDid,
      nonce: event.nonce,
      idempotencyKey: event.idempotencyKey,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion.toString(),
      eventType: event.eventType,
      previousEventHash: event.previousEventHash,
      payloadCommitment: event.payloadCommitment,
      payload: event.payload,
      stateRoot: event.stateRoot,
      schemaDigest: event.payloadSchemaDigest,
      timestamp: event.occurredAt.toISOString(),
      eventHash: event.eventHash,
    },
    signatures: event.signatures,
  });
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Outbox economy event cannot be encoded as a projection envelope",
    );
  return parsed.data;
}

export async function verifyEconomyProjectionEvent(
  input: unknown,
  authority: EconomyProjectionVerificationAuthority,
): Promise<VerifiedEconomyProjectionEvent> {
  assertDistinctProjectionSigners(authority);
  const parsed = EconomyProjectionEventEnvelopeSchema.safeParse(input);
  if (!parsed.success)
    throw new ProjectionValidationError(
      "Economy projection envelope is malformed",
    );
  const envelope = parsed.data;
  const event = canonicalEvent(envelope);
  let payload: EconomyWorkflowPayload;
  try {
    payload = parseEconomyWorkflowPayload(
      envelope.event.eventType,
      envelope.event.payload,
    );
  } catch {
    throw new ProjectionValidationError(
      "Economy projection payload is malformed",
    );
  }
  const signerDids = expectedSignerDids(
    authority,
    envelope.event.eventType,
    payload,
  );
  if (
    signerDids.some((did) => did === undefined) ||
    new Set(signerDids).size !== signerDids.length ||
    envelope.signatures.length !== signerDids.length ||
    envelope.event.actorDid !== signerDids[0]
  ) {
    throw new ProjectionAuthorizationError(
      "Economy projection lacks its exact ordered careers",
    );
  }
  const payloadDids = payloadSignerDids(envelope.event.eventType, payload);
  if (
    payloadDids !== null &&
    sha256Commitment(payloadDids) !== sha256Commitment(signerDids)
  ) {
    throw new ProjectionAuthorizationError(
      "Economy projection signer roster is not configured authority",
    );
  }
  const registered = signerDids.map((did) => authority.admittedAgents.get(did));
  if (
    registered.some(
      (entry) =>
        entry === undefined ||
        !entry.allowedAggregateTypes.includes(ECONOMY_WORKFLOW_AGGREGATE_TYPE),
    )
  ) {
    throw new ProjectionAuthorizationError(
      "Economy projection signer lacks aggregate scope",
    );
  }
  const addresses = registered.map((entry) =>
    entry!.signerAddress.toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length)
    throw new ProjectionAuthorizationError(
      "Economy projection signers alias a career key",
    );
  await Promise.all(
    registered.map(async (entry, index) => {
      try {
        const recovered = await recoverCanonicalEventSigner(
          authority.domain,
          event,
          envelope.signatures[index] as `0x${string}`,
        );
        if (recovered.toLowerCase() !== entry!.signerAddress.toLowerCase())
          throw new Error("wrong signer");
      } catch {
        throw new ProjectionAuthorizationError(
          "Economy projection signature does not match its career",
        );
      }
    }),
  );
  try {
    await verifyExternalAuthority(authority, envelope.event.eventType, payload);
  } catch (error) {
    if (
      error instanceof ProjectionAuthorizationError ||
      error instanceof EconomyWorkflowAuthorizationError
    ) {
      throw new ProjectionAuthorizationError(error.message);
    }
    if (error instanceof EconomyWorkflowValidationError)
      throw new ProjectionValidationError(error.message);
    throw error;
  }
  return {
    envelope,
    event,
    expectedVersion: (event.aggregateVersion - 1n).toString(),
    payload,
  };
}
