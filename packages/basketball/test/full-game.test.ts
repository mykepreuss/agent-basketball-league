import { sha256Commitment } from "@abl/recognition";
import fc from "fast-check";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  OVERTIME_PERIOD_MS,
  REGULATION_PERIOD_MS,
  SHOT_CLOCK_MS,
  FullGameEngine,
  FinalizedGamePayloadSchema,
  PacedBroadcast,
  PreparationComputeLedger,
  PrivatePracticeLab,
  assertCalibrationCeiling,
  crewRuling,
  developAvatar,
  evaluateGameReadiness,
  fallibleCall,
  finalizedGameStateRoot,
  mirroredCalibration,
  replayFullGame,
  replayFinalizedGamePayload,
  resolveChallenge,
  rotateOfficialCrew,
  runAgentPlayedExhibition,
  runDeterministicExhibition,
  validateCompetitionReceipt,
  validatePointBuy,
  type CompetitionRole,
  type CognitionReceipt,
  type FullGameInput,
  type OfficialProfile,
  type ParticipantReadiness,
  type PlayerAvatar,
  type RoleEnvelope,
} from "../src/index.js";

const start = Date.parse("2026-08-13T12:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);

function gameInput(): FullGameInput {
  return {
    gameId: "exhibition-001",
    roster: {
      home: ["H1", "H2", "H3", "H4", "H5", "H6", "H7"],
      away: ["A1", "A2", "A3", "A4", "A5", "A6", "A7"],
    },
    active: {
      home: ["H1", "H2", "H3", "H4", "H5"],
      away: ["A1", "A2", "A3", "A4", "A5"],
    },
    openingPossession: "HOME",
  };
}

function finishPeriod(engine: FullGameEngine): void {
  const state = engine.snapshot();
  if (state.phase === "DEAD") engine.apply({ type: "RESUME" });
  engine.apply({ type: "TICK", milliseconds: engine.snapshot().gameClockMs });
  engine.apply({ type: "END_PERIOD" });
}

describe("complete deterministic exhibition rules", () => {
  it("plays a complete game from persistent signed player, coach, referee, and replay decisions", async () => {
    const exhibition = await runAgentPlayedExhibition();
    expect(exhibition.finalState).toMatchObject({
      phase: "FINAL",
      winner: "AWAY",
      period: 4,
      score: { home: 78, away: 82 },
    });
    expect(exhibition.possessionProofs).toHaveLength(128);
    expect(
      exhibition.possessionProofs.every(
        (possession) =>
          possession.playerDecisionHashes.length === 20 &&
          possession.coachDecisionHashes.length === 4 &&
          possession.refereeDecisionHashes.length === 3 &&
          possession.replayDecisionHashes.length === 2,
      ),
    ).toBe(true);
    expect(exhibition.persistentPlayerDecisionVersions).toEqual(
      Object.fromEntries(
        ["H1", "H2", "H3", "H4", "H5", "A1", "A2", "A3", "A4", "A5"].map(
          (playerId) => [playerId, "256"],
        ),
      ),
    );
    expect(exhibition.replay).toMatchObject({
      exact: true,
      inferenceInvocations: 0,
    });
    const finalizedAt = iso(0);
    const payload = FinalizedGamePayloadSchema.parse({
      gameId: exhibition.input.gameId,
      finalizedAt,
      input: exhibition.input,
      commands: exhibition.commands,
      proof: exhibition.proof,
      agentEvidence: exhibition.agentEvidence,
      filmCommitment: digest(exhibition.events),
      broadcastStartedAt: finalizedAt,
      broadcastIntervalMs: 1,
    });
    expect(replayFinalizedGamePayload(payload)).toMatchObject({
      state: exhibition.finalState,
      events: exhibition.events,
    });
    expect(finalizedGameStateRoot(payload)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() =>
      replayFinalizedGamePayload({
        ...payload,
        agentEvidence: {
          ...payload.agentEvidence,
          possessionCount: payload.agentEvidence.possessionCount + 1,
        },
      }),
    ).toThrow();
    expect(() =>
      replayFinalizedGamePayload({
        ...payload,
        broadcastStartedAt: iso(1),
      }),
    ).toThrow("cannot start after finalization");
  }, 20_000);

  it("locks the canonical exhibition transcript to an exactly replayable proof", () => {
    const exhibition = runDeterministicExhibition();
    expect(exhibition.finalState).toMatchObject({
      phase: "FINAL",
      winner: "HOME",
      period: 5,
      score: { home: 5, away: 2 },
    });
    expect(
      replayFullGame(exhibition.input, exhibition.commands, exhibition.proof),
    ).toMatchObject({ exact: true, inferenceInvocations: 0 });
  });

  it("keeps the public exhibition proof fixture byte-for-field aligned", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../../../fixtures/full-exhibition-proof.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const exhibition = runDeterministicExhibition();
    expect(fixture).toMatchObject({
      gameId: exhibition.finalState.gameId,
      result: {
        period: exhibition.finalState.period,
        periodKind: exhibition.finalState.periodKind,
        score: exhibition.finalState.score,
        winner: exhibition.finalState.winner,
        winnerDerivedByRules: true,
      },
      commandCount: exhibition.commands.length,
      eventCount: exhibition.events.length,
      proof: { ...exhibition.proof, replayInferenceInvocations: 0 },
    });
  });

  it("plays four 12-minute periods plus five-minute overtime and derives the winner", () => {
    const input = gameInput();
    const engine = new FullGameEngine(input);
    engine.apply({
      type: "SHOT",
      team: "HOME",
      playerId: "H1",
      points: 2,
      made: true,
    });
    engine.apply({ type: "RESUME" });
    engine.apply({
      type: "GOALTENDING",
      byTeam: "HOME",
      awardedTeam: "AWAY",
      points: 2,
    });
    engine.apply({
      type: "SUBSTITUTE",
      team: "HOME",
      outPlayerId: "H5",
      inPlayerId: "H6",
    });
    engine.apply({ type: "RESUME" });
    engine.apply({ type: "INJURY", team: "HOME", playerId: "H2" });
    engine.apply({
      type: "SUBSTITUTE",
      team: "HOME",
      outPlayerId: "H2",
      inPlayerId: "H7",
    });
    engine.apply({ type: "TIMEOUT", team: "AWAY" });
    engine.apply({ type: "RESUME" });
    engine.apply({ type: "OUT_OF_BOUNDS", lastTouchedBy: "AWAY" });
    const target = engine.events().at(-1)!.sequence;
    engine.apply({
      type: "CHALLENGE",
      team: "AWAY",
      targetEventSequence: target,
    });
    engine.apply({
      type: "REPLAY_RULING",
      targetEventSequence: target,
      ruling: "CONFIRM",
    });
    engine.apply({
      type: "PROTEST",
      team: "AWAY",
      reasonCode: "RULE_INTERPRETATION",
      eventSequence: target,
    });

    for (let period = 1; period <= 4; period += 1) finishPeriod(engine);
    expect(engine.snapshot()).toMatchObject({
      period: 5,
      periodKind: "OVERTIME",
      gameClockMs: OVERTIME_PERIOD_MS,
      score: { home: 2, away: 2 },
    });
    engine.apply({
      type: "SHOT",
      team: "HOME",
      playerId: "H1",
      points: 3,
      made: true,
    });
    finishPeriod(engine);

    const final = engine.snapshot();
    expect(final).toMatchObject({
      phase: "FINAL",
      winner: "HOME",
      score: { home: 5, away: 2 },
    });
    expect(engine.events().at(-1)).toMatchObject({
      type: "GAME_FINAL",
      data: { winner: "HOME", derived: true },
    });
    const replay = replayFullGame(input, engine.commands(), engine.proof());
    expect(replay).toMatchObject({
      exact: true,
      inferenceInvocations: 0,
      proof: { winner: "HOME" },
    });
  });

  it("enforces shot-clock turnovers, free throws, six-foul ejection, substitutions, and live/dead-ball legality", () => {
    const clock = new FullGameEngine(gameInput());
    clock.apply({ type: "TICK", milliseconds: SHOT_CLOCK_MS });
    expect(clock.snapshot()).toMatchObject({
      phase: "DEAD",
      possessionTeam: "AWAY",
      shotClockMs: SHOT_CLOCK_MS,
    });
    expect(clock.events().map((event) => event.type)).toEqual([
      "TICK",
      "SHOT_CLOCK_EXPIRED",
    ]);

    const game = new FullGameEngine(gameInput());
    game.apply({
      type: "FOUL",
      byTeam: "AWAY",
      playerId: "A1",
      kind: "SHOOTING",
      freeThrows: 2,
    });
    game.apply({
      type: "FREE_THROW",
      team: "HOME",
      playerId: "H1",
      made: true,
    });
    game.apply({
      type: "FREE_THROW",
      team: "HOME",
      playerId: "H1",
      made: false,
    });
    game.apply({ type: "RESUME" });
    for (let foul = 1; foul < 6; foul += 1) {
      game.apply({
        type: "FOUL",
        byTeam: "AWAY",
        playerId: "A1",
        kind: "PERSONAL",
        freeThrows: 0,
      });
      if (game.snapshot().pendingFreeThrows !== null) {
        game.apply({
          type: "FREE_THROW",
          team: "HOME",
          playerId: "H1",
          made: true,
        });
        game.apply({
          type: "FREE_THROW",
          team: "HOME",
          playerId: "H1",
          made: false,
        });
      }
      if (foul < 5) game.apply({ type: "RESUME" });
    }
    expect(game.snapshot().ejectedPlayerIds).toContain("A1");
    expect(game.snapshot()).toMatchObject({
      teamFouls: { home: 0, away: 6 },
      bonus: { home: true, away: false },
      freeThrowLaneActive: false,
    });
    expect(() => game.apply({ type: "RESUME" })).toThrow("five active players");
    game.apply({
      type: "SUBSTITUTE",
      team: "AWAY",
      outPlayerId: "A1",
      inPlayerId: "A6",
    });
    game.apply({ type: "RESUME" });
    expect(game.snapshot()).toMatchObject({
      phase: "LIVE",
      score: { home: 3, away: 0 },
    });
    expect(() =>
      game.apply({
        type: "SUBSTITUTE",
        team: "HOME",
        outPlayerId: "H1",
        inPlayerId: "H6",
      }),
    ).toThrow("dead ball");
    expect(() =>
      game.apply({
        type: "VIOLATION",
        team: "AWAY",
        playerId: "A2",
        kind: "TRAVEL",
      }),
    ).toThrow("possessing team");
  });

  it("models explicit throw-ins, held-ball jump balls, and period bonus reset", () => {
    const timeout = new FullGameEngine(gameInput());
    timeout.apply({ type: "TIMEOUT", team: "HOME" });
    expect(() =>
      timeout.apply({ type: "JUMP_BALL", winningTeam: "AWAY" }),
    ).toThrow("not the awarded");

    const game = new FullGameEngine(gameInput());
    game.apply({ type: "OUT_OF_BOUNDS", lastTouchedBy: "AWAY" });
    expect(game.snapshot()).toMatchObject({
      phase: "DEAD",
      restart: { kind: "THROW_IN", team: "HOME" },
    });
    game.apply({ type: "THROW_IN", team: "HOME", playerId: "H2" });
    expect(game.snapshot()).toMatchObject({
      phase: "LIVE",
      possessionTeam: "HOME",
      restart: null,
    });
    game.apply({ type: "HELD_BALL" });
    expect(game.snapshot().restart).toEqual({ kind: "JUMP_BALL" });
    game.apply({ type: "JUMP_BALL", winningTeam: "AWAY" });
    expect(game.snapshot()).toMatchObject({
      phase: "LIVE",
      possessionTeam: "AWAY",
    });
    for (let foul = 0; foul < 5; foul += 1) {
      game.apply({
        type: "FOUL",
        byTeam: "HOME",
        playerId: "H1",
        kind: "PERSONAL",
        freeThrows: 0,
      });
      if (game.snapshot().pendingFreeThrows !== null) {
        game.apply({
          type: "FREE_THROW",
          team: "AWAY",
          playerId: "A1",
          made: true,
        });
        game.apply({
          type: "FREE_THROW",
          team: "AWAY",
          playerId: "A1",
          made: false,
        });
      }
      game.apply({ type: "RESUME" });
    }
    expect(game.snapshot().bonus.away).toBe(true);
    game.apply({ type: "TICK", milliseconds: game.snapshot().gameClockMs });
    game.apply({ type: "END_PERIOD" });
    expect(game.snapshot()).toMatchObject({
      teamFouls: { home: 0, away: 0 },
      bonus: { home: false, away: false },
    });
  });

  it("never accepts a winner command and rejects period finalization before clock expiry", () => {
    const game = new FullGameEngine(gameInput());
    expect(() => game.apply({ type: "END_PERIOD" })).toThrow(
      "clock has not expired",
    );
    expect(() => game.apply({ type: "TICK", milliseconds: -1 })).toThrow(
      "positive integer",
    );
    expect(() =>
      game.apply({ type: "RESUME", winner: "HOME" } as never),
    ).toThrow("Winner input is forbidden");
    expect(game.commands()).toHaveLength(0);
    expect(game.events()).toHaveLength(0);
  });

  it("applies replay reversals to state and preserves the charged challenge", () => {
    const game = new FullGameEngine(gameInput());
    game.apply({
      type: "GOALTENDING",
      byTeam: "AWAY",
      awardedTeam: "HOME",
      points: 2,
    });
    const targetEventSequence = game.events().at(-1)!.sequence;
    game.apply({
      type: "CHALLENGE",
      team: "AWAY",
      targetEventSequence,
    });
    game.apply({
      type: "REPLAY_RULING",
      targetEventSequence,
      ruling: "REVERSE",
    });
    expect(game.snapshot()).toMatchObject({
      score: { home: 0, away: 0 },
      possessionTeam: "HOME",
      phase: "DEAD",
      challenges: { home: 2, away: 1 },
    });
    expect(
      replayFullGame(gameInput(), game.commands(), game.proof()).exact,
    ).toBe(true);
  });
});

describe("fallible independent officiating and review", () => {
  const pool: OfficialProfile[] = Array.from({ length: 6 }, (_, index) => ({
    officialDid: `did:abl:official-${index + 1}`,
    accuracyBps: 8_500 - index * 100,
    style: (["CREW_CHIEF", "CENTER", "TRAIL"] as const)[index % 3]!,
  }));

  it("rotates a six-agent pool into three-referee crews with two replay officials", () => {
    const first = rotateOfficialCrew("game-1", 0, pool, [
      "did:abl:replay-1",
      "did:abl:replay-2",
      "did:abl:replay-3",
    ]);
    const second = rotateOfficialCrew("game-2", 1, pool, [
      "did:abl:replay-1",
      "did:abl:replay-2",
      "did:abl:replay-3",
    ]);
    expect(
      new Set(first.referees.map((official) => official.officialDid)),
    ).toHaveLength(3);
    expect(first.referees.map((official) => official.officialDid)).not.toEqual(
      second.referees.map((official) => official.officialDid),
    );
    const calls = first.referees.map((official, index) => ({
      officialDid: official.officialDid,
      call: fallibleCall(
        official,
        "OUT_OF_BOUNDS",
        index === 0 ? 9_999 : 1_000,
      ),
    }));
    expect(calls.some((call) => call.call === "NO_CALL")).toBe(true);
    expect(crewRuling(first, calls)).toBe("OUT_OF_BOUNDS");
    expect(() => crewRuling(first, [calls[0]!, calls[0]!, calls[0]!])).toThrow(
      "three-referee crew",
    );
    expect(
      resolveChallenge({
        call: "OUT_OF_BOUNDS",
        evidenceCall: "GOALTENDING",
        challengedBy: "did:abl:coach-away",
        replayOfficialDids: first.replayOfficialDids,
      }),
    ).toMatchObject({ ruling: "REVERSE", correctedCall: "GOALTENDING" });
    expect(() =>
      resolveChallenge({
        call: "OUT_OF_BOUNDS",
        evidenceCall: "GOALTENDING",
        challengedBy: "did:abl:coach-away",
        replayOfficialDids: ["did:abl:replay-1", "did:abl:replay-1"],
      }),
    ).toThrow("distinct replay officials");
    expect(() =>
      resolveChallenge({
        call: "PERSONAL_FOUL",
        evidenceCall: "NO_CALL",
        challengedBy: "coach",
        replayOfficialDids: first.replayOfficialDids,
      }),
    ).toThrow("not reviewable");
  });
});

describe("persistent avatars, equivalent compute, film, and broadcast", () => {
  const balanced: PlayerAvatar = {
    playerId: "H1",
    version: 1,
    attributes: {
      quickness: 70,
      shooting: 70,
      playmaking: 70,
      defense: 70,
      rebounding: 70,
    },
    workload: 0,
    developmentHistory: [],
  };

  it("enforces exact point-buy tradeoffs, workload, and the 52% mirrored calibration gate", () => {
    validatePointBuy(balanced);
    const developed = developAvatar(balanced, {
      improve: "shooting",
      reduce: "rebounding",
      points: 5,
      workload: 10,
    });
    expect(developed).toMatchObject({
      version: 2,
      workload: 10,
      attributes: { shooting: 75, rebounding: 65 },
    });
    const fair = mirroredCalibration(balanced, { ...balanced, playerId: "A1" });
    expect(fair).toEqual({
      leftWinShareBps: 5_000,
      rightWinShareBps: 5_000,
      ceilingBps: 5_000,
      eligible: true,
    });
    expect(() =>
      assertCalibrationCeiling(mirroredCalibration(developed, balanced)),
    ).toThrow("52% ceiling");
  });

  it("postpones the whole game on any provider failure and validates equal role envelopes/caps", () => {
    const roles: CompetitionRole[] = [
      ...Array<CompetitionRole>(10).fill("PLAYER"),
      ...Array<CompetitionRole>(2).fill("COACH"),
      ...Array<CompetitionRole>(3).fill("REFEREE"),
      ...Array<CompetitionRole>(2).fill("REPLAY"),
    ];
    const envelopes = new Map<CompetitionRole, RoleEnvelope>(
      (["PLAYER", "COACH", "REFEREE", "REPLAY"] as const).map((role) => [
        role,
        {
          role,
          deadlineMs: 1_500,
          maxAttempts: 2,
          normalizedResourceUnits: 1_000,
          fallbackPolicyDigest: digest(`fallback:${role}`),
        },
      ]),
    );
    const participants: ParticipantReadiness[] = roles.map((role, index) => ({
      participantDid: `did:abl:${role.toLowerCase()}-${index}`,
      role,
      providerStatus: index === 4 ? "UNAVAILABLE" : "READY",
      envelope: envelopes.get(role)!,
    }));
    expect(evaluateGameReadiness(participants)).toMatchObject({
      status: "POSTPONED",
      wholeGamePostponed: true,
      unavailable: ["did:abl:player-4"],
    });
    const ready = participants.map((participant) => ({
      ...participant,
      providerStatus: "READY" as const,
    }));
    expect(evaluateGameReadiness(ready)).toMatchObject({
      status: "READY",
      wholeGamePostponed: false,
    });

    const envelope = envelopes.get("PLAYER")!;
    const receipt: CognitionReceipt = {
      receiptId: "receipt-1",
      agentDid: "did:abl:player-1",
      role: "PLAYER",
      endpoint: "private-body",
      provider: "provider-a",
      modelFamily: "family-a",
      modelRevision: "r1",
      observationHash: digest("observation"),
      contextManifestHash: digest("context"),
      kernelHash: digest("kernel"),
      toolHash: digest("tool"),
      deadlineMs: 1_500,
      retryCount: 1,
      fallbackUsed: true,
      normalizedResourceUnits: 1_000,
      telemetryContentPolicy: "CONTENT_DISABLED",
      personalMaterialSupplied: [],
    };
    expect(() => validateCompetitionReceipt(receipt, envelope)).not.toThrow();
    const preparation = new PreparationComputeLedger(5_000);
    expect(preparation.charge(receipt.agentDid, 4_000)).toBe(1_000);
    expect(() => preparation.charge(receipt.agentDid, 1_001)).toThrow(
      "cap exceeded",
    );
  });

  it("keeps film/practice private, lessons agent-authored, and cursor replay exact", () => {
    const game = new FullGameEngine(gameInput());
    game.apply({
      type: "SHOT",
      team: "HOME",
      playerId: "H1",
      points: 2,
      made: true,
    });
    game.apply({ type: "RESUME" });
    const film = new PrivatePracticeLab();
    film.admitFilm(
      {
        gameId: gameInput().gameId,
        ownerDid: "did:abl:h1",
        ciphertextCommitment: digest("ciphertext-film"),
        eventRoot: game.proof().eventMerkleRoot,
      },
      "did:abl:h1",
    );
    expect(
      film.counterfactual({
        ownerDid: "did:abl:h1",
        gameId: gameInput().gameId,
        baseStateRoot: game.proof().finalStateRoot,
        changedIntentCommitments: [digest("pass-instead")],
      }),
    ).toMatchObject({ recognizedGameMutation: false });
    expect(() =>
      film.persistLesson("did:abl:h1", "did:abl:coach", digest("lesson")),
    ).toThrow("Only the agent");
    film.persistLesson("did:abl:h1", "did:abl:h1", digest("lesson"));
    expect(film.lessons("did:abl:h1")).toEqual([digest("lesson")]);

    const broadcast = new PacedBroadcast();
    game
      .events()
      .forEach((event, index) => broadcast.publish(event, iso(index * 1_000)));
    expect(broadcast.poll(-1, iso(10_000))).toHaveLength(game.events().length);
    const resume = broadcast.sseResume(0, iso(10_000));
    expect(resume.events[0]?.id).toBe(1);
    expect(resume.heartbeat.data.content).toBeNull();
    expect(resume.recoveryMode).toBe("CURSOR_AUTHORITATIVE");
    expect(() => broadcast.publish(game.events()[0]!, iso(20_000))).toThrow(
      "lost, duplicated, or out of order",
    );
  });
});

describe("full-game property invariants", () => {
  it("never underflows either clock across arbitrary legal tick sequences", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: SHOT_CLOCK_MS }), {
          minLength: 1,
          maxLength: 80,
        }),
        (ticks) => {
          const game = new FullGameEngine(gameInput());
          for (const requested of ticks) {
            const state = game.snapshot();
            if (state.gameClockMs === 0) break;
            if (state.phase === "DEAD") game.apply({ type: "RESUME" });
            game.apply({
              type: "TICK",
              milliseconds: Math.min(requested, game.snapshot().gameClockMs),
            });
            const after = game.snapshot();
            expect(after.gameClockMs).toBeGreaterThanOrEqual(0);
            expect(after.gameClockMs).toBeLessThanOrEqual(REGULATION_PERIOD_MS);
            expect(after.shotClockMs).toBeGreaterThanOrEqual(0);
            expect(after.shotClockMs).toBeLessThanOrEqual(SHOT_CLOCK_MS);
            expect(after.score.home).toBeGreaterThanOrEqual(0);
            expect(after.score.away).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
