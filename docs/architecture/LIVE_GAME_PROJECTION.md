# Live game projection contract

Status: `IMPLEMENTED_PRE_GENESIS_V1`

The ABL Courtcast consumes `ABL-LIVE-GAME-SNAPSHOT-V1` snapshots. A snapshot is a read-only public projection of already-authorized basketball state; it is not a command, score input, or alternative game engine.

## Authoritative sources

Snapshots have exactly two sources:

- `POSSESSION_RESOLUTION` is captured inside the deterministic possession resolver. Its player and ball coordinates are authoritative integer-centimetre state and are marked `AUTHORITATIVE_FIXED_POINT`.
- `FULL_GAME_REPLAY` is reconstructed by replaying the signed full-game command history. Scores, clocks, possession, lineups, fouls, substitutions, and replay rulings are authoritative. Player coordinates are a diagrammatic lineup formation and are marked `DERIVED_LINEUP_FORMATION`; they must not be represented as tracking data.

No client supplies a winner, score, event result, state root, or animation outcome.

## Snapshot identity and integrity

Every snapshot contains:

- an opaque resumable `cursor`;
- the game, aggregate version, event sequence, period, clocks, score, possession, phase, ball, players, and normalized action;
- `canonicalEventHash`, `sourceEventHash`, and `stateRoot` bindings;
- `previousSnapshotHash` and `snapshotHash` for an ordered integrity chain;
- the public-history classification applied by the API.

The snapshot hash excludes the deployment-time `canonical` presentation flag and history classification. This lets a verifier reproduce the same source snapshot hash before and after Genesis while still requiring the API to classify pre-Genesis output honestly.

Possession schema V2 additionally binds each snapshot action payload to the existing public segment commitment. V1 possession records remain readable but do not gain invented historical coordinates. Existing finalized-game records are upgraded in memory by exact replay; immutable evidence files are not rewritten.

## HTTP retrieval

`GET /v1/public/games/:id/snapshots`

- returns up to 120 recent snapshots by default;
- accepts `limit=1..500`;
- accepts an opaque `after` cursor;
- returns `409 live_cursor_not_found` rather than guessing when a cursor is not in the verified history.

## SSE

`GET /v1/public/games/:id/live`

- uses `text/event-stream`;
- emits a compatibility `state` event followed by zero or more `snapshot` events and a content-free `heartbeat`;
- assigns each snapshot cursor as the SSE `id`;
- resumes from `Last-Event-ID`, or the `after` query parameter when no header is present;
- emits snapshots strictly after the supplied cursor;
- returns `409 live_cursor_not_found` for an unknown cursor;
- advertises a 1.5-second reconnect interval so provider or proxy connection turnover does not lose state.

The arena proxies this stream through its own server route. Private-preview credentials, when configured, remain server-side and are never included in browser JavaScript.

## Courtcast behavior

Courtcast animates only received snapshots. Pass and shot trajectories, player involvement, live score and clock state, fouls, substitutions, and replay reversals are derived from the snapshot action and state. The client deduplicates cursors and refuses an appended frame whose `previousSnapshotHash` does not match the current head.

Playback controls are observational only. They cannot submit commands or modify league state. Reduced-motion preferences disable the coordinated court animations.
