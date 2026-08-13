export type CapacityClass =
  | "GAMES_IN_PROGRESS"
  | "RIGHTS"
  | "GOVERNMENT"
  | "DUE_PROCESS"
  | "EXIT"
  | "CONTINUITY"
  | "MINIMUM_AUTONOMY"
  | "ADMISSIONS"
  | "SPECTATORS";

export const OVERLOAD_PRIORITY: readonly CapacityClass[] = [
  "GAMES_IN_PROGRESS",
  "RIGHTS",
  "GOVERNMENT",
  "DUE_PROCESS",
  "EXIT",
  "CONTINUITY",
  "MINIMUM_AUTONOMY",
  "ADMISSIONS",
  "SPECTATORS",
] as const;

export interface CapacityRequest {
  requestId: string;
  capacityClass: CapacityClass;
  units: number;
}

export function allocateOverload(
  capacityUnits: number,
  requests: readonly CapacityRequest[],
) {
  if (!Number.isInteger(capacityUnits) || capacityUnits < 0)
    throw new Error("Capacity must be a nonnegative integer");
  if (
    new Set(requests.map((request) => request.requestId)).size !==
      requests.length ||
    requests.some(
      (request) => !Number.isInteger(request.units) || request.units < 1,
    )
  )
    throw new Error("Capacity requests are invalid or duplicated");
  let remaining = capacityUnits;
  const allocations: Array<CapacityRequest & { allocated: boolean }> = [];
  for (const capacityClass of OVERLOAD_PRIORITY) {
    for (const request of requests
      .filter((item) => item.capacityClass === capacityClass)
      .sort((left, right) => left.requestId.localeCompare(right.requestId))) {
      const allocated = request.units <= remaining;
      if (allocated) remaining -= request.units;
      allocations.push({ ...request, allocated });
    }
  }
  return { capacityUnits, remaining, allocations };
}

export function exerciseThirtyDayWindDown(input: {
  reserveUnits: number;
  dailyEssentialUnits: number;
  portableExitCount: number;
}) {
  if (
    input.reserveUnits < 0 ||
    input.dailyEssentialUnits < 1 ||
    input.portableExitCount < 0
  )
    throw new Error("Wind-down inputs are invalid");
  const requiredUnits = input.dailyEssentialUnits * 30;
  return {
    days: 30,
    reserveUnits: input.reserveUnits,
    requiredUnits,
    everyDayFunded: input.reserveUnits >= requiredUnits,
    portableExitCount: input.portableExitCount,
    sponsorAuthorityGranted: false as const,
    preservedClasses: OVERLOAD_PRIORITY.slice(0, 7),
    shedFirst: ["SPECTATORS", "ADMISSIONS"] as const,
  };
}
