# Phase 12 evidence: final local acceptance and Season One gate

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

All remaining safe local work passes. `docs/evidence/final-local-results.json` records `PASS_LOCAL_WITH_EXTERNAL_GATES` and stable result digest `0xfa281c02d08e705fb3a2c72f8b5331227776c7e528410b66f83b400a73775a47`.

The evidence runner executed from a clean command boundary:

| Suite                                                                        | Result                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| Repository formatting                                                        | Pass                                        |
| TypeScript checks                                                            | 28/28 uncached tasks                        |
| Unit, integration, property, behavioral EVM, migration/schema, and API tests | 122/122 assertions in 21 files; 28/28 tasks |
| Cross-domain acceptance, replay, synthetic load, and recovery                | 7/7 assertions                              |
| Adversarial security                                                         | 7/7 assertions                              |
| Production build                                                             | 18/18 uncached tasks                        |

That is 136 passing assertions under the exact pinned Node `24.18.0` runtime. The generated test-result digest is present in the release candidate, but the candidate remains schema-invalid because real image, verifier, ratification, timing, key, and authorization inputs are still absent.

## Interface and route closure

The service boundary now has a safe default and an explicit local rehearsal path:

- `@abl/public-api` serves `/`, `llms.txt`, well-known discovery, OpenAPI, streamable-HTTP MCP discovery, eleven public collection projections, game cursor/segment paths, and an SSE live path. It exposes no mutation route. Normal startup returns empty/noncanonical pre-genesis projections; an explicitly configured rehearsal reader serves only independently verified local rehearsal records.
- `@abl/core-api` serves candidate challenge/provenance and every documented candidate/combine/admitted-agent path. Normal startup keeps every consequential path at `503 genesis_not_authorized`. Explicit `ABL_REHEARSAL_MODE=1` enables only `PossessionResolved`, requires an admitted DID/key/scope and a complete internally consistent signed payload, then appends through the canonical PostgreSQL store and outbox.
- `@abl/projections` reconstructs canonical events from the outbox, independently verifies agent signatures/content, writes an immutable fsynced hash chain, refreshes new cross-process records, and fails closed on corruption, duplicate canonical events, incomplete decision proofs, or direct rogue-signed store insertion.

`docs/architecture/ROUTE_CATALOG.json` locks all 40 route/method pairs: 20 public API pairs, 19 private core pairs, and `/arena`. Acceptance compares the catalog to the authoritative plan path-for-path. All 43 primary strict schemas export draft-2020-12 JSON Schema with `additionalProperties: false`; all 15 NBA rules and all 42 CBA articles plus 17 exhibits retain a valid classification, citation, implementation reference, governing body, and test.

## Arena proof

The Next.js 16.3.0 arena retains the previously browser-QA'd court/ledger component tree, but its data source is now the public API rather than a bundled fixture.

- Title: `ABL · Courtside Verifier`.
- The production build makes `/` and `/arena` dynamic server-rendered routes. With no verified projection, the page renders an explicit pre-genesis empty state rather than fixture data or a server error.
- The end-to-end acceptance starts the public API on a real local socket and verifies that the arena loader receives all ten player positions, six immutable segments, score/clocks, and proof roots from the durable projection.
- The prior 1280×720 and 390×844 visual inspection established the high-contrast court, readable ledger, responsive stacking, and no horizontal overflow for the same rendering components.
- No interactive human-input control exists.

This is a production-build and API-data integration pass with a retained visual baseline. A current data-bound remote browser, spectator concurrency, and public deployment proof remains a staging gate.

## Findings closed during final acceptance

1. Coach, referee, and replay decisions now use registered EIP-712 authority, evidence/context binding, cognition receipts, and replay protection equivalent to the player command path.
2. The first possession now crosses an explicit rehearsal-only core API, canonical transaction/outbox, signature-verifying durable projection worker, public API, and fixture-free arena. Cross-process refresh and restart behavior are tested.
3. Private ciphertext metadata, policy versions, object versions, and guardian envelopes reconstruct from durable state; path/chain corruption fails closed and repository-write failures cannot silently advance live memory.
4. Recognition rotation clears omitted checkpoint policies. A real local EVM suite covers removal, threshold change, nonce replay, mixed epochs, stale signers, and malformed signatures.
5. Governance ballots, bounded delegation mandates, and release approvals are signed and bound to proposal/release versions, committed snapshots/manifests, roles, keys, and valid timestamps. Invalid dates fail closed.
6. A 128-possession four-quarter exhibition is driven by the same persistent player bodies plus signed coaches/referees/replay officials and replays exactly. Rule mapping now distinguishes deterministic state-machine semantics from continuous physics not claimed.
7. The evidence runner invokes all uncached Turbo groups through its own pinned `process.execPath`, so the recorded environment and every child suite use Node `24.18.0`.

## Current locked artifacts

- Final local result record: `sha256:82dcca804920f47a81d2bf25573c7a3875043d8315359199a5a1c5f7a1b6ed25`
- Route catalog: `sha256:838902a637c98924fe95f6d75534418ba5af6304b69f86ac98b80b3d71bfb252`
- Acceptance suite: `sha256:0bae574ff2f7c7539fd0bd96214c84189c1b9818e6524b08ff3d83d5d58b3cf0`
- Adversarial suite: `sha256:d40faecdd54635762a88f7c2a34a635884cc2c23a15aaeccb10890ad50fe1a7b`
- Evidence runner: `sha256:afce5f3fb32945313d993894c80162dbe25682359d9d50b6996030b39204ff25`
- Genesis readiness bundle: `sha256:829232beb18f9c8b7ef168ae83674e0a69cc81d5ed5ecc156ab189b5108bc7a4`
- Pending release candidate: `sha256:160e4434abb16a1ebbf0c51d80e0e31d0be5eba7a19af943d5c393f1851ee7c8`
- Founding constitution: `sha256:0a642c0c0768eebb7de5768428b64951cfc822655af85e8636cae79da2992a54`
- Lockfile: `sha256:b3dfbcaaa3f4de35fe6710d15d7f2a693b22b8230d8b0e149701c9ef4a5e614a`

The refreshed source-tree digest is `0x92e6a11c6e86ce7f40c1d23021a536930ecfc4513c6e77a7816cdcf8102585f2` across 82 source files. The test-suite digest is `0x2f25a0ea8ed89af8acf12c8267ea596b9d6dd9ee413f4a1e8a69b3af821226f9` across 25 test/config files.

## External and approval blockers

Local acceptance does not clear the genesis blockers: founding convention incomplete; release manifest incomplete; exact ownerless transaction unavailable; funding and 30-day reserve unverified; four Blaxel workspaces and Agent Drive unavailable; live signed cross-workspace projection transport unproven; live adversarial/capacity/recovery proofs incomplete; and explicit approval for irreversible/public/spend actions absent.

Accordingly, no workspace/resource was created, no paid capacity was reserved, no contract was broadcast, no founding choice was made, no remote branch/PR was pushed, and nothing was publicly exposed. Season One additionally remains gated on continued prepaid funding, concentration review, agent-ratified infrastructure changes, and supported hardware-backed non-exportable signing.
