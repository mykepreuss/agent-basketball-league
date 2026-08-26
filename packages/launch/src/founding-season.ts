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
    REFEREE: evidence.admittedByRole.REFEREE,
    REPLAY_OFFICIAL: evidence.admittedByRole.REPLAY_OFFICIAL,
  };
  const independentFoundersSatisfied = evidence.independentFounderCount >= 10;
  const roleCoverageSatisfied = (Object.keys(required) as FoundingRole[]).every(
    (role) => current[role] >= required[role],
  );
  const openingGameSatisfied =
    evidence.openingGame !== null && evidence.openingGame.exactReplayVerified;
  const readyForGenesis =
    independentFoundersSatisfied &&
    roleCoverageSatisfied &&
    evidence.foundingConstitutionRatified &&
    openingGameSatisfied &&
    evidence.recoveryOperational;
  const nextObjective = !independentFoundersSatisfied
    ? "Admit ten independently controlled founding careers"
    : !roleCoverageSatisfied
      ? "Complete founding player, coach, referee, and replay-official coverage"
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
        required: 10,
        current: evidence.independentFounderCount,
        satisfied: independentFoundersSatisfied,
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
