# Gate 2 fourth-run read-only preflight

> Status: `READ_ONLY_COMPLETE_EXECUTION_NOT_AUTHORIZED`
> Recorded: `2026-08-21T17:49:39-07:00` through `2026-08-21T17:58:44-07:00` in `America/Vancouver`
> Workspace: `agent-basketball-league`
> Blaxel region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)
> Repository baseline: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Inspected full source digest: `0xd7209771a6effa3917495dd82f36d0a13e102fc77453920de4ee6c7f57a41fd9`
> Corrected body-image source digest: `0xa1d7e85a4f1a23fd4e4132470660dc65aa2c2885592279b865622594e6a297a2`
> Inspected launch-ledger digest: `0x38c63e1281013581f8d1b8363221aabd47b11f2426b6615f83ed152a39a04960`

This is read-only evidence, not provisioning or execution authority. It does not authorize an image push, Sandbox, preview, token, Agent Drive, Neon project, secret, spend, public exposure, model call, Base transaction, recognition broadcast, founding-agent decision, recurring capacity, or Genesis action. Local evidence recording changes the full source and launch-ledger digests; a later source freeze must replace the inspected values above in any execution authorization.

## Result

The target has sufficient current quota, credit, regional support, and Free-plan database headroom to prepare a new bounded Gate 2 authorization. Runtime inventories are empty and no conflicting Neon project exists. One material inventory/reporting drift is recorded: Blaxel's image API now returns seven historical ABL image records totaling 3,392,356,352 bytes (approximately 3.1594 GiB), while the quota console reports zero image-storage usage. The next run must use six unique run-scoped image names and must not overwrite or delete any historical image record.

No provider resource was created, modified, or deleted. No preview token, access token, database credential, model route, or secret value was read or recorded.

## Repository and runtime binding

At the start of the external inspection, the applicable source set contained 476 files after excluding only `**/.DS_Store` and `apps/private-broker/**`. The source-freeze algorithm `sha256(JSON.stringify(sorted[{path,sha256(file)}]))` reproduced the authorized full source digest exactly. `HEAD` reproduced the authorized baseline commit. The corrected body digest and evidence-derived launch-ledger digest also matched the read-only authorization.

The most recent exact local pipeline used Node `24.18.0` and pnpm `11.21.0`, passed 335 assertions across 74 files and 113 of 113 uncached tasks, and produced stable result digest `0x5e753b36a342e926e319ae8a13c8d547a7fb328a18bbc8429e7dc998b658baa6`. The ledger remains `BLOCKED`, recognition remains `NONE`, and the two third-run incidents remain open pending live pre-upload proof.

## Blaxel account and feature state

Blaxel CLI `0.1.108` is authenticated to the current target workspace. The workspace is `ready`. The authenticated platform-configuration endpoint returned this live `us-was-1` state:

| Field                      | Result                           |
| -------------------------- | -------------------------------- |
| Region allowed             | `true`                           |
| Location                   | Ashburn, Virginia, United States |
| Agent Drive available      | `true`                           |
| Egress available           | `true`                           |
| Sandbox proxy available    | `true`                           |
| Workspace feature `drives` | `true`                           |

This verifies the region and current feature flags without creating a test resource. [Blaxel's region documentation](https://docs.blaxel.ai/Infrastructure/Regions) also lists `us-was-1`; [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview) remains a private-preview feature in that region. The newer [Drive-permissions documentation](https://docs.blaxel.ai/Agent-drive/Permissions) describes server-side label, path, and mode enforcement, but exact ACL equality and cross-path denial remain mandatory live acceptance checks.

The current Tier 6 console state is:

| Account item                |                       Current value |              Gate 2 request |
| --------------------------- | ----------------------------------: | --------------------------: |
| Credit balance              |                           USD 21.93 |         USD 10 hard ceiling |
| Automatic top-up            | Unconfigured/off; no payment method |             Must remain off |
| Low-balance alert           |                    Enabled at USD 5 |                   No change |
| Sandboxes                   |            3 of 10,000 account-wide |                6 concurrent |
| Concurrent Sandboxes        |                       2,000 allowed |                           6 |
| Preview URLs                |                      20,000 allowed |                           5 |
| Maximum memory per instance |                          32,768 MiB | 4,096 MiB maximum requested |
| Sandbox snapshots           |                      20,000 allowed |       At most 6 transiently |
| Image storage               | Console reports 0 of 10,485,760 MiB |         6 run-scoped pushes |

Credits and quota are shared at account level and can change. Their values must be rechecked immediately before any authorized mutation.

## Blaxel inventory

Read-only resource listings returned:

| Resource class              | Current inventory                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Sandboxes                   | none                                                                                          |
| Agent Drives                | none                                                                                          |
| Previews and preview tokens | none, because no Sandbox exists                                                               |
| Agents                      | none                                                                                          |
| Functions/MCP servers       | none                                                                                          |
| Jobs                        | none                                                                                          |
| Applications                | none                                                                                          |
| Volumes                     | none                                                                                          |
| Policies                    | none                                                                                          |
| Integration connections     | none                                                                                          |
| Models                      | one pre-existing `sandbox-openai` route backed by `gpt-4o-mini`; not invoked and out of scope |

The image endpoint returned seven historical ABL records with no returned tags:

| Image record               | API-reported bytes |
| -------------------------- | -----------------: |
| `abl-stage-fixed-broker`   |        526,028,800 |
| `abl-body-sandbox-image`   |        394,522,624 |
| `abl-stage-core-api`       |        550,285,312 |
| `abl-stage-player-body`    |                  0 |
| `abl-stage-public-api`     |        549,531,648 |
| `abl-stage-storage-broker` |        418,181,120 |
| `abl-stage-arena`          |        953,806,848 |
| **Total**                  |  **3,392,356,352** |

The API total conflicts with the quota console's zero-used image meter and with the earlier five-record/zero-byte post-teardown observation. This is provider-reporting drift, not evidence of a runnable tag. Because `bl push` does not accept a caller-selected tag, the next authorization should use six new run-scoped image names—`abl-gate2-r04-body`, `abl-gate2-r04-fixed-broker`, `abl-gate2-r04-core-api`, `abl-gate2-r04-public-api`, `abl-gate2-r04-storage-broker`, and `abl-gate2-r04-arena`—then delete only those exact run-created records during teardown. The seven historical records remain untouched.

## Preview privacy

[Blaxel private previews](https://docs.blaxel.ai/Sandboxes/Preview-url) support `public: false` and require a preview token in the query string or `X-Blaxel-Preview-Token` header. The platform currently allows 20,000 preview URLs. No current preview exists to inspect, but all five `public:false` token gates were live-proven in the earlier bounded runs. The corrected body design still requires a new live proof that the [region-dependent Sandbox proxy](https://docs.blaxel.ai/Sandboxes/Proxy) injects the fixed-broker preview token server-side while the player supplies no preview credential.

## Neon organization and project state

The authenticated Neon organization is `Michael` on the Free plan. The API and console both show exactly one existing project:

| Project       | Project ID                | Region          | PostgreSQL | Scope                            |
| ------------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| `Hummingbird` | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-stage-gate2` exists. Current organization usage since August 1 is 0.3 CU-hours, 0.15 GB storage, 0.02 GB history, and 0.05 GB transfer. The console reports Free-plan limits of 100 compute hours and 0.5 GB storage per project, autoscaling up to 2 CU, and 10 branches. [Neon's current Free pricing](https://neon.com/pricing) lists USD 0, and its current regional material includes AWS US West 2 (Oregon). The previous same-day Gate 2 runs also created PostgreSQL 17 projects successfully in `aws-us-west-2`. A new empty four-hour project in that region remains estimated at USD 0 if it stays inside the Free allowances; creation and permanent deletion still require exact execution authority.

## Four-hour cost projection

[Blaxel's published rates](https://blaxel.ai/pricing) currently list Sandbox active memory at USD 0.0000115 per GiB-second, snapshots at USD 0.20 per GiB-month, images at USD 0.045 per GiB-month, Agent Drive data and operations free during beta, and included proxy/traffic charges. The six-Sandbox topology allocates 10.5 GiB total.

| Component                                                                        | Conservative four-hour amount |
| -------------------------------------------------------------------------------- | ----------------------------: |
| Six Sandboxes active for all four hours                                          |                    USD 1.7388 |
| 10.5 GiB of snapshots retained for all four hours                                |                    USD 0.0117 |
| Existing 3.1594 GiB plus one equally sized new image set retained for four hours |                    USD 0.0016 |
| Agent Drive                                                                      |             USD 0 during beta |
| Neon temporary Free project                                                      |       USD 0 within allowances |
| Model calls and Base transactions                                                |             USD 0; prohibited |
| **Planning total before provider rounding**                                      |                **USD 1.7521** |
| **Authorization estimate**                                                       |                  **USD 1.76** |

USD 1.76 remains below the proposed USD 10 all-in hard ceiling and below the current credit balance. The estimate is not a spending authorization and must be invalidated if pricing, resource sizes, credit, top-up status, or inventory changes before mutation.

## Drift and authorization consequences

| Check                                | Result                                                           | Consequence                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Baseline and three inspected digests | Exact match                                                      | Safe to record this preflight; final documentation freeze must issue new full-source and ledger digests |
| Runtime resource inventory           | Empty                                                            | Exact six-Sandbox/five-preview/one-Drive scope remains available                                        |
| Neon target name                     | Absent                                                           | One new project can be requested without reusing prior projects                                         |
| Credit                               | USD 21.93, down from prior same-day observations                 | New authorization must quote USD 21.93 and recheck it before mutation                                   |
| `us-was-1`                           | Live API reports allowed with Drive, egress, and proxy available | Required Blaxel features are currently available                                                        |
| Preview privacy                      | Documented and previously live-proven                            | Every new preview must still be read back as `public:false` before use                                  |
| Historical image inventory           | Seven records / 3.1594 GiB, not five / zero bytes                | Use six unique run-scoped image names; do not overwrite or delete historical records                    |
| Image quota metering                 | Console zero conflicts with image API bytes                      | Carry conservative image cost and stop on quota rejection or further unexplained drift                  |
| Neon organization                    | One unrelated project; Free plan                                 | Hummingbird remains out of scope; new project must receive a new ID                                     |

The preflight is sufficient to prepare, but not execute, a replacement Gate 2 authorization. That authorization must bind the final post-documentation source digest, unchanged body digest, regenerated launch-ledger digest, exact six run-scoped image names, exact runtime resource names, one permitted body recreation, the 90-minute rotation-observation gate, four-hour and USD 10 limits, zero-public/model/Base/Genesis boundaries, redacted evidence export, and mandatory resource-specific teardown.
