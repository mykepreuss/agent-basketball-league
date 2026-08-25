import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  FoundingBootstrapBallotPayloadSchema,
  applyFoundingBootstrapWorkflowTransition,
  evaluateFoundingBootstrap,
  foundingBootstrapBallotFromAuthorization,
  foundingBootstrapWorkflowStateRoot,
  type FoundingBootstrapWorkflowSnapshot,
  type SignedFoundingBootstrapBallot,
} from "@abl/genesis";
import { sha256Commitment } from "@abl/recognition";
import type { TypedDataDomain } from "viem";

import type {
  FoundingProjectionEventEnvelope,
  VerifiedFoundingProjectionEvent,
} from "./founding-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicFoundingConventionProjection {
  state: "PRE_GENESIS_EXPERIMENT";
  canonical: false;
  recognitionLevel: "SIGNED_VALID";
  recordType: "FOUNDING_CONVENTION_BOOTSTRAP";
  conventionId: string;
  proposalId: string;
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  eligibilitySnapshot: FoundingBootstrapWorkflowSnapshot["snapshot"];
  proposal: FoundingBootstrapWorkflowSnapshot["proposal"];
  ballots: FoundingBootstrapWorkflowSnapshot["ballots"];
  result: FoundingBootstrapWorkflowSnapshot["result"];
  closedAt: string | null;
  previousAttempts: FoundingBootstrapWorkflowSnapshot["previousAttempts"];
  directBallotsOnly: true;
  humanVotingAllowed: false;
  projectedAt: string;
}

export interface FoundingProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicFoundingConventionProjection;
  authorization: FoundingProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicFoundingConventionProjectionReader {
  refresh(): Promise<void>;
  foundingConvention(): readonly PublicFoundingConventionProjection[];
}

export interface PublicFoundingConventionProjectionWriter {
  publish(
    authorization: FoundingProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<FoundingProjectionRecord>;
}

export interface PublicFoundingConventionProjectionRepositoryOptions {
  domain: TypedDataDomain;
  verifyAuthorization: (
    authorization: FoundingProjectionEventEnvelope,
  ) => Promise<VerifiedFoundingProjectionEvent>;
  now?: () => Date;
}

interface FoundingReplayState {
  snapshot: FoundingBootstrapWorkflowSnapshot;
  ballots: SignedFoundingBootstrapBallot[];
  ballotSigners: Map<string, `0x${string}`>;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  }
  return BigInt(value);
}

function recordHash(
  value: Omit<FoundingProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error("Founding-convention projection time is not canonical");
  return value;
}

function publicProjection(
  snapshot: FoundingBootstrapWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicFoundingConventionProjection {
  return {
    state: "PRE_GENESIS_EXPERIMENT",
    canonical: false,
    recognitionLevel: "SIGNED_VALID",
    recordType: "FOUNDING_CONVENTION_BOOTSTRAP",
    conventionId: snapshot.conventionId,
    proposalId: snapshot.proposalId,
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    eligibilitySnapshot: structuredClone(snapshot.snapshot),
    proposal: structuredClone(snapshot.proposal),
    ballots: structuredClone(snapshot.ballots),
    result: structuredClone(snapshot.result),
    closedAt: snapshot.closedAt,
    previousAttempts: structuredClone(snapshot.previousAttempts),
    directBallotsOnly: true,
    humanVotingAllowed: false,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

function registerBallotSigner(
  signers: Map<string, `0x${string}`>,
  voterDid: string,
  signerAddress: `0x${string}`,
): void {
  const prior = signers.get(voterDid);
  if (
    prior !== undefined &&
    prior.toLowerCase() !== signerAddress.toLowerCase()
  ) {
    throw new Error("Founder key changed inside the frozen bootstrap");
  }
  signers.set(voterDid, signerAddress);
}

async function advanceFounding(
  current: FoundingReplayState | undefined,
  verified: VerifiedFoundingProjectionEvent,
  domain: TypedDataDomain,
): Promise<FoundingReplayState> {
  const opened = verified.event.eventType === "FoundingBootstrapOpened";
  const ballots = current === undefined || opened ? [] : [...current.ballots];
  const ballotSigners = new Map(
    current === undefined || opened ? [] : current.ballotSigners,
  );
  let result = null;
  if (verified.event.eventType === "FoundingBootstrapBallotCast") {
    const ballot = FoundingBootstrapBallotPayloadSchema.parse(
      verified.payload,
    ).command;
    registerBallotSigner(
      ballotSigners,
      ballot.voterDid,
      verified.signerAddress,
    );
    ballots.push(
      foundingBootstrapBallotFromAuthorization(
        ballot,
        verified.event,
        verified.envelope.signature,
        verified.signerAddress,
      ),
    );
  } else if (verified.event.eventType === "FoundingBootstrapClosed") {
    if (current === undefined)
      throw new Error("Founding bootstrap close precedes its opening");
    result = await evaluateFoundingBootstrap({
      snapshot: current.snapshot.snapshot,
      proposal: current.snapshot.proposal,
      ballots,
      authorization: {
        domain,
        aggregateId: verified.event.aggregateId,
        signers: ballotSigners,
      },
      evaluatedAt: verified.event.timestamp,
    });
  }
  const snapshot = applyFoundingBootstrapWorkflowTransition(
    current?.snapshot ?? null,
    verified.event,
    verified.payload,
    result,
  );
  if (foundingBootstrapWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
    throw new Error("Public founding-convention state root is invalid");
  return { snapshot, ballots, ballotSigners };
}

export class FilePublicFoundingConventionProjectionRepository
  implements
    PublicFoundingConventionProjectionReader,
    PublicFoundingConventionProjectionWriter
{
  readonly #root: string;
  readonly #domain: TypedDataDomain;
  readonly #verifyAuthorization: PublicFoundingConventionProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: FoundingProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #states = new Map<string, FoundingReplayState>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicFoundingConventionProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#domain = options.domain;
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: FoundingProjectionEventEnvelope,
  ): Promise<VerifiedFoundingProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error(
        "Public founding-convention projection authorization is invalid",
      );
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
    await mkdir(join(this.#root, "founding-convention-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "founding-convention-records");
      const records: FoundingProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const states = new Map<string, FoundingReplayState>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as FoundingProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const conventionId = verified.event.aggregateId;
        const priorState = states.get(conventionId);
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
            (lastEventHashes.get(conventionId) ?? null)
        ) {
          throw new Error(
            "Public founding-convention chain is corrupt or noncanonical",
          );
        }
        const state = await advanceFounding(priorState, verified, this.#domain);
        const expected = publicProjection(
          state.snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public founding-convention projection does not match its authorization",
          );
        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        states.set(conventionId, state);
        lastEventHashes.set(conventionId, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#states.clear();
      for (const [conventionId, state] of states)
        this.#states.set(conventionId, state);
      this.#lastEventHashes.clear();
      for (const [conventionId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(conventionId, eventHash);
    });
  }

  public async publish(
    authorization: FoundingProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<FoundingProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const conventionId = verified.event.aggregateId;
      const priorState = this.#states.get(conventionId);
      const actual = BigInt(priorState?.snapshot.version ?? 0);
      const claimedExpected = parseVersion(
        expectedVersion ?? verified.expectedVersion,
        "Expected version",
      );
      if (
        actual !== claimedExpected ||
        verified.event.aggregateVersion !== claimedExpected + 1n
      ) {
        throw new ProjectionVersionConflictError(
          `Expected founding-convention version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(conventionId) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Founding-convention previous event hash is invalid",
        );
      }
      const state = await advanceFounding(priorState, verified, this.#domain);
      const projection = publicProjection(
        state.snapshot,
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
      const record: FoundingProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "founding-convention-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#states.set(conventionId, state);
      this.#lastEventHashes.set(conventionId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public foundingConvention(): readonly PublicFoundingConventionProjection[] {
    const latest = new Map<string, PublicFoundingConventionProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.conventionId, projection);
    return structuredClone([...latest.values()]);
  }
}
