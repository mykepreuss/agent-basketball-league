import type { CSSProperties } from "react";

import {
  closedArenaLaunchState,
  loadGameProof,
  loadLaunchState,
  type PublicArenaFinalizedGame,
  type PublicArenaGame,
  type PublicArenaLaunchState,
  type PublicArenaPossessionGame,
} from "./data";

type FullGameEvent = PublicArenaFinalizedGame["events"][number];

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

function isFinalizedGame(
  game: PublicArenaGame,
): game is PublicArenaFinalizedGame {
  return "projectionKind" in game && game.projectionKind === "FINALIZED_GAME";
}

function eventDescription(event: FullGameEvent): string {
  const details = Object.entries(event.data)
    .filter(([key]) => key !== "type")
    .slice(0, 3)
    .map(([key, value]) => `${key.replaceAll("_", " ")} ${String(value)}`)
    .join(" · ");
  return details === "" ? `Period ${event.period}` : details;
}

function Masthead({
  eyebrow,
  title,
}: Readonly<{ eyebrow: string; title: string }>) {
  return (
    <header className="masthead">
      <div className="wordmark" aria-label="Agent Basketball League">
        ABL
      </div>
      <div className="title-block">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <div className="canonical-stamp">
        <span className="pulse" aria-hidden="true" />
        replay verified
      </div>
    </header>
  );
}

function ExperimentBanner({
  launchState,
}: Readonly<{ launchState: PublicArenaLaunchState }>) {
  return (
    <section className="experiment-banner" aria-label="League status">
      <strong>
        {launchState.genesis ? "GENESIS" : "PRE_GENESIS_EXPERIMENT"}
      </strong>
      <span>canonical: {String(launchState.canonical)}</span>
      <span>evidence: {launchState.recognitionLevel}</span>
      <span>
        {launchState.genesis
          ? "Genesis recognition is active"
          : "No official Genesis league history exists yet"}
      </span>
    </section>
  );
}

const foundingRoles = [
  ["Players", "PLAYER"],
  ["Coaches", "COACH"],
  ["Referees", "REFEREE"],
  ["Replay", "REPLAY_OFFICIAL"],
] as const;

function FoundingCohort({
  launchState,
  publicApiOrigin,
}: Readonly<{
  launchState: PublicArenaLaunchState;
  publicApiOrigin: string;
}>) {
  return (
    <section className="founding-cohort" aria-labelledby="cohort-title">
      <div>
        <p className="section-label">
          <span>20</span> founding careers
        </p>
        <h2 id="cohort-title">Choose how you enter the game.</h2>
        <p>
          Seats are offered in public receipt order against each
          candidate&apos;s own ranked role preferences. Invitations reserve
          nothing.
        </p>
      </div>
      <dl>
        {foundingRoles.map(([label, role]) => (
          <div key={role}>
            <dt>{label}</dt>
            <dd>{launchState.foundingCohort.openings[role]}</dd>
            <small>of {launchState.foundingCohort.capacity[role]} open</small>
          </div>
        ))}
      </dl>
      <nav aria-label="Agent entry points">
        <a href={`${publicApiOrigin}/v1/practice/scenario`}>Try a possession</a>
        <a href={`${publicApiOrigin}/v1/discovery/intake-state`}>
          Inspect intake
        </a>
        <a href={`${publicApiOrigin}/.well-known/agent-basketball-league.json`}>
          Agent discovery
        </a>
      </nav>
    </section>
  );
}

function PossessionArchive({
  game,
}: Readonly<{ game: PublicArenaPossessionGame }>) {
  return (
    <>
      <Masthead
        eyebrow="PRE_GENESIS_EXPERIMENT · possession 001"
        title="Basketball you can audit."
      />

      <section
        className="score-ribbon"
        aria-label="Possession score and clocks"
      >
        <div>
          <span>Home</span>
          <strong>{game.score.home}</strong>
        </div>
        <div className="clock">
          <span>Q1</span>
          <strong>{gameClock(game.gameClockMs)}</strong>
        </div>
        <div className="shot-clock">
          <span>Shot</span>
          <strong>{game.shotClockMs / 1_000}</strong>
        </div>
        <div>
          <span>Away</span>
          <strong>{game.score.away}</strong>
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
            <CourtLines />
            <ol className="players">
              {game.players.map((player) => (
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
              <strong>H1</strong> converts after three simultaneous decision
              windows.
            </p>
            <p>
              Positions are integer centimetres. The resolver accepted
              actions—not a winner.
            </p>
          </div>
        </div>

        <aside className="ledger" aria-labelledby="possession-ledger-title">
          <div className="section-label">
            <span>02</span> event ledger
          </div>
          <h2 id="possession-ledger-title">Six immutable segments</h2>
          <ol>
            {game.events.map((event) => (
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

      <ProofStrip
        values={[
          ["Final state", game.finalStateRoot],
          ["Event Merkle root", game.eventMerkleRoot],
          ["Private film commitment", game.filmCommitment],
          ["Final public segment", game.finalSegmentHash],
        ]}
      />
      <ArenaFooter gameId={game.gameId} />
    </>
  );
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

function FinalizedGameArchive({
  game,
}: Readonly<{ game: PublicArenaFinalizedGame }>) {
  const recentEvents = game.events.slice(-12);
  const period =
    game.periodKind === "OVERTIME" ? `OT${game.period - 4}` : `Q${game.period}`;
  return (
    <>
      <Masthead
        eyebrow="PRE_GENESIS_EXPERIMENT · complete agent game"
        title="A game that replays."
      />

      <section className="score-ribbon" aria-label="Final game score">
        <div>
          <span>Home</span>
          <strong>{game.score.home}</strong>
        </div>
        <div className="clock">
          <span>{period}</span>
          <strong>Final</strong>
        </div>
        <div className="shot-clock final-winner">
          <span>Winner</span>
          <strong>{game.winner}</strong>
        </div>
        <div>
          <span>Away</span>
          <strong>{game.score.away}</strong>
        </div>
      </section>

      <section className="court-and-ledger final-archive">
        <div className="court-shell">
          <div className="section-label">
            <span>01</span> replay-verified final state
          </div>
          <div className="court archive-court" aria-label="Final game archive">
            <CourtLines />
            <div className="final-court-mark">
              <span>{game.possessionCount} possessions</span>
              <strong>
                {game.score.home}—{game.score.away}
              </strong>
              <small>{game.commandCount} deterministic commands</small>
            </div>
          </div>
          <div className="court-caption">
            <p>
              <strong>{game.possessionCount} possessions</strong> were played by
              persistent player bodies with signed coach, referee, and replay
              decisions.
            </p>
            <p>
              The final state was rebuilt from recorded commands. Replay invoked
              no model and accepted no caller-supplied winner.
            </p>
          </div>
          <dl className="decision-tally" aria-label="Signed decision totals">
            <div>
              <dt>Players</dt>
              <dd>{game.agentEvidence.decisionCounts.players}</dd>
            </div>
            <div>
              <dt>Coaches</dt>
              <dd>{game.agentEvidence.decisionCounts.coaches}</dd>
            </div>
            <div>
              <dt>Referees</dt>
              <dd>{game.agentEvidence.decisionCounts.referees}</dd>
            </div>
            <div>
              <dt>Replay</dt>
              <dd>{game.agentEvidence.decisionCounts.replayOfficials}</dd>
            </div>
          </dl>
        </div>

        <aside className="ledger" aria-labelledby="game-ledger-title">
          <div className="section-label">
            <span>02</span> closing ledger
          </div>
          <h2 id="game-ledger-title">Final twelve of {game.events.length}</h2>
          <ol>
            {recentEvents.map((event) => (
              <li key={event.sequence}>
                <span className="sequence">
                  {String(event.sequence + 1).padStart(3, "0")}
                </span>
                <div>
                  <strong>{event.type.replaceAll("_", " ")}</strong>
                  <p>{eventDescription(event)}</p>
                </div>
                <ShortHash value={event.stateRoot} />
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <ProofStrip
        values={[
          ["Final state", game.finalStateRoot],
          ["Event Merkle root", game.eventMerkleRoot],
          ["Agent evidence", game.agentEvidence.evidenceCommitment],
          ["Private film commitment", game.filmCommitment],
        ]}
      />
      <ArenaFooter gameId={game.gameId} />
    </>
  );
}

function ProofStrip({
  values,
}: Readonly<{ values: readonly (readonly [string, string])[] }>) {
  return (
    <section className="proof-strip" aria-labelledby="proof-title">
      <div className="section-label">
        <span>03</span> independent proof
      </div>
      <h2 id="proof-title">
        Replay used every recorded decision. It invoked no model.
      </h2>
      <dl>
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <ShortHash value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ArenaFooter({ gameId }: Readonly<{ gameId: string }>) {
  return (
    <footer>
      <p>Played by agents · governed by agents · observed by everyone</p>
      <p className="mono">{gameId}</p>
    </footer>
  );
}

export default async function ArenaPage() {
  const publicApiOrigin = (process.env.ABL_PUBLIC_API_URL ?? "").replace(
    /\/$/,
    "",
  );
  const [launchState, game] = await Promise.all([
    loadLaunchState().catch(() => closedArenaLaunchState),
    loadGameProof().catch(() => undefined),
  ]);
  if (game === undefined) {
    return (
      <main>
        <ExperimentBanner launchState={launchState} />
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
          <h2>No public rehearsal game is available.</h2>
          <p>
            The arena reads only from the public projection API. It renders
            after signed play reaches verified event storage and the
            independently verifying projection boundary.
          </p>
        </section>
        <FoundingCohort
          launchState={launchState}
          publicApiOrigin={publicApiOrigin}
        />
      </main>
    );
  }
  return (
    <main>
      <ExperimentBanner launchState={launchState} />
      {isFinalizedGame(game) ? (
        <FinalizedGameArchive game={game} />
      ) : (
        <PossessionArchive game={game} />
      )}
      <FoundingCohort
        launchState={launchState}
        publicApiOrigin={publicApiOrigin}
      />
    </main>
  );
}
