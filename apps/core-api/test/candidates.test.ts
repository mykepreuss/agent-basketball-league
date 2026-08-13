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
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { FastifyInstance } from "fastify";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import { createLiveCoreApi } from "../src/server.js";

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
}

async function harness(): Promise<Harness> {
  const store = new InMemoryCanonicalStore();
  const now = { value: start };
  const formerOperator = createSigningIdentity(digest("1"));
  const candidate = createSigningIdentity(digest("2"));
  const candidateDid = "did:abl:candidate-http-1";
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
    const revokedStatus = await h.app.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(revokedStatus.json()).toMatchObject({ state: "REVOKED" });
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
