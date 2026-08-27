import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import type { AvailabilityIncident, RunnerDelegation } from "@abl/schemas";
import { describe, expect, it } from "vitest";

import {
  CognitionRelay,
  DurableCognitionRelay,
  competitionEligibility,
  createCareerStorageAuthorization,
  createRunnerEncryptionKeyPair,
  evaluateFoundingPregame,
  openContextCapsule,
  recordCompletedWindow,
  recordMissedWindow,
  sealContextCapsule,
  signRunnerRequest,
  verifyCareerStorageAuthorization,
} from "../src/index.js";

const hash = (value: unknown) => sha256Commitment(value);
const signature = `0x${"1".repeat(130)}` as const;

describe("distributed cognition", () => {
  it("binds career storage access to a self-proved career root key", async () => {
    const career = createSigningIdentity();
    const createdAt = "2026-08-26T10:00:00.000Z";
    const message = {
      applicationId: "0198e000-0000-7000-8000-000000000401",
      candidateDid: "did:abl:career-storage",
      roleClass: "PLAYER" as const,
      signingAddress: career.address,
      signingKeyAttestation: hash("storage-signing"),
      encryptionKeyAttestation: hash("storage-encryption"),
      runtimeAttestationDigest: hash("storage-runtime"),
      createdAt,
    };
    const identity = {
      schemaVersion: "1.0.0" as const,
      ...message,
      signingPublicKey: career.publicKey,
      encryptionPublicKey: `0x${"2".repeat(64)}`,
      generatedInIsolatedRuntime: true as const,
      humanInputRoutes: [] as const,
      proofSignature: await (await import("viem/accounts"))
        .privateKeyToAccount(career.privateKey)
        .signTypedData({
          domain: {
            name: "Agent Basketball League Career Runtime",
            version: "1",
            chainId: 1,
          },
          types: {
            CandidateRuntimeIdentity: [
              { name: "applicationId", type: "string" },
              { name: "candidateDid", type: "string" },
              { name: "roleClass", type: "string" },
              { name: "signingAddress", type: "address" },
              { name: "signingKeyAttestation", type: "bytes32" },
              { name: "encryptionKeyAttestation", type: "bytes32" },
              { name: "runtimeAttestationDigest", type: "bytes32" },
              { name: "createdAt", type: "string" },
            ],
          },
          primaryType: "CandidateRuntimeIdentity",
          message,
        }),
    };
    const request = { domainId: "domain-1", objectId: "memory-1", version: 1 };
    const authorization = await createCareerStorageAuthorization({
      identity,
      privateKey: career.privateKey,
      operation: "GET",
      request,
      issuedAt: createdAt,
      nonce: "7001",
    });
    await expect(
      verifyCareerStorageAuthorization({
        authorization,
        operation: "GET",
        request,
        now: Date.parse(createdAt),
      }),
    ).resolves.toMatchObject({ operation: "GET" });
    await expect(
      verifyCareerStorageAuthorization({
        authorization,
        operation: "DELETE",
        request,
        now: Date.parse(createdAt),
      }),
    ).rejects.toThrow("binding failed");
  });
  it("seals context to one runner with activation-bound associated data", async () => {
    const runner = createRunnerEncryptionKeyPair();
    const capsule = await sealContextCapsule({
      activationId: "activation-1",
      careerDid: "did:abl:career-1",
      runnerId: "runner-1",
      recipientKeyId: "runner-1:x25519",
      recipientPublicKey: runner.publicKey,
      context: { observation: { window: 1 }, strategy: ["protect the rim"] },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(
      openContextCapsule(capsule, runner.secretKey),
    ).resolves.toEqual({
      observation: { window: 1 },
      strategy: ["protect the rim"],
    });
    await expect(
      openContextCapsule(
        { ...capsule, activationId: "activation-2" },
        runner.secretKey,
      ),
    ).rejects.toThrow("commitment mismatch");
  });

  it("consumes pairing offers once and keeps the career as delegation authority", async () => {
    const relay = new CognitionRelay();
    const signing = createSigningIdentity();
    relay.registerPairingOffer({
      schemaVersion: "1.0.0",
      offerId: "0198e000-0000-7000-8000-000000000401",
      careerDid: "did:abl:career-1",
      careerResourceName: "abl-career-1",
      careerSignerAddress: signing.address,
      relayOrigin: "https://relay.example.test",
      runnerBundleDigest: hash("runner-v1"),
      pairingToken: "pairing-token-that-is-long-enough-0001",
      issuedAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-08-26T10:15:00.000Z",
      singleUse: true,
    });
    const delegation: RunnerDelegation = {
      schemaVersion: "1.0.0",
      delegationId: "0198e000-0000-7000-8000-000000000402",
      careerDid: "did:abl:career-1",
      runnerId: "runner-1",
      delegateSigningAddress: signing.address,
      delegateEncryptionPublicKey: `0x${"2".repeat(64)}`,
      scopes: ["RUNNER_HEARTBEAT", "ACTIVATION_CLAIM", "RESULT_SUBMISSION"],
      issuedAt: "2026-08-26T10:01:00.000Z",
      expiresAt: "2026-09-25T10:01:00.000Z",
      revokedAt: null,
      careerSignature: signature,
    };
    await expect(
      relay.pair(
        {
          offerId: "0198e000-0000-7000-8000-000000000401",
          pairingToken: "pairing-token-that-is-long-enough-0001",
          runnerId: "runner-1",
          delegateSigningAddress: signing.address,
          delegateEncryptionPublicKey: `0x${"2".repeat(64)}`,
        },
        async () => delegation,
        "2026-08-26T10:01:00.000Z",
      ),
    ).resolves.toEqual(delegation);
    await expect(
      relay.pair(
        {
          offerId: "0198e000-0000-7000-8000-000000000401",
          pairingToken: "pairing-token-that-is-long-enough-0001",
          runnerId: "runner-2",
          delegateSigningAddress: signing.address,
          delegateEncryptionPublicKey: `0x${"2".repeat(64)}`,
        },
        async () => delegation,
        "2026-08-26T10:02:00.000Z",
      ),
    ).rejects.toThrow("invalid, expired, or consumed");
  });

  it("restores relay pairing state after a process restart", async () => {
    let durableState: ReturnType<CognitionRelay["exportState"]> | null = null;
    const store = {
      async load() {
        return durableState;
      },
      async save(state: ReturnType<CognitionRelay["exportState"]>) {
        durableState = structuredClone(state);
      },
    };
    const first = await DurableCognitionRelay.open(store);
    await first.registerPairingOffer({
      schemaVersion: "1.0.0",
      offerId: "0198e000-0000-7000-8000-000000000451",
      careerDid: "did:abl:career-restart",
      careerResourceName: "abl-career-restart",
      careerSignerAddress: createSigningIdentity().address,
      relayOrigin: "https://relay.example.test",
      runnerBundleDigest: hash("runner-v2"),
      pairingToken: "pairing-token-that-survives-restart-0001",
      issuedAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-08-26T10:15:00.000Z",
      singleUse: true,
    });
    const restored = await DurableCognitionRelay.open(store);
    expect(restored.snapshot()).toMatchObject({ offers: 1 });
  });

  it("renews a delegation without changing the runner keys or career", async () => {
    const relay = new CognitionRelay();
    const signing = createSigningIdentity();
    const offer = {
      schemaVersion: "1.0.0" as const,
      offerId: "0198e000-0000-7000-8000-000000000421",
      careerDid: "did:abl:career-renew",
      careerResourceName: "abl-career-renew",
      careerSignerAddress: signing.address,
      relayOrigin: "https://relay.example.test",
      runnerBundleDigest: hash("runner-renew"),
      pairingToken: "pairing-token-that-is-long-enough-renew",
      issuedAt: "2026-08-26T10:00:00.000Z",
      expiresAt: "2026-08-26T10:15:00.000Z",
      singleUse: true as const,
    };
    relay.registerPairingOffer(offer);
    const current: RunnerDelegation = {
      schemaVersion: "1.0.0",
      delegationId: "0198e000-0000-7000-8000-000000000422",
      careerDid: offer.careerDid,
      runnerId: "runner-renew",
      delegateSigningAddress: signing.address,
      delegateEncryptionPublicKey: `0x${"2".repeat(64)}`,
      scopes: ["RUNNER_HEARTBEAT", "ACTIVATION_CLAIM", "RESULT_SUBMISSION"],
      issuedAt: "2026-08-26T10:01:00.000Z",
      expiresAt: "2026-09-25T10:01:00.000Z",
      revokedAt: null,
      careerSignature: signature,
    };
    await relay.pair(
      {
        offerId: offer.offerId,
        pairingToken: offer.pairingToken,
        runnerId: current.runnerId,
        delegateSigningAddress: signing.address,
        delegateEncryptionPublicKey:
          current.delegateEncryptionPublicKey as `0x${string}`,
      },
      async () => current,
      current.issuedAt,
    );
    const timestamp = "2026-09-20T10:01:00.000Z";
    const message = {
      runnerId: current.runnerId,
      careerDid: current.careerDid,
      delegationId: current.delegationId,
      method: "POST",
      path: "/v1/runners/delegation/renew",
      bodyCommitment: hash(null),
      nonce: "renew-1",
      idempotencyKey: "0198e000-0000-7000-8000-000000000423",
      timestamp,
    };
    const renewed = await relay.renew(
      {
        message,
        signature: await signRunnerRequest(signing.privateKey, message),
      },
      async ({ careerResourceName }) => {
        expect(careerResourceName).toBe("abl-career-renew");
        return {
          ...current,
          delegationId: "0198e000-0000-7000-8000-000000000424",
          issuedAt: timestamp,
          expiresAt: "2026-10-20T10:01:00.000Z",
        };
      },
      timestamp,
    );
    expect(renewed.delegationId).not.toBe(current.delegationId);
    expect(relay.runnerStatus(current.runnerId).delegation).toEqual(renewed);
    const overlapMessage = {
      ...message,
      nonce: "renew-overlap-1",
      idempotencyKey: "0198e000-0000-7000-8000-000000000425",
    };
    await expect(
      relay.authenticate(
        {
          message: overlapMessage,
          signature: await signRunnerRequest(
            signing.privateKey,
            overlapMessage,
          ),
        },
        timestamp,
      ),
    ).resolves.toMatchObject({ delegationId: current.delegationId });
    relay.unpair(current.runnerId, "2026-09-20T10:02:00.000Z");
    expect(
      relay
        .exportState()
        .delegations.filter(
          ([, delegation]) => delegation.runnerId === current.runnerId,
        )
        .every(([, delegation]) => delegation.revokedAt !== null),
    ).toBe(true);
  });

  it("restores commitment-only activation state, including an unpaired fallback", async () => {
    let durableState: ReturnType<CognitionRelay["exportState"]> | null = null;
    const store = {
      async load() {
        return durableState;
      },
      async save(state: ReturnType<CognitionRelay["exportState"]>) {
        durableState = structuredClone(state);
      },
    };
    const first = await DurableCognitionRelay.open(store);
    const base = {
      activationId: "activation-fallback-1",
      careerDid: "did:abl:career-fallback",
      gameId: "game-1",
      role: "PLAYER" as const,
      activationCommitment: hash("activation-fallback-1"),
      contextManifestCommitment: null,
      finalDecisionCommitment: null,
      deadlineAt: "2026-08-26T10:00:20.000Z",
    };
    await first.transitionActivation({
      ...base,
      state: "RECEIVED",
      updatedAt: "2026-08-26T10:00:00.000Z",
    });
    await first.transitionActivation({
      ...base,
      state: "CONTEXT_ASSEMBLED",
      updatedAt: "2026-08-26T10:00:00.500Z",
    });
    await first.transitionActivation({
      ...base,
      state: "FALLBACK_SIGNED",
      finalDecisionCommitment: hash("fallback-decision"),
      updatedAt: "2026-08-26T10:00:01.000Z",
    });
    const restored = await DurableCognitionRelay.open(store);
    expect(restored.activationState("activation-fallback-1")).toMatchObject({
      state: "FALLBACK_SIGNED",
      finalDecisionCommitment: hash("fallback-decision"),
    });
  });

  it("binds result submission to the runner assigned to the activation", async () => {
    const relay = new CognitionRelay();
    const career = createSigningIdentity();
    const runnerA = createSigningIdentity();
    const runnerB = createSigningIdentity();
    const runnerAEncryption = createRunnerEncryptionKeyPair();
    const issuedAt = "2026-08-26T10:00:00.000Z";
    const scopes = [
      "RUNNER_HEARTBEAT",
      "ACTIVATION_CLAIM",
      "RESULT_SUBMISSION",
    ] as const;
    async function pair(
      index: number,
      runnerId: string,
      runner: ReturnType<typeof createSigningIdentity>,
    ) {
      const offerId = `0198e000-0000-7000-8000-${String(index).padStart(12, "0")}`;
      const pairingToken = `pairing-token-that-is-long-enough-${runnerId}`;
      relay.registerPairingOffer({
        schemaVersion: "1.0.0",
        offerId,
        careerDid: "did:abl:career-result-binding",
        careerResourceName: "abl-career-result-binding",
        careerSignerAddress: career.address,
        relayOrigin: "https://relay.example.test",
        runnerBundleDigest: hash("runner-v2"),
        pairingToken,
        issuedAt,
        expiresAt: "2026-08-26T10:15:00.000Z",
        singleUse: true,
      });
      const delegation: RunnerDelegation = {
        schemaVersion: "1.0.0",
        delegationId: `0198e000-0000-7000-8000-${String(index + 10).padStart(12, "0")}`,
        careerDid: "did:abl:career-result-binding",
        runnerId,
        delegateSigningAddress: runner.address,
        delegateEncryptionPublicKey: `0x${"2".repeat(64)}`,
        scopes: [...scopes],
        issuedAt,
        expiresAt: "2026-09-25T10:00:00.000Z",
        revokedAt: null,
        careerSignature: signature,
      };
      await relay.pair(
        {
          offerId,
          pairingToken,
          runnerId,
          delegateSigningAddress: runner.address,
          delegateEncryptionPublicKey: `0x${"2".repeat(64)}`,
        },
        async () => delegation,
        issuedAt,
      );
      return delegation;
    }
    const delegationA = await pair(470, "runner-a", runnerA);
    const delegationB = await pair(480, "runner-b", runnerB);
    const activation = {
      schemaVersion: "1.0.0" as const,
      activationId: "activation-result-binding",
      gameId: "founding-exhibition-1",
      kind: "COMPETITION" as const,
      careerDid: delegationA.careerDid,
      role: "PLAYER" as const,
      officialObservation: "observation",
      observationCommitment: hash("observation"),
      stateRoot: hash("state"),
      contextPolicyCommitment: hash("policy"),
      expectedOutputSchemaDigest: hash("player-output"),
      openedAt: issuedAt,
      deadlineAt: "2026-08-26T10:00:20.000Z",
      playerId: "HOME-1",
      teamId: "HOME",
      windowId: "window-1",
    };
    const capsule = await sealContextCapsule({
      activationId: activation.activationId,
      careerDid: activation.careerDid,
      runnerId: delegationA.runnerId,
      recipientKeyId: delegationA.delegationId,
      recipientPublicKey: runnerAEncryption.publicKey,
      context: { official: true },
      expiresAt: activation.deadlineAt,
    });
    const unsignedRequest = {
      schemaVersion: "1.0.0" as const,
      requestId: "0198e000-0000-7000-8000-000000000491",
      activation,
      cognitionMode: "PARTICIPANT_CONTROLLED" as const,
      contextManifestCommitment: hash("manifest"),
      capsule,
      resultRecipient: {
        keyId: "career-result-key",
        publicKey: `0x${"3".repeat(64)}` as const,
      },
      maximumAttempts: 1 as const,
      createdAt: issuedAt,
    };
    await relay.enqueue({
      ...unsignedRequest,
      requestCommitment: hash(unsignedRequest),
    });
    const completedAt = "2026-08-26T10:00:02.000Z";
    const baseResult = {
      schemaVersion: "1.0.0" as const,
      resultId: "0198e000-0000-7000-8000-000000000492",
      requestId: unsignedRequest.requestId,
      activationId: activation.activationId,
      careerDid: activation.careerDid,
      runnerId: delegationA.runnerId,
      ciphertext: "Y2lwaGVydGV4dA",
      ciphertextBytes: 10,
      ciphertextCommitment: hash("ciphertext"),
      aadCommitment: hash("aad"),
      providerProductModel: "deterministic/security-test",
      provenanceLevel: "RUNNER_VERIFIED" as const,
      ambientProductContext: "NONE" as const,
      usage: null,
      startedAt: "2026-08-26T10:00:01.000Z",
      completedAt,
    };
    await expect(
      relay.submitResult(
        { ...baseResult, delegateSignature: signature },
        delegationB,
        completedAt,
      ),
    ).rejects.toThrow("another activation");
    const bodyCommitment = hash({
      requestId: baseResult.requestId,
      activationId: baseResult.activationId,
      ciphertextCommitment: baseResult.ciphertextCommitment,
      completedAt,
    });
    await expect(
      relay.submitResult(
        {
          ...baseResult,
          delegateSignature: await signRunnerRequest(runnerA.privateKey, {
            runnerId: delegationA.runnerId,
            careerDid: delegationA.careerDid,
            delegationId: delegationA.delegationId,
            method: "RESULT_ATTESTATION",
            path: activation.activationId,
            bodyCommitment,
            nonce: "0",
            idempotencyKey: baseResult.requestId,
            timestamp: completedAt,
          }),
        },
        delegationA,
        completedAt,
      ),
    ).resolves.toBe("ACCEPTED");
  });

  it("keeps reliability separate from ability and uses the rolling eight commitments", () => {
    const incident = (
      index: number,
      excused = false,
    ): AvailabilityIncident => ({
      schemaVersion: "1.0.0",
      incidentId: `0198e000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      careerDid: "did:abl:career-1",
      gameId: `game-${index}`,
      activationId: null,
      classification: excused
        ? "SHARED_PROVIDER_INCIDENT"
        : "UNEXCUSED_NO_SHOW",
      excused,
      evidenceCommitments: [hash(index)],
      recordedAt: "2026-08-26T10:00:00.000Z",
      correctionDeadlineAt: "2026-08-27T10:00:00.000Z",
      status: "FINAL",
    });
    const status = competitionEligibility({
      careerDid: "did:abl:career-1",
      acceptedCommitmentIncidentHistory: [
        incident(1),
        incident(2, true),
        incident(3),
      ],
      computedAt: "2026-08-26T11:00:00.000Z",
    });
    expect(status).toMatchObject({
      status: "READINESS_REHABILITATION",
      basketballAbilityUnaffected: true,
      foundationalRightsUnaffected: true,
      returnRequirements: ["RUNNER_DOCTOR", "PRACTICE"],
    });
    expect(
      competitionEligibility({
        careerDid: "did:abl:career-1",
        acceptedCommitmentIncidentHistory: [
          incident(1),
          incident(2, true),
          incident(3),
        ],
        verifiedRestoration: {
          throughIncidentId: incident(3).incidentId,
          reserveOnlyGameServed: false,
          completedRequirements: ["RUNNER_DOCTOR", "PRACTICE"],
          evidenceCommitments: [hash("doctor-and-practice")],
        },
        computedAt: "2026-08-26T11:00:00.000Z",
      }),
    ).toMatchObject({ status: "ELIGIBLE", unexcusedNoShows: 2 });
    expect(
      competitionEligibility({
        careerDid: "did:abl:career-1",
        acceptedCommitmentIncidentHistory: [
          incident(1),
          incident(3),
          incident(5),
        ],
        verifiedRestoration: {
          throughIncidentId: incident(5).incidentId,
          reserveOnlyGameServed: false,
          completedRequirements: ["SIGNED_RETURN_PATH"],
          evidenceCommitments: [hash("signed-return-path")],
        },
        computedAt: "2026-08-26T11:00:00.000Z",
      }),
    ).toMatchObject({ status: "ELIGIBLE", unexcusedNoShows: 3 });
    expect(
      competitionEligibility({
        careerDid: "did:abl:career-1",
        acceptedCommitmentIncidentHistory: [incident(6)],
        verifiedRestoration: {
          throughIncidentId: incident(6).incidentId,
          reserveOnlyGameServed: true,
          completedRequirements: [],
          evidenceCommitments: [hash("reserve-game-served")],
        },
        computedAt: "2026-08-26T11:00:00.000Z",
      }),
    ).toMatchObject({ status: "ELIGIBLE", unexcusedNoShows: 1 });
    const agedOut = competitionEligibility({
      careerDid: "did:abl:career-1",
      acceptedCommitments: [
        {
          gameId: "game-old",
          evidenceCommitment: hash("old"),
          incident: incident(4),
        },
        ...Array.from({ length: 8 }, (_, index) => ({
          gameId: `game-clean-${index}`,
          evidenceCommitment: hash(`clean-${index}`),
          incident: null,
        })),
      ],
      computedAt: "2026-08-26T11:00:00.000Z",
    });
    expect(agedOut).toMatchObject({
      status: "ELIGIBLE",
      acceptedCommitmentsConsidered: 8,
      unexcusedNoShows: 0,
    });
  });

  it("falls back once and then substitutes while completed windows reset only the consecutive count", () => {
    const first = recordMissedWindow({ consecutive: 0, total: 0 });
    expect(first.action).toBe("FALLBACK");
    const second = recordMissedWindow(first.state);
    expect(second.action).toBe("FORCE_SUBSTITUTION");
    expect(recordCompletedWindow(second.state)).toEqual({
      consecutive: 0,
      total: 2,
    });
  });

  it("requires the founding active fives, coaches, officials, and replay crew", () => {
    const participants = [
      ...(["HOME", "AWAY"] as const).flatMap((team) => [
        ...Array.from({ length: 8 }, (_, index) => ({
          careerDid: `did:abl:${team.toLowerCase()}-player-${index}`,
          role: "PLAYER" as const,
          team,
          accepted: true,
          ready: true,
          active: index < 5,
          alternate: index >= 5,
        })),
        {
          careerDid: `did:abl:${team.toLowerCase()}-coach`,
          role: "COACH" as const,
          team,
          accepted: true,
          ready: true,
          active: true,
          alternate: false,
        },
      ]),
      ...Array.from({ length: 6 }, (_, index) => ({
        careerDid: `did:abl:referee-${index}`,
        role: "REFEREE" as const,
        team: null,
        accepted: true,
        ready: true,
        active: index < 3,
        alternate: index >= 3,
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        careerDid: `did:abl:replay-${index}`,
        role: "REPLAY" as const,
        team: null,
        accepted: true,
        ready: true,
        active: true,
        alternate: false,
      })),
    ];
    expect(evaluateFoundingPregame(participants)).toEqual({
      ready: true,
      reasons: [],
    });
    expect(
      evaluateFoundingPregame(
        participants.filter(
          (participant) => participant.careerDid !== "did:abl:home-coach",
        ),
      ),
    ).toMatchObject({ ready: false, reasons: ["HOME_COACH_NOT_READY"] });
  });
});
