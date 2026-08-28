import { describe, expect, it } from "vitest";

import { closedArenaLaunchState } from "./data.js";
import { buildFoundingCohortViewModel } from "./founding-cohort.js";

function launchStateWithNeutralCrew() {
  const launchState = structuredClone(closedArenaLaunchState);
  launchState.foundingCohort.openings.PLAYER = 13;
  launchState.foundingCohort.openings.COACH = 2;
  launchState.foundingCohort.operationalOfficials.REFEREE = 6;
  launchState.foundingCohort.operationalOfficials.REPLAY_OFFICIAL = 2;
  return launchState;
}

describe("arena founding cohort", () => {
  it("separates participant openings from the staffed neutral crew", () => {
    const cohort = buildFoundingCohortViewModel(launchStateWithNeutralCrew());

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
    expect(cohort.officials).toEqual([
      expect.objectContaining({
        role: "REFEREE",
        ready: 6,
        required: 6,
        status: "Crew ready",
      }),
      expect.objectContaining({
        role: "REPLAY_OFFICIAL",
        ready: 2,
        required: 2,
        status: "Crew ready",
      }),
    ]);
    expect(cohort.officialCrewCopy).toBe(
      "The neutral crew of 6 referees and 2 replay officials is already staffed.",
    );
  });

  it("describes missing operational coverage without opening applicant seats", () => {
    const cohort = buildFoundingCohortViewModel(closedArenaLaunchState);

    expect(cohort.officialCrewReady).toBe(false);
    expect(cohort.officials.map(({ status }) => status)).toEqual([
      "6 posts to fill",
      "2 posts to fill",
    ]);
    expect(cohort.officialCrewCopy).toContain(
      "those roles are not open to participant applications",
    );
  });
});
