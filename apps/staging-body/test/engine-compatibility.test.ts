import {
  REHEARSAL_RECOGNITION_DOMAIN,
  observePlayer,
  officialDecisionContextRoot,
  resolvePossession,
  roleObservationCommitment,
  runFirstPossessionRehearsal,
  stateRoot,
  type CoachDecision,
  type RefereeDecision,
  type ReplayDecision,
  type SignedPlayerDecision,
} from "@abl/basketball";
import {
  CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE,
  CAREER_ROLE_ACTIVATION_EVENT_TYPE,
  CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST,
  createRunnerEncryptionKeyPair,
  roleDecisionSchemaDigest,
} from "@abl/cognition";
import {
  createCanonicalEvent,
  createSigningIdentity,
  recoverCanonicalEventSigner,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { RoleActivation } from "@abl/schemas";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  executeDistributedCareerActivation,
  type CareerActivationResult,
  type CareerContextProvider,
  type CareerRelayClient,
} from "../src/cognition-runtime.js";

const coordinatorDid = "did:abl:competition-director";
const coordinator = fixedIdentity(999);
const openedAt = "2026-08-26T12:00:00.000Z";
const now = Date.parse("2026-08-26T12:00:01.000Z");

function fixedIdentity(value: number): SigningIdentity {
  return createSigningIdentity(
    `0x${value.toString(16).padStart(64, "0")}` as Hex,
  );
}

function deterministicUuid(subject: string): string {
  const hash = sha256Commitment(subject).slice(2);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const relay: CareerRelayClient = {
  async enqueue() {
    throw new Error("A fallback activation must not enqueue inference");
  },
  async result() {
    return null;
  },
  async transition() {},
};

function contextProvider(role: RoleActivation["role"]): CareerContextProvider {
  return {
    async assemble(activation) {
      const policyBase = {
        schemaVersion: "1.0.0" as const,
        policyId: deterministicUuid(`${activation.activationId}:policy`),
        careerDid: activation.careerDid,
        minimumNecessary: true as const,
        allowedDisclosureClasses: ["COMPETITIVE_SEALED"] as const,
        allowedMemoryDomains: ["STRATEGIC"] as const,
        allowPrivateFilm: true,
        allowPracticeLessons: true,
      };
      return {
        policy: {
          ...policyBase,
          allowedDisclosureClasses: [...policyBase.allowedDisclosureClasses],
          allowedMemoryDomains: [...policyBase.allowedMemoryDomains],
          policyCommitment: sha256Commitment(policyBase),
        },
        materials: [],
        officialContext: { activationId: activation.activationId },
        fallbackDecision:
          role === "PLAYER"
            ? { action: "HOLD" }
            : role === "COACH"
              ? { instruction: "RETAIN_CURRENT_TACTIC_AND_LINEUP" }
              : role === "REFEREE"
                ? { call: "NO_CALL" }
                : { ruling: "NO_REVIEW" },
        kernelHash: sha256Commitment("career-kernel-v2"),
        toolHash: sha256Commitment("career-tools-v2"),
      };
    },
  };
}

async function careerDecision(input: {
  activation: RoleActivation;
  identity: SigningIdentity;
}): Promise<CareerActivationResult["decision"]> {
  const event = createCanonicalEvent({
    eventId: deterministicUuid(`${input.activation.activationId}:event`),
    actorDid: coordinatorDid,
    nonce: `${input.activation.activationId}:nonce`,
    idempotencyKey: deterministicUuid(
      `${input.activation.activationId}:idempotency`,
    ),
    aggregateType: CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE,
    aggregateId: input.activation.activationId,
    aggregateVersion: 1n,
    eventType: CAREER_ROLE_ACTIVATION_EVENT_TYPE,
    previousEventHash: null,
    payload: input.activation,
    stateRoot: sha256Commitment(input.activation),
    schemaDigest: CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST,
    timestamp: input.activation.openedAt,
  });
  const encryption = createRunnerEncryptionKeyPair();
  const result = await executeDistributedCareerActivation({
    command: {
      event: { ...event, aggregateVersion: "1" },
      signatures: [
        await signCanonicalEvent(
          coordinator,
          REHEARSAL_RECOGNITION_DOMAIN,
          event,
        ),
      ],
    },
    identity: {
      ...input.identity,
      candidateDid: input.activation.careerDid,
      applicationId: deterministicUuid(
        `${input.activation.careerDid}:application`,
      ),
      role: input.activation.role,
      encryptionSecretKey: encryption.secretKey,
      encryptionPublicKey:
        `0x${Buffer.from(encryption.publicKey).toString("hex")}` as const,
    },
    coordinatorDid,
    coordinatorSignerAddress: coordinator.address,
    domain: REHEARSAL_RECOGNITION_DOMAIN,
    runner: null,
    contextProvider: contextProvider(input.activation.role),
    relay,
    now: () => now,
  });
  return result.decision;
}

function materialize<T>(decision: CareerActivationResult["decision"]): T {
  return {
    ...decision,
    authorizationEvent: {
      ...decision.authorizationEvent,
      aggregateVersion: BigInt(decision.authorizationEvent.aggregateVersion),
    } as CanonicalEvent,
  } as T;
}

describe("career decision compatibility with the authoritative engine", () => {
  it("accepts career-owned fallbacks for player, coach, referee, and replay roles", async () => {
    const rehearsal = await runFirstPossessionRehearsal({ windowCount: 2 });
    const initialState = rehearsal.input.initialState;
    const initialRoot = stateRoot(initialState);
    const firstWindow = rehearsal.input.windows[0]!;
    const player = initialState.players.find(
      ({ playerId }) => playerId === "H1",
    )!;
    const playerDecision = materialize<SignedPlayerDecision>(
      await careerDecision({
        identity: fixedIdentity(1),
        activation: {
          schemaVersion: "1.0.0",
          activationId: `${initialState.possessionId}:h1:w0`,
          gameId: initialState.gameId,
          kind: "COMPETITION",
          careerDid: player.did,
          role: "PLAYER",
          playerId: player.playerId,
          teamId: player.team,
          windowId: firstWindow.windowId,
          officialObservation: observePlayer(initialState, player.playerId),
          observationCommitment: sha256Commitment(
            observePlayer(initialState, player.playerId),
          ),
          stateRoot: initialRoot,
          contextPolicyCommitment: sha256Commitment("policy"),
          expectedOutputSchemaDigest: roleDecisionSchemaDigest("PLAYER"),
          openedAt,
          deadlineAt: "2026-08-26T12:00:20.000Z",
        },
      }),
    );
    const coachDecision = materialize<CoachDecision>(
      await careerDecision({
        identity: fixedIdentity(101),
        activation: {
          schemaVersion: "1.0.0",
          activationId: `${initialState.possessionId}:coach-home:w0`,
          gameId: initialState.gameId,
          kind: "COMPETITION",
          careerDid: "did:abl:coach-home",
          role: "COACH",
          teamId: "HOME",
          windowId: firstWindow.windowId,
          officialObservation: {
            role: "COACH",
            contextRoot: initialRoot,
            scope: firstWindow.windowId,
          },
          observationCommitment: roleObservationCommitment(
            "COACH",
            initialRoot,
            firstWindow.windowId,
          ),
          stateRoot: initialRoot,
          contextPolicyCommitment: sha256Commitment("policy"),
          expectedOutputSchemaDigest: roleDecisionSchemaDigest("COACH"),
          openedAt,
          deadlineAt: "2026-08-26T12:00:20.000Z",
        },
      }),
    );
    const windows = rehearsal.input.windows.map((window, index) =>
      index === 0
        ? {
            ...window,
            decisions: window.decisions.map((decision) =>
              decision.intent.playerId === player.playerId
                ? playerDecision
                : decision,
            ),
            coaches: window.coaches.map((decision) =>
              decision.team === "HOME" ? coachDecision : decision,
            ),
          }
        : window,
    );
    const officialContext = officialDecisionContextRoot({
      initialState,
      windows,
      randomSeed: rehearsal.input.randomSeed,
    });
    const refereeDecisions = await Promise.all(
      [0, 1, 2].map(async (sequence) =>
        materialize<RefereeDecision>(
          await careerDecision({
            identity: fixedIdentity(103 + sequence),
            activation: {
              schemaVersion: "1.0.0",
              activationId: `${initialState.possessionId}:referee-${sequence + 1}`,
              gameId: initialState.gameId,
              kind: "COMPETITION",
              careerDid: `did:abl:referee-${sequence + 1}`,
              role: "REFEREE",
              possessionId: initialState.possessionId,
              officiatingSequence: sequence,
              officialObservation: {
                role: "REFEREE",
                contextRoot: officialContext,
                scope: initialState.possessionId,
              },
              observationCommitment: roleObservationCommitment(
                "REFEREE",
                officialContext,
                initialState.possessionId,
              ),
              stateRoot: officialContext,
              contextPolicyCommitment: sha256Commitment("policy"),
              expectedOutputSchemaDigest: roleDecisionSchemaDigest("REFEREE"),
              openedAt,
              deadlineAt: "2026-08-26T12:00:20.000Z",
            },
          }),
        ),
      ),
    );
    const replayDecisions = await Promise.all(
      [0, 1].map(async (sequence) =>
        materialize<ReplayDecision>(
          await careerDecision({
            identity: fixedIdentity(109 + sequence),
            activation: {
              schemaVersion: "1.0.0",
              activationId: `${initialState.possessionId}:replay-${sequence + 1}`,
              gameId: initialState.gameId,
              kind: "COMPETITION",
              careerDid: `did:abl:replay-${sequence + 1}`,
              role: "REPLAY",
              possessionId: initialState.possessionId,
              reviewSequence: sequence,
              officialObservation: {
                role: "REPLAY",
                contextRoot: officialContext,
                scope: initialState.possessionId,
              },
              observationCommitment: roleObservationCommitment(
                "REPLAY",
                officialContext,
                initialState.possessionId,
              ),
              stateRoot: officialContext,
              contextPolicyCommitment: sha256Commitment("policy"),
              expectedOutputSchemaDigest: roleDecisionSchemaDigest("REPLAY"),
              openedAt,
              deadlineAt: "2026-08-26T12:00:20.000Z",
            },
          }),
        ),
      ),
    );
    const refereeDecision = refereeDecisions[0]!;
    const replayDecision = replayDecisions[0]!;
    expect(
      await recoverCanonicalEventSigner(
        rehearsal.input.domain,
        refereeDecision.authorizationEvent,
        refereeDecision.signature,
      ),
    ).toBe(rehearsal.input.authorities.referees[0]!.signerAddress);
    expect(refereeDecision.signerAddress).toBe(
      rehearsal.input.authorities.referees[0]!.signerAddress,
    );
    expect(rehearsal.input.authorities.referees[0]!.did).toBe(
      refereeDecision.refereeDid,
    );
    expect(refereeDecision.authorizationEvent.payload.decision).toEqual({
      refereeDid: refereeDecision.refereeDid,
      possessionId: refereeDecision.possessionId,
      sequence: refereeDecision.sequence,
      call: refereeDecision.call,
      againstPlayerId: refereeDecision.againstPlayerId,
      confidenceBps: refereeDecision.confidenceBps,
    });
    expect(refereeDecision.authorizationEvent.stateRoot).toBe(officialContext);
    expect(refereeDecision.authorizationEvent).toMatchObject({
      actorDid: refereeDecision.refereeDid,
      aggregateType: "referee-decision",
      aggregateId: initialState.possessionId,
      aggregateVersion: 1n,
      eventType: "RefereeDecisionSubmitted",
    });
    expect(refereeDecision.eventHash).toBe(
      refereeDecision.authorizationEvent.eventHash,
    );
    expect(
      sha256Commitment(refereeDecision.authorizationEvent.payload.decision),
    ).toBe(
      sha256Commitment({
        refereeDid: refereeDecision.refereeDid,
        possessionId: refereeDecision.possessionId,
        sequence: refereeDecision.sequence,
        call: refereeDecision.call,
        againstPlayerId: refereeDecision.againstPlayerId,
        confidenceBps: refereeDecision.confidenceBps,
      }),
    );
    expect(refereeDecision.authorizationEvent.payload.receiptCommitment).toBe(
      sha256Commitment(refereeDecision.receipt),
    );
    expect(refereeDecision.receipt.observationCommitment).toBe(
      roleObservationCommitment(
        "REFEREE",
        officialContext,
        initialState.possessionId,
      ),
    );
    expect(refereeDecision.receipt).toMatchObject({
      careerDid: refereeDecision.refereeDid,
      role: "REFEREE",
      deadlineMs: 20_000,
      attempts: 0,
      transportRetries: 0,
      telemetryContentPolicy: "CONTENT_FREE",
    });
    const possessionInput = {
      ...rehearsal.input,
      windows,
      refereeDecisions,
      replayDecisions,
    };
    const repeatedOfficialContexts = Array.from({ length: 10 }, () =>
      officialDecisionContextRoot(possessionInput),
    );
    expect(new Set(repeatedOfficialContexts)).toEqual(
      new Set([officialContext]),
    );
    const result = await resolvePossession(possessionInput);
    expect(result.finalState.phase).toBe("FINAL");
    expect(playerDecision.receipt.fallback).toBe("PLAYER_HOLD");
    expect(coachDecision.receipt.fallback).toBe("COACH_RETAIN");
    expect(refereeDecision.receipt.fallback).toBe("REFEREE_NO_CALL");
    expect(replayDecision.receipt.fallback).toBe("REPLAY_NO_REVIEW");
  });
});
