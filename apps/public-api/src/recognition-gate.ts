export type PublicApiOperatingProfile =
  | "PRE_GENESIS_CLOSED"
  | "PRE_GENESIS_REHEARSAL"
  | "PRODUCTION_V1_PRE_GENESIS"
  | "FOUNDING_SEASON"
  | "PRODUCTION_GENESIS";

export function requiresIndependentlyWitnessedCheckpoints(
  operatingProfile: PublicApiOperatingProfile,
): boolean {
  return operatingProfile === "PRODUCTION_V1_PRE_GENESIS";
}
