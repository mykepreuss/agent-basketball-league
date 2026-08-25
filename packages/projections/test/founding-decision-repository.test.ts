import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
import {
  FOUNDING_DECISION_AGGREGATE_TYPE,
  FOUNDING_DECISION_WORKFLOW_SCHEMA_DIGEST,
  applyFoundingDecisionWorkflowTransition,
  createFoundingEligibilitySnapshot,
  evaluateFoundingDecision,
  foundingDecisionProposalCommitment,
  foundingDecisionWorkflowStateRoot,
  openFoundingDecision,
  type FoundingDecisionEventType,
  type FoundingDecisionResult,
  type FoundingDecisionWorkflowPayload,
  type FoundingDecisionWorkflowSnapshot,
  type FoundingQuorumRule,
  type SignedFoundingDecisionBallot,
} from "@abl/genesis";
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
  FilePublicFoundingDecisionProjectionRepository,
  PublicProjectionWorker,
  verifyFoundingDecisionProjectionEvent,
  type FoundingDecisionProjectionEventEnvelope,
  type FoundingDecisionProjectionRecord,
  type PublicProjectionEnvelope,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const conventionId = "0199d000-0000-7000-8000-000000000001";
const proposalId = "0199d000-0000-7000-8000-000000000002";
const founderDids = Array.from(
  { length: 10 },
  (_, index) => `did:abl:decision-projection-${index + 1}`,
);
const identities = new Map<string, SigningIdentity>(
  founderDids.map((did, index) => [
    did,
    createSigningIdentity(
      `0x${(index + 1).toString(16).padStart(64, "0")}` as `0x${string}`,
    ),
  ]),
);
const eligibility = createFoundingEligibilitySnapshot({
  snapshotId: "0199d000-0000-7000-8000-000000000003",
  capturedAt: "2026-09-01T00:00:00.000Z",
  eligibleFounderDids: founderDids,
});
const quorumRule: FoundingQuorumRule = {
  minimumActiveFounders: 10,
  approvalNumerator: 2,
  approvalDenominator: 3,
  minimumYes: 7,
  directParticipationOnly: true,
  humanVotingAllowed: false,
  adoptedByProposalId: "0199d000-0000-7000-8000-000000000004",
  adoptedAt: eligibility.capturedAt,
};
const proposal = openFoundingDecision({
  proposal: {
    proposalId,
    conventionId,
    topic: "RECOGNITION_PROFILE",
    authorDid: founderDids[0]!,
    disposition: "REPLACE",
    artifactUri: "https://abl.example/genesis/recognition-profile.json",
    artifactDigest: sha256Commitment("signed-witness-profile"),
    eligibilitySnapshotCommitment: eligibility.commitment,
    proposedAt: "2026-09-01T00:01:00.000Z",
    recognitionMechanism: "SIGNED_WITNESSES",
    releaseManifestDigest: null,
  },
  snapshot: eligibility,
  quorumRule,
});
const authority = {
  domain,
  admittedAgents: new Map(
    founderDids.map((did) => [
      did,
      {
        signerAddress: identities.get(did)!.address,
        allowedAggregateTypes: [FOUNDING_DECISION_AGGREGATE_TYPE],
      },
    ]),
  ),
  foundingConventionId: conventionId,
};

function uuid(sequence: number): string {
  return `0199d000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

async function decisionEvent(input: {
  sequence: number;
  eventType: FoundingDecisionEventType;
  actorDid: string;
  timestamp: string;
  payload: FoundingDecisionWorkflowPayload;
  current: FoundingDecisionWorkflowSnapshot | null;
  previousEventHash: `0x${string}` | null;
  result?: FoundingDecisionResult;
}): Promise<{
  envelope: FoundingDecisionProjectionEventEnvelope;
  event: CanonicalEvent;
  next: FoundingDecisionWorkflowSnapshot;
  signature: `0x${string}`;
}> {
  const eventInput = {
    eventId: uuid(100 + input.sequence),
    actorDid: input.actorDid,
    nonce: `founding-decision-projection-${input.sequence}`,
    idempotencyKey: uuid(200 + input.sequence),
    aggregateType: FOUNDING_DECISION_AGGREGATE_TYPE,
    aggregateId: proposalId,
    aggregateVersion: BigInt(input.sequence),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: FOUNDING_DECISION_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: sha256Commitment("provisional-founding-decision-root"),
  });
  const next = applyFoundingDecisionWorkflowTransition(
    input.current,
    provisional,
    input.payload,
    input.result,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: foundingDecisionWorkflowStateRoot(next),
  });
  const signature = await signCanonicalEvent(
    identities.get(input.actorDid)!,
    domain,
    event,
  );
  return {
    event,
    next,
    signature,
    envelope: {
      version: "1.0.0",
      topic: "public.governance",
      event: {
        ...event,
        aggregateType: FOUNDING_DECISION_AGGREGATE_TYPE,
        aggregateVersion: event.aggregateVersion.toString(),
        eventType: input.eventType,
      },
      signature,
    },
  };
}

async function history() {
  const events: Array<Awaited<ReturnType<typeof decisionEvent>>> = [];
  let current: FoundingDecisionWorkflowSnapshot | null = null;
  let previousEventHash: `0x${string}` | null = null;
  const opened = await decisionEvent({
    sequence: 1,
    eventType: "FoundingDecisionProposed",
    actorDid: proposal.authorDid,
    timestamp: proposal.proposedAt,
    payload: {
      proposal,
      snapshot: {
        ...eligibility,
        eligibleFounderDids: [...eligibility.eligibleFounderDids],
      },
      quorumRule,
    },
    current,
    previousEventHash,
  });
  events.push(opened);
  current = opened.next;
  previousEventHash = opened.event.eventHash;

  const ballots: SignedFoundingDecisionBallot[] = [];
  const signers = new Map<string, `0x${string}`>();
  const proposalCommitment = foundingDecisionProposalCommitment(proposal);
  for (const [index, voterDid] of founderDids.slice(0, 7).entries()) {
    const castAt = new Date(
      Date.parse(proposal.proposedAt) + (index + 1) * 60_000,
    ).toISOString();
    const ballot = {
      proposalId,
      topic: proposal.topic,
      voterDid: voterDid!,
      eligibilitySnapshotCommitment: eligibility.commitment,
      proposalCommitment,
      choice: "YES" as const,
      castAt,
    };
    const voted = await decisionEvent({
      sequence: index + 2,
      eventType: "FoundingDecisionBallotCast",
      actorDid: voterDid!,
      timestamp: castAt,
      payload: { command: ballot },
      current,
      previousEventHash,
    });
    events.push(voted);
    ballots.push({
      ballot,
      authorizationEvent: voted.event as CanonicalEvent<{
        command: typeof ballot;
      }>,
      signature: voted.signature,
      signerAddress: identities.get(voterDid!)!.address,
    });
    signers.set(voterDid!, identities.get(voterDid!)!.address);
    current = voted.next;
    previousEventHash = voted.event.eventHash;
  }

  const result = await evaluateFoundingDecision({
    proposal,
    snapshot: eligibility,
    quorumRule,
    ballots,
    authorization: { domain, signers },
    evaluatedAt: proposal.closesAt,
    ratificationEventId: uuid(109),
  });
  const closer = founderDids[7]!;
  const closed = await decisionEvent({
    sequence: 9,
    eventType: "FoundingDecisionClosed",
    actorDid: closer,
    timestamp: proposal.closesAt,
    payload: {
      command: {
        proposalId,
        requestedByDid: closer,
        requestedAt: proposal.closesAt,
        ratificationEventId: uuid(109),
      },
    },
    current,
    previousEventHash,
    result,
  });
  events.push(closed);
  return { events, opened, closed };
}

function repository(root: string) {
  return new FilePublicFoundingDecisionProjectionRepository(root, {
    domain,
    verifyAuthorization: (envelope) =>
      verifyFoundingDecisionProjectionEvent(envelope, authority),
    adoptedQuorumRule: (candidateConventionId) =>
      candidateConventionId === conventionId ? quorumRule : null,
    now: () => new Date("2026-09-04T00:02:00.000Z"),
  });
}

describe("durable public founding-decision projections", () => {
  it("recomputes a direct founder decision and restores it after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-founding-decision-"));
    const store = repository(root);
    await store.initialize();
    const { events } = await history();
    for (const [index, item] of events.entries())
      await store.publish(item.envelope, String(index));

    expect(store.foundingDecisions()).toMatchObject([
      {
        state: "PRE_GENESIS_EXPERIMENT",
        canonical: false,
        recognitionLevel: "SIGNED_VALID",
        recordType: "FOUNDING_CONVENTION_DECISION",
        conventionId,
        proposalId,
        topic: "RECOGNITION_PROFILE",
        disposition: "REPLACE",
        aggregateVersion: "9",
        directBallotsOnly: true,
        humanVotingAllowed: false,
        result: {
          state: "DECIDED",
          yes: 7,
          requiredYes: 7,
          ratificationEventId: uuid(109),
          authorizationSignatures: expect.arrayContaining([
            expect.stringMatching(/^0x[0-9a-f]{130}$/),
          ]),
        },
      },
    ]);
    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.foundingDecisions()).toEqual(store.foundingDecisions());
  });

  it("routes decision events through the signed governance projection transport", async () => {
    const { opened } = await history();
    const store = new InMemoryCanonicalStore();
    await store.append({
      eventId: opened.event.eventId,
      actorDid: opened.event.actorDid,
      nonce: opened.event.nonce,
      idempotencyKey: opened.event.idempotencyKey,
      requestHash: sha256Commitment("founding-decision-worker-request"),
      aggregateType: opened.event.aggregateType,
      aggregateId: opened.event.aggregateId,
      expectedVersion: 0n,
      competitionId: "founding-rehearsal",
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
      now: () => new Date("2026-09-01T00:02:00.000Z"),
      ...authority,
    });
    expect(await worker.drain()).toBe(1);
    expect(delivered).toMatchObject([
      {
        topic: "public.governance",
        event: {
          aggregateType: FOUNDING_DECISION_AGGREGATE_TYPE,
          eventHash: opened.event.eventHash,
        },
      },
    ]);
  });

  it("fails closed on a missing adopted rule and on durable projection tampering", async () => {
    const { opened } = await history();
    const missingRuleRoot = await mkdtemp(
      join(tmpdir(), "abl-founding-decision-rule-"),
    );
    const missingRule = new FilePublicFoundingDecisionProjectionRepository(
      missingRuleRoot,
      {
        domain,
        verifyAuthorization: (envelope) =>
          verifyFoundingDecisionProjectionEvent(envelope, authority),
        adoptedQuorumRule: () => null,
      },
    );
    await missingRule.initialize();
    await expect(missingRule.publish(opened.envelope, "0")).rejects.toThrow(
      "adopted quorum rule",
    );

    const root = await mkdtemp(join(tmpdir(), "abl-founding-decision-tamper-"));
    const store = repository(root);
    await store.initialize();
    await store.publish(opened.envelope, "0");
    const recordPath = join(
      root,
      "founding-decision-records",
      "000000000000.json",
    );
    const record = JSON.parse(
      await readFile(recordPath, "utf8"),
    ) as FoundingDecisionProjectionRecord;
    record.projection.artifactUri = "https://attacker.invalid/replacement";
    await writeFile(recordPath, JSON.stringify(record));
    await expect(repository(root).initialize()).rejects.toThrow(
      "corrupt or noncanonical",
    );
  });
});
