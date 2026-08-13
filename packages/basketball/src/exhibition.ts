import { FullGameEngine, type FullGameInput } from "./full-game.js";

export function deterministicExhibitionInput(): FullGameInput {
  return {
    gameId: "season-zero-exhibition-001",
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

function finishPeriod(engine: FullGameEngine): void {
  if (engine.snapshot().phase === "DEAD") engine.apply({ type: "RESUME" });
  engine.apply({ type: "TICK", milliseconds: engine.snapshot().gameClockMs });
  engine.apply({ type: "END_PERIOD" });
}

export function runDeterministicExhibition() {
  const input = deterministicExhibitionInput();
  const engine = new FullGameEngine(input);
  engine.apply({
    type: "SHOT",
    team: "HOME",
    playerId: "H1",
    points: 2,
    made: true,
  });
  engine.apply({ type: "RESUME" });
  engine.apply({
    type: "SHOT",
    team: "AWAY",
    playerId: "A1",
    points: 2,
    made: true,
  });
  for (let period = 1; period <= 4; period += 1) finishPeriod(engine);
  engine.apply({
    type: "SHOT",
    team: "HOME",
    playerId: "H1",
    points: 3,
    made: true,
  });
  finishPeriod(engine);
  return {
    input,
    commands: engine.commands(),
    finalState: engine.snapshot(),
    events: engine.events(),
    proof: engine.proof(),
  };
}
