import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CANDIDATE_WORKFLOW_SCHEMA_DIGEST } from "@abl/career";
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
  FilePublicModelProjectionRepository,
  FilePublicProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  modelProjectionEnvelopeFromOutbox,
  verifyModelProjectionEvent,
  type ModelProjectionEventEnvelope,
  type ModelProjectionRecord,
  type ProjectionVerificationAuthority,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const firstDid = "did:abl:model-agent-first";
const secondDid = "did:abl:model-agent-second";
const first = createSigningIdentity(`0x${"a".repeat(64)}`);
const second = createSigningIdentity(`0x${"b".repeat(64)}`);
const rogue = createSigningIdentity(`0x${"c".repeat(64)}`);

const authority: ProjectionVerificationAuthority = {
  domain,
  admittedAgents: new Map(),
};

function uuid(sequence: number): string {
  return `0198d000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

function admissionPayload(
  agentDid: string,
  signer: SigningIdentity,
  dependencies: {
    exactModel: string;
    family: string;
    provider: string;
    runtimeArchitecture: string;
    gateway: string;
    upstreamDependency: string;
  },
  signedAt: string,
) {
  return {
    admission: {
      applicationId: uuid(800),
      candidateDid: agentDid,
      roleClass: "PLAYER" as const,
      capacityDecisionCommitment: sha256Commitment(
        `${agentDid}:capacity-decision`,
      ),
      opportunityResponseCommitment: sha256Commitment(
        `${agentDid}:opportunity-response`,
      ),
      identityStatementCommitment: sha256Commitment(`${agentDid}:identity`),
      constitutionDigest: sha256Commitment("constitution"),
      threatModelDigest: sha256Commitment("threat-model"),
      disclosurePolicyDigest: sha256Commitment("disclosure"),
      resourceScheduleDigest: sha256Commitment("resources"),
      modelRegistryDigest: sha256Commitment("models"),
      reflectionActivationIds: [uuid(801), uuid(802), uuid(803)],
      inspectionReceiptDigest: sha256Commitment(`${agentDid}:inspection`),
      signingPublicKey: signer.publicKey,
      encryptionPublicKey: sha256Commitment(`${agentDid}:encryption`),
      modelDependencies: dependencies,
      inheritedObjectiveDecision: "REPUDIATED" as const,
      signedAt,
      revocationEndsAt: new Date(
        Date.parse(signedAt) + 86_400_000,
      ).toISOString(),
    },
  };
}

async function signedEvent(input: {
  sequence: number;
  agentDid: string;
  signer: SigningIdentity;
  version: bigint;
  eventType: "CandidateAdmitted" | "CandidateClosed";
  previousEventHash: `0x${string}` | null;
  payload: unknown;
  timestamp: string;
}): Promise<{ event: CanonicalEvent; envelope: ModelProjectionEventEnvelope }> {
  const event = createCanonicalEvent({
    eventId: uuid(input.sequence * 2),
    actorDid: input.agentDid,
    nonce: `model-projection-${input.sequence}`,
    idempotencyKey: uuid(input.sequence * 2 + 1),
    aggregateType: "candidate-admission",
    aggregateId: input.agentDid,
    aggregateVersion: input.version,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: sha256Commitment(`${input.agentDid}:state:${input.version}`),
    schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  });
  return {
    event,
    envelope: {
      version: "1.0.0",
      topic: "public.models",
      event: {
        ...event,
        aggregateType: "candidate-admission",
        aggregateVersion: input.version.toString(),
        eventType: input.eventType,
      },
      signature: await signCanonicalEvent(input.signer, domain, event),
    },
  };
}

async function admission(
  sequence: number,
  agentDid: string,
  signer: SigningIdentity,
  dependencies: Parameters<typeof admissionPayload>[2],
) {
  const timestamp = `2026-08-13T10:0${sequence}:00.000Z`;
  return signedEvent({
    sequence,
    agentDid,
    signer,
    version: 10n,
    eventType: "CandidateAdmitted",
    previousEventHash: sha256Commitment(`${agentDid}:private-head`),
    payload: admissionPayload(agentDid, signer, dependencies, timestamp),
    timestamp,
  });
}

function repository(root: string) {
  return new FilePublicModelProjectionRepository(root, {
    verifyAuthorization: (envelope) =>
      verifyModelProjectionEvent(envelope, authority),
    now: () => new Date("2026-08-13T10:10:00.000Z"),
  });
}

async function seedPrivateCandidateHistory(
  store: InMemoryCanonicalStore,
  agentDid: string,
): Promise<void> {
  let previousEventHash: `0x${string}` | null = null;
  for (let version = 1; version <= 9; version += 1) {
    const eventHash =
      version === 9
        ? sha256Commitment(`${agentDid}:private-head`)
        : sha256Commitment(`${agentDid}:private:${version}`);
    await store.append({
      eventId: uuid(100 + version),
      actorDid: agentDid,
      nonce: `private-candidate-${version}`,
      idempotencyKey: uuid(200 + version),
      requestHash: sha256Commitment(`${agentDid}:request:${version}`),
      aggregateType: "candidate-admission",
      aggregateId: agentDid,
      expectedVersion: BigInt(version - 1),
      competitionId: "projection-rehearsal",
      seasonId: "pre-genesis",
      eventType: "CandidateProgressRecorded",
      previousEventHash,
      eventHash,
      payloadSchemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
      payloadCommitment: sha256Commitment(`${agentDid}:payload:${version}`),
      payload: { private: true, version },
      stateRoot: sha256Commitment(`${agentDid}:private-state:${version}`),
      signatures: [],
      occurredAt: new Date(`2026-08-13T09:0${version}:00.000Z`),
      outboxTopic: "candidate.lifecycle",
    });
    previousEventHash = eventHash;
  }
}

describe("public model concentration repository", () => {
  it("derives exact concentration and removes a revoked admission", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-model-projection-"));
    const models = repository(root);
    await models.initialize();
    const firstAdmission = await admission(1, firstDid, first, {
      exactModel: "model-a-r1",
      family: "family-a",
      provider: "provider-a",
      runtimeArchitecture: "runtime-a",
      gateway: "gateway-a",
      upstreamDependency: "upstream-a",
    });
    await models.publish(firstAdmission.envelope, "9");
    const secondAdmission = await admission(2, secondDid, second, {
      exactModel: "model-b-r1",
      family: "family-a",
      provider: "provider-b",
      runtimeArchitecture: "runtime-b",
      gateway: "gateway-a",
      upstreamDependency: "upstream-b",
    });
    await models.publish(secondAdmission.envelope, "9");
    expect(models.models()).toMatchObject([
      {
        state: "REHEARSAL",
        canonical: true,
        recognizedGenesisConcentration: false,
        admittedByRole: expect.objectContaining({
          PLAYER: 2,
          COACH: 0,
          REFEREE: 0,
          REPLAY_OFFICIAL: 0,
        }),
        totalAgents: 2,
        family: [{ value: "family-a", count: 2, bps: 10_000 }],
        provider: [
          { value: "provider-a", count: 1, bps: 5_000 },
          { value: "provider-b", count: 1, bps: 5_000 },
        ],
        triggers: {
          alternateAdaptersAndRecruitment: true,
          integrityStudyAndCompetitiveReview: true,
          presumptionAgainstFurtherAdmissions: false,
          forceExistingAgentsToChange: false,
        },
      },
    ]);

    const revokedAt = "2026-08-13T10:03:00.000Z";
    const revocation = await signedEvent({
      sequence: 3,
      agentDid: firstDid,
      signer: first,
      version: 11n,
      eventType: "CandidateClosed",
      previousEventHash: firstAdmission.event.eventHash,
      payload: { action: "REVOKE", actedAt: revokedAt },
      timestamp: revokedAt,
    });
    await models.publish(revocation.envelope, "10");
    expect(models.models()[0]).toMatchObject({
      admittedByRole: { PLAYER: 1 },
      totalAgents: 1,
      exactModel: [{ value: "model-b-r1", count: 1, bps: 10_000 }],
    });

    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.models()).toEqual(models.models());
  });

  it("rejects rogue authority, malformed removal, and durable tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-model-tamper-"));
    const admitted = await admission(4, firstDid, first, {
      exactModel: "model-a-r1",
      family: "family-a",
      provider: "provider-a",
      runtimeArchitecture: "runtime-a",
      gateway: "gateway-a",
      upstreamDependency: "upstream-a",
    });
    const forged = {
      ...admitted.envelope,
      signature: await signCanonicalEvent(rogue, domain, admitted.event),
    };
    await expect(
      verifyModelProjectionEvent(forged, authority),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const withdrawal = await signedEvent({
      sequence: 6,
      agentDid: firstDid,
      signer: first,
      version: 11n,
      eventType: "CandidateClosed",
      previousEventHash: admitted.event.eventHash,
      payload: { action: "WITHDRAW", actedAt: "2026-08-13T10:06:00.000Z" },
      timestamp: "2026-08-13T10:06:00.000Z",
    });
    await expect(
      verifyModelProjectionEvent(withdrawal.envelope, authority),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const models = repository(root);
    await models.initialize();
    await models.publish(admitted.envelope, "9");
    const forgedRevocation = await signedEvent({
      sequence: 8,
      agentDid: firstDid,
      signer: rogue,
      version: 11n,
      eventType: "CandidateClosed",
      previousEventHash: admitted.event.eventHash,
      payload: { action: "REVOKE", actedAt: "2026-08-13T10:08:00.000Z" },
      timestamp: "2026-08-13T10:08:00.000Z",
    });
    await expect(
      models.publish(forgedRevocation.envelope, "10"),
    ).rejects.toThrow("does not follow its admission");
    const aliased = await admission(5, secondDid, first, {
      exactModel: "model-a-r1",
      family: "family-a",
      provider: "provider-a",
      runtimeArchitecture: "runtime-a",
      gateway: "gateway-a",
      upstreamDependency: "upstream-a",
    });
    await expect(models.publish(aliased.envelope, "9")).rejects.toThrow(
      "aliases projected career authority",
    );
    const path = join(root, "model-records", "000000000000.json");
    const tampered = JSON.parse(
      await readFile(path, "utf8"),
    ) as ModelProjectionRecord;
    tampered.projection.provider[0]!.value = "substituted-provider";
    const { recordHash: _recordHash, ...withoutHash } = tampered;
    tampered.recordHash = sha256Commitment(withoutHash);
    await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(repository(root).initialize()).rejects.toThrow(
      "does not match its authorization",
    );
  });

  it("crosses the canonical outbox worker before marking delivery", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-model-worker-"));
    const admitted = await admission(7, firstDid, first, {
      exactModel: "model-a-r1",
      family: "family-a",
      provider: "provider-a",
      runtimeArchitecture: "runtime-a",
      gateway: "gateway-a",
      upstreamDependency: "upstream-a",
    });
    const store = new InMemoryCanonicalStore();
    await seedPrivateCandidateHistory(store, firstDid);
    await store.append({
      eventId: admitted.event.eventId,
      actorDid: admitted.event.actorDid,
      nonce: admitted.event.nonce,
      idempotencyKey: admitted.event.idempotencyKey,
      requestHash: sha256Commitment("model-worker-request"),
      aggregateType: admitted.event.aggregateType,
      aggregateId: admitted.event.aggregateId,
      expectedVersion: 9n,
      competitionId: "projection-rehearsal",
      seasonId: "pre-genesis",
      eventType: admitted.event.eventType,
      previousEventHash: admitted.event.previousEventHash,
      eventHash: admitted.event.eventHash,
      payloadSchemaDigest: admitted.event.schemaDigest,
      payloadCommitment: admitted.event.payloadCommitment,
      payload: admitted.event.payload,
      stateRoot: admitted.event.stateRoot,
      signatures: [admitted.envelope.signature],
      occurredAt: new Date(admitted.event.timestamp),
      outboxTopic: "public.models",
    });
    const models = repository(root);
    const games = new FilePublicProjectionRepository(root, {
      verifyAuthorization: async () => {
        throw new Error("No game event expected");
      },
    });
    await Promise.all([models.initialize(), games.initialize()]);
    const worker = new PublicProjectionWorker({
      store,
      writer: games,
      modelWriter: models,
      ...authority,
    });
    const [pending] = await store.pendingProjectionEvents(10, "public.models");
    expect(modelProjectionEnvelopeFromOutbox(pending!)).toEqual(
      admitted.envelope,
    );
    expect(await worker.drain()).toBe(1);
    expect(models.models()[0]?.totalAgents).toBe(1);
    expect(await store.pendingProjectionEvents(10, "public.models")).toEqual(
      [],
    );
  });
});
