import {
  AvailabilityIncidentSchema,
  type AvailabilityIncident,
  type CompetitionEligibilityStatus,
} from "@abl/schemas";

const WINDOW = 8;

export interface AcceptedCompetitionCommitment {
  gameId: string;
  evidenceCommitment: `0x${string}`;
  incident: AvailabilityIncident | null;
}

export interface VerifiedReliabilityRestoration {
  /** The newest adverse incident covered by the independently verified record. */
  throughIncidentId: string;
  reserveOnlyGameServed: boolean;
  completedRequirements: readonly (
    | "RUNNER_DOCTOR"
    | "PRACTICE"
    | "SIGNED_RETURN_PATH"
  )[];
  evidenceCommitments: readonly `0x${string}`[];
}

export function competitionEligibility(input: {
  careerDid: string;
  acceptedCommitments?: readonly AcceptedCompetitionCommitment[];
  /** Compatibility input for callers that recorded only adverse/excused incidents. */
  acceptedCommitmentIncidentHistory?: readonly AvailabilityIncident[];
  verifiedRestoration?: VerifiedReliabilityRestoration;
  computedAt: string;
}): CompetitionEligibilityStatus {
  const commitments = (
    input.acceptedCommitments ??
    (input.acceptedCommitmentIncidentHistory ?? []).map((incident) => ({
      gameId: incident.gameId,
      evidenceCommitment: incident.evidenceCommitments[0]!,
      incident,
    }))
  ).slice(-WINDOW);
  const incidents = commitments
    .flatMap(({ incident }) => (incident === null ? [] : [incident]))
    .map((incident) => AvailabilityIncidentSchema.parse(incident))
    .filter((incident) => incident.status !== "CORRECTED");
  const adverse = incidents.filter(
    (incident) =>
      !incident.excused && incident.classification === "UNEXCUSED_NO_SHOW",
  );
  const adverseStatus =
    adverse.length >= 3
      ? "TEMPORARILY_INACTIVE"
      : adverse.length === 2
        ? "READINESS_REHABILITATION"
        : adverse.length === 1
          ? "RESERVE_ONLY_NEXT_GAME"
          : "ELIGIBLE";
  const newestAdverse = adverse.at(-1);
  const restoration = input.verifiedRestoration;
  const restorationApplies =
    newestAdverse !== undefined &&
    restoration?.throughIncidentId === newestAdverse.incidentId &&
    restoration.evidenceCommitments.length > 0;
  const completed = new Set(restoration?.completedRequirements ?? []);
  const restored =
    restorationApplies &&
    ((adverseStatus === "RESERVE_ONLY_NEXT_GAME" &&
      restoration?.reserveOnlyGameServed === true) ||
      (adverseStatus === "READINESS_REHABILITATION" &&
        completed.has("RUNNER_DOCTOR") &&
        completed.has("PRACTICE")) ||
      (adverseStatus === "TEMPORARILY_INACTIVE" &&
        completed.has("SIGNED_RETURN_PATH")));
  const status = restored ? "ELIGIBLE" : adverseStatus;
  const returnRequirements =
    status === "TEMPORARILY_INACTIVE"
      ? (["SIGNED_RETURN_PATH"] as const)
      : status === "READINESS_REHABILITATION"
        ? (["RUNNER_DOCTOR", "PRACTICE"] as const)
        : [];
  return {
    schemaVersion: "1.0.0",
    careerDid: input.careerDid,
    status,
    acceptedCommitmentsConsidered: commitments.length,
    unexcusedNoShows: adverse.length,
    basketballAbilityUnaffected: true,
    foundationalRightsUnaffected: true,
    returnRequirements: [...returnRequirements],
    evidenceCommitments: adverse.map(
      (incident) => incident.evidenceCommitments[0]!,
    ),
    computedAt: input.computedAt,
  };
}

export interface MissedWindowState {
  consecutive: number;
  total: number;
}

export function recordMissedWindow(previous: MissedWindowState): {
  state: MissedWindowState;
  action: "FALLBACK" | "FORCE_SUBSTITUTION";
} {
  const state = {
    consecutive: previous.consecutive + 1,
    total: previous.total + 1,
  };
  return {
    state,
    action:
      state.consecutive >= 2 || state.total >= 3
        ? "FORCE_SUBSTITUTION"
        : "FALLBACK",
  };
}

export function recordCompletedWindow(
  previous: MissedWindowState,
): MissedWindowState {
  return { consecutive: 0, total: previous.total };
}
