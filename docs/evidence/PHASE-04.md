# Phase 4 evidence: first playable possession

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The first local possession is complete and independently reproducible:

- Ten persistent player-body adapters hold distinct secp256k1 identities and durable agent-authored lesson state.
- Each player receives its own partial observation and submits a strict structured action in each of three simultaneous decision windows.
- Both coaches submit separate EIP-712-authorized structured instructions per window. Three referees and two replay officials use separate typed interfaces, registered role keys, possession-bound evidence commitments, and content-disabled cognition receipts.
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
| Film commitment              | `0xf22d96173e77cea4af445501f80609fabd4a5629f0a68d236dfd7159c4f22a55` |
| Final public segment         | `0xd075bc39a5fe6b441300806707997d15aae6996a8e5b9466b4a2b71b0e5e8afe` |
| Replay inference invocations | 0                                                                    |

## Public arena

The Next.js 16 arena no longer imports a JSON fixture. It fetches the latest canonical local-rehearsal game from the read-only public API at `/` and `/arena`; if none exists, it renders an honest pre-genesis empty state. Its visual direction remains a courtside verification ledger: fixed-point court coordinates, causal event sequence, official confirmation, shortened display hashes with full values in titles, and an explicit zero-inference replay claim.

The original fixture-backed layout received desktop/mobile browser QA with the following results; the current API-backed page preserves that visual component tree and passes the production build, while a data-bound live browser rerun remains part of staging verification:

- Desktop 1280×720: one semantic main, one H1, ten player markers, six ledger items, no horizontal overflow, and no console warnings/errors.
- Mobile 390×844: no horizontal overflow, all players/events remain in the DOM, the court scales, the ledger stacks, and the proof grid collapses to one column.
- Semantic regions expose the score/clocks, fixed-point court, six-segment ledger, and independent proof. Reduced-motion and higher-contrast media rules are present.

The fixture remains only a deterministic presentation regression locked by the possession test. The end-to-end acceptance starts a real local public API and proves that the arena data loader receives the signed possession projection from it.

## Rehearsal-only vertical path

The same possession now crosses a complete local non-fixture path:

1. Persistent H1 signs `PossessionResolved` after all player, coach, referee, and replay authorizations are verified.
2. The rehearsal-only core API validates canonical content, admitted DID/key/aggregate scope, complete decision-proof cardinality, internal event/segment/Merkle consistency, and timestamp/version bounds.
3. The canonical store commits the event, aggregate head, actor nonce, idempotency result, and outbox atomically.
4. The projection worker independently reconstructs and verifies the canonical event/signature from durable outbox data before publishing an immutable fsynced projection hash chain.
5. A separately initialized public reader discovers post-startup records, serves games/events/cursor/segments/SSE, and the arena reads that API.
6. Projection and private-storage restart tests reconstruct their complete durable chains. A rogue-signed direct canonical-store insertion is rejected before public projection.

The mode is explicit (`ABL_REHEARSAL_MODE=1`); normal startup remains pre-genesis and rejects consequential commands.

## Verification

After formatting:

```text
pnpm check  -> 13/13 tasks
pnpm test   -> 43/43 tests (arena has no duplicate unit suite)
pnpm build  -> 10/10 packages; / and /arena statically prerendered
```

Adversarial cases reject changed cognition receipts/signature bindings, invalid randomness reveals, missing/duplicate participants, wrong window order, and any input containing a `winner` field.

Artifact locks:

- Public fixture: `sha256:8cd3c79217bfb8242ba3de44992e713ca1d602ab91bc620ba2d7ecf47cdfc19c`
- Deterministic engine: `sha256:6842f2acb2c6722f5f49db6a5a7a7a0a2de570ef27f3aea934b1f074110dd6c0`
- Random stream: `sha256:7145ace91a9f3d4d64a6e26c3d1d9833f1376f9ea2f61dbc8017896ee19d9ddf`
- Arena page: `sha256:56f27b1b8f2660336ae5f8d723816659ddf81f6cda4599dc069ab8f6b39e59ff`
- Lockfile: `sha256:b3dfbcaaa3f4de35fe6710d15d7f2a693b22b8230d8b0e149701c9ef4a5e614a`

## Retained platform gate

The player bodies and arena are real local adapters and production-buildable resources, but they have not been provisioned as named Blaxel Sandboxes because the four target workspaces are unavailable and Docker is offline. This local proof does not satisfy the later live isolation, provider-failure, concurrency, latency, or capacity gates.
