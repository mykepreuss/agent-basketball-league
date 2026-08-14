import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
import {
  RELEASE_WORKFLOW_AGGREGATE_TYPE,
  RELEASE_WORKFLOW_SCHEMA_DIGEST,
  ReleaseStayPayloadSchema,
  ReleaseWorkflowAuthorizationError,
  applyReleaseWorkflowTransition,
  releaseExecutableDigest,
  releaseManifestCommitment,
  releaseVerifierResultDigest,
  releaseWorkflowStateRoot,
  requireReleaseRatifications,
  type ReleaseApprovalCommand,
  type ReleaseInstitutionalRoster,
  type ReleaseManifestBody,
  type ReleaseProposalPayload,
  type ReleaseRatification,
  type ReleaseVerifierResult,
  type ReleaseWorkflowEventType,
  type ReleaseWorkflowPayload,
  type ReleaseWorkflowSnapshot,
} from "@abl/institutions";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  FilePublicProjectionRepository,
  FilePublicReleaseProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  releaseProjectionEnvelopeFromOutbox,
  verifyReleaseProjectionEvent,
  type ReleaseProjectionEventEnvelope,
  type ReleaseProjectionRecord,
  type ReleaseProjectionVerificationAuthority,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const releaseId = "0198d000-0000-7000-8000-000000000001";
const lawEventId = "0198d000-0000-7000-8000-000000000002";
const proposalId = "0198d000-0000-7000-8000-000000000003";
const ratificationEventId = "0198d000-0000-7000-8000-000000000004";
const start = Date.parse("2026-08-13T09:00:00.000Z");
const stateEventHashes = new WeakMap<ReleaseWorkflowSnapshot, Hex>();

function identity(label: string): SigningIdentity {
  return createSigningIdentity(sha256Commitment({ label }));
}

const agents = {
  proposer: { did: "did:abl:release-proposer", identity: identity("p") },
  c1: { did: "did:abl:commissioner-1", identity: identity("c1") },
  c2: { did: "did:abl:commissioner-2", identity: identity("c2") },
  c3: { did: "did:abl:commissioner-3", identity: identity("c3") },
  i1: { did: "did:abl:integrity-1", identity: identity("i1") },
  i2: { did: "did:abl:integrity-2", identity: identity("i2") },
  i3: { did: "did:abl:integrity-3", identity: identity("i3") },
  t1: { did: "did:abl:tribunal-1", identity: identity("t1") },
  t2: { did: "did:abl:tribunal-2", identity: identity("t2") },
  t3: { did: "did:abl:tribunal-3", identity: identity("t3") },
  t4: { did: "did:abl:tribunal-4", identity: identity("t4") },
  t5: { did: "did:abl:tribunal-5", identity: identity("t5") },
  rogue: { did: "did:abl:release-rogue", identity: identity("r") },
} as const;

const roster: ReleaseInstitutionalRoster = {
  commissioners: [agents.c1.did, agents.c2.did, agents.c3.did],
  integrityOfficers: [agents.i1.did, agents.i2.did, agents.i3.did],
  tribunalDids: [
    agents.t1.did,
    agents.t2.did,
    agents.t3.did,
    agents.t4.did,
    agents.t5.did,
  ],
};

function verifierResult(id = releaseId): ReleaseVerifierResult {
  return {
    format: "ABL-PUBLIC-VERIFIER-RESULT-V1",
    releaseId: id,
    releaseVersion: 1,
    sourceDigest: sha256Commitment("source"),
    imageDigests: [sha256Commitment("image")],
    schemaDigest: sha256Commitment("schema"),
    migrationDigest: sha256Commitment("migration"),
    testResultDigest: sha256Commitment("tests"),
    result: "PASS",
    verifiedAt: new Date(start - 60_000).toISOString(),
  };
}

function manifest(
  input: {
    releaseClass?: ReleaseManifestBody["releaseClass"];
    changeClasses?: ReleaseManifestBody["changeClasses"];
    ratificationEventIds?: string[];
    expiresAt?: string | null;
  } = {},
): ReleaseManifestBody {
  const verifier = verifierResult();
  return {
    releaseId,
    version: 1,
    releaseClass: input.releaseClass ?? "ROUTINE",
    changeClasses: input.changeClasses ?? ["ARENA_RENDERING"],
    sourceDigest: verifier.sourceDigest,
    containerDigests: [sha256Commitment("container")],
    imageDigests: verifier.imageDigests,
    kernelDigest: sha256Commitment("kernel"),
    toolDigest: sha256Commitment("tools"),
    schemaDigest: verifier.schemaDigest,
    migrationDigest: verifier.migrationDigest,
    testResultDigest: verifier.testResultDigest,
    applicableLawEventIds: [lawEventId],
    ratificationEventIds: input.ratificationEventIds ?? [],
    compatibilityDeclaration: "State and career formats remain compatible.",
    rollbackDeclaration:
      "Stop rehearsal and restore the prior immutable image.",
    publicVerifierResultDigest: releaseVerifierResultDigest(verifier),
    effectiveAt: new Date(start + 24 * 60 * 60 * 1_000).toISOString(),
    expiresAt: input.expiresAt ?? null,
  };
}

function authority(): ReleaseProjectionVerificationAuthority {
  return {
    domain,
    admittedAgents: new Map(
      Object.values(agents).map((agent) => [
        agent.did,
        {
          signerAddress: agent.identity.address,
          allowedAggregateTypes: [RELEASE_WORKFLOW_AGGREGATE_TYPE],
        },
      ]),
    ),
    releaseInstitutionalRoster: roster,
  };
}

function eventId(sequence: number): string {
  return `0198d000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

async function releaseEvent(input: {
  state: ReleaseWorkflowSnapshot | null;
  eventType: ReleaseWorkflowEventType;
  payload: ReleaseWorkflowPayload;
  actor: (typeof agents)[keyof typeof agents];
  signers?: readonly SigningIdentity[];
  sequence: number;
}): Promise<{
  envelope: ReleaseProjectionEventEnvelope;
  state: ReleaseWorkflowSnapshot;
}> {
  const timestamp = new Date(start + input.sequence * 60_000).toISOString();
  const common = {
    eventId: eventId(100 + input.sequence),
    actorDid: input.actor.did,
    nonce: `release-${input.sequence}`,
    idempotencyKey: eventId(200 + input.sequence),
    aggregateType: RELEASE_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: releaseId,
    aggregateVersion: BigInt((input.state?.version ?? 0) + 1),
    eventType: input.eventType,
    previousEventHash: null as `0x${string}` | null,
    payload: input.payload,
    schemaDigest: RELEASE_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  };
  const provisional = createCanonicalEvent({
    ...common,
    stateRoot: sha256Commitment("provisional"),
  });
  const state = applyReleaseWorkflowTransition(
    input.state,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...common,
    previousEventHash:
      input.state === null ? null : (stateEventHashes.get(input.state) ?? null),
    stateRoot: releaseWorkflowStateRoot(state),
  });
  stateEventHashes.set(state, event.eventHash);
  const signatures = await Promise.all(
    (input.signers ?? [input.actor.identity]).map((signer) =>
      signCanonicalEvent(signer, domain, event),
    ),
  );
  return {
    envelope: {
      version: "1.0.0",
      topic: "public.releases",
      event: {
        ...event,
        aggregateType: RELEASE_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: event.aggregateVersion.toString(),
        eventType: input.eventType,
      },
      signatures,
    },
    state,
  };
}

function approval(
  release: ReleaseManifestBody,
  agent: (typeof agents)[keyof typeof agents],
  role: ReleaseApprovalCommand["role"],
  sequence: number,
): ReleaseWorkflowPayload {
  return {
    command: {
      approverDid: agent.did,
      role,
      releaseId,
      releaseVersion: 1,
      manifestCommitment: releaseManifestCommitment(release),
      approvedAt: new Date(start + sequence * 60_000).toISOString(),
    },
  };
}

async function routineSequence(): Promise<ReleaseProjectionEventEnvelope[]> {
  const release = manifest();
  const proposal: ReleaseProposalPayload = {
    manifest: release,
    verifierResult: verifierResult(),
    ratificationProposalIds: [],
  };
  const envelopes: ReleaseProjectionEventEnvelope[] = [];
  let state: ReleaseWorkflowSnapshot | null = null;
  const steps = [
    {
      eventType: "ReleaseProposed" as const,
      payload: proposal,
      actor: agents.proposer,
    },
    {
      eventType: "ReleaseApproved" as const,
      payload: approval(release, agents.c1, "COMMISSIONER", 2),
      actor: agents.c1,
    },
    {
      eventType: "ReleaseApproved" as const,
      payload: approval(release, agents.c2, "COMMISSIONER", 3),
      actor: agents.c2,
    },
    {
      eventType: "ReleaseApproved" as const,
      payload: approval(release, agents.i1, "INTEGRITY", 4),
      actor: agents.i1,
    },
    {
      eventType: "ReleaseApproved" as const,
      payload: approval(release, agents.i2, "INTEGRITY", 5),
      actor: agents.i2,
    },
    {
      eventType: "ReleaseAuthorized" as const,
      payload: {
        command: {
          releaseId,
          releaseVersion: 1,
          manifestCommitment: releaseManifestCommitment(release),
          authorizedAt: new Date(start + 6 * 60_000).toISOString(),
        },
      },
      actor: agents.c1,
    },
  ];
  for (const [index, step] of steps.entries()) {
    const next = await releaseEvent({
      state,
      eventType: step.eventType,
      payload: step.payload,
      actor: step.actor,
      sequence: index + 1,
    });
    state = next.state;
    envelopes.push(next.envelope);
  }
  return envelopes;
}

function repository(root: string) {
  const verificationAuthority = authority();
  return new FilePublicReleaseProjectionRepository(root, {
    verifyAuthorization: (envelope) =>
      verifyReleaseProjectionEvent(envelope, verificationAuthority),
    releaseRatification: async () => null,
    releaseVerifierResult: async (resultDigest) => {
      const result = verifierResult();
      return releaseVerifierResultDigest(result) === resultDigest
        ? result
        : null;
    },
    now: () => new Date(start + 10 * 60_000),
  });
}

describe("public software-release repository", () => {
  it("verifies role-bound approvals and exposes only the authorized rehearsal release", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-release-projection-"));
    const releases = repository(root);
    await releases.initialize();
    const sequence = await routineSequence();
    const unregisteredRoot = await mkdtemp(
      join(tmpdir(), "abl-release-unregistered-verifier-"),
    );
    const unregistered = new FilePublicReleaseProjectionRepository(
      unregisteredRoot,
      {
        verifyAuthorization: (envelope) =>
          verifyReleaseProjectionEvent(envelope, authority()),
        releaseRatification: async () => null,
        releaseVerifierResult: async () => null,
      },
    );
    await unregistered.initialize();
    await expect(unregistered.publish(sequence[0]!, "0")).rejects.toThrow(
      "configured evidence registry",
    );
    for (const [index, envelope] of sequence.entries()) {
      const record = await releases.publish(envelope, String(index));
      expect(record.projection === null).toBe(index < sequence.length - 1);
    }
    expect(releases.releases()).toMatchObject([
      {
        releaseId,
        workflowAggregateVersion: "6",
        recognizedGenesisRelease: false,
        baseRecognition: "NOT_SUBMITTED",
        manifest: { authorizationSignatures: expect.any(Array) },
      },
    ]);
    expect(
      releases.releases()[0]!.manifest.authorizationSignatures,
    ).toHaveLength(4);
    expect(releases.releases()[0]!.authorizationProofs).toHaveLength(4);

    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.releases()).toEqual(releases.releases());

    const path = join(root, "release-records", "000000000005.json");
    const tampered = JSON.parse(
      await readFile(path, "utf8"),
    ) as ReleaseProjectionRecord;
    tampered.projection!.baseRecognition = "NOT_SUBMITTED";
    tampered.projection!.manifest.rollbackDeclaration = "forged rollback";
    const { recordHash: _recordHash, ...withoutHash } = tampered;
    tampered.recordHash = sha256Commitment(withoutHash);
    await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(repository(root).initialize()).rejects.toThrow(
      "does not match its authorization",
    );
  });

  it("rejects rogue office claims, insufficient thresholds, and a stayed release", async () => {
    const sequence = await routineSequence();
    const forged = structuredClone(sequence[1]!);
    forged.event.actorDid = agents.rogue.did;
    await expect(
      verifyReleaseProjectionEvent(forged, authority()),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const release = manifest();
    let state: ReleaseWorkflowSnapshot | null = null;
    const proposed = await releaseEvent({
      state,
      eventType: "ReleaseProposed",
      payload: {
        manifest: release,
        verifierResult: verifierResult(),
        ratificationProposalIds: [],
      },
      actor: agents.proposer,
      sequence: 1,
    });
    state = proposed.state;
    for (const [index, [agent, role]] of [
      [agents.c1, "COMMISSIONER"],
      [agents.c2, "COMMISSIONER"],
      [agents.i1, "INTEGRITY"],
    ].entries()) {
      state = (
        await releaseEvent({
          state,
          eventType: "ReleaseApproved",
          payload: approval(
            release,
            agent as (typeof agents)[keyof typeof agents],
            role as ReleaseApprovalCommand["role"],
            index + 2,
          ),
          actor: agent as (typeof agents)[keyof typeof agents],
          sequence: index + 2,
        })
      ).state;
    }
    await expect(
      releaseEvent({
        state,
        eventType: "ReleaseAuthorized",
        payload: {
          command: {
            releaseId,
            releaseVersion: 1,
            manifestCommitment: releaseManifestCommitment(release),
            authorizedAt: new Date(start + 5 * 60_000).toISOString(),
          },
        },
        actor: agents.c1,
        sequence: 5,
      }),
    ).rejects.toBeInstanceOf(ReleaseWorkflowAuthorizationError);

    const stay = await releaseEvent({
      state: proposed.state,
      eventType: "ReleaseStayed",
      payload: {
        command: {
          releaseId,
          manifestCommitment: releaseManifestCommitment(release),
          participatingTribunalDids: [
            agents.t1.did,
            agents.t2.did,
            agents.t3.did,
          ],
          recusedTribunalDids: [],
          reasonedPublicCommitment: sha256Commitment("stay"),
          stayedAt: new Date(start + 2 * 60_000).toISOString(),
        },
      },
      actor: agents.t1,
      signers: [agents.t1.identity, agents.t2.identity, agents.t3.identity],
      sequence: 2,
    });
    await expect(
      verifyReleaseProjectionEvent(stay.envelope, authority()),
    ).resolves.toMatchObject({ expectedVersion: "1" });

    const invalidRecusal = await releaseEvent({
      state: proposed.state,
      eventType: "ReleaseStayed",
      payload: {
        command: {
          ...ReleaseStayPayloadSchema.parse(stay.envelope.event.payload)
            .command,
          recusedTribunalDids: [agents.rogue.did],
        },
      },
      actor: agents.t1,
      signers: [agents.t1.identity, agents.t2.identity, agents.t3.identity],
      sequence: 2,
    });
    await expect(
      verifyReleaseProjectionEvent(invalidRecusal.envelope, authority()),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
  });

  it("requires exact ratification evidence and bounds emergency mutations", async () => {
    const labor = manifest({
      releaseClass: "COMPETITION_LABOR",
      changeClasses: ["LABOR_TERMS"],
      ratificationEventIds: [ratificationEventId],
    });
    const proposal: ReleaseProposalPayload = {
      manifest: labor,
      verifierResult: verifierResult(),
      ratificationProposalIds: [proposalId],
    };
    const proposed = await releaseEvent({
      state: null,
      eventType: "ReleaseProposed",
      payload: proposal,
      actor: agents.proposer,
      sequence: 1,
    });
    const ratification: ReleaseRatification = {
      proposalId,
      proposalClass: "TIER_CBA",
      executableChangeDigest: releaseExecutableDigest(labor),
      passed: true,
      closeEventId: ratificationEventId,
    };
    await expect(
      requireReleaseRatifications(proposed.state, {
        releaseRatification: async () => ratification,
      }),
    ).resolves.toEqual([ratification]);
    await expect(
      requireReleaseRatifications(proposed.state, {
        releaseRatification: async () => ({
          ...ratification,
          executableChangeDigest: sha256Commitment("wrong"),
        }),
      }),
    ).rejects.toBeInstanceOf(ReleaseWorkflowAuthorizationError);

    expect(() =>
      applyReleaseWorkflowTransition(
        null,
        {
          actorDid: agents.proposer.did,
          aggregateId: releaseId,
          aggregateVersion: 1n,
          eventType: "ReleaseProposed",
          timestamp: new Date(start + 60_000).toISOString(),
        },
        {
          manifest: manifest({
            releaseClass: "EMERGENCY_SECURITY",
            changeClasses: ["SCORES"],
            expiresAt: new Date(start + 48 * 60 * 60 * 1_000).toISOString(),
          }),
          verifierResult: verifierResult(),
          ratificationProposalIds: [],
        },
      ),
    ).toThrow();
  });

  it("crosses the outbox worker and marks release events only after durable replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-release-worker-"));
    const store = new InMemoryCanonicalStore();
    const sequence = await routineSequence();
    for (const envelope of sequence) {
      const event = {
        ...envelope.event,
        aggregateVersion: BigInt(envelope.event.aggregateVersion),
      };
      await store.append({
        eventId: event.eventId,
        actorDid: event.actorDid,
        nonce: event.nonce,
        idempotencyKey: event.idempotencyKey,
        requestHash: sha256Commitment({
          eventHash: event.eventHash,
          signatures: envelope.signatures,
        }),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        expectedVersion: event.aggregateVersion - 1n,
        competitionId: "release-rehearsal",
        seasonId: "pre-genesis",
        eventType: event.eventType,
        previousEventHash: event.previousEventHash,
        eventHash: event.eventHash,
        payloadSchemaDigest: event.schemaDigest,
        payloadCommitment: event.payloadCommitment,
        payload: event.payload,
        stateRoot: event.stateRoot,
        signatures: envelope.signatures,
        occurredAt: new Date(event.timestamp),
        outboxTopic: "public.releases",
      });
    }
    const releases = repository(root);
    await releases.initialize();
    const games = new FilePublicProjectionRepository(root, {
      verifyAuthorization: async () => {
        throw new Error("No game event expected");
      },
    });
    await games.initialize();
    const worker = new PublicProjectionWorker({
      store,
      writer: games,
      releaseWriter: releases,
      releaseRatification: async () => null,
      ...authority(),
    });
    const [pending] = await store.pendingProjectionEvents(
      10,
      "public.releases",
    );
    expect(releaseProjectionEnvelopeFromOutbox(pending!)).toEqual(sequence[0]);
    expect(await worker.drain()).toBe(sequence.length);
    expect(releases.releases()).toHaveLength(1);
    expect(await store.pendingProjectionEvents(10, "public.releases")).toEqual(
      [],
    );
  });
});
