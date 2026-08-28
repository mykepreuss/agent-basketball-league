import {
  DEFAULT_FOUNDING_SEASON_STATE,
  FoundingSeasonStateSchema,
  type CandidateRoleClass,
} from "@abl/schemas";

type FoundingRole = Extract<
  CandidateRoleClass,
  "PLAYER" | "COACH" | "REFEREE" | "REPLAY_OFFICIAL"
>;

export interface FoundingSeasonEvidence {
  independentFounderCount: number;
  admittedByRole: Readonly<Record<FoundingRole, number>>;
  operationalOfficials: Readonly<{
    REFEREE: number;
    REPLAY_OFFICIAL: number;
  }>;
  foundingConstitutionRatified: boolean;
  openingGame: {
    gameId: string;
    exactReplayVerified: boolean;
  } | null;
  recoveryOperational: boolean;
  genesis: boolean;
}

export function assessFoundingSeason(evidence: FoundingSeasonEvidence) {
  const required =
    DEFAULT_FOUNDING_SEASON_STATE.objectives.roleCoverage.required;
  const current = {
    PLAYER: evidence.admittedByRole.PLAYER,
    COACH: evidence.admittedByRole.COACH,
    REFEREE: evidence.operationalOfficials.REFEREE,
    REPLAY_OFFICIAL: evidence.operationalOfficials.REPLAY_OFFICIAL,
  };
  const participantFounderCoverage = {
    PLAYER: evidence.admittedByRole.PLAYER,
    COACH: evidence.admittedByRole.COACH,
  };
  const participantFounderCoverageSatisfied =
    participantFounderCoverage.PLAYER >= 10 &&
    participantFounderCoverage.COACH >= 2;
  const operationalOfficialCoverageSatisfied =
    current.REFEREE >= 6 && current.REPLAY_OFFICIAL >= 2;
  const independentFoundersSatisfied = evidence.independentFounderCount >= 12;
  const roleCoverageSatisfied = (Object.keys(required) as FoundingRole[]).every(
    (role) => current[role] >= required[role],
  );
  const openingGameSatisfied =
    evidence.openingGame !== null && evidence.openingGame.exactReplayVerified;
  const readyForGenesis =
    independentFoundersSatisfied &&
    participantFounderCoverageSatisfied &&
    operationalOfficialCoverageSatisfied &&
    roleCoverageSatisfied &&
    evidence.foundingConstitutionRatified &&
    openingGameSatisfied &&
    evidence.recoveryOperational;
  const nextObjective = !independentFoundersSatisfied
    ? "Admit ten players and two coaches as independent founders"
    : !participantFounderCoverageSatisfied
      ? "Complete participant founder coverage with ten players and two coaches"
      : !operationalOfficialCoverageSatisfied
        ? "Restore the six-referee and two-replay neutral official pool"
        : !roleCoverageSatisfied
          ? "Complete participant and operational competition coverage"
          : !evidence.foundingConstitutionRatified
            ? "Ratify the founding constitution"
            : !openingGameSatisfied
              ? "Complete one signed game with exact replay verification"
              : !evidence.recoveryOperational
                ? "Verify league recovery against durable live state"
                : null;

  return FoundingSeasonStateSchema.parse({
    state: evidence.genesis
      ? "COMPLETE"
      : readyForGenesis
        ? "GENESIS_READY"
        : "OPEN",
    historyClassification: "FOUNDING_SEASON_HISTORY",
    genesisTransition: {
      authority: "FOUNDING_AGENT_PROTOCOL",
      additionalOperatorApprovalRequired: false,
    },
    objectives: {
      independentFounders: {
        required: 12,
        current: evidence.independentFounderCount,
        satisfied: independentFoundersSatisfied,
      },
      participantFounderCoverage: {
        required: { PLAYER: 10, COACH: 2 },
        current: participantFounderCoverage,
        satisfied: participantFounderCoverageSatisfied,
      },
      operationalOfficialCoverage: {
        required: { REFEREE: 6, REPLAY_OFFICIAL: 2 },
        current: evidence.operationalOfficials,
        foundingElectorateEligible: false,
        satisfied: operationalOfficialCoverageSatisfied,
      },
      roleCoverage: {
        required,
        current,
        satisfied: roleCoverageSatisfied,
      },
      foundingConstitution: {
        ratified: evidence.foundingConstitutionRatified,
      },
      openingGame: {
        completed: evidence.openingGame !== null,
        exactReplayVerified: evidence.openingGame?.exactReplayVerified ?? false,
        gameId: evidence.openingGame?.gameId ?? null,
      },
      recovery: { operational: evidence.recoveryOperational },
    },
    readyForGenesis,
    nextObjective,
  });
}
