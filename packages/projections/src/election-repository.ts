import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyElectionWorkflowTransition,
  electionWorkflowStateRoot,
  evaluatePremierElection,
  type ElectionWorkflowSnapshot,
  type PremierElectionResult,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import type {
  ElectionProjectionEventEnvelope,
  VerifiedElectionProjectionEvent,
} from "./election-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicElectionProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  recordType: "PREMIER_PLAYERS_ASSOCIATION_BOARD_ELECTION";
  electionId: string;
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  election: ElectionWorkflowSnapshot["election"];
  eligibilitySnapshot: ElectionWorkflowSnapshot["eligibilitySnapshot"];
  candidateDids: string[];
  ballots: ElectionWorkflowSnapshot["ballots"];
  result: PremierElectionResult | null;
  closedAt: string | null;
  projectedAt: string;
}

export interface ElectionProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicElectionProjection;
  authorization: ElectionProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicElectionProjectionReader {
  refresh(): Promise<void>;
  elections(): readonly PublicElectionProjection[];
}

export interface PublicElectionProjectionWriter {
  publish(
    authorization: ElectionProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ElectionProjectionRecord>;
}

export interface PublicElectionProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: ElectionProjectionEventEnvelope,
  ) => Promise<VerifiedElectionProjectionEvent>;
  now?: () => Date;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<ElectionProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error("Election projection timestamp is not canonical");
  return value;
}

function publicProjection(
  snapshot: ElectionWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicElectionProjection {
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    recordType: "PREMIER_PLAYERS_ASSOCIATION_BOARD_ELECTION",
    electionId: snapshot.electionId,
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    election: structuredClone(snapshot.election),
    eligibilitySnapshot: structuredClone(snapshot.eligibilitySnapshot),
    candidateDids: [...snapshot.candidateDids],
    ballots: structuredClone(snapshot.ballots),
    result: structuredClone(snapshot.result),
    closedAt: snapshot.closedAt,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

function advanceElection(
  current: ElectionWorkflowSnapshot | undefined,
  verified: VerifiedElectionProjectionEvent,
): ElectionWorkflowSnapshot {
  const result =
    verified.event.eventType === "PremierElectionClosed"
      ? current === undefined
        ? null
        : evaluatePremierElection(current)
      : null;
  const snapshot = applyElectionWorkflowTransition(
    current ?? null,
    verified.event,
    verified.payload,
    result,
  );
  if (electionWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
    throw new Error("Public election projection state root is invalid");
  return snapshot;
}

export class FilePublicElectionProjectionRepository
  implements PublicElectionProjectionReader, PublicElectionProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicElectionProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: ElectionProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #states = new Map<string, ElectionWorkflowSnapshot>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicElectionProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: ElectionProjectionEventEnvelope,
  ): Promise<VerifiedElectionProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public election projection authorization is invalid");
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
    await mkdir(join(this.#root, "election-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "election-records");
      const records: ElectionProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const states = new Map<string, ElectionWorkflowSnapshot>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as ElectionProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const electionId = verified.event.aggregateId;
        const priorState = states.get(electionId);
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
            (lastEventHashes.get(electionId) ?? null)
        ) {
          throw new Error(
            "Public election projection chain is corrupt or noncanonical",
          );
        }
        const state = advanceElection(priorState, verified);
        const expected = publicProjection(
          state,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public election projection does not match its authorization",
          );
        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        states.set(electionId, state);
        lastEventHashes.set(electionId, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#states.clear();
      for (const [electionId, state] of states)
        this.#states.set(electionId, state);
      this.#lastEventHashes.clear();
      for (const [electionId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(electionId, eventHash);
    });
  }

  public async publish(
    authorization: ElectionProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ElectionProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const electionId = verified.event.aggregateId;
      const priorState = this.#states.get(electionId);
      const actual = BigInt(priorState?.version ?? 0);
      const claimedExpected = parseVersion(
        expectedVersion ?? verified.expectedVersion,
        "Expected version",
      );
      if (
        actual !== claimedExpected ||
        verified.event.aggregateVersion !== claimedExpected + 1n
      ) {
        throw new ProjectionVersionConflictError(
          `Expected election projection version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(electionId) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Election projection previous event hash is invalid",
        );
      }
      const state = advanceElection(priorState, verified);
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
      const record: ElectionProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "election-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#states.set(electionId, state);
      this.#lastEventHashes.set(electionId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public elections(): readonly PublicElectionProjection[] {
    const latest = new Map<string, PublicElectionProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.electionId, projection);
    return structuredClone([...latest.values()]);
  }
}
