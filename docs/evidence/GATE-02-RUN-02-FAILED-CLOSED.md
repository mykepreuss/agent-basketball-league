# Gate 2 six-Sandbox run result

> Approval: `ABL-GATE2-2026-08-21-02`
> Recorded: `2026-08-21` in `America/Vancouver`
> Repository baseline: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Frozen source digest: `0x8d9ad200000a5cc95d9471dff49a0b95c944760263c390968cfc378e4a5f3f92`
> Outcome: `FAILED_CLOSED_BEFORE_AGENT_UPLOAD`
> Recognition: `NONE`

## Result

The authorized six-Sandbox Gate 2 run stopped at the player-body initialization gate. Blaxel reported `abl-stage-player-body-001` as `DEPLOYED` with the exact reviewed image, 4,096 MiB memory, `runtime.extraArgs.iptables=enabled`, one fixed-broker host in its allowlist, and no Drive or Volume mount. The authenticated Sandbox API nevertheless returned HTTP 404 for both the root-owned initialization marker and process API. The required `READY` state could not be proved, so no agent program was uploaded or executed.

The reviewed init starts `sandbox-api` only after proxy validation and resolution, IPv4 and IPv6 iptables installation, and short-lived capability-file installation. Blaxel exposed no body boot logs. The live evidence therefore does not identify which pre-API instruction failed; it identifies a diagnostic dead zone in which an initialization failure also makes the stage marker unreachable. A new reviewed architecture amendment is required before another run. The consumed approval does not authorize a retry or a modified body image.

## Passed before the stop

- A new temporary Neon PostgreSQL 17 project, `abl-stage-gate2` (`delicate-tree-46229964`), was created in `aws-us-west-2` with 0.25–2 CU and the Free-plan five-minute effective scale-to-zero policy.
- The foundation migration applied, PostgreSQL 17 and all 23 public tables were verified, serializable rollback passed, direct reconnect passed, and the pooled runtime connection passed.
- Six reviewed images were pushed with immutable provider tags. Their combined provider-reported size was approximately 3.16 GiB.
- Five `public:false` previews were created with one common expiry at the four-hour hard stop. Every preview returned `401` for a missing token, `401` for an invalid token, and `200` for the valid token.
- Core, public API, storage broker, fixed broker, and arena processes started. The arena rendered the private public API's pre-genesis state without a fixture marker.
- Agent Drive `abl-stage-durable-state` was created atomically with the exact checked two-rule ACL: ciphertext broker read-write at `/ciphertext`, and projection writer read-write at `/projections`.
- The storage broker was denied `/projections`, the public API was denied `/ciphertext`, and the body had no Drive mount.

These are bounded staging facts. They do not prove the possession vertical, restart recovery, public recognition, production isolation, or Genesis readiness.

## Safety result

At the stop, the temporary database contained:

| Table                 | Rows |
| --------------------- | ---: |
| `recognized_events`   |    0 |
| `canonical_outbox`    |    0 |
| `command_idempotency` |    0 |

There were zero model calls, public previews, Base transactions, recognition broadcasts, founding-agent decisions, recurring schedules, or Genesis actions. Recognition remained `NONE`, below the authorized `SIGNED_VALID` ceiling.

## Teardown and cost

The first external mutation was recorded at `2026-08-21T21:15:40Z`; the hard stop was `2026-08-22T01:15:40Z`. Teardown completed at `2026-08-21T21:47:59Z` in the required order:

1. player-body Sandbox;
2. fixed-broker token and preview;
3. all remaining preview tokens and previews;
4. fixed broker, core, arena, public API, and storage broker Sandboxes;
5. Agent Drive after redacted evidence hashing;
6. all six run-specific image tags and image records;
7. exact temporary Neon project after identifier verification.

Post-teardown Blaxel inventory reported zero Sandboxes, Drives, Agents, Functions, Jobs, Applications, Volumes, and Policies. No runnable ABL image tag remained; the five historical ABL image records reported zero bytes. Neon returned no active project matching `delicate-tree-46229964` or `abl-stage-gate2`.

The authenticated console credit was USD 22.35 at preflight and USD 22.28 after teardown, an observed USD 0.07 change against the USD 10 ceiling. Automatic top-up remained unavailable/off because no payment method was configured. This balance delta is an account-level observation, not an itemized cost attribution.

The secret-bearing directory `/private/tmp/abl-gate2-run02.6946K5` was irreversibly destroyed at `2026-08-21T21:48:44Z`. Redacted evidence remains locally at `/private/tmp/abl-gate2-evidence-20260821-run02`, with directory mode `0700`, file mode `0600`, and a verified `SHA256SUMS` manifest.

## Evidence checksums

| Artifact                                  | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `RUN_RESULT.md`                           | `f63a8c4aed8886d5c0242628657c3462ea48b377478211e3d32b1e955b0bb20a` |
| `authorization.json`                      | `ca46cd2066a8b33df61710441e435985a3d6b2f469799e92e0548ff8eb17dc12` |
| `provider-preflight.json`                 | `133923b6192283f4c2253fb15cf0a3ed9082b75f3159ffe7e80194cfabc15e35` |
| `source-freeze.json`                      | `8bef438ef5eb1ef59d7319dc954d8d2f3351107f426ee39ebf7afb5334ee6e6b` |
| `neon-project.json`                       | `878fde4a9357dd6aab1cafec142999b50a4a7ec4957f16017da5c40a208fb9b6` |
| `drive-denial-public-to-ciphertext.txt`   | `dd10d31092c21aa5eab5b7006dd047b0ef1b86d70d2344be9f5899dbdcfaf7c2` |
| `drive-denial-storage-to-projections.txt` | `dd10d31092c21aa5eab5b7006dd047b0ef1b86d70d2344be9f5899dbdcfaf7c2` |
| `failure-result.json`                     | `e2c723ac4c2ca69c82ed08186055f448ee281d70e48acfa2d5507d3466017da7` |
| `teardown-result.json`                    | `11d103127040d416094eaf4c78cdf8464e3bb23ca2214554f28d631ef24725f4` |

## Required next gate

The [local body-init diagnostic amendment](../launch/GATE_2_BODY_INIT_DIAGNOSTIC_AMENDMENT.md) completes the safely executable source correction: the image now starts a dedicated unprivileged `GET`/`HEAD`-only status service before protected work, retains it on a protected-stage failure, has no automatic agent `CMD`, and hands port 8080 to the pinned Sandbox API only after `READY`. Focused behavior, topology, assurance, adversarial, packaging, and non-mutating Blaxel dry-run checks pass locally. The exact Node `24.18.0` full pipeline also passes 328 assertions in 73 files and all 113 uncached type-check/test/build tasks.

The exact failing instruction from this historical run remains unknowable because the old image exposed neither the marker nor boot logs. The correction is therefore a new testable design, not retroactive proof. Before another live run:

1. record the fresh final worktree digest immediately before any future run and bind it to body-source digest `0xd035e3db3bc72e42e5753c4dd408643eb3a8a6e1f8a1ef939682450432215d2b`;
2. refresh the read-only provider/quota/balance/top-up/region/cost preflight;
3. issue a new resource, database, image-push, spend, expiry, evidence, and teardown authorization;
4. prove the sanitized failure state, authenticated API handoff, kernel policy, local proxy, CA, capability, agent-start ordering, and all direct/proxy-bypass denials live before uploading agent code.

This result supersedes the six-Sandbox amendment's awaiting-authorization status. It does not supersede the [first failed-closed Gate 2 result](./GATE-02-FAILED-CLOSED.md), which remains the record for approval `ABL-GATE2-2026-08-21-01`.
