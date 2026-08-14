import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyEconomyWorkflowTransition,
  economyWorkflowStateRoot,
  type EconomyWorkflowSnapshot,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import type {
  EconomyProjectionEventEnvelope,
  VerifiedEconomyProjectionEvent,
} from "./economy-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicEconomyProjection extends EconomyWorkflowSnapshot {
  recordType: "SEASON_ECONOMY";
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  recognizedGenesisEconomy: false;
  currency: "NONCASH_COURT_CREDITS";
  capCertified: true;
  projectedAt: string;
}

export interface PublicEconomyRosterProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL";
  rosterKind: "CAP_CERTIFIED_ACTIVE_PLAYING_RIGHTS";
  rosterStatus: "ACTIVE_REHEARSAL_CAP_CERTIFIED";
  recognizedGenesisRoster: false;
  clubId: string;
  players: EconomyWorkflowSnapshot["rights"];
  waiverCharges: EconomyWorkflowSnapshot["waiverCharges"];
  capSheet: EconomyWorkflowSnapshot["latestCapCertification"]["clubSheets"][number];
  economyHeadHash: `0x${string}`;
  rosterCommitment: `0x${string}`;
  projectedAt: string;
}

export interface EconomyProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicEconomyProjection;
  authorization: EconomyProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicEconomyProjectionReader {
  refresh(): Promise<void>;
  economies(): readonly PublicEconomyProjection[];
  rosters(): readonly PublicEconomyRosterProjection[];
}

export interface PublicEconomyProjectionWriter {
  publish(
    authorization: EconomyProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<EconomyProjectionRecord>;
}

export interface PublicEconomyProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: EconomyProjectionEventEnvelope,
  ) => Promise<VerifiedEconomyProjectionEvent>;
  now?: () => Date;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<EconomyProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  ) {
    throw new Error("Economy projection timestamp is not canonical");
  }
  return value;
}

function publicProjection(
  snapshot: EconomyWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicEconomyProjection {
  return {
    recordType: "SEASON_ECONOMY",
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    ...structuredClone(snapshot),
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    recognizedGenesisEconomy: false,
    currency: "NONCASH_COURT_CREDITS",
    capCertified: true,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

export class FilePublicEconomyProjectionRepository
  implements PublicEconomyProjectionReader, PublicEconomyProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicEconomyProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: EconomyProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #snapshots = new Map<string, EconomyWorkflowSnapshot>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicEconomyProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: EconomyProjectionEventEnvelope,
  ): Promise<VerifiedEconomyProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public economy projection authorization is invalid");
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
    await mkdir(join(this.#root, "economy-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "economy-records");
      const records: EconomyProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const snapshots = new Map<string, EconomyWorkflowSnapshot>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as EconomyProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const economyId = verified.event.aggregateId;
        const priorSnapshot = snapshots.get(economyId) ?? null;
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
            (lastEventHashes.get(economyId) ?? null)
        ) {
          throw new Error(
            "Public economy projection chain is corrupt or noncanonical",
          );
        }
        const snapshot = applyEconomyWorkflowTransition(
          priorSnapshot,
          verified.event,
          verified.payload,
        );
        if (economyWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
          throw new Error("Public economy projection state root is invalid");
        const expected = publicProjection(
          snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public economy projection does not match its authorization",
          );

        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        snapshots.set(economyId, snapshot);
        lastEventHashes.set(economyId, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#snapshots.clear();
      for (const [economyId, snapshot] of snapshots)
        this.#snapshots.set(economyId, snapshot);
      this.#lastEventHashes.clear();
      for (const [economyId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(economyId, eventHash);
    });
  }

  public async publish(
    authorization: EconomyProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<EconomyProjectionRecord> {
    return this.#serialize(async () => {
      const initialAuthorization = this.#records[0]?.authorization;
      if (initialAuthorization !== undefined)
        await this.#verify(initialAuthorization);
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const economyId = verified.event.aggregateId;
      const priorSnapshot = this.#snapshots.get(economyId) ?? null;
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
          `Expected economy projection version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(economyId) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Economy projection previous event hash is invalid",
        );
      }
      const snapshot = applyEconomyWorkflowTransition(
        priorSnapshot,
        verified.event,
        verified.payload,
      );
      if (economyWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
        throw new Error("Public economy projection state root is invalid");
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
      const record: EconomyProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "economy-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#snapshots.set(economyId, snapshot);
      this.#lastEventHashes.set(economyId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public economies(): readonly PublicEconomyProjection[] {
    const latest = new Map<string, PublicEconomyProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.economyId, projection);
    return structuredClone([...latest.values()]);
  }

  public rosters(): readonly PublicEconomyRosterProjection[] {
    return this.economies().flatMap((economy) =>
      economy.clubIds.map((clubId) => {
        const players = economy.rights
          .filter((right) => right.clubId === clubId)
          .sort((left, right) => left.playerDid.localeCompare(right.playerDid));
        const waiverCharges = economy.waiverCharges
          .filter((charge) => charge.clubId === clubId)
          .sort((left, right) =>
            left.waiverTransactionId.localeCompare(right.waiverTransactionId),
          );
        const capSheet = economy.latestCapCertification.clubSheets.find(
          (sheet) => sheet.clubId === clubId,
        );
        if (capSheet === undefined)
          throw new Error("Economy roster lacks its certified cap sheet");
        const body = {
          format: "ABL-PUBLIC-CAP-CERTIFIED-ROSTER-V1",
          clubId,
          players,
          waiverCharges,
          capSheet,
          economyHeadHash: economy.canonicalEventHash,
        };
        const projection: PublicEconomyRosterProjection = {
          state: "REHEARSAL",
          canonical: true,
          verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL",
          rosterKind: "CAP_CERTIFIED_ACTIVE_PLAYING_RIGHTS",
          rosterStatus: "ACTIVE_REHEARSAL_CAP_CERTIFIED",
          recognizedGenesisRoster: false,
          clubId,
          players,
          waiverCharges,
          capSheet,
          economyHeadHash: economy.canonicalEventHash,
          rosterCommitment: sha256Commitment(body),
          projectedAt: economy.projectedAt,
        };
        return projection;
      }),
    );
  }
}
