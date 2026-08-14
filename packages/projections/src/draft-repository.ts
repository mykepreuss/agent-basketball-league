import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { PremierDraftCompletedPayload } from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import type {
  DraftProjectionEventEnvelope,
  VerifiedDraftProjectionEvent,
} from "./draft-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicDraftSelection {
  overall: number;
  round: number;
  slot: number;
  playerDid: string;
  combineScoreBps: number;
  combineResultEventHash: `0x${string}`;
  selectionStatus: "DRAFTED_NO_PLAYING_RIGHTS";
  requiresPlayerContractConsent: true;
}

export interface PublicDraftRosterProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL";
  rosterKind: "DRAFT_SELECTIONS";
  rosterStatus: "DRAFT_SELECTIONS_NOT_ACTIVE";
  clubId: string;
  draftId: string;
  selections: readonly PublicDraftSelection[];
  rosterCommitment: `0x${string}`;
  projectedAt: string;
}

export interface PublicDraftProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  recognizedGenesisDraft: false;
  projectionKind: "PREMIER_DRAFT";
  draftId: string;
  aggregateVersion: "1";
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  combineId: string;
  combineHeadEventHash: `0x${string}`;
  clubOrder: readonly string[];
  playerOrder: readonly string[];
  picks: PremierDraftCompletedPayload["picks"];
  draftEvidenceCommitment: `0x${string}`;
  completedAt: string;
  rosters: readonly PublicDraftRosterProjection[];
  projectedAt: string;
}

export interface DraftProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicDraftProjection;
  authorization: DraftProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicDraftProjectionReader {
  refresh(): Promise<void>;
  drafts(): readonly PublicDraftProjection[];
  rosters(): readonly PublicDraftRosterProjection[];
}

export interface PublicDraftProjectionWriter {
  publish(
    authorization: DraftProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<DraftProjectionRecord>;
}

export interface PublicDraftProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: DraftProjectionEventEnvelope,
  ) => Promise<VerifiedDraftProjectionEvent>;
  now?: () => Date;
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  ) {
    throw new Error("Draft projection timestamp is not canonical");
  }
  return value;
}

function draftRosters(
  payload: PremierDraftCompletedPayload,
  projectedAt: string,
): PublicDraftRosterProjection[] {
  const resultByPlayer = new Map(
    payload.combineResults.map((result) => [result.playerDid, result]),
  );
  return payload.clubOrder.map((clubId) => {
    const selections = payload.picks
      .filter((pick) => pick.clubId === clubId)
      .map((pick): PublicDraftSelection => {
        const result = resultByPlayer.get(pick.playerDid);
        if (result === undefined)
          throw new Error("Draft pick lacks a combine-result proof");
        return {
          overall: pick.overall,
          round: pick.round,
          slot: pick.slot,
          playerDid: pick.playerDid,
          combineScoreBps: result.scoreBps,
          combineResultEventHash: result.eventHash as `0x${string}`,
          selectionStatus: "DRAFTED_NO_PLAYING_RIGHTS",
          requiresPlayerContractConsent: true,
        };
      });
    return {
      state: "REHEARSAL",
      canonical: true,
      verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL",
      rosterKind: "DRAFT_SELECTIONS",
      rosterStatus: "DRAFT_SELECTIONS_NOT_ACTIVE",
      clubId,
      draftId: payload.draftId,
      selections,
      rosterCommitment: sha256Commitment({
        format: "ABL-PUBLIC-DRAFT-ROSTER-PROJECTION-V1",
        clubId,
        draftId: payload.draftId,
        selections,
      }),
      projectedAt,
    };
  });
}

function publicProjection(
  verified: VerifiedDraftProjectionEvent,
  projectedAtValue: string,
): PublicDraftProjection {
  const projectedAt = canonicalProjectedAt(projectedAtValue);
  const { event, payload } = verified;
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    recognizedGenesisDraft: false,
    projectionKind: "PREMIER_DRAFT",
    draftId: payload.draftId,
    aggregateVersion: "1",
    canonicalEventHash: event.eventHash as `0x${string}`,
    stateRoot: event.stateRoot as `0x${string}`,
    combineId: payload.combineId,
    combineHeadEventHash: payload.combineHeadEventHash as `0x${string}`,
    clubOrder: structuredClone(payload.clubOrder),
    playerOrder: structuredClone(payload.playerOrder),
    picks: structuredClone(payload.picks),
    draftEvidenceCommitment: payload.draftEvidenceCommitment as `0x${string}`,
    completedAt: payload.completedAt,
    rosters: draftRosters(payload, projectedAt),
    projectedAt,
  };
}

function recordHash(
  value: Omit<DraftProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

export class FilePublicDraftProjectionRepository
  implements PublicDraftProjectionReader, PublicDraftProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicDraftProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: DraftProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicDraftProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: DraftProjectionEventEnvelope,
  ): Promise<VerifiedDraftProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public draft projection authorization is invalid");
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
    await mkdir(join(this.#root, "draft-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const root = join(this.#root, "draft-records");
      const records: DraftProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const draftIds = new Set<string>();
      const filenames = (await readdir(root))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(root, filename), "utf8"),
        ) as DraftProjectionRecord;
        const prior = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const expectedProjection = publicProjection(
          verified,
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
            sha256Commitment(expectedProjection) ||
          eventCursors.has(verified.event.eventHash) ||
          draftIds.has(verified.payload.draftId)
        ) {
          throw new Error("Public draft projection chain is corrupt");
        }
        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        draftIds.add(verified.payload.draftId);
      }
      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
    });
  }

  public async publish(
    authorization: DraftProjectionEventEnvelope,
    expectedVersion = "0",
    projectedAt = this.#now().toISOString(),
  ): Promise<DraftProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);
      if (
        expectedVersion !== "0" ||
        verified.expectedVersion !== "0" ||
        this.#records.some(
          ({ projection }) => projection.draftId === verified.payload.draftId,
        )
      ) {
        throw new ProjectionVersionConflictError(
          "Premier draft already exists or has a nonzero predecessor",
        );
      }
      const projection = publicProjection(verified, projectedAt);
      const prior = this.#records.at(-1);
      const withoutHash = {
        cursor: this.#records.length,
        previousRecordHash: prior?.recordHash ?? null,
        projection,
        authorization: structuredClone(authorization),
      };
      const record: DraftProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "draft-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      return structuredClone(record);
    });
  }

  public drafts(): readonly PublicDraftProjection[] {
    return structuredClone(this.#records.map(({ projection }) => projection));
  }

  public rosters(): readonly PublicDraftRosterProjection[] {
    return structuredClone(
      this.#records.flatMap(({ projection }) => projection.rosters),
    );
  }
}
