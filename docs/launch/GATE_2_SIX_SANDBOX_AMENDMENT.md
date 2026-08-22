# Gate 2 six-Sandbox architecture amendment

> Status: `EXECUTED_FAILED_CLOSED_APPROVAL_CONSUMED`
> Prepared: `2026-08-21`
> Architecture selected by: Michael Preuss
> Accountable operator: Michael Preuss
> Execution and evidence assistant: Codex (not an independent witness or constitutional authority)
> Repository baseline: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Target workspace: `agent-basketball-league`
> Target region: `us-was-1`
> Previous consumed approval: `ABL-GATE2-2026-08-21-01`
> Consumed approval identifier: `ABL-GATE2-2026-08-21-02`
> Later consumed execution approval: `ABL-GATE2-2026-08-21-03`

> Execution result recorded `2026-08-21`: approval `ABL-GATE2-2026-08-21-02` was granted and consumed. The six-Sandbox run stopped before agent upload because the body Sandbox did not expose a working Sandbox API or readable `READY` marker after deployment. The temporary database remained empty, recognition remained `NONE`, all Blaxel and Neon resources were torn down, and the secret directory was destroyed. See [Gate 2 six-Sandbox run result](../evidence/GATE-02-RUN-02-FAILED-CLOSED.md). This document is now historical authority and cannot authorize a retry.

> A later exact approval, `ABL-GATE2-2026-08-21-03`, retried the architecture with the diagnostic correction and is also consumed. It live-proved diagnostics and normal Sandbox API handoff, then failed closed before player upload because the non-root body could read the Blaxel workload-identity token and its allowed fixed-broker private-preview request returned `401`. All resources were torn down. See [Gate 2 corrected-body run result](../evidence/GATE-02-RUN-03-FAILED-CLOSED.md).

This amendment replaced the failed same-Sandbox player-body/broker boundary with separate player-body and fixed-broker Sandboxes. The body also requested Blaxel kernel iptables support at creation so UID-level rules could force all agent egress through the broker-only platform proxy. Its exact execution authority was granted and consumed. It is no longer execution authority: no image push, resource creation, replacement Neon project, secret creation, spend, public exposure, model call, or recognition broadcast may occur without a new reviewed amendment and explicit authorization.

## Why this amendment is required

The first bounded Gate 2 run failed closed when Blaxel rejected the nftables UID owner policy required to isolate an embedded broker from the player process. The player program never ran. All five Sandboxes, four private previews, the Agent Drive, and image tags were removed. The temporary Neon project `abl-stage-gate2` (`divine-pine-07002473`) was permanently deleted on `2026-08-21`, and the secret-bearing local work directory was destroyed.

The corrected boundary uses two separate microVMs plus kernel and proxy enforcement:

```text
uncredentialed player body
  -> fixed-broker private preview only

fixed broker
  -> core private preview
  -> private-storage private preview
  -> configured model endpoint (configured but zero calls authorized)

core
  -> temporary managed PostgreSQL
  -> public-API private preview
  -> private-storage private preview

arena
  -> public-API private preview
```

The body manifest sets `runtime.extraArgs.iptables=enabled`. Before privilege drop, root resolves and pins Blaxel's filtered-proxy endpoint, permits UID 10101 to reach only that IPv4 tuple, and rejects all other IPv4 and IPv6 output for the agent uid. The platform proxy then permits only the fixed-broker host. Blaxel documents domain filtering as proxy-environment based, so neither the domain allowlist nor the kernel rule is accepted alone. Live direct-socket and proxy-bypass tests remain mandatory.

The player body has no direct route or credential for core, storage, model, PostgreSQL, Agent Drive, or the Blaxel control plane. The fixed broker has no database URL, Drive authority, projection authority, recognition-broadcast authority, or control-plane credential.

## Exact resource boundary

| Kind            | Exact name                         |       Memory / scope | Visibility and lifecycle                                                                     |
| --------------- | ---------------------------------- | -------------------: | -------------------------------------------------------------------------------------------- |
| Sandbox         | `abl-stage-core-api`               |            2,048 MiB | private preview; delete after 4h idle; 24h terminated retention                              |
| Sandbox         | `abl-stage-arena`                  |            1,024 MiB | private preview; delete after 4h idle; 24h terminated retention                              |
| Sandbox         | `abl-stage-player-body-001`        |            4,096 MiB | no preview; kernel iptables plus broker-only filtered-proxy egress; 4h idle deletion         |
| Sandbox         | `abl-stage-fixed-broker`           |            1,024 MiB | private preview; three-host egress allowlist; delete after 4h idle; 24h terminated retention |
| Sandbox         | `abl-stage-storage-broker`         |            1,024 MiB | private preview; Drive `/ciphertext`; delete after 4h idle; 24h terminated retention         |
| Sandbox         | `abl-stage-public-api`             |            1,536 MiB | private preview; Drive `/projections`; delete after 4h idle; 24h terminated retention        |
| Agent Drive     | `abl-stage-durable-state`          |     provider-managed | exactly two path-scoped read-write rules; delete after evidence export                       |
| Private preview | `abl-stage-core-api-private`       | port 3000; token ≤4h | `public:false`                                                                               |
| Private preview | `abl-stage-fixed-broker-private`   | port 3000; token ≤4h | `public:false`                                                                               |
| Private preview | `abl-stage-storage-broker-private` | port 3000; token ≤4h | `public:false`                                                                               |
| Private preview | `abl-stage-public-api-private`     | port 3000; token ≤4h | `public:false`                                                                               |
| Private preview | `abl-stage-arena-private`          | port 3000; token ≤4h | `public:false`                                                                               |

Aggregate Sandbox memory is 10,752 MiB (10.5 GiB). No Agent Runtime workload, Volume, Application, Function, Job, Policy, custom domain, public preview, public trigger, recurring schedule, new model route, or production workspace is requested.

One new empty temporary managed PostgreSQL project is a prerequisite. The recommended repeatable option remains Neon PostgreSQL 17 in `aws-us-west-2`, 0.25–2 CU, five-minute scale-to-zero, pooled TLS URL for core, and direct TLS URL only for migration and probes. The deleted project must not be restored or reused. Creating any replacement project requires the new execution authorization and an exact creation receipt; this is not a production-provider selection.

The checked-in sources are:

- [resource plan](../../infra/blaxel/staging/resource-plan.json)
- [service identities and network edges](../../infra/blaxel/staging/service-identities.json)
- [Drive permissions, mounts, and private previews](../../infra/blaxel/staging/drive-access.json)
- [body Sandbox](../../infra/blaxel/staging/body-sandbox.yaml)
- [fixed-broker Sandbox](../../infra/blaxel/staging/fixed-broker.yaml)
- [core Sandbox](../../infra/blaxel/staging/core-api.yaml)
- [storage-broker Sandbox](../../infra/blaxel/staging/storage-broker.yaml)
- [public-API Sandbox](../../infra/blaxel/staging/public-api.yaml)
- [arena Sandbox](../../infra/blaxel/staging/arena.yaml)

## Credential and capability boundary

The player-body Sandbox receives only:

- its public DID and signer address;
- the fixed-broker HTTPS origin;
- a fixed-broker private-preview token expiring within four hours;
- a random body capability expiring within four hours and scoped to canonical signing, the named core proxy route, the named model proxy route, and encrypted storage put.

The player body receives no long-lived credential. The preview token and capability are supplied as Blaxel secret fields, decoded into mode-0400 files under `/run/abl-body-capability`, removed from the process environment, and exposed only to the `abl-agent` process.

The fixed-broker Sandbox receives Blaxel secret fields for its body capability, body-to-service HMAC, model credential, personal-domain encryption key, player signing key, core preview token, and storage preview token. Startup accepts exactly one file or canonical-base64 source for each secret, removes base64 values from the environment, rejects missing or ambiguous sources, and refuses a body capability that is expired, longer than four hours, empty, or malformed.

The fixed broker enforces constant-time bearer comparison, expiry, operation scope, route, method, canonical path, response size, DID, event class, expected version, idempotency key, nonce, and signing-domain policy. It may sign only the configured player's `player-decision:ActionIntentSubmitted` and `game-possession:PossessionResolved` events. The first scenario authorizes zero model calls even though the model route is prepared for a later explicitly priced scenario.

## Drive boundary

The Agent Drive is created atomically with exactly these rules and is never left unpermissioned:

1. label `abl-drive-role=ciphertext-broker`, read-write, path `/ciphertext`;
2. label `abl-drive-role=projection-writer`, read-write, path `/projections`.

The storage broker must be denied `/projections`; the public API must be denied `/ciphertext`; the body and fixed broker must be denied both paths and have no mount. Direct S3 access remains forbidden. Only ciphertext and public derived projections may enter the Drive. Plaintext, signing keys, database credentials, and preview tokens are prohibited.

## Current provider preflight and cost

Authenticated read-only inspection on `2026-08-21` verified:

- Blaxel CLI `0.1.108` is authenticated to `agent-basketball-league`;
- the workspace contains zero Sandboxes, Drives, Agents, Functions, Jobs, Applications, Volumes, and Policies;
- account tier is Tier 6 with USD 22.41 credit;
- automatic top-up is unavailable/off because no payment method is configured; the USD 5 low-balance alert is enabled;
- account-wide Sandbox usage is 3 of 10,000, with 2,000 concurrent Sandboxes, 20,000 preview URLs, 32,768 MiB maximum memory per instance, 20,000 Sandbox snapshots, and 10,485,760 MiB of image storage quota;
- Agent Drive remains a private-preview feature restricted to `us-was-1` and remains free for stored data and operations during beta.

Blaxel lists Sandbox active compute at USD 0.0000115 per GiB-second, snapshot storage at USD 0.20 per GiB-month, and image storage at USD 0.045 per GiB-month. A deliberately conservative four active hours for all 10.5 GiB is:

```text
10.5 GiB × 14,400 seconds × USD 0.0000115 = USD 1.7388
```

Actual active compute should be lower because Sandboxes scale to standby. Image and snapshot charges depend on the produced sizes and retention duration, so they must be observed during execution. The proposed all-in hard ceiling remains USD 10, with immediate teardown before that ceiling and no automatic top-up. The provider preflight, price, balance, and account-wide usage must be refreshed immediately before any mutation.

## Build and execution sequence

1. Record the explicit new approval, current working-tree digest, exact activation time, four-hour hard-stop timestamp, current balance/quota/top-up state, and replacement-database specification in an external mode-0600 evidence directory.
2. Create the new empty temporary database, store its URLs outside Git, apply the migration, and pass schema, transaction, rollback, reconnect, and pool probes.
3. Generate five source-minimal fixed-service image contexts outside the repository; build the separate uncredentialed body image; record every source digest and immutable provider image identifier.
4. Generate random preview tokens and a random body capability with one common expiry no later than the hard stop. Supply them only through Blaxel secret fields.
5. Create all five private previews and the fixed-service Sandboxes. Verify unauthenticated `401` and token-authenticated health for each preview.
6. Create the Agent Drive atomically with both path rules, read back exact equality, mount only the two authorized paths, and prove both cross-path denials before any data write.
7. Create the player-body Sandbox last. Before uploading the body program, prove its environment and filesystem expose no long-lived credential and its allowlist contains only the fixed-broker host.
8. Upload the reviewed body program to ephemeral `/workspace` and run exactly one deterministic signed possession through fixed broker, core transaction, projection worker, public API, and arena.
9. Restart each service boundary, reconnect the database, rebuild projections from recorded events, and prove exact event/root/receipt equality.
10. Prepare one signed rehearsal checkpoint for public verification. Do not broadcast it to Base or any recognition contract. Without independent witnesses, recognition may not exceed `SIGNED_VALID`.
11. Run denial tests, export redacted evidence and hashes, then tear down in the order below even if any earlier step fails.

## Required acceptance and denial evidence

Success requires all of the following:

- six immutable-image Sandboxes and five `public:false` previews match the packet;
- every preview rejects a missing or invalid token;
- the body can reach only the pinned filtered-proxy tuple; that proxy accepts only the fixed-broker host; direct IPv4/IPv6, alternate DNS, custom TLS, local/private, metadata, core, storage, model, PostgreSQL, Agent Drive, and control-plane routes fail;
- the body cannot read signing, model, service, encryption, preview, database, or Drive credentials;
- the broker rejects a missing, wrong, expired, overlong, or operation-mismatched capability;
- the broker rejects another DID, disallowed event class, path traversal, redirect, oversized request/response, stale version, and replayed idempotency key;
- core rejects an unsigned event, human/service signature, unauthorized signer, stale nonce/window, invalid receipt, and duplicate command;
- Drive ACL equality and both cross-path denials pass before and after restart;
- database rollback, reconnect, exact replay, outbox recovery, projection rebuild, and restart tests pass;
- arena output originates from the private public API rather than a fixture;
- the checkpoint verifies locally and is not broadcast;
- the database contains zero recognized/canonical history after teardown verification;
- no model call, public ingress, recurring capacity, founding decision, or recognition transaction occurs.

Any failure stops the scenario. Do not weaken a boundary, widen an allowlist, retry with a different provider/resource shape, or substitute a Volume without a new amendment and approval.

## Teardown and recovery

Teardown order is:

1. stop and delete `abl-stage-player-body-001`;
2. revoke/delete the fixed-broker preview and body capability;
3. delete all remaining private previews;
4. delete fixed broker, core, arena, public API, and storage broker Sandboxes;
5. delete the Agent Drive after the redacted evidence digest is exported;
6. delete every pushed image tag and verify remaining image records have zero tags/bytes;
7. verify zero ABL Sandboxes, Drives, previews, and runnable image tags;
8. verify the exact temporary database project identifier, request action-time confirmation, permanently delete it, and verify it is absent;
9. destroy the secret-bearing work directory and retain only redacted, mode-0600 evidence with SHA-256 checksums.

If the execution assistant disconnects, the four-hour idle-deletion policies are the backstop, not the primary teardown mechanism. The accountable operator remains responsible for exact-name verification and permanent database/Drive deletion.

## Exact authorization requested and consumed

To execute this packet, Michael Preuss must explicitly approve all of the following as one bounded action:

- approval identifier `ABL-GATE2-2026-08-21-02`;
- one run in workspace `agent-basketball-league`, region `us-was-1`;
- exactly six Sandboxes, including kernel iptables enablement on the body, five token-protected private previews, and one path-permissioned Agent Drive named above;
- one new empty temporary Neon PostgreSQL 17 project named `abl-stage-gate2`, with a newly assigned provider project ID;
- image pushes for the six reviewed Sandbox images;
- maximum four hours from the first external mutation and USD 10 all-in spend, with auto top-up off;
- zero public ingress, zero model calls, no independent-witness claim above `SIGNED_VALID`, no Base transaction, no recognition broadcast, no founding-agent decision, no recurring capacity, and no Genesis;
- mandatory failure-closed teardown and permanent deletion of the new temporary database after evidence export.

Approval of the architecture, this document, or local code changes is not equivalent to this execution authorization. The previous approval is consumed and cannot be reused.
