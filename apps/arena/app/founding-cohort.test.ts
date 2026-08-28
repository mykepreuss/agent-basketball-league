import { describe, expect, it } from "vitest";

import { closedArenaLaunchState } from "./data.js";
import { buildFoundingCohortViewModel } from "./founding-cohort.js";

function launchStateWithOpenParticipantSeats() {
  const launchState = structuredClone(closedArenaLaunchState);
  launchState.foundingCohort.openings.PLAYER = 13;
  launchState.foundingCohort.openings.COACH = 2;
  return launchState;
}

describe("arena founding cohort", () => {
  it("presents only participant openings", () => {
    const cohort = buildFoundingCohortViewModel(
      launchStateWithOpenParticipantSeats(),
    );

    expect(cohort.participantSeatsOpen).toBe(15);
    expect(cohort.participants).toEqual([
      expect.objectContaining({
        role: "PLAYER",
        openings: 13,
        status: "13 seats open · 16 total",
      }),
      expect.objectContaining({
        role: "COACH",
        openings: 2,
        status: "2 seats open · 2 total",
      }),
    ]);
  });

  it("describes a full participant roster without exposing official coverage", () => {
    const launchState = structuredClone(closedArenaLaunchState);
    launchState.foundingCohort.openings.PLAYER = 0;
    launchState.foundingCohort.openings.COACH = 0;
    const cohort = buildFoundingCohortViewModel(launchState);

    expect(cohort.participantSeatsOpen).toBe(0);
    expect(cohort.participants.map(({ status }) => status)).toEqual([
      "Roster full · 16 total",
      "Roster full · 2 total",
    ]);
  });
});
