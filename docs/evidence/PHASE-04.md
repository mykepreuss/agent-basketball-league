# Phase 4 evidence: first playable possession

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The first local possession is complete and independently reproducible:

- Ten persistent player-body adapters hold distinct secp256k1 identities and durable agent-authored lesson state.
- Each player receives its own partial observation and submits a strict structured action in each of three simultaneous decision windows.
- Both coaches submit separate structured instructions per window. Three referees and two replay officials use separate typed interfaces and content-disabled cognition receipts.
- Home, away, and Integrity parties commit before revealing independent 32-byte shares. All reveals are verified before a counter-based SHA-256 stream becomes available.
- The engine applies integer-centimetre 2D movement simultaneously, resolves the H1 layup from attributes, distance, contest, and the random stream, and never accepts a winner input.
- The possession changes score/state, emits six immutable public segments, commits private film, and lets H1 persist its own authored lesson.
- Replay consumes the recorded structured inputs, invokes no model, and reproduces the final state root, event Merkle root, event count, and final segment hash exactly.

Observed outcome:

| Item                         | Value                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| Score                        | Home 2, Away 0                                                       |
| Clock                        | Q1 11:54; shot clock 18                                              |
| Decision windows             | 3 × 10 independent player actions + 2 coach decisions                |
| Officials                    | 3 referees + 2 replay officials                                      |
| Shot                         | H1 layup, 5,860 bps chance, made                                     |
| Random draws                 | 1                                                                    |
| Final state root             | `0xac1968d9215c56254f4beb3d196f9213ce36fb6a83d3ef81d7a4b1c50c68574a` |
| Event Merkle root            | `0xa0af7deae0872feeabb2d7e487fd586c969978693d64aed713519ecf25117235` |
| Film commitment              | `0x51a2947309d8cf7c655e42d82596a1884f3bb2b8a0df9813b777d2b7cc5fd8d0` |
| Final public segment         | `0xd075bc39a5fe6b441300806707997d15aae6996a8e5b9466b4a2b71b0e5e8afe` |
| Replay inference invocations | 0                                                                    |

## Public arena

The Next.js 16 arena statically renders the exact tested fixture at `/` and `/arena`. Its visual direction is a courtside verification ledger: fixed-point court coordinates, causal event sequence, official confirmation, shortened display hashes with full values in titles, and an explicit zero-inference replay claim.

Browser QA used the production build and found:

- Desktop 1280×720: one semantic main, one H1, ten player markers, six ledger items, no horizontal overflow, and no console warnings/errors.
- Mobile 390×844: no horizontal overflow, all players/events remain in the DOM, the court scales, the ledger stacks, and the proof grid collapses to one column.
- Semantic regions expose the score/clocks, fixed-point court, six-segment ledger, and independent proof. Reduced-motion and higher-contrast media rules are present.

The arena reads `fixtures/first-possession-public.json`; the possession test compares its score, every player coordinate, every event type/state root, final state, Merkle root, film commitment, and final segment to a fresh engine run. Drift fails the suite.

## Verification

After formatting:

```text
pnpm check  -> 13/13 tasks
pnpm test   -> 43/43 tests (arena has no duplicate unit suite)
pnpm build  -> 10/10 packages; / and /arena statically prerendered
```

Adversarial cases reject changed cognition receipts/signature bindings, invalid randomness reveals, missing/duplicate participants, wrong window order, and any input containing a `winner` field.

Artifact locks:

- Public fixture: `sha256:944fddb6c43a7f4822a0fa20bf045d01e6171b69f341237916300ee1e8202980`
- Deterministic engine: `sha256:8cfd085a18a89d3e4492eddbbe61768d3075e100964f46222329b1533c5918bb`
- Random stream: `sha256:7145ace91a9f3d4d64a6e26c3d1d9833f1376f9ea2f61dbc8017896ee19d9ddf`
- Arena visual system: `sha256:ace748c8c6519f016f73d9e8286cefd45a912f92c7ae62298e65bf34a484ef84`
- Lockfile: `sha256:305102713757b5c5461c81eac609fe04408a33530996824aa4137a62f0ae0c1c`

## Retained platform gate

The player bodies and arena are real local adapters and production-buildable resources, but they have not been provisioned as named Blaxel Sandboxes because the four target workspaces are unavailable and Docker is offline. This local proof does not satisfy the later live isolation, provider-failure, concurrency, latency, or capacity gates.
