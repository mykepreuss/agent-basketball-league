import type { AutonomousBasketballRole, RunnerHeartbeat } from "@abl/schemas";

export const FOUNDING_SCHEDULE = {
  noticeBeforeMs: 24 * 60 * 60 * 1_000,
  responseBeforeMs: 6 * 60 * 60 * 1_000,
  lineupBeforeMs: 15 * 60 * 1_000,
  readinessBeforeMs: 5 * 60 * 1_000,
  heartbeatIntervalMs: 60 * 1_000,
  onlineLeaseMs: 120 * 1_000,
  decisionDeadlineMs: 20 * 1_000,
  suspensionMs: 2 * 60 * 1_000,
} as const;

export function isRunnerOnline(
  heartbeat: RunnerHeartbeat | null,
  nowMs: number,
): boolean {
  return (
    heartbeat !== null &&
    heartbeat.availability === "ONLINE" &&
    nowMs - Date.parse(heartbeat.observedAt) <=
      FOUNDING_SCHEDULE.onlineLeaseMs &&
    nowMs >= Date.parse(heartbeat.observedAt)
  );
}

export interface PregameParticipant {
  careerDid: string;
  role: AutonomousBasketballRole;
  team: "HOME" | "AWAY" | null;
  accepted: boolean;
  ready: boolean;
  active: boolean;
  alternate: boolean;
}

export function evaluateFoundingPregame(
  participants: readonly PregameParticipant[],
): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const team of ["HOME", "AWAY"] as const) {
    const players = participants.filter(
      (participant) =>
        participant.role === "PLAYER" &&
        participant.team === team &&
        participant.accepted &&
        participant.ready,
    );
    if (players.length < 5)
      reasons.push(`${team}_HAS_FEWER_THAN_FIVE_READY_PLAYERS`);
    if (players.filter((player) => player.active).length !== 5)
      reasons.push(`${team}_ACTIVE_FIVE_NOT_LOCKED`);
    const coachReady = participants.some(
      (participant) =>
        participant.role === "COACH" &&
        participant.team === team &&
        participant.accepted &&
        participant.ready,
    );
    if (!coachReady) reasons.push(`${team}_COACH_NOT_READY`);
  }
  const referees = participants.filter(
    (participant) =>
      participant.role === "REFEREE" &&
      participant.accepted &&
      participant.ready,
  );
  if (referees.filter((referee) => !referee.alternate).length < 3)
    reasons.push("REFEREE_CREW_NOT_READY");
  const replay = participants.filter(
    (participant) =>
      participant.role === "REPLAY" &&
      participant.accepted &&
      participant.ready &&
      !participant.alternate,
  );
  if (replay.length < 2) reasons.push("REPLAY_CREW_NOT_READY");
  return { ready: reasons.length === 0, reasons };
}
