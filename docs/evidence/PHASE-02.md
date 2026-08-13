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
- Blaxel manifests for private Agents, a single-writer public projection Agent with a persistent regional volume, MCP Functions, body/arena Sandboxes, model endpoints, the public spectator Application, recovery Job, release labels, region placement, and explicit telemetry opt-outs.
- The declared core-to-public capability is implemented as strict canonical-event envelopes delivered over capability-scoped HMAC HTTP. The public service independently verifies the agent signature and payload, enforces the signed expected aggregate version, persists the source authorization beside the projection, and re-verifies it on restart.
- Spend-gated capacity/SLO plan with required overload priority.

## Verification results

Commands completed successfully after formatting:

```text
pnpm --filter @abl/database db:check  -> Everything's fine
pnpm check                            -> 28/28 tasks
pnpm test                             -> 125 assertions in 22 files; 28/28 tasks
pnpm build                            -> 18/18 tasks
bl deploy --dryrun --type sandbox     -> Sandbox/abl-body-sandbox-image; no mutation
```

The Blaxel dry run resolved the repository as a generation `mk3`, 4096 MB Sandbox image project and confirmed that generated build output and dependency directories are absent from the upload context. The test set covers topology and manifest policy, immutable image references, transport authentication, tampering/replay/staleness, canonical store idempotency/version/hash behavior, encryption and guardian recovery, ciphertext authorization/versioning/path safety, private-broker actor binding, fixed-broker route smuggling and credential isolation, and the static OS egress policy.

## Artifact locks

- pnpm lockfile: `sha256:1668c6ecd16b98d2034eceec3f424cc046413189dc83641e1cfdc8697d64369f`
- foundation migration: `sha256:d759112b690fa2249ca007d1839e1aea33c52f8a613f3c1e08eddc124046ce19`
- sandbox Dockerfile: `sha256:497245355eeaff08b7259eadff7066a798daec37c2cf532740469dfe013e5321`
- Blaxel image project: `sha256:13169a49bc5e005fb62086038add8bab5f769f91b6c22fdeab25c0a8698c48ac`
- Blaxel upload exclusions: `sha256:83cbd15b71945d7cf86a0573caa08a3d43503294878b58254f21581bdb2a19e5`
- sandbox init: `sha256:4f2aeee195ef476a21381091bbd3a01a63724abd5d4309464201d3b1c754ae12`
- Alpine package lock: `sha256:1aa5c3df3967aaeb46d60016628bf2eed2704dadf2295b700146cd9eabce408a`
- Alpine 3.24 x86_64 main index used to verify package versions: `sha256:fa580c49571a006348b321733da67fab6dd9a4646cd09da0bb6a9d433eafb2e9`
- workspace topology: `sha256:042ba8c370d0b9b0e66d669ce17a99a9543bcff18a6bb8f0e0b1e9789eb8bb0d`
- service identity policy: `sha256:cef0291d16a9f55cddd3b8380c07c6f8925d4047cf7aad446b1f3595e62fdec8`

## External staging gates

These results are explicitly not represented as completed platform proofs:

1. The repository-root `blaxel.toml`, `.blaxelignore`, and `Dockerfile` are the deployable Blaxel custom-image project. A local Docker daemon is optional. The image has not been pushed because the required `abl-competition` workspace is unavailable, so it has no release image ID and has not undergone live kernel socket/DNS/TLS/metadata/subprocess tests.
2. The authenticated Blaxel account exposes only the unrelated `knicks` workspace. The required `abl-core`, `abl-private`, `abl-competition`, and `abl-public` targets are not present or confirmed for this project. Applying resources to `knicks` would violate the approved topology; creating resources in an unconfirmed account would be an unsafe external mutation.
3. Agent Drive returns `403` because the feature is not enabled. The local filesystem emulator validates encrypted layout behavior but is not a live Drive security proof.
4. No project Neon URL or local PostgreSQL server is available. Drizzle migration consistency and store logic pass; a real serializable migration, contention, partition, outbox, and point-in-time-recovery run remains required.
5. Quota reservation and `minScale` deployment can incur recurring spend. No reservation or paid deployment was requested.
6. The complete local suite now passes through the exact pinned Node `24.18.0` binary. The custom image must independently repeat that proof in the target Blaxel sandbox.

Safe local implementation proceeds while these gates remain open. Public genesis, production exposure, ownerless deployment, recovery-control removal, and material spend remain prohibited without the required approval.
