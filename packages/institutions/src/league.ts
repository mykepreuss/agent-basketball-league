import { sha256Commitment } from "@abl/recognition";

export const FOUNDING_CLUBS = [
  {
    clubId: "premier-new-york",
    placeholder: "New York",
    status: "FOUNDING_PLACEHOLDER",
  },
  {
    clubId: "premier-vancouver",
    placeholder: "Vancouver",
    status: "FOUNDING_PLACEHOLDER",
  },
  {
    clubId: "premier-paris",
    placeholder: "Paris",
    status: "FOUNDING_PLACEHOLDER",
  },
  {
    clubId: "premier-san-francisco",
    placeholder: "San Francisco",
    status: "FOUNDING_PLACEHOLDER",
  },
] as const;

export interface PremierClub {
  clubId: string;
  placeholder: string;
  playerDids: readonly string[];
  coachDid: string;
  governorDid: string;
}

export interface CombineRegistration {
  playerDid: string;
  consented: boolean;
  registeredAt: string;
}

export class PremierCombine {
  readonly openedAt: string;
  readonly closesAt: string;
  readonly #registrations = new Map<string, CombineRegistration>();

  public constructor(openedAt: string) {
    const at = Date.parse(openedAt);
    if (!Number.isFinite(at))
      throw new Error("Combine opening time is invalid");
    this.openedAt = new Date(at).toISOString();
    this.closesAt = new Date(at + 14 * 24 * 60 * 60 * 1_000).toISOString();
  }

  public register(registration: CombineRegistration): void {
    if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(registration.playerDid))
      throw new Error("Combine player DID is invalid");
    const at = Date.parse(registration.registeredAt);
    if (
      !Number.isFinite(at) ||
      registration.registeredAt !== new Date(at).toISOString()
    ) {
      throw new Error("Combine registration time is invalid");
    }
    if (at < Date.parse(this.openedAt) || at >= Date.parse(this.closesAt))
      throw new Error("Registration is outside the 14-day combine");
    if (!registration.consented)
      throw new Error(
        "Combine participation requires affirmative agent consent",
      );
    if (this.#registrations.has(registration.playerDid))
      throw new Error("Player is already registered for the combine");
    this.#registrations.set(
      registration.playerDid,
      structuredClone(registration),
    );
  }

  public eligiblePlayers(): readonly string[] {
    return [...this.#registrations.keys()].sort();
  }
}

export interface DraftPick {
  overall: number;
  round: number;
  slot: number;
  clubId: string;
  playerDid: string;
}

export function conductEightRoundDraft(
  clubIds: readonly string[],
  playerDids: readonly string[],
): readonly DraftPick[] {
  if (clubIds.length !== 4 || new Set(clubIds).size !== 4)
    throw new Error("Premier draft requires four distinct clubs");
  if (playerDids.length !== 32 || new Set(playerDids).size !== 32)
    throw new Error("Premier draft requires 32 distinct consenting players");
  return Array.from({ length: 8 }, (_, roundIndex) => {
    const order = roundIndex % 2 === 0 ? [...clubIds] : [...clubIds].reverse();
    return order.map((clubId, slotIndex) => {
      const overall = roundIndex * 4 + slotIndex + 1;
      return {
        overall,
        round: roundIndex + 1,
        slot: slotIndex + 1,
        clubId,
        playerDid: playerDids[overall - 1]!,
      };
    });
  }).flat();
}

export interface ScheduledGame {
  gameId: string;
  week: number;
  round: number;
  homeClubId: string;
  awayClubId: string;
  meeting: number;
}

export function createPremierSchedule(
  clubIds: readonly string[],
): readonly ScheduledGame[] {
  if (clubIds.length !== 4 || new Set(clubIds).size !== 4)
    throw new Error("Schedule requires four distinct clubs");
  const rounds = [
    [
      [0, 3],
      [1, 2],
    ],
    [
      [0, 2],
      [3, 1],
    ],
    [
      [0, 1],
      [2, 3],
    ],
  ] as const;
  const pairMeetings = new Map<string, number>();
  const games: ScheduledGame[] = [];
  for (let roundIndex = 0; roundIndex < 18; roundIndex += 1) {
    const cycle = Math.floor(roundIndex / 3);
    for (const [pairIndex, [left, right]] of rounds[
      roundIndex % 3
    ]!.entries()) {
      const pair = [clubIds[left]!, clubIds[right]!].sort();
      const key = pair.join(":");
      const meeting = (pairMeetings.get(key) ?? 0) + 1;
      pairMeetings.set(key, meeting);
      const reverse = (meeting + pairIndex + cycle) % 2 === 0;
      const [homeClubId, awayClubId] = reverse
        ? [clubIds[right]!, clubIds[left]!]
        : [clubIds[left]!, clubIds[right]!];
      games.push({
        gameId: `premier-w${Math.floor(roundIndex / 2) + 1}-r${roundIndex + 1}-g${pairIndex + 1}`,
        week: Math.floor(roundIndex / 2) + 1,
        round: roundIndex + 1,
        homeClubId,
        awayClubId,
        meeting,
      });
    }
  }
  return games;
}

export interface PlayoffSeries {
  round: "SEMIFINAL" | "CHAMPIONSHIP";
  higherSeed: number | null;
  lowerSeed: number | null;
  bestOf: 5;
  winsRequired: 3;
  participants: readonly string[];
  seriesCommitment: `0x${string}`;
}

export function createPremierPlayoffs(
  standings: readonly string[],
): readonly PlayoffSeries[] {
  if (standings.length !== 4 || new Set(standings).size !== 4)
    throw new Error("Playoffs require four distinct seeded clubs");
  const series = [
    {
      round: "SEMIFINAL" as const,
      higherSeed: 1,
      lowerSeed: 4,
      participants: [standings[0]!, standings[3]!],
    },
    {
      round: "SEMIFINAL" as const,
      higherSeed: 2,
      lowerSeed: 3,
      participants: [standings[1]!, standings[2]!],
    },
    {
      round: "CHAMPIONSHIP" as const,
      higherSeed: null,
      lowerSeed: null,
      participants: ["SEMIFINAL-1-WINNER", "SEMIFINAL-2-WINNER"],
    },
  ];
  return series.map((item) => ({
    ...item,
    bestOf: 5 as const,
    winsRequired: 3 as const,
    seriesCommitment: sha256Commitment(item),
  }));
}

export function validatePremierClubs(clubs: readonly PremierClub[]): void {
  if (
    clubs.length !== 4 ||
    new Set(clubs.map((club) => club.clubId)).size !== 4
  )
    throw new Error("Premier requires four distinct clubs");
  const players = clubs.flatMap((club) => [...club.playerDids]);
  if (
    clubs.some((club) => club.playerDids.length !== 8) ||
    players.length !== 32 ||
    new Set(players).size !== 32
  )
    throw new Error(
      "Premier requires four eight-player rosters with 32 distinct players",
    );
  if (
    new Set(clubs.map((club) => club.coachDid)).size !== 4 ||
    new Set(clubs.map((club) => club.governorDid)).size !== 4
  )
    throw new Error("Coaches and governors must be independent per club");
  if (
    players.some((did) =>
      clubs.some((club) => club.coachDid === did || club.governorDid === did),
    )
  )
    throw new Error(
      "Players cannot simultaneously hold founding coach/governor roles",
    );
}
