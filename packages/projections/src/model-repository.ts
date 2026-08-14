import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  modelConcentration,
  type ModelDependencyRecord,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";

import { writeImmutableJson } from "./immutable-json.js";
import type {
  ModelProjectionEventEnvelope,
  VerifiedModelProjectionEvent,
} from "./model-envelope.js";
import { ProjectionVersionConflictError } from "./repository.js";

type Concentration = ReturnType<typeof modelConcentration>;
type ModelCareerHead = {
  hash: string;
  version: bigint;
  signerAddress: string;
};

export interface PublicModelConcentrationProjection extends Concentration {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  recognizedGenesisConcentration: false;
  canonicalEventHash: `0x${string}`;
  projectedAt: string;
}

export interface ModelProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicModelConcentrationProjection;
  authorization: ModelProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicModelProjectionReader {
  refresh(): Promise<void>;
  models(): readonly PublicModelConcentrationProjection[];
}

export interface PublicModelProjectionWriter {
  publish(
    authorization: ModelProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ModelProjectionRecord>;
}

export interface PublicModelProjectionRepositoryOptions {
  verifyAuthorization: (
    authorization: ModelProjectionEventEnvelope,
  ) => Promise<VerifiedModelProjectionEvent>;
  now?: () => Date;
}

function recordHash(
  value: Omit<ModelProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error(
      "Model concentration projection timestamp is not canonical",
    );
  return value;
}

function emptyConcentration(): Concentration {
  return {
    totalAgents: 0,
    exactModel: [],
    family: [],
    provider: [],
    runtimeArchitecture: [],
    gateway: [],
    upstreamDependency: [],
    triggers: {
      alternateAdaptersAndRecruitment: false,
      integrityStudyAndCompetitiveReview: false,
      presumptionAgainstFurtherAdmissions: false,
      forceExistingAgentsToChange: false,
    },
  };
}

function report(
  active: ReadonlyMap<string, ModelDependencyRecord>,
  eventHash: string,
  projectedAt: string,
): PublicModelConcentrationProjection {
  const concentration =
    active.size === 0
      ? emptyConcentration()
      : modelConcentration([...active.values()]);
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    recognizedGenesisConcentration: false,
    ...concentration,
    canonicalEventHash: eventHash as `0x${string}`,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

function dependencyRecord(
  verified: Extract<VerifiedModelProjectionEvent, { action: "ADMIT" }>,
): ModelDependencyRecord {
  return {
    agentDid: verified.event.actorDid,
    ...structuredClone(verified.payload.admission.modelDependencies),
  };
}

function applyVerified(
  active: Map<string, ModelDependencyRecord>,
  lastEvents: Map<string, ModelCareerHead>,
  verified: VerifiedModelProjectionEvent,
): void {
  const agentDid = verified.event.actorDid;
  const prior = lastEvents.get(agentDid);
  if (verified.action === "ADMIT") {
    const aliasesExistingCareer = [...lastEvents.entries()].some(
      ([existingDid, event]) =>
        existingDid !== agentDid &&
        event.signerAddress.toLowerCase() ===
          verified.signerAddress.toLowerCase(),
    );
    if (active.has(agentDid) || prior !== undefined || aliasesExistingCareer)
      throw new ProjectionVersionConflictError(
        "Model dependency admission aliases projected career authority",
      );
  } else {
    if (
      !active.has(agentDid) ||
      prior === undefined ||
      verified.signerAddress.toLowerCase() !==
        prior.signerAddress.toLowerCase() ||
      verified.event.previousEventHash !== prior.hash ||
      verified.event.aggregateVersion !== prior.version + 1n
    ) {
      throw new ProjectionVersionConflictError(
        "Model dependency revocation does not follow its admission",
      );
    }
  }
  if (verified.action === "ADMIT")
    active.set(agentDid, dependencyRecord(verified));
  else active.delete(agentDid);
  lastEvents.set(agentDid, {
    hash: verified.event.eventHash,
    version: verified.event.aggregateVersion,
    signerAddress: verified.signerAddress,
  });
}

export class FilePublicModelProjectionRepository
  implements PublicModelProjectionReader, PublicModelProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: PublicModelProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: ModelProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #active = new Map<string, ModelDependencyRecord>();
  readonly #lastEvents = new Map<string, ModelCareerHead>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicModelProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: ModelProjectionEventEnvelope,
  ): Promise<VerifiedModelProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public model dependency authorization is invalid");
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
    await mkdir(join(this.#root, "model-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const records: ModelProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const active = new Map<string, ModelDependencyRecord>();
      const lastEvents = new Map<string, ModelCareerHead>();
      const recordsRoot = join(this.#root, "model-records");
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as ModelProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
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
          eventCursors.has(verified.event.eventHash)
        ) {
          throw new Error(
            "Public model dependency chain is corrupt or noncanonical",
          );
        }
        applyVerified(active, lastEvents, verified);
        const expected = report(
          active,
          verified.event.eventHash,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public model concentration does not match its authorization",
          );
        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#active.clear();
      for (const [agentDid, dependency] of active)
        this.#active.set(agentDid, dependency);
      this.#lastEvents.clear();
      for (const [agentDid, event] of lastEvents)
        this.#lastEvents.set(agentDid, event);
    });
  }

  public async publish(
    authorization: ModelProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<ModelProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);
      if (
        expectedVersion !== undefined &&
        expectedVersion !== verified.expectedVersion
      )
        throw new ProjectionVersionConflictError(
          "Expected version does not precede model dependency event",
        );

      const nextActive = new Map(this.#active);
      const nextLastEvents = new Map(this.#lastEvents);
      applyVerified(nextActive, nextLastEvents, verified);
      const projection = report(
        nextActive,
        verified.event.eventHash,
        projectedAt ?? this.#now().toISOString(),
      );
      const priorRecord = this.#records.at(-1);
      const withoutHash = {
        cursor: this.#records.length,
        previousRecordHash: priorRecord?.recordHash ?? null,
        projection,
        authorization: structuredClone(authorization),
      };
      const record: ModelProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "model-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#active.clear();
      for (const [agentDid, dependency] of nextActive)
        this.#active.set(agentDid, dependency);
      this.#lastEvents.clear();
      for (const [agentDid, event] of nextLastEvents)
        this.#lastEvents.set(agentDid, event);
      return structuredClone(record);
    });
  }

  public models(): readonly PublicModelConcentrationProjection[] {
    const latest = this.#records.at(-1)?.projection;
    return latest === undefined ? [] : [structuredClone(latest)];
  }
}
