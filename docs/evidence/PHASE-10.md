# Phase 10 evidence: security, capacity, and recovery proof

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

`@abl/assurance` turns the locally executable part of the security, capacity, recovery, and wind-down plan into nine passing tests. A separate two-project Playwright suite exercises the production arena over HTTP. It does not convert unavailable provider exercises into synthetic claims.

The static sandbox analysis covers all seven required escape vectors: direct sockets, alternate DNS, custom TLS, subprocesses, local/private routes, metadata routes, and workload-token access. Every required fixed-broker source control is present. Every result also carries `liveExecuted: false` and `NOT_EXECUTED_BLAXEL_SANDBOX_GATE`, because a target Blaxel sandbox is unavailable. A local Docker daemon is not required for Blaxel's image build and would not satisfy this live platform proof.

The public-compromise analysis verifies that `abl-public` has only a Base checkpoint-read edge, explicit denials to core/private/competition, no canonical-write or agent-invocation authority, and no competition credentials or private storage. Its projection Agent receives only a capability-scoped HMAC verification secret plus the public admitted-agent key registry; the HMAC cannot create the required agent-signed canonical envelope. Each durable projection stores that envelope and re-verifies it on restart, so recomputing the unkeyed local record chain does not create persistent recognized history. The public YAML manifests contain no database, Drive, provider-key, or domain private-key values. This is a topology/source/local-adversarial proof, not a live penetration test.

## Local 2x synthetic capacity proof

The harness runs entirely in one Node process on Darwin arm64. It executes:

- 20,000 immutable cursor/segment polls for the 10,000-spectator target;
- 2,000 distinct candidate-admission sessions for the 1,000-registration/day target;
- 20 complete deterministic exhibition games for the ten-simultaneous-game target; and
- 400 distinct active body-lifecycle objects for the 200-body target.

One recorded run observed 2,000 accepted candidates, 20 exact games, 400 active bodies, 17 immutable game segments, 0% public errors, 0.014666 ms cursor/segment P95, 1,000 ms maximum modeled broadcast lag, zero event loss, and zero event duplication. Timings are machine- and run-dependent; functional counts and thresholds are asserted by the suite.

This proves the in-process workload logic at 2x counts only. It does **not** prove 10,000 live concurrent clients, Blaxel sandbox concurrency, provider latency, network behavior, or reserved remote headroom. No capacity was reserved and no quote or cost was invented: `state` is `NOT_REQUESTED_MATERIAL_SPEND_GATE`, both live reservation flags are false, and cost is `null`.

## Loopback HTTP and Blaxel load preparation

`pnpm test:load` creates 20 internally consistent signed-possession rehearsal projections in the durable public repository, then starts the real public and core Fastify services on ephemeral loopback TCP ports. It first proves that every cursor lane is authoritative and has public segments. With bounded local worker pools, it then sends 20,000 spectator cursor requests across those 20 games and 2,000 distinct candidate proof-of-possession challenges. The recorded artifact at `local-network-load-results.json` contains the per-workload counts, failure rate, P95/maximum latency, and explicit limitations. The current exact-runtime run completed all 22,000 requests with zero failures and remained below the 750 ms P95 threshold.

The load run initially exposed redundant durable refresh work: every concurrent public request independently re-read each repository. The public API now coalesces overlapping refreshes so all waiting requests observe the same completed refresh, includes the previously omitted development repository, and starts a new refresh for the next non-overlapping request. A controlled 20-request concurrency test locks this behavior. With real durable game lanes, the post-fix focused run reduced the observed P95 from 546.22 ms to 19.71 ms on the same host; the generated artifact, not this machine-dependent comparison, is authoritative for each final run.

This is network behavior, but it is still local behavior: concurrency is deliberately bounded to 200 workers, candidate challenges do not grant admission, and the result is labeled `LOCAL_LOOPBACK_HTTP`. It requires no Docker daemon and does not claim Blaxel autoscaling, remote latency, 10,000 simultaneous clients, or reserved headroom.

`tests/load/public-api.k6.js` is the external staging profile. A pinned k6 2.1.0 `inspect` pass validates two explicit scenarios: 10,000 concurrent spectator VUs perform two cursor requests each across 20 game lanes, and 100 VUs perform 2,000 candidate challenges. k6 thresholds encode less than 1% errors, P95 below 750 ms, greater than 99% checks, and zero dropped iterations. Running that profile against provisioned Blaxel URLs remains approval-gated because it can consume material capacity.

## Automated arena browser proof

The Playwright 1.62.1 suite builds the Next.js arena as a production standalone server and launches a deterministic-rehearsal instance of the real public API constructor. Desktop Chromium and Pixel 7 Chromium both prove that `/arena` receives exactly one canonical rehearsal projection over HTTP, renders the audit heading, six-segment ledger, and all ten players, exposes no application mutation controls, produces no page errors, and has no horizontal overflow. The same suite can target staging by setting `ABL_BROWSER_BASE_URL` and `ABL_BROWSER_PUBLIC_API_URL` together; no Docker boundary is involved.

## Recovery and wind-down

The local recovery harness proves an XChaCha20-Poly1305 encrypted round trip, ciphertext-only handling, guardian envelope recovery, body deletion and clean-room rehydration, portable exit without claiming subjective continuity, a three-event/three-outbox exact rebuild, local checkpoint-manifest integrity with an explicit `UNVERIFIABLE` Base label, and 2-of-2 guardian signing recovery. Hardware-backed status remains false.

The overload allocator strictly preserves games in progress, rights, government, due process, exit, continuity, and minimum autonomy before admissions and spectators. The 30-day exercise funds 100 essential units/day from a 3,000-unit reserve, preserves 64 portable exits, grants the sponsor no authority, and sheds spectators before admissions.

Agent Drive restoration, Blaxel sandbox restoration, Neon point-in-time recovery, live Base checkpoint finality, and hardware-backed non-exportable recovery remain explicitly unexecuted gates.

## Verification environment and commands

```text
Timestamp: 2026-08-13 final uncached evidence rerun
Host:      Darwin 25.5.0 arm64
Node:      v24.18.0 (exact repository pin)
pnpm:      11.21.0

pnpm --filter @abl/assurance check -> pass
pnpm --filter @abl/assurance test  -> 9/9 tests pass
pnpm --filter @abl/assurance build -> pass
pnpm test:load                     -> 22,000/22,000 HTTP requests; 0 failures
pnpm test:browser                  -> 2/2 Chromium projects pass
```

The suite covers all seven static escape-vector labels and live-gate markers, public topology containment and manifest secret scanning, exact 2x workload counts and SLOs, fixture/constants consistency, storage/body/database/checkpoint/key recovery, overload ordering, and the 30-day reserve.

Artifact locks:

- Capacity harness: `sha256:e9515a182b68c2482693525d09df1820a4f465cf73fd6a24bc48eb20f1b88e52`
- Network analysis: `sha256:817f8d5573bf1831e23d435a500562f00357e928364636c6ae17b1a4ac72b1c2`
- Recovery harness: `sha256:870549865e3473a68b436d27b0dc94cc6e8bdd4bc56183c4db013e5a1988f876`
- Wind-down harness: `sha256:6e20917e33fa153d9127db5744eb0414e9d83ee06796519feda66ead19bdb9bc`
- Assurance suite: `sha256:f081e677845938ddee618fc934244073d5b87924e4656c08774236d0b4632825`
- Loopback network-load engine/runner/result: `sha256:e57ef69c5fadec88d8af007c9ad862fed5f2acaca5ae1a196800245bd7886359`, `sha256:042a3db3441f30b1817e81b06696492b0900defcf71ee4d09e815c4555bf8461`, `sha256:76487be1e52e287cbb0c651eb541b48611a9033d5a5acdf78a14f7c69fa2d691`
- k6 staging profile: `sha256:9bdc897b9df96fa74cf89b66252710db2d27aafd3e207f5dae262ad9f39314f8`
- Playwright configuration/browser suite: `sha256:a90f55db0de71c6e5207402e3ad4f93597b74100b83049645ae5ca713f12d449`, `sha256:d8b00dbb68937b1d851cb93c07d63e4a37696f0a1198182006c8027d065d41d6`
- Locked plan fixture: `sha256:74bf007e6ec248c13baf0ab76db67502ba6ecfb74a85a5c014ce9598c16b9d20`
- Lockfile: `sha256:3ed2cb2cfa98dc8bb476feed3dc6a72c1d336d18460b7bd3d8e7dc48fbe20a9e`

## Retained external gates

The unavailable live tests are not phase passes: sandbox escape attempts require a runnable image; storage isolation requires Agent Drive; public containment requires a deployed public workspace; remote load/SLO testing requires provisioned Blaxel capacity and could incur material spend; database PITR requires Neon credentials; Base verification requires a deployed checkpoint contract; and hardware recovery requires supported hardware. Those gates are carried into final acceptance rather than silently waived.
