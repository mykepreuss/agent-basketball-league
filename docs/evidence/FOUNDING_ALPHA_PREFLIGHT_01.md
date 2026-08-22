# Founding Alpha private slice read-only preflight

> Status: `READ_ONLY_COMPLETE_EXECUTION_NOT_AUTHORIZED`
> Recorded: `2026-08-22T13:06:00-07:00` through `2026-08-22T13:13:19-07:00` in `America/Vancouver`
> Run ID: `ABL-FOUNDING-ALPHA-R01`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This inspection was read-only. It created, modified, or deleted no Blaxel or Neon resource and did not read or record any secret, access token, preview token, database credential, or model credential. It does not authorize the private run.

## Result

The existing ABL code and launch layer are locally frozen and verified. The requested bounded private resource envelope fits the visible account quotas, the current USD 19.34 balance exceeds both the USD 5.00 minimum and USD 6.00 projection, automatic top-up is unconfigured/off, `us-was-1` supports the selected regional resources, private previews remain supported, and the Neon Free organization has room for one new temporary PostgreSQL 17 project.

The `agent-basketball-league` workspace contains no live ABL workload or storage resource. Seven historical image records and the unrelated existing `sandbox-openai` model route remain out of scope. The Neon organization contains only the unrelated Hummingbird project. No target resource name currently conflicts.

## Repository binding and reuse

| Artifact                        | Verified value                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Baseline commit                 | `943fb734e43f880d86eb352e7aacf795d44914d5`                                            |
| Existing implementation source  | `0x0dc96e69d12042effa21aa2d044c962737474174d797e8511c1c39560e879c38` across 428 files |
| Launch plan                     | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4`                  |
| Exact Node 24.18.0 local result | `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5`                  |
| Image-source set                | `0x2a49f2ead328fc3fe39979ede40b701d74a7428807e369e98345f14e8f16a9e6`                  |
| Rendered manifest set           | `0xe53d58cea4490fc3090132fad6bf8634b02d2b0fd65398cb8c55f8b645a792f7`                  |
| Reviewed body image source      | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642`                  |
| Reviewed body archive           | `0x5142588fa09bb4036e2ab08eb656cdb03960593873816fc9b11026c9d8f162ef`                  |
| Launch ledger                   | `0x5d006f4b4e71f3560f066c2a82ee2de74b70e47871e5650f3a1c745eee33f1a3`                  |

The image packet references the existing core API, public API, arena, storage broker, fixed body broker, career body, candidate edge/store, candidate provisioner, and four MCP applications. The resource packet derives from their existing active Blaxel manifests. This is a deployment and integration proof of the codebase already built, not a replacement implementation.

## Blaxel account and quota state

Blaxel CLI `0.1.108` is authenticated to the current workspace. The console reports Tier 6.

| Item                        |                              Current read-only result |                            Bounded request |
| --------------------------- | ----------------------------------------------------: | -----------------------------------------: |
| Credit balance              |                                             USD 19.34 | USD 6.00 projected; USD 10.00 hard ceiling |
| Automatic top-up            | Unconfigured/off; console offers `Add payment method` |     Must remain off; add no payment method |
| Low-balance alert           |                                   Enabled at USD 5.00 |                                  No change |
| Sandboxes                   |                              3 of 10,000 account-wide |        7 new; 10 account-wide if unchanged |
| Concurrent Sandboxes        |                                         2,000 allowed |                                  7 maximum |
| Preview URLs                |                                        20,000 allowed |                         6 private previews |
| Maximum memory per instance |                                            32,768 MiB |                          4,096 MiB maximum |
| MCP servers                 |                                 0 of 500 account-wide |                                      5 new |
| Jobs                        |                                 4 of 500 account-wide |                                      1 new |
| Concurrent Job memory       |                                           786,432 MiB |                                  2,048 MiB |
| Sandbox snapshots           |                                        20,000 allowed |                      At most 7 transiently |
| Image storage meter         |                          0 of 10,485,760 MiB reported |                  13 new run-scoped records |
| Policies                    |                                  2 of 20 account-wide |                                0 requested |
| Workspaces                  |                                   2 of 5 account-wide |                                0 requested |

The image-size meter still conflicts with the seven historical records visible in the workspace console. The private packet therefore carries a conservative metering buffer, uses unique run-scoped image names, and never overwrites or deletes those records.

## Blaxel workspace inventory

Read-only CLI and console listings returned:

| Resource class              | Current inventory                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Sandboxes                   | none                                                                                      |
| Agent Drives                | none                                                                                      |
| Agents                      | none                                                                                      |
| Applications                | none                                                                                      |
| Functions/MCP servers       | none                                                                                      |
| Jobs                        | none                                                                                      |
| Volumes                     | none                                                                                      |
| Integration connections     | none                                                                                      |
| Workspace policies          | none                                                                                      |
| Previews and preview tokens | none because no Sandbox exists; the CLI does not support a global nested-resource listing |
| Models                      | one existing `sandbox-openai` route backed by `gpt-4o-mini`; prohibited and untouched     |

The seven historical image records are `abl-stage-fixed-broker` (501.66 MB), `abl-body-sandbox-image` (376.25 MB), `abl-stage-core-api` (524.79 MB), `abl-stage-player-body` (size unavailable), `abl-stage-public-api` (524.07 MB), `abl-stage-arena` (909.62 MB), and `abl-stage-storage-broker` (398.81 MB). All remain untouched.

## Region, Drive, and preview availability

Blaxel documents `us-was-1` as North Virginia and documents Agent Drive as a private-preview capability available only in `us-was-1`, with both Drive and mounted Sandbox required in that region. The authenticated workspace exposes the Agent Drive inventory endpoint and console surface, and earlier bounded ABL runs created and tore down Drives in this workspace. The private packet uses one Drive in this region and no Blaxel Volume. [Regions](https://docs.blaxel.ai/Infrastructure/Regions), [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview)

Drive permission rules are label-matched and may be path-scoped; nonmatching workloads are denied. The run must still prove exact permission readback and cross-path denial live. [Drive permissions](https://docs.blaxel.ai/Agent-drive/Permissions)

Blaxel private previews support `public:false` and token access through a query parameter or `X-Blaxel-Preview-Token`. The packet requires the header form and six token-protected private previews. Each preview must be read back as private before use. [Private previews](https://docs.blaxel.ai/Sandboxes/Preview-url)

## Neon organization and project state

The authenticated Neon organization `Michael` is on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. The project list reports Hummingbird as last active in 2025 and current compute usage as zero. Neon currently lists the Free plan at USD 0 with 100 projects, 100 CU-hours per month per project, 0.5 GB storage per project, and automatic scale-to-zero. The new empty four-hour PostgreSQL 17 project is therefore projected at USD 0 if it remains inside those allowances. [Neon pricing](https://neon.com/pricing)

## Four-hour cost projection

Blaxel currently lists active Sandbox memory at USD 0.0000115 per GiB-second, MCP compute at USD 0.000007 per GiB-second, Job compute at USD 0.000006 per GiB-second, images at USD 0.045 per GiB-month, Sandbox snapshots at USD 0.20 per GiB-month, and Agent Drive data/operations as free during beta. [Blaxel pricing](https://blaxel.ai/pricing)

| Component                                                               | Conservative four-hour amount |
| ----------------------------------------------------------------------- | ----------------------------: |
| Seven Sandboxes, 23 GiB allocated, active for all four hours            |                    USD 3.8088 |
| Five Functions/MCP servers, 10 GiB allocated, active for all four hours |                    USD 1.0080 |
| One Job, 2 GiB allocated, active for all four hours                     |                    USD 0.1728 |
| **Published-rate active compute**                                       |                **USD 4.9896** |
| Transient image, snapshot, and provider-metering buffer                 |                    USD 1.0104 |
| Agent Drive                                                             |             USD 0 during beta |
| Temporary Neon Free project                                             |       USD 0 within allowances |
| Model calls and Base transactions                                       |             USD 0; prohibited |
| **Authorization projection**                                            |                  **USD 6.00** |

USD 6.00 is below the unchanged USD 10.00 hard ceiling and current USD 19.34 balance. The estimate is deliberately conservative because it treats every declared compute resource as active for the entire four hours.

## Drift and next gate

No resource, feature, privacy, quota, name, or Neon collision blocks preparation of a new authorization. The balance has moved from earlier observations to USD 19.34 and must be checked immediately before mutation. The image console continues to show seven historical records while the account quota meter reports zero image storage; this known reporting drift is handled by the buffer and strict resource-specific teardown.

The next action is not provisioning. It is a new execution authorization bound to the final launch-ledger digest and every frozen value above, the exact resource names in [`resource-plan.json`](../../infra/blaxel/founding-alpha-private/resource-plan.json), the four-hour/USD 10 limits, USD 5 minimum balance, zero-public/model/Base/recognition/founding/recurring/Genesis prohibitions, redacted evidence export, and mandatory teardown.
