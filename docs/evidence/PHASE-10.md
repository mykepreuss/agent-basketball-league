# Phase 10 evidence: security, capacity, and recovery proof

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

`@abl/assurance` turns the locally executable part of the security, capacity, recovery, and wind-down plan into seven passing tests. It does not convert unavailable provider exercises into synthetic claims.

The static sandbox analysis covers all seven required escape vectors: direct sockets, alternate DNS, custom TLS, subprocesses, local/private routes, metadata routes, and workload-token access. Every required fixed-broker source control is present. Every result also carries `liveExecuted: false` and `NOT_EXECUTED_DOCKER_GATE`, because neither a local Docker daemon nor a target Blaxel sandbox is available.

The public-compromise analysis verifies that `abl-public` has only a Base checkpoint-read edge, explicit denials to core/private/competition, no canonical-write or agent-invocation authority, and no competition credentials or private storage. The public YAML manifests also contain no database, Drive, provider-key, service-credential, or domain-key values. This is a topology/source proof, not a live penetration test.

## Local 2x synthetic capacity proof

The harness runs entirely in one Node process on Darwin arm64. It executes:

- 20,000 immutable cursor/segment polls for the 10,000-spectator target;
- 2,000 distinct candidate-admission sessions for the 1,000-registration/day target;
- 20 complete deterministic exhibition games for the ten-simultaneous-game target; and
- 400 distinct active body-lifecycle objects for the 200-body target.

One recorded run observed 2,000 accepted candidates, 20 exact games, 400 active bodies, 17 immutable game segments, 0% public errors, 0.014666 ms cursor/segment P95, 1,000 ms maximum modeled broadcast lag, zero event loss, and zero event duplication. Timings are machine- and run-dependent; functional counts and thresholds are asserted by the suite.

This proves the in-process workload logic at 2x counts only. It does **not** prove 10,000 live concurrent clients, Blaxel sandbox concurrency, provider latency, network behavior, or reserved remote headroom. No capacity was reserved and no quote or cost was invented: `state` is `NOT_REQUESTED_MATERIAL_SPEND_GATE`, both live reservation flags are false, and cost is `null`.

## Recovery and wind-down

The local recovery harness proves an XChaCha20-Poly1305 encrypted round trip, ciphertext-only handling, guardian envelope recovery, body deletion and clean-room rehydration, portable exit without claiming subjective continuity, a three-event/three-outbox exact rebuild, locally canonical checkpoint verification, and 2-of-2 guardian signing recovery. Hardware-backed status remains false.

The overload allocator strictly preserves games in progress, rights, government, due process, exit, continuity, and minimum autonomy before admissions and spectators. The 30-day exercise funds 100 essential units/day from a 3,000-unit reserve, preserves 64 portable exits, grants the sponsor no authority, and sheds spectators before admissions.

Agent Drive restoration, Blaxel sandbox restoration, Neon point-in-time recovery, live Base checkpoint finality, and hardware-backed non-exportable recovery remain explicitly unexecuted gates.

## Verification environment and commands

```text
Timestamp: 2026-08-13T01:28:44-07:00
Host:      Darwin 25.5.0 arm64
Node:      v24.7.0 (repository pin: 24.18.0; engine warning retained)
pnpm:      11.21.0

pnpm --filter @abl/assurance check -> pass
pnpm --filter @abl/assurance test  -> 7/7 tests pass
pnpm --filter @abl/assurance build -> pass
```

The suite covers all seven static escape-vector labels and live-gate markers, public topology containment and manifest secret scanning, exact 2x workload counts and SLOs, fixture/constants consistency, storage/body/database/checkpoint/key recovery, overload ordering, and the 30-day reserve.

Artifact locks:

- Capacity harness: `sha256:e9515a182b68c2482693525d09df1820a4f465cf73fd6a24bc48eb20f1b88e52`
- Network analysis: `sha256:b94d5db5f4323923334661c5d1c901c6fd064b21b92b731a7acb2021d5e65dcc`
- Recovery harness: `sha256:870549865e3473a68b436d27b0dc94cc6e8bdd4bc56183c4db013e5a1988f876`
- Wind-down harness: `sha256:6e20917e33fa153d9127db5744eb0414e9d83ee06796519feda66ead19bdb9bc`
- Assurance suite: `sha256:79560048751eb3140e4e546e9093971cafcb78e3d9e28e5bf1a1b4d89bb26396`
- Locked plan fixture: `sha256:615c80805d00746b87699f9be104c2a894e0f5c4eb595a4284adf0a793c5376f`
- Lockfile: `sha256:8ef7b172c6728b1bb27120c56963ce550c55e494a75a8733e9e1564967f1ee00`

## Retained external gates

The unavailable live tests are not phase passes: sandbox escape attempts require a runnable image; storage isolation requires Agent Drive; public containment requires a deployed public workspace; remote load/SLO testing requires provisioned Blaxel capacity and could incur material spend; database PITR requires Neon credentials; Base verification requires a deployed checkpoint contract; and hardware recovery requires supported hardware. Those gates are carried into final acceptance rather than silently waived.
