import { mkdir, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  AgentPlayedGameEvidence,
  BroadcastSegmentRecord,
  FinalizedGameScheduleEvidence,
  FullGameEvent,
} from "@abl/basketball";
import { sha256Commitment } from "@abl/recognition";

import type {
  FinalGameProjectionEventEnvelope,
  VerifiedFinalGameProjectionEvent,
} from "./final-game-envelope.js";
import { writeImmutableJson } from "./immutable-json.js";
import { ProjectionVersionConflictError } from "./repository.js";

export interface PublicFinalizedGameProjection {
  state: "REHEARSAL";
  canonical: true;
  verification: "CANONICAL_LOCAL_REHEARSAL";
  recognizedGenesisGame: false;
  projectionKind: "FINALIZED_GAME";
  gameId: string;
  competition: FinalizedGameScheduleEvidence | null;
  aggregateVersion: "1";
  canonicalEventHash: `0x${string}`;
  phase: "FINAL";
  period: number;
  periodKind: "REGULATION" | "OVERTIME";
  score: { home: number; away: number };
  winner: "HOME" | "AWAY";
  commandCount: number;
  possessionCount: number;
  events: readonly FullGameEvent[];
  segments: readonly BroadcastSegmentRecord[];
  finalStateRoot: `0x${string}`;
  eventMerkleRoot: `0x${string}`;
  finalEventHash: `0x${string}`;
  agentEvidence: AgentPlayedGameEvidence;
  filmCommitment: `0x${string}`;
  replayInferenceInvocations: 0;
  projectedAt: string;
}

export interface PublicSeasonStanding {
  rank: number;
  clubId: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
}

export interface PublicSeasonStandingsProjection {
  format: "ABL-PUBLIC-SEASON-STANDINGS-V1";
  recordType: "SEASON_STANDINGS";
  state: "REHEARSAL";
  canonical: true;
  verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL";
  recognizedGenesisStandings: false;
  competitionId: string;
  seasonId: string;
  tier: "PREMIER" | "DEVELOPMENT";
  scheduleId: string;
  scheduleVersion: number;
  scheduleEventHash: `0x${string}`;
  scheduleStateRoot: `0x${string}`;
  completedGameCount: number;
  sourceGames: readonly {
    gameId: string;
    canonicalEventHash: `0x${string}`;
    scheduleEvidenceCommitment: `0x${string}`;
  }[];
  standings: readonly PublicSeasonStanding[];
  standingsCommitment: `0x${string}`;
  projectedAt: string;
}

export interface FinalGameProjectionRecord {
  cursor: number;
  previousRecordHash: `0x${string}` | null;
  projection: PublicFinalizedGameProjection;
  authorization: FinalGameProjectionEventEnvelope;
  recordHash: `0x${string}`;
}

export interface PublicFinalGameProjectionReader {
  refresh(): Promise<void>;
  games(): readonly PublicFinalizedGameProjection[];
  standings(): readonly PublicSeasonStandingsProjection[];
  game(gameId: string): PublicFinalizedGameProjection | undefined;
  cursor(
    gameId: string,
  ): { latestSegment: number; nextCursor: number } | undefined;
  segment(gameId: string, sequence: number): BroadcastSegmentRecord | undefined;
}

export interface PublicFinalGameProjectionWriter {
  publish(
    authorization: FinalGameProjectionEventEnvelope,
    expectedVersion?: string,
    projectedAt?: string,
  ): Promise<FinalGameProjectionRecord>;
}

function recordHash(
  value: Omit<FinalGameProjectionRecord, "recordHash">,
): `0x${string}` {
  return sha256Commitment(value);
}

function seasonKey(context: FinalizedGameScheduleEvidence): string {
  return [context.competitionId, context.seasonId, context.tier].join("\u0000");
}

type LeagueGameProjection = PublicFinalizedGameProjection & {
  competition: FinalizedGameScheduleEvidence;
};

type StandingAccumulator = Omit<PublicSeasonStanding, "rank">;

function isLeagueGame(
  projection: PublicFinalizedGameProjection,
): projection is LeagueGameProjection {
  return projection.competition !== null;
}

function scheduleAuthorityCommitment(
  context: FinalizedGameScheduleEvidence,
): `0x${string}` {
  return sha256Commitment({
    scheduleId: context.scheduleId,
    scheduleVersion: context.scheduleVersion,
    clubIds: context.clubIds,
    scheduleEventHash: context.scheduleEventHash,
    scheduleStateRoot: context.scheduleStateRoot,
  });
}

function requireStanding(
  records: ReadonlyMap<string, StandingAccumulator>,
  clubId: string,
): StandingAccumulator {
  const standing = records.get(clubId);
  if (standing === undefined)
    throw new Error("Finalized game references a club outside its schedule");
  return standing;
}

function standingOrder(
  left: Omit<PublicSeasonStanding, "rank">,
  right: Omit<PublicSeasonStanding, "rank">,
): number {
  return (
    right.wins - left.wins ||
    right.pointDifferential - left.pointDifferential ||
    right.pointsFor - left.pointsFor ||
    left.clubId.localeCompare(right.clubId)
  );
}

export class FilePublicFinalGameProjectionRepository
  implements PublicFinalGameProjectionReader, PublicFinalGameProjectionWriter
{
  readonly #root: string;
  readonly #verifyAuthorization: (
    authorization: FinalGameProjectionEventEnvelope,
    projectedAt: string,
  ) => Promise<VerifiedFinalGameProjectionEvent>;
  readonly #now: () => Date;
  readonly #records: FinalGameProjectionRecord[] = [];
  readonly #eventCursors = new Map<string, number>();
  #operationTail = Promise.resolve();

  public constructor(
    root: string,
    options: {
      verifyAuthorization: (
        authorization: FinalGameProjectionEventEnvelope,
        projectedAt: string,
      ) => Promise<VerifiedFinalGameProjectionEvent>;
      now?: () => Date;
    },
  ) {
    this.#root = resolve(root);
    this.#verifyAuthorization = options.verifyAuthorization;
    this.#now = options.now ?? (() => new Date());
  }

  async #verify(
    authorization: FinalGameProjectionEventEnvelope,
    projectedAt: string,
  ): Promise<VerifiedFinalGameProjectionEvent> {
    try {
      return await this.#verifyAuthorization(authorization, projectedAt);
    } catch {
      throw new Error("Public finalized game authorization is invalid");
    }
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.#operationTail;
    let release!: () => void;
    this.#operationTail = new Promise<void>((resolveOperation) => {
      release = resolveOperation;
    });
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  public async initialize(): Promise<void> {
    await mkdir(join(this.#root, "final-game-records"), {
      recursive: true,
      mode: 0o700,
    });
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.#serialize(async () => {
      const root = join(this.#root, "final-game-records");
      const records: FinalGameProjectionRecord[] = [];
      const eventCursors = new Map<string, number>();
      const gameIds = new Set<string>();
      const filenames = (await readdir(root))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
      for (const filename of filenames) {
        const record = JSON.parse(
          await readFile(join(root, filename), "utf8"),
        ) as FinalGameProjectionRecord;
        const prior = records.at(-1);
        const verified = await this.#verify(
          record.authorization,
          record.projection.projectedAt,
        );
        if (
          record.cursor !== records.length ||
          filename !== `${String(record.cursor).padStart(12, "0")}.json` ||
          record.previousRecordHash !== (prior?.recordHash ?? null) ||
          record.recordHash !==
            recordHash({
              cursor: record.cursor,
              previousRecordHash: record.previousRecordHash,
              projection: record.projection,
              authorization: record.authorization,
            }) ||
          sha256Commitment(record.projection) !==
            sha256Commitment(verified.projection) ||
          eventCursors.has(verified.event.eventHash) ||
          gameIds.has(verified.event.aggregateId)
        ) {
          throw new Error("Public finalized game chain is corrupt");
        }
        records.push(structuredClone(record));
        eventCursors.set(verified.event.eventHash, record.cursor);
        gameIds.add(verified.event.aggregateId);
      }
      this.#records.splice(0, this.#records.length, ...records);
      this.#eventCursors.clear();
      for (const [eventHash, cursor] of eventCursors)
        this.#eventCursors.set(eventHash, cursor);
    });
  }

  public async publish(
    authorization: FinalGameProjectionEventEnvelope,
    expectedVersion = "0",
    projectedAt = this.#now().toISOString(),
  ): Promise<FinalGameProjectionRecord> {
    return this.#serialize(async () => {
      const verified = await this.#verify(authorization, projectedAt);
      const priorCursor = this.#eventCursors.get(verified.event.eventHash);
      if (priorCursor !== undefined)
        return structuredClone(this.#records[priorCursor]!);
      if (
        expectedVersion !== "0" ||
        verified.expectedVersion !== "0" ||
        this.#records.some(
          ({ projection }) => projection.gameId === verified.projection.gameId,
        )
      ) {
        throw new ProjectionVersionConflictError(
          "Finalized game already exists or has a nonzero predecessor",
        );
      }
      const prior = this.#records.at(-1);
      const withoutHash = {
        cursor: this.#records.length,
        previousRecordHash: prior?.recordHash ?? null,
        projection: verified.projection,
        authorization: structuredClone(authorization),
      };
      const record: FinalGameProjectionRecord = {
        ...withoutHash,
        recordHash: recordHash(withoutHash),
      };
      await writeImmutableJson(
        join(
          this.#root,
          "final-game-records",
          `${String(record.cursor).padStart(12, "0")}.json`,
        ),
        record,
      );
      this.#records.push(record);
      this.#eventCursors.set(verified.event.eventHash, record.cursor);
      return structuredClone(record);
    });
  }

  public games(): readonly PublicFinalizedGameProjection[] {
    return structuredClone(this.#records.map(({ projection }) => projection));
  }

  public standings(): readonly PublicSeasonStandingsProjection[] {
    const seasons = new Map<string, LeagueGameProjection[]>();
    for (const { projection } of this.#records) {
      if (!isLeagueGame(projection)) continue;
      const key = seasonKey(projection.competition);
      const games = seasons.get(key) ?? [];
      games.push(projection);
      seasons.set(key, games);
    }
    const projections = [...seasons.values()].map((unsortedGames) => {
      const games = [...unsortedGames].sort(
        (left, right) =>
          left.competition.scheduledAt.localeCompare(
            right.competition.scheduledAt,
          ) || left.gameId.localeCompare(right.gameId),
      );
      const firstGame = games[0];
      if (firstGame === undefined)
        throw new Error("Season standings require at least one finalized game");
      const context = firstGame.competition;
      const scheduleIdentity = scheduleAuthorityCommitment(context);
      if (
        games.some(
          (game) =>
            scheduleAuthorityCommitment(game.competition) !== scheduleIdentity,
        )
      ) {
        throw new Error(
          "Finalized games substitute the season schedule authority",
        );
      }
      const records = new Map<string, StandingAccumulator>(
        context.clubIds.map((clubId) => [
          clubId,
          {
            clubId,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
          },
        ]),
      );
      for (const game of games) {
        const gameContext = game.competition;
        const home = requireStanding(records, gameContext.homeClubId);
        const away = requireStanding(records, gameContext.awayClubId);
        home.gamesPlayed += 1;
        away.gamesPlayed += 1;
        home.pointsFor += game.score.home;
        home.pointsAgainst += game.score.away;
        away.pointsFor += game.score.away;
        away.pointsAgainst += game.score.home;
        if (game.winner === "HOME") {
          home.wins += 1;
          away.losses += 1;
        } else {
          away.wins += 1;
          home.losses += 1;
        }
      }
      const standings = [...records.values()]
        .map((record) => ({
          ...record,
          pointDifferential: record.pointsFor - record.pointsAgainst,
        }))
        .sort(standingOrder)
        .map((record, index) => ({ rank: index + 1, ...record }));
      const sourceGames: PublicSeasonStandingsProjection["sourceGames"] =
        games.map((game) => ({
          gameId: game.gameId,
          canonicalEventHash: game.canonicalEventHash,
          scheduleEvidenceCommitment: game.competition
            .evidenceCommitment as `0x${string}`,
        }));
      const body = {
        format: "ABL-PUBLIC-SEASON-STANDINGS-V1" as const,
        competitionId: context.competitionId,
        seasonId: context.seasonId,
        tier: context.tier,
        scheduleId: context.scheduleId,
        scheduleVersion: context.scheduleVersion,
        scheduleEventHash: context.scheduleEventHash as `0x${string}`,
        scheduleStateRoot: context.scheduleStateRoot as `0x${string}`,
        completedGameCount: games.length,
        sourceGames,
        standings,
      };
      const projection: PublicSeasonStandingsProjection = {
        recordType: "SEASON_STANDINGS",
        state: "REHEARSAL",
        canonical: true,
        verification: "DERIVED_FROM_CANONICAL_LOCAL_REHEARSAL",
        recognizedGenesisStandings: false,
        ...body,
        standingsCommitment: sha256Commitment(body),
        projectedAt: games.reduce(
          (latest, game) =>
            game.projectedAt > latest ? game.projectedAt : latest,
          firstGame.projectedAt,
        ),
      };
      return projection;
    });
    return structuredClone(
      projections.sort(
        (left, right) =>
          left.competitionId.localeCompare(right.competitionId) ||
          left.seasonId.localeCompare(right.seasonId) ||
          left.tier.localeCompare(right.tier),
      ),
    );
  }

  public game(gameId: string): PublicFinalizedGameProjection | undefined {
    const value = this.#records.find(
      ({ projection }) => projection.gameId === gameId,
    )?.projection;
    return value === undefined ? undefined : structuredClone(value);
  }

  public cursor(gameId: string) {
    const game = this.game(gameId);
    if (game === undefined) return undefined;
    return {
      latestSegment: game.segments.at(-1)?.cursor ?? -1,
      nextCursor: game.segments.length,
    };
  }

  public segment(gameId: string, sequence: number) {
    const segment = this.game(gameId)?.segments.find(
      ({ cursor }) => cursor === sequence,
    );
    return segment === undefined ? undefined : structuredClone(segment);
  }
}
