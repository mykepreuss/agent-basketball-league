import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import { readFile } from "node:fs/promises";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  PersistentPlayerBody,
  assertNoWinnerInput,
  commitRandomShare,
  deriveRandomSeed,
  observePlayer,
  replayPossession,
  resolvePossession,
  stateRoot,
  type BasketballState,
  type CoachDecision,
  type CognitionReceipt,
  type DecisionWindow,
  type PlayerState,
  type RefereeDecision,
  type ReplayDecision,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};

function players(): PlayerState[] {
  const roles = ["PG", "SG", "SF", "PF", "C"] as const;
  return (["HOME", "AWAY"] as const).flatMap((team, teamIndex) =>
    roles.map((position, index) => ({
      playerId: `${team === "HOME" ? "H" : "A"}${index + 1}`,
      did: `did:abl:${team.toLowerCase()}-${index + 1}`,
      team,
      position,
      xCm: team === "HOME" ? 2_500 - index * 180 : 800 + index * 180,
      yCm: 250 + index * 240 + teamIndex * 35,
      maxSpeedCmPerWindow: 95 + index * 3,
      shootingBps: position === "PG" ? 9_000 : 6_500 + index * 250,
      passingBps: 7_500 - index * 200,
      defenseBps: 5_800 + index * 300,
      stamina: 100,
    })),
  );
}

function initialState(): BasketballState {
  const roster = players();
  const possessor = roster.find((player) => player.playerId === "H1")!;
  return {
    gameId: "0198a000-0000-7000-8000-000000000201",
    possessionId: "possession-proof-001",
    quarter: 1,
    gameClockMs: 720_000,
    shotClockMs: 24_000,
    score: { home: 0, away: 0 },
    possessionTeam: "HOME",
    ball: {
      xCm: possessor.xCm,
      yCm: possessor.yCm,
      possessorId: possessor.playerId,
    },
    players: roster,
    window: 0,
    phase: "LIVE",
  };
}

function receipt(
  did: string,
  role: CognitionReceipt["role"],
  subject: string,
): CognitionReceipt {
  return {
    receiptId: `${subject}:receipt:${did}`,
    agentDid: did,
    role,
    endpoint: "local-deterministic-test-adapter",
    provider: "fixture",
    modelFamily: "structured-policy",
    modelRevision: "1",
    observationHash: sha256Commitment(subject),
    contextManifestHash: sha256Commitment({ subject }),
    kernelHash: sha256Commitment("basketball-kernel-v1"),
    toolHash: sha256Commitment("no-tools"),
    deadlineMs: 1_500,
    retryCount: 0,
    fallbackUsed: false,
    normalizedResourceUnits: 1_000,
    telemetryContentPolicy: "CONTENT_DISABLED",
    personalMaterialSupplied: [],
  };
}

async function fixture() {
  const initial = initialState();
  const bodyById = new Map(
    initial.players.map((player, index) => {
      const privateKey =
        `0x${(index + 1).toString(16).padStart(64, "0")}` as Hex;
      return [
        player.playerId,
        new PersistentPlayerBody({
          did: player.did,
          playerId: player.playerId,
          signingIdentity: createSigningIdentity(privateKey),
          policy: (observation) => {
            const windowId = `${initial.possessionId}:w${observation.window}`;
            if (observation.window < 2)
              return { windowId, playerId: player.playerId, action: "HOLD" };
            if (player.playerId === "H1")
              return {
                windowId,
                playerId: player.playerId,
                action: "SHOOT",
                shot: "LAYUP",
              };
            return {
              windowId,
              playerId: player.playerId,
              action: "MOVE",
              vector: {
                dx: player.team === "HOME" ? 1_000 : -1_000,
                dy: index % 2 === 0 ? 250 : -250,
              },
            };
          },
        }),
      ] as const;
    }),
  );
  const windows: DecisionWindow[] = [];
  for (let index = 0; index < 3; index += 1) {
    const observationState = structuredClone(initial);
    observationState.window = index;
    observationState.gameClockMs -= index * 2_000;
    observationState.shotClockMs -= index * 2_000;
    const decisions = await Promise.all(
      observationState.players.map(async (player) =>
        bodyById
          .get(player.playerId)!
          .decide(observePlayer(observationState, player.playerId), domain),
      ),
    );
    const coaches: CoachDecision[] = (["HOME", "AWAY"] as const).map(
      (team) => ({
        coachDid: `did:abl:coach-${team.toLowerCase()}`,
        team,
        windowId: `${initial.possessionId}:w${index}`,
        instruction: team === "HOME" ? "SPACE" : "PROTECT_RIM",
        targetPlayerIds: observationState.players
          .filter((player) => player.team === team)
          .map((player) => player.playerId),
        receipt: receipt(
          `did:abl:coach-${team.toLowerCase()}`,
          "COACH",
          `${initial.possessionId}:w${index}`,
        ),
      }),
    );
    windows.push({
      windowId: `${initial.possessionId}:w${index}`,
      decisions,
      coaches,
    });
  }

  const requiredParties = ["club:home", "club:away", "integrity:1"];
  const reveals = requiredParties.map((party, index) => ({
    party,
    gameId: initial.gameId,
    share: `0x${(index + 101).toString(16).padStart(64, "0")}` as Hex,
  }));
  const commitments = reveals.map((reveal) =>
    commitRandomShare(reveal.gameId, reveal.party, reveal.share),
  );
  const randomSeed = deriveRandomSeed(
    initial.gameId,
    commitments,
    reveals,
    requiredParties,
  );
  const refereeDecisions: RefereeDecision[] = Array.from(
    { length: 3 },
    (_, index) => ({
      refereeDid: `did:abl:referee-${index + 1}`,
      sequence: index,
      call: "NO_CALL",
      againstPlayerId: null,
      confidenceBps: 8_000 - index * 300,
      receipt: receipt(
        `did:abl:referee-${index + 1}`,
        "REFEREE",
        `official:${index}`,
      ),
    }),
  );
  const replayDecisions: ReplayDecision[] = Array.from(
    { length: 2 },
    (_, index) => ({
      replayDid: `did:abl:replay-${index + 1}`,
      reviewable: false,
      ruling: "NO_REVIEW",
      evidenceCommitment: sha256Commitment({ windows: 3, official: index }),
      receipt: receipt(
        `did:abl:replay-${index + 1}`,
        "REPLAY",
        `replay:${index}`,
      ),
    }),
  );
  const input = {
    initialState: initial,
    windows,
    playerSigningAddresses: new Map(
      [...bodyById].map(([playerId, body]) => [
        playerId,
        body.signingIdentity.address,
      ]),
    ),
    domain,
    randomSeed,
    refereeDecisions,
    replayDecisions,
  };
  return { initial, bodyById, commitments, reveals, requiredParties, input };
}

describe("first independently verifiable possession", () => {
  it("collects ten independent decisions in three windows and reproduces exact state/root without inference", async () => {
    const { initial, bodyById, input } = await fixture();
    assertNoWinnerInput(input);
    expect(input.windows).toHaveLength(3);
    expect(
      input.windows.every(
        (window) =>
          window.decisions.length === 10 && window.coaches.length === 2,
      ),
    ).toBe(true);
    expect(
      new Set(
        input.windows.flatMap((window) =>
          window.decisions.map((decision) => decision.signerAddress),
        ),
      ).size,
    ).toBe(10);
    expect(
      input.windows
        .flatMap((window) => window.decisions)
        .every(
          (decision) =>
            decision.receipt.telemetryContentPolicy === "CONTENT_DISABLED",
        ),
    ).toBe(true);

    const homeObservation = observePlayer(initial, "H5");
    const awayObservation = observePlayer(initial, "A5");
    expect(homeObservation.playerId).not.toBe(awayObservation.playerId);
    expect(
      homeObservation.visibleOpponents.map((player) => player.playerId),
    ).not.toEqual(
      awayObservation.visibleOpponents.map((player) => player.playerId),
    );

    const result = await resolvePossession(input);
    if (process.env.ABL_PRINT_FIXTURE === "1") {
      process.stdout.write(
        `ABL_FIXTURE=${JSON.stringify({
          gameId: result.finalState.gameId,
          possessionId: result.finalState.possessionId,
          score: result.finalState.score,
          gameClockMs: result.finalState.gameClockMs,
          shotClockMs: result.finalState.shotClockMs,
          players: result.finalState.players.map(
            ({ playerId, team, position, xCm, yCm }) => ({
              playerId,
              team,
              position,
              xCm,
              yCm,
            }),
          ),
          events: result.events.map(
            ({ sequence, type, data, stateRoot, eventHash }) => ({
              sequence,
              type,
              data,
              stateRoot,
              eventHash,
            }),
          ),
          finalStateRoot: result.finalStateRoot,
          eventMerkleRoot: result.eventMerkleRoot,
          filmCommitment: result.filmCommitment,
          finalSegmentHash: result.segments.at(-1)?.segmentHash,
        })}\n`,
      );
    }
    expect(result.finalState.phase).toBe("FINAL");
    expect(result.finalStateRoot).not.toBe(stateRoot(initial));
    expect(result.eventMerkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.events.some((event) => event.type === "SHOT")).toBe(true);
    expect(result.events.at(-1)?.data.inputAcceptedWinner).toBe(false);
    expect(
      result.segments.every(
        (segment, index) =>
          segment.previousSegmentHash ===
          (result.segments[index - 1]?.segmentHash ?? null),
      ),
    ).toBe(true);
    const publicFixture = JSON.parse(
      await readFile(
        new URL(
          "../../../fixtures/first-possession-public.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      score: { home: number; away: number };
      players: Array<{ playerId: string; xCm: number; yCm: number }>;
      events: Array<{ sequence: number; type: string; stateRoot: string }>;
      finalStateRoot: string;
      eventMerkleRoot: string;
      filmCommitment: string;
      finalSegmentHash: string;
    };
    expect(publicFixture).toMatchObject({
      score: result.finalState.score,
      finalStateRoot: result.finalStateRoot,
      eventMerkleRoot: result.eventMerkleRoot,
      filmCommitment: result.filmCommitment,
      finalSegmentHash: result.segments.at(-1)?.segmentHash,
    });
    expect(
      publicFixture.players.map(({ playerId, xCm, yCm }) => ({
        playerId,
        xCm,
        yCm,
      })),
    ).toEqual(
      result.finalState.players.map(({ playerId, xCm, yCm }) => ({
        playerId,
        xCm,
        yCm,
      })),
    );
    expect(
      publicFixture.events.map(({ sequence, type, stateRoot }) => ({
        sequence,
        type,
        stateRoot,
      })),
    ).toEqual(
      result.events.map(({ sequence, type, stateRoot }) => ({
        sequence,
        type,
        stateRoot,
      })),
    );

    bodyById
      .get("H1")!
      .persistAgentAuthoredLesson(
        "Create the same lane while preserving a late pass option.",
      );
    expect(bodyById.get("H1")!.exportLessons()).toEqual([
      "Create the same lane while preserving a late pass option.",
    ]);
    const replay = await replayPossession(input, result);
    expect(replay).toMatchObject({ exact: true, inferenceInvocations: 0 });
  });

  it("rejects tampered player authorization and invalid random reveals", async () => {
    const { input, commitments, reveals, requiredParties } = await fixture();
    const tampered = structuredClone(input);
    tampered.windows[0]!.decisions[0]!.receipt.normalizedResourceUnits = 999_999;
    await expect(resolvePossession(tampered)).rejects.toThrow(
      "Decision signer is not registered",
    );

    const badReveals = structuredClone(reveals);
    badReveals[0]!.share = `0x${"f".repeat(64)}`;
    expect(() =>
      deriveRandomSeed(
        input.initialState.gameId,
        commitments,
        badReveals,
        requiredParties,
      ),
    ).toThrow("does not match commitment");
    expect(() =>
      assertNoWinnerInput({ ...input, winner: "HOME" } as never),
    ).toThrow("Winner input is forbidden");
  });
});
