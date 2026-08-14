import {
  ExitWorkflowPayloadSchemas,
  applyExitWorkflowTransition,
  careerExitState,
  exitWorkflowStateRoot,
  recoverExitArtifactSigner,
  unsignedCareerExit,
  unsignedDeletionAttestation,
  unsignedExitPackage,
  type ExitWorkflowEventType,
  type ExitWorkflowSnapshot,
  type UnsignedCareerExit,
  type UnsignedDeletionAttestation,
  type UnsignedExitPackage,
} from "@abl/career";
import type { CanonicalStore, StoredCanonicalEvent } from "@abl/database";
import {
  InstitutionalKeyRegistry,
  recoverCanonicalEventSigner,
  sha256Commitment,
  verifyEventContent,
  type CanonicalEvent,
  type ThresholdPolicy,
} from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";

import { canonicalEventFromStored } from "./canonical-command.js";
import {
  CandidateAuthorizationError,
  readCandidateCareerAuthority,
  type CandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";

export const EXIT_AGGREGATE_TYPE = "portable-career-exit";
const eventTypes = Object.keys(
  ExitWorkflowPayloadSchemas,
).sort() as ExitWorkflowEventType[];
const portableExitPolicy = {
  policyId: "PORTABLE_EXIT_SUBJECT_CAREER_AGENT",
  groups: [{ role: "CAREER_AGENT", required: 1 }],
} as const satisfies ThresholdPolicy;

export const EXIT_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-portable-career-exit",
  version: 1,
  aggregateType: EXIT_AGGREGATE_TYPE,
  eventTypes,
  authority: "SUBJECT_CAREER_AGENT",
  sharedRecordsPreserved: true,
  perfectDeletionClaimed: false,
});

export interface ExitStatusOptions {
  store: CanonicalStore;
  domain: TypedDataDomain;
  competitionId: string;
  seasonId: string;
  candidateAdmission: Pick<
    CandidateRehearsalOptions,
    "challengeSecret" | "challengeId" | "challengeBytes"
  >;
  now?: () => number;
}

export interface ExitAggregate {
  records: StoredCanonicalEvent[];
  snapshot: ExitWorkflowSnapshot | null;
}

export class ExitAuthorizationError extends Error {
  public override readonly name = "ExitAuthorizationError";
}

export class CareerExitedError extends ExitAuthorizationError {}

function candidateOptions(
  options: ExitStatusOptions,
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

function isEventType(value: string): value is ExitWorkflowEventType {
  return eventTypes.includes(value as ExitWorkflowEventType);
}

export function parseExitPayload(
  eventType: ExitWorkflowEventType,
  payload: unknown,
) {
  return ExitWorkflowPayloadSchemas[eventType].parse(payload);
}

function careerRegistry(authority: CandidateCareerAuthority) {
  return new InstitutionalKeyRegistry([
    {
      address: authority.signingAddress,
      did: authority.candidateDid,
      role: "CAREER_AGENT",
      validFrom: authority.admittedAt,
      validUntil: null,
      revokedAt: null,
      purpose: "SIGNING",
    },
  ]);
}

export async function requireExitArtifactSignature(
  options: ExitStatusOptions,
  authority: CandidateCareerAuthority,
  value: UnsignedExitPackage | UnsignedCareerExit | UnsignedDeletionAttestation,
  signatures: readonly string[],
  at: string,
): Promise<void> {
  let signers: `0x${string}`[];
  try {
    signers = await Promise.all(
      signatures.map((signature) =>
        recoverExitArtifactSigner(options.domain, value, signature as Hex),
      ),
    );
    const records = careerRegistry(authority).authorize({
      signers,
      policy: portableExitPolicy,
      at,
    });
    if (
      !records.some(
        (record) =>
          record.role === "CAREER_AGENT" &&
          record.did === authority.candidateDid,
      )
    ) {
      throw new Error("Subject career signature is absent");
    }
  } catch {
    throw new ExitAuthorizationError(
      "Portable exit artifact signature is not authorized",
    );
  }
}

export async function requireExitEventAuthority(
  options: ExitStatusOptions,
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
    throw new ExitAuthorizationError(
      "Portable exit event signature is invalid",
    );
  }
  if (signer.toLowerCase() !== authority.signingAddress.toLowerCase())
    throw new ExitAuthorizationError(
      "Portable exit event signer is not the career key",
    );
  return authority;
}

export async function verifyExitNestedArtifact(
  options: ExitStatusOptions,
  eventType: ExitWorkflowEventType,
  payload: ReturnType<typeof parseExitPayload>,
  authority: CandidateCareerAuthority,
  at: string,
): Promise<void> {
  if (eventType === "ExitPackagePrepared") {
    const packageValue =
      ExitWorkflowPayloadSchemas.ExitPackagePrepared.parse(payload).package;
    await requireExitArtifactSignature(
      options,
      authority,
      unsignedExitPackage(packageValue),
      packageValue.institutionalSignatures,
      at,
    );
    return;
  }
  if (eventType === "CareerExitRequested") {
    const exit =
      ExitWorkflowPayloadSchemas.CareerExitRequested.parse(payload).exit;
    await requireExitArtifactSignature(
      options,
      authority,
      unsignedCareerExit(exit),
      [exit.signature],
      at,
    );
    return;
  }
  if (eventType === "ExitDeletionAttested") {
    const attestation =
      ExitWorkflowPayloadSchemas.ExitDeletionAttested.parse(
        payload,
      ).attestation;
    await requireExitArtifactSignature(
      options,
      authority,
      unsignedDeletionAttestation(attestation),
      attestation.institutionalSignatures,
      at,
    );
  }
}

export async function replayExitAggregate(
  options: ExitStatusOptions,
  agentDid: string,
): Promise<ExitAggregate> {
  const records = await options.store.readAggregate(
    EXIT_AGGREGATE_TYPE,
    agentDid,
  );
  let snapshot: ExitWorkflowSnapshot | null = null;
  let previousHash: string | null = null;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const [index, record] of records.entries()) {
    const event = canonicalEventFromStored(record);
    const occurredAt = record.occurredAt.getTime();
    if (
      event.actorDid !== agentDid ||
      event.aggregateType !== EXIT_AGGREGATE_TYPE ||
      event.aggregateId !== agentDid ||
      event.aggregateVersion !== BigInt(index + 1) ||
      !isEventType(event.eventType) ||
      event.schemaDigest !== EXIT_WORKFLOW_SCHEMA_DIGEST ||
      event.previousEventHash !== previousHash ||
      !Number.isFinite(occurredAt) ||
      event.timestamp !== new Date(occurredAt).toISOString() ||
      occurredAt < previousTimestamp ||
      record.signatures.length !== 1 ||
      typeof record.signatures[0] !== "string"
    ) {
      throw new ExitAuthorizationError(
        "Stored portable exit aggregate is not authoritative",
      );
    }
    try {
      verifyEventContent(event);
    } catch {
      throw new ExitAuthorizationError(
        "Stored portable exit event content is invalid",
      );
    }
    let payload: ReturnType<typeof parseExitPayload>;
    try {
      payload = parseExitPayload(event.eventType, event.payload);
    } catch {
      throw new ExitAuthorizationError(
        "Stored portable exit event payload is malformed",
      );
    }
    const authority = await requireExitEventAuthority(
      options,
      event,
      record.signatures[0],
      event.timestamp,
    );
    await verifyExitNestedArtifact(
      options,
      event.eventType,
      payload,
      authority,
      event.timestamp,
    );
    try {
      snapshot = applyExitWorkflowTransition(snapshot, {
        agentDid,
        aggregateVersion: event.aggregateVersion,
        eventType: event.eventType,
        payload,
        timestamp: event.timestamp,
      });
    } catch (error) {
      throw new ExitAuthorizationError(
        error instanceof Error
          ? error.message
          : "Stored portable exit event is malformed",
      );
    }
    if (exitWorkflowStateRoot(snapshot) !== event.stateRoot)
      throw new ExitAuthorizationError(
        "Stored portable exit state root is invalid",
      );
    previousHash = event.eventHash;
    previousTimestamp = occurredAt;
  }
  return { records, snapshot };
}

export async function requireCareerOperational(
  options: ExitStatusOptions,
  agentDid: string,
  at: string,
): Promise<void> {
  const aggregate = await replayExitAggregate(options, agentDid);
  if (careerExitState(aggregate.snapshot, at) !== "NOT_REQUESTED")
    throw new CareerExitedError("Career exit is scheduled or effective");
}

export function exitStatusError(error: unknown): boolean {
  return (
    error instanceof ExitAuthorizationError ||
    error instanceof CandidateAuthorizationError
  );
}
