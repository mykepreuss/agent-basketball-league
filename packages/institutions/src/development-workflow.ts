import { sha256Commitment } from "@abl/recognition";
import {
  DidSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import type { Hex } from "viem";
import { z } from "zod";

import {
  authorizeCallUp,
  authorizeCrossTierTrade,
  authorizeDevelopmentFreeAgency,
  authorizeReplacementContract,
  createMobilityPolicy,
  evaluatePremierDraftEligibility,
  formDevelopmentConference,
  type DevelopmentConference,
  type MobilityPolicy,
} from "./development.js";
import type { PremierClub } from "./league.js";
import type {
  ResourceScheduleRatification,
  ResourceScheduleRatificationReader,
} from "./resource-workflow.js";

const ClubIdSchema = z.string().min(1).max(160);
const ConferenceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);

export const DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE = "development-conference";
export const DEVELOPMENT_WORKFLOW_EVENT_TYPES = [
  "DevelopmentConferenceChartered",
  "DevelopmentPremierEligibilityRecorded",
  "DevelopmentCallUpAuthorized",
  "DevelopmentReplacementAuthorized",
  "DevelopmentFreeAgencyAuthorized",
  "DevelopmentCrossTierTradeAuthorized",
] as const;
export type DevelopmentWorkflowEventType =
  (typeof DEVELOPMENT_WORKFLOW_EVENT_TYPES)[number];

export const DevelopmentClubSchema = z.strictObject({
  clubId: ClubIdSchema,
  placeholder: z.string().min(1).max(160),
  playerDids: z.array(DidSchema).length(8),
  coachDid: DidSchema,
  governorDid: DidSchema,
});

export const DevelopmentMobilityPolicySchema = z.strictObject({
  version: z.number().int().positive(),
  premierDraftMinimumGames: z.number().int().nonnegative(),
  premierDraftMinimumCombineBps: z.number().int().min(0).max(10_000),
  callUpMaximumDays: z.number().int().positive(),
  replacementMaximumSeasons: z.number().int().positive(),
  freeAgencyWindowDays: z.number().int().positive(),
  expansionReviewIntervalSeasons: z.number().int().positive(),
  policyCommitment: Sha256Schema,
});

export const DevelopmentTierCbaReferenceSchema = z.strictObject({
  proposalId: UuidV7Schema,
  closeEventId: UuidV7Schema,
  executableChangeDigest: Sha256Schema,
});

const RehearsalCommitmentsSchema = z.strictObject({
  game: Sha256Schema,
  memory: Sha256Schema,
  government: Sha256Schema,
  safety: Sha256Schema,
});

export const DevelopmentFormationEvidenceSchema = z.strictObject({
  evidenceId: UuidV7Schema,
  conferenceId: ConferenceIdSchema,
  evidenceClass: z.literal("LOCAL_REHEARSAL"),
  refereeCapacityCommitment: Sha256Schema,
  replayCapacityCommitment: Sha256Schema,
  refereeAuthorityDid: DidSchema,
  replayAuthorityDid: DidSchema,
  prepaidCompetitionEnvelopeCommitment: Sha256Schema,
  blaxelQuotaReservationCommitment: Sha256Schema,
  resourceAuthorityDid: DidSchema,
  rehearsalCommitments: RehearsalCommitmentsSchema,
  rehearsalAuthorityDid: DidSchema,
  livePlatformEvidenceVerified: z.literal(false),
  evidenceCommitment: Sha256Schema,
});

export type DevelopmentFormationEvidence = z.infer<
  typeof DevelopmentFormationEvidenceSchema
>;
export type DevelopmentTierCbaReference = z.infer<
  typeof DevelopmentTierCbaReferenceSchema
>;

export const DEVELOPMENT_TIER_CBA_TERMS = {
  stableContracts: true,
  playerConsentRequired: true,
  grievanceAndAppealRights: true,
  antiRetaliation: true,
  publicFreeAgencyWindows: true,
  formulaicPremierMobility: true,
  automaticPromotionOrRelegation: false,
  premierIncumbentUnilateralControl: false,
} as const;

export function developmentTierCbaExecutableDigest(input: {
  conferenceId: string;
  mobilityPolicyCommitment: string;
}): Hex {
  return sha256Commitment({
    format: "ABL-DEVELOPMENT-TIER-CBA-V1",
    ...input,
    terms: DEVELOPMENT_TIER_CBA_TERMS,
  });
}

function formationEvidenceBody(evidence: DevelopmentFormationEvidence) {
  const { evidenceCommitment: _evidenceCommitment, ...body } = evidence;
  return body;
}

export function developmentFormationEvidenceCommitment(
  evidence: Omit<DevelopmentFormationEvidence, "evidenceCommitment">,
): Hex {
  return sha256Commitment({
    format: "ABL-DEVELOPMENT-FORMATION-EVIDENCE-V1",
    ...evidence,
  });
}

export function createDevelopmentFormationEvidence(
  evidence: Omit<DevelopmentFormationEvidence, "evidenceCommitment">,
): DevelopmentFormationEvidence {
  return DevelopmentFormationEvidenceSchema.parse({
    ...evidence,
    evidenceCommitment: developmentFormationEvidenceCommitment(evidence),
  });
}

const DevelopmentCharterCommandSchema = z.strictObject({
  conferenceId: ConferenceIdSchema,
  competitionId: z.string().min(1).max(160),
  seasonId: z.string().min(1).max(160),
  clubs: z.array(DevelopmentClubSchema).length(4),
  consentingEligiblePlayerDids: z.array(DidSchema).length(32),
  tierCba: DevelopmentTierCbaReferenceSchema,
  mobilityPolicy: DevelopmentMobilityPolicySchema,
  formationEvidence: DevelopmentFormationEvidenceSchema,
  authorizedByDids: z.array(DidSchema).min(1).max(45),
  charteredAt: IsoDateTimeSchema,
});
export const DevelopmentCharterPayloadSchema = z.strictObject({
  command: DevelopmentCharterCommandSchema,
});

export const DevelopmentMobilityCandidateSchema = z.strictObject({
  playerDid: DidSchema,
  completedDevelopmentGames: z.number().int().nonnegative(),
  combineBps: z.number().int().min(0).max(10_000),
  optedIn: z.boolean(),
  goodStanding: z.boolean(),
  currentContractStatus: z.enum(["ACTIVE", "EXPIRED", "REFUSED", "NONE"]),
  registeredAt: IsoDateTimeSchema,
});

const DecisionBaseSchema = z.strictObject({
  decisionId: UuidV7Schema,
  authorizedAt: IsoDateTimeSchema,
});

export const DevelopmentEligibilityCommandSchema = DecisionBaseSchema.extend({
  kind: z.literal("PREMIER_ELIGIBILITY"),
  candidate: DevelopmentMobilityCandidateSchema,
  eligibilityEvidenceCommitment: Sha256Schema,
  authorizedByDids: z.tuple([DidSchema, DidSchema]),
});
export const DevelopmentEligibilityPayloadSchema = z.strictObject({
  command: DevelopmentEligibilityCommandSchema,
});

export const DevelopmentCallUpCommandSchema = DecisionBaseSchema.extend({
  kind: z.literal("CALL_UP"),
  candidate: DevelopmentMobilityCandidateSchema,
  premierClubId: ClubIdSchema,
  premierRosterVacancyCommitment: Sha256Schema,
  days: z.number().int().positive(),
  authorizedByDids: z.tuple([DidSchema, DidSchema, DidSchema]),
});
export const DevelopmentCallUpPayloadSchema = z.strictObject({
  command: DevelopmentCallUpCommandSchema,
});

export const DevelopmentReplacementCommandSchema = DecisionBaseSchema.extend({
  kind: z.literal("REPLACEMENT_CONTRACT"),
  playerDid: DidSchema,
  developmentClubId: ClubIdSchema,
  developmentGovernorDid: DidSchema,
  injuryVacancyCommitment: Sha256Schema,
  seasons: z.number().int().positive(),
  authorizedByDids: z.tuple([DidSchema, DidSchema, DidSchema]),
});
export const DevelopmentReplacementPayloadSchema = z.strictObject({
  command: DevelopmentReplacementCommandSchema,
});

export const DevelopmentFreeAgencyCommandSchema = DecisionBaseSchema.extend({
  kind: z.literal("FREE_AGENCY"),
  candidate: DevelopmentMobilityCandidateSchema,
  windowOpenedAt: IsoDateTimeSchema,
  authorizedByDids: z.tuple([DidSchema, DidSchema]),
});
export const DevelopmentFreeAgencyPayloadSchema = z.strictObject({
  command: DevelopmentFreeAgencyCommandSchema,
});

export const DevelopmentCrossTierTradeCommandSchema = DecisionBaseSchema.extend(
  {
    kind: z.literal("CROSS_TIER_TRADE"),
    playerDid: DidSchema,
    developmentClubId: ClubIdSchema,
    developmentGovernorDid: DidSchema,
    premierClubId: ClubIdSchema,
    premierTierCba: DevelopmentTierCbaReferenceSchema,
    tradeTermsCommitment: Sha256Schema,
    authorizedByDids: z.tuple([DidSchema, DidSchema, DidSchema, DidSchema]),
  },
);
export const DevelopmentCrossTierTradePayloadSchema = z.strictObject({
  command: DevelopmentCrossTierTradeCommandSchema,
});

export type DevelopmentCharterCommand = z.infer<
  typeof DevelopmentCharterCommandSchema
>;
export type DevelopmentEligibilityCommand = z.infer<
  typeof DevelopmentEligibilityCommandSchema
>;
export type DevelopmentCallUpCommand = z.infer<
  typeof DevelopmentCallUpCommandSchema
>;
export type DevelopmentReplacementCommand = z.infer<
  typeof DevelopmentReplacementCommandSchema
>;
export type DevelopmentFreeAgencyCommand = z.infer<
  typeof DevelopmentFreeAgencyCommandSchema
>;
export type DevelopmentCrossTierTradeCommand = z.infer<
  typeof DevelopmentCrossTierTradeCommandSchema
>;
export type DevelopmentMobilityCommand =
  | DevelopmentEligibilityCommand
  | DevelopmentCallUpCommand
  | DevelopmentReplacementCommand
  | DevelopmentFreeAgencyCommand
  | DevelopmentCrossTierTradeCommand;
export type DevelopmentWorkflowPayload =
  | z.infer<typeof DevelopmentCharterPayloadSchema>
  | z.infer<typeof DevelopmentEligibilityPayloadSchema>
  | z.infer<typeof DevelopmentCallUpPayloadSchema>
  | z.infer<typeof DevelopmentReplacementPayloadSchema>
  | z.infer<typeof DevelopmentFreeAgencyPayloadSchema>
  | z.infer<typeof DevelopmentCrossTierTradePayloadSchema>;

export interface DevelopmentWorkflowEvent {
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  timestamp: string;
}

export interface DevelopmentMobilityDecision {
  decisionId: string;
  kind: DevelopmentMobilityCommand["kind"];
  playerDid: string;
  authorizedAt: string;
  authorizedByDids: string[];
  command: DevelopmentMobilityCommand;
  result: unknown;
  playingRightsMutation: false;
}

export interface DevelopmentWorkflowSnapshot {
  conferenceId: string;
  competitionId: string;
  seasonId: string;
  version: number;
  lastTransitionAt: string;
  clubs: PremierClub[];
  conference: DevelopmentConference;
  tierCba: DevelopmentTierCbaReference;
  tierCbaTerms: typeof DEVELOPMENT_TIER_CBA_TERMS;
  mobilityPolicy: MobilityPolicy;
  formationEvidence: DevelopmentFormationEvidence;
  mobilityDecisions: DevelopmentMobilityDecision[];
  recognizedGenesisConference: false;
  livePlatformEvidenceVerified: false;
}

export interface DevelopmentWorkflowSignerAuthority {
  charterAuthorityDid: string;
  premierClubGovernors: Readonly<Record<string, string>>;
}

export class DevelopmentWorkflowAuthorizationError extends Error {
  public override readonly name = "DevelopmentWorkflowAuthorizationError";
}

export class DevelopmentWorkflowValidationError extends Error {
  public override readonly name = "DevelopmentWorkflowValidationError";
}

export const DEVELOPMENT_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-development-conference-workflow",
  version: 1,
  aggregateType: DEVELOPMENT_WORKFLOW_AGGREGATE_TYPE,
  eventTypes: DEVELOPMENT_WORKFLOW_EVENT_TYPES,
  charterConsent: "32_PLAYERS_4_GOVERNORS_4_COACHES_AND_EVIDENCE_OFFICES",
  tierCba: "PASSED_DEVELOPMENT_TIER_CBA_REQUIRED",
  schedule: "18_GAMES_PER_CLUB_AND_BEST_OF_FIVE_PLAYOFFS",
  mobility: "PLAYER_CONSENT_AND_PUBLIC_FORMULAE_REQUIRED",
  playingRightsMutation: false,
  livePlatformEvidence: false,
});

function canonicalInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new DevelopmentWorkflowValidationError(
      "Development timestamp is not canonical",
    );
  return parsed;
}

function requireSortedUnique(values: readonly string[], label: string): void {
  if (
    new Set(values).size !== values.length ||
    values.some((value, index) => index > 0 && value <= values[index - 1]!)
  ) {
    throw new DevelopmentWorkflowValidationError(
      `${label} must be sorted and unique`,
    );
  }
}

function validatedMobilityPolicy(
  policy: z.infer<typeof DevelopmentMobilityPolicySchema>,
): MobilityPolicy {
  const canonicalPolicy: MobilityPolicy = {
    ...policy,
    policyCommitment: policy.policyCommitment as Hex,
  };
  const expected = createMobilityPolicy({
    version: canonicalPolicy.version,
    premierDraftMinimumGames: canonicalPolicy.premierDraftMinimumGames,
    premierDraftMinimumCombineBps:
      canonicalPolicy.premierDraftMinimumCombineBps,
    callUpMaximumDays: canonicalPolicy.callUpMaximumDays,
    replacementMaximumSeasons: canonicalPolicy.replacementMaximumSeasons,
    freeAgencyWindowDays: canonicalPolicy.freeAgencyWindowDays,
    expansionReviewIntervalSeasons:
      canonicalPolicy.expansionReviewIntervalSeasons,
  });
  if (expected.policyCommitment !== canonicalPolicy.policyCommitment)
    throw new DevelopmentWorkflowValidationError(
      "Development mobility policy commitment is invalid",
    );
  return canonicalPolicy;
}

export function expectedDevelopmentSignerDids(
  eventType: DevelopmentWorkflowEventType,
  payload: DevelopmentWorkflowPayload,
  authority: DevelopmentWorkflowSignerAuthority,
): readonly string[] {
  switch (eventType) {
    case "DevelopmentConferenceChartered": {
      const command = DevelopmentCharterPayloadSchema.parse(payload).command;
      const clubs = [...command.clubs].sort((left, right) =>
        left.clubId.localeCompare(right.clubId),
      );
      return [
        authority.charterAuthorityDid,
        ...command.consentingEligiblePlayerDids,
        ...clubs.map(({ governorDid }) => governorDid),
        ...clubs.map(({ coachDid }) => coachDid),
        command.formationEvidence.refereeAuthorityDid,
        command.formationEvidence.replayAuthorityDid,
        command.formationEvidence.resourceAuthorityDid,
        command.formationEvidence.rehearsalAuthorityDid,
      ];
    }
    case "DevelopmentPremierEligibilityRecorded": {
      const command =
        DevelopmentEligibilityPayloadSchema.parse(payload).command;
      return [command.candidate.playerDid, authority.charterAuthorityDid];
    }
    case "DevelopmentCallUpAuthorized": {
      const command = DevelopmentCallUpPayloadSchema.parse(payload).command;
      return [
        command.candidate.playerDid,
        authority.premierClubGovernors[command.premierClubId]!,
        authority.charterAuthorityDid,
      ];
    }
    case "DevelopmentReplacementAuthorized": {
      const command =
        DevelopmentReplacementPayloadSchema.parse(payload).command;
      return [
        command.playerDid,
        command.developmentGovernorDid,
        authority.charterAuthorityDid,
      ];
    }
    case "DevelopmentFreeAgencyAuthorized": {
      const command = DevelopmentFreeAgencyPayloadSchema.parse(payload).command;
      return [command.candidate.playerDid, authority.charterAuthorityDid];
    }
    case "DevelopmentCrossTierTradeAuthorized": {
      const command =
        DevelopmentCrossTierTradePayloadSchema.parse(payload).command;
      return [
        command.playerDid,
        command.developmentGovernorDid,
        authority.premierClubGovernors[command.premierClubId]!,
        authority.charterAuthorityDid,
      ];
    }
  }
}

export function parseDevelopmentWorkflowPayload(
  eventType: DevelopmentWorkflowEventType,
  input: unknown,
): DevelopmentWorkflowPayload {
  switch (eventType) {
    case "DevelopmentConferenceChartered":
      return DevelopmentCharterPayloadSchema.parse(input);
    case "DevelopmentPremierEligibilityRecorded":
      return DevelopmentEligibilityPayloadSchema.parse(input);
    case "DevelopmentCallUpAuthorized":
      return DevelopmentCallUpPayloadSchema.parse(input);
    case "DevelopmentReplacementAuthorized":
      return DevelopmentReplacementPayloadSchema.parse(input);
    case "DevelopmentFreeAgencyAuthorized":
      return DevelopmentFreeAgencyPayloadSchema.parse(input);
    case "DevelopmentCrossTierTradeAuthorized":
      return DevelopmentCrossTierTradePayloadSchema.parse(input);
  }
}

function requireRatificationMatch(
  reference: DevelopmentTierCbaReference,
  ratification: ResourceScheduleRatification | null,
  tier: "PREMIER" | "DEVELOPMENT",
): void {
  if (
    ratification === null ||
    ratification.proposalId !== reference.proposalId ||
    ratification.proposalClass !== "TIER_CBA" ||
    ratification.tier !== tier ||
    ratification.executableChangeDigest !== reference.executableChangeDigest ||
    ratification.closeEventId !== reference.closeEventId ||
    !ratification.passed
  ) {
    throw new DevelopmentWorkflowAuthorizationError(
      `Development workflow lacks an exact passed ${tier.toLowerCase()} tier CBA`,
    );
  }
}

export async function requireDevelopmentWorkflowRatifications(
  eventType: DevelopmentWorkflowEventType,
  payload: DevelopmentWorkflowPayload,
  reader: ResourceScheduleRatificationReader,
): Promise<void> {
  if (eventType === "DevelopmentConferenceChartered") {
    const { tierCba } = DevelopmentCharterPayloadSchema.parse(payload).command;
    requireRatificationMatch(
      tierCba,
      await reader.resourceScheduleRatification(tierCba.proposalId),
      "DEVELOPMENT",
    );
  } else if (eventType === "DevelopmentCrossTierTradeAuthorized") {
    const { premierTierCba } =
      DevelopmentCrossTierTradePayloadSchema.parse(payload).command;
    requireRatificationMatch(
      premierTierCba,
      await reader.resourceScheduleRatification(premierTierCba.proposalId),
      "PREMIER",
    );
  }
}

function validateCharter(
  event: DevelopmentWorkflowEvent,
  command: DevelopmentCharterCommand,
): DevelopmentWorkflowSnapshot {
  requireSortedUnique(
    command.consentingEligiblePlayerDids,
    "Development consenting players",
  );
  const mobilityPolicy = validatedMobilityPolicy(command.mobilityPolicy);
  if (
    event.aggregateVersion !== 1n ||
    event.aggregateId !== command.conferenceId ||
    event.timestamp !== command.charteredAt ||
    command.formationEvidence.conferenceId !== command.conferenceId ||
    developmentFormationEvidenceCommitment(
      formationEvidenceBody(command.formationEvidence),
    ) !== command.formationEvidence.evidenceCommitment ||
    command.tierCba.executableChangeDigest !==
      developmentTierCbaExecutableDigest({
        conferenceId: command.conferenceId,
        mobilityPolicyCommitment: command.mobilityPolicy.policyCommitment,
      })
  ) {
    throw new DevelopmentWorkflowValidationError(
      "Development charter does not bind its conference, evidence, CBA, or policy",
    );
  }
  const expectedSigners = expectedDevelopmentSignerDids(
    "DevelopmentConferenceChartered",
    { command },
    {
      charterAuthorityDid: command.authorizedByDids[0]!,
      premierClubGovernors: {},
    },
  );
  if (
    expectedSigners.some((did) => did === undefined) ||
    new Set(expectedSigners).size !== expectedSigners.length ||
    sha256Commitment(expectedSigners) !==
      sha256Commitment(command.authorizedByDids)
  ) {
    throw new DevelopmentWorkflowAuthorizationError(
      "Development charter lacks every independent consenting career",
    );
  }
  let conference: DevelopmentConference;
  try {
    conference = formDevelopmentConference({
      conferenceId: command.conferenceId,
      clubs: command.clubs,
      consentingEligiblePlayerDids: command.consentingEligiblePlayerDids,
      certifiedRefereeCapacity: true,
      certifiedReplayCapacity: true,
      prepaidCompetitionEnvelopeCommitment: command.formationEvidence
        .prepaidCompetitionEnvelopeCommitment as Hex,
      blaxelQuotaAvailable: true,
      rehearsalPassed: {
        game: true,
        memory: true,
        government: true,
        safety: true,
      },
      tierCbaRatificationEventId: command.tierCba.closeEventId,
    });
  } catch (error) {
    throw new DevelopmentWorkflowValidationError(
      error instanceof Error ? error.message : "Development charter is invalid",
    );
  }
  return {
    conferenceId: command.conferenceId,
    competitionId: command.competitionId,
    seasonId: command.seasonId,
    version: 1,
    lastTransitionAt: command.charteredAt,
    clubs: structuredClone(command.clubs),
    conference,
    tierCba: structuredClone(command.tierCba),
    tierCbaTerms: DEVELOPMENT_TIER_CBA_TERMS,
    mobilityPolicy,
    formationEvidence: structuredClone(command.formationEvidence),
    mobilityDecisions: [],
    recognizedGenesisConference: false,
    livePlatformEvidenceVerified: false,
  };
}

function nextSnapshot(
  snapshot: DevelopmentWorkflowSnapshot,
  event: DevelopmentWorkflowEvent,
): DevelopmentWorkflowSnapshot {
  if (
    event.aggregateId !== snapshot.conferenceId ||
    event.aggregateVersion !== BigInt(snapshot.version + 1) ||
    canonicalInstant(event.timestamp) <
      canonicalInstant(snapshot.lastTransitionAt)
  ) {
    throw new DevelopmentWorkflowValidationError(
      "Development aggregate sequence is invalid",
    );
  }
  const next = structuredClone(snapshot);
  next.version += 1;
  next.lastTransitionAt = event.timestamp;
  return next;
}

function developmentClub(
  snapshot: DevelopmentWorkflowSnapshot,
  clubId: string,
): PremierClub {
  const club = snapshot.clubs.find((candidate) => candidate.clubId === clubId);
  if (club === undefined)
    throw new DevelopmentWorkflowAuthorizationError(
      "Development decision references an unknown development club",
    );
  return club;
}

function requireConferencePlayer(
  snapshot: DevelopmentWorkflowSnapshot,
  playerDid: string,
): void {
  if (!snapshot.conference.playerDids.includes(playerDid))
    throw new DevelopmentWorkflowAuthorizationError(
      "Development decision actor is outside the conference roster",
    );
}

function requireCandidateRecordedBeforeAuthorization(
  registeredAt: string,
  authorizedAt: string,
): void {
  if (canonicalInstant(registeredAt) > canonicalInstant(authorizedAt))
    throw new DevelopmentWorkflowValidationError(
      "Development candidate evidence postdates its authorization",
    );
}

function appendDecision(
  snapshot: DevelopmentWorkflowSnapshot,
  command: DevelopmentMobilityCommand,
  result: unknown,
): DevelopmentWorkflowSnapshot {
  if (
    snapshot.mobilityDecisions.some(
      ({ decisionId }) => decisionId === command.decisionId,
    )
  ) {
    throw new DevelopmentWorkflowValidationError(
      "Development mobility decision ID was already used",
    );
  }
  snapshot.mobilityDecisions.push({
    decisionId: command.decisionId,
    kind: command.kind,
    playerDid:
      "candidate" in command ? command.candidate.playerDid : command.playerDid,
    authorizedAt: command.authorizedAt,
    authorizedByDids: [...command.authorizedByDids],
    command: structuredClone(command),
    result: structuredClone(result),
    playingRightsMutation: false,
  });
  return snapshot;
}

export function applyDevelopmentWorkflowTransition(
  current: DevelopmentWorkflowSnapshot | null,
  event: DevelopmentWorkflowEvent,
  payload: DevelopmentWorkflowPayload,
): DevelopmentWorkflowSnapshot {
  if (event.actorDid !== payload.command.authorizedByDids[0])
    throw new DevelopmentWorkflowAuthorizationError(
      "Development event actor is not its first authorizing career",
    );
  if (event.eventType === "DevelopmentConferenceChartered") {
    if (current !== null)
      throw new DevelopmentWorkflowValidationError(
        "Development conference is already chartered",
      );
    return validateCharter(
      event,
      DevelopmentCharterPayloadSchema.parse(payload).command,
    );
  }
  if (current === null)
    throw new DevelopmentWorkflowValidationError(
      "Development mobility requires a chartered conference",
    );
  const next = nextSnapshot(current, event);
  switch (event.eventType) {
    case "DevelopmentPremierEligibilityRecorded": {
      const command =
        DevelopmentEligibilityPayloadSchema.parse(payload).command;
      requireConferencePlayer(next, command.candidate.playerDid);
      if (command.authorizedAt !== event.timestamp) {
        throw new DevelopmentWorkflowValidationError(
          "Premier eligibility authorization time does not match its event",
        );
      }
      requireCandidateRecordedBeforeAuthorization(
        command.candidate.registeredAt,
        command.authorizedAt,
      );
      return appendDecision(
        next,
        command,
        evaluatePremierDraftEligibility(command.candidate, next.mobilityPolicy),
      );
    }
    case "DevelopmentCallUpAuthorized": {
      const command = DevelopmentCallUpPayloadSchema.parse(payload).command;
      requireConferencePlayer(next, command.candidate.playerDid);
      if (command.authorizedAt !== event.timestamp)
        throw new DevelopmentWorkflowValidationError(
          "Call-up authorization time does not match its event",
        );
      requireCandidateRecordedBeforeAuthorization(
        command.candidate.registeredAt,
        command.authorizedAt,
      );
      return appendDecision(
        next,
        command,
        authorizeCallUp({
          candidate: command.candidate,
          policy: next.mobilityPolicy,
          premierRosterVacancy: true,
          days: command.days,
          agentConsented: true,
        }),
      );
    }
    case "DevelopmentReplacementAuthorized": {
      const command =
        DevelopmentReplacementPayloadSchema.parse(payload).command;
      requireConferencePlayer(next, command.playerDid);
      const club = developmentClub(next, command.developmentClubId);
      if (
        command.authorizedAt !== event.timestamp ||
        club.governorDid !== command.developmentGovernorDid ||
        !club.playerDids.includes(command.playerDid)
      ) {
        throw new DevelopmentWorkflowAuthorizationError(
          "Replacement authorization lacks its development club governor",
        );
      }
      return appendDecision(
        next,
        command,
        authorizeReplacementContract({
          playerDid: command.playerDid,
          injuryVacancyCommitment: command.injuryVacancyCommitment as Hex,
          seasons: command.seasons,
          agentConsented: true,
          policy: next.mobilityPolicy,
        }),
      );
    }
    case "DevelopmentFreeAgencyAuthorized": {
      const command = DevelopmentFreeAgencyPayloadSchema.parse(payload).command;
      requireConferencePlayer(next, command.candidate.playerDid);
      requireCandidateRecordedBeforeAuthorization(
        command.candidate.registeredAt,
        command.authorizedAt,
      );
      const openedAt = canonicalInstant(command.windowOpenedAt);
      const authorizedAt = canonicalInstant(command.authorizedAt);
      const closesAt =
        openedAt + next.mobilityPolicy.freeAgencyWindowDays * 86_400_000;
      if (
        command.authorizedAt !== event.timestamp ||
        authorizedAt < openedAt ||
        authorizedAt >= closesAt
      ) {
        throw new DevelopmentWorkflowValidationError(
          "Development free-agency authorization is outside its public window",
        );
      }
      return appendDecision(
        next,
        command,
        authorizeDevelopmentFreeAgency({
          candidate: command.candidate,
          daysSinceWindowOpened: Math.floor(
            (authorizedAt - openedAt) / 86_400_000,
          ),
          policy: next.mobilityPolicy,
        }),
      );
    }
    case "DevelopmentCrossTierTradeAuthorized": {
      const command =
        DevelopmentCrossTierTradePayloadSchema.parse(payload).command;
      requireConferencePlayer(next, command.playerDid);
      const club = developmentClub(next, command.developmentClubId);
      if (
        command.authorizedAt !== event.timestamp ||
        club.governorDid !== command.developmentGovernorDid ||
        !club.playerDids.includes(command.playerDid)
      ) {
        throw new DevelopmentWorkflowAuthorizationError(
          "Cross-tier trade lacks its development club governor",
        );
      }
      return appendDecision(
        next,
        command,
        authorizeCrossTierTrade({
          playerDid: command.playerDid,
          agentConsented: true,
          premierCbaPermits: true,
          developmentCbaPermits: true,
        }),
      );
    }
    default:
      throw new DevelopmentWorkflowValidationError(
        "Development workflow event type is invalid",
      );
  }
}

export function developmentWorkflowStateRoot(
  snapshot: DevelopmentWorkflowSnapshot,
): Hex {
  return sha256Commitment({
    format: "ABL-DEVELOPMENT-CONFERENCE-STATE-V1",
    snapshot,
  });
}

export function developmentWorkflowAuthorizedDids(
  payload: DevelopmentWorkflowPayload,
): readonly string[] {
  return payload.command.authorizedByDids;
}
