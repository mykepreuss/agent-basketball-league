import {
  replayFullGame,
  FullGameEngine,
  type FullGameInput,
} from "./full-game.js";
import { createAgentPlayedGameEvidence } from "./game-finalization.js";
import {
  createRehearsalPlayerBodies,
  runFirstPossessionRehearsal,
} from "./rehearsal-possession.js";
import type { PlayerState, ResolutionEvent } from "./types.js";

export interface AgentPlayedPossessionProof {
  possessionId: string;
  playerDecisionHashes: readonly `0x${string}`[];
  coachDecisionHashes: readonly `0x${string}`[];
  refereeDecisionHashes: readonly `0x${string}`[];
  replayDecisionHashes: readonly `0x${string}`[];
  eventMerkleRoot: `0x${string}`;
  finalStateRoot: `0x${string}`;
}

function gameInput(gameId: string): FullGameInput {
  return {
    gameId,
    roster: {
      home: ["H1", "H2", "H3", "H4", "H5", "H6", "H7"],
      away: ["A1", "A2", "A3", "A4", "A5", "A6", "A7"],
    },
    active: {
      home: ["H1", "H2", "H3", "H4", "H5"],
      away: ["A1", "A2", "A3", "A4", "A5"],
    },
    openingPossession: "HOME",
  };
}

function shot(events: readonly ResolutionEvent[]): ResolutionEvent {
  const event = events.find(({ type }) => type === "SHOT");
  if (event === undefined)
    throw new Error("Agent-played possession did not resolve a shot");
  return event;
}

export async function runAgentPlayedExhibition(
  gameId = "0198f100-0000-7000-8000-000000000001",
) {
  const input = gameInput(gameId);
  const engine = new FullGameEngine(input);
  const bodies = createRehearsalPlayerBodies({ terminalWindow: 1 });
  const possessionProofs: AgentPlayedPossessionProof[] = [];
  let playerStates: readonly PlayerState[] | undefined;
  let possessionNumber = 0;
  while (engine.snapshot().phase !== "FINAL") {
    if (possessionNumber >= 1_000)
      throw new Error("Agent-played exhibition exceeded its possession bound");
    const before = engine.snapshot();
    const elapsed = Math.min(23_000, before.gameClockMs);
    if (elapsed < 1)
      throw new Error("Agent-played exhibition reached an invalid clock state");
    const possessionId = `agent-possession-${String(possessionNumber + 1).padStart(4, "0")}`;
    const possession = await runFirstPossessionRehearsal({
      bodies,
      gameId,
      possessionId,
      gameClockMs: before.gameClockMs,
      shotClockMs: elapsed,
      score: before.score,
      possessionTeam: before.possessionTeam,
      ...(playerStates === undefined ? {} : { playerStates }),
      windowCount: 2,
      windowDurationMs: Math.trunc(elapsed / 2),
    });
    const elapsedByWindows = Math.trunc(elapsed / 2) * 2;
    engine.apply({ type: "TICK", milliseconds: elapsedByWindows });
    const resolvedShot = shot(possession.result.events);
    const made = resolvedShot.data.made === true;
    const points = resolvedShot.data.points;
    const shooter = resolvedShot.data.shooter;
    if (
      typeof shooter !== "string" ||
      (points !== 0 && points !== 2 && points !== 3)
    ) {
      throw new Error("Agent-played shot event is malformed");
    }
    engine.apply({
      type: "SHOT",
      team: before.possessionTeam,
      playerId: shooter,
      points: points === 3 ? 3 : 2,
      made,
    });
    if (made) {
      if (engine.snapshot().gameClockMs > 0) engine.apply({ type: "RESUME" });
    } else {
      const rebound = possession.result.events.find(
        ({ type }) => type === "REBOUND",
      );
      if (
        rebound === undefined ||
        typeof rebound.data.playerId !== "string" ||
        (rebound.data.team !== "HOME" && rebound.data.team !== "AWAY")
      ) {
        throw new Error("Missed agent-played shot lacks a valid rebound");
      }
      engine.apply({
        type: "REBOUND",
        team: rebound.data.team,
        playerId: rebound.data.playerId,
      });
    }
    playerStates = possession.result.finalState.players;
    possessionProofs.push({
      possessionId,
      ...possession.decisionProof,
      eventMerkleRoot: possession.result.eventMerkleRoot,
      finalStateRoot: possession.result.finalStateRoot,
    });
    possessionNumber += 1;
    if (engine.snapshot().gameClockMs === 0)
      engine.apply({ type: "END_PERIOD" });
  }
  const proof = engine.proof();
  const replay = replayFullGame(input, engine.commands(), proof);
  if (!replay.exact)
    throw new Error("Agent-played exhibition did not replay exactly");
  return {
    input,
    commands: engine.commands(),
    events: engine.events(),
    finalState: engine.snapshot(),
    proof,
    replay,
    possessionProofs,
    agentEvidence: createAgentPlayedGameEvidence({
      gameId,
      gameInput: input,
      commands: engine.commands(),
      proof,
      possessionProofs,
    }),
    persistentPlayerDecisionVersions: Object.fromEntries(
      [...bodies].map(([playerId, body]) => [
        playerId,
        body.decisionVersion().toString(),
      ]),
    ),
  };
}
