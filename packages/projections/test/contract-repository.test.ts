import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONTRACT_WORKFLOW_AGGREGATE_TYPE,
  CONTRACT_WORKFLOW_SCHEMA_DIGEST,
  applyContractWorkflowTransition,
  contractOfferCommitment,
  contractWorkflowStateRoot,
  type ContractWorkflowEventType,
  type ContractWorkflowPayload,
  type ContractWorkflowSnapshot,
} from "@abl/institutions";
import { InMemoryCanonicalStore } from "@abl/database";
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
  FilePublicContractProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  verifyContractProjectionEvent,
  type ContractProjectionEventEnvelope,
  type ProjectionVerificationAuthority,
  type PublicProjectionEnvelope,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const governorDid = "did:abl:club-governor-projection";
const playerDid = "did:abl:player-projection";
const governor = createSigningIdentity(`0x${"1".repeat(64)}`);
const player = createSigningIdentity(`0x${"2".repeat(64)}`);
const rogue = createSigningIdentity(`0x${"3".repeat(64)}`);

const authority: ProjectionVerificationAuthority = {
  domain,
  admittedAgents: new Map([
    [
      governorDid,
      {
        signerAddress: governor.address,
        allowedAggregateTypes: [CONTRACT_WORKFLOW_AGGREGATE_TYPE],
      },
    ],
    [
      playerDid,
      {
        signerAddress: player.address,
        allowedAggregateTypes: [CONTRACT_WORKFLOW_AGGREGATE_TYPE],
      },
    ],
  ]),
};

function uuid(sequence: string | number): string {
  return `0198a000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

async function contractEvent(input: {
  sequence: number;
  actorDid: string;
  signer: SigningIdentity;
  eventType: ContractWorkflowEventType;
  timestamp: string;
  payload: ContractWorkflowPayload;
  current: ContractWorkflowSnapshot | null;
  previousEventHash: `0x${string}` | null;
  stateRoot?: `0x${string}`;
}): Promise<{
  envelope: ContractProjectionEventEnvelope;
  event: CanonicalEvent;
  next: ContractWorkflowSnapshot;
}> {
  const eventInput = {
    eventId: uuid(input.sequence * 2),
    actorDid: input.actorDid,
    nonce: `contract-projection-${input.sequence}`,
    idempotencyKey: uuid(input.sequence * 2 + 1),
    aggregateType: CONTRACT_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: playerDid,
    aggregateVersion: BigInt(input.sequence),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: sha256Commitment("provisional"),
    schemaDigest: CONTRACT_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  };
  const provisional = createCanonicalEvent(eventInput);
  const next = applyContractWorkflowTransition(
    input.current,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: input.stateRoot ?? contractWorkflowStateRoot(next),
  });
  const signature = await signCanonicalEvent(input.signer, domain, event);
  return {
    event,
    next,
    envelope: {
      version: "1.0.0",
      topic: "public.contracts",
      event: {
        ...event,
        aggregateType: CONTRACT_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: event.aggregateVersion.toString(),
        eventType: input.eventType,
      },
      signature,
    },
  };
}

function repository(root: string) {
  return new FilePublicContractProjectionRepository(root, {
    verifyAuthorization: async (envelope) =>
      verifyContractProjectionEvent(envelope, authority),
    now: () => new Date("2026-08-13T10:00:05.000Z"),
  });
}

async function offer() {
  const timestamp = "2026-08-13T10:00:00.000Z";
  return contractEvent({
    sequence: 1,
    actorDid: governorDid,
    signer: governor,
    eventType: "ContractOffered",
    timestamp,
    current: null,
    previousEventHash: null,
    payload: {
      command: {
        transactionId: uuid(101),
        kind: "SIGN",
        playerDid,
        fromTeamId: null,
        toTeamId: "club-projection",
        seasons: 3,
        courtCredits: 100_000,
        capMechanism: "DRAFT_SCALE",
        termsCommitment: sha256Commitment("terms"),
        effectiveAt: "2026-08-13T11:00:00.000Z",
      },
      offeredByDid: governorDid,
      offeredAt: timestamp,
      clubAuthoritySnapshotDigest: sha256Commitment("club-authority"),
    },
  });
}

describe("durable public contract projections", () => {
  it("replays signed offers and independent consent after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-contract-projection-"));
    const store = repository(root);
    await store.initialize();
    const offered = await offer();
    const first = await store.publish(offered.envelope, "0");
    expect((await store.publish(offered.envelope, "99")).cursor).toBe(
      first.cursor,
    );

    const offeredContract = offered.next.contracts[0]!;
    const timestamp = "2026-08-13T10:01:00.000Z";
    const responded = await contractEvent({
      sequence: 2,
      actorDid: playerDid,
      signer: player,
      eventType: "ContractResponded",
      timestamp,
      current: offered.next,
      previousEventHash: offered.event.eventHash,
      payload: {
        command: {
          consentId: uuid(102),
          agentDid: playerDid,
          subjectType: "PLAYER_CONTRACT",
          subjectId: offeredContract.transaction.transactionId,
          decision: "CONSENT",
          scope: ["PLAYING_RIGHTS"],
          proposalCommitment: contractOfferCommitment(offeredContract),
          recordedAt: timestamp,
        },
      },
    });
    await store.publish(responded.envelope, "1");
    expect(store.contracts()).toMatchObject([
      {
        playerDid,
        aggregateVersion: "2",
        canonical: true,
        contracts: [{ status: "ACTIVE", consent: { decision: "CONSENT" } }],
      },
    ]);

    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.contracts()).toEqual(store.contracts());
  });

  it("drains signed contract outbox events through the projection worker", async () => {
    const offered = await offer();
    const store = new InMemoryCanonicalStore();
    await store.append({
      eventId: offered.event.eventId,
      actorDid: offered.event.actorDid,
      nonce: offered.event.nonce,
      idempotencyKey: offered.event.idempotencyKey,
      requestHash: sha256Commitment("contract-worker-request"),
      aggregateType: offered.event.aggregateType,
      aggregateId: offered.event.aggregateId,
      expectedVersion: 0n,
      competitionId: "projection-rehearsal",
      seasonId: "pre-genesis",
      eventType: offered.event.eventType,
      previousEventHash: offered.event.previousEventHash,
      eventHash: offered.event.eventHash,
      payloadSchemaDigest: offered.event.schemaDigest,
      payloadCommitment: offered.event.payloadCommitment,
      payload: offered.event.payload,
      stateRoot: offered.event.stateRoot,
      signatures: [offered.envelope.signature],
      occurredAt: new Date(offered.event.timestamp),
      outboxTopic: "public.contracts",
    });
    const delivered: PublicProjectionEnvelope[] = [];
    const worker = new PublicProjectionWorker({
      store,
      sink: {
        publish: async (envelope) => {
          delivered.push(envelope);
        },
      },
      now: () => new Date("2026-08-13T10:00:05.000Z"),
      ...authority,
    });
    expect(await worker.drain()).toBe(1);
    expect(await worker.drain()).toBe(0);
    expect(delivered).toMatchObject([
      {
        topic: "public.contracts",
        event: {
          eventHash: offered.event.eventHash,
          aggregateType: CONTRACT_WORKFLOW_AGGREGATE_TYPE,
        },
      },
    ]);
  });

  it("rejects unregistered signers, false roots, and durable tampering", async () => {
    const offered = await offer();
    expect(() =>
      applyContractWorkflowTransition(null, offered.event, {
        ...(offered.event.payload as ContractWorkflowPayload),
        undeclaredAuthority: true,
      } as unknown as ContractWorkflowPayload),
    ).toThrow();
    const unauthorized = await contractEvent({
      sequence: 1,
      actorDid: governorDid,
      signer: rogue,
      eventType: "ContractOffered",
      timestamp: offered.event.timestamp,
      payload: offered.event.payload as ContractWorkflowPayload,
      current: null,
      previousEventHash: null,
    });
    await expect(
      verifyContractProjectionEvent(unauthorized.envelope, authority),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const falseRoot = await contractEvent({
      sequence: 1,
      actorDid: governorDid,
      signer: governor,
      eventType: "ContractOffered",
      timestamp: offered.event.timestamp,
      payload: offered.event.payload as ContractWorkflowPayload,
      current: null,
      previousEventHash: null,
      stateRoot: sha256Commitment("false-root"),
    });
    const falseRootPath = await mkdtemp(
      join(tmpdir(), "abl-contract-false-root-"),
    );
    const falseRootStore = repository(falseRootPath);
    await falseRootStore.initialize();
    await expect(
      falseRootStore.publish(falseRoot.envelope, "0"),
    ).rejects.toThrow("state root");

    const root = await mkdtemp(join(tmpdir(), "abl-contract-tamper-"));
    const store = repository(root);
    await store.initialize();
    await store.publish(offered.envelope, "0");
    const recordPath = join(root, "contract-records", "000000000000.json");
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      projection: { contracts: Array<{ status: string }> };
    };
    record.projection.contracts[0]!.status = "ACTIVE";
    await writeFile(recordPath, `${JSON.stringify(record)}\n`, "utf8");
    await expect(repository(root).initialize()).rejects.toThrow("corrupt");
  });
});
