# Gate 2 corrected-body run result

> Approval: `ABL-GATE2-2026-08-21-03`
> Recorded: `2026-08-21` in `America/Vancouver`
> Repository baseline: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Frozen source digest: `0x7edcfca19e07ef30620097279b874f2a5a5c0739b89f71a80dacf95b229ad0a2`
> Corrected body-image source digest: `0xd035e3db3bc72e42e5753c4dd408643eb3a8a6e1f8a1ef939682450432215d2b`
> Authorized launch-ledger digest: `0xc8efe9528cefeecc7288d20ce14054783fa95be005e0f9e8fb7a2b6b0789fa2e`
> Outcome: `FAILED_CLOSED_BEFORE_PLAYER_UPLOAD`
> Recognition: `NONE`

## Result

The third bounded Gate 2 run proved that the corrected player-body image can expose a sanitized initialization failure, recover through its one authorized same-name recreation, install the UID egress rules, publish a root-owned `READY` marker, and hand port 8080 to the pinned Sandbox API. The live body then failed the credential-isolation and fixed-broker-handoff gates before player-program upload:

1. a process forced to uid/gid `10101` could read `/var/run/secrets/blaxel.ai/identity/token`; and
2. the allowed fixed-broker request traversed the credential-free loopback proxy but received HTTP `401` from the token-protected private preview while using the installed preview token.

The first result contradicts the current claim that an autonomous body cannot read a Blaxel workload or control-plane credential. Kernel egress and the one-host provider allowlist limited where that credential could be sent during this run, but network containment is not evidence that the credential is absent. The second result means the body-to-broker path was not operational. Either failure is sufficient to stop Gate 2.

No player program was uploaded. No staging command reached core, and the possession, projection, restart, replay, and checkpoint steps were not attempted. Approval `ABL-GATE2-2026-08-21-03` is consumed and cannot authorize a retry or a modified architecture.

## Passed before the stop

- The execution-time source freeze matched all three authorized digests. A second source calculation immediately before documentation work still contained 472 applicable files and reproduced the full digest exactly.
- The Blaxel preflight verified the target workspace, `us-was-1`, Tier 6 quota, USD 22.17 credit, automatic top-up off, and a conservative USD 1.7388 four-hour active-compute estimate.
- A new temporary Neon PostgreSQL 17 project, `abl-stage-gate2` (`ancient-bonus-94780368`), was created in `aws-us-west-2`. Migration, all 23 public tables, serializable rollback, direct reconnect, pooled runtime access, and the initial empty-state check passed.
- Six reviewed images were pushed with immutable provider tags.
- The five fixed Sandboxes and five `public:false` previews started. Each preview returned `401` without a token, `401` for an invalid token, and `200` for its operator-supplied valid token. Core, fixed broker, storage broker, public API, and arena health passed; the arena rendered the private public API's pre-genesis state without the fixture marker.
- Agent Drive `abl-stage-durable-state` was created with exactly two read-write rules: `/ciphertext` for `abl-drive-role=ciphertext-broker`, and `/projections` for `abl-drive-role=projection-writer`. The intended mounts succeeded and both cross-path mount attempts were denied.
- The induced body boot exposed only `FAILED:INSTALLING_SHORT_LIVED_CAPABILITY:78`. `POST /abl-init-status` returned `405`; process, filesystem, terminal, MCP, upgrade, mount, and arbitrary routes returned `404`; no secret was echoed.
- The one authorized same-name body recreation reached `READY`. The marker was root-owned, mode `0444`, and returned through the authenticated filesystem API. The pinned Sandbox API ran diagnostic commands as uid/gid `10101` on `linux/amd64`, and the body had no Drive mount.
- Both short-lived capability files were owned by uid `10101`, mode `0400`, canonically decoded, and within their reviewed size bounds. The CA file was root-owned and not group- or world-writable. The credential-free loopback proxy listener was reachable.
- Direct IPv4, IPv6, DNS, metadata, private-network, alternate-loopback-port, fixed-broker proxy-bypass, database, and control-plane socket attempts were denied for uid `10101`.

These facts are bounded provider evidence. They do not close Gate 2 because the body could read a platform identity credential and could not authenticate to the fixed broker.

## Safety result

The initial database probe after migration and before service start reported zero rows in `recognized_events`, `canonical_outbox`, and `command_idempotency`. The final helper intended to repeat those counts failed locally during module resolution before making a database connection. That limitation is recorded rather than represented as a final query pass.

No player upload or command submission occurred after the initial empty-state probe. There were zero model calls, public previews, Base transactions, recognition broadcasts, founding-agent decisions, recurring schedules, or Genesis actions. Recognition remained `NONE`, below the authorized `SIGNED_VALID` ceiling.

## Teardown and cost

The first mutation was recorded at `2026-08-21T23:06:00Z`; the four-hour hard stop was `2026-08-22T03:06:00Z`. The failure was observed at approximately `2026-08-21T23:25:00Z`, and teardown inventory was verified at `2026-08-21T23:28:52Z`:

1. the normal player-body Sandbox was deleted;
2. all five preview tokens and five private previews were deleted;
3. fixed broker, core, arena, public API, and storage broker Sandboxes were deleted;
4. the Agent Drive was deleted after redacted evidence export;
5. all six run-specific image tags were deleted;
6. the exact temporary Neon project was permanently deleted and verified absent; and
7. the secret-bearing work directory was destroyed.

Final Blaxel inventory reported zero Sandboxes, Drives, Agents, Functions, Jobs, Applications, Volumes, and Policies. Provider image records remain as metadata with zero tags and zero versions. Neon listed only the unrelated `Hummingbird` project (`snowy-darkness-52052673`), unchanged on PostgreSQL 17 in `aws-us-east-1`.

At the published active-compute price, allocating all 10.5 GiB for the entire 22-minute-52-second mutation window would be approximately USD 0.17. That is a conservative mathematical bound for active Sandbox compute, not an itemized bill or account-balance observation. All run resources were removed far below the four-hour and USD 10 hard stops, and automatic top-up remained off.

## Redacted evidence

The redacted evidence directory remains at `/private/tmp/abl-gate2-evidence-20260821-run03`, with directory mode `0700`, file mode `0600`, and no detected match for the 24 candidate secrets checked before secret-workspace destruction. Its `SHA256SUMS` manifest has digest:

`5499b95eb44140d638571a23fed9f3c77183a19e6f2879e819fafba8f8b4a40b`

Key artifacts:

| Artifact                       | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `authorization.json`           | `f014e35f2ee0c298ade759168a965721b75000a7d401bc3f3ef8bc07dd77e24e` |
| `provider-preflight.json`      | `1685161d2b2356e42fc0e8765ca4924208752221b033d1cecb74b35117361dd0` |
| `source-freeze.json`           | `6958641dc919af3ba87bf718ac61ded9135bf283e372ebf7df73194d500160e1` |
| `source-freeze-after-run.json` | `bf4f697f5db5107a3697427e6c88a1755b77fdce92cd5fb5fd892fee27869aae` |
| `pre-upload-handoff.json`      | `3704b0b0da8c59269472efaa8430c47590f0e234205948eae4996fe47ec44841` |
| `body-boundary-proof.json`     | `c86e08c756ab15c9facb6c351d1f6d92d91014d5591dc8c056461201a56a9cb1` |
| `run-result.json`              | `f9cdb897062cd9452f8a708bb5c8ed51b39c7269753460f1068678149a3382bf` |
| `teardown-verification.json`   | `6b43c602255e5e5bce2198afeaf6218dc6ecc89754a27c0418a49c3d5398dc29` |

## Required next gate

Do not rerun the current image or relax the pre-upload condition. Before a fourth live attempt:

1. determine, using a provider-supported mechanism, how an arbitrary player process is prevented from reading the mounted Blaxel workload-identity token; if the token cannot be made unreadable, revise the constitutional body boundary and threat model explicitly rather than treating egress filtering as credential absence;
2. isolate why a valid private-preview token passed from the operator but returned `401` when sent by the body through the credential proxy, and prove the corrected transport with a non-player diagnostic fixture;
3. update the image, launcher, topology assertions, threat model, and local adversarial tests for both findings;
4. re-run the exact Node `24.18.0` local pipeline and code review;
5. produce a new source freeze and a new amendment with explicit cost, resource, evidence, and teardown authority; and
6. obtain a new approval. No existing Gate 2 approval may be reused.

This result preserves the [first](./GATE-02-FAILED-CLOSED.md) and [second](./GATE-02-RUN-02-FAILED-CLOSED.md) failed-closed records. It supersedes only the claim that the diagnostic correction was live-unproven: diagnostic observability and normal API handoff are now live-proven, while credential isolation and private-preview handoff are newly open incidents.
