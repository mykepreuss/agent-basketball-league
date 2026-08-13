# Phase 2 evidence: four-workspace foundation

Recorded: 2026-08-13 in `America/Vancouver`.

## Implemented locally

- Exact four-workspace responsibility, prohibition, call-graph, and region topology.
- Separate capability-scoped transport identities whose HMAC signatures bind service id, capability, method, path, body hash, nonce, timestamp, expected version, and idempotency metadata. Replays, stale requests, changed bodies, changed routes, and ungranted capabilities fail closed.
- Serializable PostgreSQL event-store implementation with per-aggregate advisory locks, versions and hash chains, UUIDv7-compatible event keys, actor nonce replay prevention, request idempotency, atomic outbox writes, range-plus-hash partitions, and no global event sequence.
- Ciphertext-only broker with domain policy, separate XChaCha20-Poly1305 domain keys, immutable object-version chains, X25519 guardian envelopes, hashed Drive paths, immutable `0600` artifacts, and no plaintext key persistence.
- Restart-safe ciphertext metadata recovery scans durable policies, objects, and guardian envelopes; validates hashed paths and contiguous policy/object chains; fsyncs linked records; and restores broker authorization/version state. A repository failure rolls back the tentative in-memory version, while an uncertain post-link failure is recovered by restart.
- Fixed body broker with named targets, method/path allowlists, redirect denial, response/body limits, service signatures, broker-only provider credentials, and encryption before private-workspace transport.
- Digest-pinned Node/Blaxel sandbox sources, exact Alpine package lock, separate broker/agent uids, immutable launcher and trust files, environment allowlisting, and nftables owner rules. Agent uid 10101 is allowed only to the fixed loopback broker; broker uid 10100 is allowed only to boot-resolved HTTPS targets.
- Blaxel manifests for private Agents, MCP Functions, body/arena Sandboxes, model endpoints, public Applications, recovery Job, release labels, region placement, and explicit telemetry opt-outs.
- Spend-gated capacity/SLO plan with required overload priority.

## Verification results

Commands completed successfully after formatting:

```text
pnpm --filter @abl/database db:check  -> Everything's fine
pnpm check                            -> 9/9 tasks
pnpm test                             -> 34/34 tests
pnpm build                            -> 7/7 packages
```

The test set covers topology and manifest policy, immutable image references, transport authentication, tampering/replay/staleness, canonical store idempotency/version/hash behavior, encryption and guardian recovery, ciphertext authorization/versioning/path safety, private-broker actor binding, fixed-broker route smuggling and credential isolation, and the static OS egress policy.

## Artifact locks

- pnpm lockfile: `sha256:89d68bf5f9f8c091a86b98e725ab918a70d4743a8c4188b6ca90adb8db3bc255`
- foundation migration: `sha256:d759112b690fa2249ca007d1839e1aea33c52f8a613f3c1e08eddc124046ce19`
- sandbox Dockerfile: `sha256:497245355eeaff08b7259eadff7066a798daec37c2cf532740469dfe013e5321`
- sandbox init: `sha256:4f2aeee195ef476a21381091bbd3a01a63724abd5d4309464201d3b1c754ae12`
- Alpine package lock: `sha256:1aa5c3df3967aaeb46d60016628bf2eed2704dadf2295b700146cd9eabce408a`
- Alpine 3.24 x86_64 main index used to verify package versions: `sha256:fa580c49571a006348b321733da67fab6dd9a4646cd09da0bb6a9d433eafb2e9`
- workspace topology: `sha256:042ba8c370d0b9b0e66d669ce17a99a9543bcff18a6bb8f0e0b1e9789eb8bb0d`
- service identity policy: `sha256:cef0291d16a9f55cddd3b8380c07c6f8925d4047cf7aad446b1f3595e62fdec8`

## External staging gates

These results are explicitly not represented as completed platform proofs:

1. Docker client `29.2.0` is installed, but its daemon socket is absent. The custom image therefore has not been built, assigned an ABL image digest, or subjected to live kernel socket/DNS/TLS/metadata/subprocess tests.
2. The authenticated Blaxel account exposes only the unrelated `knicks` workspace. The required `abl-core`, `abl-private`, `abl-competition`, and `abl-public` targets are not present or confirmed for this project. Applying resources to `knicks` would violate the approved topology; creating resources in an unconfirmed account would be an unsafe external mutation.
3. Agent Drive returns `403` because the feature is not enabled. The local filesystem emulator validates encrypted layout behavior but is not a live Drive security proof.
4. No project Neon URL or local PostgreSQL server is available. Drizzle migration consistency and store logic pass; a real serializable migration, contention, partition, outbox, and point-in-time-recovery run remains required.
5. Quota reservation and `minScale` deployment can incur recurring spend. No reservation or paid deployment was requested.
6. The complete local suite now passes through the exact pinned Node `24.18.0` binary. The custom image must independently repeat that proof after a Docker daemon or target sandbox becomes available.

Safe local implementation proceeds while these gates remain open. Public genesis, production exposure, ownerless deployment, recovery-control removal, and material spend remain prohibited without the required approval.
