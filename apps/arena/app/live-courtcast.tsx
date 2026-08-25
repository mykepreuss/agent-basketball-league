"use client";

import { useEffect, useState, type CSSProperties } from "react";

import type { PublicArenaLiveSnapshot } from "./data";

const COURT_WIDTH_CM = 2_865;
const COURT_HEIGHT_CM = 1_524;

function percent(value: number, maximum: number): string {
  return `${(value / maximum) * 100}%`;
}

function CourtLines() {
  return (
    <>
      <div className="half-line" />
      <div className="center-circle" />
      <div className="paint paint-left" />
      <div className="paint paint-right" />
      <div className="hoop hoop-left" />
      <div className="hoop hoop-right" />
    </>
  );
}

function actionTarget(snapshot: PublicArenaLiveSnapshot) {
  if (snapshot.action.target !== null) return snapshot.action.target;
  const recipient = snapshot.players.find(
    ({ playerId }) => playerId === snapshot.action.secondaryPlayerId,
  );
  return recipient === undefined
    ? null
    : { xCm: recipient.xCm, yCm: recipient.yCm };
}

function appendSnapshot(
  current: readonly PublicArenaLiveSnapshot[],
  incoming: PublicArenaLiveSnapshot,
): PublicArenaLiveSnapshot[] {
  const previous = current.at(-1);
  if (
    incoming.format !== "ABL-LIVE-GAME-SNAPSHOT-V1" ||
    current.some(({ cursor }) => cursor === incoming.cursor) ||
    (previous !== undefined &&
      incoming.integrity.previousSnapshotHash !==
        previous.integrity.snapshotHash)
  ) {
    return [...current];
  }
  return [...current, incoming].slice(-240);
}

export function LiveCourtcast({
  gameId,
  initialSnapshots,
}: Readonly<{
  gameId: string;
  initialSnapshots: readonly PublicArenaLiveSnapshot[];
}>) {
  const [snapshots, setSnapshots] = useState<PublicArenaLiveSnapshot[]>(() => [
    ...initialSnapshots,
  ]);
  const [index, setIndex] = useState(() =>
    Math.max(0, initialSnapshots.length - 1),
  );
  const [playing, setPlaying] = useState(true);
  const [connection, setConnection] = useState<
    "CONNECTING" | "FOLLOWING" | "RECONNECTING"
  >("CONNECTING");
  useEffect(() => {
    const source = new EventSource(
      `/api/games/${encodeURIComponent(gameId)}/live`,
    );
    source.onopen = () => setConnection("FOLLOWING");
    source.addEventListener("snapshot", (event) => {
      try {
        const incoming = JSON.parse(event.data) as PublicArenaLiveSnapshot;
        if (incoming.gameId !== gameId) throw new Error("Wrong game snapshot");
        setSnapshots((current) => appendSnapshot(current, incoming));
        setConnection("FOLLOWING");
      } catch {
        setConnection("RECONNECTING");
      }
    });
    source.onerror = () => setConnection("RECONNECTING");
    return () => source.close();
  }, [gameId]);

  useEffect(() => {
    if (!playing || index >= snapshots.length - 1) return;
    const timer = window.setTimeout(
      () => setIndex((current) => Math.min(current + 1, snapshots.length - 1)),
      900,
    );
    return () => window.clearTimeout(timer);
  }, [index, playing, snapshots.length]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, snapshots.length - 1)));
  }, [snapshots.length]);

  const snapshot = snapshots[index] ?? snapshots.at(-1);
  const target = snapshot === undefined ? null : actionTarget(snapshot);
  if (snapshot === undefined) {
    return (
      <div className="court live-court is-waiting" aria-label="Live Courtcast">
        <CourtLines />
        <p>Waiting for the first authoritative snapshot.</p>
      </div>
    );
  }

  const origin =
    snapshot.players.find(
      ({ playerId }) => playerId === snapshot.action.primaryPlayerId,
    ) ?? snapshot.ball;
  const traceStyle =
    target === null
      ? undefined
      : ({
          "--from-x": percent(origin.xCm, COURT_WIDTH_CM),
          "--from-y": percent(origin.yCm, COURT_HEIGHT_CM),
          "--to-x": percent(target.xCm, COURT_WIDTH_CM),
          "--to-y": percent(target.yCm, COURT_HEIGHT_CM),
        } as CSSProperties);
  const latest = index === snapshots.length - 1;
  const formationDerived = snapshot.players.some(
    ({ placement }) => placement === "DERIVED_LINEUP_FORMATION",
  );

  return (
    <div className="live-courtcast">
      <div
        className={`court live-court action-${snapshot.action.type.toLowerCase().replaceAll("_", "-")}`}
        aria-label="Authoritative live game snapshot"
      >
        <CourtLines />
        <div className="live-state-strip" aria-live="polite">
          <span>Q{snapshot.period}</span>
          <strong>
            H {snapshot.score.home} · {snapshot.score.away} A
          </strong>
          <span>
            {Math.floor(snapshot.gameClockMs / 60_000)}:
            {String(
              Math.floor((snapshot.gameClockMs % 60_000) / 1_000),
            ).padStart(2, "0")}
          </span>
          <span>:{Math.ceil(snapshot.shotClockMs / 1_000)}</span>
        </div>
        <ol className="players">
          {snapshot.players.map((player) => {
            const involved =
              player.playerId === snapshot.action.primaryPlayerId ||
              player.playerId === snapshot.action.secondaryPlayerId;
            return (
              <li
                className={`player ${player.team.toLowerCase()}${involved ? " is-involved" : ""}`}
                key={player.playerId}
                style={
                  {
                    "--x": percent(player.xCm, COURT_WIDTH_CM),
                    "--y": percent(player.yCm, COURT_HEIGHT_CM),
                  } as CSSProperties
                }
                title={`${player.playerId} · ${player.position} · ${player.placement}`}
              >
                <b>{player.playerId}</b>
                <small>{player.position}</small>
              </li>
            );
          })}
        </ol>
        <span
          className="live-ball"
          style={
            {
              "--x": percent(snapshot.ball.xCm, COURT_WIDTH_CM),
              "--y": percent(snapshot.ball.yCm, COURT_HEIGHT_CM),
            } as CSSProperties
          }
          title={snapshot.ball.possessorId ?? "Loose ball"}
        />
        {traceStyle === undefined ? null : (
          <span className="action-flight" style={traceStyle} aria-hidden="true">
            <i />
          </span>
        )}
        {snapshot.action.type === "REPLAY_RULING" ? (
          <span className="replay-ruling" aria-hidden="true">
            {snapshot.action.outcome}
          </span>
        ) : null}
      </div>

      <div
        className="courtcast-controls"
        role="group"
        aria-label="Courtcast playback"
      >
        <button
          type="button"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0}
          aria-label="Previous snapshot"
        >
          ←
        </button>
        <button type="button" onClick={() => setPlaying((current) => !current)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() =>
            setIndex((current) => Math.min(snapshots.length - 1, current + 1))
          }
          disabled={latest}
          aria-label="Next snapshot"
        >
          →
        </button>
        <button
          type="button"
          className={latest ? "is-live" : ""}
          onClick={() => setIndex(snapshots.length - 1)}
        >
          <span aria-hidden="true" /> Live
        </button>
        <small>{connection.toLowerCase()}</small>
      </div>

      <div className="latest-action live-action" aria-live="polite">
        <span>{latest ? "Latest verified action" : "Replay snapshot"}</span>
        <strong>{snapshot.action.label}</strong>
        <small>
          {snapshot.cursor} · {snapshot.source.replaceAll("_", " ")}
        </small>
        {formationDerived ? (
          <em>
            Lineup positions are diagrammatic; action and state are exact.
          </em>
        ) : (
          <em>Fixed-point positions from the possession resolver.</em>
        )}
      </div>
    </div>
  );
}
