import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyDisclosureWorkflowTransition,
  disclosureWorkflowStateRoot,
  type CompetitionReleaseEvidence,
  type DisclosureEnvelope,
  type DisclosureWorkflowSnapshot,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";
import type {
  SocialProjectionEventEnvelope,
  VerifiedSocialProjectionEvent,
} from "./social-envelope.js";

export interface PublicSocialProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  recognizedGenesisSocial: false;
  envelopeId: string;
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  authorDid: string;
  classification: DisclosureEnvelope["classification"];
  contentCommitment: `0x${string}`;
  ciphertextCommitment: `0x${string}` | null;
  declaredReleaseAt: string | null;
  competitionCondition: DisclosureEnvelope["competitionCondition"];
  visibility: "SEALED_METADATA" | "RELEASED_COMMITMENT";
  releasedAt: string | null;
  competitionReleaseEvidence: CompetitionReleaseEvidence | null;
  rawContentIncluded: false;
  ciphertextIncluded: false;
  projectedAt: string;
}

export interface SocialProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicSocialProjection;
  authorization: SocialProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicSocialProjectionReader {
  refresh(): Promise<void>;
  social(): readonly PublicSocialProjection[];
}

export interface PublicSocialProjectionWriter {
  publish(
    authorization: SocialProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<SocialProjectionRecord>;
}

export interface PublicSocialProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: SocialProjectionEventEnvelope,
  ) => Promise<VerifiedSocialProjectionEvent>;
  now?: () => Date;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<SocialProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  ) {
    throw new Error("Social projection timestamp is not canonical");
  }
  return value;
}

function publicProjection(
  snapshot: DisclosureWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicSocialProjection {
  const envelope = snapshot.envelope;
  const visibility =
    envelope.releasedAt === null ? "SEALED_METADATA" : "RELEASED_COMMITMENT";
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    recognizedGenesisSocial: false,
    envelopeId: snapshot.envelopeId,
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    authorDid: envelope.authorDid,
    classification: envelope.classification,
    contentCommitment: envelope.contentCommitment as `0x${string}`,
    ciphertextCommitment: envelope.ciphertextCommitment as `0x${string}` | null,
    declaredReleaseAt: envelope.declaredReleaseAt,
    competitionCondition: structuredClone(envelope.competitionCondition),
    visibility,
    releasedAt: envelope.releasedAt,
    competitionReleaseEvidence: structuredClone(
      snapshot.competitionReleaseEvidence,
    ),
    rawContentIncluded: false,
    ciphertextIncluded: false,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

function initialState(
  current: DisclosureWorkflowSnapshot | undefined,
  verified: VerifiedSocialProjectionEvent,
): DisclosureWorkflowSnapshot | null {
  if (current === undefined) return verified.priorSnapshot;
  if (
    verified.priorSnapshot !== null &&
    sha256Commitment(current) !== sha256Commitment(verified.priorSnapshot)
  ) {
    throw new Error(
      "Public social history differs from the signed submission proof",
    );
  }
  return current;
}

function advanceSocial(
  current: DisclosureWorkflowSnapshot | undefined,
  verified: VerifiedSocialProjectionEvent,
): DisclosureWorkflowSnapshot {
  const prior = initialState(current, verified);
  const snapshot = applyDisclosureWorkflowTransition(
    prior,
    verified.event,
    verified.payload,
  );
  if (disclosureWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
    throw new Error("Public social projection state root is invalid");
  return snapshot;
}

function precedingEventHash(
  currentHash: string | undefined,
  verified: VerifiedSocialProjectionEvent,
): string | null {
  if (currentHash !== undefined) return currentHash;
  if (verified.priorSnapshot === null) return null;
  if (!("submissionProof" in verified.payload))
    throw new Error("Public social release proof is absent");
  return verified.payload.submissionProof.event.eventHash;
}

export class FilePublicSocialProjectionRepository
  implements PublicSocialProjectionReader, PublicSocialProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicSocialProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: SocialProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #snapshots = new Map<string, DisclosureWorkflowSnapshot>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicSocialProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: SocialProjectionEventEnvelope,
  ): Promise<VerifiedSocialProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public social authorization is invalid");
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
    await mkdir(join(this.#root, "social-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "social-records");
      const records: SocialProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const snapshots = new Map<string, DisclosureWorkflowSnapshot>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as SocialProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const envelopeId = verified.event.aggregateId;
        const priorSnapshot = snapshots.get(envelopeId);
        const priorEventHash = precedingEventHash(
          lastEventHashes.get(envelopeId),
          verified,
        );
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
          throw new Error("Public social chain is corrupt or noncanonical");
        }
        const baseline = initialState(priorSnapshot, verified);
        if (
          BigInt(baseline?.version ?? 0) !== BigInt(verified.expectedVersion)
        ) {
          throw new Error("Public social version chain is noncanonical");
        }
        const snapshot = advanceSocial(priorSnapshot, verified);
        const expected = publicProjection(
          snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public social projection does not match its authorization",
          );

        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        snapshots.set(envelopeId, snapshot);
        lastEventHashes.set(envelopeId, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#snapshots.clear();
      for (const [envelopeId, snapshot] of snapshots)
        this.#snapshots.set(envelopeId, snapshot);
      this.#lastEventHashes.clear();
      for (const [envelopeId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(envelopeId, eventHash);
    });
  }

  public async publish(
    authorization: SocialProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<SocialProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const envelopeId = verified.event.aggregateId;
      const priorSnapshot = this.#snapshots.get(envelopeId);
      const baseline = initialState(priorSnapshot, verified);
      const actual = BigInt(baseline?.version ?? 0);
      const claimedExpected = parseVersion(
        expectedVersion ?? verified.expectedVersion,
        "Expected version",
      );
      if (
        actual !== claimedExpected ||
        verified.event.aggregateVersion !== claimedExpected + 1n
      ) {
        throw new ProjectionVersionConflictError(
          `Expected social version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        precedingEventHash(this.#lastEventHashes.get(envelopeId), verified)
      ) {
        throw new ProjectionVersionConflictError(
          "Social previous event hash is invalid",
        );
      }
      const snapshot = advanceSocial(priorSnapshot, verified);
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
      const record: SocialProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "social-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#snapshots.set(envelopeId, snapshot);
      this.#lastEventHashes.set(envelopeId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public social(): readonly PublicSocialProjection[] {
    const latest = new Map<string, PublicSocialProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.envelopeId, projection);
    return structuredClone([...latest.values()]);
  }
}
