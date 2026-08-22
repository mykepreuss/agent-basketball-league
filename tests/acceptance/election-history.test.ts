import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createPublicApi } from "../../apps/public-api/src/server.js";
import { InMemoryCanonicalStore } from "../../packages/database/src/index.js";
import { ServiceRequestVerifier } from "../../packages/foundation/src/index.js";
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
} from "../../packages/institutions/src/index.js";
import {
  FilePublicElectionProjectionRepository,
  FilePublicProjectionRepository,
  HttpProjectionEventSink,
  PublicProjectionWorker,
  verifyElectionProjectionEvent,
} from "../../packages/projections/src/index.js";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
  type SigningIdentity,
} from "../../packages/recognition/src/index.js";

const domain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111" as const,
};
const electionId = "0198d000-0000-7000-8000-000000000901";
const playerDids = Array.from(
  { length: 9 },
  (_, index) => `did:abl:acceptance-election-player-${index + 1}`,
);
const commissionerDids = Array.from(
  { length: 3 },
  (_, index) => `did:abl:acceptance-election-commissioner-${index + 1}`,
);
const dids = [...playerDids, ...commissionerDids];
const identities = new Map<string, SigningIdentity>(
  dids.map((did, index) => [
    did,
    createSigningIdentity(
      `0x${(index + 41).toString(16).padStart(64, "0")}` as `0x${string}`,
    ),
  ]),
);
const eligibilitySnapshot = {
  snapshotId: "0198d000-0000-7000-8000-000000000902",
  capturedAt: "2026-08-13T08:00:00.000Z",
  members: {
    UNIVERSAL_CAREER_ASSEMBLY: [...playerDids],
    PREMIER_PLAYERS: [...playerDids],
    DEVELOPMENT_PLAYERS: [],
    PREMIER_TEAM_COUNCIL: [],
    DEVELOPMENT_TEAM_COUNCIL: [],
    EXECUTIVE_COMMISSION: [...commissionerDids],
    TRIBUNAL: [],
    INTEGRITY_OFFICE: [],
  },
};
const snapshotDigest = sha256Commitment(eligibilitySnapshot);
const authority = {
  domain,
  admittedAgents: new Map(
    dids.map((did) => [
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
  return `0198d000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
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
}) {
  const base = {
    eventId: uuid(910 + input.sequence * 2),
    actorDid: input.actorDid,
    nonce: `acceptance-election-${input.sequence}`,
    idempotencyKey: uuid(911 + input.sequence * 2),
    aggregateType: ELECTION_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: electionId,
    aggregateVersion: BigInt(input.sequence),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: sha256Commitment("provisional-election-acceptance"),
    schemaDigest: ELECTION_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  };
  const provisional = createCanonicalEvent(base);
  const next = applyElectionWorkflowTransition(
    input.current,
    provisional,
    input.payload,
    input.result,
  );
  const event = createCanonicalEvent({
    ...base,
    stateRoot: electionWorkflowStateRoot(next),
  });
  return {
    event,
    next,
    signature: await signCanonicalEvent(
      identities.get(input.actorDid)!,
      domain,
      event,
    ),
  };
}

async function history(): Promise<
  Array<{
    event: CanonicalEvent;
    next: ElectionWorkflowSnapshot;
    signature: `0x${string}`;
  }>
> {
  const events = [];
  let current: ElectionWorkflowSnapshot | null = null;
  let previousEventHash: `0x${string}` | null = null;
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
  for (const [index, candidateDid] of playerDids.slice(0, 8).entries()) {
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
    actorDid: playerDids[8]!,
    timestamp: ballotTimestamp,
    payload: {
      command: {
        ballotId: uuid(940),
        electionId,
        voterDid: playerDids[8]!,
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
    result: evaluatePremierElection(current),
  });
  events.push(closed);
  return events;
}

describe("canonical election acceptance", () => {
  it("crosses the authenticated network projection boundary and restores the independently tallied board", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-election-acceptance-"));
    const store = new InMemoryCanonicalStore();
    const games = new FilePublicProjectionRepository(root);
    const elections = new FilePublicElectionProjectionRepository(root, {
      verifyAuthorization: async (authorization) =>
        verifyElectionProjectionEvent(authorization, authority),
    });
    await Promise.all([games.initialize(), elections.initialize()]);
    const serviceSecret = new Uint8Array(32).fill(23);
    const serviceNow = Date.parse("2026-08-13T10:00:05.000Z");
    const serviceIdentity = {
      serviceId: "election-acceptance-projector",
      secret: serviceSecret,
      capabilities: new Set(["projection:append"]),
    };
    const publicApi = createPublicApi({
      projections: games,
      electionProjections: elections,
      projectionIngress: {
        writer: games,
        electionWriter: elections,
        verifier: new ServiceRequestVerifier([serviceIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      },
    });
    const address = await publicApi.listen({ host: "127.0.0.1", port: 0 });
    try {
      const events = await history();
      for (const { event, signature } of events) {
        await store.append({
          eventId: event.eventId,
          actorDid: event.actorDid,
          nonce: event.nonce,
          idempotencyKey: event.idempotencyKey,
          requestHash: sha256Commitment({
            eventHash: event.eventHash,
            signature,
          }),
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          expectedVersion: event.aggregateVersion - 1n,
          competitionId: "season-zero-rehearsal",
          seasonId: "season-zero",
          eventType: event.eventType,
          previousEventHash: event.previousEventHash,
          eventHash: event.eventHash,
          payloadSchemaDigest: event.schemaDigest,
          payloadCommitment: event.payloadCommitment,
          payload: event.payload,
          stateRoot: event.stateRoot,
          signatures: [signature],
          occurredAt: new Date(event.timestamp),
          outboxTopic: "public.governance",
        });
      }
      const sink = new HttpProjectionEventSink({
        origin: address,
        identity: serviceIdentity,
        allowHttpForTest: true,
        now: () => serviceNow,
      });
      const worker = new PublicProjectionWorker({ store, sink, ...authority });
      expect(await worker.drain(20)).toBe(11);
      const response = await fetch(`${address}/v1/public/governance`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        state: "REHEARSAL",
        canonical: false,
        historyClassification: "PRE_GENESIS_EXPERIMENT",
        items: [
          {
            recordType: "PREMIER_PLAYERS_ASSOCIATION_BOARD_ELECTION",
            electionId,
            aggregateVersion: "11",
            result: {
              electedDids: [...playerDids.slice(0, 8)].reverse(),
              ballotCount: 1,
            },
          },
        ],
      });

      const restarted = new FilePublicElectionProjectionRepository(root, {
        verifyAuthorization: async (authorization) =>
          verifyElectionProjectionEvent(authorization, authority),
      });
      await restarted.initialize();
      expect(restarted.elections()).toEqual(elections.elections());
      expect(
        await store.pendingProjectionEvents(20, "public.governance"),
      ).toHaveLength(0);
    } finally {
      await publicApi.close();
    }
  });
});
