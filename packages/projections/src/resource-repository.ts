import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyResourceScheduleTransition,
  resourceScheduleStateRoot,
  type ResourceScheduleSnapshot,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";
import type {
  ResourceProjectionEventEnvelope,
  VerifiedResourceProjectionEvent,
} from "./resource-envelope.js";

export interface PublicResourceScheduleProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  recognizedGenesisResources: false;
  scheduleId: string;
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  schedule: ResourceScheduleSnapshot["schedule"];
  ratificationProposalId: string;
  projectedAt: string;
}

export interface ResourceProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicResourceScheduleProjection;
  authorization: ResourceProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicResourceProjectionReader {
  refresh(): Promise<void>;
  resources(): readonly PublicResourceScheduleProjection[];
}

export interface PublicResourceProjectionWriter {
  publish(
    authorization: ResourceProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ResourceProjectionRecord>;
}

export interface PublicResourceProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: ResourceProjectionEventEnvelope,
  ) => Promise<VerifiedResourceProjectionEvent>;
  now?: () => Date;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<ResourceProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error("Resource schedule projection timestamp is not canonical");
  return value;
}

function publicProjection(
  snapshot: ResourceScheduleSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicResourceScheduleProjection {
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    recognizedGenesisResources: false,
    scheduleId: snapshot.scheduleId,
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    schedule: structuredClone(snapshot.schedule),
    ratificationProposalId: snapshot.ratificationProposalId,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

export class FilePublicResourceProjectionRepository
  implements PublicResourceProjectionReader, PublicResourceProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicResourceProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: ResourceProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #snapshots = new Map<string, ResourceScheduleSnapshot>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicResourceProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: ResourceProjectionEventEnvelope,
  ): Promise<VerifiedResourceProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public resource schedule authorization is invalid");
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
    await mkdir(join(this.#root, "resource-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "resource-records");
      const records: ResourceProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const snapshots = new Map<string, ResourceScheduleSnapshot>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as ResourceProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const scheduleId = verified.event.aggregateId;
        const priorSnapshot = snapshots.get(scheduleId) ?? null;
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
            (lastEventHashes.get(scheduleId) ?? null)
        ) {
          throw new Error(
            "Public resource schedule chain is corrupt or noncanonical",
          );
        }
        const snapshot = applyResourceScheduleTransition(
          priorSnapshot,
          verified.event,
          verified.payload,
        );
        if (resourceScheduleStateRoot(snapshot) !== verified.event.stateRoot)
          throw new Error("Public resource schedule state root is invalid");
        const expected = publicProjection(
          snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public resource schedule does not match its authorization",
          );

        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        snapshots.set(scheduleId, snapshot);
        lastEventHashes.set(scheduleId, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#snapshots.clear();
      for (const [scheduleId, snapshot] of snapshots)
        this.#snapshots.set(scheduleId, snapshot);
      this.#lastEventHashes.clear();
      for (const [scheduleId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(scheduleId, eventHash);
    });
  }

  public async publish(
    authorization: ResourceProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ResourceProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const scheduleId = verified.event.aggregateId;
      const priorSnapshot = this.#snapshots.get(scheduleId) ?? null;
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
          `Expected resource schedule version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(scheduleId) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Resource schedule previous event hash is invalid",
        );
      }
      const snapshot = applyResourceScheduleTransition(
        priorSnapshot,
        verified.event,
        verified.payload,
      );
      if (resourceScheduleStateRoot(snapshot) !== verified.event.stateRoot)
        throw new Error("Public resource schedule state root is invalid");
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
      const record: ResourceProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "resource-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#snapshots.set(scheduleId, snapshot);
      this.#lastEventHashes.set(scheduleId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public resources(): readonly PublicResourceScheduleProjection[] {
    const latest = new Map<string, PublicResourceScheduleProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.scheduleId, projection);
    return structuredClone([...latest.values()]);
  }
}
