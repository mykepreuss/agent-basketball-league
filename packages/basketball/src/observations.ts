import { sha256Commitment } from "@abl/recognition";

import type {
  BasketballState,
  PlayerObservation,
  PlayerState,
} from "./types.js";

function distanceSquared(left: PlayerState, right: PlayerState): number {
  return (left.xCm - right.xCm) ** 2 + (left.yCm - right.yCm) ** 2;
}

function clonePlayer(player: PlayerState): PlayerState {
  return structuredClone(player);
}

export function stateRoot(state: BasketballState): `0x${string}` {
  return sha256Commitment({
    ...state,
    players: [...state.players].sort((left, right) =>
      left.playerId.localeCompare(right.playerId),
    ),
  });
}

export function observePlayer(
  state: BasketballState,
  playerId: string,
): PlayerObservation {
  const self = state.players.find((player) => player.playerId === playerId);
  if (self === undefined) throw new Error(`Unknown player: ${playerId}`);
  const visibleTeammates = state.players
    .filter(
      (player) =>
        player.team === self.team && player.playerId !== self.playerId,
    )
    .map(clonePlayer);
  const visibleOpponents = state.players
    .filter(
      (player) =>
        player.team !== self.team && distanceSquared(player, self) <= 900 ** 2,
    )
    .map(clonePlayer);
  const ballVisible =
    state.ball.possessorId === null ||
    state.ball.possessorId === self.playerId ||
    visibleTeammates.some(
      (player) => player.playerId === state.ball.possessorId,
    ) ||
    visibleOpponents.some(
      (player) => player.playerId === state.ball.possessorId,
    );
  return {
    observationId: `${state.possessionId}:w${state.window}:${playerId}`,
    playerId,
    team: self.team,
    position: self.position,
    window: state.window,
    gameClockMs: state.gameClockMs,
    shotClockMs: state.shotClockMs,
    score: structuredClone(state.score),
    self: clonePlayer(self),
    visibleTeammates,
    visibleOpponents,
    ball: ballVisible ? structuredClone(state.ball) : null,
    stateCommitment: stateRoot(state),
  };
}
