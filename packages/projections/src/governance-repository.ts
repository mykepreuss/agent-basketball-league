import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  GovernanceBallotPayloadSchema,
  GovernanceWorkflowAuthorizationError,
  applyGovernanceWorkflowTransition,
  evaluateGovernanceWorkflowDecision,
  governanceVoteFromAuthorization,
  governanceWorkflowStateRoot,
  type EligibilitySnapshot,
  type GovernanceBallotCommand,
  type GovernanceDecision,
  type GovernanceProposalCommand,
  type GovernanceVote,
  type GovernanceWorkflowSnapshot,
  type InstitutionalAuthorizationContext,
  type InstitutionalSigner,
  type ResourceScheduleRatification,
  type ResourceScheduleRatificationReader,
} from "@abl/institutions";
import { sha256Commitment } from "@abl/recognition";
import type { TypedDataDomain } from "viem";

import type {
  GovernanceProjectionEventEnvelope,
  VerifiedGovernanceProjectionEvent,
} from "./governance-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicGovernanceProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  proposalId: string;
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  proposal: GovernanceProposalCommand;
  eligibilitySnapshot: EligibilitySnapshot;
  recusedDids: string[];
  ballots: GovernanceBallotCommand[];
  decision: GovernanceDecision | null;
  closedAt: string | null;
  projectedAt: string;
}

export interface GovernanceProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicGovernanceProjection;
  authorization: GovernanceProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicGovernanceProjectionReader {
  refresh(): Promise<void>;
  governance(): readonly PublicGovernanceProjection[];
}

export interface PublicGovernanceProjectionWriter {
  publish(
    authorization: GovernanceProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<GovernanceProjectionRecord>;
}

export interface PublicGovernanceRatificationReader
  extends ResourceScheduleRatificationReader {}

export interface PublicGovernanceProjectionRepositoryOptions {
  domain: TypedDataDomain;
  verifyAuthorization: (
    authorization: GovernanceProjectionEventEnvelope,
  ) => Promise<VerifiedGovernanceProjectionEvent>;
  now?: () => Date;
}

interface MutableAuthorization
  extends Omit<InstitutionalAuthorizationContext, "signers"> {
  signers: Map<string, InstitutionalSigner>;
}

interface GovernanceReplayState {
  snapshot: GovernanceWorkflowSnapshot;
  votes: GovernanceVote[];
  authorization: MutableAuthorization;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<GovernanceProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error("Governance projection timestamp is not canonical");
  return value;
}

function publicProjection(
  snapshot: GovernanceWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicGovernanceProjection {
  return {
    state: "REHEARSAL",
    canonical: true,
    verification: "CANONICAL_LOCAL_REHEARSAL",
    proposalId: snapshot.proposalId,
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    proposal: structuredClone(snapshot.proposal),
    eligibilitySnapshot: structuredClone(snapshot.eligibilitySnapshot),
    recusedDids: [...snapshot.recusedDids],
    ballots: structuredClone(snapshot.ballots),
    decision: structuredClone(snapshot.decision),
    closedAt: snapshot.closedAt,
    projectedAt: canonicalProjectedAt(projectedAt),
  };
}

function registerVoter(
  authorization: MutableAuthorization,
  voterDid: string,
  signerAddress: `0x${string}`,
): void {
  const prior = authorization.signers.get(voterDid);
  if (
    prior !== undefined &&
    prior.signerAddress.toLowerCase() !== signerAddress.toLowerCase()
  ) {
    throw new GovernanceWorkflowAuthorizationError(
      "Governance voter key changed inside a frozen proposal",
    );
  }
  authorization.signers.set(voterDid, {
    signerAddress,
    roles: ["VOTER"],
  });
}

async function advanceGovernance(
  current: GovernanceReplayState | undefined,
  verified: VerifiedGovernanceProjectionEvent,
  domain: TypedDataDomain,
): Promise<GovernanceReplayState> {
  const votes = current === undefined ? [] : [...current.votes];
  const authorization: MutableAuthorization = {
    domain,
    signers: new Map(current?.authorization.signers ?? []),
  };
  let decision: GovernanceDecision | null = null;
  if (verified.event.eventType === "GovernanceBallotCast") {
    const ballot = GovernanceBallotPayloadSchema.parse(
      verified.payload,
    ).command;
    registerVoter(authorization, ballot.voterDid, verified.signerAddress);
    votes.push(
      governanceVoteFromAuthorization(
        ballot,
        verified.event,
        verified.envelope.signature,
        verified.signerAddress,
      ),
    );
  } else if (verified.event.eventType === "GovernanceProposalClosed") {
    if (current === undefined)
      throw new Error("Governance close precedes its proposal");
    decision = await evaluateGovernanceWorkflowDecision(
      current.snapshot,
      votes,
      authorization,
    );
  }
  const snapshot = applyGovernanceWorkflowTransition(
    current?.snapshot ?? null,
    verified.event,
    verified.payload,
    decision,
  );
  if (governanceWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
    throw new Error("Public governance projection state root is invalid");
  return { snapshot, votes, authorization };
}

export class FilePublicGovernanceProjectionRepository
  implements
    PublicGovernanceProjectionReader,
    PublicGovernanceProjectionWriter,
    PublicGovernanceRatificationReader
{
  readonly #root: string;
  readonly #domain: TypedDataDomain;
  readonly #verifyAuthorization: PublicGovernanceProjectionRepositoryOptions["verifyAuthorization"];
  readonly #now: () => Date;
  readonly #records: GovernanceProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #states = new Map<string, GovernanceReplayState>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicGovernanceProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#domain = options.domain;
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: GovernanceProjectionEventEnvelope,
  ): Promise<VerifiedGovernanceProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error("Public governance projection authorization is invalid");
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
    await mkdir(join(this.#root, "governance-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "governance-records");
      const records: GovernanceProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const states = new Map<string, GovernanceReplayState>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();

      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as GovernanceProjectionRecord;
        const priorRecord = records.at(-1);
        const verified = await this.#verify(record.authorization);
        const proposalId = verified.event.aggregateId;
        const priorState = states.get(proposalId);
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
            (lastEventHashes.get(proposalId) ?? null)
        ) {
          throw new Error(
            "Public governance projection chain is corrupt or noncanonical",
          );
        }
        const state = await advanceGovernance(
          priorState,
          verified,
          this.#domain,
        );
        const expected = publicProjection(
          state.snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public governance projection does not match its authorization",
          );

        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        states.set(proposalId, state);
        lastEventHashes.set(proposalId, verified.event.eventHash);
      }

      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
      this.#states.clear();
      for (const [proposalId, state] of states)
        this.#states.set(proposalId, state);
      this.#lastEventHashes.clear();
      for (const [proposalId, eventHash] of lastEventHashes)
        this.#lastEventHashes.set(proposalId, eventHash);
    });
  }

  public async publish(
    authorization: GovernanceProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<GovernanceProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);

      const proposalId = verified.event.aggregateId;
      const priorState = this.#states.get(proposalId);
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
          `Expected governance projection version ${claimedExpected}, received ${actual}`,
        );
      }
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(proposalId) ?? null)
      ) {
        throw new ProjectionVersionConflictError(
          "Governance projection previous event hash is invalid",
        );
      }
      const state = await advanceGovernance(priorState, verified, this.#domain);
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
      const record: GovernanceProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "governance-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      this.#states.set(proposalId, state);
      this.#lastEventHashes.set(proposalId, verified.event.eventHash);
      return structuredClone(record);
    });
  }

  public governance(): readonly PublicGovernanceProjection[] {
    const latest = new Map<string, PublicGovernanceProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.proposalId, projection);
    return structuredClone([...latest.values()]);
  }

  public async resourceScheduleRatification(
    proposalId: string,
  ): Promise<ResourceScheduleRatification | null> {
    const state = this.#states.get(proposalId)?.snapshot;
    if (state?.decision === null || state?.decision === undefined) return null;
    const closeRecord = this.#records.find(
      (record) =>
        record.projection.proposalId === proposalId &&
        record.authorization.event.eventType === "GovernanceProposalClosed",
    );
    if (closeRecord === undefined) return null;
    return {
      proposalId,
      proposalClass: state.proposal.proposalClass,
      executableChangeDigest: state.proposal.executableChangeDigest,
      passed: state.decision.passed,
      closeEventId: closeRecord.authorization.event.eventId,
    };
  }
}
