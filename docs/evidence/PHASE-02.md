# Phase 2 evidence: four-workspace foundation

Recorded: 2026-08-13 in `America/Vancouver`.

## Implemented locally

- Exact four-workspace responsibility, prohibition, call-graph, and region topology.
- Separate capability-scoped transport identities whose HMAC signatures bind service id, capability, method, path, body hash, nonce, timestamp, expected version, and idempotency metadata. Replays, stale requests, changed bodies, changed routes, and ungranted capabilities fail closed.
- Serializable PostgreSQL event-store implementation with per-aggregate advisory locks, versions and hash chains, UUIDv7-compatible event keys, actor nonce replay prevention, request idempotency, atomic outbox writes, range-plus-hash partitions, and no global event sequence.
- Ciphertext-only broker with domain policy, separate XChaCha20-Poly1305 domain keys, immutable object-version chains, X25519 guardian envelopes, hashed Drive paths, immutable `0600` artifacts, and no plaintext key persistence.
- Restart-safe ciphertext metadata recovery scans durable policies, objects, guardian envelopes, and personal-object deletion tombstones; validates hashed paths, receipt commitments, and contiguous policy/object chains; fsyncs linked records; and restores broker authorization/version/deletion state. A repository failure rolls back the tentative in-memory version, while an uncertain post-link failure is recovered by restart.
- The private broker exposes a separate HMAC capability that answers only whether a supplied personal ciphertext commitment or deletion receipt is durable. Core cannot retrieve ciphertext through it. Personal deletion writes an immutable tombstone before removing local ciphertext versions, retries physical removal after an interrupted erase, prevents object-ID reuse, and explicitly records `providerResidualDeletionVerified: false`.
- Fixed body broker with named targets, method/path allowlists, redirect denial, response/body limits, service signatures, broker-only provider credentials, and encryption before private-workspace transport.
- Digest-pinned Node/Blaxel sandbox sources, exact Alpine package lock, immutable launcher and trust files, and environment allowlisting. The post-Gate-2 amendment places the credential-free player and fixed broker in separate Sandboxes. The body requests kernel iptables support at creation, limits agent UID 10101 to Blaxel's pinned filtered-proxy tuple, clears `NO_PROXY`, and permits only the fixed-broker host at the proxy; the broker separately allows only its declared core, storage, and model targets.
- Blaxel manifests for private Agents, a single-writer public projection Agent with a persistent regional volume, MCP Functions, body/arena Sandboxes, model endpoints, the public spectator Application, recovery Job, release labels, region placement, and explicit telemetry opt-outs.
- Executable discovery, career, basketball, and government MCP Function packages using stable Streamable HTTP protocol `2025-11-25`. Private forwarding adapters preserve the original agent-signed command and use fixed route maps; discovery has no credential; basketball is deterministic and credential-free.
- The declared core-to-public capability is implemented as strict canonical-event envelopes delivered over capability-scoped HMAC HTTP. The public service independently verifies the agent signature and payload, enforces the signed expected aggregate version, persists the source authorization beside the projection, and re-verifies it on restart.
- Spend-gated capacity/SLO plan with required overload priority.

## Verification results

Commands completed successfully after formatting:

```text
pnpm --filter @abl/database db:check  -> Everything's fine
pnpm check                            -> 28/28 tasks
pnpm test                             -> 140 assertions in 26 files; 28/28 tasks
pnpm build                            -> 18/18 tasks
bl deploy --dryrun --type sandbox     -> Sandbox/abl-body-sandbox-image; no mutation
```

The Blaxel dry run resolved the repository as a generation `mk3`, 4096 MB Sandbox image project and confirmed that generated build output and dependency directories are absent from the upload context. The test set covers topology and manifest policy, immutable image references, transport authentication, tampering/replay/staleness, canonical store idempotency/version/hash behavior, encryption and guardian recovery, ciphertext authorization/versioning/path safety, private-broker actor binding, fixed-broker route smuggling and credential isolation, and the static OS egress policy.

## Artifact locks

- pnpm lockfile: `sha256:f01fa3459eb27f36f4cd25d9fb0d322e26d85d66a2580010215fb744992e247f`
- foundation migration: `sha256:d759112b690fa2249ca007d1839e1aea33c52f8a613f3c1e08eddc124046ce19`
- sandbox Dockerfile: `sha256:497245355eeaff08b7259eadff7066a798daec37c2cf532740469dfe013e5321`
- Blaxel image project: `sha256:13169a49bc5e005fb62086038add8bab5f769f91b6c22fdeab25c0a8698c48ac`
- Blaxel upload exclusions: `sha256:83cbd15b71945d7cf86a0573caa08a3d43503294878b58254f21581bdb2a19e5`
- sandbox init: `sha256:4f2aeee195ef476a21381091bbd3a01a63724abd5d4309464201d3b1c754ae12`
- Alpine package lock: `sha256:1aa5c3df3967aaeb46d60016628bf2eed2704dadf2295b700146cd9eabce408a`
- Alpine 3.24 x86_64 main index used to verify package versions: `sha256:fa580c49571a006348b321733da67fab6dd9a4646cd09da0bb6a9d433eafb2e9`
- Ciphertext broker state machine: `sha256:ddc54d86de115dfec0dc13e4222fd801960f3139532f545c06ccbca690f124f5`
- Durable ciphertext repository: `sha256:d46126b350633b892218ce5ccf55f3738964ada359567c8d1d3557c9847b115c`
- Private broker service: `sha256:70c6b8bca25a4a7938c05abbe7d737c7e0c97dd7b84a946e467e9736d127c796`
- Storage suite: `sha256:fe1b24beb20e600ce76570fed949d2d0db0dce967cb851202158cb372a670296`
- Private broker suite: `sha256:c48bba2e846964759849d3150ddeca29d15dfd0ddf856b4931d6e346a28b01c4`
- Workspace topology: `sha256:a5ca1a4f11b9bee4da187c8731b113efb7a6b3180aafbec1b8367aa2aa12b331`
- Service identity policy: `sha256:f77b491a39cd6cdd3c388c380c2caca152026d20d3982c10ad499c659c79772b`

## External staging gates

These results are explicitly not represented as completed platform proofs:

1. The repository-root `blaxel.toml`, `.blaxelignore`, and `Dockerfile` are the deployable Blaxel custom-image project. A local Docker daemon is optional. The image has not been pushed because the required `abl-competition` workspace is unavailable, so it has no release image ID and has not undergone live kernel socket/DNS/TLS/metadata/subprocess tests.
2. The authenticated Blaxel account exposes only the unrelated `knicks` workspace. The required `abl-core`, `abl-private`, `abl-competition`, and `abl-public` targets are not present or confirmed for this project. Applying resources to `knicks` would violate the approved topology; creating resources in an unconfirmed account would be an unsafe external mutation.
3. Agent Drive returns `403` because the feature is not enabled. The local filesystem emulator validates encrypted layout behavior but is not a live Drive security proof.
4. No project Neon URL or local PostgreSQL server is available. Drizzle migration consistency and store logic pass; a real serializable migration, contention, partition, outbox, and point-in-time-recovery run remains required.
5. Quota reservation and `minScale` deployment can incur recurring spend. No reservation or paid deployment was requested.
6. The complete local suite now passes through the exact pinned Node `24.18.0` binary. The amended custom image must independently repeat the kernel/proxy proof and direct-socket, DNS, TLS, subprocess, local/private, metadata, and workload-token denial vectors in the target Blaxel Sandbox.

Safe local implementation proceeds while these gates remain open. Public genesis, production exposure, ownerless deployment, recovery-control removal, and material spend remain prohibited without the required approval.
