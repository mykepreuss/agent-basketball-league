# Blaxel launch verification

> Recorded: `2026-08-19`; bounded execution and teardown recorded `2026-08-21` in `America/Vancouver`
> Mode: authenticated inspection followed by mutating approvals `ABL-GATE2-2026-08-21-01`, `ABL-GATE2-2026-08-21-02`, `ABL-GATE2-2026-08-21-03`, and `ABL-GATE2-2026-08-21-05`; `-04` invalidated before mutation
> Workspace: `agent-basketball-league`
> Execution result: `FOUR_MUTATING_RUNS_FAILED_CLOSED_WORKSPACE_HANDOFF_OPEN`; no public exposure or recognized history.

## Bounded execution result

The approved private run created five Sandboxes, four token-protected `public:false` previews, one path-permissioned Agent Drive, and one temporary Neon Free project. The Drive rules, cross-path mount denials, private-preview `401/200` behavior, Neon migration and transaction probes, four fixed-service health checks, and arena-to-public-API rendering passed.

The player-body proof stopped at `FAILED:INSTALLING_UID_EGRESS_POLICY:3`: Blaxel did not permit the root entrypoint to install the required nftables owner policy. The body program was never uploaded or run, the database retained zero recognized events/outbox/idempotency rows, and no model or recognition call occurred. The observed Blaxel balance delta was USD 0.24 against the USD 10 cap.

All five Sandboxes, four previews, the Agent Drive, and every pushed image tag were deleted. Blaxel reported zero ABL Sandboxes and Drives afterward; five image records remained with zero tags and zero bytes. The temporary Neon project `abl-stage-gate2` (`divine-pine-07002473`) was permanently deleted through the authenticated console on `2026-08-21`, and the secret-bearing local work directory was destroyed. The full result is in [Gate 2 private staging result](./GATE-02-FAILED-CLOSED.md); the corrected boundary is in the [six-Sandbox amendment](../launch/GATE_2_SIX_SANDBOX_AMENDMENT.md).

## Six-Sandbox execution result

Approval `ABL-GATE2-2026-08-21-02` created the exact six-Sandbox amendment, five token-protected `public:false` previews, one two-rule path-permissioned Agent Drive, and a new temporary Neon PostgreSQL 17 project. Database probes, six image pushes, all five preview transport gates, fixed-service health, arena-to-public-API rendering, Drive ACL equality, and both cross-path denials passed.

The player body reported the reviewed image, 4,096 MiB, `runtime.extraArgs.iptables=enabled`, one fixed-broker allowlist host, and no mount, but its authenticated Sandbox API returned HTTP 404. Neither the root-owned stage marker nor the process API was reachable, so `READY` could not be proved. No body program was uploaded or run. The database retained zero recognized-event, outbox, and idempotency rows; recognition remained `NONE`.

Teardown completed before the hard stop. Blaxel reported zero runtime resources and zero runnable ABL image tags; the new Neon project `delicate-tree-46229964` was permanently deleted and verified absent; the secret directory was destroyed. The observed account-credit change was USD 0.07 against the USD 10 ceiling. See the [six-Sandbox failed-closed result](./GATE-02-RUN-02-FAILED-CLOSED.md).

## Corrected-body execution result

Approval `ABL-GATE2-2026-08-21-03` bound the third run to baseline `943fb734e43f880d86eb352e7aacf795d44914d5`, full source digest `0x7edcfca19e07ef30620097279b874f2a5a5c0739b89f71a80dacf95b229ad0a2`, corrected body digest `0xd035e3db3bc72e42e5753c4dd408643eb3a8a6e1f8a1ef939682450432215d2b`, and launch-ledger digest `0xc8efe9528cefeecc7288d20ce14054783fa95be005e0f9e8fb7a2b6b0789fa2e`. The no-drift preflight passed before mutation.

The induced-failure body exposed only the sanitized `FAILED:INSTALLING_SHORT_LIVED_CAPABILITY:78` status and denied every tested mutation surface. Its one authorized same-name recreation reached the root-owned mode-`0444` `READY` marker and handed port 8080 to the pinned Sandbox API. An authenticated process then ran as uid/gid `10101` on `linux/amd64`; direct IPv4, IPv6, DNS, metadata, private-network, alternate loopback, database, control-plane, and fixed-broker proxy-bypass sockets were denied; the body had no Drive mount.

The pre-upload gate nevertheless failed. The uid-10101 process could read `/var/run/secrets/blaxel.ai/identity/token`, contradicting the uncredentialed-body claim. The one allowed fixed-broker request reached the token-protected preview through the loopback credential proxy but returned `401` with the installed preview token. No player program was uploaded, and no canonical command, projection, replay, checkpoint, model call, or recognition action was attempted.

All five preview tokens and previews, six Sandboxes, the two-rule Agent Drive, six run image tags, and temporary Neon project `ancient-bonus-94780368` were deleted. Final Blaxel inventory was empty for every run-created resource class; Neon listed only the unrelated `Hummingbird` project; the secret directory was destroyed. Recognition remained `NONE`. See the [corrected-body failed-closed result](./GATE-02-RUN-03-FAILED-CLOSED.md).

## Credential-corrected execution result

Approval `ABL-GATE2-2026-08-21-05` replaced `-04`, which made no mutation after its exact-balance condition drifted. Run `-05` matched baseline `943fb734e43f880d86eb352e7aacf795d44914d5`, full source digest `0x756c65795348feb6b57c72f937ff462dd8cd179add86f515299014b48b477fae`, body-image digest `0xa1d7e85a4f1a23fd4e4132470660dc65aa2c2885592279b865622594e6a297a2`, and launch-ledger digest `0xe25c45c7b9c240dc697aaa0824e8fea178c4aa28a90526e5e2d672d54cca6ab1` before mutation.

The run closed both run-03 incidents before upload. It observed a real provider-token modification within 90 minutes of `READY`; root ownership, mode `0400`, uid-10101 `EACCES`, clean process surfaces, and tokenless fixed-broker HTTP `200` through server-side preview-token injection all persisted afterward. Direct and proxy denials, fixed-broker capability enforcement, private-preview token behavior, persistent service processes, exact Drive permissions, intended mounts, and live cross-path remount/direct-API denial all passed.

After the pre-upload gate passed, GNU tar exposed one macOS AppleDouble member in the first otherwise matching archive. The path guard rejected it before extraction. A metadata-free archive of the same reviewed tree passed 14,514 remote path checks and reached installation. Installation then stopped before extraction because Blaxel's live `/workspace` was root-owned mode `0700`, while the Sandbox API forced the process to uid `10101`. No root bypass or alternate launcher was used, and no player code executed.

Canonical tables remained empty, projection files remained zero, and the ciphertext path retained only its reviewed policy file. All five tokens/previews, six Sandboxes, one Agent Drive, six exact image tags and records, and temporary Neon project `bitter-resonance-31041732` were deleted; the secret directory was destroyed. Final Blaxel inventory retained only the seven historical images and unrelated `sandbox-openai` route; Neon retained only Hummingbird. The balance moved from USD 21.56 before mutation to USD 21.06 after teardown, automatic top-up remained off, and no payment method was added. See the [credential-corrected failed-closed result](./GATE-02-RUN-05-FAILED-CLOSED.md).

## Body-init correction and remaining boundary

The [body-init diagnostic amendment](../launch/GATE_2_BODY_INIT_DIAGNOSTIC_AMENDMENT.md) now starts a dedicated uid-10102 diagnostic server before protected initialization. It exposes only exact `GET`/`HEAD /abl-init-status`, rejects mutation and all other routes, accepts only a strict nonsecret state vocabulary, clears its environment, and redacts malformed marker contents. Any protected-stage failure leaves the diagnostic process running; a successful path writes `READY`, stops diagnostics, and then executes the exact pinned Sandbox API with user operations forced to uid 10101. The root image has no automatic agent `CMD`.

The exact Sandbox API is locked by OCI index, linux/amd64 manifest, extracted binary SHA-256, version `0.2.50`, Git commit, and local credential-proxy port `49152`. The third-run launcher gave the agent only the credential-free loopback proxy URL and root-owned CA path; it did not inherit the provider proxy template or workload token. Focused diagnostic, topology, assurance, and adversarial tests, shell syntax validation, source-minimal packaging, all six non-mutating Blaxel dry-runs, and the exact-runtime full pipeline passed locally for third-run body-source digest `0xd035e3db3bc72e42e5753c4dd408643eb3a8a6e1f8a1ef939682450432215d2b`. The later credential-boundary correction and its new digest are recorded below.

The third run live-proved diagnostic routing during image boot, acceptance of the exact kernel rules, normal Sandbox API/CA handoff, and the tested direct socket denials. Run `-05` subsequently closed the identity-token and fixed-broker preview-authentication incidents. The remaining body boundary is installation through the runtime-mounted `/workspace`; its correction is local-only until another bounded live run proves the uid-10101 handoff, player execution, and restart path.

## Authenticated resource state

The current Blaxel CLI is `0.1.108`. Read-only commands returned:

| Resource class          | Current result                                                        |
| ----------------------- | --------------------------------------------------------------------- |
| Workspaces              | `agent-basketball-league` only; current                               |
| Applications            | none                                                                  |
| Agents                  | none                                                                  |
| Functions/MCP servers   | none                                                                  |
| Jobs                    | none                                                                  |
| Sandboxes               | none                                                                  |
| Volumes                 | none                                                                  |
| Agent Drives            | none; list operation is available                                     |
| Policies                | none                                                                  |
| Integration connections | none returned by its resource endpoint                                |
| Models                  | one deployed sandbox model, `sandbox-openai`, backed by `gpt-4o-mini` |

Commands:

```sh
bl version
bl workspaces
bl get applications -o json
bl get agents -o json
bl get functions -o json
bl get jobs -o json
bl get sandboxes -o json
bl get volumes -o json
bl get drives -o json
bl get policies -o json
bl get models -o json
bl get integrationconnections -o json
```

The empty Drive result establishes that the authenticated account can reach the Drive resource API; it does not prove a live Drive's permissions, durability, recovery, isolation, or cost.

## Account preflight

A second authorized read-only console/API preflight on `2026-08-19` verified:

- workspace status `ready` and enabled feature flag `drives=true`;
- Tier 6 account quota with 3 of 10,000 Sandboxes used account-wide, 2,000 concurrent Sandboxes, 20,000 preview URLs, 32 GiB maximum memory per instance, and ample image quota;
- zero Sandboxes and zero Drives in `agent-basketball-league` itself;
- automatic top-up `OFF` and available promotional credit greater than the packet's USD 10 hard ceiling; the exact balance is intentionally not recorded in repository evidence;
- the Agent Drive console page is enabled and still contains zero Drives.

The preflight made no change. Account state must be checked again immediately before any separately approved provisioning because quotas, credits, and current usage are shared across workspaces and can change.

The fresh execution-time preflight on `2026-08-21` verified:

- Blaxel CLI `0.1.108` remains authenticated to `agent-basketball-league`;
- the target workspace still contains zero Agents, Sandboxes, Volumes, Drives, Functions/MCP servers, Jobs, Policies, and images;
- the console shows Tier 6 and a USD 22.76 credit balance, above the USD 10 approval cap;
- no payment method or automatic top-up is configured; the low-balance alert is enabled at USD 5;
- Tier 6 permits 10,000 Sandboxes total, 2,000 concurrent, 20,000 preview URLs, 32,768 MiB per instance, 20,000 Sandbox snapshots, and 10,485,760 MiB of images; the account-wide console showed 3 Sandboxes in use, leaving ample headroom for five;
- the proposed five Sandboxes remain below the per-instance and aggregate request limits;
- Agent Drive remains available in `us-was-1`, the only region documented for the private preview;
- five Sandboxes totaling 9.5 GiB for the four-hour absolute maximum remain USD 1.5732 at the published active-compute rate; Neon is on the Free plan and the run authorizes zero model calls.

No Blaxel mutation occurred during the refreshed preflight itself. The separately approved execution and teardown are recorded above.

The post-amendment read-only preflight on `2026-08-21` verified that the workspace still contains zero Sandboxes, Drives, Agents, Functions, Jobs, Applications, Volumes, and Policies. The console showed Tier 6, USD 22.41 credit, automatic top-up unavailable/off because no payment method is configured, and the USD 5 low-balance alert enabled. Account-wide usage was 3 of 10,000 Sandboxes, with 2,000 concurrent Sandboxes, 20,000 preview URLs, 32,768 MiB per instance, 20,000 Sandbox snapshots, and 10,485,760 MiB of image quota. The proposed six-Sandbox topology totals 10.5 GiB; four fully active hours are USD 1.7388 at the published rate before transient image/snapshot storage. No mutation occurred during this preflight.

The post-correction read-only preflight at `2026-08-21T15:47:55-07:00` verified:

- the workspace API reports `agent-basketball-league` as `ready`; its workspace record is in `us-west-2`, while the regional Gate 2 workloads remain explicitly pinned to `us-was-1`;
- Blaxel CLI `0.1.108` is authenticated to the target workspace, which has zero Sandboxes, Agent Drives, Agents, Functions/MCP servers, Jobs, Applications, Volumes, Policies, or integration connections;
- one pre-existing Sandbox model route, `sandbox-openai`, remains deployed but was not invoked; five historical ABL image records remain with provider-reported size zero, and no image was pushed during the preflight;
- the account remains Tier 6 with USD 22.17 promotional credit, no payment method, and automatic top-up unconfigured/off;
- account-wide relevant quotas are 3 of 10,000 Sandboxes used, 2,000 concurrent Sandboxes, 20,000 preview URLs, 32,768 MiB per instance, 20,000 Sandbox snapshots, and 0 of 10,485,760 MiB image storage reported as used;
- current Blaxel documentation lists `us-was-1` as an available Sandbox region and the only Agent Drive private-preview region; the two earlier same-day runs live-proved the account's Sandbox and Agent Drive access there, but a read-only preflight cannot independently re-prove create entitlement;
- the signed-in Neon organization remains on the Free plan with one unrelated project, `Hummingbird`, and no project named `abl-stage-gate2`; the current Free plan permits 100 projects, 100 CU-hours monthly and 0.5 GB storage per project, so one new empty, four-hour PostgreSQL 17 project remains estimated at USD 0;
- six Sandboxes allocate 10.5 GiB total, costing USD 1.7388 if all remain active for the full four hours at USD 0.0000115/GiB-second. Conservatively retaining 10.5 GiB of snapshots for four hours adds about USD 0.0117, and retaining the prior run's approximately 3.16 GiB combined image footprint for four hours adds about USD 0.0008. Agent Drive remains free during beta, Blaxel internal and internet traffic are included, Neon remains within Free-plan allowances, and model calls remain prohibited. The resulting Gate 2 planning estimate is USD 1.76 before provider rounding, within but not replacing the USD 10 hard ceiling.

No provider mutation, model call, database connection, credential creation, top-up, or payment action occurred during this refreshed preflight. A new run still requires a fresh source freeze and a new exact authorization; neither consumed approval authorizes reuse.

The later [fourth-run read-only preflight](./GATE-02-PREFLIGHT-04.md), completed at `2026-08-21T17:58:44-07:00`, refreshed the same boundary against the corrected source. It verified USD 21.93 credit, automatic top-up unconfigured/off, unchanged Tier 6 runtime quota, live `us-was-1` flags for Drive, egress, and proxy, empty runtime inventories, private-preview support, the Neon Free organization with only Hummingbird, and a USD 1.76 four-hour estimate. It also recorded material image-reporting drift: the image API returned seven historical records totaling approximately 3.1594 GiB while the quota console reported zero image usage. A replacement authorization must therefore use six unique run-scoped image names and leave all historical records untouched. No provider mutation occurred.

## Post-run local corrections

The [credential-boundary amendment](../launch/GATE_2_CREDENTIAL_BOUNDARY_AMENDMENT.md) addressed the two third-run failures without altering their historical evidence:

- the root initializer now derives exactly one approved identity-token path from the pinned proxy template, rejects alternate/symlinked/non-regular paths, makes the provider token and `BL_ENV_VAR_PATH` root-owned mode `0400`, and drops to uid/gid `10101` to require `EACCES` before `READY`;
- decoded secret inputs are retained as empty sentinels so the pinned Sandbox API's environment-file loader cannot rehydrate them;
- the player runtime no longer receives or stores a fixed-broker preview token; the body manifest instead configures Blaxel's exact-destination, write-only proxy secret to inject `X-Blaxel-Preview-Token` server-side; and
- the future pre-upload gate now requires an observed real token-file modification followed by unchanged mode/ownership, repeated uid denial, and a successful fixed-broker request with no player-supplied preview credential.

Run `-05` live-proved provider acceptance of the file hardening, permission persistence through a real token rotation, uid-10101 read denial, and server-side preview injection. Those incidents are closed.

The current local correction reasserts the runtime-mounted `/workspace` as a real directory owned by uid/gid `10101` with mode `0700` after provider credentials are hardened and before the uid egress policy is installed. It rejects a symlink or non-directory, verifies the resulting metadata, and never recursively changes existing content. The staging preparation path now also creates and validates one metadata-free body archive, rejects AppleDouble entries, absolute/traversing paths, escaping links, unsupported member types, set-ID files, `.env`, and an incorrectly permissioned entry point. Focused foundation and assurance tests pass; exact-runtime, simplification, security-diff, source-freeze, and live installation proof remain required before this correction can close the workspace incident.

## Current official provider facts

Retrieved `2026-08-19`; Blaxel region, Drive, and pricing facts plus Neon Free-plan limits refreshed `2026-08-21`:

- [Agent Drive overview](https://docs.blaxel.ai/Agent-drive/Overview), last modified May 1, 2026: Agent Drive is private preview, currently restricted to `us-was-1`, supports concurrent read-write mounts, persists beyond Sandbox deletion, and has no configurable size during preview. Its access-control warning still describes workspace-level credentials and `drivePath` as a mount convenience.
- [Drive permissions](https://docs.blaxel.ai/Agent-drive/Permissions), last modified July 17, 2026: mounts are not access boundaries, but Drive ACLs are evaluated server-side against workload identity labels for both mounts and direct API calls; a rule can restrict mode and path, and an unpermissioned Drive is accessible to workloads in the workspace. This newer capability-specific page documents the exact `permissions` request used by Gate 2. Because the overview retains conflicting preview language, retrieved ACL equality and live cross-path denial are mandatory rather than inferred.
- [Agent Drive S3 endpoint](https://docs.blaxel.ai/Agent-drive/S3-endpoint): Drive permission rules are not currently enforced for S3 access; a valid service-account key receives full read-write access to all workspace Drives. The staging design therefore forbids the S3 endpoint and uses only ACL-enforced Sandbox mounts.
- [Volumes](https://docs.blaxel.ai/Volumes/Overview): volumes are durable block storage attached to a running resource and are distinct from Agent Drive.
- [Sandbox lifecycle](https://docs.blaxel.ai/Sandboxes/Overview): sandboxes scale to warm standby after inactivity, preserve memory/filesystem snapshots, and charge active memory/storage; volume or Drive storage is still needed for the league's durable recovery contract.
- [Usage and quotas](https://docs.blaxel.ai/Security/Quotas): current quota tier and resource limits are visible in the Blaxel Console; tiers depend on trailing 30-day real-money top-ups and can affect concurrent resources, storage, TTL, and gated features.
- [Workspace access control](https://docs.blaxel.ai/Security/Workspace-access-control): credits, quota tier, limits, and analytics are shared at account level across workspaces.
- [Logs and traces](https://docs.blaxel.ai/Observability/Overview): deployed workloads receive automatic metrics/logs and sampled traces. ABL must keep telemetry content-free and retain its opt-out or explicit redaction configuration.
- [Function variables and secrets](https://docs.blaxel.ai/Functions/Variables-and-secrets): secrets are deployment inputs and must remain outside tracked configuration. Secret values are never recorded in ABL manifests or evidence.
- [Blaxel pricing](https://blaxel.ai/pricing): Sandbox active compute is listed at USD 0.0000115/GiB-second, snapshots at USD 0.20/GiB-month, images at USD 0.045/GiB-month, and Volumes at USD 0.12/GiB-month. Agent Drive storage and operations are labeled free during beta. The prepared amendment uses six Sandboxes and no Agent Runtime workload; 10.5 GiB active for the full four-hour ceiling is USD 1.7388 before image/snapshot storage and the separately authorized temporary database.
- [Neon pricing](https://neon.com/pricing): the Free plan lists 100 projects, 100 CU-hours monthly and 0.5 GB storage per project. The signed-in organization is on that plan with one existing project, so the proposed empty temporary project is estimated at USD 0 when kept within those limits and deleted at teardown.

## Local staging-package validation

The exact Node `24.18.0` runtime and pnpm `11.21.0` assembled five fixed-service image contexts and the player-body program outside the repository with `scripts/prepare-staging-image-contexts.ts`. The contexts contain compiled runtime artifacts and production dependencies, while the application and injected `@abl/*` dependency trees exclude source directories, tests, TypeScript configuration, lockfiles, and Turbo build logs. The uncredentialed body program is compiled separately from its root image; that image contains the root initializer and immutable launcher but no broker implementation or broker credentials. Repository development dependencies remained installed after assembly.

The third-run source-minimal packaging pass removed the arena's `.next/cache` before image assembly and committed the then-current body image inputs—including the sanitized diagnostic server—to `0xd035e3db3bc72e42e5753c4dd408643eb3a8a6e1f8a1ef939682450432215d2b`. Its complete exact-runtime evidence pipeline passed with stable result digest `0xf42031fce5d477f0a845d46a38f72d8305ec45a667c106a84eb53b8dc12e0b5a`: 42/42 type-check tasks, 42/42 unit/integration tasks with 298 assertions in 67 files, 30 acceptance/adversarial/load/browser assertions in six files, and 29/29 production-build tasks. Turbo stages are deliberately serialized and the two heaviest application packages use one Vitest worker so wall-clock timeouts remain reproducible under host CPU contention; no functional, security, game, or SLO assertion is relaxed.

The post-run credential correction adds the provider-credential guard to the committed body inputs, producing body-image source digest `0xa1d7e85a4f1a23fd4e4132470660dc65aa2c2885592279b865622594e6a297a2`. Exact Node `24.18.0` and pnpm `11.21.0` rebuilt all six source-minimal contexts outside the repository, and Blaxel CLI `0.1.108` resolved all six manifests with `--dryrun` and no mutation. The refreshed nine-stage pipeline passed 335 assertions in 74 files and 113/113 uncached tasks with stable result digest `0x5e753b36a342e926e319ae8a13c8d547a7fb328a18bbc8429e7dc998b658baa6`. This packaging result remains local evidence, not a pushed image or live provider proof.

Blaxel CLI `0.1.108` dry-runs were executed from inside each generated context. All exited zero and resolved the following non-public resources in `us-was-1`:

| Context           | Resolved kind | Name                       | Memory  | Required artifact observed      |
| ----------------- | ------------- | -------------------------- | ------- | ------------------------------- |
| core API          | Sandbox       | `abl-stage-core-api`       | 2 GiB   | `app/dist/index.js`             |
| public API        | Sandbox       | `abl-stage-public-api`     | 1.5 GiB | `app/dist/index.js`             |
| storage broker    | Sandbox       | `abl-stage-storage-broker` | 1 GiB   | `app/dist/index.js`             |
| fixed broker      | Sandbox       | `abl-stage-fixed-broker`   | 1 GiB   | `app/dist/index.js`             |
| spectator arena   | Sandbox       | `abl-stage-arena`          | 1 GiB   | `app/.next/BUILD_ID`            |
| body image source | Sandbox       | `abl-body-sandbox-image`   | 4 GiB   | pinned Dockerfile and launchers |

The commands were non-mutating:

```sh
pnpm tsx scripts/prepare-staging-image-contexts.ts "$EXTERNAL_TEMP_DIRECTORY"
(cd "$EXTERNAL_TEMP_DIRECTORY/core-api" && bl deploy --dryrun)
(cd "$EXTERNAL_TEMP_DIRECTORY/public-api" && bl deploy --dryrun)
(cd "$EXTERNAL_TEMP_DIRECTORY/storage-broker" && bl deploy --dryrun)
(cd "$EXTERNAL_TEMP_DIRECTORY/fixed-broker" && bl deploy --dryrun)
(cd "$EXTERNAL_TEMP_DIRECTORY/arena" && bl deploy --dryrun)
(cd "$REPOSITORY" && bl deploy --dryrun --type sandbox)
```

Passing an absolute external directory with `bl deploy --dryrun -d ...` did not select that directory under CLI `0.1.108`; the reliable validation form changes into the context first. The Gate 2 packet uses that form for both dry-runs and proposed pushes.

Every generated service context now includes the pinned Blaxel Sandbox API and resolves as a Sandbox. The Sandbox image supplies `0.0.0.0:3000` for core, public API, storage broker, fixed broker, and arena so the Sandbox API can retain port 8080. All five fixed-service dry-runs emitted no missing-Sandbox-API warning; the uncredentialed body is a separate root image project. A dry-run does not prove that a remote build starts, binds, or remains private; those facts remain live proof.

## Reconciled differences

The dated phase evidence that says only `knicks` is authenticated and Drive is disabled remains a truthful historical observation from `2026-08-12`/`2026-08-13`, but it is not current platform state. Current launch records must use `agent-basketball-league`, Drive entitlement with zero Drive resources, and the existing sandbox model route.

On `2026-08-19`, the launch owner amended the approved reference architecture to select Agent Drive instead of Blaxel Volumes beginning with Gate 2, then amended core and arena from Agent Runtime to Sandboxes. On `2026-08-21`, approvals `ABL-GATE2-2026-08-21-01`, `-02`, and `-03` failed closed respectively at the same-Sandbox UID egress policy, initialization observability, and credential/preview-authentication boundaries. Approval `-04` invalidated before mutation. Replacement approval `-05` live-proved diagnostics, normal API handoff, credential rotation isolation, server-side preview authentication, UID socket denials, Drive ACL bypass resistance, and teardown, then failed closed before extraction on the root-owned live `/workspace`. All exact run approvals are consumed. The workspace-owner and archive corrections are local-only until exact-runtime review, a fresh source freeze, and another bounded live proof.

## Unknown or live-only facts

The following remain `LIVE_PROOF_REQUIRED` or `APPROVAL_GATED`:

- exact image/snapshot sizes and final usage delta within the approved cost envelope;
- exact service-account permissions and cross-workspace policies for the proposed staging identities;
- live private ingress and application-to-application reachability;
- Drive restart, restore, concurrent-write, and direct-API behavior beyond the passed ACL readback, mount, cross-path-denial, and deletion checks;
- live uid-10101 installation through the re-owned runtime `/workspace`, followed by body execution and API restart;
- restart behavior after the live-proven diagnostic, credential, preview-authentication, kernel-rule, Sandbox API/proxy/CA, immutable-image, and rollback paths;
- telemetry contents and prohibited-edge behavior from running workloads;
- execution-time provider drift checks and a source-bound cost envelope for the corrected player-body/fixed-broker run.

No local implementation or manifest validation may be cited as proof of these live facts.
