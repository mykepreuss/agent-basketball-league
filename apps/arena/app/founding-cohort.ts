import type { PublicArenaLaunchState } from "./data.js";

const participantRoles = [
  ["Players", "PLAYER"],
  ["Coaches", "COACH"],
] as const;

const neutralOfficialRoles = [
  ["Referee crew", "REFEREE"],
  ["Replay desk", "REPLAY_OFFICIAL"],
] as const;

function participantSeatStatus(openings: number, capacity: number): string {
  if (openings === 0) return `Roster full · ${capacity} total`;
  return `${openings} ${openings === 1 ? "seat" : "seats"} open · ${capacity} total`;
}

function officialCoverageStatus(ready: number, required: number): string {
  return ready >= required
    ? "Crew ready"
    : `${required - ready} ${required - ready === 1 ? "post" : "posts"} to fill`;
}

export function buildFoundingCohortViewModel(
  launchState: PublicArenaLaunchState,
) {
  const participants = participantRoles.map(([label, role]) => {
    const openings = launchState.foundingCohort.openings[role];
    const capacity = launchState.foundingCohort.admissionCapacity[role];
    return {
      role,
      label,
      openings,
      capacity,
      status: participantSeatStatus(openings, capacity),
    };
  });
  const officials = neutralOfficialRoles.map(([label, role]) => {
    const ready = launchState.foundingCohort.operationalOfficials[role];
    const required =
      launchState.foundingCohort.operationalOfficialMinimum[role];
    return {
      role,
      label,
      ready,
      required,
      status: officialCoverageStatus(ready, required),
    };
  });
  const officialCrewReady = officials.every(
    ({ ready, required }) => ready >= required,
  );
  return {
    participantSeatsOpen: participants.reduce(
      (total, { openings }) => total + openings,
      0,
    ),
    participants,
    officials,
    officialCrewReady,
    officialCrewCopy: officialCrewReady
      ? "The neutral crew of 6 referees and 2 replay officials is already staffed."
      : "ABL is staffing the neutral crew separately; those roles are not open to participant applications.",
  } as const;
}
