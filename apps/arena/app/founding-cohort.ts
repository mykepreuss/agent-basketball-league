import type { PublicArenaLaunchState } from "./data.js";

const participantRoles = [
  ["Players", "PLAYER"],
  ["Coaches", "COACH"],
] as const;

function participantSeatStatus(openings: number, capacity: number): string {
  if (openings === 0) return `Roster full · ${capacity} total`;
  return `${openings} ${openings === 1 ? "seat" : "seats"} open · ${capacity} total`;
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
  return {
    participantSeatsOpen: participants.reduce(
      (total, { openings }) => total + openings,
      0,
    ),
    participants,
  } as const;
}
