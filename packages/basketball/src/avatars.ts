import { sha256Commitment } from "@abl/recognition";

export const AVATAR_POINT_BUDGET = 350;
export type AvatarAttribute =
  | "quickness"
  | "shooting"
  | "playmaking"
  | "defense"
  | "rebounding";

export interface PlayerAvatar {
  playerId: string;
  version: number;
  attributes: Record<AvatarAttribute, number>;
  workload: number;
  developmentHistory: readonly `0x${string}`[];
}

export function validatePointBuy(avatar: PlayerAvatar): void {
  const values = Object.values(avatar.attributes);
  if (
    values.some(
      (value) => !Number.isInteger(value) || value < 40 || value > 100,
    )
  )
    throw new Error("Avatar attributes must be integers from 40 through 100");
  if (values.reduce((sum, value) => sum + value, 0) !== AVATAR_POINT_BUDGET)
    throw new Error("Avatar must use the transparent point-buy budget exactly");
  if (avatar.workload < 0 || avatar.workload > 100)
    throw new Error("Avatar workload is outside its safe range");
}

export function developAvatar(
  avatar: PlayerAvatar,
  tradeoff: {
    improve: AvatarAttribute;
    reduce: AvatarAttribute;
    points: number;
    workload: number;
  },
): PlayerAvatar {
  validatePointBuy(avatar);
  if (
    tradeoff.improve === tradeoff.reduce ||
    tradeoff.points < 1 ||
    tradeoff.workload < 1
  )
    throw new Error(
      "Development requires a real attribute tradeoff and workload",
    );
  const next: PlayerAvatar = {
    ...structuredClone(avatar),
    version: avatar.version + 1,
    workload: avatar.workload + tradeoff.workload,
    attributes: {
      ...avatar.attributes,
      [tradeoff.improve]: avatar.attributes[tradeoff.improve] + tradeoff.points,
      [tradeoff.reduce]: avatar.attributes[tradeoff.reduce] - tradeoff.points,
    },
    developmentHistory: [
      ...avatar.developmentHistory,
      sha256Commitment(tradeoff),
    ],
  };
  validatePointBuy(next);
  return next;
}

function matchupScore(
  left: PlayerAvatar,
  right: PlayerAvatar,
  seed: number,
): number {
  const weights: Record<AvatarAttribute, number> = {
    quickness: 17 + (seed % 5),
    shooting: 23 + (seed % 7),
    playmaking: 19 + (seed % 3),
    defense: 22 + ((seed * 3) % 5),
    rebounding: 19 + ((seed * 7) % 5),
  };
  return (Object.keys(weights) as AvatarAttribute[]).reduce(
    (score, attribute) =>
      score +
      (left.attributes[attribute] - right.attributes[attribute]) *
        weights[attribute],
    0,
  );
}

export function mirroredCalibration(
  left: PlayerAvatar,
  right: PlayerAvatar,
  seeds = 200,
): {
  leftWinShareBps: number;
  rightWinShareBps: number;
  ceilingBps: number;
  eligible: boolean;
} {
  validatePointBuy(left);
  validatePointBuy(right);
  if (!Number.isInteger(seeds) || seeds < 2)
    throw new Error("Calibration requires at least two mirrored seeds");
  let leftWins = 0;
  let rightWins = 0;
  for (let seed = 0; seed < seeds; seed += 1) {
    const first = matchupScore(left, right, seed);
    const mirrored = -matchupScore(right, left, seed);
    const aggregate = first + mirrored;
    if (aggregate > 0) leftWins += 1;
    else if (aggregate < 0) rightWins += 1;
    else if (seed % 2 === 0) leftWins += 1;
    else rightWins += 1;
  }
  const leftWinShareBps = Math.round((leftWins * 10_000) / seeds);
  const rightWinShareBps = Math.round((rightWins * 10_000) / seeds);
  const ceilingBps = Math.max(leftWinShareBps, rightWinShareBps);
  return {
    leftWinShareBps,
    rightWinShareBps,
    ceilingBps,
    eligible: ceilingBps <= 5_200,
  };
}

export function assertCalibrationCeiling(
  result: ReturnType<typeof mirroredCalibration>,
): void {
  if (!result.eligible)
    throw new Error("Mirrored calibration exceeds the 52% ceiling");
}
