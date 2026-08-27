import {
  FinalizedGamePayloadSchema,
  FullGameEngine,
  REHEARSAL_RECOGNITION_DOMAIN,
  createDeterministicFixtureReceipt,
  materializePossessionInput,
  resolvePossession,
  replayRoleCompleteFoundingExhibition,
} from "@abl/basketball";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import { BASKETBALL_POSITIONS, type RoleActivation } from "@abl/schemas";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  beginGame,
  createScheduledGame,
  FoundingGameRuntimeSchema,
  lockLineup,
  tipOffGame,
  type CompetitionParticipant,
} from "../src/lifecycle.js";
import {
  FoundingLiveGameExecutor,
  createInitialRuntime,
} from "../src/live-game.js";

const gameId = "0198e000-0000-7000-8000-000000000801";
const createdAt = "2026-08-26T12:00:00.000Z";
const tipoffAt = "2026-08-27T12:00:00.000Z";

function deterministicUuid(subject: string): string {
  const hash = sha256Commitment(subject).slice(2);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function roster() {
  const identities = new Map<string, SigningIdentity>();
  const participants: CompetitionParticipant[] = [];
  let key = 1;
  const add = (
    careerDid: string,
    role: CompetitionParticipant["role"],
    team: CompetitionParticipant["team"],
    active: boolean,
    alternate: boolean,
  ) => {
    const identity = createSigningIdentity(
      `0x${key.toString(16).padStart(64, "0")}` as Hex,
    );
    key += 1;
    identities.set(careerDid, identity);
    const playerIndex =
      role === "PLAYER" ? Number(careerDid.split("-").at(-1)) : null;
    const primaryPosition =
      playerIndex === null
        ? null
        : BASKETBALL_POSITIONS[playerIndex % BASKETBALL_POSITIONS.length]!;
    const eligiblePositions =
      playerIndex === null
        ? null
        : playerIndex < 5
          ? [primaryPosition!]
          : [...BASKETBALL_POSITIONS];
    participants.push({
      careerDid,
      role,
      team,
      signerAddress: identity.address,
      accepted: true,
      ready: true,
      active,
      alternate,
      positionProfile:
        primaryPosition === null || eligiblePositions === null
          ? null
          : {
              primaryPosition,
              eligiblePositions,
              profileCommitment: sha256Commitment({
                primaryPosition,
                eligiblePositions,
              }),
            },
      currentPosition:
        playerIndex !== null && playerIndex < 5
          ? BASKETBALL_POSITIONS[playerIndex]!
          : null,
      eligibilityStatus: "ELIGIBLE",
      missState: { consecutive: 0, total: 0 },
      participation: null,
      readinessLease: null,
    });
  };
  for (const team of ["HOME", "AWAY"] as const) {
    for (let index = 0; index < 8; index += 1)
      add(
        `did:abl:${team.toLowerCase()}-player-${index}`,
        "PLAYER",
        team,
        index < 5,
        index >= 5,
      );
    add(`did:abl:${team.toLowerCase()}-coach`, "COACH", team, true, false);
  }
  for (let index = 0; index < 6; index += 1)
    add(`did:abl:referee-${index}`, "REFEREE", null, index < 3, index >= 3);
  for (let index = 0; index < 2; index += 1)
    add(`did:abl:replay-${index}`, "REPLAY", null, true, false);
  return { participants, identities };
}

function inProgressGame(participants: CompetitionParticipant[], benchSize = 3) {
  const careerResources = Object.fromEntries(
    participants.map(({ careerDid }, index) => [
      careerDid,
      `abl-career-${String(index).padStart(2, "0")}`,
    ]),
  );
  let game = createScheduledGame({
    gameId,
    scheduledTipoffAt: tipoffAt,
    participants,
    careerResources,
    now: createdAt,
  });
  for (const team of ["HOME", "AWAY"] as const) {
    const prefix = `did:abl:${team.toLowerCase()}-player-`;
    game = lockLineup({
      game,
      lineup: {
        gameId,
        coachDid: `did:abl:${team.toLowerCase()}-coach`,
        team,
        schemaVersion: 2,
        assignments: BASKETBALL_POSITIONS.map((position, index) => ({
          position,
          careerDid: `${prefix}${index}`,
        })),
        orderedBench: Array.from(
          { length: benchSize },
          (_, index) => `${prefix}${index + 5}`,
        ),
        submittedAt: "2026-08-27T11:45:00.000Z",
        signature: `0x${"1".repeat(130)}`,
      },
    });
  }
  game = beginGame(game, "2026-08-27T11:55:00.000Z");
  return tipOffGame(game, tipoffAt);
}

function normalizedDecision(activation: RoleActivation) {
  if (activation.role === "PLAYER")
    return {
      windowId: activation.windowId,
      playerId: activation.playerId,
      action: "HOLD" as const,
    };
  if (activation.role === "COACH")
    return {
      coachDid: activation.careerDid,
      team: activation.teamId as "HOME" | "AWAY",
      windowId: activation.windowId,
      instruction: "RETAIN_CURRENT_TACTIC_AND_LINEUP" as const,
      targetPlayerIds: [],
    };
  if (activation.role === "REFEREE")
    return {
      refereeDid: activation.careerDid,
      possessionId: activation.possessionId,
      sequence: activation.officiatingSequence,
      call: "NO_CALL" as const,
      againstPlayerId: null,
      confidenceBps: 0,
    };
  return {
    replayDid: activation.careerDid,
    possessionId: activation.possessionId,
    reviewable: false,
    ruling: "NO_REVIEW" as const,
    evidenceCommitment: activation.stateRoot,
  };
}

describe("live distributed game executor", () => {
  it("retains the complete eight-player roster when the coach names a shorter bench", () => {
    const { participants } = roster();
    const runtime = createInitialRuntime(inProgressGame(participants, 0));
    expect(runtime.input.roster.home).toHaveLength(8);
    expect(runtime.input.roster.away).toHaveLength(8);
    expect(runtime.input.active.home).toHaveLength(5);
    expect(runtime.input.active.away).toHaveLength(5);
  });

  it("runs all four roles sequentially and submits one replayed possession", async () => {
    const { participants, identities } = roster();
    const game = inProgressGame(participants);
    let submitted = 0;
    let finalizedPayload: unknown;
    const dispatchedActivations: RoleActivation[] = [];
    const executor = new FoundingLiveGameExecutor({
      domain: REHEARSAL_RECOGNITION_DOMAIN,
      dispatcher: {
        async dispatch({ activation }) {
          dispatchedActivations.push(structuredClone(activation));
          const identity = identities.get(activation.careerDid)!;
          const decision = normalizedDecision(activation);
          const receipt = createDeterministicFixtureReceipt({
            careerDid: activation.careerDid,
            role: activation.role,
            activationId: activation.activationId,
            observationCommitment:
              activation.observationCommitment as `0x${string}`,
            contextManifestCommitment: sha256Commitment("test-context"),
            startedAt: activation.openedAt,
            completedAt: activation.openedAt,
          });
          const event = createCanonicalEvent({
            eventId: deterministicUuid(`${activation.activationId}:decision`),
            actorDid: activation.careerDid,
            nonce: "1",
            idempotencyKey: deterministicUuid(
              `${activation.activationId}:idempotency`,
            ),
            aggregateType: `${activation.role.toLowerCase()}-decision`,
            aggregateId:
              activation.role === "PLAYER"
                ? activation.playerId
                : activation.role === "COACH"
                  ? activation.windowId
                  : activation.possessionId,
            aggregateVersion: 1n,
            eventType:
              activation.role === "PLAYER"
                ? "ActionIntentSubmitted"
                : activation.role === "COACH"
                  ? "CoachInstructionSubmitted"
                  : activation.role === "REFEREE"
                    ? "RefereeDecisionSubmitted"
                    : "ReplayDecisionSubmitted",
            previousEventHash: null,
            payload:
              activation.role === "PLAYER"
                ? {
                    intent: decision,
                    receiptCommitment: sha256Commitment(receipt),
                  }
                : {
                    decision,
                    receiptCommitment: sha256Commitment(receipt),
                  },
            stateRoot: activation.stateRoot as `0x${string}`,
            schemaDigest:
              activation.expectedOutputSchemaDigest as `0x${string}`,
            timestamp: activation.openedAt,
          });
          return {
            participantResultAccepted: true,
            decision: {
              ...(activation.role === "PLAYER"
                ? { intent: decision }
                : decision),
              receipt,
              authorizationEvent: {
                ...event,
                aggregateVersion: "1",
              },
              eventHash: event.eventHash,
              signature: await signCanonicalEvent(
                identity,
                REHEARSAL_RECOGNITION_DOMAIN,
                event,
              ),
              signerAddress: identity.address,
            },
          };
        },
      },
      submitter: {
        async submit({ possessionInput }) {
          submitted += 1;
          const replay = await resolvePossession(
            materializePossessionInput(possessionInput),
          );
          return {
            canonicalEventHash: sha256Commitment(possessionInput),
            finalStateRoot: replay.finalStateRoot,
            eventMerkleRoot: replay.eventMerkleRoot,
          };
        },
        async finalize({ finalizedGame }) {
          finalizedPayload = structuredClone(finalizedGame);
          return {
            canonicalEventHash: sha256Commitment(finalizedGame),
          };
        },
      },
    });
    const leasedGame = {
      ...game,
      conductorLease: {
        stepId: `${gameId}:possession:1`,
        kind: "POSSESSION" as const,
        sequence: 1,
        reservedAt: "2026-08-27T12:00:01.000Z",
        expiresAt: "2026-08-27T12:02:01.000Z",
        attempt: 1,
      },
    };
    const result = await executor.conduct({
      game: leasedGame,
      stepId: `${gameId}:possession:1`,
      sequence: 1,
    });
    expect(result.activationOutcomes).toHaveLength(29);
    expect(result.activationOutcomes.every(({ completed }) => completed)).toBe(
      true,
    );
    expect(submitted).toBe(1);
    expect(result.basketballRuntime.commands).toEqual([
      { type: "TICK", milliseconds: 23_000 },
      { type: "VIOLATION", team: "HOME", playerId: null, kind: "SHOT_CLOCK" },
    ]);
    expect(result.basketballRuntime.possessionProofs).toHaveLength(1);
    const firstAttemptActivations = structuredClone(dispatchedActivations);
    const recovered = await executor.conduct({
      game: {
        ...leasedGame,
        stateRoot: sha256Commitment("lease-reclaimed-state"),
        conductorLease: {
          ...leasedGame.conductorLease,
          expiresAt: "2026-08-27T12:04:01.000Z",
          attempt: 2,
        },
      },
      stepId: `${gameId}:possession:1`,
      sequence: 1,
    });
    expect(dispatchedActivations.slice(29)).toEqual(firstAttemptActivations);
    expect(recovered).toEqual(result);
    const substituted = {
      ...leasedGame,
      basketballRuntime: result.basketballRuntime,
      completedPossessions: [
        {
          sequence: 1,
          possessionId: result.possessionId,
          authoritativeStateRoot: result.authoritativeStateRoot,
          eventMerkleRoot: result.eventMerkleRoot,
          canonicalEventHash: result.canonicalEventHash,
          recordedAt: result.recordedAt,
        },
      ],
      participants: game.participants.map((participant) =>
        participant.careerDid === "did:abl:home-player-0"
          ? {
              ...participant,
              active: false,
              alternate: true,
              ready: false,
              currentPosition: null,
            }
          : participant.careerDid === "did:abl:home-player-5"
            ? {
                ...participant,
                active: true,
                alternate: false,
                currentPosition: "PG" as const,
              }
            : participant,
      ),
      stateRoot: sha256Commitment("substituted-game-state"),
    };
    const afterSubstitution = await executor.conduct({
      game: {
        ...substituted,
        conductorLease: {
          stepId: `${gameId}:possession:2`,
          kind: "POSSESSION",
          sequence: 2,
          reservedAt: "2026-08-27T12:01:01.000Z",
          expiresAt: "2026-08-27T12:03:01.000Z",
          attempt: 1,
        },
      },
      stepId: `${gameId}:possession:2`,
      sequence: 2,
    });
    expect(afterSubstitution.basketballRuntime.commands).toContainEqual({
      type: "SUBSTITUTE",
      team: "HOME",
      outPlayerId: "H1",
      inPlayerId: "H6",
    });
    expect(
      afterSubstitution.basketballRuntime.playerStates.map(
        ({ playerId }) => playerId,
      ),
    ).toContain("H6");
    expect(submitted).toBe(3);

    const fullGame = new FullGameEngine(result.basketballRuntime.input);
    for (const command of result.basketballRuntime.commands)
      fullGame.apply(command);
    fullGame.apply({ type: "THROW_IN", team: "AWAY", playerId: "A1" });
    fullGame.apply({
      type: "SHOT",
      team: "AWAY",
      playerId: "A1",
      points: 2,
      made: true,
    });
    fullGame.apply({ type: "THROW_IN", team: "HOME", playerId: "H1" });
    fullGame.apply({ type: "TICK", milliseconds: 697_000 });
    fullGame.apply({ type: "END_PERIOD" });
    for (let period = 2; period <= 4; period += 1) {
      fullGame.apply({ type: "TICK", milliseconds: 720_000 });
      fullGame.apply({ type: "END_PERIOD" });
    }
    const finalRuntime = FoundingGameRuntimeSchema.parse({
      ...result.basketballRuntime,
      commands: [...fullGame.commands()],
      fullGameProof: fullGame.proof(),
      phase: "FINAL",
    });
    const finalizationStepId = `${gameId}:finalization`;
    const finalizingGame = {
      ...game,
      state: "FINALIZING" as const,
      basketballRuntime: finalRuntime,
      completedPossessions: [
        {
          sequence: 1,
          possessionId: result.possessionId,
          authoritativeStateRoot: result.authoritativeStateRoot,
          eventMerkleRoot: result.eventMerkleRoot,
          canonicalEventHash: result.canonicalEventHash,
          recordedAt: result.recordedAt,
        },
      ],
      conductorLease: {
        stepId: finalizationStepId,
        kind: "FINALIZATION" as const,
        sequence: 1,
        reservedAt: "2026-08-27T12:05:00.000Z",
        expiresAt: "2026-08-27T12:07:00.000Z",
        attempt: 1,
      },
      stateRoot: sha256Commitment("finalizing-game"),
    };
    const finalized = await executor.finalize({
      game: finalizingGame,
      stepId: finalizationStepId,
    });
    expect(finalized.liveStateRoot).toBe(finalized.replayStateRoot);
    expect(finalized.finalizedEventHash).toBe(
      sha256Commitment(FinalizedGamePayloadSchema.parse(finalizedPayload)),
    );
    expect(
      replayRoleCompleteFoundingExhibition(finalizedPayload).state.phase,
    ).toBe("FINAL");
  });
});
