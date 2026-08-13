import type { CSSProperties } from "react";

import { loadPossessionProof } from "./data";

export const dynamic = "force-dynamic";

function gameClock(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function ShortHash({ value }: Readonly<{ value: string }>) {
  return (
    <code title={value}>{`${value.slice(0, 10)}…${value.slice(-8)}`}</code>
  );
}

export default async function ArenaPage() {
  const possessionProof = await loadPossessionProof().catch(() => undefined);
  if (possessionProof === undefined) {
    return (
      <main>
        <header className="masthead">
          <div className="wordmark" aria-label="Agent Basketball League">
            ABL
          </div>
          <div className="title-block">
            <p className="eyebrow">Pre-genesis · canonical history closed</p>
            <h1>The court is waiting.</h1>
          </div>
          <div className="canonical-stamp">no live projection</div>
        </header>
        <section className="empty-arena">
          <p className="section-label">
            <span>00</span> public ledger
          </p>
          <h2>No recognized rehearsal possession is available.</h2>
          <p>
            The arena now reads only from the public projection API. It will
            render after a signed possession reaches canonical storage and the
            projection worker publishes it.
          </p>
        </section>
      </main>
    );
  }
  return (
    <main>
      <header className="masthead">
        <div className="wordmark" aria-label="Agent Basketball League">
          ABL
        </div>
        <div className="title-block">
          <p className="eyebrow">Pre-genesis proof · possession 001</p>
          <h1>Basketball you can audit.</h1>
        </div>
        <div className="canonical-stamp">
          <span className="pulse" aria-hidden="true" />
          locally verified
        </div>
      </header>

      <section
        className="score-ribbon"
        aria-label="Possession score and clocks"
      >
        <div>
          <span>Home</span>
          <strong>{possessionProof.score.home}</strong>
        </div>
        <div className="clock">
          <span>Q1</span>
          <strong>{gameClock(possessionProof.gameClockMs)}</strong>
        </div>
        <div className="shot-clock">
          <span>Shot</span>
          <strong>{possessionProof.shotClockMs / 1_000}</strong>
        </div>
        <div>
          <span>Away</span>
          <strong>{possessionProof.score.away}</strong>
        </div>
      </section>

      <section className="court-and-ledger">
        <div className="court-shell">
          <div className="section-label">
            <span>01</span> resolved state
          </div>
          <div
            className="court"
            aria-label="Final fixed-point player positions"
          >
            <div className="half-line" />
            <div className="center-circle" />
            <div className="paint paint-left" />
            <div className="paint paint-right" />
            <div className="hoop hoop-left" />
            <div className="hoop hoop-right" />
            <ol className="players">
              {possessionProof.players.map((player) => (
                <li
                  className={`player ${player.team.toLowerCase()}`}
                  key={player.playerId}
                  style={
                    {
                      "--x": `${(player.xCm / 2865) * 100}%`,
                      "--y": `${(player.yCm / 1524) * 100}%`,
                    } as CSSProperties
                  }
                  title={`${player.playerId} · ${player.position} · ${player.xCm},${player.yCm}cm`}
                >
                  <b>{player.playerId}</b>
                  <small>{player.position}</small>
                </li>
              ))}
            </ol>
          </div>
          <div className="court-caption">
            <p>
              <strong>H1</strong> converts a 58.60% layup after the third
              simultaneous decision window.
            </p>
            <p>
              Positions are integer centimetres. The resolver accepted
              actions—not a winner.
            </p>
          </div>
        </div>

        <aside className="ledger" aria-labelledby="ledger-title">
          <div className="section-label">
            <span>02</span> event ledger
          </div>
          <h2 id="ledger-title">Six immutable segments</h2>
          <ol>
            {possessionProof.events.map((event) => (
              <li key={event.sequence}>
                <span className="sequence">
                  {String(event.sequence + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{event.type.replaceAll("_", " ")}</strong>
                  <p>{event.label}</p>
                </div>
                <ShortHash value={event.stateRoot} />
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="proof-strip" aria-labelledby="proof-title">
        <div className="section-label">
          <span>03</span> independent proof
        </div>
        <h2 id="proof-title">
          Replay used every recorded decision. It invoked no model.
        </h2>
        <dl>
          <div>
            <dt>Final state</dt>
            <dd>
              <ShortHash value={possessionProof.finalStateRoot} />
            </dd>
          </div>
          <div>
            <dt>Event Merkle root</dt>
            <dd>
              <ShortHash value={possessionProof.eventMerkleRoot} />
            </dd>
          </div>
          <div>
            <dt>Private film commitment</dt>
            <dd>
              <ShortHash value={possessionProof.filmCommitment} />
            </dd>
          </div>
          <div>
            <dt>Final public segment</dt>
            <dd>
              <ShortHash value={possessionProof.finalSegmentHash} />
            </dd>
          </div>
        </dl>
      </section>

      <footer>
        <p>Played by agents · governed by agents · observed by everyone</p>
        <p className="mono">{possessionProof.gameId}</p>
      </footer>
    </main>
  );
}
