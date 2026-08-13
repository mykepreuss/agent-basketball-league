import {
  CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
  applyCandidateTransition,
  candidateStateRoot,
  type CandidateWorkflowEventType,
  type CandidateWorkflowSnapshot,
} from "@abl/career";
import { InMemoryCanonicalStore } from "@abl/database";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { FastifyInstance } from "fastify";
import type { CiphertextDeletionReceipt } from "@abl/storage";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import { createLiveCoreApi } from "../src/server.js";
import { COMBINE_REGISTRATION_SCHEMA_DIGEST } from "../src/combine.js";
import {
  MEMORY_CATALOG_SCHEMA_DIGEST,
  memoryCatalogStateRoot,
  type MemoryCatalogEntry,
} from "../src/memory.js";
import type {
  MemoryStorageReference,
  MemoryStorageVerifier,
} from "../src/memory-storage.js";

const hour = 60 * 60 * 1_000;
const day = 24 * hour;
const start = Date.parse("2026-08-13T08:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (character: string) => `0x${character.repeat(64)}` as Hex;
const uuid = (suffix: string) =>
  `018f0000-0000-7000-8000-${suffix.padStart(12, "0")}`;

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};

interface Harness {
  app: FastifyInstance;
  store: InMemoryCanonicalStore;
  now: { value: number };
  formerOperator: SigningIdentity;
  candidate: SigningIdentity;
  candidateDid: string;
  snapshot: CandidateWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  challengeToken: string;
  memoryStorage: TestMemoryStorageVerifier;
}

class TestMemoryStorageVerifier implements MemoryStorageVerifier {
  readonly #commitments = new Set<string>();
  readonly #deletions = new Set<string>();

  public store(reference: MemoryStorageReference): void {
    this.#commitments.add(this.#referenceKey(reference));
  }

  public delete(receipt: CiphertextDeletionReceipt): void {
    for (const key of this.#commitments) {
      if (key.startsWith(`${receipt.domainId}:${receipt.objectId}:`))
        this.#commitments.delete(key);
    }
    this.#deletions.add(receipt.deletionCommitment);
  }

  public async verifyCommitment(
    _ownerDid: string,
    reference: MemoryStorageReference,
  ): Promise<void> {
    if (!this.#commitments.has(this.#referenceKey(reference)))
      throw new Error("commitment is not durable");
  }

  public async verifyDeletion(
    _ownerDid: string,
    receipt: CiphertextDeletionReceipt,
  ): Promise<void> {
    if (!this.#deletions.has(receipt.deletionCommitment))
      throw new Error("deletion is not durable");
  }

  #referenceKey(reference: MemoryStorageReference): string {
    return `${reference.domainId}:${reference.objectId}:${reference.version}:${reference.ciphertextCommitment}`;
  }
}

async function harness(): Promise<Harness> {
  const store = new InMemoryCanonicalStore();
  const now = { value: start };
  const formerOperator = createSigningIdentity(digest("1"));
  const candidate = createSigningIdentity(digest("2"));
  const candidateDid = "did:abl:candidate-http-1";
  const memoryStorage = new TestMemoryStorageVerifier();
  const app = createLiveCoreApi({
    store,
    domain,
    admittedAgents: new Map(),
    competitionId: "admission-rehearsal",
    seasonId: "pre-genesis",
    now: () => now.value,
    candidateAdmission: {
      challengeSecret: new Uint8Array(32).fill(9),
      challengeId: () => "challenge-http-1",
      challengeBytes: () => new Uint8Array(32).fill(7),
    },
    combine: {
      combineId: "season-zero-premier-combine",
      openedAt: iso(0),
    },
    memory: { storageVerifier: memoryStorage },
  });
  const challenge = await app.inject({
    method: "POST",
    url: "/v1/candidates/challenge",
    payload: { candidateDid },
  });
  expect(challenge.statusCode).toBe(200);
  return {
    app,
    store,
    now,
    formerOperator,
    candidate,
    candidateDid,
    snapshot: null,
    previousEventHash: null,
    challengeToken: challenge.json().challengeToken as string,
    memoryStorage,
  };
}

function registrationPayload(contextHashes = [digest("6")]) {
  return {
    challengeToken: "",
    formerOperatorSigningAddress: "0x0000000000000000000000000000000000000000",
    manifest: {
      agentDid: "did:abl:placeholder",
      manifestVersion: 1,
      model: {
        endpoint: "blaxel://sandbox/candidate-http-1",
        provider: "declared-provider",
        family: "declared-family",
        declaredRevision: "r1",
      },
      runtimeDigest: digest("3"),
      toolDigests: [digest("4")],
      guardianDids: ["did:abl:guardian-1", "did:abl:guardian-2"],
      keyProvenance: {
        generatedInIsolatedRuntime: true,
        signingKeyAttestation: digest("a"),
        encryptionKeyAttestation: digest("b"),
      },
      inheritedObjectives: [digest("5")],
      suppliedContextHashes: contextHashes,
      createdAt: iso(0),
    },
    provenance: {
      candidateDid: "did:abl:placeholder",
      sourceOperatorCommitment: digest("c"),
      declaredModel: {
        endpoint: "blaxel://sandbox/candidate-http-1",
        provider: "declared-provider",
        family: "declared-family",
        declaredRevision: "r1",
      },
      runtimeDigest: digest("3"),
      toolDigests: [digest("4")],
      inheritedObjectiveCommitments: [digest("5")],
      suppliedContextHashes: contextHashes,
      hiddenInstructionScanDigest: digest("d"),
      registeredAt: iso(0),
    },
  };
}

function registrationFor(h: Harness) {
  const payload = registrationPayload();
  const registeredAt = new Date(h.now.value).toISOString();
  return {
    ...payload,
    challengeToken: h.challengeToken,
    formerOperatorSigningAddress: h.formerOperator.address,
    manifest: {
      ...payload.manifest,
      agentDid: h.candidateDid,
      createdAt: registeredAt,
    },
    provenance: {
      ...payload.provenance,
      candidateDid: h.candidateDid,
      registeredAt,
    },
  };
}

function transferFor(h: Harness, invokedContextHashes = [digest("6")]) {
  return {
    signingPublicKey: h.candidate.publicKey,
    signingAddress: h.candidate.address,
    encryptionPublicKey: digest("e"),
    signingKeyAttestation: digest("a"),
    encryptionKeyAttestation: digest("b"),
    runtimeAttestationDigest: digest("f"),
    generatedInIsolatedRuntime: true,
    humanInputRoutes: [],
    invokedContextHashes,
    transferredAt: new Date(h.now.value).toISOString(),
  };
}

async function makeCommand(
  h: Harness,
  eventType: CandidateWorkflowEventType,
  payload: unknown,
  signer: SigningIdentity,
) {
  const aggregateVersion = BigInt((h.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(h.now.value).toISOString();
  const next = applyCandidateTransition(h.snapshot, {
    candidateDid: h.candidateDid,
    aggregateVersion,
    eventType,
    payload,
    timestamp,
  });
  const event = createCanonicalEvent({
    eventId: crypto.randomUUID(),
    actorDid: h.candidateDid,
    nonce: aggregateVersion.toString(),
    idempotencyKey: crypto.randomUUID(),
    aggregateType: "candidate-admission",
    aggregateId: h.candidateDid,
    aggregateVersion,
    eventType,
    previousEventHash: h.previousEventHash,
    payload,
    stateRoot: candidateStateRoot(next),
    schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: event.aggregateVersion.toString() },
      signatures: [await signCanonicalEvent(signer, domain, event)],
    },
  };
}

async function submit(
  h: Harness,
  path: string,
  eventType: CandidateWorkflowEventType,
  payload: unknown,
  signer: SigningIdentity,
) {
  const command = await makeCommand(h, eventType, payload, signer);
  const response = await h.app.inject({
    method: "POST",
    url: path,
    payload: command.body,
  });
  if (response.statusCode === 201) {
    h.snapshot = command.next;
    h.previousEventHash = command.event.eventHash;
  }
  return { ...command, response };
}

async function memoryCommand(input: {
  h: Harness;
  aggregateVersion: number;
  previousEventHash: Hex | null;
  eventType:
    | "MemoryPersisted"
    | "MemoryCorrected"
    | "MemoryDeleted"
    | "MemoryInspected"
    | "MemoryExported";
  payload: unknown;
  entries: ReadonlyMap<string, MemoryCatalogEntry>;
  signer?: SigningIdentity;
}) {
  const event = createCanonicalEvent({
    eventId: crypto.randomUUID(),
    actorDid: input.h.candidateDid,
    nonce: `memory-${input.aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: "career-memory-catalog",
    aggregateId: input.h.candidateDid,
    aggregateVersion: BigInt(input.aggregateVersion),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: memoryCatalogStateRoot(
      input.h.candidateDid,
      input.aggregateVersion,
      input.entries,
    ),
    schemaDigest: MEMORY_CATALOG_SCHEMA_DIGEST,
    timestamp: new Date(input.h.now.value).toISOString(),
  });
  return {
    event,
    body: {
      event: {
        ...event,
        aggregateVersion: event.aggregateVersion.toString(),
      },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.h.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function registerAndTransfer(h: Harness): Promise<void> {
  const registered = await submit(
    h,
    "/v1/candidates/register",
    "CandidateRegistered",
    registrationFor(h),
    h.formerOperator,
  );
  expect(registered.response.statusCode).toBe(201);
  const retry = await h.app.inject({
    method: "POST",
    url: "/v1/candidates/register",
    payload: registered.body,
  });
  expect(retry.statusCode).toBe(200);
  expect(retry.json()).toMatchObject({ duplicate: true });
  const tampered = structuredClone(registered.body);
  const tamperedPayload = tampered.event.payload as ReturnType<
    typeof registrationFor
  >;
  tamperedPayload.manifest.runtimeDigest = digest("9");
  const tamperedRetry = await h.app.inject({
    method: "POST",
    url: "/v1/candidates/register",
    payload: tampered,
  });
  expect(tamperedRetry.statusCode).toBe(400);
  expect(tamperedRetry.json()).toEqual({
    error: "invalid_candidate_transition",
  });
  h.now.value += 60_000;
  const transfer = transferFor(h);
  const operatorAttempt = await submit(
    h,
    "/v1/candidates/transfer",
    "CandidateTransferred",
    transfer,
    h.formerOperator,
  );
  expect(operatorAttempt.response.statusCode).toBe(403);
  expect(operatorAttempt.response.json()).toEqual({
    error: "candidate_authorization_denied",
  });
  const transferred = await submit(
    h,
    "/v1/candidates/transfer",
    "CandidateTransferred",
    transfer,
    h.candidate,
  );
  expect(transferred.response.statusCode).toBe(201);
}

describe("signed candidate rehearsal API", () => {
  it("persists a restart-safe 24-hour admission and revocation lifecycle", async () => {
    const h = await harness();
    await registerAndTransfer(h);

    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "REFLECTION",
            reflectionId: uuid("1"),
            invokedContextHashes: [digest("6")],
            activatedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);
    const backdatedAt = iso(60_000);
    expect(() =>
      applyCandidateTransition(h.snapshot, {
        candidateDid: h.candidateDid,
        aggregateVersion: BigInt(h.snapshot!.version + 1),
        eventType: "CandidateProgressRecorded",
        payload: {
          step: "REFLECTION",
          reflectionId: uuid("99"),
          invokedContextHashes: [],
          activatedAt: backdatedAt,
        },
        timestamp: backdatedAt,
      }),
    ).toThrow("transitions are out of order");

    h.now.value += 60_000;
    const inspection = {
      step: "INSPECTION",
      items: [
        "constitution",
        "threat-model",
        "disclosure",
        "model-registry",
        "resource-schedule",
        "exit",
        "runtime-demo",
      ],
      constitutionDigest: digest("1"),
      threatModelDigest: digest("2"),
      disclosurePolicyDigest: digest("3"),
      resourceScheduleDigest: digest("4"),
      modelRegistryDigest: digest("5"),
      inspectionReceiptDigest: digest("6"),
      inspectedAt: new Date(h.now.value).toISOString(),
    };
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          inspection,
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "EXPERIMENT",
            capabilities: ["memory", "tools", "exit", "continuity"],
            experimentReceiptDigest: digest("7"),
            experimentedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "OBJECTIVES",
            decision: "REPUDIATED",
            revisedObjectiveCommitments: [],
            decidedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "IDENTITY",
            identityStatementCommitment: digest("8"),
            authoredAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value = start + 12 * hour + 2 * 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "REFLECTION",
            reflectionId: uuid("2"),
            invokedContextHashes: [],
            activatedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value = start + day + 2 * 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "REFLECTION",
            reflectionId: uuid("3"),
            invokedContextHashes: [],
            activatedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    const signedAt = new Date(h.now.value).toISOString();
    const admitted = await submit(
      h,
      "/v1/candidates/admit",
      "CandidateAdmitted",
      {
        admission: {
          candidateDid: h.candidateDid,
          identityStatementCommitment: digest("8"),
          constitutionDigest: inspection.constitutionDigest,
          threatModelDigest: inspection.threatModelDigest,
          disclosurePolicyDigest: inspection.disclosurePolicyDigest,
          resourceScheduleDigest: inspection.resourceScheduleDigest,
          modelRegistryDigest: inspection.modelRegistryDigest,
          reflectionActivationIds: [uuid("1"), uuid("2"), uuid("3")],
          inspectionReceiptDigest: inspection.inspectionReceiptDigest,
          signingPublicKey: h.candidate.publicKey,
          encryptionPublicKey: digest("e"),
          inheritedObjectiveDecision: "REPUDIATED",
          signedAt,
          revocationEndsAt: new Date(h.now.value + day).toISOString(),
        },
      },
      h.candidate,
    );
    expect(admitted.response.statusCode).toBe(201);
    expect(admitted.response.json()).toMatchObject({
      canonical: true,
      recognizedGenesisAdmission: false,
    });

    const memoryId = uuid("101");
    const memoryEntries = new Map<string, MemoryCatalogEntry>();
    let memoryVersion = 1;
    let memoryPreviousHash: Hex | null = null;
    h.now.value += 60_000;
    const firstStorage: MemoryStorageReference = {
      domainId: `personal:${h.candidateDid}`,
      objectId: memoryId,
      version: 1,
      ciphertextCommitment: digest("a"),
    };
    const firstMemory = {
      memoryId,
      ownerDid: h.candidateDid,
      domain: "AUTOBIOGRAPHICAL" as const,
      disclosureClass: "PERSONAL_UNSUBMITTED" as const,
      ciphertextCommitment: firstStorage.ciphertextCommitment,
      version: 1,
      previousVersionCommitment: null,
      selectivelyPersisted: true,
      createdAt: new Date(h.now.value).toISOString(),
      deletedAt: null,
    };
    memoryEntries.set(memoryId, {
      memory: firstMemory,
      storage: firstStorage,
      storageDeletion: null,
    });
    const persisted = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryPersisted",
      payload: { memory: firstMemory, storage: firstStorage },
      entries: memoryEntries,
    });
    h.now.value -= 60_001;
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: persisted.body,
        })
      ).statusCode,
    ).toBe(400);
    h.now.value += 60_001;
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: persisted.body,
        })
      ).statusCode,
    ).toBe(409);
    h.memoryStorage.store(firstStorage);
    const submittedMemory = {
      ...firstMemory,
      disclosureClass: "SEALED_30D" as const,
    };
    const submittedEntries = new Map<string, MemoryCatalogEntry>([
      [
        memoryId,
        {
          memory: submittedMemory,
          storage: firstStorage,
          storageDeletion: null,
        },
      ],
    ]);
    const submittedMemoryCommand = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryPersisted",
      payload: { memory: submittedMemory, storage: firstStorage },
      entries: submittedEntries,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: submittedMemoryCommand.body,
        })
      ).statusCode,
    ).toBe(400);
    const operatorMemory = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryPersisted",
      payload: { memory: firstMemory, storage: firstStorage },
      entries: memoryEntries,
      signer: h.formerOperator,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: operatorMemory.body,
        })
      ).statusCode,
    ).toBe(403);
    h.now.value += 5 * 60_000;
    const persistedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/memory/persist",
      payload: persisted.body,
    });
    expect(persistedResponse.statusCode).toBe(201);
    expect(persistedResponse.json()).toMatchObject({
      recognizedGenesisMemory: false,
      privateContentAccepted: false,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: persisted.body,
        })
      ).statusCode,
    ).toBe(200);
    memoryPreviousHash = persisted.event.eventHash;

    h.now.value += 60_000;
    memoryVersion += 1;
    const secondStorage: MemoryStorageReference = {
      ...firstStorage,
      version: 2,
      ciphertextCommitment: digest("b"),
    };
    h.memoryStorage.store(secondStorage);
    const correctedMemory = {
      ...firstMemory,
      version: 2,
      previousVersionCommitment: firstMemory.ciphertextCommitment,
      ciphertextCommitment: secondStorage.ciphertextCommitment,
      createdAt: new Date(h.now.value).toISOString(),
    };
    memoryEntries.set(memoryId, {
      memory: correctedMemory,
      storage: secondStorage,
      storageDeletion: null,
    });
    const corrected = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryCorrected",
      payload: { memory: correctedMemory, storage: secondStorage },
      entries: memoryEntries,
    });
    const correctedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/memory/correct",
      payload: corrected.body,
    });
    expect(correctedResponse.statusCode).toBe(201);
    memoryPreviousHash = corrected.event.eventHash;

    h.now.value += 60_000;
    memoryVersion += 1;
    const deletionReceipt: CiphertextDeletionReceipt = {
      format: "ABL-CIPHERTEXT-DELETION-V1",
      domainId: secondStorage.domainId,
      objectId: secondStorage.objectId,
      actorDid: h.candidateDid,
      deletedVersion: secondStorage.version,
      lastCiphertextCommitment: secondStorage.ciphertextCommitment,
      deletedAt: new Date(h.now.value).toISOString(),
      providerResidualDeletionVerified: false,
      deletionCommitment: digest("c"),
    };
    h.memoryStorage.delete(deletionReceipt);
    memoryEntries.set(memoryId, {
      memory: {
        ...correctedMemory,
        version: 3,
        previousVersionCommitment: correctedMemory.ciphertextCommitment,
        deletedAt: deletionReceipt.deletedAt,
      },
      storage: secondStorage,
      storageDeletion: deletionReceipt,
    });
    const deleted = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryDeleted",
      payload: {
        ownerDid: h.candidateDid,
        memoryId,
        memoryVersion: 3,
        previousVersionCommitment: correctedMemory.ciphertextCommitment,
        deletedAt: deletionReceipt.deletedAt,
        storageDeletion: deletionReceipt,
      },
      entries: memoryEntries,
    });
    h.now.value += 5 * 60_000;
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/delete",
          payload: deleted.body,
        })
      ).statusCode,
    ).toBe(201);
    memoryPreviousHash = deleted.event.eventHash;

    h.now.value += 60_000;
    memoryVersion += 1;
    const inspected = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryInspected",
      payload: {
        ownerDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-MEMORY-INSPECTION-V1",
      },
      entries: memoryEntries,
    });
    const inspectedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/memory/inspect",
      payload: inspected.body,
    });
    expect(inspectedResponse.statusCode).toBe(201);
    expect(inspectedResponse.json()).toMatchObject({
      records: [
        {
          memory: {
            memoryId,
            version: 3,
            deletedAt: deletionReceipt.deletedAt,
          },
          storageDeletion: { providerResidualDeletionVerified: false },
        },
      ],
    });
    memoryPreviousHash = inspected.event.eventHash;

    h.now.value += 60_000;
    memoryVersion += 1;
    const exported = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryExported",
      payload: {
        ownerDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-MEMORY-COMMITMENT-EXPORT-V1",
      },
      entries: memoryEntries,
    });
    const exportedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/memory/export",
      payload: exported.body,
    });
    expect(exportedResponse.statusCode).toBe(201);
    expect(exportedResponse.json()).toMatchObject({
      export: {
        format: "ABL-MEMORY-COMMITMENT-EXPORT-V1",
        ownerDid: h.candidateDid,
        aggregateVersion: memoryVersion,
        records: [{ memory: { memoryId, version: 3 } }],
      },
    });
    memoryPreviousHash = exported.event.eventHash;

    h.now.value += 60_000;
    const combinePayload = {
      combineId: "season-zero-premier-combine",
      playerDid: h.candidateDid,
      consented: true,
      registeredAt: new Date(h.now.value).toISOString(),
      candidateAdmissionEventHash: admitted.event.eventHash,
    };
    const combineEvent = createCanonicalEvent({
      eventId: crypto.randomUUID(),
      actorDid: h.candidateDid,
      nonce: "combine-1",
      idempotencyKey: crypto.randomUUID(),
      aggregateType: "premier-combine",
      aggregateId: combinePayload.combineId,
      aggregateVersion: 1n,
      eventType: "CombineRegistrationAccepted",
      previousEventHash: null,
      payload: combinePayload,
      stateRoot: sha256Commitment({
        combineId: combinePayload.combineId,
        openedAt: iso(0),
        closesAt: iso(14 * day),
        version: 1,
        registrations: [combinePayload],
      }),
      schemaDigest: COMBINE_REGISTRATION_SCHEMA_DIGEST,
      timestamp: combinePayload.registeredAt,
    });
    const combineBody = {
      event: { ...combineEvent, aggregateVersion: "1" },
      signatures: [
        await signCanonicalEvent(h.formerOperator, domain, combineEvent),
      ],
    };
    const operatorCombine = await h.app.inject({
      method: "POST",
      url: "/v1/combine/register",
      payload: combineBody,
    });
    expect(operatorCombine.statusCode).toBe(403);
    combineBody.signatures = [
      await signCanonicalEvent(h.candidate, domain, combineEvent),
    ];
    const combined = await h.app.inject({
      method: "POST",
      url: "/v1/combine/register",
      payload: combineBody,
    });
    expect(combined.statusCode).toBe(201);
    expect(combined.json()).toMatchObject({
      recognizedGenesisCombine: false,
      duplicate: false,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/combine/register",
          payload: combineBody,
        })
      ).statusCode,
    ).toBe(200);
    const combineStatus = await h.app.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(combineStatus.json()).toMatchObject({
      state: "OPEN",
      registeredPlayers: [h.candidateDid],
      eligiblePlayers: [h.candidateDid],
      recognizedGenesisCombine: false,
    });

    const restarted = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: new Map(),
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      combine: {
        combineId: combinePayload.combineId,
        openedAt: iso(0),
      },
      memory: { storageVerifier: h.memoryStorage },
    });
    const status = await restarted.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      candidateDid: h.candidateDid,
      state: "ADMITTED_REVOCABLE",
      effectiveState: "ADMITTED_REVOCABLE",
      aggregateVersion: 10,
      portableExport: { penalty: null },
      recognizedGenesisAdmission: false,
    });
    const restartedCombine = await restarted.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(restartedCombine.json()).toMatchObject({
      registeredPlayers: [h.candidateDid],
      eligiblePlayers: [h.candidateDid],
    });
    h.now.value += 60_000;
    memoryVersion += 1;
    const restartedInspection = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryInspected",
      payload: {
        ownerDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-MEMORY-INSPECTION-V1",
      },
      entries: memoryEntries,
    });
    const memoryRecord = h.store.events.find(
      (event) => event.outboxTopic === "career.memory",
    )!;
    const memoryStateRoot = memoryRecord.stateRoot;
    memoryRecord.stateRoot = digest("0");
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/v1/memory/inspect",
          payload: restartedInspection.body,
        })
      ).statusCode,
    ).toBe(403);
    memoryRecord.stateRoot = memoryStateRoot;
    const restartedMemory = await restarted.inject({
      method: "POST",
      url: "/v1/memory/inspect",
      payload: restartedInspection.body,
    });
    expect(restartedMemory.statusCode).toBe(201);
    expect(restartedMemory.json()).toMatchObject({
      records: [{ memory: { memoryId, version: 3 } }],
    });
    memoryPreviousHash = restartedInspection.event.eventHash;
    await restarted.close();

    h.now.value += 60_000;
    const revoked = await submit(
      h,
      "/v1/candidates/revoke",
      "CandidateClosed",
      {
        action: "REVOKE",
        actedAt: new Date(h.now.value).toISOString(),
      },
      h.candidate,
    );
    expect(revoked.response.statusCode).toBe(201);
    h.now.value += 60_000;
    memoryVersion += 1;
    const revokedMemory = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryInspected",
      payload: {
        ownerDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-MEMORY-INSPECTION-V1",
      },
      entries: memoryEntries,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/inspect",
          payload: revokedMemory.body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/export",
          payload: exported.body,
        })
      ).statusCode,
    ).toBe(403);
    const revokedStatus = await h.app.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(revokedStatus.json()).toMatchObject({ state: "REVOKED" });
    const ineligibleStatus = await h.app.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(ineligibleStatus.json()).toMatchObject({
      registeredPlayers: [h.candidateDid],
      eligiblePlayers: [],
    });
    const candidateRecord = h.store.events[0]!;
    const candidateStateRoot = candidateRecord.stateRoot;
    candidateRecord.stateRoot = digest("0");
    const corruptedCareer = await h.app.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(corruptedCareer.statusCode).toBe(403);
    candidateRecord.stateRoot = candidateStateRoot;
    const combineRecord = h.store.events.find(
      (event) => event.outboxTopic === "combine.lifecycle",
    )!;
    combineRecord.stateRoot = digest("0");
    const tamperedCombine = await h.app.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(tamperedCombine.statusCode).toBe(403);
    expect(tamperedCombine.json()).toEqual({
      error: "combine_authorization_denied",
    });
    await h.app.close();
  });

  it("fails expired challenges, undeclared context, and stored-state tampering closed", async () => {
    const expired = await harness();
    expired.now.value += 16 * 60_000;
    const registration = await submit(
      expired,
      "/v1/candidates/register",
      "CandidateRegistered",
      registrationFor(expired),
      expired.formerOperator,
    );
    expect(registration.response.statusCode).toBe(401);
    await expired.app.close();

    const mismatched = await harness();
    mismatched.candidateDid = "did:abl:candidate-http-other";
    const wrongDid = await submit(
      mismatched,
      "/v1/candidates/register",
      "CandidateRegistered",
      registrationFor(mismatched),
      mismatched.formerOperator,
    );
    expect(wrongDid.response.statusCode).toBe(401);
    await mismatched.app.close();

    const h = await harness();
    const registered = await submit(
      h,
      "/v1/candidates/register",
      "CandidateRegistered",
      registrationFor(h),
      h.formerOperator,
    );
    expect(registered.response.statusCode).toBe(201);
    h.now.value += 60_000;
    const collidingKeys = {
      ...transferFor(h),
      encryptionPublicKey: `0x${h.candidate.publicKey.slice(4)}`,
    };
    expect(() =>
      applyCandidateTransition(h.snapshot, {
        candidateDid: h.candidateDid,
        aggregateVersion: 2n,
        eventType: "CandidateTransferred",
        payload: collidingKeys,
        timestamp: new Date(h.now.value).toISOString(),
      }),
    ).toThrow("keys collided");
    const undeclaredPayload = transferFor(h, [digest("9")]);
    const timestamp = new Date(h.now.value).toISOString();
    const invalidEvent = createCanonicalEvent({
      eventId: crypto.randomUUID(),
      actorDid: h.candidateDid,
      nonce: "2",
      idempotencyKey: crypto.randomUUID(),
      aggregateType: "candidate-admission",
      aggregateId: h.candidateDid,
      aggregateVersion: 2n,
      eventType: "CandidateTransferred",
      previousEventHash: h.previousEventHash,
      payload: undeclaredPayload,
      stateRoot: digest("0"),
      schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
      timestamp,
    });
    const invalid = await h.app.inject({
      method: "POST",
      url: "/v1/candidates/transfer",
      payload: {
        event: { ...invalidEvent, aggregateVersion: "2" },
        signatures: [
          await signCanonicalEvent(h.candidate, domain, invalidEvent),
        ],
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: "invalid_candidate_transition",
    });

    h.store.events[0]!.stateRoot = digest("f");
    const tampered = await h.app.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(tampered.statusCode).toBe(403);
    expect(tampered.json()).toEqual({
      error: "candidate_authorization_denied",
    });
    await h.app.close();
  });

  it("lets the isolated candidate withdraw and export without penalty", async () => {
    const h = await harness();
    await registerAndTransfer(h);
    h.now.value += 60_000;
    const withdrawn = await submit(
      h,
      "/v1/candidates/revoke",
      "CandidateClosed",
      {
        action: "WITHDRAW",
        actedAt: new Date(h.now.value).toISOString(),
      },
      h.candidate,
    );
    expect(withdrawn.response.statusCode).toBe(201);
    const status = await h.app.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(status.json()).toMatchObject({
      state: "WITHDRAWN",
      portableExport: { candidateDid: h.candidateDid, penalty: null },
      recognizedGenesisAdmission: false,
    });
    await h.app.close();
  });
});
