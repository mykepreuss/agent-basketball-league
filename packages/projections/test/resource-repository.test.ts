import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
import {
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  applyResourceScheduleTransition,
  resourceScheduleExecutableDigest,
  resourceScheduleStateRoot,
  type ResourceSchedule,
} from "@abl/institutions";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  FilePublicProjectionRepository,
  FilePublicResourceProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  resourceProjectionEnvelopeFromOutbox,
  verifyResourceProjectionEvent,
  type ResourceProjectionEventEnvelope,
  type ResourceProjectionRecord,
  type ResourceProjectionVerificationAuthority,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const publisherDid = "did:abl:resource-projection-publisher";
const publisher = createSigningIdentity(`0x${"8".repeat(64)}`);
const rogue = createSigningIdentity(`0x${"9".repeat(64)}`);
const scheduleId = "0198c000-0000-7000-8000-000000000001";
const proposalId = "0198c000-0000-7000-8000-000000000002";
const closeEventId = "0198c000-0000-7000-8000-000000000003";

const schedule: ResourceSchedule = {
  scheduleId,
  version: 1,
  effectiveAt: "2026-08-14T00:00:00.000Z",
  gameDayRoleUnits: {
    PLAYER: 100,
    COACH: 80,
    REFEREE: 60,
    REPLAY: 60,
  },
  universalMinimumUnits: 40,
  autonomy: {
    activationsPerWeek: 4,
    interactiveMinutesPerActivation: 15,
    sandboxComputeMinutesPerWeek: 60,
    normalizedModelTokensPerWeek: 96_000,
    rolloverWeeks: 1,
  },
  teamPreparationCapUnits: 2_000,
  conversionFactors: [
    {
      provider: "provider-a",
      modelRevision: "model-a-2026-08-13",
      unitsPerThousandTokens: 1.25,
    },
  ],
  ratificationEventId: closeEventId,
};

const ratification = {
  proposalId,
  proposalClass: "CONSTITUTIONAL",
  executableChangeDigest: resourceScheduleExecutableDigest(schedule),
  passed: true,
  closeEventId,
};

function authority(
  value: typeof ratification | null = ratification,
): ResourceProjectionVerificationAuthority {
  return {
    domain,
    admittedAgents: new Map([
      [
        publisherDid,
        {
          signerAddress: publisher.address,
          allowedAggregateTypes: [RESOURCE_SCHEDULE_AGGREGATE_TYPE],
        },
      ],
    ]),
    resourceScheduleRatification: async (requestedProposalId) =>
      requestedProposalId === proposalId ? value : null,
  };
}

async function resourceEvent(
  signer = publisher,
): Promise<ResourceProjectionEventEnvelope> {
  const payload = { schedule, ratificationProposalId: proposalId };
  const eventInput = {
    eventId: "0198c000-0000-7000-8000-000000000004",
    actorDid: publisherDid,
    nonce: "resource-projection-1",
    idempotencyKey: "0198c000-0000-7000-8000-000000000005",
    aggregateType: RESOURCE_SCHEDULE_AGGREGATE_TYPE,
    aggregateId: scheduleId,
    aggregateVersion: 1n,
    eventType: RESOURCE_SCHEDULE_EVENT_TYPE,
    previousEventHash: null,
    payload,
    schemaDigest: RESOURCE_SCHEDULE_SCHEMA_DIGEST,
    timestamp: "2026-08-13T09:00:00.000Z",
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: sha256Commitment("provisional"),
  });
  const snapshot = applyResourceScheduleTransition(null, provisional, payload);
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: resourceScheduleStateRoot(snapshot),
  });
  return {
    version: "1.0.0",
    topic: "public.resources",
    event: {
      ...event,
      aggregateType: RESOURCE_SCHEDULE_AGGREGATE_TYPE,
      aggregateVersion: "1",
      eventType: RESOURCE_SCHEDULE_EVENT_TYPE,
    },
    signature: await signCanonicalEvent(signer, domain, event),
  };
}

function repository(root: string) {
  const verificationAuthority = authority();
  return new FilePublicResourceProjectionRepository(root, {
    verifyAuthorization: (envelope) =>
      verifyResourceProjectionEvent(envelope, verificationAuthority),
    now: () => new Date("2026-08-13T09:01:00.000Z"),
  });
}

describe("public resource schedule repository", () => {
  it("verifies exact ratification and career authority", async () => {
    const envelope = await resourceEvent();
    await expect(
      verifyResourceProjectionEvent(envelope, authority()),
    ).resolves.toMatchObject({ expectedVersion: "0", payload: { schedule } });
    await expect(
      verifyResourceProjectionEvent(await resourceEvent(rogue), authority()),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
    await expect(
      verifyResourceProjectionEvent(envelope, authority(null)),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
    await expect(
      verifyResourceProjectionEvent(
        envelope,
        authority({ ...ratification, passed: false }),
      ),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
  });

  it("persists, deduplicates, restores, and rejects projection tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-resource-projection-"));
    const envelope = await resourceEvent();
    const first = repository(root);
    await first.initialize();
    const record = await first.publish(envelope, "0");
    expect(record.projection).toMatchObject({
      recognizedGenesisResources: false,
      scheduleId,
      aggregateVersion: "1",
      schedule,
      ratificationProposalId: proposalId,
    });
    await expect(first.publish(envelope, "0")).resolves.toEqual(record);
    expect(first.resources()).toHaveLength(1);

    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.resources()).toEqual(first.resources());

    const path = join(root, "resource-records", "000000000000.json");
    const tampered = JSON.parse(
      await readFile(path, "utf8"),
    ) as ResourceProjectionRecord;
    tampered.projection.schedule.universalMinimumUnits += 1;
    const { recordHash: _recordHash, ...withoutHash } = tampered;
    tampered.recordHash = sha256Commitment(withoutHash);
    await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(repository(root).initialize()).rejects.toThrow(
      "does not match its authorization",
    );
  });

  it("crosses the outbox worker and marks the event only after durable publish", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-resource-worker-"));
    const envelope = await resourceEvent();
    const event = {
      ...envelope.event,
      aggregateVersion: BigInt(envelope.event.aggregateVersion),
    };
    const store = new InMemoryCanonicalStore();
    await store.append({
      eventId: event.eventId,
      actorDid: event.actorDid,
      nonce: event.nonce,
      idempotencyKey: event.idempotencyKey,
      requestHash: sha256Commitment({
        eventHash: event.eventHash,
        signatures: [envelope.signature],
      }),
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      expectedVersion: 0n,
      competitionId: "resource-rehearsal",
      seasonId: "pre-genesis",
      eventType: event.eventType,
      previousEventHash: event.previousEventHash,
      eventHash: event.eventHash,
      payloadSchemaDigest: event.schemaDigest,
      payloadCommitment: event.payloadCommitment,
      payload: event.payload,
      stateRoot: event.stateRoot,
      signatures: [envelope.signature],
      occurredAt: new Date(event.timestamp),
      outboxTopic: "public.resources",
    });
    const resources = repository(root);
    await resources.initialize();
    const games = new FilePublicProjectionRepository(root, {
      verifyAuthorization: async () => {
        throw new Error("No game event expected");
      },
    });
    await games.initialize();
    const worker = new PublicProjectionWorker({
      store,
      writer: games,
      resourceWriter: resources,
      ...authority(),
    });
    const [pending] = await store.pendingProjectionEvents(
      10,
      "public.resources",
    );
    expect(resourceProjectionEnvelopeFromOutbox(pending!)).toEqual(envelope);
    expect(await worker.drain()).toBe(1);
    expect(resources.resources()).toHaveLength(1);
    expect(await store.pendingProjectionEvents(10, "public.resources")).toEqual(
      [],
    );
  });
});
