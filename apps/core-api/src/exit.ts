import {
  ExitWorkflowError,
  ExitWorkflowPayloadSchemas,
  applyExitWorkflowTransition,
  careerExitState,
  exitWorkflowStateRoot,
  type ExitWorkflowEventType,
  type ExitWorkflowSnapshot,
  type SignedExitPackage,
} from "@abl/career";
import {
  CanonicalConflictError,
  HashChainConflictError,
  IdempotencyConflictError,
  NonceReplayError,
} from "@abl/database";
import {
  sha256Commitment,
  verifyEventContent,
  type CanonicalEvent,
} from "@abl/recognition";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  SignedCanonicalCommandSchema,
  materializeCanonicalEvent,
} from "./canonical-command.js";
import {
  readCandidateCareerAuthority,
  type CandidateRehearsalOptions,
} from "./candidates.js";
import {
  readContinuityExitManifest,
  type ContinuityRehearsalOptions,
} from "./continuity.js";
import type {
  ExitPackagePortabilityVerifier,
  ExitRestorationEvidence,
} from "./exit-portability.js";
import {
  EXIT_AGGREGATE_TYPE,
  EXIT_WORKFLOW_SCHEMA_DIGEST,
  ExitAuthorizationError,
  exitStatusError,
  parseExitPayload,
  replayExitAggregate,
  requireExitEventAuthority,
  verifyExitNestedArtifact,
  type ExitStatusOptions,
} from "./exit-status.js";
import { readMemoryExitExport, type MemoryRehearsalOptions } from "./memory.js";

class ExitValidationError extends Error {
  public override readonly name = "ExitValidationError";
}

class ExitPortabilityVerificationError extends Error {
  public override readonly name = "ExitPortabilityVerificationError";
}

export interface ExitRehearsalOptions extends ExitStatusOptions {
  memory: Pick<MemoryRehearsalOptions, "storageVerifier">;
  continuity: Pick<ContinuityRehearsalOptions, "recognizedImageDigests">;
  portabilityVerifier: ExitPackagePortabilityVerifier;
}

function candidateOptions(
  options: ExitRehearsalOptions,
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

function memoryOptions(options: ExitRehearsalOptions): MemoryRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    candidateAdmission: options.candidateAdmission,
    storageVerifier: options.memory.storageVerifier,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

function continuityOptions(
  options: ExitRehearsalOptions,
): ContinuityRehearsalOptions {
  const common = {
    store: options.store,
    domain: options.domain,
    competitionId: options.competitionId,
    seasonId: options.seasonId,
    candidateAdmission: options.candidateAdmission,
    recognizedImageDigests: options.continuity.recognizedImageDigests,
  };
  return options.now === undefined ? common : { ...common, now: options.now };
}

async function validatePackageBindings(
  options: ExitRehearsalOptions,
  packageValue: SignedExitPackage,
  at: string,
): Promise<void> {
  const [authority, memoryExport, continuity] = await Promise.all([
    readCandidateCareerAuthority(
      candidateOptions(options),
      packageValue.agentDid,
      at,
    ),
    readMemoryExitExport(memoryOptions(options), packageValue.agentDid),
    readContinuityExitManifest(
      continuityOptions(options),
      packageValue.agentDid,
    ),
  ]);
  if (
    packageValue.careerRecordCommitment !== authority.careerRecordCommitment ||
    packageValue.keyLineageCommitment !== authority.keyLineageCommitment ||
    packageValue.consentHistoryCommitment !==
      authority.consentHistoryCommitment ||
    packageValue.memoryExportCommitment !== memoryExport.exportCommitment ||
    packageValue.bodyManifestDigest !== continuity.bodyManifestDigest
  ) {
    throw new ExitValidationError(
      "Portable exit package does not bind current career state",
    );
  }
}

async function validateNewTransition(
  options: ExitRehearsalOptions,
  eventType: ExitWorkflowEventType,
  payload: ReturnType<typeof parseExitPayload>,
  current: ExitWorkflowSnapshot | null,
  at: string,
): Promise<void> {
  if (eventType === "ExitPackagePrepared") {
    const parsed =
      ExitWorkflowPayloadSchemas.ExitPackagePrepared.parse(payload);
    await validatePackageBindings(options, parsed.package, at);
    return;
  }
  if (eventType === "CareerExitRequested") {
    if (current === null || current.package === null)
      throw new ExitValidationError("Portable exit package is absent");
    await validatePackageBindings(options, current.package, at);
    const exit =
      ExitWorkflowPayloadSchemas.CareerExitRequested.parse(payload).exit;
    let evidence: ExitRestorationEvidence;
    try {
      evidence = await options.portabilityVerifier.verifyRestoration({
        agentDid: exit.agentDid,
        destinationEncryptionPublicKey:
          exit.destinationEncryptionPublicKey as `0x${string}`,
        package: current.package,
      });
    } catch {
      throw new ExitPortabilityVerificationError(
        "Portable exit clean-room restoration is unverified",
      );
    }
    if (
      evidence.cleanRoomRestored !== true ||
      evidence.verifierBundleCommitment !==
        current.package.verifierBundleCommitment ||
      evidence.encryptedPackageCommitment !==
        current.package.encryptedPackageCommitment
    ) {
      throw new ExitPortabilityVerificationError(
        "Portable exit restoration evidence does not match the package",
      );
    }
    return;
  }
  if (eventType === "ExitDeletionAttested") {
    if (current === null || current.package === null)
      throw new ExitValidationError("Portable exit package is absent");
    const attestation =
      ExitWorkflowPayloadSchemas.ExitDeletionAttested.parse(
        payload,
      ).attestation;
    try {
      await options.portabilityVerifier.verifyDeletion({
        agentDid: attestation.agentDid,
        package: current.package,
        attestation,
      });
    } catch {
      throw new ExitPortabilityVerificationError(
        "Portable exit deletion evidence is unverified",
      );
    }
  }
}

function appendInput(
  options: ExitRehearsalOptions,
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
    outboxTopic: "career.exit",
  };
}

function exitError(error: unknown): { status: number; code: string } {
  if (exitStatusError(error))
    return { status: 403, code: "exit_authorization_denied" };
  if (error instanceof ExitPortabilityVerificationError)
    return { status: 409, code: "exit_portability_unverified" };
  if (
    error instanceof z.ZodError ||
    error instanceof ExitWorkflowError ||
    error instanceof ExitValidationError
  ) {
    return { status: 400, code: "invalid_exit_request" };
  }
  if (error instanceof IdempotencyConflictError)
    return { status: 409, code: "idempotency_conflict" };
  if (error instanceof NonceReplayError)
    return { status: 409, code: "nonce_replay" };
  if (
    error instanceof CanonicalConflictError ||
    error instanceof HashChainConflictError
  ) {
    return { status: 409, code: "exit_aggregate_conflict" };
  }
  return { status: 500, code: "exit_failure" };
}

export function installExitRehearsalRoutes(
  app: FastifyInstance,
  options: ExitRehearsalOptions,
): void {
  const now = options.now ?? Date.now;
  const routes: ReadonlyArray<{
    path: string;
    eventType: ExitWorkflowEventType;
  }> = [
    { path: "/v1/exit/package", eventType: "ExitPackagePrepared" },
    { path: "/v1/exit/request", eventType: "CareerExitRequested" },
    { path: "/v1/exit/cancel", eventType: "CareerExitCancelled" },
    { path: "/v1/exit/attest-deletion", eventType: "ExitDeletionAttested" },
    { path: "/v1/exit/inspect", eventType: "ExitInspected" },
  ];

  for (const route of routes) {
    app.post(route.path, async (request, reply) => {
      try {
        const parsed = SignedCanonicalCommandSchema.parse(request.body);
        const event = materializeCanonicalEvent(parsed.event);
        try {
          verifyEventContent(event);
        } catch {
          throw new ExitValidationError(
            "Portable exit event content is invalid",
          );
        }
        if (
          event.actorDid !== event.aggregateId ||
          event.aggregateType !== EXIT_AGGREGATE_TYPE ||
          event.eventType !== route.eventType ||
          event.schemaDigest !== EXIT_WORKFLOW_SCHEMA_DIGEST
        ) {
          throw new ExitAuthorizationError(
            "Portable exit event is outside route authority",
          );
        }
        const payload = parseExitPayload(route.eventType, event.payload);
        const aggregate = await replayExitAggregate(options, event.actorDid);
        const currentTime = now();
        const currentAt = new Date(currentTime).toISOString();
        const existing = aggregate.records.find(
          (record) => record.aggregateVersion === event.aggregateVersion,
        );
        const authority = await requireExitEventAuthority(
          options,
          event,
          parsed.signatures[0]!,
          currentAt,
        );
        await verifyExitNestedArtifact(
          options,
          route.eventType,
          payload,
          authority,
          event.timestamp,
        );
        let responseSnapshot = aggregate.snapshot;
        if (existing !== undefined) {
          if (
            existing.eventHash !== event.eventHash ||
            existing.eventId !== event.eventId ||
            existing.idempotencyKey !== event.idempotencyKey
          ) {
            throw new CanonicalConflictError(
              "Portable exit aggregate version already has different content",
            );
          }
          if (
            route.eventType === "ExitInspected" &&
            existing !== aggregate.records.at(-1)
          ) {
            throw new CanonicalConflictError(
              "Historical exit inspection cannot return newer state",
            );
          }
        } else {
          const occurredAt = Date.parse(event.timestamp);
          const latestOccurredAt =
            aggregate.records.at(-1)?.occurredAt.getTime() ??
            Number.NEGATIVE_INFINITY;
          if (
            !Number.isFinite(occurredAt) ||
            event.timestamp !== new Date(occurredAt).toISOString() ||
            occurredAt < latestOccurredAt ||
            occurredAt > currentTime + 60_000
          ) {
            throw new ExitValidationError(
              "Portable exit timestamp is outside the accepted window",
            );
          }
          const previousHash = aggregate.records.at(-1)?.eventHash ?? null;
          if (event.previousEventHash !== previousHash)
            throw new HashChainConflictError(
              "Portable exit previous event hash is invalid",
            );
          await validateNewTransition(
            options,
            route.eventType,
            payload,
            aggregate.snapshot,
            currentAt,
          );
          responseSnapshot = applyExitWorkflowTransition(aggregate.snapshot, {
            agentDid: event.actorDid,
            aggregateVersion: event.aggregateVersion,
            eventType: route.eventType,
            payload,
            timestamp: event.timestamp,
          });
          if (exitWorkflowStateRoot(responseSnapshot) !== event.stateRoot)
            throw new ExitValidationError(
              "Portable exit state root is invalid",
            );
        }
        const result = await options.store.append(
          appendInput(options, event, parsed.signatures),
        );
        const response = {
          accepted: true,
          canonical: true,
          rehearsal: true,
          recognizedGenesisExit: false,
          livePlatformEvidenceVerified: false,
          sharedRecordsPreserved: true,
          penalty: null,
          eventId: result.eventId,
          eventHash: result.eventHash,
          aggregateVersion: result.aggregateVersion.toString(),
          duplicate: result.duplicate,
        };
        if (route.eventType === "ExitInspected") {
          return reply.code(result.duplicate ? 200 : 201).send({
            ...response,
            state: careerExitState(responseSnapshot, currentAt),
            exit: responseSnapshot,
          });
        }
        return reply.code(result.duplicate ? 200 : 201).send(response);
      } catch (error) {
        const response = exitError(error);
        return reply.code(response.status).send({ error: response.code });
      }
    });
  }

  app.post("/v1/exit/*", async (_request, reply) =>
    reply.code(503).send({
      error: "genesis_not_authorized",
      canonicalWriteAccepted: false,
      retryableAfterGenesis: true,
    }),
  );
}
