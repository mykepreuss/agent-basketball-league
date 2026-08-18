import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { sha256Commitment } from "@abl/recognition";

import {
  CheckpointPublicationSchema,
  type CheckpointPublication,
} from "./checkpoint-repository.js";
import { writeImmutableJson } from "./immutable-json.js";

export interface CheckpointQueueRecord {
  sequence: number;
  previousRecordHash: `0x${string}` | null;
  publication: CheckpointPublication;
  publicationDigest: `0x${string}`;
  queuedAt: string;
  recordHash: `0x${string}`;
}

function canonicalInstant(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  ) {
    throw new Error("Checkpoint queue time is not canonical");
  }
  return value;
}

function validateReadyPublication(value: unknown): CheckpointPublication {
  const publication = CheckpointPublicationSchema.parse(value);
  const manifestDigest = sha256Commitment(publication.manifest);
  if (
    publication.checkpoint.transactionHash !== null ||
    publication.checkpoint.blockNumber !== null ||
    publication.checkpoint.manifestDigest !== manifestDigest ||
    publication.checkpoint.nonce !== manifestDigest ||
    publication.checkpoint.checkpointType !==
      publication.manifest.checkpointType ||
    publication.checkpoint.subjectId !== publication.manifest.subjectId ||
    (publication.checkpoint.checkpointType !== "KEY_REGISTRY" &&
      publication.checkpoint.root !== publication.manifest.merkleRoot)
  ) {
    throw new Error("Checkpoint is not ready for deferred Base submission");
  }
  return publication;
}

function recordHash(
  record: Omit<CheckpointQueueRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(record);
}

export class FileCheckpointPublicationQueue {
  readonly #recordsRoot: string;
  readonly #records: CheckpointQueueRecord[] = [];
  readonly #checkpointIds = new Map<string, CheckpointQueueRecord>();
  #operationTail = Promise.resolve();

  public constructor(root: string) {
    this.#recordsRoot = resolve(root, "checkpoint-submission-queue");
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
    await mkdir(this.#recordsRoot, { recursive: true, mode: 0o700 });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const records: CheckpointQueueRecord[] = [];
      const checkpointIds = new Map<string, CheckpointQueueRecord>();
      const filenames = (await readdir(this.#recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
      for (const filename of filenames) {
        const raw: unknown = JSON.parse(
          await readFile(join(this.#recordsRoot, filename), "utf8"),
        );
        if (typeof raw !== "object" || raw === null)
          throw new Error("Checkpoint queue record is malformed");
        const candidate = raw as CheckpointQueueRecord;
        const publication = validateReadyPublication(candidate.publication);
        const prior = records.at(-1);
        const withoutHash = {
          sequence: candidate.sequence,
          previousRecordHash: candidate.previousRecordHash,
          publication,
          publicationDigest: candidate.publicationDigest,
          queuedAt: canonicalInstant(candidate.queuedAt),
        };
        if (
          candidate.sequence !== records.length ||
          filename !== `${String(candidate.sequence).padStart(12, "0")}.json` ||
          candidate.previousRecordHash !== (prior?.recordHash ?? null) ||
          candidate.publicationDigest !== sha256Commitment(publication) ||
          candidate.recordHash !== recordHash(withoutHash) ||
          checkpointIds.has(publication.checkpoint.checkpointId)
        ) {
          throw new Error("Checkpoint submission queue is corrupt");
        }
        const record = { ...withoutHash, recordHash: candidate.recordHash };
        records.push(record);
        checkpointIds.set(publication.checkpoint.checkpointId, record);
      }
      this.#records.splice(0, this.#records.length, ...records);
      this.#checkpointIds.clear();
      for (const [checkpointId, record] of checkpointIds)
        this.#checkpointIds.set(checkpointId, record);
    });
  }

  public async enqueue(
    value: unknown,
    queuedAt = new Date(),
  ): Promise<CheckpointQueueRecord> {
    return this.#serialize(async () => {
      const publication = validateReadyPublication(value);
      const publicationDigest = sha256Commitment(publication);
      const priorForId = this.#checkpointIds.get(
        publication.checkpoint.checkpointId,
      );
      if (priorForId !== undefined) {
        if (priorForId.publicationDigest !== publicationDigest)
          throw new Error("Checkpoint queue idempotency conflict");
        return structuredClone(priorForId);
      }
      const prior = this.#records.at(-1);
      const withoutHash = {
        sequence: this.#records.length,
        previousRecordHash: prior?.recordHash ?? null,
        publication: structuredClone(publication),
        publicationDigest,
        queuedAt: canonicalInstant(queuedAt.toISOString()),
      };
      const record: CheckpointQueueRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#recordsRoot,
          `${String(record.sequence).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#checkpointIds.set(publication.checkpoint.checkpointId, record);
      return structuredClone(record);
    });
  }

  public pending(): readonly CheckpointQueueRecord[] {
    return structuredClone(this.#records);
  }
}
