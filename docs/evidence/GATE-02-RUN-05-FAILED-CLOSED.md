# Gate 2 credential-corrected run result

> Approval: `ABL-GATE2-2026-08-21-05`, replacing pre-mutation-invalidated `ABL-GATE2-2026-08-21-04`
> Recorded: `2026-08-21` in `America/Vancouver`
> Repository baseline: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Frozen source digest: `0x756c65795348feb6b57c72f937ff462dd8cd179add86f515299014b48b477fae`
> Corrected body-image source digest: `0xa1d7e85a4f1a23fd4e4132470660dc65aa2c2885592279b865622594e6a297a2`
> Authorized launch-ledger digest: `0xe25c45c7b9c240dc697aaa0824e8fea178c4aa28a90526e5e2d672d54cca6ab1`
> Outcome: `FAILED_CLOSED_BEFORE_PLAYER_EXECUTION`
> Recognition: `NONE`

## Result

The fourth mutating Gate 2 run closed both incidents left by run 03 before player upload. The live provider identity token changed within 90 minutes of `READY`; root ownership, mode `0400`, and uid-10101 `EACCES` persisted after rotation. A credential-free, query-token-free player request then reached the exact token-protected fixed-broker preview with HTTP `200` through Blaxel's server-side header injection. The full direct, proxy, alternate-loopback, control-plane, database, Drive, model, and bypass denial matrix passed.

The player archive uploaded only after every mandatory pre-upload gate passed. Installation then failed before extraction or execution because the live Sandbox presented `/workspace` as uid/gid `0:0`, mode `0700`, while the pinned Sandbox API correctly forced the installation process to uid/gid `10101:10101`. This differs from the reviewed Docker build layer, which creates `/workspace` as `abl-agent:abl-agent`, mode `0700`. The runtime mount therefore replaced or overrode the image-layer directory metadata.

The run did not weaken `/workspace`, request root process execution, bypass the immutable launcher, execute from `/tmp`, change the image, or use the already-consumed second body recreation. The uploaded archives were deleted, `/workspace/agent` and `/workspace/state` remained absent, and no player code ran. Approval `ABL-GATE2-2026-08-21-05` is consumed.

## Passed live before the stop

- The execution-time no-drift gate matched the baseline, full source, body-image source, and launch-ledger digests; exact runtime, CLI, quota, region, privacy, inventory, and projected-cost conditions also matched.
- The induced capability failure exposed only sanitized `FAILED:INSTALLING_SHORT_LIVED_CAPABILITY:78` status and no mutation surface. The one authorized same-name recreation reached the root-owned mode-`0444` `READY` marker and pinned Sandbox API.
- The identity token and mounted environment file were root-owned regular non-symlinks, mode `0400`, unreadable by uid `10101`, and denied by the filesystem API before and after a real provider token modification.
- The player environment, readable process surfaces, descriptors, and capability directory contained no preview, provider, database, Drive, model, signing, or control-plane credential. The body had no Drive mount.
- UID-level IPv4 and IPv6 rules allowed only the credential-free loopback proxy. All direct and proxy denial probes passed, including metadata, DNS, custom TLS, private routes, control plane, Neon, Drive, model, core, storage, and `NO_PROXY=*` bypass.
- Fixed-broker live transport and controlled-clock tests rejected missing, wrong, expired, overlong, operation-mismatched, and schema-invalid capabilities with sanitized responses.
- The five fixed services ran persistently with restart-on-failure and no process timeout. Every `public:false` preview returned `401` without its token and `200` with the exact token.
- The Agent Drive contained exactly the two reviewed label/path rules. Intended mounts succeeded; live direct-API/remount attempts from storage to `/projections` and public to `/ciphertext` received provider authorization denial and created no FUSE mount.
- Neon migration, serializable rollback, direct and pooled reconnect, service health, and zero-state checks passed.

## Archive finding

The first reviewed tree was archived on macOS without disabling copyfile metadata. Its local and remote SHA-256 matched `91069517b1cf86d28c726cabc12e395c85cfa8d898f3309df47641f322cb4a19`, but GNU tar exposed one AppleDouble member, `._agent`, outside the allowed `agent/` root. The path guard rejected it before directory creation or extraction.

The same reviewed program tree was repackaged with copyfile metadata disabled. The clean archive SHA-256 was `b8bc92ac9c15ee48a37538ddc8ddaa3c68bf0c54d12a887ded021608eead1815`, size `16502668` bytes. Remote inspection reported 14,514 entries, zero absolute paths, zero traversal paths, and zero entries outside `agent/`. The clean package reached the installation boundary but did not execute because of `/workspace` ownership.

## Zero-state and teardown proof

Immediately before teardown, all canonical tables remained empty: `recognized_events=0`, `aggregate_heads=0`, `event_keys=0`, `canonical_outbox=0`, `command_idempotency=0`, and `actor_nonces=0`. The ciphertext path contained only the reviewed policy JSON; the projections path contained thirteen empty repository directories and zero files. No model call, Base request, recognition broadcast, checkpoint publication, founding-agent decision, recurring capacity, Genesis action, or recognition claim occurred.

The first mutation was `2026-08-22T03:54:43.752Z`; teardown completed around `2026-08-22T05:13:33Z`, more than two hours before the hard stop. Five tokens and previews, six Sandboxes, the Agent Drive, all six exact image tags and records, and temporary Neon project `bitter-resonance-31041732` were deleted. The secret directory was destroyed. Final inventory retained exactly the seven historical images, unrelated `sandbox-openai` route, and Hummingbird project `snowy-darkness-52052673`.

The Blaxel balance moved from USD 21.56 immediately before mutation to USD 21.06 after teardown. That USD 0.50 account-wide movement is observed balance evidence, not itemized attribution; it remained below the conservative elapsed-run estimate and the USD 10 hard ceiling. Automatic top-up remained unconfigured/off and no payment method was added.

## Redacted evidence

The exported mode-`0600` evidence archive was written to `/private/tmp/ABL-GATE2-2026-08-21-05-evidence.tgz` with SHA-256:

`8c77edf7bfcd93b8d9b7c3218ece68dc4422253465ec7a0be068b93075508350`

Its internal checksum manifest passed, and the final scan found no database URL, bearer credential, private key, or preview-token value.

## Required correction

Before another live attempt:

1. the root initializer must reassert the runtime-mounted `/workspace` directory as uid/gid `10101:10101`, mode `0700`, and fail before `READY` if the path is a symlink, non-directory, or retains different metadata;
2. archive construction must suppress macOS copyfile/extended-attribute sidecars and validate every effective tar member, link, mode, and root before upload;
3. focused, exact-runtime, simplification, and security-diff review must pass;
4. the new body/source/ledger digests and execution-time provider facts must be frozen; and
5. any retry must use new run-scoped images and resources. No prior Gate 2 approval may be reused.

The credential and preview-authentication corrections are now live-proven. The remaining live incident is the runtime-mounted workspace handoff.
