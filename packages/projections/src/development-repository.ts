import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyDevelopmentWorkflowTransition,
  developmentWorkflowStateRoot,
  type DevelopmentWorkflowSnapshot,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import type {
  DevelopmentProjectionEventEnvelope,
  VerifiedDevelopmentProjectionEvent,
} from "./development-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicDevelopmentProjection
  extends DevelopmentWorkflowSnapshot {
  recordType: "DEVELOPMENT_CONFERENCE";
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  projectedAt: string;
}

export interface DevelopmentProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicDevelopmentProjection;
  authorization: DevelopmentProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicDevelopmentProjectionReader {
  refresh(): Promise<void>;
  conferences(): readonly PublicDevelopmentProjection[];
}

export interface PublicDevelopmentProjectionWriter {
  publish(
    authorization: DevelopmentProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<DevelopmentProjectionRecord>;
}

export interface PublicDevelopmentProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: DevelopmentProjectionEventEnvelope,
  ) => Promise<VerifiedDevelopmentProjectionEvent>;
  now?: () => Date;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error("Development projection timestamp is not canonical");
  return value;
}

function recordHash(
  value: Omit<DevelopmentProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function publicProjection(
  snapshot: DevelopmentWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicDevelopmentProjection {
  return {
    recordType: "DEVELOPMENT_CONFERENCE",
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    ...structuredClone(snapshot),
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

export class FilePublicDevelopmentProjectionRepository
  implements
    PublicDevelopmentProjectionReader,
    PublicDevelopmentProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicDevelopmentProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: DevelopmentProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #snapshots = new Map<string, DevelopmentWorkflowSnapshot>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicDevelopmentProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: DevelopmentProjectionEventEnvelope,
  ): Promise<VerifiedDevelopmentProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public development authorization is invalid");
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
    await mkdir(join(this.#root, "development-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "development-records");
      const records: DevelopmentProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const snapshots = new Map<string, DevelopmentWorkflowSnapshot>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as DevelopmentProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const conferenceId = verified.event.aggregateId;
        const priorSnapshot = snapshots.get(conferenceId) ?? null;
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
            (lastEventHashes.get(conferenceId) ?? null)
        ) {
          throw new Error(
            "Public development chain is corrupt or noncanonical",
          );
        }
        const snapshot = applyDevelopmentWorkflowTransition(
          priorSnapshot,
          verified.event,
          verified.payload,
        );
        if (developmentWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
          throw new Error("Public development state root is invalid");
        const expected = publicProjection(
          snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public development projection does not match its authorization",
          );
        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        snapshots.set(conferenceId, snapshot);
        lastEventHashes.set(conferenceId, verified.event.eventHash);
      }
      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#snapshots.clear();
      for (const [conferenceId, snapshot] of snapshots)
        this.#snapshots.set(conferenceId, snapshot);
      this.#lastEventHashes.clear();
      for (const [conferenceId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(conferenceId, eventHash);
    });
  }

  public async publish(
    authorization: DevelopmentProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<DevelopmentProjectionRecord> {
    return this.#serialize(async () => {
      const initialAuthorization = this.#records[0]?.authorization;
      if (initialAuthorization !== undefined)
        await this.#verify(initialAuthorization);
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const conferenceId = verified.event.aggregateId;
      const priorSnapshot = this.#snapshots.get(conferenceId) ?? null;
      const actual = BigInt(priorSnapshot?.version ?? 0);
      const claimedExpected = parseVersion(
        expectedVersion ?? verified.expectedVersion,
        "Expected version",
      );
      if (
        actual !== claimedExpected ||
        verified.event.aggregateVersion !== claimedExpected + 1n
      ) {
        throw new ProjectionVersionConflictError(
          `Expected development projection version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(conferenceId) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Development projection previous event hash is invalid",
        );
      }
      const snapshot = applyDevelopmentWorkflowTransition(
        priorSnapshot,
        verified.event,
        verified.payload,
      );
      if (developmentWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
        throw new Error("Development projection state root is invalid");
      const projection = publicProjection(
        snapshot,
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
      const record: DevelopmentProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "development-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#snapshots.set(conferenceId, snapshot);
      this.#lastEventHashes.set(conferenceId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public conferences(): readonly PublicDevelopmentProjection[] {
    const latest = new Map<string, PublicDevelopmentProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.conferenceId, projection);
    return structuredClone([...latest.values()]);
  }
}
