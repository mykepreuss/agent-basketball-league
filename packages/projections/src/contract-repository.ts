import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyContractWorkflowTransition,
  contractWorkflowStateRoot,
  type ContractWorkflowSnapshot,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import type {
  ContractProjectionEventEnvelope,
  VerifiedContractProjectionEvent,
} from "./contract-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicContractProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  playerDid: string;
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  contracts: ContractWorkflowSnapshot["contracts"];
  projectedAt: string;
}

export interface PublicRosterPlayer {
  playerDid: string;
  transactionId: string;
  consentId: string;
  offeredByDid: string;
  effectiveAt: string;
  seasons: number;
  courtCredits: number;
  capMechanism: string;
  canonicalContractHeadHash: `0x${string}`;
}

export interface PublicRosterProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL";
  clubId: string;
  players: PublicRosterPlayer[];
  rosterCommitment: `0x${string}`;
  projectedAt: string;
}

export interface ContractProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicContractProjection;
  authorization: ContractProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicContractProjectionReader {
  refresh(): Promise<void>;
  contracts(): readonly PublicContractProjection[];
  rosters(): readonly PublicRosterProjection[];
}

export interface PublicContractProjectionWriter {
  publish(
    authorization: ContractProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ContractProjectionRecord>;
}

export interface PublicContractProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: ContractProjectionEventEnvelope,
  ) => Promise<VerifiedContractProjectionEvent>;
  now?: () => Date;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<ContractProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error("Contract projection timestamp is not canonical");
  return value;
}

function publicProjection(
  snapshot: ContractWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicContractProjection {
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    playerDid: snapshot.playerDid,
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    contracts: structuredClone(snapshot.contracts),
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

export class FilePublicContractProjectionRepository
  implements PublicContractProjectionReader, PublicContractProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicContractProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: ContractProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #snapshots = new Map<string, ContractWorkflowSnapshot>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicContractProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: ContractProjectionEventEnvelope,
  ): Promise<VerifiedContractProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public contract projection authorization is invalid");
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
    await mkdir(join(this.#root, "contract-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "contract-records");
      const records: ContractProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const snapshots = new Map<string, ContractWorkflowSnapshot>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as ContractProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const playerDid = verified.event.aggregateId;
        const priorSnapshot = snapshots.get(playerDid) ?? null;
        const priorEventHash = lastEventHashes.get(playerDid) ?? null;
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
          verified.event.previousEventHash !== priorEventHash
        ) {
          throw new Error(
            "Public contract projection chain is corrupt or noncanonical",
          );
        }
        const snapshot = applyContractWorkflowTransition(
          priorSnapshot,
          verified.event,
          verified.payload,
        );
        if (contractWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
          throw new Error("Public contract projection state root is invalid");
        const expected = publicProjection(
          snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public contract projection does not match its authorization",
          );

        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        snapshots.set(playerDid, snapshot);
        lastEventHashes.set(playerDid, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#snapshots.clear();
      for (const [playerDid, snapshot] of snapshots)
        this.#snapshots.set(playerDid, snapshot);
      this.#lastEventHashes.clear();
      for (const [playerDid, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(playerDid, eventHash);
    });
  }

  public async publish(
    authorization: ContractProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ContractProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const playerDid = verified.event.aggregateId;
      const priorSnapshot = this.#snapshots.get(playerDid) ?? null;
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
          `Expected contract projection version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(playerDid) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Contract projection previous event hash is invalid",
        );
      }
      const snapshot = applyContractWorkflowTransition(
        priorSnapshot,
        verified.event,
        verified.payload,
      );
      if (contractWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
        throw new Error("Public contract projection state root is invalid");
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
      const record: ContractProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "contract-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#snapshots.set(playerDid, snapshot);
      this.#lastEventHashes.set(playerDid, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public contracts(): readonly PublicContractProjection[] {
    const latest = new Map<string, PublicContractProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.playerDid, projection);
    return structuredClone([...latest.values()]);
  }

  public rosters(): readonly PublicRosterProjection[] {
    const playersByClub = new Map<
      string,
      Array<{ player: PublicRosterPlayer; projectedAt: string }>
    >();
    for (const projection of this.contracts()) {
      for (const contract of projection.contracts) {
        if (contract.status !== "ACTIVE" || contract.consent === null) continue;
        const clubId = contract.transaction.toTeamId;
        const players = playersByClub.get(clubId) ?? [];
        players.push({
          player: {
            playerDid: projection.playerDid,
            transactionId: contract.transaction.transactionId,
            consentId: contract.consent.consentId,
            offeredByDid: contract.offeredByDid,
            effectiveAt: contract.transaction.effectiveAt,
            seasons: contract.transaction.seasons,
            courtCredits: contract.transaction.courtCredits,
            capMechanism: contract.transaction.capMechanism,
            canonicalContractHeadHash: projection.canonicalEventHash,
          },
          projectedAt: projection.projectedAt,
        });
        playersByClub.set(clubId, players);
      }
    }
    return [...playersByClub.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([clubId, sources]) => {
        const players = sources
          .map(({ player }) => player)
          .sort((left, right) => left.playerDid.localeCompare(right.playerDid));
        const projectedAt = sources
          .map((source) => source.projectedAt)
          .sort()
          .at(-1);
        if (projectedAt === undefined)
          throw new Error("Active roster lacks a source projection");
        return {
          state: "REHEARSAL",
          canonical: true,
          verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL",
          clubId,
          players,
          rosterCommitment: sha256Commitment({
            format: "ABL-PUBLIC-ROSTER-PROJECTION-V1",
            clubId,
            players,
          }),
          projectedAt,
        };
      });
  }
}
