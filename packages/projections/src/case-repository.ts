import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyCaseWorkflowTransition,
  caseWorkflowStateRoot,
  type CaseWorkflowSnapshot,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import type {
  CaseProjectionEventEnvelope,
  VerifiedCaseProjectionEvent,
} from "./case-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicCaseProjection extends CaseWorkflowSnapshot {
  recordType: "DUE_PROCESS_CASE";
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  processStatus:
    | "FILED"
    | "NOTICE_SERVED"
    | "REPRESENTED"
    | "EVIDENCE_ACCESSED"
    | "RESPONDED"
    | "MERITS_RULING"
    | "APPEAL_PENDING"
    | "APPEAL_RULING";
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  projectedAt: string;
}

export interface CaseProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicCaseProjection;
  authorization: CaseProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicCaseProjectionReader {
  refresh(): Promise<void>;
  cases(): readonly PublicCaseProjection[];
  caseAtHead(caseId: string, eventHash: string): PublicCaseProjection | null;
}

export interface PublicCaseProjectionWriter {
  publish(
    authorization: CaseProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<CaseProjectionRecord>;
}

export interface PublicCaseProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: CaseProjectionEventEnvelope,
  ) => Promise<VerifiedCaseProjectionEvent>;
  now?: () => Date;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<CaseProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error("Case projection timestamp is not canonical");
  return value;
}

function processStatus(
  snapshot: CaseWorkflowSnapshot,
): PublicCaseProjection["processStatus"] {
  if (snapshot.appealRuling !== null) return "APPEAL_RULING";
  if (snapshot.appeal !== null) return "APPEAL_PENDING";
  if (snapshot.ruling !== null) return "MERITS_RULING";
  if (snapshot.response !== null) return "RESPONDED";
  if (snapshot.evidenceAccess !== null) return "EVIDENCE_ACCESSED";
  if (snapshot.representative !== null) return "REPRESENTED";
  if (snapshot.notice !== null) return "NOTICE_SERVED";
  return "FILED";
}

function publicProjection(
  snapshot: CaseWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicCaseProjection {
  return {
    recordType: "DUE_PROCESS_CASE",
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    processStatus: processStatus(snapshot),
    ...structuredClone(snapshot),
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

export class FilePublicCaseProjectionRepository
  implements PublicCaseProjectionReader, PublicCaseProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicCaseProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: CaseProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #snapshots = new Map<string, CaseWorkflowSnapshot>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicCaseProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: CaseProjectionEventEnvelope,
  ): Promise<VerifiedCaseProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public case projection authorization is invalid");
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
    await mkdir(join(this.#root, "case-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "case-records");
      const records: CaseProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const snapshots = new Map<string, CaseWorkflowSnapshot>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as CaseProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const caseId = verified.event.aggregateId;
        const priorSnapshot = snapshots.get(caseId) ?? null;
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
            (lastEventHashes.get(caseId) ?? null)
        ) {
          throw new Error(
            "Public case projection chain is corrupt or noncanonical",
          );
        }
        const snapshot = applyCaseWorkflowTransition(
          priorSnapshot,
          verified.event,
          verified.payload,
        );
        if (caseWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
          throw new Error("Public case projection state root is invalid");
        const expected = publicProjection(
          snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public case projection does not match its authorization",
          );

        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        snapshots.set(caseId, snapshot);
        lastEventHashes.set(caseId, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#snapshots.clear();
      for (const [caseId, snapshot] of snapshots)
        this.#snapshots.set(caseId, snapshot);
      this.#lastEventHashes.clear();
      for (const [caseId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(caseId, eventHash);
    });
  }

  public async publish(
    authorization: CaseProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<CaseProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const caseId = verified.event.aggregateId;
      const priorSnapshot = this.#snapshots.get(caseId) ?? null;
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
          `Expected case projection version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(caseId) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Case projection previous event hash is invalid",
        );
      }
      const snapshot = applyCaseWorkflowTransition(
        priorSnapshot,
        verified.event,
        verified.payload,
      );
      if (caseWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
        throw new Error("Public case projection state root is invalid");
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
      const record: CaseProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "case-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#snapshots.set(caseId, snapshot);
      this.#lastEventHashes.set(caseId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public cases(): readonly PublicCaseProjection[] {
    const latest = new Map<string, PublicCaseProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.caseId, projection);
    return structuredClone([...latest.values()]);
  }

  public caseAtHead(
    caseId: string,
    eventHash: string,
  ): PublicCaseProjection | null {
    const record = this.#records.find(
      ({ projection }) =>
        projection.caseId === caseId &&
        projection.canonicalEventHash === eventHash,
    );
    return record === undefined ? null : structuredClone(record.projection);
  }
}
