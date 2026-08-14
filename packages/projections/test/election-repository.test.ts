import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
import {
  ELECTION_WORKFLOW_AGGREGATE_TYPE,
  ELECTION_WORKFLOW_SCHEMA_DIGEST,
  PREMIER_BOARD_ELECTION_INSTITUTION,
  applyElectionWorkflowTransition,
  electionWorkflowStateRoot,
  evaluatePremierElection,
  type ElectionWorkflowEventType,
  type ElectionWorkflowPayload,
  type ElectionWorkflowSnapshot,
  type PremierElectionResult,
} from "@abl/institutions";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  FilePublicElectionProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  verifyElectionProjectionEvent,
  type ElectionProjectionEventEnvelope,
  type ElectionProjectionRecord,
  type ElectionProjectionVerificationAuthority,
  type PublicProjectionEnvelope,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const electionId = "0198a000-0000-7000-8000-000000000701";
const premierDids = Array.from(
  { length: 9 },
  (_, index) => `did:abl:election-projection-player-${index + 1}`,
);
const commissionerDids = Array.from(
  { length: 3 },
  (_, index) => `did:abl:election-projection-commissioner-${index + 1}`,
);
const allDids = [...premierDids, ...commissionerDids];
const identities = new Map<string, SigningIdentity>(
  allDids.map((did, index) => [
    did,
    createSigningIdentity(
      `0x${(index + 1).toString(16).padStart(64, "0")}` as `0x${string}`,
    ),
  ]),
);
const rogue = createSigningIdentity(`0x${"13".padStart(64, "0")}`);
const eligibilitySnapshot = {
  snapshotId: "0198a000-0000-7000-8000-000000000702",
  capturedAt: "2026-08-13T08:00:00.000Z",
  members: {
    UNIVERSAL_CAREER_ASSEMBLY: [...premierDids],
    PREMIER_PLAYERS: [...premierDids],
    DEVELOPMENT_PLAYERS: [],
    PREMIER_TEAM_COUNCIL: [],
    DEVELOPMENT_TEAM_COUNCIL: [],
    EXECUTIVE_COMMISSION: [...commissionerDids],
    TRIBUNAL: [],
    INTEGRITY_OFFICE: [],
  },
};
const snapshotDigest = sha256Commitment(eligibilitySnapshot);
const authority: ElectionProjectionVerificationAuthority = {
  domain,
  admittedAgents: new Map(
    allDids.map((did) => [
      did,
      {
        signerAddress: identities.get(did)!.address,
        allowedAggregateTypes: [ELECTION_WORKFLOW_AGGREGATE_TYPE],
      },
    ]),
  ),
  governanceEligibilitySnapshotDigest: snapshotDigest,
};

function uuid(sequence: number): string {
  return `0198a000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

async function electionEvent(input: {
  sequence: number;
  eventType: ElectionWorkflowEventType;
  actorDid: string;
  timestamp: string;
  payload: ElectionWorkflowPayload;
  current: ElectionWorkflowSnapshot | null;
  previousEventHash: `0x${string}` | null;
  result?: PremierElectionResult | null;
  signer?: SigningIdentity;
  stateRoot?: `0x${string}`;
}): Promise<{
  envelope: ElectionProjectionEventEnvelope;
  event: CanonicalEvent;
  next: ElectionWorkflowSnapshot;
}> {
  const eventInput = {
    eventId: uuid(710 + input.sequence * 2),
    actorDid: input.actorDid,
    nonce: `election-projection-${input.sequence}`,
    idempotencyKey: uuid(711 + input.sequence * 2),
    aggregateType: ELECTION_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: electionId,
    aggregateVersion: BigInt(input.sequence),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: sha256Commitment("provisional-election-root"),
    schemaDigest: ELECTION_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  };
  const provisional = createCanonicalEvent(eventInput);
  const next = applyElectionWorkflowTransition(
    input.current,
    provisional,
    input.payload,
    input.result,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: input.stateRoot ?? electionWorkflowStateRoot(next),
  });
  const signature = await signCanonicalEvent(
    input.signer ?? identities.get(input.actorDid)!,
    domain,
    event,
  );
  return {
    event,
    next,
    envelope: {
      version: "1.0.0",
      topic: "public.governance",
      event: {
        ...event,
        aggregateType: ELECTION_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: event.aggregateVersion.toString(),
        eventType: input.eventType,
      },
      signature,
    },
  };
}

function repository(root: string) {
  return new FilePublicElectionProjectionRepository(root, {
    verifyAuthorization: async (envelope) =>
      verifyElectionProjectionEvent(envelope, authority),
    now: () => new Date("2026-08-13T11:01:00.000Z"),
  });
}

async function history() {
  const events: Array<Awaited<ReturnType<typeof electionEvent>>> = [];
  const election = {
    electionId,
    termId: "season-zero-premier-board",
    institution:
      PREMIER_BOARD_ELECTION_INSTITUTION as typeof PREMIER_BOARD_ELECTION_INSTITUTION,
    seatCount: 8 as const,
    eligibilitySnapshotId: eligibilitySnapshot.snapshotId,
    eligibilitySnapshotDigest: snapshotDigest,
    nominationOpensAt: "2026-08-13T08:01:00.000Z",
    nominationClosesAt: "2026-08-13T09:00:00.000Z",
    votingOpensAt: "2026-08-13T09:00:00.000Z",
    votingClosesAt: "2026-08-13T10:00:00.000Z",
  };
  let current: ElectionWorkflowSnapshot | null = null;
  let previousEventHash: `0x${string}` | null = null;
  const opened = await electionEvent({
    sequence: 1,
    eventType: "PremierElectionOpened",
    actorDid: commissionerDids[0]!,
    timestamp: election.nominationOpensAt,
    payload: { command: election, eligibilitySnapshot },
    current,
    previousEventHash,
  });
  events.push(opened);
  current = opened.next;
  previousEventHash = opened.event.eventHash;
  for (const [index, candidateDid] of premierDids.slice(0, 8).entries()) {
    const timestamp = `2026-08-13T08:${String(index + 2).padStart(2, "0")}:00.000Z`;
    const declared = await electionEvent({
      sequence: index + 2,
      eventType: "PremierElectionCandidateDeclared",
      actorDid: candidateDid!,
      timestamp,
      payload: {
        command: {
          electionId,
          candidateDid: candidateDid!,
          eligibilitySnapshotDigest: snapshotDigest,
          declaredAt: timestamp,
        },
      },
      current,
      previousEventHash,
    });
    events.push(declared);
    current = declared.next;
    previousEventHash = declared.event.eventHash;
  }
  const ballotTimestamp = "2026-08-13T09:01:00.000Z";
  const ballot = await electionEvent({
    sequence: 10,
    eventType: "PremierElectionBallotCast",
    actorDid: premierDids[8]!,
    timestamp: ballotTimestamp,
    payload: {
      command: {
        ballotId: uuid(740),
        electionId,
        voterDid: premierDids[8]!,
        eligibilitySnapshotDigest: snapshotDigest,
        rankedCandidateDids: [...current.candidateDids].reverse(),
        castAt: ballotTimestamp,
      },
    },
    current,
    previousEventHash,
  });
  events.push(ballot);
  current = ballot.next;
  previousEventHash = ballot.event.eventHash;
  const result = evaluatePremierElection(current);
  const closeTimestamp = "2026-08-13T10:00:00.000Z";
  const closed = await electionEvent({
    sequence: 11,
    eventType: "PremierElectionClosed",
    actorDid: commissionerDids[1]!,
    timestamp: closeTimestamp,
    payload: {
      command: {
        electionId,
        requestedByDid: commissionerDids[1]!,
        requestedAt: closeTimestamp,
      },
    },
    current,
    previousEventHash,
    result,
  });
  events.push(closed);
  return { events, opened, closed, result };
}

describe("durable public election projections", () => {
  it("independently recomputes the premier board and restores it after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-election-projection-"));
    const store = repository(root);
    await store.initialize();
    const { events, result } = await history();
    for (const [index, item] of events.entries())
      await store.publish(item.envelope, String(index));

    expect(store.elections()).toMatchObject([
      {
        recordType: "PREMIER_PLAYERS_ASSOCIATION_BOARD_ELECTION",
        electionId,
        aggregateVersion: "11",
        canonical: true,
        result: {
          electedDids: [...premierDids.slice(0, 8)].reverse(),
          ballotCount: 1,
          resultCommitment: result.resultCommitment,
        },
      },
    ]);
    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.elections()).toEqual(store.elections());
  });

  it("routes institutional-election outbox events through the governance topic", async () => {
    const { opened } = await history();
    const store = new InMemoryCanonicalStore();
    await store.append({
      eventId: opened.event.eventId,
      actorDid: opened.event.actorDid,
      nonce: opened.event.nonce,
      idempotencyKey: opened.event.idempotencyKey,
      requestHash: sha256Commitment("election-worker-request"),
      aggregateType: opened.event.aggregateType,
      aggregateId: opened.event.aggregateId,
      expectedVersion: 0n,
      competitionId: "election-rehearsal",
      seasonId: "pre-genesis",
      eventType: opened.event.eventType,
      previousEventHash: opened.event.previousEventHash,
      eventHash: opened.event.eventHash,
      payloadSchemaDigest: opened.event.schemaDigest,
      payloadCommitment: opened.event.payloadCommitment,
      payload: opened.event.payload,
      stateRoot: opened.event.stateRoot,
      signatures: [opened.envelope.signature],
      occurredAt: new Date(opened.event.timestamp),
      outboxTopic: "public.governance",
    });
    const delivered: PublicProjectionEnvelope[] = [];
    const worker = new PublicProjectionWorker({
      store,
      sink: { publish: async (envelope) => void delivered.push(envelope) },
      now: () => new Date("2026-08-13T09:01:00.000Z"),
      ...authority,
    });
    expect(await worker.drain()).toBe(1);
    expect(delivered).toMatchObject([
      {
        topic: "public.governance",
        event: {
          aggregateType: ELECTION_WORKFLOW_AGGREGATE_TYPE,
          eventHash: opened.event.eventHash,
        },
      },
    ]);
  });

  it("rejects a substituted roll, rogue signer, false state root, and durable tampering", async () => {
    const { opened } = await history();
    await expect(
      verifyElectionProjectionEvent(opened.envelope, {
        ...authority,
        governanceEligibilitySnapshotDigest: sha256Commitment("wrong-roll"),
      }),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const rogueOpened = await electionEvent({
      sequence: 1,
      eventType: "PremierElectionOpened",
      actorDid: commissionerDids[0]!,
      timestamp: opened.event.timestamp,
      payload: opened.event.payload as ElectionWorkflowPayload,
      current: null,
      previousEventHash: null,
      signer: rogue,
    });
    await expect(
      verifyElectionProjectionEvent(rogueOpened.envelope, authority),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const falseRoot = await electionEvent({
      sequence: 1,
      eventType: "PremierElectionOpened",
      actorDid: commissionerDids[0]!,
      timestamp: opened.event.timestamp,
      payload: opened.event.payload as ElectionWorkflowPayload,
      current: null,
      previousEventHash: null,
      stateRoot: sha256Commitment("false-election-root"),
    });
    const falseRootStore = repository(
      await mkdtemp(join(tmpdir(), "abl-election-false-root-")),
    );
    await falseRootStore.initialize();
    await expect(
      falseRootStore.publish(falseRoot.envelope, "0"),
    ).rejects.toThrow("state root");

    const root = await mkdtemp(join(tmpdir(), "abl-election-tamper-"));
    const store = repository(root);
    await store.initialize();
    await store.publish(opened.envelope, "0");
    const recordPath = join(root, "election-records", "000000000000.json");
    const record = JSON.parse(
      await readFile(recordPath, "utf8"),
    ) as ElectionProjectionRecord;
    record.projection.candidateDids.push("did:abl:forged-election-candidate");
    await writeFile(recordPath, JSON.stringify(record), "utf8");
    await expect(repository(root).initialize()).rejects.toThrow(
      "corrupt or noncanonical",
    );
  });
});
