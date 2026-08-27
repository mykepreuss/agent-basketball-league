import {
  FinalizedGamePayloadSchema,
  REHEARSAL_RECOGNITION_DOMAIN,
  createDeterministicFixtureReceipt,
  materializePossessionInput,
  replayRoleCompleteFoundingExhibition,
  resolvePossession,
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
  ScheduledGameStateSchema,
  beginGame,
  completeScheduledGame,
  createScheduledGame,
  lockLineup,
  recordConductedPossession,
  reserveConductorStep,
  tipOffGame,
  type CompetitionParticipant,
  type ScheduledGameState,
} from "../src/lifecycle.js";
import { FoundingLiveGameExecutor } from "../src/live-game.js";
import { NEUTRAL_OFFICIAL_REGISTRY } from "../src/neutral-official-registry.js";

const gameId = "0198e000-0000-7000-8000-000000000901";
const createdAt = "2026-08-26T12:00:00.000Z";
const tipoffAt = "2026-08-27T12:00:00.000Z";

function deterministicUuid(subject: string): string {
  const hash = sha256Commitment(subject).slice(2);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function createRoster() {
  const identities = new Map<string, SigningIdentity>();
  const participants: CompetitionParticipant[] = [];
  let key = 101;
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
  let refereeIndex = 0;
  for (const official of NEUTRAL_OFFICIAL_REGISTRY) {
    const active = official.role === "REPLAY" || refereeIndex < 3;
    add(official.careerDid, official.role, null, active, !active);
    if (official.role === "REFEREE") refereeIndex += 1;
  }
  return { participants, identities };
}

function createInProgressGame(
  participants: CompetitionParticipant[],
): ScheduledGameState {
  const officialResources = new Map(
    NEUTRAL_OFFICIAL_REGISTRY.map((official) => [
      official.careerDid,
      official.careerResourceName,
    ]),
  );
  const careerResources = Object.fromEntries(
    participants.map(({ careerDid }, index) => [
      careerDid,
      officialResources.get(careerDid) ??
        `abl-rehearsal-career-${String(index).padStart(2, "0")}`,
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
          { length: 3 },
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

function fixtureDecision(activation: RoleActivation) {
  if (activation.role === "PLAYER") {
    const homePrimaryShootsInSecondWindow =
      activation.playerId === "H1" && activation.activationId.includes(":w1:");
    return homePrimaryShootsInSecondWindow
      ? {
          windowId: activation.windowId,
          playerId: activation.playerId,
          action: "SHOOT" as const,
          shot: "LAYUP" as const,
        }
      : {
          windowId: activation.windowId,
          playerId: activation.playerId,
          action: "HOLD" as const,
        };
  }
  if (activation.role === "COACH")
    return {
      coachDid: activation.careerDid,
      team: activation.teamId,
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

describe("bounded deterministic distributed-game rehearsal", () => {
  it("conducts and finalizes every possession through the production multi-role path", async () => {
    const { participants, identities } = createRoster();
    let game = createInProgressGame(participants);
    const activationIds = new Set<string>();
    const canonicalHashes: `0x${string}`[] = [];
    let finalizedPayload: unknown;
    const dispatcher = {
      async dispatch({ activation }) {
        if (activationIds.has(activation.activationId))
          throw new Error("Deterministic rehearsal duplicated inference");
        activationIds.add(activation.activationId);
        const identity = identities.get(activation.careerDid)!;
        const decision = fixtureDecision(activation);
        const receipt = createDeterministicFixtureReceipt({
          careerDid: activation.careerDid,
          role: activation.role,
          activationId: activation.activationId,
          observationCommitment:
            activation.observationCommitment as `0x${string}`,
          contextManifestCommitment: sha256Commitment({
            activationId: activation.activationId,
            fixture: "FULL_GAME_REHEARSAL",
          }),
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
          schemaDigest: activation.expectedOutputSchemaDigest as `0x${string}`,
          timestamp: activation.openedAt,
        });
        return {
          participantResultAccepted: true,
          decision: {
            ...(activation.role === "PLAYER" ? { intent: decision } : decision),
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
    } satisfies ConstructorParameters<
      typeof FoundingLiveGameExecutor
    >[0]["dispatcher"];
    const submitter = {
      async submit({ sequence, previousEventHash, possessionInput }) {
        expect(previousEventHash).toBe(canonicalHashes.at(-1) ?? null);
        const replay = await resolvePossession(
          materializePossessionInput(possessionInput),
        );
        const canonicalEventHash = sha256Commitment({
          sequence,
          previousEventHash,
          possessionInput,
        });
        canonicalHashes.push(canonicalEventHash);
        return {
          canonicalEventHash,
          finalStateRoot: replay.finalStateRoot,
          eventMerkleRoot: replay.eventMerkleRoot,
        };
      },
      async finalize({ finalizedGame }) {
        finalizedPayload = structuredClone(finalizedGame);
        return { canonicalEventHash: sha256Commitment(finalizedGame) };
      },
    } satisfies ConstructorParameters<
      typeof FoundingLiveGameExecutor
    >[0]["submitter"];
    const createExecutor = () =>
      new FoundingLiveGameExecutor({
        domain: REHEARSAL_RECOGNITION_DOMAIN,
        dispatcher,
        submitter,
      });
    let executor = createExecutor();

    let pass = 0;
    while (game.state === "IN_PROGRESS") {
      pass += 1;
      if (pass > 160)
        throw new Error("Deterministic rehearsal exceeded its possession cap");
      const reservedAt = new Date(
        Date.parse(tipoffAt) + pass * 1_000,
      ).toISOString();
      const reserved = reserveConductorStep({ game, reservedAt });
      const lease = reserved.conductorLease!;
      const possession = await executor.conduct({
        game: reserved,
        stepId: lease.stepId,
        sequence: lease.sequence,
      });
      game = recordConductedPossession({
        game: reserved,
        stepId: lease.stepId,
        possessionId: possession.possessionId,
        authoritativeStateRoot: possession.authoritativeStateRoot,
        eventMerkleRoot: possession.eventMerkleRoot,
        canonicalEventHash: possession.canonicalEventHash,
        recordedAt: possession.recordedAt,
        basketballRuntime: possession.basketballRuntime,
        activationOutcomes: possession.activationOutcomes,
      });
      if (pass % 11 === 0) {
        game = ScheduledGameStateSchema.parse(JSON.parse(JSON.stringify(game)));
        executor = createExecutor();
      }
    }

    expect(game.state).toBe("FINALIZING");
    const finalizationReserved = reserveConductorStep({
      game,
      reservedAt: new Date(
        Date.parse(tipoffAt) + (pass + 1) * 1_000,
      ).toISOString(),
    });
    const finalizationLease = finalizationReserved.conductorLease!;
    expect(finalizationLease.kind).toBe("FINALIZATION");
    const finalized = await executor.finalize({
      game: finalizationReserved,
      stepId: finalizationLease.stepId,
    });
    game = completeScheduledGame({
      game: finalizationReserved,
      stepId: finalizationLease.stepId,
      ...finalized,
    });

    const payload = FinalizedGamePayloadSchema.parse(finalizedPayload);
    const replay = replayRoleCompleteFoundingExhibition(payload);
    expect(game.state).toBe("COMPLETED");
    expect(pass).toBe(128);
    expect(canonicalHashes).toHaveLength(pass);
    expect(activationIds.size).toBe(3_712);
    expect(payload.agentEvidence?.possessionCount).toBe(pass);
    expect(finalized.liveStateRoot).toBe(finalized.replayStateRoot);
    expect(replay.state.phase).toBe("FINAL");
    expect(replay.payload.proof.finalStateRoot).toBe(finalized.liveStateRoot);
    expect(game.finalization?.liveStateRoot).toBe(
      game.finalization?.replayStateRoot,
    );
  }, 120_000);
});
