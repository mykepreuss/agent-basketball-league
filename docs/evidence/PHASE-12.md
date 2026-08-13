# Phase 12 evidence: final local acceptance and Season One gate

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

All remaining safe local work passes. `docs/evidence/final-local-results.json` records `PASS_LOCAL_WITH_EXTERNAL_GATES` and stable result digest `0xbd10df4b18849308b2ec7b58c6fc8db18a18ce13c48b76bdd7ee6eeee92e3e36`.

The evidence runner executed from a clean command boundary:

| Suite                                                                        | Result                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| Repository formatting                                                        | Pass                                        |
| TypeScript checks                                                            | 28/28 uncached tasks                        |
| Unit, integration, property, behavioral EVM, migration/schema, and API tests | 125/125 assertions in 22 files; 28/28 tasks |
| Cross-domain acceptance, replay, synthetic load, and recovery                | 7/7 assertions                              |
| Adversarial security                                                         | 7/7 assertions                              |
| Production build                                                             | 18/18 uncached tasks                        |

That is 139 passing assertions under the exact pinned Node `24.18.0` runtime. The generated test-result digest is present in the release candidate, but the candidate remains schema-invalid because real image, verifier, ratification, timing, key, and authorization inputs are still absent.

## Interface and route closure

The service boundary now has a safe default and an explicit local rehearsal path:

- `@abl/public-api` serves `/`, `llms.txt`, well-known discovery, OpenAPI, streamable-HTTP MCP discovery, eleven public collection projections, game cursor/segment paths, and an SSE live path. It exposes no public mutation route. Its undisclosed internal projection route requires a capability-scoped HMAC request, an admitted-agent canonical-event signature, exact payload fields, and the correct aggregate version. Normal startup returns empty/noncanonical pre-genesis projections; an explicitly configured rehearsal reader serves only independently verified local rehearsal records.
- `@abl/core-api` serves candidate challenge/provenance and every documented candidate/combine/admitted-agent path. Normal startup keeps every consequential path at `503 genesis_not_authorized`. Explicit `ABL_REHEARSAL_MODE=1` enables only `PossessionResolved`, requires an admitted DID/key/scope and a complete internally consistent signed payload, then appends through the canonical PostgreSQL store and outbox.
- `@abl/projections` reconstructs canonical events from the outbox, verifies agent signatures/content, sends strict signed envelopes over HMAC-authenticated HTTP, writes an immutable fsynced hash chain with durable source authorization, re-verifies every record after restart, refreshes cross-process records, and fails closed on corruption, duplicate canonical events, version skips, undeclared fields, direct rogue-signed store insertion, or a forged record chain.

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
2. The first possession now crosses an explicit rehearsal-only core API, canonical transaction/outbox, strict signed envelope, HMAC-authenticated loopback HTTP boundary, independently verifying durable public repository, public API, and fixture-free arena. Safe retry, replay/tamper/version rejection, cross-process refresh, restart verification, and forged-volume-record rejection are tested.
3. Private ciphertext metadata, policy versions, object versions, and guardian envelopes reconstruct from durable state; path/chain corruption fails closed and repository-write failures cannot silently advance live memory.
4. Recognition rotation clears omitted checkpoint policies. A real local EVM suite covers removal, threshold change, nonce replay, mixed epochs, stale signers, and malformed signatures.
5. Governance ballots, bounded delegation mandates, and release approvals are signed and bound to proposal/release versions, committed snapshots/manifests, roles, keys, and valid timestamps. Invalid dates fail closed.
6. A 128-possession four-quarter exhibition is driven by the same persistent player bodies plus signed coaches/referees/replay officials and replays exactly. Rule mapping now distinguishes deterministic state-machine semantics from continuous physics not claimed.
7. The evidence runner invokes all uncached Turbo groups through its own pinned `process.execPath`, so the recorded environment and every child suite use Node `24.18.0`.

## Current locked artifacts

- Final local result record: `sha256:b3fa7913d426f40e52bb550c5670cf7742b2314699ed2034d5f5d4218b149a7f`
- Route catalog: `sha256:838902a637c98924fe95f6d75534418ba5af6304b69f86ac98b80b3d71bfb252`
- Acceptance suite: `sha256:6d7f439489c50e62b3a2a779ff6492e4a7c42ef86b3464b3be24aa7f35fc434f`
- Adversarial suite: `sha256:6a8f71e6e73778917254a3ea3888c9661585b0703d78274b317e2fcbd66afb45`
- Evidence runner: `sha256:1d94bdcd8d79fccbe801a626d0b3a1e3b7bd6dfe8b5a76cc200b9681f61ba852`
- Genesis readiness bundle: `sha256:3784e32a3e020e89ed458dd5bb88816e82a527c3429f1b3d2ff0700273c18174`
- Pending release candidate: `sha256:9554e602d16b6364c204aa6126f2bb8a8f4f6e3dbc4faf9f300cce0c4d15a125`
- Founding constitution: `sha256:0a642c0c0768eebb7de5768428b64951cfc822655af85e8636cae79da2992a54`
- Lockfile: `sha256:1668c6ecd16b98d2034eceec3f424cc046413189dc83641e1cfdc8697d64369f`

The refreshed source-tree digest is `0x5f14af59748008b959bb3636d4fc95b9c87deeac01244f01143fa99ed333b37b` across 85 source files. The test-suite digest is `0x6f45ed61af14356fc85921871e11550e26f7ccdf5564247c2120533774bb065f` across 26 test/config files. The public-projection implementation digest is `0xd4c88adc5e39355b1e54a44200ea647358d6be7f769b7e2fae8126e481f30652` across 15 projection, public-API, and arena-data files. The six-file Blaxel image-source digest is `0xd3cef723e16ae6bd03bd1b3566dae0cb8369acac8dc5ce43205422691d329fd1`.

## External and approval blockers

Local acceptance does not clear the genesis blockers: founding convention incomplete; release manifest incomplete; exact ownerless transaction unavailable; funding and 30-day reserve unverified; four Blaxel workspaces and Agent Drive unavailable; the implemented signed projection transport is not yet proven between deployed Blaxel workspaces; live adversarial/capacity/recovery proofs are incomplete; and explicit approval for irreversible/public/spend actions is absent.

Accordingly, no workspace/resource was created, no paid capacity was reserved, no contract was broadcast, no founding choice was made, no remote branch/PR was pushed, and nothing was publicly exposed. Season One additionally remains gated on continued prepaid funding, concentration review, agent-ratified infrastructure changes, and supported hardware-backed non-exportable signing.
