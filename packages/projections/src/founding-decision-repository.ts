import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  FoundingDecisionBallotPayloadSchema,
  FoundingDecisionOpenPayloadSchema,
  applyFoundingDecisionWorkflowTransition,
  evaluateFoundingDecision,
  foundingDecisionWorkflowStateRoot,
  type FoundingDecisionWorkflowSnapshot,
  type FoundingQuorumRule,
  type SignedFoundingDecisionBallot,
} from "@abl/genesis";
import { sha256Commitment } from "@abl/recognition";
import type { TypedDataDomain } from "viem";

import type {
  FoundingDecisionProjectionEventEnvelope,
  VerifiedFoundingDecisionProjectionEvent,
} from "./founding-decision-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicFoundingDecisionProjection {
  state: "PRE_GENESIS_EXPERIMENT";
  canonical: false;
  recognitionLevel: "SIGNED_VALID";
  recordType: "FOUNDING_CONVENTION_DECISION";
  conventionId: string;
  proposalId: string;
  topic: FoundingDecisionWorkflowSnapshot["proposal"]["topic"];
  disposition: FoundingDecisionWorkflowSnapshot["proposal"]["disposition"];
  artifactUri: string;
  artifactDigest: `0x${string}`;
  aggregateVersion: string;
  canonicalEventHash: `0x${string}`;
  stateRoot: `0x${string}`;
  eligibilitySnapshot: FoundingDecisionWorkflowSnapshot["snapshot"];
  proposal: FoundingDecisionWorkflowSnapshot["proposal"];
  ballots: FoundingDecisionWorkflowSnapshot["ballots"];
  result: FoundingDecisionWorkflowSnapshot["result"];
  directBallotsOnly: true;
  humanVotingAllowed: false;
  projectedAt: string;
}

export interface FoundingDecisionProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicFoundingDecisionProjection;
  authorization: FoundingDecisionProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicFoundingDecisionProjectionReader {
  refresh(): Promise<void>;
  foundingDecisions(): readonly PublicFoundingDecisionProjection[];
}

export interface PublicFoundingDecisionProjectionWriter {
  publish(
    authorization: FoundingDecisionProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<FoundingDecisionProjectionRecord>;
}

export interface PublicFoundingDecisionProjectionRepositoryOptions {
  domain: TypedDataDomain;
  verifyAuthorization: (
    authorization: FoundingDecisionProjectionEventEnvelope,
  ) => Promise<VerifiedFoundingDecisionProjectionEvent>;
  adoptedQuorumRule: (conventionId: string) => FoundingQuorumRule | null;
  now?: () => Date;
}

interface DecisionReplayState {
  snapshot: FoundingDecisionWorkflowSnapshot;
  ballots: SignedFoundingDecisionBallot[];
  ballotSigners: Map<string, `0x${string}`>;
}

function parseVersion(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new ProjectionVersionConflictError(`${label} is not canonical`);
  return BigInt(value);
}

function recordHash(
  value: Omit<FoundingDecisionProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function canonicalProjectedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    value !== new Date(timestamp).toISOString()
  )
    throw new Error("Founding-decision projection time is not canonical");
  return value;
}

function publicProjection(
  snapshot: FoundingDecisionWorkflowSnapshot,
  eventHash: string,
  stateRoot: string,
  projectedAt: string,
): PublicFoundingDecisionProjection {
  return {
    state: "PRE_GENESIS_EXPERIMENT",
    canonical: false,
    recognitionLevel: "SIGNED_VALID",
    recordType: "FOUNDING_CONVENTION_DECISION",
    conventionId: snapshot.proposal.conventionId,
    proposalId: snapshot.proposal.proposalId,
    topic: snapshot.proposal.topic,
    disposition: snapshot.proposal.disposition,
    artifactUri: snapshot.proposal.artifactUri,
    artifactDigest: snapshot.proposal.artifactDigest,
    aggregateVersion: snapshot.version.toString(),
    canonicalEventHash: eventHash as `0x${string}`,
    stateRoot: stateRoot as `0x${string}`,
    eligibilitySnapshot: structuredClone(snapshot.snapshot),
    proposal: structuredClone(snapshot.proposal),
    ballots: structuredClone(snapshot.ballots),
    result: structuredClone(snapshot.result),
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
  )
    throw new Error("Founder key changed inside the frozen decision");
  signers.set(voterDid, signerAddress);
}

async function advanceDecision(
  current: DecisionReplayState | undefined,
  verified: VerifiedFoundingDecisionProjectionEvent,
  domain: TypedDataDomain,
  adoptedQuorumRule: (conventionId: string) => FoundingQuorumRule | null,
): Promise<DecisionReplayState> {
  const ballots = current === undefined ? [] : [...current.ballots];
  const ballotSigners = new Map(current?.ballotSigners ?? []);
  let result = null;
  if (verified.event.eventType === "FoundingDecisionProposed") {
    const opened = FoundingDecisionOpenPayloadSchema.parse(verified.payload);
    const adopted = adoptedQuorumRule(opened.proposal.conventionId);
    if (
      adopted === null ||
      sha256Commitment(adopted) !== sha256Commitment(opened.quorumRule)
    )
      throw new Error("Founding decision does not use the adopted quorum rule");
  } else if (verified.event.eventType === "FoundingDecisionBallotCast") {
    const ballot = FoundingDecisionBallotPayloadSchema.parse(
      verified.payload,
    ).command;
    registerBallotSigner(
      ballotSigners,
      ballot.voterDid,
      verified.signerAddress,
    );
    ballots.push({
      ballot,
      authorizationEvent:
        verified.event as SignedFoundingDecisionBallot["authorizationEvent"],
      signature: verified.envelope.signature as `0x${string}`,
      signerAddress: verified.signerAddress,
    });
  } else if (verified.event.eventType === "FoundingDecisionClosed") {
    if (current === undefined)
      throw new Error("Founding decision close precedes its proposal");
    result = await evaluateFoundingDecision({
      proposal: current.snapshot.proposal,
      snapshot: current.snapshot.snapshot,
      quorumRule: current.snapshot.quorumRule,
      ballots,
      authorization: { domain, signers: ballotSigners },
      evaluatedAt: verified.event.timestamp,
      ratificationEventId: verified.event.eventId,
    });
  }
  const snapshot = applyFoundingDecisionWorkflowTransition(
    current?.snapshot ?? null,
    verified.event,
    verified.payload,
    result,
  );
  if (foundingDecisionWorkflowStateRoot(snapshot) !== verified.event.stateRoot)
    throw new Error("Public founding-decision state root is invalid");
  return { snapshot, ballots, ballotSigners };
}

export class FilePublicFoundingDecisionProjectionRepository
  implements
    PublicFoundingDecisionProjectionReader,
    PublicFoundingDecisionProjectionWriter
{
  readonly #root: string;
  readonly #domain: TypedDataDomain;
  readonly #verifyAuthorization: PublicFoundingDecisionProjectionRepositoryOptions["verifyAuthorization"];
  readonly #adoptedQuorumRule: PublicFoundingDecisionProjectionRepositoryOptions["adoptedQuorumRule"];
  readonly #now: () => Date;
  readonly #records: FoundingDecisionProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  readonly #states = new Map<string, DecisionReplayState>();
  readonly #lastEventHashes = new Map<string, string>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: PublicFoundingDecisionProjectionRepositoryOptions,
  ) {
    this.#root = resolve(root);
    this.#domain = options.domain;
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#adoptedQuorumRule = options.adoptedQuorumRule;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: FoundingDecisionProjectionEventEnvelope,
  ): Promise<VerifiedFoundingDecisionProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization);
    } catch {
      throw new Error(
        "Public founding-decision projection authorization is invalid",
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
    await mkdir(join(this.#root, "founding-decision-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const recordsRoot = join(this.#root, "founding-decision-records");
      const records: FoundingDecisionProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const states = new Map<string, DecisionReplayState>();
      const lastEventHashes = new Map<string, string>();
      const filenames = (await readdir(recordsRoot))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(recordsRoot, filename), "utf8"),
        ) as FoundingDecisionProjectionRecord;
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
        )
          throw new Error(
            "Public founding-decision chain is corrupt or noncanonical",
          );
        const state = await advanceDecision(
          priorState,
          verified,
          this.#domain,
          this.#adoptedQuorumRule,
        );
        const expected = publicProjection(
          state.snapshot,
          verified.event.eventHash,
          verified.event.stateRoot,
          record.projection.projectedAt,
        );
        if (sha256Commitment(expected) !== sha256Commitment(record.projection))
          throw new Error(
            "Public founding-decision projection does not match its authorization",
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
    authorization: FoundingDecisionProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<FoundingDecisionProjectionRecord> {
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
      )
        throw new ProjectionVersionConflictError(
          `Expected founding-decision version ${claimedExpected}, received ${actual}`,
        );
      if (
        verified.event.previousEventHash !==
        (this.#lastEventHashes.get(proposalId) ?? null)
      )
        throw new ProjectionVersionConflictError(
          "Founding-decision previous event hash is invalid",
        );
      const state = await advanceDecision(
        priorState,
        verified,
        this.#domain,
        this.#adoptedQuorumRule,
      );
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
      const record: FoundingDecisionProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "founding-decision-records",
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

  public foundingDecisions(): readonly PublicFoundingDecisionProjection[] {
    const latest = new Map<string, PublicFoundingDecisionProjection>();
    for (const { projection } of this.#records)
      latest.set(projection.proposalId, projection);
    return structuredClone([...latest.values()]);
  }
}
