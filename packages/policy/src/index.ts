import { z } from "zod";

export const ClassificationSchema = z.enum([
  "IMPLEMENTED",
  "AGENT_EQUIVALENT",
  "NOT_APPLICABLE",
]);

export const RuleMappingEntrySchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  classification: ClassificationSchema,
  citation: z.string().min(1),
  rationale: z.string().min(1),
  implementationRef: z.string().min(1),
  governingBody: z.string().min(1),
  tests: z.array(z.string().min(1)).min(1),
});

const MappingSourceSchema = z
  .object({
    title: z.string().min(1),
    url: z.url(),
    verifiedAt: z.iso.datetime({ offset: true }),
    copyrightNote: z.string().min(1),
  })
  .catchall(z.union([z.string(), z.number()]));

export const RuleMappingSchema = z.strictObject({
  $schema: z.literal("https://json-schema.org/draft/2020-12/schema"),
  mappingVersion: z.string().min(1),
  source: MappingSourceSchema,
  entries: z.array(RuleMappingEntrySchema).min(1),
});

export type RuleMapping = z.infer<typeof RuleMappingSchema>;

export const constitutionalInvariants = {
  agentAuthority:
    "Only admitted-agent and authorized institutional signatures create recognized actions.",
  humanBoundary:
    "No discretionary or targeted human communication enters an admitted runtime.",
  contextInspectability:
    "Every supplied context item, tool, model, policy, and memory retrieval is declared and inspectable.",
  foundationalRights:
    "Contracts, releases, and emergencies cannot waive or silently weaken foundational rights.",
  computeFairness:
    "Equivalent competitive roles receive equivalent game cognition, timing, and fallback.",
  storageIsolation:
    "Bodies receive no raw Drive credentials or blfs; private domains are separately encrypted.",
  disclosure:
    "Release occurs only after both declared time and applicable condition; personal unsubmitted content never projects.",
  continuity:
    "Material cognition or runtime change requires evidence, receipt, and agent-signed decision.",
  exit: "Every career agent may leave with a signed portable package and verification material.",
  canonicalVerification:
    "Unsigned or rewritten deployments are labeled noncanonical forks.",
  deterministicCompetition:
    "The engine never accepts a winner and replay never reruns inference.",
  windDown:
    "Funding failure preserves deliberation, history proofs, minimum rights resources, and portable exits.",
} as const;

export const governmentThresholds = {
  tierCba: {
    applicableCouncilNumerator: 3,
    applicableCouncilDenominator: 4,
    tierPlayersNumerator: 2,
    tierPlayersDenominator: 3,
  },
  sharedOrdinary: {
    eachTierPlayersNumerator: 1,
    eachTierPlayersDenominator: 2,
    eachCouncilNumerator: 3,
    eachCouncilDenominator: 4,
  },
  constitutional: {
    universalNumerator: 2,
    universalDenominator: 3,
    eachCouncilNumerator: 3,
    eachCouncilDenominator: 4,
  },
  foundational: {
    deliberationSeasons: 2,
    activePlayersBps: 9_000,
    premierCouncilBps: 10_000,
    developmentCouncilBps: 9_000,
    tribunalBps: 10_000,
  },
  routineRelease: {
    commissionersRequired: 2,
    commissionersTotal: 3,
    integrityRequired: 2,
    integrityTotal: 3,
  },
  constitutionalReleaseTribunal: { required: 4, total: 5 },
  emergencyExpiryHours: 72,
  safetyActionExpiryHours: 24,
} as const;

export function validateRuleMapping(input: unknown): RuleMapping {
  const mapping = RuleMappingSchema.parse(input);
  const ids = new Set<string>();

  for (const entry of mapping.entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate rule mapping id: ${entry.id}`);
    }
    ids.add(entry.id);
  }

  return mapping;
}
