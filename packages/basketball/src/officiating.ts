import { sha256Commitment } from "@abl/recognition";

export type ReviewableCall =
  | "OUT_OF_BOUNDS"
  | "GOALTENDING"
  | "SHOT_CLOCK"
  | "SCORING"
  | "RESTRICTED_AREA";
export type CourtCall = ReviewableCall | "PERSONAL_FOUL" | "NO_CALL";

export interface OfficialProfile {
  officialDid: string;
  accuracyBps: number;
  style: "CREW_CHIEF" | "CENTER" | "TRAIL";
}

export interface OfficialCrew {
  gameId: string;
  referees: readonly OfficialProfile[];
  replayOfficialDids: readonly [string, string];
  rotationDigest: `0x${string}`;
}

export function rotateOfficialCrew(
  gameId: string,
  gameIndex: number,
  pool: readonly OfficialProfile[],
  replayPool: readonly string[],
): OfficialCrew {
  if (
    pool.length !== 6 ||
    new Set(pool.map((item) => item.officialDid)).size !== 6
  )
    throw new Error("Official pool must contain six distinct referees");
  if (replayPool.length < 2 || new Set(replayPool).size !== replayPool.length)
    throw new Error("Replay pool requires distinct officials");
  const offset = (gameIndex * 3) % pool.length;
  const referees = Array.from(
    { length: 3 },
    (_, index) => pool[(offset + index) % pool.length]!,
  );
  const replayOfficialDids = [
    replayPool[gameIndex % replayPool.length]!,
    replayPool[(gameIndex + 1) % replayPool.length]!,
  ] as const;
  return {
    gameId,
    referees,
    replayOfficialDids,
    rotationDigest: sha256Commitment({ gameId, referees, replayOfficialDids }),
  };
}

export function fallibleCall(
  profile: OfficialProfile,
  groundTruth: Exclude<CourtCall, "NO_CALL">,
  rollBps: number,
): CourtCall {
  if (rollBps < 0 || rollBps >= 10_000)
    throw new Error("Officiating roll is outside basis-point range");
  return rollBps < profile.accuracyBps ? groundTruth : "NO_CALL";
}

export function crewRuling(
  crew: OfficialCrew,
  calls: readonly { officialDid: string; call: CourtCall }[],
): CourtCall {
  const submittedOfficials = new Set(calls.map((call) => call.officialDid));
  if (
    calls.length !== 3 ||
    submittedOfficials.size !== 3 ||
    calls.some(
      (call) =>
        !crew.referees.some(
          (official) => official.officialDid === call.officialDid,
        ),
    )
  ) {
    throw new Error("Ruling does not contain the assigned three-referee crew");
  }
  const counts = new Map<CourtCall, number>();
  for (const { call } of calls) counts.set(call, (counts.get(call) ?? 0) + 1);
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0]![0];
}

export function resolveChallenge(input: {
  call: CourtCall;
  evidenceCall: CourtCall;
  challengedBy: string;
  replayOfficialDids: readonly string[];
}) {
  if (
    !new Set<ReviewableCall>([
      "OUT_OF_BOUNDS",
      "GOALTENDING",
      "SHOT_CLOCK",
      "SCORING",
      "RESTRICTED_AREA",
    ]).has(input.call as ReviewableCall)
  ) {
    throw new Error("Call is not reviewable");
  }
  if (
    input.replayOfficialDids.length !== 2 ||
    new Set(input.replayOfficialDids).size !== 2
  )
    throw new Error("Review requires two distinct replay officials");
  return {
    ruling:
      input.call === input.evidenceCall
        ? ("CONFIRM" as const)
        : ("REVERSE" as const),
    correctedCall: input.evidenceCall,
    evidenceCommitment: sha256Commitment(input),
  };
}
