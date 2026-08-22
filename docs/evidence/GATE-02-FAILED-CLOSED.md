# Gate 2 private staging result

> Status: `FAILED_CLOSED_HISTORICAL_FIRST_RUN`
> Executed: `2026-08-21`
> Approval: `ABL-GATE2-2026-08-21-01`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Highest recognition reached: `NONE`

## Outcome

The first bounded Gate 2 run stopped at the live player-body isolation proof. Blaxel deployed the reviewed body image, but its root initialization could not install the required nftables UID egress policy. The root-owned diagnostic marker was:

```text
FAILED:INSTALLING_UID_EGRESS_POLICY:3
```

The agent program was never uploaded or executed. The canonical database contained zero recognized events, zero outbox rows, and zero command-idempotency rows. No model call, public preview, recognition broadcast, or Base transaction occurred. The result is not a partial Gate 2 pass.

## Proof completed before the stop

- Neon PostgreSQL 17 in `aws-us-west-2` accepted the corrected migration, exposing 23 canonical tables and passing transaction, rollback, reconnect, and pool checks.
- Five private Blaxel Sandboxes and four `public:false` previews were created with the approved memory and four-hour expiry. Every preview denied unauthenticated access with `401` and accepted its short-lived token with `200`.
- One Agent Drive was created atomically with the two exact workload-label/path rules. Storage could mount only `/ciphertext`; public API could mount only `/projections`; both cross-path mount attempts failed.
- Core, public API, storage broker, and arena passed in-Sandbox health checks. The arena rendered through the token-protected public API.
- The body Sandbox had no Drive mount and no agent process. Its Sandbox API started with all broker secret values removed from its environment, enabling a non-secret initialization-stage readback without exposing key material.
- The authenticated Blaxel balance moved from USD 22.76 to USD 22.52, an observed maximum run cost of USD 0.24 under the USD 10 ceiling. Automatic top-up remained disabled.

These facts are useful provider evidence, but they do not satisfy the missing player-body isolation, vertical-slice, restart, replay, or signed-checkpoint proofs.

## Defects found and corrected locally

The live run exposed several issues that local tests did not previously cover:

1. A partitioned PostgreSQL primary key omitted the partition key. The migration, schema contract, and database test now require the valid composite key.
2. The pinned Blaxel Sandbox index digest was malformed by one hex character. The verified registry index and linux/amd64 manifest are now recorded.
3. Blaxel image assembly did not preserve pnpm's linked workspace dependency tree. Generated service and body artifacts now use hoisted portable deployments and reject nonportable runtime links.
4. The Next.js standalone arena subtree omitted a transitive SWC helper. The arena context now combines the standalone output with its production deployment and directly imports the helper during validation.
5. The Blaxel process API supplied `PORT=80` despite the Sandbox manifest value. Service processes now start with explicit `HOST=0.0.0.0 PORT=3000` values.
6. The body origin validator rejected the spaces it introduced while joining three otherwise valid origins. Each origin is now validated independently.
7. The body image source digest previously covered only the Dockerfile. It now commits to every effective body build input, including the init and immutable launcher.
8. A root-owned, read-only, non-secret stage marker was added. The later six-Sandbox run showed that the Sandbox API still starts only after the protected initialization sequence, so an earlier failure also makes the marker unreachable. The correction was incomplete and is now tracked by the [second failed-closed result](./GATE-02-RUN-02-FAILED-CLOSED.md).

## Stop and teardown

The run followed the packet's fail-closed procedure. The player body was deleted first, followed by all four previews, the four service Sandboxes, the Agent Drive, and every pushed image tag. Blaxel then reported zero ABL Sandboxes and zero ABL Drives. Five provider image records remained visible with zero tags and zero bytes after repeated deletion; they have no runnable image or recurring image-storage size.

The accountable operator explicitly authorized permanent deletion of the temporary Neon project `abl-stage-gate2` (`divine-pine-07002473`). The authenticated Neon console confirmed successful deletion on `2026-08-21`, and the project is absent from the organization project list. The secret-bearing local work directory was then destroyed and verified absent.

## Required amendment before another run

Do not bypass the failed nftables step or describe Blaxel's domain allowlist plus credential scoping as equivalent UID-level socket isolation. The recommended amendment is to split the player program and fixed broker into separate Sandboxes:

- the player-body Sandbox receives no signing key, model credential, core/storage token, database URL, or Drive authority and can reach only the fixed-broker private endpoint;
- the fixed-broker Sandbox holds the narrowly scoped keys and service tokens, can reach only core, private storage, and the configured model endpoint, and continues enforcing DID, route, method, event-class, nonce, deadline, size, and response policies;
- the body receives at most a short-lived capability for its own broker endpoint;
- the body manifest requests `runtime.extraArgs.iptables=enabled`; root limits the player UID to Blaxel's filtered-proxy tuple, the launcher uses Node's environment-proxy mode with `NO_PROXY` cleared, and the proxy permits only the fixed-broker host;
- the next packet budgets six concurrent Sandboxes and five private previews and reruns every denial, restart, replay, Drive, database, projection, arena, and checkpoint test.

This changed an approved resource name, network edge, secret authority, and cost estimate. The owner selected the six-Sandbox architecture, then authorized it under `ABL-GATE2-2026-08-21-02`. That run also failed closed before agent upload and completed teardown. Both approvals are consumed; see the [second result](./GATE-02-RUN-02-FAILED-CLOSED.md).

## External evidence

The redacted run bundle is stored outside the repository at `/private/tmp/abl-gate2-evidence-20260821` with mode-0600 artifacts and a SHA-256 manifest. It now includes a nonsecret Neon deletion receipt. The secret-bearing work directory is not evidence and has been destroyed.
