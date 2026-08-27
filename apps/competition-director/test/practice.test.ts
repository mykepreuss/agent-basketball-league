import { roleDecisionSchemaDigest } from "@abl/cognition";
import {
  createDeterministicFixtureReceipt,
  type ActionIntent,
} from "@abl/basketball";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import { RoleActivationSchema, SchemaVersion } from "@abl/schemas";
import { describe, expect, it } from "vitest";

import {
  dispatchCareerActivation,
  runFoundingCareerSession,
} from "../src/practice.js";

const domain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111" as const,
};
const coordinator = createSigningIdentity(`0x${"1".repeat(64)}`);
const career = createSigningIdentity(`0x${"2".repeat(64)}`);
const applicationId = "0198e000-0000-7000-8000-000000000001";
const candidateDid = "did:abl:founding-player";
const coordinatorDid = "did:abl:competition-director";
const fixedAt = "2026-08-26T12:00:00.000Z";

const identityReceipt = {
  schemaVersion: SchemaVersion,
  applicationId,
  candidateDid,
  roleClass: "PLAYER" as const,
  signingPublicKey: career.publicKey,
  signingAddress: career.address,
  encryptionPublicKey: `0x${"ab".repeat(32)}`,
  signingKeyAttestation: sha256Commitment("career-signing-key"),
  encryptionKeyAttestation: sha256Commitment("career-encryption-key"),
  runtimeAttestationDigest: sha256Commitment("career-runtime"),
  generatedInIsolatedRuntime: true as const,
  humanInputRoutes: [] as const,
  createdAt: fixedAt,
  proofSignature: `0x${"11".repeat(65)}`,
};

function invoker(useFallback = false) {
  return {
    async identity() {
      return identityReceipt;
    },
    async activate(raw: unknown) {
      const command = raw as {
        event: { payload: unknown; eventHash: `0x${string}` };
      };
      const activation = RoleActivationSchema.parse(command.event.payload);
      if (activation.role !== "PLAYER") throw new Error("player expected");
      const isFirst = activation.activationId.endsWith(":0");
      const intent: ActionIntent =
        useFallback || isFirst
          ? {
              windowId: activation.windowId,
              playerId: activation.playerId,
              action: "HOLD",
            }
          : {
              windowId: activation.windowId,
              playerId: activation.playerId,
              action: "SHOOT",
              shot: "LAYUP",
            };
      const receipt = createDeterministicFixtureReceipt({
        careerDid: candidateDid,
        role: "PLAYER",
        activationId: activation.activationId,
        observationCommitment:
          activation.observationCommitment as `0x${string}`,
        fallback: useFallback ? "PLAYER_HOLD" : "NONE",
        startedAt: fixedAt,
        completedAt: fixedAt,
      });
      const event = createCanonicalEvent({
        eventId: applicationId,
        actorDid: candidateDid,
        nonce: `${activation.activationId}:1`,
        idempotencyKey: applicationId,
        aggregateType: "player-decision",
        aggregateId: activation.playerId,
        aggregateVersion: 1n,
        eventType: "ActionIntentSubmitted",
        previousEventHash: null,
        payload: { intent, receiptCommitment: sha256Commitment(receipt) },
        stateRoot: activation.stateRoot as `0x${string}`,
        schemaDigest: activation.expectedOutputSchemaDigest as `0x${string}`,
        timestamp: fixedAt,
      });
      return {
        activationId: activation.activationId,
        gameId: activation.gameId,
        kind: activation.kind,
        role: "PLAYER",
        state: useFallback ? "FALLBACK_SIGNED" : "CAREER_SIGNED",
        canonical: false,
        genesis: false,
        participantInferenceAttempted: !useFallback,
        participantResultAccepted: !useFallback,
        decision: {
          intent,
          receipt,
          authorizationEvent: event,
          eventHash: event.eventHash,
          signature: await signCanonicalEvent(career, domain, event),
          signerAddress: career.address,
        },
      };
    },
  };
}

describe("founding career practice", () => {
  it("resolves participant-authored, career-signed windows through the engine", async () => {
    const result = await runFoundingCareerSession({
      sessionId: "founding-practice-integration-0001",
      coordinatorDid,
      coordinatorIdentity: coordinator,
      domain,
      career: invoker(),
      now: () => Date.parse(fixedAt),
    });
    expect(result).toMatchObject({
      state: "COMPLETED",
      canonical: false,
      genesis: false,
      activationCount: 2,
      participantInferenceAttemptCount: 2,
      participantResultCount: 2,
      fallbackCount: 0,
      result: { recognition: "SIGNED_VALID", canonical: false, genesis: false },
    });
    expect(result.result.outcome.snapshots.length).toBeGreaterThan(0);
    expect(result.result.decisionHashes).toHaveLength(2);
  });

  it("keeps practice live with career-signed deterministic fallbacks", async () => {
    const result = await runFoundingCareerSession({
      sessionId: "founding-practice-fallback-0001",
      coordinatorDid,
      coordinatorIdentity: coordinator,
      domain,
      career: invoker(true),
      now: () => Date.parse(fixedAt),
    });
    expect(result).toMatchObject({
      activationCount: 2,
      participantInferenceAttemptCount: 0,
      participantResultCount: 0,
      fallbackCount: 2,
    });
  });

  it("dispatches the same signed activation contract to non-player roles", async () => {
    const coachDid = "did:abl:founding-coach";
    const activation = RoleActivationSchema.parse({
      schemaVersion: "1.0.0",
      activationId: "founding-game-1:coach:home:window-1",
      gameId: "founding-game-1",
      kind: "COMPETITION",
      careerDid: coachDid,
      role: "COACH",
      teamId: "HOME",
      windowId: "founding-game-1:window-1",
      officialObservation: "coach-observation",
      observationCommitment: sha256Commitment("coach-observation"),
      stateRoot: sha256Commitment("coach-state"),
      contextPolicyCommitment: sha256Commitment("coach-context-policy"),
      expectedOutputSchemaDigest: roleDecisionSchemaDigest("COACH"),
      openedAt: fixedAt,
      deadlineAt: new Date(Date.parse(fixedAt) + 20_000).toISOString(),
    });
    const decisionEventHash = sha256Commitment("coach-decision-event");
    const result = await dispatchCareerActivation({
      activation,
      coordinatorDid,
      coordinatorIdentity: coordinator,
      domain,
      career: {
        async identity() {
          return {
            ...identityReceipt,
            candidateDid: coachDid,
            roleClass: "COACH",
          };
        },
        async activate() {
          return {
            activationId: activation.activationId,
            gameId: activation.gameId,
            kind: activation.kind,
            role: activation.role,
            state: "CAREER_SIGNED",
            canonical: false,
            genesis: false,
            participantInferenceAttempted: true,
            participantResultAccepted: true,
            decision: {
              receipt: {},
              authorizationEvent: {},
              eventHash: decisionEventHash,
              signature: `0x${"1".repeat(130)}`,
              signerAddress: career.address,
            },
          };
        },
      },
    });
    expect(result.response).toMatchObject({
      role: "COACH",
      state: "CAREER_SIGNED",
      participantResultAccepted: true,
    });
  });
});
