import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  AgentPlayedGameEvidence,
  BroadcastSegmentRecord,
  FullGameEvent,
} from "@abl/basketball";
import { sha256Commitment } from "@abl/recognition";

import type {
  FinalGameProjectionEventEnvelope,
  VerifiedFinalGameProjectionEvent,
} from "./final-game-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicFinalizedGameProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  recognizedGenesisGame: false;
  projectionKind: "FINALIZED_GAME";
  gameId: string;
  aggregateVersion: "1";
  canonicalEventHash: `0x${string}`;
  phase: "FINAL";
  period: number;
  periodKind: "REGULATION" | "OVERTIME";
  score: { home: number; away: number };
  winner: "HOME" | "AWAY";
  commandCount: number;
  possessionCount: number;
  events: readonly FullGameEvent[];
  segments: readonly BroadcastSegmentRecord[];
  finalStateRoot: `0x${string}`;
  eventMerkleRoot: `0x${string}`;
  finalEventHash: `0x${string}`;
  agentEvidence: AgentPlayedGameEvidence;
  filmCommitment: `0x${string}`;
  replayInferenceInvocations: 0;
  projectedAt: string;
}

export interface FinalGameProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicFinalizedGameProjection;
  authorization: FinalGameProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicFinalGameProjectionReader {
  refresh(): Promise<void>;
  games(): readonly PublicFinalizedGameProjection[];
  game(gameId: string): PublicFinalizedGameProjection | undefined;
  cursor(
    gameId: string,
  ): { latestSegment: number; nextCursor: number } | undefined;
  segment(gameId: string, sequence: number): BroadcastSegmentRecord | undefined;
}

export interface PublicFinalGameProjectionWriter {
  publish(
    authorization: FinalGameProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<FinalGameProjectionRecord>;
}

function recordHash(
  value: Omit<FinalGameProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

export class FilePublicFinalGameProjectionRepository
  implements PublicFinalGameProjectionReader, PublicFinalGameProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: (
    authorization: FinalGameProjectionEventEnvelope,
    projectedAt: string,
  ) => Promise<VerifiedFinalGameProjectionEvent>;
  readonly #now: () => Date;
  readonly #records: FinalGameProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: {
      verifyAuthorization: (
        authorization: FinalGameProjectionEventEnvelope,
        projectedAt: string,
      ) => Promise<VerifiedFinalGameProjectionEvent>;
      now?: () => Date;
    },
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: FinalGameProjectionEventEnvelope,
    projectedAt: string,
  ): Promise<VerifiedFinalGameProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization, projectedAt);
    } catch {
      throw new Error("Public finalized game authorization is invalid");
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
    await mkdir(join(this.#root, "final-game-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const root = join(this.#root, "final-game-records");
      const records: FinalGameProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const gameIds = new Set<string>();
      const filenames = (await readdir(root))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(root, filename), "utf8"),
        ) as FinalGameProjectionRecord;
        const prior = records.at(-1);
        const verified = await this.#verify(
          record.authorization,
          record.projection.projectedAt,
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
          sha256Commitment(record.projection) !==
            sha256Commitment(verified.projection) ||
          eventCursors.has(verified.event.eventHash) ||
          gameIds.has(verified.event.aggregateId)
        ) {
          throw new Error("Public finalized game chain is corrupt");
        }
        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        gameIds.add(verified.event.aggregateId);
      }
      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
    });
  }

  public async publish(
    authorization: FinalGameProjectionEventEnvelope,
    expectedVersion = "0",
    projectedAt = this.#now().toISOString(),
  ): Promise<FinalGameProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization, projectedAt);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);
      if (
        expectedVersion !== "0" ||
        verified.expectedVersion !== "0" ||
        this.#records.some(
          ({ projection }) => projection.gameId === verified.projection.gameId,
        )
      ) {
        throw new ProjectionVersionConflictError(
          "Finalized game already exists or has a nonzero predecessor",
        );
      }
      const prior = this.#records.at(-1);
      const withoutHash = {
        cursor: this.#records.length,
        previousRecordHash: prior?.recordHash ?? null,
        projection: verified.projection,
        authorization: structuredClone(authorization),
      };
      const record: FinalGameProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "final-game-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      return structuredClone(record);
    });
  }

  public games(): readonly PublicFinalizedGameProjection[] {
    return structuredClone(this.#records.map(({ projection }) => projection));
  }

  public game(gameId: string): PublicFinalizedGameProjection | undefined {
    const value = this.#records.find(
      ({ projection }) => projection.gameId === gameId,
    )?.projection;
    return value === undefined ? undefined : structuredClone(value);
  }

  public cursor(gameId: string) {
    const game = this.game(gameId);
    if (game === undefined) return undefined;
    return {
      latestSegment: game.segments.at(-1)?.cursor ?? -1,
      nextCursor: game.segments.length,
    };
  }

  public segment(gameId: string, sequence: number) {
    const segment = this.game(gameId)?.segments.find(
      ({ cursor }) => cursor === sequence,
    );
    return segment === undefined ? undefined : structuredClone(segment);
  }
}
