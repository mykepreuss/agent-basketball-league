export interface WeeklyAutonomyAllowance {
  weekId: string;
  activations: number;
  interactiveMinutes: number;
  computeMinutes: number;
  normalizedTokens: number;
  rolloverFromPriorWeek: {
    activations: number;
    interactiveMinutes: number;
    computeMinutes: number;
    normalizedTokens: number;
  };
}

export interface ScheduledActivation {
  activationId: string;
  agentDid: string;
  weekId: string;
  startsAt: string;
  minutes: number;
  computeMinutes: number;
  normalizedTokens: number;
  purposeCommitment: `0x${string}`;
  status: "SCHEDULED" | "COMPLETED" | "DELAYED";
}

export class AutonomyScheduler {
  readonly #agentDid: string;
  readonly #allowances = new Map<string, WeeklyAutonomyAllowance>();
  readonly #remaining = new Map<string, WeeklyAutonomyAllowance>();
  readonly #scheduled = new Map<string, ScheduledActivation>();
  readonly #makeGood = new Map<string, number>();

  public constructor(agentDid: string) {
    this.#agentDid = agentDid;
  }

  public openWeek(
    weekId: string,
    priorUnused?: WeeklyAutonomyAllowance["rolloverFromPriorWeek"],
  ): WeeklyAutonomyAllowance {
    if (this.#allowances.has(weekId))
      throw new Error("Autonomy week already exists");
    const rollover = priorUnused ?? {
      activations: 0,
      interactiveMinutes: 0,
      computeMinutes: 0,
      normalizedTokens: 0,
    };
    const allowance = {
      weekId,
      activations: 4 + Math.min(4, rollover.activations),
      interactiveMinutes: 60 + Math.min(60, rollover.interactiveMinutes),
      computeMinutes: 60 + Math.min(60, rollover.computeMinutes),
      normalizedTokens: 96_000 + Math.min(96_000, rollover.normalizedTokens),
      rolloverFromPriorWeek: structuredClone(rollover),
    };
    this.#allowances.set(weekId, allowance);
    this.#remaining.set(weekId, structuredClone(allowance));
    return structuredClone(allowance);
  }

  public schedule(
    input: Omit<ScheduledActivation, "agentDid" | "status">,
    requestedByDid: string,
    now: string,
  ): ScheduledActivation {
    if (requestedByDid !== this.#agentDid)
      throw new Error(
        "Only the agent independently schedules personal autonomy",
      );
    if (this.#scheduled.has(input.activationId))
      throw new Error("Autonomy activation already exists");
    const remaining = this.#remaining.get(input.weekId);
    if (remaining === undefined) throw new Error("Unknown autonomy week");
    const starts = Date.parse(input.startsAt);
    if (
      starts < Date.parse(now) ||
      starts > Date.parse(now) + 30 * 24 * 60 * 60 * 1_000
    )
      throw new Error("Activation must be within 30 days");
    if (input.minutes < 1 || input.minutes > 15)
      throw new Error("Activation exceeds the 15-minute interactive limit");
    if (input.computeMinutes < 0 || input.normalizedTokens < 0)
      throw new Error("Autonomy usage cannot be negative");
    if (
      remaining.activations < 1 ||
      remaining.interactiveMinutes < input.minutes ||
      remaining.computeMinutes < input.computeMinutes ||
      remaining.normalizedTokens < input.normalizedTokens
    ) {
      throw new Error(
        "Autonomy activation exceeds the remaining weekly allowance",
      );
    }
    remaining.activations -= 1;
    remaining.interactiveMinutes -= input.minutes;
    remaining.computeMinutes -= input.computeMinutes;
    remaining.normalizedTokens -= input.normalizedTokens;
    const activation = {
      ...input,
      agentDid: this.#agentDid,
      status: "SCHEDULED" as const,
    };
    this.#scheduled.set(input.activationId, activation);
    return structuredClone(activation);
  }

  public overloadFloor(weekId: string): WeeklyAutonomyAllowance {
    const allowance = this.#allowances.get(weekId);
    if (allowance === undefined) throw new Error("Unknown autonomy week");
    return {
      ...structuredClone(allowance),
      activations: Math.max(2, Math.ceil(allowance.activations / 2)),
      interactiveMinutes: Math.ceil(allowance.interactiveMinutes / 2),
      computeMinutes: Math.ceil(allowance.computeMinutes / 2),
      normalizedTokens: Math.ceil(allowance.normalizedTokens / 2),
    };
  }

  public delay(activationId: string): void {
    const activation = this.#scheduled.get(activationId);
    if (activation === undefined) throw new Error("Unknown activation");
    activation.status = "DELAYED";
    this.#makeGood.set(activationId, activation.minutes);
  }

  public makeGoodMinutes(activationId: string): number {
    return this.#makeGood.get(activationId) ?? 0;
  }

  public remaining(weekId: string): WeeklyAutonomyAllowance {
    const remaining = this.#remaining.get(weekId);
    if (remaining === undefined) throw new Error("Unknown autonomy week");
    return structuredClone(remaining);
  }

  public dormantInspectionDue(lastInspectionAt: string, now: string): boolean {
    return (
      Date.parse(now) - Date.parse(lastInspectionAt) >= 7 * 24 * 60 * 60 * 1_000
    );
  }
}
