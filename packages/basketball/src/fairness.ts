import { sha256Commitment } from "@abl/recognition";

import type { CognitionReceipt } from "./types.js";

export type CompetitionRole = CognitionReceipt["role"];

export interface RoleEnvelope {
  role: CompetitionRole;
  deadlineMs: number;
  maxAttempts: number;
  fallbackPolicyDigest: `0x${string}`;
}

export interface ParticipantReadiness {
  participantDid: string;
  role: CompetitionRole;
  providerStatus: "READY" | "UNAVAILABLE";
  envelope: RoleEnvelope;
}

const requiredCounts: Record<CompetitionRole, number> = {
  PLAYER: 10,
  COACH: 2,
  REFEREE: 3,
  REPLAY: 2,
};

export function evaluateGameReadiness(
  participants: readonly ParticipantReadiness[],
) {
  if (
    new Set(participants.map((participant) => participant.participantDid))
      .size !== participants.length
  )
    throw new Error("Game readiness contains duplicate participants");
  for (const role of Object.keys(requiredCounts) as CompetitionRole[]) {
    const members = participants.filter(
      (participant) => participant.role === role,
    );
    if (members.length !== requiredCounts[role])
      throw new Error(
        `Game requires ${requiredCounts[role]} ${role} participants`,
      );
    const reference = sha256Commitment(members[0]!.envelope);
    if (
      members.some((member) => sha256Commitment(member.envelope) !== reference)
    )
      throw new Error(`${role} resource envelopes are unequal`);
  }
  const unavailable = participants
    .filter((participant) => participant.providerStatus !== "READY")
    .map((participant) => participant.participantDid);
  return unavailable.length === 0
    ? { status: "READY" as const, unavailable, wholeGamePostponed: false }
    : { status: "POSTPONED" as const, unavailable, wholeGamePostponed: true };
}

export function validateCompetitionReceipt(
  receipt: CognitionReceipt,
  envelope: RoleEnvelope,
): void {
  if (
    receipt.role !== envelope.role ||
    receipt.deadlineMs !== envelope.deadlineMs ||
    receipt.attempts > envelope.maxAttempts ||
    receipt.telemetryContentPolicy !== "CONTENT_FREE"
  ) {
    throw new Error("Cognition receipt violates the equal role envelope");
  }
}

export class PreparationComputeLedger {
  readonly #weeklyCap: number;
  readonly #usage = new Map<string, number>();

  public constructor(weeklyCap: number) {
    if (!Number.isInteger(weeklyCap) || weeklyCap < 1)
      throw new Error("Preparation cap must be positive");
    this.#weeklyCap = weeklyCap;
  }

  public charge(playerDid: string, normalizedUnits: number): number {
    const next = (this.#usage.get(playerDid) ?? 0) + normalizedUnits;
    if (normalizedUnits < 0 || next > this.#weeklyCap)
      throw new Error("Preparation compute cap exceeded");
    this.#usage.set(playerDid, next);
    return this.#weeklyCap - next;
  }
}
