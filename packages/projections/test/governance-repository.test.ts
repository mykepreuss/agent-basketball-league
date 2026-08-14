import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
import {
  GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  applyGovernanceWorkflowTransition,
  evaluateGovernanceWorkflowDecision,
  governanceVoteFromAuthorization,
  governanceWorkflowStateRoot,
  type GovernanceDecision,
  type GovernanceProposalRegistrationPayload,
  type GovernanceVote,
  type GovernanceWorkflowEventType,
  type GovernanceWorkflowPayload,
  type GovernanceWorkflowSnapshot,
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
  FilePublicGovernanceProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  verifyGovernanceProjectionEvent,
  type GovernanceProjectionEventEnvelope,
  type GovernanceProjectionVerificationAuthority,
  type PublicProjectionEnvelope,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const voterDid = "did:abl:governance-projection-voter";
const voter = createSigningIdentity(`0x${"6".repeat(64)}`);
const rogue = createSigningIdentity(`0x${"7".repeat(64)}`);
const proposalId = "0198a000-0000-7000-8000-000000000601";
const snapshot = {
  snapshotId: "0198a000-0000-7000-8000-000000000602",
  capturedAt: "2026-08-13T08:00:00.000Z",
  members: {
    UNIVERSAL_CAREER_ASSEMBLY: [voterDid],
    PREMIER_PLAYERS: [voterDid],
    DEVELOPMENT_PLAYERS: [],
    PREMIER_TEAM_COUNCIL: [voterDid],
    DEVELOPMENT_TEAM_COUNCIL: [],
    EXECUTIVE_COMMISSION: [],
    TRIBUNAL: [],
    INTEGRITY_OFFICE: [],
  },
};
const snapshotDigest = sha256Commitment(snapshot);
const authority: GovernanceProjectionVerificationAuthority = {
  domain,
  admittedAgents: new Map([
    [
      voterDid,
      {
        signerAddress: voter.address,
        allowedAggregateTypes: [GOVERNANCE_WORKFLOW_AGGREGATE_TYPE],
      },
    ],
  ]),
  governanceEligibilitySnapshotDigest: snapshotDigest,
};

function uuid(sequence: number): string {
  return `0198a000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

async function governanceEvent(input: {
  sequence: number;
  eventType: GovernanceWorkflowEventType;
  timestamp: string;
  payload: GovernanceWorkflowPayload;
  current: GovernanceWorkflowSnapshot | null;
  previousEventHash: `0x${string}` | null;
  decision?: GovernanceDecision | null;
  signer?: SigningIdentity;
  stateRoot?: `0x${string}`;
}): Promise<{
  envelope: GovernanceProjectionEventEnvelope;
  event: CanonicalEvent;
  next: GovernanceWorkflowSnapshot;
}> {
  const eventInput = {
    eventId: uuid(610 + input.sequence * 2),
    actorDid: voterDid,
    nonce: `governance-projection-${input.sequence}`,
    idempotencyKey: uuid(611 + input.sequence * 2),
    aggregateType: GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: proposalId,
    aggregateVersion: BigInt(input.sequence),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: sha256Commitment("provisional"),
    schemaDigest: GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  };
  const provisional = createCanonicalEvent(eventInput);
  const next = applyGovernanceWorkflowTransition(
    input.current,
    provisional,
    input.payload,
    input.decision,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: input.stateRoot ?? governanceWorkflowStateRoot(next),
  });
  const signature = await signCanonicalEvent(
    input.signer ?? voter,
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
        aggregateType: GOVERNANCE_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: event.aggregateVersion.toString(),
        eventType: input.eventType,
      },
      signature,
    },
  };
}

function repository(root: string) {
  return new FilePublicGovernanceProjectionRepository(root, {
    domain,
    verifyAuthorization: async (envelope) =>
      verifyGovernanceProjectionEvent(envelope, authority),
    now: () => new Date("2026-08-13T09:11:00.000Z"),
  });
}

async function history() {
  const registrationPayload = {
    proposal: {
      proposalId,
      version: 1,
      proposerDid: voterDid,
      institution: "Premier collective bargaining projection rehearsal",
      proposalClass: "TIER_CBA" as const,
      tier: "PREMIER" as const,
      title: "Projection safety agreement",
      textCommitment: sha256Commitment("governance-proposal"),
      executableChangeDigest: null,
      opensAt: "2026-08-13T08:02:00.000Z",
      closesAt: "2026-08-13T09:00:00.000Z",
      eligibilitySnapshotDigest: snapshotDigest,
    },
    eligibilitySnapshot: snapshot,
    recusedDids: [],
  };
  const registered = await governanceEvent({
    sequence: 1,
    eventType: "GovernanceProposalRegistered",
    timestamp: "2026-08-13T08:01:00.000Z",
    payload: registrationPayload,
    current: null,
    previousEventHash: null,
  });
  const playerBallot = {
    ballotId: uuid(620),
    voterDid,
    chamber: "PREMIER_PLAYERS" as const,
    choice: "YES" as const,
    proposalId,
    proposalVersion: 1,
    eligibilitySnapshotDigest: snapshotDigest,
    castAt: "2026-08-13T08:02:00.000Z",
  };
  const playerVote = await governanceEvent({
    sequence: 2,
    eventType: "GovernanceBallotCast",
    timestamp: playerBallot.castAt,
    payload: { command: playerBallot },
    current: registered.next,
    previousEventHash: registered.event.eventHash,
  });
  const councilBallot = {
    ...playerBallot,
    ballotId: uuid(621),
    chamber: "PREMIER_TEAM_COUNCIL" as const,
    castAt: "2026-08-13T08:03:00.000Z",
  };
  const councilVote = await governanceEvent({
    sequence: 3,
    eventType: "GovernanceBallotCast",
    timestamp: councilBallot.castAt,
    payload: { command: councilBallot },
    current: playerVote.next,
    previousEventHash: playerVote.event.eventHash,
  });
  const votes: GovernanceVote[] = [
    governanceVoteFromAuthorization(
      playerBallot,
      playerVote.event,
      playerVote.envelope.signature,
      voter.address,
    ),
    governanceVoteFromAuthorization(
      councilBallot,
      councilVote.event,
      councilVote.envelope.signature,
      voter.address,
    ),
  ];
  const decision = await evaluateGovernanceWorkflowDecision(
    councilVote.next,
    votes,
    {
      domain,
      signers: new Map([
        [voterDid, { signerAddress: voter.address, roles: ["VOTER"] }],
      ]),
    },
  );
  const closeTimestamp = "2026-08-13T09:00:00.000Z";
  const closed = await governanceEvent({
    sequence: 4,
    eventType: "GovernanceProposalClosed",
    timestamp: closeTimestamp,
    payload: {
      command: {
        proposalId,
        proposalVersion: 1,
        requestedByDid: voterDid,
        requestedAt: closeTimestamp,
      },
    },
    current: councilVote.next,
    previousEventHash: councilVote.event.eventHash,
    decision,
  });
  return { registered, playerVote, councilVote, closed, decision };
}

describe("durable public governance projections", () => {
  it("recomputes a signed closed tally and restores it after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-governance-projection-"));
    const store = repository(root);
    await store.initialize();
    const events = await history();
    for (const [index, item] of [
      events.registered,
      events.playerVote,
      events.councilVote,
      events.closed,
    ].entries()) {
      await store.publish(item.envelope, String(index));
    }
    expect(events.decision.passed).toBe(true);
    expect(store.governance()).toMatchObject([
      {
        proposalId,
        aggregateVersion: "4",
        canonical: true,
        decision: { passed: true },
        ballots: [
          { chamber: "PREMIER_PLAYERS", choice: "YES" },
          { chamber: "PREMIER_TEAM_COUNCIL", choice: "YES" },
        ],
      },
    ]);
    await expect(
      store.resourceScheduleRatification(proposalId),
    ).resolves.toEqual({
      proposalId,
      proposalClass: "TIER_CBA",
      tier: "PREMIER",
      executableChangeDigest: null,
      passed: true,
      closeEventId: events.closed.event.eventId,
    });
    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.governance()).toEqual(store.governance());
    await expect(
      restarted.resourceScheduleRatification(proposalId),
    ).resolves.toEqual(await store.resourceScheduleRatification(proposalId));
  });

  it("drains configured governance outbox events through the worker", async () => {
    const { registered } = await history();
    const store = new InMemoryCanonicalStore();
    await store.append({
      eventId: registered.event.eventId,
      actorDid: registered.event.actorDid,
      nonce: registered.event.nonce,
      idempotencyKey: registered.event.idempotencyKey,
      requestHash: sha256Commitment("governance-worker-request"),
      aggregateType: registered.event.aggregateType,
      aggregateId: registered.event.aggregateId,
      expectedVersion: 0n,
      competitionId: "governance-rehearsal",
      seasonId: "pre-genesis",
      eventType: registered.event.eventType,
      previousEventHash: registered.event.previousEventHash,
      eventHash: registered.event.eventHash,
      payloadSchemaDigest: registered.event.schemaDigest,
      payloadCommitment: registered.event.payloadCommitment,
      payload: registered.event.payload,
      stateRoot: registered.event.stateRoot,
      signatures: [registered.envelope.signature],
      occurredAt: new Date(registered.event.timestamp),
      outboxTopic: "public.governance",
    });
    const delivered: PublicProjectionEnvelope[] = [];
    const worker = new PublicProjectionWorker({
      store,
      sink: {
        publish: async (envelope) => {
          delivered.push(envelope);
        },
      },
      now: () => new Date("2026-08-13T09:01:00.000Z"),
      ...authority,
    });
    expect(await worker.drain()).toBe(1);
    expect(delivered).toMatchObject([
      {
        topic: "public.governance",
        event: { eventHash: registered.event.eventHash },
      },
    ]);
  });

  it("rejects wrong snapshots, rogue signers, false roots, and tampering", async () => {
    const events = await history();
    expect(() =>
      applyGovernanceWorkflowTransition(
        events.registered.next,
        { ...events.playerVote.event, eventType: "GovernanceBypassed" },
        events.playerVote.event.payload as GovernanceWorkflowPayload,
      ),
    ).toThrow("not recognized");
    const wrongSnapshotAuthority = {
      ...authority,
      governanceEligibilitySnapshotDigest: sha256Commitment("wrong-snapshot"),
    };
    await expect(
      verifyGovernanceProjectionEvent(
        events.registered.envelope,
        wrongSnapshotAuthority,
      ),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
    await expect(
      verifyGovernanceProjectionEvent(events.registered.envelope, {
        ...authority,
        admittedAgents: new Map([
          ...authority.admittedAgents,
          [
            "did:abl:aliased-governance-seat",
            {
              signerAddress: voter.address,
              allowedAggregateTypes: [GOVERNANCE_WORKFLOW_AGGREGATE_TYPE],
            },
          ],
        ]),
      }),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
    const unknownMemberSnapshot = {
      ...snapshot,
      members: {
        ...snapshot.members,
        INTEGRITY_OFFICE: ["did:abl:unknown-governance-member"],
      },
    };
    const originalRegistration = events.registered.event
      .payload as GovernanceProposalRegistrationPayload;
    const unknownMemberDigest = sha256Commitment(unknownMemberSnapshot);
    const unknownMemberRegistration = await governanceEvent({
      sequence: 1,
      eventType: "GovernanceProposalRegistered",
      timestamp: events.registered.event.timestamp,
      payload: {
        ...originalRegistration,
        proposal: {
          ...originalRegistration.proposal,
          eligibilitySnapshotDigest: unknownMemberDigest,
        },
        eligibilitySnapshot: unknownMemberSnapshot,
      },
      current: null,
      previousEventHash: null,
    });
    await expect(
      verifyGovernanceProjectionEvent(unknownMemberRegistration.envelope, {
        ...authority,
        governanceEligibilitySnapshotDigest: unknownMemberDigest,
      }),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const rogueRegistration = await governanceEvent({
      sequence: 1,
      eventType: "GovernanceProposalRegistered",
      timestamp: events.registered.event.timestamp,
      payload: events.registered.event.payload as GovernanceWorkflowPayload,
      current: null,
      previousEventHash: null,
      signer: rogue,
    });
    await expect(
      verifyGovernanceProjectionEvent(rogueRegistration.envelope, authority),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const falseRoot = await governanceEvent({
      sequence: 1,
      eventType: "GovernanceProposalRegistered",
      timestamp: events.registered.event.timestamp,
      payload: events.registered.event.payload as GovernanceWorkflowPayload,
      current: null,
      previousEventHash: null,
      stateRoot: sha256Commitment("false-governance-root"),
    });
    const falseRootPath = await mkdtemp(
      join(tmpdir(), "abl-governance-false-root-"),
    );
    const falseRootStore = repository(falseRootPath);
    await falseRootStore.initialize();
    await expect(
      falseRootStore.publish(falseRoot.envelope, "0"),
    ).rejects.toThrow("state root");

    const root = await mkdtemp(join(tmpdir(), "abl-governance-tamper-"));
    const store = repository(root);
    await store.initialize();
    await store.publish(events.registered.envelope, "0");
    const recordPath = join(root, "governance-records", "000000000000.json");
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      projection: { proposal: { title: string } };
    };
    record.projection.proposal.title = "Forged title";
    await writeFile(recordPath, `${JSON.stringify(record)}\n`, "utf8");
    await expect(repository(root).initialize()).rejects.toThrow("corrupt");
  });
});
