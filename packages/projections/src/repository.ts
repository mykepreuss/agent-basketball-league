import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { sha256Commitment } from "@abl/recognition";

import type { ProjectionEventEnvelope } from "./envelope.js";
import { writeImmutableJson } from "./immutable-json.js";

export interface PublicPlayerProjection {
  playerId: string;
  team: "HOME" | "AWAY";
  position: "PG" | "SG" | "SF" | "PF" | "C";
  xCm: number;
  yCm: number;
}

export interface PublicEventProjection {
  sequence: number;
  type: string;
  label: string;
  stateRoot: `0x${string}`;
  eventHash: `0x${string}`;
}

export interface PublicSegmentProjection {
  sequence: number;
  previousSegmentHash: `0x${string}` | null;
  eventHashes: `0x${string}`[];
  stateRoot: `0x${string}`;
  payloadCommitment: `0x${string}`;
  segmentHash: `0x${string}`;
}

export interface PublicGameProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  gameId: string;
  possessionId: string;
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  score: { home: number; away: number };
  gameClockMs: number;
  shotClockMs: number;
  players: PublicPlayerProjection[];
  events: PublicEventProjection[];
  segments: PublicSegmentProjection[];
  finalStateRoot: `0x${string}`;
  eventMerkleRoot: `0x${string}`;
  filmCommitment: `0x${string}`;
  finalSegmentHash: `0x${string}`;
  projectedAt: string;
}

export interface ProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicGameProjection;
  authorization: ProjectionEventEnvelope | null;
  recordHash: `0x${string}`;
}

export interface PublicProjectionReader {
  refresh(): Promise<void>;
  events(afterCursor?: number): readonly ProjectionRecord[];
  games(): readonly PublicGameProjection[];
  game(gameId: string): PublicGameProjection | undefined;
  cursor(gameId: string):
    | {
        latestSegment: number;
        nextCursor: number;
      }
    | undefined;
  segment(
    gameId: string,
    sequence: number,
  ): PublicSegmentProjection | undefined;
}

export interface PublicProjectionWriter {
  publish(
    projection: PublicGameProjection,
    expectedVersion?: string,
    authorization?: ProjectionEventEnvelope,
  ): Promise<ProjectionRecord>;
}

export interface PublicProjectionRepositoryOptions {
  verifyAuthorization?: (
    authorization: ProjectionEventEnvelope,
    projectedAt: string,
  ) => Promise<PublicGameProjection>;
}

export class ProjectionVersionConflictError extends Error {
  public override readonly name = "ProjectionVersionConflictError";
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<ProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

export class FilePublicProjectionRepository
  implements PublicProjectionReader, PublicProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicProjectionRepositoryOptions["verifyAuthorization"];
  readonly #records: ProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicProjectionRepositoryOptions = {},
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
  }

  async #assertAuthorized(
    projection: PublicGameProjection,
    authorization: ProjectionEventEnvelope | null,
  ): Promise<void> {
    if (this.#verifyAuthorization === undefined) return;
    const projectedAtMs = Date.parse(projection.projectedAt);
    if (
      authorization === null ||
      !Number.isFinite(projectedAtMs) ||
      projection.projectedAt !== new Date(projectedAtMs).toISOString()
    ) {
      throw new Error("Public projection authorization is absent or invalid");
    }
    let verified: PublicGameProjection;
    try {
      verified = await this.#verifyAuthorization(
        authorization,
        projection.projectedAt,
      );
    } catch {
      throw new Error("Public projection authorization is invalid");
    }
    if (sha256Commitment(verified) !== sha256Commitment(projection))
      throw new Error("Public projection does not match its authorization");
  }

  public async initialize(): Promise<void> {
    const recordsRoot = join(this.#root, "records");
    await mkdir(recordsRoot, { recursive: true, mode: 0o700 });
    await this.refresh();
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

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "records");
      const records: ProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const gameVersions = new Map<string, bigint>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
      for (const filename of filenames) {
        const value: unknown = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        );
        const record = value as ProjectionRecord;
        const prior = records.at(-1);
        await this.#assertAuthorized(
          record.projection,
          record.authorization ?? null,
        );
        if (
          record.cursor !== records.length ||
          filename !== `${String(record.cursor).padStart(12, "0")}.json` ||
          record.previousRecordHash !== (prior?.recordHash ?? null) ||
          record.recordHash !==
            recordHash({
              cursor: record.cursor,
              previousRecordHash: record.previousRecordHash,
              projection: record.projection,
              authorization: record.authorization,
            }) ||
          record.projection.canonical !== true
        ) {
          throw new Error("Public projection chain is corrupt or noncanonical");
        }
        if (eventCursors.has(record.projection.canonicalEventHash))
          throw new Error("Public projection repeats a canonical event");
        const priorGameVersion =
          gameVersions.get(record.projection.gameId) ?? 0n;
        let projectionVersion: bigint;
        try {
          projectionVersion = parseVersion(
            record.projection.aggregateVersion,
            "Projection aggregate version",
          );
        } catch {
          throw new Error("Public projection has an invalid aggregate version");
        }
        if (projectionVersion !== priorGameVersion + 1n)
          throw new Error(
            "Public projection aggregate version chain is corrupt",
          );
        records.push(structuredClone(record));
        eventCursors.set(record.projection.canonicalEventHash, record.cursor);
        gameVersions.set(record.projection.gameId, projectionVersion);
      }
      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
    });
  }

  public async publish(
    projection: PublicGameProjection,
    expectedVersion?: string,
    authorization?: ProjectionEventEnvelope,
  ): Promise<ProjectionRecord> {
    return this.#serialize(async () => {
      await this.#assertAuthorized(projection, authorization ?? null);
      const priorCursor = this.#eventCursors.get(projection.canonicalEventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);
      const actualVersion = this.#records.findLast(
        ({ projection: candidate }) => candidate.gameId === projection.gameId,
      )?.projection.aggregateVersion;
      const actual = parseVersion(actualVersion ?? "0", "Stored version");
      const next = parseVersion(
        projection.aggregateVersion,
        "Projection version",
      );
      const claimedExpected = parseVersion(
        expectedVersion ?? (next - 1n).toString(),
        "Expected version",
      );
      if (actual !== claimedExpected || next !== claimedExpected + 1n) {
        throw new ProjectionVersionConflictError(
          `Expected projection version ${claimedExpected}, received ${actual}`,
        );
      }
      const prior = this.#records.at(-1);
      const withoutHash = {
        cursor: this.#records.length,
        previousRecordHash: prior?.recordHash ?? null,
        projection: structuredClone(projection),
        authorization:
          authorization === undefined ? null : structuredClone(authorization),
      };
      const record: ProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(projection.canonicalEventHash, record.cursor);
      return structuredClone(record);
    });
  }

  public events(afterCursor = -1): readonly ProjectionRecord[] {
    return structuredClone(
      this.#records.filter(({ cursor }) => cursor > afterCursor),
    );
  }

  public games(): readonly PublicGameProjection[] {
    const latest = new Map<string, PublicGameProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.gameId, projection);
    return structuredClone([...latest.values()]);
  }

  public game(gameId: string): PublicGameProjection | undefined {
    const projection = this.#records.findLast(
      ({ projection: candidate }) => candidate.gameId === gameId,
    )?.projection;
    return projection === undefined ? undefined : structuredClone(projection);
  }

  public cursor(gameId: string) {
    const projection = this.game(gameId);
    if (projection === undefined) return undefined;
    return {
      latestSegment: projection.segments.at(-1)?.sequence ?? -1,
      nextCursor: this.#records.length,
    };
  }

  public segment(gameId: string, sequence: number) {
    const segment = this.game(gameId)?.segments.find(
      (candidate) => candidate.sequence === sequence,
    );
    return segment === undefined ? undefined : structuredClone(segment);
  }
}
