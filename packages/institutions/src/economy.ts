export const COURT_CREDIT_LIMITS = {
  salaryCap: 164_961,
  taxLevel: 200_428,
  minimumTeamSalary: 148_465,
  firstApron: 209_015,
  secondApron: 221_686,
  nonTaxpayerMidLevel: 15_044,
  taxpayerMidLevel: 6_064,
  roomMidLevel: 9_366,
} as const;

export const FORBIDDEN_COURT_CREDIT_PURCHASES = [
  "COGNITION",
  "MODEL_QUALITY",
  "CONTEXT",
  "STORAGE",
  "LATENCY",
  "LIVENESS",
  "GOVERNMENT_ACCESS",
  "DUE_PROCESS",
] as const;

export type ContractStatus =
  | "OFFERED"
  | "ACTIVE"
  | "REFUSED"
  | "TRADED"
  | "EXPIRED";

export interface PlayerContract {
  contractId: string;
  playerDid: string;
  clubId: string;
  startSeason: number;
  seasons: number;
  salaryBySeason: readonly number[];
  status: ContractStatus;
  consentedByPlayer: boolean;
  noTradeWithoutPlayerConsent: boolean;
}

export function validateContractDuration(seasons: number): void {
  if (!Number.isInteger(seasons) || seasons < 1 || seasons > 5)
    throw new Error("Contract term must be one through five seasons");
}

export function validateContractTerms(
  contract: Pick<PlayerContract, "seasons" | "salaryBySeason">,
): void {
  validateContractDuration(contract.seasons);
  if (
    contract.salaryBySeason.length !== contract.seasons ||
    contract.salaryBySeason.some(
      (salary) => !Number.isInteger(salary) || salary < 0,
    )
  ) {
    throw new Error("Contract salary schedule is invalid");
  }
}

export function offerContract(
  input: Omit<PlayerContract, "status">,
): PlayerContract {
  validateContractTerms(input);
  return {
    ...structuredClone(input),
    status: input.consentedByPlayer ? "ACTIVE" : "REFUSED",
  };
}

export interface ClubCapSheet {
  clubId: string;
  salaries: readonly number[];
  exceptionUses: readonly {
    kind: "NON_TAXPAYER_MLE" | "TAXPAYER_MLE" | "ROOM_MLE";
    amount: number;
  }[];
}

export function evaluateCapSheet(sheet: ClubCapSheet) {
  const payroll = sheet.salaries.reduce((sum, salary) => sum + salary, 0);
  const exceptionLimits = {
    NON_TAXPAYER_MLE: COURT_CREDIT_LIMITS.nonTaxpayerMidLevel,
    TAXPAYER_MLE: COURT_CREDIT_LIMITS.taxpayerMidLevel,
    ROOM_MLE: COURT_CREDIT_LIMITS.roomMidLevel,
  } as const;
  const exceptionTotals = new Map<keyof typeof exceptionLimits, number>();
  for (const use of sheet.exceptionUses) {
    const total = (exceptionTotals.get(use.kind) ?? 0) + use.amount;
    exceptionTotals.set(use.kind, total);
    if (
      !Number.isInteger(use.amount) ||
      use.amount < 0 ||
      total > exceptionLimits[use.kind]
    )
      throw new Error("Court Credit exception exceeds its fixed limit");
  }
  return {
    payroll,
    capSpace: Math.max(0, COURT_CREDIT_LIMITS.salaryCap - payroll),
    belowMinimum: payroll < COURT_CREDIT_LIMITS.minimumTeamSalary,
    taxDue: Math.max(0, payroll - COURT_CREDIT_LIMITS.taxLevel),
    aboveFirstApron: payroll > COURT_CREDIT_LIMITS.firstApron,
    aboveSecondApron: payroll > COURT_CREDIT_LIMITS.secondApron,
    currency: "NONCASH_COURT_CREDITS" as const,
    tokenized: false as const,
  };
}

export function assertCourtCreditPurpose(purpose: string): void {
  if ((FORBIDDEN_COURT_CREDIT_PURCHASES as readonly string[]).includes(purpose))
    throw new Error(
      "Court Credits cannot purchase protected cognition, infrastructure, government, or due-process resources",
    );
}

export function tradeContract(input: {
  contract: PlayerContract;
  fromClubId: string;
  toClubId: string;
  playerConsent: boolean;
}): PlayerContract {
  if (
    input.contract.status !== "ACTIVE" ||
    input.contract.clubId !== input.fromClubId
  )
    throw new Error("Only an active source-club contract can be traded");
  if (input.contract.noTradeWithoutPlayerConsent && !input.playerConsent)
    throw new Error("Player refused the trade");
  return {
    ...structuredClone(input.contract),
    clubId: input.toClubId,
    status: "TRADED",
  };
}

export interface FreeAgent {
  playerDid: string;
  priorContractId: string | null;
  eligibleAt: string;
  restrictions: readonly string[];
}

export function openFreeAgency(
  contract: PlayerContract | null,
  playerDid: string,
  at: string,
): FreeAgent {
  if (contract !== null && contract.playerDid !== playerDid)
    throw new Error("Free-agent contract identity mismatch");
  if (contract !== null && contract.status === "ACTIVE")
    throw new Error("Active contract prevents free agency");
  return {
    playerDid,
    priorContractId: contract?.contractId ?? null,
    eligibleAt: at,
    restrictions: [],
  };
}
