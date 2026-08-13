import {
  merkleRoot,
  recoverCanonicalEventSigner,
  sha256Commitment,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";

import { CounterRandom } from "./randomness.js";
import { stateRoot } from "./observations.js";
import {
  ActionIntentSchema,
  type BasketballState,
  type CoachDecision,
  type PublicPossessionSegment,
  type RefereeDecision,
  type ReplayDecision,
  type ResolutionEvent,
  type SignedPlayerDecision,
} from "./types.js";

export interface DecisionWindow {
  windowId: string;
  decisions: readonly SignedPlayerDecision[];
  coaches: readonly CoachDecision[];
}

export interface PossessionInput {
  initialState: BasketballState;
  windows: readonly DecisionWindow[];
  playerSigningAddresses: ReadonlyMap<string, `0x${string}`>;
  domain: TypedDataDomain;
  randomSeed: `0x${string}`;
  refereeDecisions: readonly RefereeDecision[];
  replayDecisions: readonly ReplayDecision[];
}

export interface PossessionResult {
  finalState: BasketballState;
  events: ResolutionEvent[];
  segments: PublicPossessionSegment[];
  eventMerkleRoot: `0x${string}`;
  finalStateRoot: `0x${string}`;
  randomCounter: bigint;
  filmCommitment: `0x${string}`;
}

function movePlayer(
  player: BasketballState["players"][number],
  dx: number,
  dy: number,
): void {
  const magnitude = Math.max(Math.abs(dx), Math.abs(dy), 1);
  player.xCm = Math.max(
    0,
    Math.min(
      2_865,
      player.xCm + Math.trunc((dx * player.maxSpeedCmPerWindow) / magnitude),
    ),
  );
  player.yCm = Math.max(
    0,
    Math.min(
      1_524,
      player.yCm + Math.trunc((dy * player.maxSpeedCmPerWindow) / magnitude),
    ),
  );
  player.stamina = Math.max(0, player.stamina - (dx === 0 && dy === 0 ? 1 : 3));
}

function distanceSquared(
  left: { xCm: number; yCm: number },
  right: { xCm: number; yCm: number },
): number {
  return (left.xCm - right.xCm) ** 2 + (left.yCm - right.yCm) ** 2;
}

function appendEvent(
  events: ResolutionEvent[],
  state: BasketballState,
  type: ResolutionEvent["type"],
  data: ResolutionEvent["data"],
): void {
  const root = stateRoot(state);
  const sequence = events.length;
  events.push({
    sequence,
    type,
    data,
    stateRoot: root,
    eventHash: sha256Commitment({ sequence, type, data, stateRoot: root }),
  });
}

async function verifyWindow(
  window: DecisionWindow,
  state: BasketballState,
  addresses: ReadonlyMap<string, `0x${string}`>,
  domain: TypedDataDomain,
): Promise<Map<string, SignedPlayerDecision>> {
  if (window.decisions.length !== 10)
    throw new Error("Every decision window requires ten player decisions");
  if (
    window.coaches.length !== 2 ||
    new Set(window.coaches.map((decision) => decision.team)).size !== 2
  ) {
    throw new Error(
      "Every decision window requires independent decisions from both coaches",
    );
  }
  const decisions = new Map<string, SignedPlayerDecision>();
  for (const decision of window.decisions) {
    ActionIntentSchema.parse(decision.intent);
    if (
      decision.intent.windowId !== window.windowId ||
      decisions.has(decision.intent.playerId)
    ) {
      throw new Error("Duplicate or wrong-window player decision");
    }
    const expected = addresses.get(decision.intent.playerId);
    const recovered = await recoverCanonicalEventSigner(
      domain,
      decision.authorizationEvent,
      decision.signature,
    );
    const player = state.players.find(
      (candidate) => candidate.playerId === decision.intent.playerId,
    );
    if (
      expected === undefined ||
      player === undefined ||
      expected.toLowerCase() !== recovered.toLowerCase() ||
      recovered.toLowerCase() !== decision.signerAddress.toLowerCase() ||
      decision.authorizationEvent.actorDid !== player.did ||
      decision.authorizationEvent.aggregateId !== player.playerId ||
      decision.authorizationEvent.eventHash !== decision.eventHash ||
      decision.authorizationEvent.stateRoot !== stateRoot(state) ||
      sha256Commitment(decision.authorizationEvent.payload.intent) !==
        sha256Commitment(decision.intent) ||
      decision.authorizationEvent.payload.receiptCommitment !==
        sha256Commitment(decision.receipt)
    ) {
      throw new Error("Decision signer is not registered to player");
    }
    decisions.set(decision.intent.playerId, decision);
  }
  if (state.players.some((player) => !decisions.has(player.playerId)))
    throw new Error("Decision window is incomplete");
  return decisions;
}

function publicSegments(
  events: readonly ResolutionEvent[],
): PublicPossessionSegment[] {
  const segments: PublicPossessionSegment[] = [];
  for (const event of events) {
    const previousSegmentHash = segments.at(-1)?.segmentHash ?? null;
    const payloadCommitment = sha256Commitment({
      type: event.type,
      data: event.data,
    });
    const segmentHash = sha256Commitment({
      sequence: event.sequence,
      previousSegmentHash,
      eventHashes: [event.eventHash],
      stateRoot: event.stateRoot,
      payloadCommitment,
    });
    segments.push({
      sequence: event.sequence,
      previousSegmentHash,
      eventHashes: [event.eventHash],
      stateRoot: event.stateRoot,
      payloadCommitment,
      segmentHash,
    });
  }
  return segments;
}

export async function resolvePossession(
  input: PossessionInput,
): Promise<PossessionResult> {
  if (input.windows.length < 2 || input.windows.length > 4)
    throw new Error("A possession requires two to four decision windows");
  const state = structuredClone(input.initialState);
  const events: ResolutionEvent[] = [];
  const random = new CounterRandom(input.randomSeed);
  for (const [windowIndex, window] of input.windows.entries()) {
    if (state.phase !== "LIVE")
      throw new Error("Decision window occurs after possession ended");
    if (window.windowId !== `${state.possessionId}:w${windowIndex}`)
      throw new Error("Decision windows are out of order");
    const decisions = await verifyWindow(
      window,
      state,
      input.playerSigningAddresses,
      input.domain,
    );
    for (const player of [...state.players].sort((left, right) =>
      left.playerId.localeCompare(right.playerId),
    )) {
      const intent = decisions.get(player.playerId)!.intent;
      if (intent.action === "MOVE")
        movePlayer(player, intent.vector.dx, intent.vector.dy);
    }
    const possessor = state.players.find(
      (player) => player.playerId === state.ball.possessorId,
    );
    if (possessor === undefined)
      throw new Error("Live possession has no ball possessor");
    const ballIntent = decisions.get(possessor.playerId)!.intent;
    if (ballIntent.action === "PASS") {
      const target = state.players.find(
        (player) =>
          player.playerId === ballIntent.targetPlayerId &&
          player.team === possessor.team,
      );
      if (target === undefined)
        throw new Error("Pass target is not a teammate");
      const nearestDefender = Math.min(
        ...state.players
          .filter((player) => player.team !== possessor.team)
          .map((player) => distanceSquared(player, target)),
      );
      const completionBps = Math.max(
        5_000,
        Math.min(
          9_900,
          possessor.passingBps + Math.trunc(nearestDefender / 400),
        ),
      );
      const completed = random.nextBps() < completionBps;
      if (completed) state.ball.possessorId = target.playerId;
      appendEvent(events, state, "PASS", {
        from: possessor.playerId,
        to: target.playerId,
        completed,
      });
    } else if (ballIntent.action === "SHOOT") {
      const basket =
        possessor.team === "HOME"
          ? { xCm: 2_865, yCm: 762 }
          : { xCm: 0, yCm: 762 };
      const distance = Math.trunc(
        Math.sqrt(distanceSquared(possessor, basket)),
      );
      const contest = state.players
        .filter(
          (player) =>
            player.team !== possessor.team &&
            distanceSquared(player, possessor) <= 180 ** 2,
        )
        .reduce((total, player) => total + player.defenseBps, 0);
      const distancePenalty =
        ballIntent.shot === "LAYUP" ? distance * 5 : distance * 2;
      const chance = Math.max(
        500,
        Math.min(
          9_000,
          possessor.shootingBps - distancePenalty - Math.trunc(contest / 5),
        ),
      );
      const made = random.nextBps() < chance;
      const points = ballIntent.shot === "THREE" ? 3 : 2;
      if (made) {
        if (possessor.team === "HOME") state.score.home += points;
        else state.score.away += points;
      }
      appendEvent(events, state, "SHOT", {
        shooter: possessor.playerId,
        shot: ballIntent.shot,
        made,
        points: made ? points : 0,
        chanceBps: chance,
      });
      if (!made) {
        const candidates = [...state.players].sort((left, right) => {
          const leftMetric = distanceSquared(left, basket) - left.defenseBps;
          const rightMetric = distanceSquared(right, basket) - right.defenseBps;
          return (
            leftMetric - rightMetric ||
            left.playerId.localeCompare(right.playerId)
          );
        });
        const rebounder =
          candidates[random.nextBps() % Math.min(3, candidates.length)]!;
        state.ball.possessorId = rebounder.playerId;
        appendEvent(events, state, "REBOUND", {
          playerId: rebounder.playerId,
          team: rebounder.team,
        });
      }
      state.phase = "DEAD";
    }
    const currentPossessor = state.players.find(
      (player) => player.playerId === state.ball.possessorId,
    );
    if (currentPossessor !== undefined) {
      state.ball.xCm = currentPossessor.xCm;
      state.ball.yCm = currentPossessor.yCm;
    }
    state.gameClockMs -= 2_000;
    state.shotClockMs -= 2_000;
    state.window = windowIndex + 1;
    appendEvent(events, state, "WINDOW_RESOLVED", {
      window: windowIndex,
      decisionCount: decisions.size,
    });
  }
  if (state.phase === "LIVE") state.phase = "DEAD";
  if (
    input.refereeDecisions.length !== 3 ||
    input.replayDecisions.length !== 2
  ) {
    throw new Error(
      "A possession requires three referees and two replay officials",
    );
  }
  appendEvent(events, state, "OFFICIAL_RULING", {
    refereeCalls: input.refereeDecisions.length,
    replayRulings: input.replayDecisions.length,
    reversed: input.replayDecisions.some(
      (decision) => decision.ruling === "REVERSE",
    ),
  });
  state.phase = "FINAL";
  appendEvent(events, state, "POSSESSION_FINAL", {
    randomCounter: random.counter.toString(),
    inputAcceptedWinner: false,
  });
  const segments = publicSegments(events);
  return {
    finalState: state,
    events,
    segments,
    eventMerkleRoot: merkleRoot(events.map((event) => event.eventHash)),
    finalStateRoot: stateRoot(state),
    randomCounter: random.counter,
    filmCommitment: sha256Commitment({
      windows: input.windows.map((window) => ({
        windowId: window.windowId,
        decisions: window.decisions.map((decision) => ({
          eventHash: decision.eventHash,
          receiptCommitment: sha256Commitment(decision.receipt),
        })),
        coachReceiptCommitments: window.coaches.map((coach) =>
          sha256Commitment(coach.receipt),
        ),
      })),
      events,
    }),
  };
}

export function assertNoWinnerInput(input: PossessionInput): void {
  if ("winner" in (input as unknown as Record<string, unknown>))
    throw new Error("Winner input is forbidden");
}
