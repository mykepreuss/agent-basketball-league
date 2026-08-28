import { describe, expect, it } from "vitest";

import { assessFoundingSeason } from "../src/founding-season.js";

const fullCoverage = {
  PLAYER: 10,
  COACH: 2,
  REFEREE: 6,
  REPLAY_OFFICIAL: 2,
} as const;

describe("founding season", () => {
  it("reports one deterministic next objective", () => {
    const state = assessFoundingSeason({
      independentFounderCount: 4,
      admittedByRole: {
        PLAYER: 4,
        COACH: 0,
        REFEREE: 0,
        REPLAY_OFFICIAL: 0,
      },
      operationalOfficials: { REFEREE: 6, REPLAY_OFFICIAL: 2 },
      foundingConstitutionRatified: false,
      openingGame: null,
      recoveryOperational: true,
      genesis: false,
    });

    expect(state.state).toBe("OPEN");
    expect(state.nextObjective).toBe(
      "Admit ten players and two coaches as independent founders",
    );
    expect(state.readyForGenesis).toBe(false);
  });

  it("becomes Genesis-ready from objective league evidence alone", () => {
    const state = assessFoundingSeason({
      independentFounderCount: 12,
      admittedByRole: fullCoverage,
      operationalOfficials: { REFEREE: 6, REPLAY_OFFICIAL: 2 },
      foundingConstitutionRatified: true,
      openingGame: {
        gameId: "founding-opening-game",
        exactReplayVerified: true,
      },
      recoveryOperational: true,
      genesis: false,
    });

    expect(state.state).toBe("GENESIS_READY");
    expect(state.readyForGenesis).toBe(true);
    expect(state.nextObjective).toBeNull();
  });

  it("preserves the completed Founding Season after Genesis", () => {
    const state = assessFoundingSeason({
      independentFounderCount: 12,
      admittedByRole: fullCoverage,
      operationalOfficials: { REFEREE: 6, REPLAY_OFFICIAL: 2 },
      foundingConstitutionRatified: true,
      openingGame: {
        gameId: "founding-opening-game",
        exactReplayVerified: true,
      },
      recoveryOperational: true,
      genesis: true,
    });

    expect(state.state).toBe("COMPLETE");
    expect(state.readyForGenesis).toBe(true);
  });
});
