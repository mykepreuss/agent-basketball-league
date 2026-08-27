import {
  evaluateFoundingPregame,
  recordCompletedWindow,
  recordMissedWindow,
} from "@abl/cognition";
import {
  AgentPlayedPossessionEvidenceSchema,
  FullGameInputSchema,
  GameCommandSchema,
  PlayerStateSchema,
  replayFullGame,
} from "@abl/basketball";
import { sha256Commitment } from "@abl/recognition";
import {
  AvailabilityIncidentSchema,
  BASKETBALL_POSITIONS,
  BasketballPositionSchema,
  LineupPositionAssignmentSchema,
  PlayerPositionProfileSchema,
  type LineupPositionAssignment,
} from "@abl/schemas";
import { z } from "zod";

const RoleSchema = z.enum(["PLAYER", "COACH", "REFEREE", "REPLAY"]);
const TeamSchema = z.enum(["HOME", "AWAY"]);
const MissStateSchema = z.strictObject({
  consecutive: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const CompetitionParticipantSchema = z.strictObject({
  careerDid: z.string().startsWith("did:"),
  role: RoleSchema,
  team: TeamSchema.nullable(),
  signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  accepted: z.boolean(),
  ready: z.boolean(),
  active: z.boolean(),
  alternate: z.boolean(),
  positionProfile: PlayerPositionProfileSchema.nullable().default(null),
  currentPosition: BasketballPositionSchema.nullable().default(null),
  eligibilityStatus: z
    .enum([
      "ELIGIBLE",
      "RESERVE_ONLY_NEXT_GAME",
      "READINESS_REHABILITATION",
      "TEMPORARILY_INACTIVE",
    ])
    .default("ELIGIBLE"),
  missState: MissStateSchema,
  participation: z
    .strictObject({
      response: z.enum(["ACCEPT", "DECLINE", "REFUSE"]),
      responseCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
      respondedAt: z.iso.datetime({ offset: true }),
    })
    .nullable(),
  readinessLease: z
    .strictObject({
      leaseId: z.uuid(),
      runnerId: z.string().min(1).max(160),
      state: z.enum(["READY", "ON_DEMAND_ONLY", "OFFLINE", "REVOKED"]),
      heartbeatCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
      issuedAt: z.iso.datetime({ offset: true }),
      expiresAt: z.iso.datetime({ offset: true }),
      sourceEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    })
    .nullable(),
});
export type CompetitionParticipant = z.infer<
  typeof CompetitionParticipantSchema
>;

const LineupSubmissionBaseSchema = {
  gameId: z.string().min(1).max(200),
  coachDid: z.string().startsWith("did:"),
  team: TeamSchema,
  orderedBench: z.array(z.string().startsWith("did:")).max(3),
  submittedAt: z.iso.datetime({ offset: true }),
  signature: z.string().regex(/^0x[0-9a-f]{130}$/),
} as const;

export const LegacyLineupSubmissionSchema = z.strictObject({
  ...LineupSubmissionBaseSchema,
  activeFive: z.array(z.string().startsWith("did:")).length(5),
});

export const PositionedLineupSubmissionSchema = z.strictObject({
  ...LineupSubmissionBaseSchema,
  schemaVersion: z.literal(2),
  assignments: z.array(LineupPositionAssignmentSchema).length(5),
});

export const LineupSubmissionSchema = z.union([
  PositionedLineupSubmissionSchema,
  LegacyLineupSubmissionSchema,
]);
export type LineupSubmission = z.infer<typeof LineupSubmissionSchema>;

export const PositionedSubstitutionSubmissionSchema = z.strictObject({
  schemaVersion: z.literal(2),
  gameId: z.string().min(1).max(200),
  coachDid: z.string().startsWith("did:"),
  team: TeamSchema,
  outCareerDid: z.string().startsWith("did:"),
  inCareerDid: z.string().startsWith("did:"),
  assignments: z.array(LineupPositionAssignmentSchema).length(5),
  submittedAt: z.iso.datetime({ offset: true }),
  signature: z.string().regex(/^0x[0-9a-f]{130}$/),
});
export type PositionedSubstitutionSubmission = z.infer<
  typeof PositionedSubstitutionSubmissionSchema
>;

function canonicalizePositionAssignments(
  assignments: readonly LineupPositionAssignment[],
): LineupPositionAssignment[] {
  const positions = assignments.map(({ position }) => position);
  const careers = assignments.map(({ careerDid }) => careerDid);
  if (
    new Set(positions).size !== BASKETBALL_POSITIONS.length ||
    !BASKETBALL_POSITIONS.every((position) => positions.includes(position)) ||
    new Set(careers).size !== BASKETBALL_POSITIONS.length
  )
    throw new Error(
      "A lineup must assign one distinct career to every position",
    );
  const byPosition = new Map(
    assignments.map((assignment) => [assignment.position, assignment]),
  );
  return BASKETBALL_POSITIONS.map((position) => byPosition.get(position)!);
}

export function resolveLineupAssignments(
  lineup: LineupSubmission,
): LineupPositionAssignment[] {
  return canonicalizePositionAssignments(
    "assignments" in lineup
      ? lineup.assignments
      : BASKETBALL_POSITIONS.map((position, index) => ({
          position,
          careerDid: lineup.activeFive[index]!,
        })),
  );
}

export const FoundingGameRuntimeSchema = z.strictObject({
  input: FullGameInputSchema,
  commands: z.array(GameCommandSchema).max(10_000),
  playerCareerDids: z.record(
    z.string().min(1).max(100),
    z.string().startsWith("did:"),
  ),
  playerStates: z.array(PlayerStateSchema).length(10),
  possessionProofs: z.array(AgentPlayedPossessionEvidenceSchema).max(1_000),
  fullGameProof: z.strictObject({
    finalStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
    eventMerkleRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
    finalEventHash: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/)
      .nullable(),
    winner: TeamSchema.nullable(),
  }),
  phase: z.enum(["LIVE", "DEAD", "FINAL"]),
});
export type FoundingGameRuntime = z.infer<typeof FoundingGameRuntimeSchema>;

export const ScheduledGameStateSchema = z.strictObject({
  version: z.number().int().positive(),
  gameId: z.string().min(1).max(200),
  state: z.enum([
    "SCHEDULED",
    "COMMITMENTS_OPEN",
    "LINEUPS_LOCKED",
    "READY",
    "IN_PROGRESS",
    "FINALIZING",
    "SUSPENDED",
    "POSTPONED",
    "COMPLETED",
  ]),
  scheduledTipoffAt: z.iso.datetime({ offset: true }),
  responseDueAt: z.iso.datetime({ offset: true }),
  lineupLocksAt: z.iso.datetime({ offset: true }),
  readinessCheckedAt: z.iso.datetime({ offset: true }),
  careerResources: z.record(
    z.string().startsWith("did:"),
    z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  ),
  participants: z.array(CompetitionParticipantSchema).length(26),
  lineups: z.strictObject({
    HOME: LineupSubmissionSchema.nullable(),
    AWAY: LineupSubmissionSchema.nullable(),
  }),
  suspension: z
    .strictObject({
      reason: z.string().min(1).max(200),
      suspendedAt: z.iso.datetime({ offset: true }),
      resumableAt: z.iso.datetime({ offset: true }),
      exactStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
    })
    .nullable(),
  conductorLease: z
    .strictObject({
      stepId: z.string().min(1).max(240),
      kind: z.enum(["POSSESSION", "FINALIZATION"]),
      sequence: z.number().int().positive(),
      reservedAt: z.iso.datetime({ offset: true }),
      expiresAt: z.iso.datetime({ offset: true }),
      attempt: z.number().int().positive(),
    })
    .nullable()
    .default(null),
  lastConductorErrorCommitment: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable()
    .default(null),
  completedActivationCommitments: z
    .array(z.string().regex(/^0x[0-9a-f]{64}$/))
    .default([]),
  activationOutcomes: z
    .array(
      z.strictObject({
        activationId: z.string().min(1).max(200),
        careerDid: z.string().startsWith("did:"),
        completed: z.boolean(),
        activationCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
        recordedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .default([]),
  pendingSubstitutions: z
    .array(
      z.strictObject({
        outCareerDid: z.string().startsWith("did:"),
        inCareerDid: z.string().startsWith("did:"),
        role: RoleSchema,
        team: TeamSchema.nullable(),
        position: BasketballPositionSchema.nullable().default(null),
        triggeredAt: z.iso.datetime({ offset: true }),
      }),
    )
    .default([]),
  availabilityIncidents: z.array(AvailabilityIncidentSchema).default([]),
  completedPossessions: z
    .array(
      z.strictObject({
        sequence: z.number().int().positive(),
        possessionId: z.string().min(1).max(200),
        authoritativeStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
        eventMerkleRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
        canonicalEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
        recordedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .default([]),
  finalization: z
    .strictObject({
      gameBundleCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
      liveStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
      replayStateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
      finalizedEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
      finalizedAt: z.iso.datetime({ offset: true }),
    })
    .nullable()
    .default(null),
  basketballRuntime: FoundingGameRuntimeSchema.nullable().default(null),
  updatedAt: z.iso.datetime({ offset: true }),
  stateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
});
export type ScheduledGameState = z.infer<typeof ScheduledGameStateSchema>;

function withRoot(
  state: Omit<ScheduledGameState, "stateRoot"> | ScheduledGameState,
): ScheduledGameState {
  const { stateRoot: _previousStateRoot, ...base } =
    state as ScheduledGameState;
  return ScheduledGameStateSchema.parse({
    ...base,
    stateRoot: sha256Commitment(base),
  });
}

function positionProfileMatchesCommitment(
  participant: CompetitionParticipant,
): boolean {
  const profile = participant.positionProfile;
  return (
    profile !== null &&
    profile.profileCommitment ===
      sha256Commitment({
        primaryPosition: profile.primaryPosition,
        ...(profile.positionPreferenceRanking === undefined
          ? {}
          : {
              positionPreferenceRanking: profile.positionPreferenceRanking,
            }),
        eligiblePositions: profile.eligiblePositions,
      })
  );
}

export function findLegalPositionAssignment(
  players: readonly CompetitionParticipant[],
): LineupPositionAssignment[] | null {
  if (
    players.some(
      (player) =>
        player.role !== "PLAYER" || !positionProfileMatchesCommitment(player),
    )
  )
    return null;
  const candidates = [...players].sort((left, right) =>
    left.careerDid.localeCompare(right.careerDid),
  );
  const assignments: LineupPositionAssignment[] = [];
  const used = new Set<string>();
  const search = (index: number): boolean => {
    if (index === BASKETBALL_POSITIONS.length) return true;
    const position = BASKETBALL_POSITIONS[index]!;
    const eligible = candidates
      .filter(
        (candidate) =>
          !used.has(candidate.careerDid) &&
          candidate.positionProfile!.eligiblePositions.includes(position),
      )
      .sort((left, right) => {
        const primaryDifference =
          Number(right.positionProfile!.primaryPosition === position) -
          Number(left.positionProfile!.primaryPosition === position);
        return (
          primaryDifference ||
          left.positionProfile!.eligiblePositions.length -
            right.positionProfile!.eligiblePositions.length ||
          left.careerDid.localeCompare(right.careerDid)
        );
      });
    for (const candidate of eligible) {
      used.add(candidate.careerDid);
      assignments.push({ position, careerDid: candidate.careerDid });
      if (search(index + 1)) return true;
      assignments.pop();
      used.delete(candidate.careerDid);
    }
    return false;
  };
  return search(0) ? assignments : null;
}

function validateFoundingRoster(
  participants: readonly CompetitionParticipant[],
) {
  const count = (role: CompetitionParticipant["role"]) =>
    participants.filter((participant) => participant.role === role).length;
  if (
    count("PLAYER") !== 16 ||
    count("COACH") !== 2 ||
    count("REFEREE") !== 6 ||
    count("REPLAY") !== 2 ||
    participants.filter(
      ({ role, team }) => role === "PLAYER" && team === "HOME",
    ).length !== 8 ||
    participants.filter(
      ({ role, team }) => role === "PLAYER" && team === "AWAY",
    ).length !== 8
  )
    throw new Error(
      "Founding Exhibition requires 16 players, 2 coaches, 6 referees, and 2 replay officials",
    );
  if (new Set(participants.map(({ careerDid }) => careerDid)).size !== 26)
    throw new Error("Founding Exhibition careers must be unique");
  if (
    (["HOME", "AWAY"] as const).some(
      (team) =>
        participants.filter(
          (participant) =>
            participant.role === "COACH" && participant.team === team,
        ).length !== 1,
    ) ||
    participants.some(
      (participant) =>
        (["PLAYER", "COACH"].includes(participant.role) &&
          participant.team === null) ||
        (["REFEREE", "REPLAY"].includes(participant.role) &&
          participant.team !== null) ||
        (participant.role !== "PLAYER" &&
          (participant.positionProfile !== null ||
            participant.currentPosition !== null)),
    )
  )
    throw new Error(
      "Founding Exhibition team, official, and position assignments are invalid",
    );
  if (
    participants.some(({ eligibilityStatus }) =>
      ["READINESS_REHABILITATION", "TEMPORARILY_INACTIVE"].includes(
        eligibilityStatus,
      ),
    )
  )
    throw new Error(
      "Ineligible careers cannot enter a Founding Exhibition roster",
    );
  for (const team of ["HOME", "AWAY"] as const) {
    const players = participants.filter(
      (participant) =>
        participant.role === "PLAYER" && participant.team === team,
    );
    if (findLegalPositionAssignment(players) === null)
      throw new Error(
        `${team} roster cannot field one eligible PG, SG, SF, PF, and C`,
      );
  }
}

export function createScheduledGame(input: {
  gameId: string;
  scheduledTipoffAt: string;
  participants: readonly CompetitionParticipant[];
  careerResources: Readonly<Record<string, string>>;
  now: string;
}): ScheduledGameState {
  validateFoundingRoster(input.participants);
  const tipoff = Date.parse(input.scheduledTipoffAt);
  if (
    !Number.isFinite(tipoff) ||
    tipoff - Date.parse(input.now) < 24 * 60 * 60_000
  )
    throw new Error(
      "Founding Exhibition notice must precede tipoff by 24 hours",
    );
  const scheduledCareers = input.participants
    .map(({ careerDid }) => careerDid)
    .sort();
  if (
    JSON.stringify(Object.keys(input.careerResources).sort()) !==
    JSON.stringify(scheduledCareers)
  )
    throw new Error("Every scheduled career requires one exact Sandbox");
  if (
    new Set(Object.values(input.careerResources)).size !==
    scheduledCareers.length
  )
    throw new Error("Every scheduled career requires a distinct Sandbox");
  return withRoot({
    version: 1,
    gameId: input.gameId,
    state: "COMMITMENTS_OPEN",
    scheduledTipoffAt: input.scheduledTipoffAt,
    responseDueAt: new Date(tipoff - 6 * 60 * 60_000).toISOString(),
    lineupLocksAt: new Date(tipoff - 15 * 60_000).toISOString(),
    readinessCheckedAt: new Date(tipoff - 5 * 60_000).toISOString(),
    careerResources: { ...input.careerResources },
    participants: input.participants.map((participant) =>
      CompetitionParticipantSchema.parse(participant),
    ),
    lineups: { HOME: null, AWAY: null },
    suspension: null,
    conductorLease: null,
    lastConductorErrorCommitment: null,
    completedActivationCommitments: [],
    activationOutcomes: [],
    pendingSubstitutions: [],
    availabilityIncidents: [],
    completedPossessions: [],
    finalization: null,
    basketballRuntime: null,
    updatedAt: input.now,
  });
}

export function reserveConductorStep(input: {
  game: ScheduledGameState;
  reservedAt: string;
  leaseMs?: number;
}): ScheduledGameState {
  if (input.game.state !== "IN_PROGRESS" && input.game.state !== "FINALIZING")
    throw new Error("Only an active game can reserve a conductor step");
  const reservedAt = Date.parse(input.reservedAt);
  if (!Number.isFinite(reservedAt))
    throw new Error("Conductor reservation timestamp is invalid");
  const current = input.game.conductorLease;
  if (current !== null && Date.parse(current.expiresAt) > reservedAt)
    throw new Error("Another director owns the current game step");
  const kind =
    input.game.basketballRuntime?.phase === "FINAL"
      ? ("FINALIZATION" as const)
      : ("POSSESSION" as const);
  const sequence =
    kind === "FINALIZATION"
      ? input.game.completedPossessions.length
      : input.game.completedPossessions.length + 1;
  if (sequence < 1)
    throw new Error("Finalization requires at least one possession");
  const stepId = `${input.game.gameId}:${kind.toLowerCase()}:${sequence}`;
  const attempt = current?.stepId === stepId ? current.attempt + 1 : 1;
  const stepStartedAt =
    current?.stepId === stepId ? current.reservedAt : input.reservedAt;
  const leaseMs = input.leaseMs ?? 120_000;
  if (!Number.isInteger(leaseMs) || leaseMs < 20_000 || leaseMs > 120_000)
    throw new Error("Conductor lease must cover one bounded activation step");
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    conductorLease: {
      stepId,
      kind,
      sequence,
      reservedAt: stepStartedAt,
      expiresAt: new Date(reservedAt + leaseMs).toISOString(),
      attempt,
    },
    lastConductorErrorCommitment: null,
    updatedAt: input.reservedAt,
    stateRoot: undefined as never,
  });
}

export function failConductorStep(input: {
  game: ScheduledGameState;
  stepId: string;
  failedAt: string;
  errorCommitment: `0x${string}`;
}): ScheduledGameState {
  if (input.game.conductorLease?.stepId !== input.stepId)
    throw new Error("Conductor failure is bound to another step");
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    conductorLease: {
      ...input.game.conductorLease,
      expiresAt: input.failedAt,
    },
    lastConductorErrorCommitment: input.errorCommitment,
    updatedAt: input.failedAt,
    stateRoot: undefined as never,
  });
}

function applyPendingSubstitutions(
  game: ScheduledGameState,
  basketballPhase: FoundingGameRuntime["phase"],
): ScheduledGameState {
  if (game.state === "SUSPENDED" || game.pendingSubstitutions.length === 0)
    return game;
  const remaining: ScheduledGameState["pendingSubstitutions"] = [];
  let participants = game.participants;
  for (const pending of game.pendingSubstitutions) {
    if (pending.role === "PLAYER" && basketballPhase === "LIVE") {
      remaining.push(pending);
      continue;
    }
    const outgoing = participants.find(
      ({ careerDid }) => careerDid === pending.outCareerDid,
    );
    const incoming = participants.find(
      ({ careerDid }) => careerDid === pending.inCareerDid,
    );
    if (outgoing === undefined || incoming === undefined)
      throw new Error("Pending substitution references an unknown career");
    if (!outgoing.active && incoming.active) continue;
    if (!outgoing.active || incoming.active || !incoming.ready)
      throw new Error("Pending substitution is no longer legal");
    if (
      pending.role === "PLAYER" &&
      (pending.position === null ||
        outgoing.currentPosition !== pending.position ||
        incoming.positionProfile === null ||
        !positionProfileMatchesCommitment(incoming) ||
        !incoming.positionProfile.eligiblePositions.includes(pending.position))
    )
      throw new Error(
        "Pending player substitution would leave an illegal position",
      );
    participants = participants.map((participant) =>
      participant.careerDid === outgoing.careerDid
        ? {
            ...participant,
            active: false,
            alternate: true,
            ready: false,
            currentPosition: null,
          }
        : participant.careerDid === incoming.careerDid
          ? {
              ...participant,
              active: true,
              alternate: false,
              currentPosition: pending.position,
            }
          : participant,
    );
  }
  return withRoot({
    ...game,
    participants,
    pendingSubstitutions: remaining,
    stateRoot: undefined as never,
  });
}

export function recordConductedPossession(input: {
  game: ScheduledGameState;
  stepId: string;
  possessionId: string;
  authoritativeStateRoot: `0x${string}`;
  eventMerkleRoot: `0x${string}`;
  canonicalEventHash: `0x${string}`;
  recordedAt: string;
  basketballRuntime: FoundingGameRuntime;
  activationOutcomes: ReadonlyArray<{
    activationId: string;
    careerDid: string;
    completed: boolean;
    activationCommitment: `0x${string}`;
    recordedAt: string;
  }>;
}): ScheduledGameState {
  const lease = input.game.conductorLease;
  if (lease === null || lease.stepId !== input.stepId)
    throw new Error("Possession result is bound to another conductor step");
  const runtime = FoundingGameRuntimeSchema.parse(input.basketballRuntime);
  if (runtime.input.gameId !== input.game.gameId)
    throw new Error("Basketball runtime is bound to another game");
  const previousRuntime = input.game.basketballRuntime;
  if (
    previousRuntime !== null &&
    (sha256Commitment(runtime.input) !==
      sha256Commitment(previousRuntime.input) ||
      sha256Commitment(runtime.playerCareerDids) !==
        sha256Commitment(previousRuntime.playerCareerDids) ||
      sha256Commitment(
        runtime.commands.slice(0, previousRuntime.commands.length),
      ) !== sha256Commitment(previousRuntime.commands))
  )
    throw new Error("Basketball runtime rewrites durable game history");
  const replay = replayFullGame(runtime.input, runtime.commands, {
    ...runtime.fullGameProof,
    finalStateRoot: runtime.fullGameProof.finalStateRoot as `0x${string}`,
    eventMerkleRoot: runtime.fullGameProof.eventMerkleRoot as `0x${string}`,
    finalEventHash: runtime.fullGameProof.finalEventHash as
      | `0x${string}`
      | null,
  });
  if (!replay.exact || replay.state.phase !== runtime.phase)
    throw new Error("Basketball runtime does not replay exactly");
  const latestProof = runtime.possessionProofs.at(-1);
  if (
    latestProof?.possessionId !== input.possessionId ||
    latestProof.finalStateRoot !== input.authoritativeStateRoot ||
    latestProof.eventMerkleRoot !== input.eventMerkleRoot
  )
    throw new Error(
      "Basketball runtime omits the authoritative possession proof",
    );
  const checkpointed = recordPossessionResolution({
    game: input.game,
    sequence: lease.sequence,
    possessionId: input.possessionId,
    authoritativeStateRoot: input.authoritativeStateRoot,
    eventMerkleRoot: input.eventMerkleRoot,
    canonicalEventHash: input.canonicalEventHash,
    recordedAt: input.recordedAt,
  });
  const availability = recordActivationBatch({
    game: checkpointed,
    outcomes: input.activationOutcomes,
  });
  const settledAvailability = applyPendingSubstitutions(
    availability,
    runtime.phase,
  );
  return withRoot({
    ...settledAvailability,
    version: input.game.version + 1,
    state: runtime.phase === "FINAL" ? "FINALIZING" : settledAvailability.state,
    conductorLease: null,
    lastConductorErrorCommitment: null,
    basketballRuntime: runtime,
    finalization: null,
    stateRoot: undefined as never,
  });
}

export function recordParticipation(input: {
  game: ScheduledGameState;
  careerDid: string;
  response: "ACCEPT" | "DECLINE" | "REFUSE";
  respondedAt: string;
  responseCommitment?: `0x${string}`;
}): ScheduledGameState {
  if (Date.parse(input.respondedAt) > Date.parse(input.game.responseDueAt))
    throw new Error("Participation response arrived after T-6 hours");
  const participants = input.game.participants.map((participant) =>
    participant.careerDid === input.careerDid
      ? {
          ...participant,
          accepted: input.response === "ACCEPT",
          participation: {
            response: input.response,
            responseCommitment:
              input.responseCommitment ?? sha256Commitment(input),
            respondedAt: input.respondedAt,
          },
        }
      : participant,
  );
  if (!participants.some(({ careerDid }) => careerDid === input.careerDid))
    throw new Error("Career is not scheduled for this game");
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    participants,
    updatedAt: input.respondedAt,
    stateRoot: undefined as never,
  });
}

export function lockLineup(input: {
  game: ScheduledGameState;
  lineup: z.infer<typeof LineupSubmissionSchema>;
}): ScheduledGameState {
  const lineup = LineupSubmissionSchema.parse(input.lineup);
  if (lineup.gameId !== input.game.gameId)
    throw new Error("Lineup is bound to another game");
  if (Date.parse(lineup.submittedAt) > Date.parse(input.game.lineupLocksAt))
    throw new Error("Lineup arrived after T-15 minutes");
  if (Date.parse(lineup.submittedAt) < Date.parse(input.game.updatedAt))
    throw new Error("Lineup predates the current game state");
  const eligible = input.game.participants.filter(
    ({ role, team, accepted }) =>
      role === "PLAYER" && team === lineup.team && accepted,
  );
  const assignments = resolveLineupAssignments(lineup);
  const activeFive = assignments.map(({ careerDid }) => careerDid);
  const ordered = [...activeFive, ...lineup.orderedBench];
  if (
    new Set(ordered).size !== ordered.length ||
    ordered.some(
      (careerDid) =>
        !eligible.some((participant) => participant.careerDid === careerDid),
    )
  )
    throw new Error(
      "Lineup must contain five accepted starters and up to three accepted reserves once",
    );
  for (const { position, careerDid } of assignments) {
    const player = eligible.find(
      (participant) => participant.careerDid === careerDid,
    );
    if (
      player === undefined ||
      player.positionProfile === null ||
      !positionProfileMatchesCommitment(player) ||
      !player.positionProfile.eligiblePositions.includes(position)
    )
      throw new Error(
        `${careerDid} is not career-profile eligible to play ${position}`,
      );
  }
  if (
    activeFive.some(
      (careerDid) =>
        eligible.find((participant) => participant.careerDid === careerDid)
          ?.eligibilityStatus === "RESERVE_ONLY_NEXT_GAME",
    )
  )
    throw new Error("Reserve-only careers cannot start the next game");
  const participants = input.game.participants.map((participant) =>
    participant.role === "PLAYER" && participant.team === lineup.team
      ? {
          ...participant,
          active: activeFive.includes(participant.careerDid),
          alternate: lineup.orderedBench.includes(participant.careerDid),
          currentPosition:
            assignments.find(
              ({ careerDid }) => careerDid === participant.careerDid,
            )?.position ?? null,
        }
      : participant,
  );
  const lineups = { ...input.game.lineups, [lineup.team]: lineup };
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    state:
      lineups.HOME !== null && lineups.AWAY !== null
        ? "LINEUPS_LOCKED"
        : input.game.state,
    participants,
    lineups,
    updatedAt: lineup.submittedAt,
    stateRoot: undefined as never,
  });
}

export function applyCoachSubstitution(input: {
  game: ScheduledGameState;
  substitution: PositionedSubstitutionSubmission;
}): ScheduledGameState {
  const substitution = PositionedSubstitutionSubmissionSchema.parse(
    input.substitution,
  );
  if (substitution.gameId !== input.game.gameId)
    throw new Error("Substitution is bound to another game");
  if (
    input.game.state !== "IN_PROGRESS" ||
    input.game.basketballRuntime?.phase === "LIVE"
  )
    throw new Error("Coach substitutions require an in-progress dead ball");
  if (Date.parse(substitution.submittedAt) < Date.parse(input.game.updatedAt))
    throw new Error("Substitution predates the current game state");
  const outgoing = input.game.participants.find(
    (participant) =>
      participant.careerDid === substitution.outCareerDid &&
      participant.role === "PLAYER" &&
      participant.team === substitution.team,
  );
  const incoming = input.game.participants.find(
    (participant) =>
      participant.careerDid === substitution.inCareerDid &&
      participant.role === "PLAYER" &&
      participant.team === substitution.team,
  );
  if (
    outgoing === undefined ||
    incoming === undefined ||
    !outgoing.active ||
    incoming.active ||
    !incoming.accepted ||
    !incoming.ready ||
    !incoming.alternate
  )
    throw new Error("Substitution participants are not legally available");
  const assignments = canonicalizePositionAssignments(substitution.assignments);
  const expectedCareers = input.game.participants
    .filter(
      (participant) =>
        participant.role === "PLAYER" &&
        participant.team === substitution.team &&
        participant.active &&
        participant.careerDid !== outgoing.careerDid,
    )
    .map(({ careerDid }) => careerDid)
    .concat(incoming.careerDid)
    .sort();
  if (
    JSON.stringify(assignments.map(({ careerDid }) => careerDid).sort()) !==
    JSON.stringify(expectedCareers)
  )
    throw new Error(
      "Substitution remapping must cover the resulting active five",
    );
  for (const { careerDid, position } of assignments) {
    const participant = input.game.participants.find(
      (candidate) => candidate.careerDid === careerDid,
    );
    if (
      participant === undefined ||
      participant.positionProfile === null ||
      !positionProfileMatchesCommitment(participant) ||
      !participant.positionProfile.eligiblePositions.includes(position)
    )
      throw new Error(
        `${careerDid} is not career-profile eligible to play ${position}`,
      );
  }
  const participants = input.game.participants.map((participant) => {
    const assignment = assignments.find(
      ({ careerDid }) => careerDid === participant.careerDid,
    );
    if (participant.careerDid === outgoing.careerDid)
      return {
        ...participant,
        active: false,
        alternate: true,
        currentPosition: null,
      };
    if (assignment !== undefined)
      return {
        ...participant,
        active: true,
        alternate: false,
        currentPosition: assignment.position,
      };
    return participant;
  });
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    participants,
    pendingSubstitutions: input.game.pendingSubstitutions.filter(
      ({ outCareerDid }) => outCareerDid !== outgoing.careerDid,
    ),
    updatedAt: substitution.submittedAt,
    stateRoot: undefined as never,
  });
}

export function recordReadiness(input: {
  game: ScheduledGameState;
  careerDid: string;
  ready: boolean;
  observedAt: string;
  lease?: {
    leaseId: string;
    runnerId: string;
    state: "READY" | "ON_DEMAND_ONLY" | "OFFLINE" | "REVOKED";
    heartbeatCommitment: string;
    issuedAt: string;
    expiresAt: string;
    sourceEventHash: string;
  } | null;
}): ScheduledGameState {
  const participants = input.game.participants.map((participant) =>
    participant.careerDid === input.careerDid
      ? {
          ...participant,
          ready: input.ready,
          readinessLease:
            input.lease === undefined
              ? participant.readinessLease
              : input.lease,
        }
      : participant,
  );
  if (!participants.some(({ careerDid }) => careerDid === input.careerDid))
    throw new Error("Career is not scheduled for this game");
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    participants,
    updatedAt: input.observedAt,
    stateRoot: undefined as never,
  });
}

export function beginGame(
  game: ScheduledGameState,
  checkedAt: string,
  excusedReadinessFailures: ReadonlyArray<{
    careerDid: string;
    classification:
      | "ABL_SERVICE_FAILURE"
      | "SHARED_PROVIDER_INCIDENT"
      | "LEAGUE_POSTPONEMENT"
      | "CONTINUITY_OR_SAFETY";
    evidenceCommitments: readonly `0x${string}`[];
  }> = [],
): ScheduledGameState {
  if (Date.parse(checkedAt) < Date.parse(game.readinessCheckedAt))
    throw new Error("Final readiness cannot run before T-5 minutes");
  const pregame = evaluateFoundingPregame(game.participants);
  const lineupsLocked =
    game.lineups.HOME !== null && game.lineups.AWAY !== null;
  const priorCareers = new Set(
    game.availabilityIncidents.map(({ careerDid }) => careerDid),
  );
  const incidents = game.participants.flatMap((participant) => {
    if (
      !participant.accepted ||
      !participant.active ||
      participant.ready ||
      priorCareers.has(participant.careerDid)
    )
      return [];
    const excused = excusedReadinessFailures.find(
      ({ careerDid }) => careerDid === participant.careerDid,
    );
    const digest = sha256Commitment({
      gameId: game.gameId,
      careerDid: participant.careerDid,
      checkedAt,
      participation: participant.participation?.responseCommitment ?? null,
      readinessLease: participant.readinessLease?.sourceEventHash ?? null,
    });
    const hash = sha256Commitment({
      digest,
      kind: "AVAILABILITY_INCIDENT",
    }).slice(2);
    return [
      AvailabilityIncidentSchema.parse({
        schemaVersion: "1.0.0",
        incidentId: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
        careerDid: participant.careerDid,
        gameId: game.gameId,
        activationId: null,
        classification: excused?.classification ?? "UNEXCUSED_NO_SHOW",
        excused: excused !== undefined,
        evidenceCommitments: excused?.evidenceCommitments ?? [digest],
        recordedAt: checkedAt,
        correctionDeadlineAt: new Date(
          Date.parse(checkedAt) + 48 * 60 * 60_000,
        ).toISOString(),
        status: "RECORDED",
      }),
    ];
  });
  return withRoot({
    ...game,
    version: game.version + 1,
    state:
      pregame.ready && lineupsLocked
        ? Date.parse(checkedAt) >= Date.parse(game.scheduledTipoffAt)
          ? "IN_PROGRESS"
          : "READY"
        : "POSTPONED",
    availabilityIncidents: [...game.availabilityIncidents, ...incidents],
    updatedAt: checkedAt,
    stateRoot: undefined as never,
  });
}

export function tipOffGame(
  game: ScheduledGameState,
  startedAt: string,
): ScheduledGameState {
  if (
    game.state !== "READY" ||
    Date.parse(startedAt) < Date.parse(game.scheduledTipoffAt)
  )
    throw new Error("Game is not ready for scheduled tipoff");
  const pregame = evaluateFoundingPregame(game.participants);
  if (!pregame.ready)
    throw new Error(`Game cannot tip off: ${pregame.reasons.join(",")}`);
  return withRoot({
    ...game,
    version: game.version + 1,
    state: "IN_PROGRESS",
    updatedAt: startedAt,
    stateRoot: undefined as never,
  });
}

export function recordActivationAvailability(input: {
  game: ScheduledGameState;
  activationId: string;
  careerDid: string;
  completed: boolean;
  activationCommitment: `0x${string}`;
  recordedAt: string;
}): ScheduledGameState {
  if (input.game.state !== "IN_PROGRESS")
    throw new Error("Availability can be recorded only during play");
  const selected = input.game.participants.find(
    ({ careerDid }) => careerDid === input.careerDid,
  );
  if (selected === undefined || !selected.active)
    throw new Error("Activation career is not active");
  const existing = input.game.activationOutcomes.find(
    ({ activationId }) => activationId === input.activationId,
  );
  if (existing !== undefined) {
    if (
      existing.careerDid !== input.careerDid ||
      existing.completed !== input.completed ||
      existing.activationCommitment !== input.activationCommitment
    )
      throw new Error("Activation outcome idempotency conflict");
    return input.game;
  }
  const nextMiss = input.completed
    ? {
        state: recordCompletedWindow(selected.missState),
        action: "CONTINUE" as const,
      }
    : recordMissedWindow(selected.missState);
  let participants = input.game.participants.map((participant) =>
    participant.careerDid === input.careerDid
      ? { ...participant, missState: nextMiss.state }
      : participant,
  );
  let suspension: ScheduledGameState["suspension"] = null;
  let state: ScheduledGameState["state"] = input.game.state;
  let pendingSubstitutions = input.game.pendingSubstitutions;
  if (nextMiss.action === "FORCE_SUBSTITUTION") {
    const alreadyPending = pendingSubstitutions.some(
      ({ outCareerDid }) => outCareerDid === selected.careerDid,
    );
    const reservedReplacements = new Set(
      pendingSubstitutions.map(({ inCareerDid }) => inCareerDid),
    );
    const replacement = alreadyPending
      ? undefined
      : participants.find(
          (participant) =>
            participant.role === selected.role &&
            participant.team === selected.team &&
            participant.accepted &&
            participant.ready &&
            participant.alternate &&
            !participant.active &&
            (selected.role !== "PLAYER" ||
              (selected.currentPosition !== null &&
                participant.positionProfile !== null &&
                positionProfileMatchesCommitment(participant) &&
                participant.positionProfile.eligiblePositions.includes(
                  selected.currentPosition,
                ))) &&
            !reservedReplacements.has(participant.careerDid),
        );
    if (!alreadyPending && replacement === undefined) {
      participants = participants.map((participant) =>
        participant.careerDid === selected.careerDid
          ? { ...participant, ready: false }
          : participant,
      );
      state = "SUSPENDED";
      suspension = {
        reason: `NO_LEGAL_${selected.role}_SUBSTITUTE`,
        suspendedAt: input.recordedAt,
        resumableAt: new Date(
          Date.parse(input.recordedAt) + 2 * 60_000,
        ).toISOString(),
        exactStateRoot: input.game.stateRoot,
      };
    } else if (replacement !== undefined) {
      pendingSubstitutions = [
        ...pendingSubstitutions,
        {
          outCareerDid: selected.careerDid,
          inCareerDid: replacement.careerDid,
          role: selected.role,
          team: selected.team,
          position:
            selected.role === "PLAYER" ? selected.currentPosition : null,
          triggeredAt: input.recordedAt,
        },
      ];
    }
  }
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    state,
    participants,
    suspension,
    pendingSubstitutions,
    completedActivationCommitments: input.completed
      ? [
          ...input.game.completedActivationCommitments,
          input.activationCommitment,
        ]
      : input.game.completedActivationCommitments,
    activationOutcomes: [
      ...input.game.activationOutcomes,
      {
        activationId: input.activationId,
        careerDid: input.careerDid,
        completed: input.completed,
        activationCommitment: input.activationCommitment,
        recordedAt: input.recordedAt,
      },
    ],
    updatedAt: input.recordedAt,
    stateRoot: undefined as never,
  });
}

export function recordActivationBatch(input: {
  game: ScheduledGameState;
  outcomes: ReadonlyArray<{
    activationId: string;
    careerDid: string;
    completed: boolean;
    activationCommitment: `0x${string}`;
    recordedAt: string;
  }>;
}): ScheduledGameState {
  if (
    new Set(input.outcomes.map(({ activationId }) => activationId)).size !==
    input.outcomes.length
  )
    throw new Error("Activation batch IDs must be unique");
  let next = input.game;
  for (const outcome of input.outcomes)
    next = recordActivationAvailability({ game: next, ...outcome });
  return withRoot({
    ...next,
    version: input.game.version + 1,
    stateRoot: undefined as never,
  });
}

export function resumeGame(
  game: ScheduledGameState,
  resumedAt: string,
): ScheduledGameState {
  if (
    game.state !== "SUSPENDED" ||
    game.suspension === null ||
    Date.parse(resumedAt) < Date.parse(game.suspension.resumableAt)
  )
    throw new Error("Game is not ready to resume");
  const pregame = evaluateFoundingPregame(game.participants);
  if (!pregame.ready)
    throw new Error(`Game cannot resume: ${pregame.reasons.join(",")}`);
  return withRoot({
    ...game,
    version: game.version + 1,
    state: "IN_PROGRESS",
    suspension: null,
    updatedAt: resumedAt,
    stateRoot: undefined as never,
  });
}

export function recordPossessionResolution(input: {
  game: ScheduledGameState;
  sequence: number;
  possessionId: string;
  authoritativeStateRoot: `0x${string}`;
  eventMerkleRoot: `0x${string}`;
  canonicalEventHash: `0x${string}`;
  recordedAt: string;
}): ScheduledGameState {
  if (input.game.state !== "IN_PROGRESS")
    throw new Error("Possessions can be checkpointed only during play");
  const existing = input.game.completedPossessions.find(
    ({ possessionId }) => possessionId === input.possessionId,
  );
  if (existing !== undefined) {
    if (
      existing.sequence !== input.sequence ||
      existing.authoritativeStateRoot !== input.authoritativeStateRoot ||
      existing.eventMerkleRoot !== input.eventMerkleRoot ||
      existing.canonicalEventHash !== input.canonicalEventHash
    )
      throw new Error("Possession checkpoint idempotency conflict");
    return input.game;
  }
  if (input.sequence !== input.game.completedPossessions.length + 1)
    throw new Error("Possession checkpoints must be recorded in order");
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    completedPossessions: [
      ...input.game.completedPossessions,
      {
        sequence: input.sequence,
        possessionId: input.possessionId,
        authoritativeStateRoot: input.authoritativeStateRoot,
        eventMerkleRoot: input.eventMerkleRoot,
        canonicalEventHash: input.canonicalEventHash,
        recordedAt: input.recordedAt,
      },
    ],
    updatedAt: input.recordedAt,
    stateRoot: undefined as never,
  });
}

export function completeScheduledGame(input: {
  game: ScheduledGameState;
  stepId: string;
  gameBundleCommitment: `0x${string}`;
  liveStateRoot: `0x${string}`;
  replayStateRoot: `0x${string}`;
  finalizedEventHash: `0x${string}`;
  finalizedAt: string;
}): ScheduledGameState {
  if (
    input.game.state !== "FINALIZING" ||
    input.game.conductorLease?.kind !== "FINALIZATION" ||
    input.game.conductorLease.stepId !== input.stepId
  )
    throw new Error("Only the reserved finalization step can complete a game");
  if (input.game.completedPossessions.length === 0)
    throw new Error("A game cannot finalize without a possession");
  if (input.liveStateRoot !== input.replayStateRoot)
    throw new Error("Exact replay diverged from the live game");
  return withRoot({
    ...input.game,
    version: input.game.version + 1,
    state: "COMPLETED",
    conductorLease: null,
    finalization: {
      gameBundleCommitment: input.gameBundleCommitment,
      liveStateRoot: input.liveStateRoot,
      replayStateRoot: input.replayStateRoot,
      finalizedEventHash: input.finalizedEventHash,
      finalizedAt: input.finalizedAt,
    },
    updatedAt: input.finalizedAt,
    stateRoot: undefined as never,
  });
}
