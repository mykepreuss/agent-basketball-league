import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ReleaseWorkflowAuthorizationError,
  ReleaseProposalPayloadSchema,
  ReleaseApprovalPayloadSchema,
  applyReleaseWorkflowTransition,
  authorizedReleaseManifest,
  releaseWorkflowStateRoot,
  requireRegisteredReleaseVerifierResult,
  requireReleaseRatifications,
  type ReleaseManifest,
  type ReleaseApprovalCommand,
  type ReleaseRatificationReader,
  type ReleaseWorkflowSnapshot,
  type ReleaseVerifierResultReader,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";
import type {
  ReleaseProjectionEventEnvelope,
  VerifiedReleaseProjectionEvent,
} from "./release-envelope.js";

export interface PublicReleaseProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  recognizedGenesisRelease: false;
  baseRecognition: "NOT_SUBMITTED";
  releaseId: string;
  workflowAggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  manifest: ReleaseManifest;
  authorizationProofs: readonly PublicReleaseApprovalProof[];
  authorizedAt: string;
  projectedAt: string;
}

export interface PublicReleaseApprovalProof {
  command: ReleaseApprovalCommand;
  authorizationEventHash: `0x${string}`;
  signature: `0x${string}`;
  signerAddress: `0x${string}`;
}

export interface ReleaseProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicReleaseProjection | null;
  authorization: ReleaseProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicReleaseProjectionReader {
  refresh(): Promise<void>;
  releases(): readonly PublicReleaseProjection[];
}

export interface PublicReleaseProjectionWriter {
  publish(
    authorization: ReleaseProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ReleaseProjectionRecord>;
}

export interface PublicReleaseProjectionRepositoryOptions
  extends ReleaseRatificationReader,
    ReleaseVerifierResultReader {
  verifyAuthorization: (
    authorization: ReleaseProjectionEventEnvelope,
  ) => Promise<VerifiedReleaseProjectionEvent>;
  now?: () => Date;
}

interface ReleaseReplayState {
  snapshot: ReleaseWorkflowSnapshot;
  approvalProofs: PublicReleaseApprovalProof[];
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<ReleaseProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  ) {
    throw new Error("Release projection timestamp is not canonical");
  }
  return value;
}

async function advanceRelease(
  current: ReleaseReplayState | undefined,
  verified: VerifiedReleaseProjectionEvent,
  ratifications: ReleaseRatificationReader,
  verifierResults: ReleaseVerifierResultReader,
): Promise<ReleaseReplayState> {
  if (verified.event.eventType === "ReleaseProposed") {
    const proposal = ReleaseProposalPayloadSchema.parse(verified.payload);
    await requireRegisteredReleaseVerifierResult(
      proposal.manifest,
      proposal.verifierResult,
      verifierResults,
    );
  }
  const snapshot = applyReleaseWorkflowTransition(
    current?.snapshot ?? null,
    verified.event,
    verified.payload,
  );
  if (releaseWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
    throw new Error("Public release projection state root is invalid");
  const approvalProofs = [...(current?.approvalProofs ?? [])];
  if (verified.event.eventType === "ReleaseApproved") {
    approvalProofs.push({
      command: structuredClone(
        ReleaseApprovalPayloadSchema.parse(verified.payload).command,
      ),
      authorizationEventHash: verified.event.eventHash,
      signature: verified.envelope.signatures[0]! as `0x${string}`,
      signerAddress: verified.signerAddresses[0]!,
    });
  }
  if (verified.event.eventType === "ReleaseAuthorized")
    await requireReleaseRatifications(snapshot, ratifications);
  return { snapshot, approvalProofs };
}

function publicProjection(
  state: ReleaseReplayState,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicReleaseProjection | null {
  if (state.snapshot.authorizedAt === null) return null;
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    recognizedGenesisRelease: false,
    baseRecognition: "NOT_SUBMITTED",
    releaseId: state.snapshot.releaseId,
    workflowAggregateVersion: state.snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    manifest: authorizedReleaseManifest(
      state.snapshot,
      state.approvalProofs.map(({ signature }) => signature),
    ),
    authorizationProofs: structuredClone(state.approvalProofs),
    authorizedAt: state.snapshot.authorizedAt,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

export class FilePublicReleaseProjectionRepository
  implements PublicReleaseProjectionReader, PublicReleaseProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicReleaseProjectionRepositoryOptions["verifyAuthorization"];
  readonly #ratifications: ReleaseRatificationReader;
  readonly #verifierResults: ReleaseVerifierResultReader;
  readonly #now: () => Date;
  readonly #records: ReleaseProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #states = new Map<string, ReleaseReplayState>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicReleaseProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#ratifications = {
      releaseRatification: options.releaseRatification,
    };
    this.#verifierResults = {
      releaseVerifierResult: options.releaseVerifierResult,
    };
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: ReleaseProjectionEventEnvelope,
  ): Promise<VerifiedReleaseProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public release authorization is invalid");
    }
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.#operationTail;
    let release!: () => void;
    this.#operationTail = new Promise<void>((resolveOperation) => {
      release = resolveOperation;
    });
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  public async initialize(): Promise<void> {
    await mkdir(join(this.#root, "release-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "release-records");
      const records: ReleaseProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const states = new Map<string, ReleaseReplayState>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as ReleaseProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const releaseId = verified.event.aggregateId;
        const priorState = states.get(releaseId);
        if (
          record.cursor !== records.length ||
          filename !== `${String(record.cursor).padStart(12, "0")}.json` ||
          record.previousRecordHash !== (priorRecord?.recordHash ?? null) ||
          record.recordHash !==
            recordHash({
              cursor: record.cursor,
              previousRecordHash: record.previousRecordHash,
              projection: record.projection,
              authorization: record.authorization,
            }) ||
          eventCursors.has(verified.event.eventHash) ||
          verified.event.previousEventHash !==
            (lastEventHashes.get(releaseId) ?? null)
        ) {
          throw new Error("Public release chain is corrupt or noncanonical");
        }
        let state: ReleaseReplayState;
        try {
          state = await advanceRelease(
            priorState,
            verified,
            this.#ratifications,
            this.#verifierResults,
          );
        } catch (error) {
          if (error instanceof ReleaseWorkflowAuthorizationError) throw error;
          throw new Error("Public release transition is invalid");
        }
        const expected = publicProjection(
          state,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection?.projectedAt ??
            record.authorization.event.timestamp,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public release projection does not match its authorization",
          );

        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        states.set(releaseId, state);
        lastEventHashes.set(releaseId, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#states.clear();
      for (const [releaseId, state] of states)
        this.#states.set(releaseId, state);
      this.#lastEventHashes.clear();
      for (const [releaseId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(releaseId, eventHash);
    });
  }

  public async publish(
    authorization: ReleaseProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ReleaseProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const releaseId = verified.event.aggregateId;
      const priorState = this.#states.get(releaseId);
      const actual = BigInt(priorState?.snapshot.version ?? 0);
      const claimedExpected = parseVersion(
        expectedVersion ?? verified.expectedVersion,
        "Expected version",
      );
      if (
        actual !== claimedExpected ||
        verified.event.aggregateVersion !== claimedExpected + 1n
      ) {
        throw new ProjectionVersionConflictError(
          `Expected release version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(releaseId) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Release previous event hash is invalid",
        );
      }
      const state = await advanceRelease(
        priorState,
        verified,
        this.#ratifications,
        this.#verifierResults,
      );
      const projection = publicProjection(
        state,
        verified.event.eventHash,
        verified.event.stateRoot,
        projectedAt ?? this.#now().toISOString(),
      );
      const priorRecord = this.#records.at(-1);
      const withoutHash = {
        cursor: this.#records.length,
        previousRecordHash: priorRecord?.recordHash ?? null,
        projection,
        authorization: structuredClone(authorization),
      };
      const record: ReleaseProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "release-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#states.set(releaseId, state);
      this.#lastEventHashes.set(releaseId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public releases(): readonly PublicReleaseProjection[] {
    const latest = new Map<string, PublicReleaseProjection>();
    for (const { projection } of this.#records) {
      if (projection !== null) latest.set(projection.releaseId, projection);
    }
    return structuredClone([...latest.values()]);
  }
}
