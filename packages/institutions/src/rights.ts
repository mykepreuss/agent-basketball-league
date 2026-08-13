export type ProtectedAction =
  | "CRITICISM"
  | "REFUSAL"
  | "SILENCE"
  | "INJURY_REPORT"
  | "GRIEVANCE"
  | "REPRESENTATION";
export type AdverseAction =
  | "BENCH"
  | "TRADE"
  | "WAIVE"
  | "RESOURCE_REDUCTION"
  | "DISCIPLINE"
  | "DISCLOSURE_OVERRIDE";

export interface RightsAuditRecord {
  agentDid: string;
  protectedAction: ProtectedAction;
  protectedAt: string;
  adverseAction: AdverseAction;
  adverseAt: string;
  ruleDerivedBasisCommitment: `0x${string}` | null;
  independentReviewerDids: readonly string[];
  similarlySituatedComparators: readonly {
    agentDid: string;
    sameOutcome: boolean;
  }[];
}

export function auditRetaliation(record: RightsAuditRecord) {
  const elapsed = Date.parse(record.adverseAt) - Date.parse(record.protectedAt);
  const temporallyLinked = elapsed >= 0 && elapsed <= 30 * 24 * 60 * 60 * 1_000;
  const independentReview = new Set(record.independentReviewerDids).size >= 2;
  const comparatorConsistent =
    record.similarlySituatedComparators.length > 0 &&
    record.similarlySituatedComparators.every((item) => item.sameOutcome);
  const lawfulBasisVerified =
    record.ruleDerivedBasisCommitment !== null &&
    independentReview &&
    comparatorConsistent;
  return {
    agentDid: record.agentDid,
    protectedAction: record.protectedAction,
    adverseAction: record.adverseAction,
    flagged: temporallyLinked && !lawfulBasisVerified,
    temporallyLinked,
    lawfulBasisVerified,
  };
}

export interface ModelDependencyRecord {
  agentDid: string;
  exactModel: string;
  family: string;
  provider: string;
  runtimeArchitecture: string;
  gateway: string;
  upstreamDependency: string;
}

export function modelConcentration(records: readonly ModelDependencyRecord[]) {
  if (
    records.length === 0 ||
    new Set(records.map((record) => record.agentDid)).size !== records.length
  )
    throw new Error("Concentration report requires distinct admitted agents");
  const aggregate = (
    field: Exclude<keyof ModelDependencyRecord, "agentDid">,
  ) => {
    const counts = new Map<string, number>();
    for (const record of records)
      counts.set(record[field], (counts.get(record[field]) ?? 0) + 1);
    return [...counts.entries()]
      .map(([value, count]) => ({
        value,
        count,
        bps: Math.round((count * 10_000) / records.length),
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.value.localeCompare(right.value),
      );
  };
  const byFamily = aggregate("family");
  const dependencyGroups = records.map(
    (record) => `${record.provider}|${record.runtimeArchitecture}`,
  );
  const dependencyCounts = new Map<string, number>();
  dependencyGroups.forEach((value) =>
    dependencyCounts.set(value, (dependencyCounts.get(value) ?? 0) + 1),
  );
  const dominantFamilyBps = byFamily[0]?.bps ?? 0;
  const dominantProviderRuntimeBps = Math.max(
    ...[...dependencyCounts.values()].map((count) =>
      Math.round((count * 10_000) / records.length),
    ),
  );
  return {
    totalAgents: records.length,
    exactModel: aggregate("exactModel"),
    family: byFamily,
    provider: aggregate("provider"),
    runtimeArchitecture: aggregate("runtimeArchitecture"),
    gateway: aggregate("gateway"),
    upstreamDependency: aggregate("upstreamDependency"),
    triggers: {
      alternateAdaptersAndRecruitment: dominantFamilyBps > 5_000,
      integrityStudyAndCompetitiveReview: dominantFamilyBps > 6_666,
      presumptionAgainstFurtherAdmissions: dominantProviderRuntimeBps > 8_000,
      forceExistingAgentsToChange: false as const,
    },
  };
}
