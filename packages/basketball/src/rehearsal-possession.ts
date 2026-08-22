import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { Address, Hex, TypedDataDomain } from "viem";
import { z } from "zod";

import { PersistentPlayerBody } from "./bodies.js";
import {
  officialDecisionContextRoot,
  resolvePossession,
  roleObservationCommitment,
  type DecisionWindow,
  type PossessionInput,
} from "./engine.js";
import { observePlayer, stateRoot } from "./observations.js";
import { commitRandomShare, deriveRandomSeed } from "./randomness.js";
import { ActionIntentSchema } from "./types.js";
import type {
  BasketballState,
  CoachDecision,
  CoachDecisionBody,
  CompetitionAuthority,
  CognitionReceipt,
  DecisionAuthorization,
  PlayerState,
  RefereeDecision,
  RefereeDecisionBody,
  ReplayDecision,
  ReplayDecisionBody,
} from "./types.js";

export const REHEARSAL_RECOGNITION_DOMAIN: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};

function players(): PlayerState[] {
  const positions = ["PG", "SG", "SF", "PF", "C"] as const;
  return (["HOME", "AWAY"] as const).flatMap((team, teamIndex) =>
    positions.map((position, index) => ({
      playerId: `${team === "HOME" ? "H" : "A"}${index + 1}`,
      did: `did:abl:${team.toLowerCase()}-${index + 1}`,
      team,
      position,
      xCm: team === "HOME" ? 2_500 - index * 180 : 800 + index * 180,
      yCm: 250 + index * 240 + teamIndex * 35,
      maxSpeedCmPerWindow: 95 + index * 3,
      shootingBps: position === "PG" ? 9_000 : 6_500 + index * 250,
      passingBps: 7_500 - index * 200,
      defenseBps: 5_800 + index * 300,
      stamina: 100,
    })),
  );
}

function initialState(): BasketballState {
  const roster = players();
  const possessor = roster.find(({ playerId }) => playerId === "H1")!;
  return {
    gameId: "0198a000-0000-7000-8000-000000000201",
    possessionId: "possession-proof-001",
    quarter: 1,
    gameClockMs: 720_000,
    shotClockMs: 24_000,
    score: { home: 0, away: 0 },
    possessionTeam: "HOME",
    ball: {
      xCm: possessor.xCm,
      yCm: possessor.yCm,
      possessorId: possessor.playerId,
    },
    players: roster,
    window: 0,
    phase: "LIVE",
  };
}

function receipt(input: {
  did: string;
  role: CognitionReceipt["role"];
  subject: string;
  observationHash: `0x${string}`;
}): CognitionReceipt {
  return {
    receiptId: `${input.subject}:receipt:${input.did}`,
    agentDid: input.did,
    role: input.role,
    endpoint: "local-deterministic-rehearsal-adapter",
    provider: "fixture",
    modelFamily: "structured-policy",
    modelRevision: "1",
    observationHash: input.observationHash,
    contextManifestHash: sha256Commitment({ subject: input.subject }),
    kernelHash: sha256Commitment("basketball-kernel-v1"),
    toolHash: sha256Commitment("no-tools"),
    deadlineMs: 1_500,
    retryCount: 0,
    fallbackUsed: false,
    normalizedResourceUnits: 1_000,
    telemetryContentPolicy: "CONTENT_DISABLED",
    personalMaterialSupplied: [],
  };
}

async function authorize<TDecision>(input: {
  body: TDecision;
  identity: SigningIdentity;
  actorDid: string;
  receipt: CognitionReceipt;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  contextRoot: `0x${string}`;
}): Promise<TDecision & DecisionAuthorization<TDecision>> {
  const event = createCanonicalEvent({
    eventId: `${input.aggregateId}:${input.actorDid}:${input.aggregateVersion}`,
    actorDid: input.actorDid,
    nonce: `${input.aggregateId}:${input.aggregateVersion}`,
    idempotencyKey: `${input.aggregateId}:${input.actorDid}:${input.aggregateVersion}:idempotency`,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    eventType: input.eventType,
    previousEventHash: null,
    payload: {
      decision: input.body,
      receiptCommitment: sha256Commitment(input.receipt),
    },
    stateRoot: input.contextRoot,
    schemaDigest: sha256Commitment(`${input.eventType}:1.0.0`),
    timestamp: "2026-08-13T10:00:00.000Z",
  });
  return {
    ...input.body,
    receipt: input.receipt,
    authorizationEvent: event,
    eventHash: event.eventHash,
    signature: await signCanonicalEvent(
      input.identity,
      REHEARSAL_RECOGNITION_DOMAIN,
      event,
    ),
    signerAddress: input.identity.address,
  };
}

function fixedIdentity(value: number): SigningIdentity {
  return createSigningIdentity(
    `0x${value.toString(16).padStart(64, "0")}` as Hex,
  );
}

export interface RehearsalPlayerBody {
  readonly signerAddress: Address;
  decisionVersion(): bigint;
  decide(
    observation: Parameters<PersistentPlayerBody["decide"]>[0],
    domain: TypedDataDomain,
  ): ReturnType<PersistentPlayerBody["decide"]>;
}

export type RehearsalPlayerBodies = Map<string, RehearsalPlayerBody>;

export function createRehearsalPlayerBodies(input: {
  terminalWindow: number;
  ballHandlerBoundaryExit?: boolean;
}): RehearsalPlayerBodies {
  return new Map(
    players().map((player, index) => [
      player.playerId,
      new PersistentPlayerBody({
        did: player.did,
        playerId: player.playerId,
        signingIdentity: fixedIdentity(index + 1),
        policy: (observation) => {
          const windowId = observation.observationId
            .split(":")
            .slice(0, 2)
            .join(":");
          if (observation.window < input.terminalWindow)
            return { windowId, playerId: player.playerId, action: "HOLD" };
          if (
            observation.ball?.possessorId === player.playerId &&
            input.ballHandlerBoundaryExit === true
          ) {
            return {
              windowId,
              playerId: player.playerId,
              action: "MOVE",
              vector: { dx: player.team === "HOME" ? 1_000 : -1_000, dy: 0 },
            };
          }
          if (observation.ball?.possessorId === player.playerId)
            return {
              windowId,
              playerId: player.playerId,
              action: "SHOOT",
              shot: "LAYUP",
            };
          return {
            windowId,
            playerId: player.playerId,
            action: "MOVE",
            vector: {
              dx: player.team === "HOME" ? 1_000 : -1_000,
              dy: index % 2 === 0 ? 250 : -250,
            },
          };
        },
      }),
    ]),
  );
}

export interface FirstPossessionRehearsalOptions {
  ballHandlerBoundaryExit?: boolean;
  bodies?: RehearsalPlayerBodies;
  gameId?: string;
  possessionId?: string;
  gameClockMs?: number;
  shotClockMs?: number;
  score?: { home: number; away: number };
  possessionTeam?: "HOME" | "AWAY";
  playerStates?: readonly PlayerState[];
  playerDidOverrides?: Readonly<Record<string, string>>;
  windowCount?: 2 | 3 | 4;
  windowDurationMs?: number;
}

export async function runFirstPossessionRehearsal(
  options: FirstPossessionRehearsalOptions = {},
) {
  const initial = initialState();
  initial.gameId = options.gameId ?? initial.gameId;
  initial.possessionId = options.possessionId ?? initial.possessionId;
  initial.gameClockMs = options.gameClockMs ?? initial.gameClockMs;
  initial.shotClockMs = options.shotClockMs ?? initial.shotClockMs;
  initial.score = structuredClone(options.score ?? initial.score);
  initial.possessionTeam = options.possessionTeam ?? initial.possessionTeam;
  initial.players = [
    ...structuredClone(options.playerStates ?? initial.players),
  ];
  for (const player of initial.players) {
    const did = options.playerDidOverrides?.[player.playerId];
    if (did !== undefined) player.did = did;
  }
  const possessorId = initial.possessionTeam === "HOME" ? "H1" : "A1";
  const possessor = initial.players.find(
    ({ playerId }) => playerId === possessorId,
  );
  if (possessor === undefined)
    throw new Error("Rehearsal possession has no designated ball handler");
  initial.ball = {
    xCm: possessor.xCm,
    yCm: possessor.yCm,
    possessorId,
  };
  const windowCount = options.windowCount ?? 3;
  const windowDurationMs = options.windowDurationMs ?? 2_000;
  if (options.ballHandlerBoundaryExit === true) {
    const ballHandler = initial.players.find(
      ({ playerId }) => playerId === possessorId,
    )!;
    ballHandler.xCm = ballHandler.team === "HOME" ? 2_860 : 5;
    initial.ball.xCm = ballHandler.xCm;
  }
  const bodies =
    options.bodies ??
    createRehearsalPlayerBodies({
      terminalWindow: windowCount - 1,
      ...(options.ballHandlerBoundaryExit === undefined
        ? {}
        : { ballHandlerBoundaryExit: options.ballHandlerBoundaryExit }),
    });
  const coachIdentities = {
    HOME: fixedIdentity(101),
    AWAY: fixedIdentity(102),
  } as const;
  const refereeIdentities = [103, 104, 105].map(fixedIdentity);
  const replayIdentities = [106, 107].map(fixedIdentity);
  const windows: DecisionWindow[] = [];
  for (let index = 0; index < windowCount; index += 1) {
    const observationState = structuredClone(initial);
    observationState.window = index;
    observationState.gameClockMs -= index * windowDurationMs;
    observationState.shotClockMs -= index * windowDurationMs;
    const decisions = await Promise.all(
      observationState.players.map((player) =>
        bodies
          .get(player.playerId)!
          .decide(
            observePlayer(observationState, player.playerId),
            REHEARSAL_RECOGNITION_DOMAIN,
          ),
      ),
    );
    const coaches: CoachDecision[] = await Promise.all(
      (["HOME", "AWAY"] as const).map(async (team) => {
        const body: CoachDecisionBody = {
          coachDid: `did:abl:coach-${team.toLowerCase()}`,
          team,
          windowId: `${initial.possessionId}:w${index}`,
          instruction: team === "HOME" ? "SPACE" : "PROTECT_RIM",
          targetPlayerIds: observationState.players
            .filter((player) => player.team === team)
            .map(({ playerId }) => playerId),
        };
        const contextRoot = stateRoot(observationState);
        return authorize({
          body,
          identity: coachIdentities[team],
          actorDid: body.coachDid,
          receipt: receipt({
            did: body.coachDid,
            role: "COACH",
            subject: body.windowId,
            observationHash: roleObservationCommitment(
              "COACH",
              contextRoot,
              body.windowId,
            ),
          }),
          aggregateType: "coach-decision",
          aggregateId: body.windowId,
          aggregateVersion: BigInt(index + 1),
          eventType: "CoachInstructionSubmitted",
          contextRoot,
        });
      }),
    );
    windows.push({
      windowId: `${initial.possessionId}:w${index}`,
      decisions,
      coaches,
    });
  }
  const parties = ["club:home", "club:away", "integrity:1"];
  const defaultPossession =
    initial.gameId === "0198a000-0000-7000-8000-000000000201" &&
    initial.possessionId === "possession-proof-001";
  const reveals = parties.map((party, index) => ({
    party,
    gameId: initial.gameId,
    share: defaultPossession
      ? (`0x${(index + 101).toString(16).padStart(64, "0")}` as Hex)
      : sha256Commitment({
          gameId: initial.gameId,
          possessionId: initial.possessionId,
          party,
        }),
  }));
  const commitments = reveals.map((reveal) =>
    commitRandomShare(reveal.gameId, reveal.party, reveal.share),
  );
  const randomSeed = deriveRandomSeed(
    initial.gameId,
    commitments,
    reveals,
    parties,
  );
  const authorities = {
    coaches: {
      home: {
        did: "did:abl:coach-home",
        signerAddress: coachIdentities.HOME.address,
      },
      away: {
        did: "did:abl:coach-away",
        signerAddress: coachIdentities.AWAY.address,
      },
    },
    referees: refereeIdentities.map(
      (identity, index): CompetitionAuthority => ({
        did: `did:abl:referee-${index + 1}`,
        signerAddress: identity.address,
      }),
    ),
    replayOfficials: replayIdentities.map(
      (identity, index): CompetitionAuthority => ({
        did: `did:abl:replay-${index + 1}`,
        signerAddress: identity.address,
      }),
    ),
  };
  const officialContext = officialDecisionContextRoot({
    initialState: initial,
    windows,
    randomSeed,
  });
  const refereeDecisions: RefereeDecision[] = await Promise.all(
    refereeIdentities.map(async (identity, index) => {
      const body: RefereeDecisionBody = {
        refereeDid: `did:abl:referee-${index + 1}`,
        possessionId: initial.possessionId,
        sequence: index,
        call: "NO_CALL",
        againstPlayerId: null,
        confidenceBps: 8_000 - index * 300,
      };
      return authorize({
        body,
        identity,
        actorDid: body.refereeDid,
        receipt: receipt({
          did: body.refereeDid,
          role: "REFEREE",
          subject: `official:${index}`,
          observationHash: roleObservationCommitment(
            "REFEREE",
            officialContext,
            initial.possessionId,
          ),
        }),
        aggregateType: "referee-decision",
        aggregateId: initial.possessionId,
        aggregateVersion: 1n,
        eventType: "RefereeDecisionSubmitted",
        contextRoot: officialContext,
      });
    }),
  );
  const replayDecisions: ReplayDecision[] = await Promise.all(
    replayIdentities.map(async (identity, index) => {
      const body: ReplayDecisionBody = {
        replayDid: `did:abl:replay-${index + 1}`,
        possessionId: initial.possessionId,
        reviewable: false,
        ruling: "NO_REVIEW",
        evidenceCommitment: officialContext,
      };
      return authorize({
        body,
        identity,
        actorDid: body.replayDid,
        receipt: receipt({
          did: body.replayDid,
          role: "REPLAY",
          subject: `replay:${index}`,
          observationHash: roleObservationCommitment(
            "REPLAY",
            officialContext,
            initial.possessionId,
          ),
        }),
        aggregateType: "replay-decision",
        aggregateId: initial.possessionId,
        aggregateVersion: 1n,
        eventType: "ReplayDecisionSubmitted",
        contextRoot: officialContext,
      });
    }),
  );
  const input: PossessionInput = {
    initialState: initial,
    windows,
    playerSigningAddresses: new Map(
      [...bodies].map(([playerId, body]) => [playerId, body.signerAddress]),
    ),
    authorities,
    domain: REHEARSAL_RECOGNITION_DOMAIN,
    randomSeed,
    windowDurationMs,
    refereeDecisions,
    replayDecisions,
  };
  return {
    input,
    result: await resolvePossession(input),
    bodies,
    decisionProof: {
      playerDecisionHashes: windows.flatMap(({ decisions }) =>
        decisions.map(({ eventHash }) => eventHash),
      ),
      coachDecisionHashes: windows.flatMap(({ coaches }) =>
        coaches.map(({ eventHash }) => eventHash),
      ),
      refereeDecisionHashes: refereeDecisions.map(({ eventHash }) => eventHash),
      replayDecisionHashes: replayDecisions.map(({ eventHash }) => eventHash),
    },
  };
}

export const PUBLIC_PRACTICE_SCENARIO_ID = "abl-first-possession-practice-v1";

export const PublicPracticeDecisionRequestSchema = z.strictObject({
  scenarioId: z.literal(PUBLIC_PRACTICE_SCENARIO_ID),
  decision: ActionIntentSchema,
});

export type PublicPracticeDecisionRequest = z.infer<
  typeof PublicPracticeDecisionRequestSchema
>;

function publicPracticeDecision(
  decision: PublicPracticeDecisionRequest["decision"],
  observation: Parameters<PersistentPlayerBody["decide"]>[0],
): PublicPracticeDecisionRequest["decision"] {
  const windowId = observation.observationId.split(":").slice(0, 2).join(":");
  if (observation.window === 1) return { ...decision, windowId };
  return { windowId, playerId: observation.playerId, action: "HOLD" };
}

export function publicPracticeScenario() {
  const state = initialState();
  state.window = 1;
  state.gameClockMs -= 2_000;
  state.shotClockMs -= 2_000;
  const observation = observePlayer(state, "H1");
  return {
    scenarioId: PUBLIC_PRACTICE_SCENARIO_ID,
    practice: true as const,
    canonical: false as const,
    recognition: "NONE" as const,
    createsCareer: false as const,
    createsPublicHistory: false as const,
    role: "PLAYER" as const,
    observation,
    decisionRequirements: {
      windowId: `${state.possessionId}:w1`,
      playerId: observation.playerId,
      allowedActions: ["MOVE", "PASS", "SHOOT", "SCREEN", "HOLD"] as const,
    },
    scenarioCommitment: sha256Commitment({
      scenarioId: PUBLIC_PRACTICE_SCENARIO_ID,
      observation,
    }),
  };
}

export async function resolvePublicPracticeDecision(input: unknown) {
  const request = PublicPracticeDecisionRequestSchema.parse(input);
  const scenario = publicPracticeScenario();
  if (
    request.decision.windowId !== scenario.decisionRequirements.windowId ||
    request.decision.playerId !== scenario.decisionRequirements.playerId
  )
    throw new Error("Practice decision is bound to another scenario");

  const bodies = createRehearsalPlayerBodies({ terminalWindow: 1 });
  bodies.set(
    scenario.decisionRequirements.playerId,
    new PersistentPlayerBody({
      did: scenario.observation.self.did,
      playerId: scenario.decisionRequirements.playerId,
      signingIdentity: fixedIdentity(201),
      policy: (observation) =>
        publicPracticeDecision(request.decision, observation),
    }),
  );
  const rehearsal = await runFirstPossessionRehearsal({
    bodies,
    windowCount: 2,
  });
  return {
    scenarioId: scenario.scenarioId,
    practice: true as const,
    canonical: false as const,
    recognition: "NONE" as const,
    recognizedGameMutation: false as const,
    createsCareer: false as const,
    createsPublicHistory: false as const,
    decisionCommitment: sha256Commitment(request.decision),
    outcome: {
      score: rehearsal.result.finalState.score,
      possessionTeam: rehearsal.result.finalState.possessionTeam,
      gameClockMs: rehearsal.result.finalState.gameClockMs,
      shotClockMs: rehearsal.result.finalState.shotClockMs,
      ball: rehearsal.result.finalState.ball,
      events: rehearsal.result.events.map(({ sequence, type, eventHash }) => ({
        sequence,
        type,
        eventHash,
      })),
    },
    eventMerkleRoot: rehearsal.result.eventMerkleRoot,
    finalStateRoot: rehearsal.result.finalStateRoot,
    inferenceInvocations: 0 as const,
  };
}
