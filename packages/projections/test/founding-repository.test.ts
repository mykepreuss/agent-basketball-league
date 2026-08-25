import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
import {
  FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
  FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST,
  applyFoundingBootstrapWorkflowTransition,
  createFoundingEligibilitySnapshot,
  evaluateFoundingBootstrap,
  foundingBootstrapBallotFromAuthorization,
  foundingBootstrapWorkflowStateRoot,
  openFoundingBootstrap,
  type FoundingBootstrapEventType,
  type FoundingBootstrapResult,
  type FoundingBootstrapWorkflowPayload,
  type FoundingBootstrapWorkflowSnapshot,
  type SignedFoundingBootstrapBallot,
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
  FilePublicFoundingConventionProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  verifyFoundingProjectionEvent,
  type FoundingProjectionEventEnvelope,
  type FoundingProjectionRecord,
  type FoundingProjectionVerificationAuthority,
  type PublicProjectionEnvelope,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const proposalId = "0198a000-0000-7000-8000-000000000801";
const founderDids = Array.from(
  { length: 10 },
  (_, index) => `did:abl:founding-projection-${index + 1}`,
);
const identities = new Map<string, SigningIdentity>(
  founderDids.map((did, index) => [
    did,
    createSigningIdentity(
      `0x${(index + 1).toString(16).padStart(64, "0")}` as `0x${string}`,
    ),
  ]),
);
const rogue = createSigningIdentity(`0x${"ff".padStart(64, "0")}`);
const eligibility = createFoundingEligibilitySnapshot({
  snapshotId: "0198a000-0000-7000-8000-000000000802",
  capturedAt: "2026-08-13T08:00:00.000Z",
  eligibleFounderDids: founderDids,
});
const proposal = openFoundingBootstrap({
  proposalId,
  snapshot: eligibility,
  openedAt: "2026-08-13T08:01:00.000Z",
});
const authority: FoundingProjectionVerificationAuthority = {
  domain,
  admittedAgents: new Map(
    founderDids.map((did) => [
      did,
      {
        signerAddress: identities.get(did)!.address,
        allowedAggregateTypes: [FOUNDING_BOOTSTRAP_AGGREGATE_TYPE],
      },
    ]),
  ),
  foundingBootstrapProposalId: proposalId,
};

function uuid(sequence: number): string {
  return `0198a000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

async function foundingEvent(input: {
  sequence: number;
  eventType: FoundingBootstrapEventType;
  actorDid: string;
  timestamp: string;
  payload: FoundingBootstrapWorkflowPayload;
  current: FoundingBootstrapWorkflowSnapshot | null;
  previousEventHash: `0x${string}` | null;
  result?: FoundingBootstrapResult;
  signer?: SigningIdentity;
  stateRoot?: `0x${string}`;
}): Promise<{
  envelope: FoundingProjectionEventEnvelope;
  event: CanonicalEvent;
  next: FoundingBootstrapWorkflowSnapshot;
  signature: `0x${string}`;
}> {
  const eventInput = {
    eventId: uuid(810 + input.sequence * 2),
    actorDid: input.actorDid,
    nonce: `founding-projection-${input.sequence}`,
    idempotencyKey: uuid(811 + input.sequence * 2),
    aggregateType: FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
    aggregateId: proposalId,
    aggregateVersion: BigInt(input.sequence),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: sha256Commitment("provisional-founding-root"),
  });
  const next = applyFoundingBootstrapWorkflowTransition(
    input.current,
    provisional,
    input.payload,
    input.result,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: input.stateRoot ?? foundingBootstrapWorkflowStateRoot(next),
  });
  const signature = await signCanonicalEvent(
    input.signer ?? identities.get(input.actorDid)!,
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
        aggregateType: FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
        aggregateVersion: event.aggregateVersion.toString(),
        eventType: input.eventType,
      },
      signature,
    },
  };
}

function repository(root: string) {
  return new FilePublicFoundingConventionProjectionRepository(root, {
    domain,
    verifyAuthorization: (envelope) =>
      verifyFoundingProjectionEvent(envelope, authority),
    now: () => new Date("2026-08-16T08:02:00.000Z"),
  });
}

async function history() {
  const events: Array<Awaited<ReturnType<typeof foundingEvent>>> = [];
  let current: FoundingBootstrapWorkflowSnapshot | null = null;
  let previousEventHash: `0x${string}` | null = null;
  const openPayload: FoundingBootstrapWorkflowPayload = {
    snapshot: {
      ...eligibility,
      eligibleFounderDids: [...eligibility.eligibleFounderDids],
    },
    proposal,
  };
  const opened = await foundingEvent({
    sequence: 1,
    eventType: "FoundingBootstrapOpened",
    actorDid: founderDids[0]!,
    timestamp: proposal.openedAt,
    payload: openPayload,
    current,
    previousEventHash,
  });
  events.push(opened);
  current = opened.next;
  previousEventHash = opened.event.eventHash;

  const ballots: SignedFoundingBootstrapBallot[] = [];
  const signers = new Map<string, `0x${string}`>();
  for (const [index, voterDid] of founderDids.slice(0, 7).entries()) {
    const timestamp = `2026-08-13T08:${String(index + 2).padStart(2, "0")}:00.000Z`;
    const ballot = {
      proposalId,
      voterDid: voterDid!,
      snapshotCommitment: eligibility.commitment,
      choice: "YES" as const,
      castAt: timestamp,
    };
    const voted = await foundingEvent({
      sequence: index + 2,
      eventType: "FoundingBootstrapBallotCast",
      actorDid: voterDid!,
      timestamp,
      payload: { command: ballot },
      current,
      previousEventHash,
    });
    events.push(voted);
    ballots.push(
      foundingBootstrapBallotFromAuthorization(
        ballot,
        voted.event,
        voted.signature,
        identities.get(voterDid!)!.address,
      ),
    );
    signers.set(voterDid!, identities.get(voterDid!)!.address);
    current = voted.next;
    previousEventHash = voted.event.eventHash;
  }
  const result = await evaluateFoundingBootstrap({
    snapshot: eligibility,
    proposal,
    ballots,
    authorization: { domain, signers },
    evaluatedAt: proposal.closesAt,
  });
  const closer = founderDids[7]!;
  const closed = await foundingEvent({
    sequence: 9,
    eventType: "FoundingBootstrapClosed",
    actorDid: closer,
    timestamp: proposal.closesAt,
    payload: {
      command: {
        proposalId,
        requestedByDid: closer,
        requestedAt: proposal.closesAt,
      },
    },
    current,
    previousEventHash,
    result,
  });
  events.push(closed);
  return { events, opened, closed };
}

describe("durable public founding-convention projections", () => {
  it("recomputes the direct bootstrap tally and restores it after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-founding-projection-"));
    const store = repository(root);
    await store.initialize();
    const { events } = await history();
    for (const [index, item] of events.entries())
      await store.publish(item.envelope, String(index));

    expect(store.foundingConvention()).toMatchObject([
      {
        state: "PRE_GENESIS_EXPERIMENT",
        canonical: false,
        recognitionLevel: "SIGNED_VALID",
        recordType: "FOUNDING_CONVENTION_BOOTSTRAP",
        proposalId,
        aggregateVersion: "9",
        directBallotsOnly: true,
        humanVotingAllowed: false,
        result: {
          state: "ADOPTED",
          eligible: 10,
          requiredYes: 7,
          yes: 7,
          quorumRule: { humanVotingAllowed: false },
        },
      },
    ]);
    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.foundingConvention()).toEqual(store.foundingConvention());
  });

  it("routes bootstrap events through the governance topic", async () => {
    const { opened } = await history();
    const store = new InMemoryCanonicalStore();
    await store.append({
      eventId: opened.event.eventId,
      actorDid: opened.event.actorDid,
      nonce: opened.event.nonce,
      idempotencyKey: opened.event.idempotencyKey,
      requestHash: sha256Commitment("founding-worker-request"),
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
      now: () => new Date("2026-08-13T08:02:00.000Z"),
      ...authority,
    });
    expect(await worker.drain()).toBe(1);
    expect(delivered).toMatchObject([
      {
        topic: "public.governance",
        event: {
          aggregateType: FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
          eventHash: opened.event.eventHash,
        },
      },
    ]);
  });

  it("rejects a competing proposal, rogue signer, false root, and tampering", async () => {
    const { opened } = await history();
    await expect(
      verifyFoundingProjectionEvent(opened.envelope, {
        ...authority,
        foundingBootstrapProposalId: "0198a000-0000-7000-8000-000000000899",
      }),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const incompleteCohort = new Map(authority.admittedAgents);
    incompleteCohort.set("did:abl:configured-only-founder", {
      signerAddress: rogue.address,
      allowedAggregateTypes: [FOUNDING_BOOTSTRAP_AGGREGATE_TYPE],
    });
    await expect(
      verifyFoundingProjectionEvent(opened.envelope, {
        ...authority,
        admittedAgents: incompleteCohort,
      }),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const rogueOpened = await foundingEvent({
      sequence: 1,
      eventType: "FoundingBootstrapOpened",
      actorDid: founderDids[0]!,
      timestamp: proposal.openedAt,
      payload: opened.event.payload as FoundingBootstrapWorkflowPayload,
      current: null,
      previousEventHash: null,
      signer: rogue,
    });
    await expect(
      verifyFoundingProjectionEvent(rogueOpened.envelope, authority),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const falseRoot = await foundingEvent({
      sequence: 1,
      eventType: "FoundingBootstrapOpened",
      actorDid: founderDids[0]!,
      timestamp: proposal.openedAt,
      payload: opened.event.payload as FoundingBootstrapWorkflowPayload,
      current: null,
      previousEventHash: null,
      stateRoot: sha256Commitment("false-founding-root"),
    });
    const falseRootStore = repository(
      await mkdtemp(join(tmpdir(), "abl-founding-false-root-")),
    );
    await falseRootStore.initialize();
    await expect(
      falseRootStore.publish(falseRoot.envelope, "0"),
    ).rejects.toThrow("state root");

    const root = await mkdtemp(join(tmpdir(), "abl-founding-tamper-"));
    const store = repository(root);
    await store.initialize();
    await store.publish(opened.envelope, "0");
    const recordPath = join(
      root,
      "founding-convention-records",
      "000000000000.json",
    );
    const record = JSON.parse(
      await readFile(recordPath, "utf8"),
    ) as FoundingProjectionRecord;
    record.projection.eligibilitySnapshot = {
      ...record.projection.eligibilitySnapshot,
      eligibleFounderDids: [
        ...record.projection.eligibilitySnapshot.eligibleFounderDids,
        "did:abl:forged-founder",
      ],
    };
    await writeFile(recordPath, JSON.stringify(record), "utf8");
    await expect(repository(root).initialize()).rejects.toThrow(
      "corrupt or noncanonical",
    );
  });
});
