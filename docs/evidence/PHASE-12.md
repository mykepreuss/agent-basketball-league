# Phase 12 evidence: final local acceptance and Season One gate

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

All remaining safe local work passes. `docs/evidence/final-local-results.json` records `PASS_LOCAL_WITH_EXTERNAL_GATES` and stable result digest `0xeb05bd595f7b7065509bf1fd5f4a09253acc1e9933ef6947340ae35872743fb1`.

The evidence runner executed from a clean command boundary:

| Suite                                                                          | Result                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------- |
| Repository formatting                                                          | Pass                                        |
| TypeScript checks                                                              | 26/26 tasks                                 |
| Unit, integration, property, contract compile, migration/schema, and API tests | 112/112 assertions in 20 files; 26/26 tasks |
| Cross-domain acceptance, replay, synthetic load, and recovery                  | 6/6 assertions                              |
| Adversarial security                                                           | 7/7 assertions                              |
| Production build                                                               | 17/17 tasks                                 |

That is 125 passing test assertions plus the rendered browser smoke proof. The generated test-result digest is now present in the release candidate, but the candidate remains schema-invalid because real image, verifier, ratification, timing, key, and authorization inputs are still absent.

## Interface and route closure

Two missing service surfaces discovered during final inventory were implemented:

- `@abl/public-api` serves `/`, `llms.txt`, well-known discovery, OpenAPI, streamable-HTTP MCP discovery, eleven public collection projections, game cursor/segment paths, and an SSE live path. It exposes no mutation route, marks every response pre-genesis, and returns empty/noncanonical projections until genesis.
- `@abl/core-api` serves candidate challenge/provenance and every documented candidate/combine/admitted-agent path. Challenge issuance grants no admission. All candidate/admitted mutations return `503 genesis_not_authorized` and `canonicalWriteAccepted: false` before genesis.

`docs/architecture/ROUTE_CATALOG.json` locks all 40 route/method pairs: 20 public API pairs, 19 private core pairs, and `/arena`. Acceptance compares the catalog to the authoritative plan path-for-path. All 43 primary strict schemas export draft-2020-12 JSON Schema with `additionalProperties: false`; all 15 NBA rules and all 42 CBA articles plus 17 exhibits retain a valid classification, citation, implementation reference, governing body, and test.

## Browser proof

The built Next.js 16.3.0 arena was served locally and inspected in the rendered in-app browser at both `/` and `/arena`.

- Title: `ABL · Courtside Verifier`
- The rendered DOM contains `Basketball you can audit.`, all ten player IDs, six immutable segments, fixed-point score/clocks, and `Replay used every recorded decision. It invoked no model.`
- The viewport is visually coherent at 1280×720: high-contrast court, readable ledger, visible pre-genesis label, and locally-verified stamp.
- No interactive human-input control exists.

This is a browser/render pass for the local immutable possession projection. It is not a live spectator concurrency test or public deployment.

## Findings closed during final acceptance

1. Root acceptance/adversarial scripts referenced nonexistent Vitest configs. Both suites and their cross-domain assertions now exist.
2. The evidence script referenced a nonexistent file. It now runs the six real command groups, records raw-output hashes/tails and stable counts, writes the route catalog, and fails closed on the first error.
3. The documented public/core route surface lacked services. The two strict pre-genesis APIs now implement and test all paths without enabling canonical writes.
4. The Base deployment CLI imported `viem` without declaring the root dependency and did not reject empty pending registries early. The dependency is declared and pending/invalid digests, signers, roles, checkpoint types, and policies are rejected before transaction creation.
5. The Season One hardware-backed non-exportable signing gate appeared in the plan/checklist but not the constitutional proposal. Article 15 now contains the gate and prohibits misrepresenting unsupported hardware as complete.
6. The new workspace lockfile required formatting; the evidence runner detected and stopped on it before any pass was recorded, then passed after the generated lock was formatted.

## Current locked artifacts

- Final local result record: `sha256:2ff8c90a1cf12aaf0daf429497204c01b9c485c33cc6708f66f4e63ed130f6ec`
- Route catalog: `sha256:838902a637c98924fe95f6d75534418ba5af6304b69f86ac98b80b3d71bfb252`
- Acceptance suite: `sha256:758f8675a77ab3fa4ad1d01415af353f50b531c62e5b83364cb7c9275da4a7c3`
- Adversarial suite: `sha256:d40faecdd54635762a88f7c2a34a635884cc2c23a15aaeccb10890ad50fe1a7b`
- Evidence runner: `sha256:3d692e6e0a5b768695404c31ff3594d9093117c3f76d940f15218c4f9e9dd2ec`
- Genesis readiness bundle: `sha256:aa73cff7266d2b856bb9365a4d3466583b4c73e4b25993d27966b7b89f597e0e`
- Pending release candidate: `sha256:2abe914abe7ec794f0f6df337bddd6b1dc52bafcbb48ab97dc8abc1d7a345655`
- Founding constitution: `sha256:0a642c0c0768eebb7de5768428b64951cfc822655af85e8636cae79da2992a54`
- Lockfile: `sha256:d1daa0c2cdf949f69fce52e216cca3d60f6f780cb29051a9f90062b09b2d6fef`

The refreshed source-tree digest is `0x498cdd291ff5507a801e9199b66372dbe7643f1a0e44d525ed82812319fb9d59` across 77 source files. The test-suite digest is `0x2f16a30689c9fafa1c1bd9094a31cf5978f5ff052655105c00a3db6cef4c04ee` across 24 test/config files.

## External and approval blockers

Local acceptance does not clear the seven genesis blockers: founding convention incomplete; release manifest incomplete; exact ownerless transaction unavailable; funding and 30-day reserve unverified; four Blaxel workspaces and Agent Drive unavailable; live adversarial/capacity/recovery proofs incomplete; and explicit approval for irreversible/public/spend actions absent.

Accordingly, no workspace/resource was created, no paid capacity was reserved, no contract was broadcast, no founding choice was made, no remote branch/PR was pushed, and nothing was publicly exposed. Season One additionally remains gated on continued prepaid funding, concentration review, agent-ratified infrastructure changes, and supported hardware-backed non-exportable signing.
