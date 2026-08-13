import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { sha256Commitment } from "@abl/recognition";

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
  publish(projection: PublicGameProjection): Promise<ProjectionRecord>;
}

function recordHash(
  value: Omit<ProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

async function writeImmutableJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined = await open(
    temporaryPath,
    "wx",
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class FilePublicProjectionRepository
  implements PublicProjectionReader, PublicProjectionWriter
{
  readonly #root: string;
  readonly #records: ProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  #operationTail = Promise.resolve();

  public constructor(root: string) {
    this.#root = resolve(root);
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
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
      for (const filename of filenames) {
        const value: unknown = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        );
        const record = value as ProjectionRecord;
        const prior = records.at(-1);
        if (
          record.cursor !== records.length ||
          filename !== `${String(record.cursor).padStart(12, "0")}.json` ||
          record.previousRecordHash !== (prior?.recordHash ?? null) ||
          record.recordHash !==
            recordHash({
              cursor: record.cursor,
              previousRecordHash: record.previousRecordHash,
              projection: record.projection,
            }) ||
          record.projection.canonical !== true
        ) {
          throw new Error("Public projection chain is corrupt or noncanonical");
        }
        if (eventCursors.has(record.projection.canonicalEventHash))
          throw new Error("Public projection repeats a canonical event");
        records.push(structuredClone(record));
        eventCursors.set(record.projection.canonicalEventHash, record.cursor);
      }
      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
    });
  }

  public async publish(
    projection: PublicGameProjection,
  ): Promise<ProjectionRecord> {
    return this.#serialize(async () => {
      const priorCursor = this.#eventCursors.get(projection.canonicalEventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);
      const prior = this.#records.at(-1);
      const withoutHash = {
        cursor: this.#records.length,
        previousRecordHash: prior?.recordHash ?? null,
        projection: structuredClone(projection),
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
    const projection = this.#records
      .map(({ projection }) => projection)
      .findLast((candidate) => candidate.gameId === gameId);
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
