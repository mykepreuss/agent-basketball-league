import {
  merkleRoot,
  recoverCanonicalEventSigner,
  sha256Commitment,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";

import { CounterRandom } from "./randomness.js";
import { observePlayer, stateRoot } from "./observations.js";
import {
  ActionIntentSchema,
  type BasketballState,
  type CoachDecision,
  type CoachDecisionBody,
  type CompetitionAuthority,
  type CognitionReceipt,
  type DecisionAuthorization,
  type PossessionAuthorities,
  type PublicPossessionSnapshot,
  type PublicPossessionSegment,
  type RefereeDecision,
  type RefereeDecisionBody,
  type ReplayDecision,
  type ReplayDecisionBody,
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
  authorities: PossessionAuthorities;
  domain: TypedDataDomain;
  randomSeed: `0x${string}`;
  windowDurationMs?: number;
  refereeDecisions: readonly RefereeDecision[];
  replayDecisions: readonly ReplayDecision[];
}

type AutonomousRole = "COACH" | "REFEREE" | "REPLAY";

export function roleObservationCommitment(
  role: AutonomousRole,
  contextRoot: `0x${string}`,
  scope: string,
): `0x${string}` {
  return sha256Commitment({ role, contextRoot, scope });
}

export function officialDecisionContextRoot(input: {
  initialState: BasketballState;
  windows: readonly DecisionWindow[];
  randomSeed: `0x${string}`;
}): `0x${string}` {
  return sha256Commitment({
    gameId: input.initialState.gameId,
    possessionId: input.initialState.possessionId,
    initialStateRoot: stateRoot(input.initialState),
    randomSeed: input.randomSeed,
    windows: input.windows.map((window) => ({
      windowId: window.windowId,
      playerDecisionHashes: window.decisions.map(
        (decision) => decision.eventHash,
      ),
      coachDecisionHashes: window.coaches.map((decision) => decision.eventHash),
    })),
  });
}

function validReceipt(
  receipt: CognitionReceipt,
  actorDid: string,
  role: CognitionReceipt["role"],
): boolean {
  return (
    receipt.agentDid === actorDid &&
    receipt.role === role &&
    Number.isInteger(receipt.deadlineMs) &&
    receipt.deadlineMs > 0 &&
    Number.isInteger(receipt.retryCount) &&
    receipt.retryCount >= 0 &&
    Number.isFinite(receipt.normalizedResourceUnits) &&
    receipt.normalizedResourceUnits >= 0 &&
    receipt.telemetryContentPolicy === "CONTENT_DISABLED"
  );
}

async function verifyRoleAuthorization<TDecision>(input: {
  authorization: DecisionAuthorization<TDecision>;
  decision: TDecision;
  actorDid: string;
  authority: CompetitionAuthority | undefined;
  role: AutonomousRole;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  contextRoot: `0x${string}`;
  domain: TypedDataDomain;
  usedAuthorizations: Set<string>;
}): Promise<void> {
  const { authorizationEvent: event, receipt } = input.authorization;
  const recovered = await recoverCanonicalEventSigner(
    input.domain,
    event,
    input.authorization.signature,
  );
  const authorizationKey = `${event.actorDid}:${event.nonce}:${event.eventId}:${event.idempotencyKey}`;
  if (
    input.authority === undefined ||
    input.authority.did !== input.actorDid ||
    recovered.toLowerCase() !== input.authority.signerAddress.toLowerCase() ||
    recovered.toLowerCase() !==
      input.authorization.signerAddress.toLowerCase() ||
    input.authorization.eventHash !== event.eventHash ||
    event.actorDid !== input.actorDid ||
    event.aggregateType !== input.aggregateType ||
    event.aggregateId !== input.aggregateId ||
    event.eventType !== input.eventType ||
    event.aggregateVersion < 1n ||
    !Number.isFinite(Date.parse(event.timestamp)) ||
    event.stateRoot !== input.contextRoot ||
    sha256Commitment(event.payload.decision) !==
      sha256Commitment(input.decision) ||
    event.payload.receiptCommitment !== sha256Commitment(receipt) ||
    receipt.observationHash !==
      roleObservationCommitment(
        input.role,
        input.contextRoot,
        input.aggregateId,
      ) ||
    !validReceipt(receipt, input.actorDid, input.role) ||
    input.usedAuthorizations.has(authorizationKey)
  ) {
    throw new Error(`${input.role} decision lacks recognized authority`);
  }
  input.usedAuthorizations.add(authorizationKey);
}

function validateAuthorities(authorities: PossessionAuthorities): void {
  if (
    authorities.referees.length !== 3 ||
    authorities.replayOfficials.length !== 2
  ) {
    throw new Error("Possession authority registry has the wrong crew sizes");
  }
  const members = [
    authorities.coaches.home,
    authorities.coaches.away,
    ...authorities.referees,
    ...authorities.replayOfficials,
  ];
  if (
    new Set(members.map(({ did }) => did)).size !== members.length ||
    new Set(members.map(({ signerAddress }) => signerAddress.toLowerCase()))
      .size !== members.length
  ) {
    throw new Error("Competition authorities must be distinct agents and keys");
  }
}

export interface PossessionResult {
  finalState: BasketballState;
  events: ResolutionEvent[];
  snapshots: PublicPossessionSnapshot[];
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
): boolean {
  const magnitude = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const proposedX =
    player.xCm + Math.trunc((dx * player.maxSpeedCmPerWindow) / magnitude);
  const proposedY =
    player.yCm + Math.trunc((dy * player.maxSpeedCmPerWindow) / magnitude);
  player.xCm = Math.max(0, Math.min(2_865, proposedX));
  player.yCm = Math.max(0, Math.min(1_524, proposedY));
  player.stamina = Math.max(0, player.stamina - (dx === 0 && dy === 0 ? 1 : 3));
  return (
    proposedX < 0 || proposedX > 2_865 || proposedY < 0 || proposedY > 1_524
  );
}

function distanceSquared(
  left: { xCm: number; yCm: number },
  right: { xCm: number; yCm: number },
): number {
  return (left.xCm - right.xCm) ** 2 + (left.yCm - right.yCm) ** 2;
}

function appendEvent(
  events: ResolutionEvent[],
  snapshots: PublicPossessionSnapshot[] | null,
  state: BasketballState,
  type: ResolutionEvent["type"],
  data: ResolutionEvent["data"],
): void {
  const root = stateRoot(state);
  const sequence = events.length;
  const event: ResolutionEvent = {
    sequence,
    type,
    data,
    stateRoot: root,
    eventHash: sha256Commitment({ sequence, type, data, stateRoot: root }),
  };
  events.push(event);
  snapshots?.push({
    format: "ABL-POSSESSION-SNAPSHOT-V1",
    sequence,
    eventType: type,
    eventData: structuredClone(data),
    eventHash: event.eventHash,
    stateRoot: root,
    gameId: state.gameId,
    possessionId: state.possessionId,
    period: state.quarter,
    gameClockMs: state.gameClockMs,
    shotClockMs: state.shotClockMs,
    score: structuredClone(state.score),
    possessionTeam: state.possessionTeam,
    phase: state.phase,
    ball: structuredClone(state.ball),
    players: state.players.map(({ playerId, team, position, xCm, yCm }) => ({
      playerId,
      team,
      position,
      xCm,
      yCm,
    })),
  });
}

async function verifyWindow(
  window: DecisionWindow,
  state: BasketballState,
  addresses: ReadonlyMap<string, `0x${string}`>,
  domain: TypedDataDomain,
  authorities: PossessionAuthorities,
  usedAuthorizations: Set<string>,
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
        sha256Commitment(decision.receipt) ||
      decision.authorizationEvent.aggregateType !== "player-decision" ||
      decision.authorizationEvent.eventType !== "ActionIntentSubmitted" ||
      !Number.isFinite(Date.parse(decision.authorizationEvent.timestamp)) ||
      !validReceipt(decision.receipt, player.did, "PLAYER") ||
      decision.receipt.observationHash !==
        sha256Commitment(observePlayer(state, player.playerId))
    ) {
      throw new Error("Decision signer is not registered to player");
    }
    decisions.set(decision.intent.playerId, decision);
  }
  if (state.players.some((player) => !decisions.has(player.playerId)))
    throw new Error("Decision window is incomplete");
  for (const coach of window.coaches) {
    if (
      coach.windowId !== window.windowId ||
      coach.targetPlayerIds.some(
        (playerId) =>
          !state.players.some(
            (player) =>
              player.playerId === playerId && player.team === coach.team,
          ),
      )
    ) {
      throw new Error("Coach decision targets the wrong window or team");
    }
    const body: CoachDecisionBody = {
      coachDid: coach.coachDid,
      team: coach.team,
      windowId: coach.windowId,
      instruction: coach.instruction,
      targetPlayerIds: coach.targetPlayerIds,
    };
    await verifyRoleAuthorization({
      authorization: coach,
      decision: body,
      actorDid: coach.coachDid,
      authority:
        authorities.coaches[coach.team.toLowerCase() as "home" | "away"],
      role: "COACH",
      aggregateType: "coach-decision",
      aggregateId: window.windowId,
      eventType: "CoachInstructionSubmitted",
      contextRoot: stateRoot(state),
      domain,
      usedAuthorizations,
    });
  }
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
  options: { captureSnapshots?: boolean } = {},
): Promise<PossessionResult> {
  if (input.windows.length < 2 || input.windows.length > 4)
    throw new Error("A possession requires two to four decision windows");
  const windowDurationMs = input.windowDurationMs ?? 2_000;
  if (
    !Number.isInteger(windowDurationMs) ||
    windowDurationMs < 1 ||
    windowDurationMs * input.windows.length > input.initialState.shotClockMs
  ) {
    throw new Error("Decision window timing exceeds the possession clock");
  }
  validateAuthorities(input.authorities);
  const state = structuredClone(input.initialState);
  const events: ResolutionEvent[] = [];
  const snapshots: PublicPossessionSnapshot[] | null =
    options.captureSnapshots === false ? null : [];
  const random = new CounterRandom(input.randomSeed);
  const usedAuthorizations = new Set<string>();
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
      input.authorities,
      usedAuthorizations,
    );
    let ballHandlerOutOfBounds: BasketballState["players"][number] | undefined;
    for (const player of [...state.players].sort((left, right) =>
      left.playerId.localeCompare(right.playerId),
    )) {
      const intent = decisions.get(player.playerId)!.intent;
      if (
        intent.action === "MOVE" &&
        movePlayer(player, intent.vector.dx, intent.vector.dy) &&
        player.playerId === state.ball.possessorId
      ) {
        ballHandlerOutOfBounds = player;
      }
    }
    if (ballHandlerOutOfBounds !== undefined) {
      state.possessionTeam =
        ballHandlerOutOfBounds.team === "HOME" ? "AWAY" : "HOME";
      state.ball.possessorId = null;
      state.phase = "DEAD";
      appendEvent(events, snapshots, state, "OUT_OF_BOUNDS", {
        playerId: ballHandlerOutOfBounds.playerId,
        team: ballHandlerOutOfBounds.team,
        derivedFromFixedPointMovement: true,
      });
      break;
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
      appendEvent(events, snapshots, state, "PASS", {
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
      appendEvent(events, snapshots, state, "SHOT", {
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
        appendEvent(events, snapshots, state, "REBOUND", {
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
    state.gameClockMs = Math.max(0, state.gameClockMs - windowDurationMs);
    state.shotClockMs = Math.max(0, state.shotClockMs - windowDurationMs);
    state.window = windowIndex + 1;
    appendEvent(events, snapshots, state, "WINDOW_RESOLVED", {
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
  const officialContext = officialDecisionContextRoot(input);
  const referees = new Map(
    input.authorities.referees.map((authority) => [authority.did, authority]),
  );
  if (
    new Set(input.refereeDecisions.map(({ refereeDid }) => refereeDid)).size !==
      3 ||
    [...input.refereeDecisions]
      .map(({ sequence }) => sequence)
      .sort((left, right) => left - right)
      .some((sequence, index) => sequence !== index)
  ) {
    throw new Error("Referee decisions must come from the assigned crew");
  }
  for (const referee of input.refereeDecisions) {
    if (
      referee.possessionId !== state.possessionId ||
      !Number.isInteger(referee.confidenceBps) ||
      referee.confidenceBps < 0 ||
      referee.confidenceBps > 10_000 ||
      (referee.againstPlayerId !== null &&
        !state.players.some(
          ({ playerId }) => playerId === referee.againstPlayerId,
        ))
    ) {
      throw new Error("Referee decision is outside its possession evidence");
    }
    const body: RefereeDecisionBody = {
      refereeDid: referee.refereeDid,
      possessionId: referee.possessionId,
      sequence: referee.sequence,
      call: referee.call,
      againstPlayerId: referee.againstPlayerId,
      confidenceBps: referee.confidenceBps,
    };
    await verifyRoleAuthorization({
      authorization: referee,
      decision: body,
      actorDid: referee.refereeDid,
      authority: referees.get(referee.refereeDid),
      role: "REFEREE",
      aggregateType: "referee-decision",
      aggregateId: state.possessionId,
      eventType: "RefereeDecisionSubmitted",
      contextRoot: officialContext,
      domain: input.domain,
      usedAuthorizations,
    });
  }
  const replayOfficials = new Map(
    input.authorities.replayOfficials.map((authority) => [
      authority.did,
      authority,
    ]),
  );
  if (
    new Set(input.replayDecisions.map(({ replayDid }) => replayDid)).size !== 2
  ) {
    throw new Error("Replay decisions must come from the assigned crew");
  }
  for (const replay of input.replayDecisions) {
    if (
      replay.possessionId !== state.possessionId ||
      replay.evidenceCommitment !== officialContext ||
      replay.reviewable !== (replay.ruling !== "NO_REVIEW")
    ) {
      throw new Error("Replay decision is outside its possession evidence");
    }
    const body: ReplayDecisionBody = {
      replayDid: replay.replayDid,
      possessionId: replay.possessionId,
      reviewable: replay.reviewable,
      ruling: replay.ruling,
      evidenceCommitment: replay.evidenceCommitment,
    };
    await verifyRoleAuthorization({
      authorization: replay,
      decision: body,
      actorDid: replay.replayDid,
      authority: replayOfficials.get(replay.replayDid),
      role: "REPLAY",
      aggregateType: "replay-decision",
      aggregateId: state.possessionId,
      eventType: "ReplayDecisionSubmitted",
      contextRoot: officialContext,
      domain: input.domain,
      usedAuthorizations,
    });
  }
  appendEvent(events, snapshots, state, "OFFICIAL_RULING", {
    refereeCalls: input.refereeDecisions.length,
    replayRulings: input.replayDecisions.length,
    reversed: input.replayDecisions.some(
      (decision) => decision.ruling === "REVERSE",
    ),
  });
  state.phase = "FINAL";
  appendEvent(events, snapshots, state, "POSSESSION_FINAL", {
    randomCounter: random.counter.toString(),
    inputAcceptedWinner: false,
  });
  const segments = publicSegments(events);
  return {
    finalState: state,
    events,
    snapshots: snapshots ?? [],
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
