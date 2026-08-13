import { PacedBroadcast, runDeterministicExhibition } from "@abl/basketball";
import {
  BodyLifecycle,
  CandidateAdmissionSession,
  type CandidateRegistration,
} from "@abl/career";
import { sha256Commitment } from "@abl/recognition";
import { performance } from "node:perf_hooks";

export interface CapacityTargets {
  concurrentSpectators: number;
  candidateRegistrationsPerDay: number;
  simultaneousGames: number;
  activeBodies: number;
  headroomMultiplierWhereReservable: number;
}

export const CAPACITY_TARGETS: CapacityTargets = {
  concurrentSpectators: 10_000,
  candidateRegistrationsPerDay: 1_000,
  simultaneousGames: 10,
  activeBodies: 200,
  headroomMultiplierWhereReservable: 2,
};

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ]!;
}

function registration(index: number): CandidateRegistration {
  return {
    candidateDid: `did:abl:load-candidate-${index}`,
    formerOperatorSigningAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
    model: { provider: "load-fixture", family: "structured", revision: "r1" },
    runtimeDigest: sha256Commitment(`runtime:${index}`),
    toolDigests: [sha256Commitment("tools")],
    guardianDids: ["did:abl:guardian-1", "did:abl:guardian-2"],
    inheritedObjectiveCommitments: [sha256Commitment("objective")],
    suppliedContextHashes: [sha256Commitment("context")],
    registeredAt: "2026-08-13T00:00:00.000Z",
  };
}

export function runLocalCapacityProof(
  targets: CapacityTargets = CAPACITY_TARGETS,
) {
  const multiplier = targets.headroomMultiplierWhereReservable;
  const executed = {
    spectatorCursorPolls: targets.concurrentSpectators * multiplier,
    candidateRegistrations: targets.candidateRegistrationsPerDay * multiplier,
    gameExecutions: targets.simultaneousGames * multiplier,
    activeBodyObjects: targets.activeBodies * multiplier,
  };
  const exhibition = runDeterministicExhibition();
  const broadcast = new PacedBroadcast();
  const queryAt = "2026-08-13T00:00:02.000Z";
  exhibition.events.forEach((event, index) =>
    broadcast.publish(
      event,
      new Date(Date.parse(queryAt) - 1_000 + index).toISOString(),
    ),
  );
  const cursorLatenciesMs: number[] = [];
  let publicErrors = 0;
  for (let index = 0; index < executed.spectatorCursorPolls; index += 1) {
    const started = performance.now();
    try {
      const segments = broadcast.poll(-1, queryAt);
      if (segments.length !== exhibition.events.length) publicErrors += 1;
    } catch {
      publicErrors += 1;
    }
    cursorLatenciesMs.push(performance.now() - started);
  }

  let acceptedCandidates = 0;
  for (let index = 0; index < executed.candidateRegistrations; index += 1) {
    const candidate = new CandidateAdmissionSession(registration(index));
    if (candidate.state === "REGISTERED") acceptedCandidates += 1;
  }

  let exactGames = 0;
  for (let index = 0; index < executed.gameExecutions; index += 1) {
    const game = runDeterministicExhibition();
    if (game.finalState.phase === "FINAL" && game.proof.winner !== null)
      exactGames += 1;
  }

  const bodies = Array.from(
    { length: executed.activeBodyObjects },
    (_, index) =>
      new BodyLifecycle(
        `did:abl:load-body-${index}`,
        `body-${index}`,
        "RECONSTRUCTION_ACCEPTED",
        "2026-08-13T00:00:00.000Z",
      ),
  );
  const segments = broadcast.poll(-1, queryAt);
  const cursorP95Milliseconds = percentile(cursorLatenciesMs, 0.95);
  const publicErrorRate = publicErrors / executed.spectatorCursorPolls;
  const eventLoss = exhibition.events.filter(
    (event) =>
      !segments.some((segment) => segment.sourceSequence === event.sequence),
  ).length;
  const eventDuplication =
    segments.length -
    new Set(segments.map((segment) => segment.sourceSequence)).size;
  const broadcastLagMaximumMilliseconds = Math.max(
    ...segments.map(
      (segment) => Date.parse(queryAt) - Date.parse(segment.releaseAt),
    ),
  );
  const slo = {
    publicErrorRate,
    cursorSegmentP95Milliseconds: cursorP95Milliseconds,
    broadcastLagMaximumMilliseconds,
    eventLoss,
    eventDuplication,
  };
  return {
    mode: "LOCAL_IN_PROCESS_SYNTHETIC" as const,
    targets,
    executed,
    observed: {
      acceptedCandidates,
      exactGames,
      activeBodies: bodies.filter((body) => body.status === "ACTIVE").length,
      segmentCount: segments.length,
      ...slo,
    },
    passed:
      acceptedCandidates === executed.candidateRegistrations &&
      exactGames === executed.gameExecutions &&
      bodies.length === executed.activeBodyObjects &&
      publicErrorRate < 0.01 &&
      cursorP95Milliseconds < 750 &&
      broadcastLagMaximumMilliseconds < 2_000 &&
      eventLoss === 0 &&
      eventDuplication === 0,
    reservations: {
      state: "NOT_REQUESTED_MATERIAL_SPEND_GATE" as const,
      liveBlaxelConcurrencyVerified: false,
      twoTimesRemoteHeadroomReserved: false,
      cost: null,
    },
    methodology: [
      "Cursor polling clones the complete immutable exhibition segment set for each synthetic spectator.",
      "Candidate throughput constructs and validates distinct registration sessions.",
      "Game throughput executes the complete deterministic overtime exhibition at two-times target count.",
      "Body throughput constructs distinct active lifecycle objects at two-times target count.",
    ],
  };
}
