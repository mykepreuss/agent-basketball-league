# Founding Alpha PostgreSQL 17 replacement preflight

> Status: `READ_ONLY_COMPLETE_R01_08_AUTHORIZATION_REQUIRED`
> Recorded: `2026-08-22T21:41:54-07:00` in `America/Vancouver`
> Consumed authorizations: `ABL-FOUNDING-ALPHA-R01-04`, `ABL-FOUNDING-ALPHA-R01-05`, `ABL-FOUNDING-ALPHA-R01-06`, `ABL-FOUNDING-ALPHA-R01-07`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon resource. It did not reveal, copy, rotate, or persist any provider credential, database credential, preview token, or signing key. The Neon create-project dialog was inspected and cancelled without activating `Create`; the project inventory remained unchanged.

## Outcome

R01-07 passed its repository, runtime, quota, privacy, and sequential image gates, pushed and read back all thirteen exact images, then failed closed because the generic Neon project-creation connector created PostgreSQL 18 while the authorization required PostgreSQL 17. The exact temporary Neon project and all thirteen run-scoped images were deleted, and final inventories were verified. The result is recorded in [`FOUNDING-ALPHA-R01-07-FAILED-CLOSED.md`](./FOUNDING-ALPHA-R01-07-FAILED-CLOSED.md).

The correction and refreshed local evidence were merged through [PR 20](https://github.com/mykepreuss/agent-basketball-league/pull/20) before this preflight. The temporary Neon project is now the first provider mutation. Its reviewed creation path uses the signed-in Neon Console to explicitly select PostgreSQL 17, `aws-us-east-1` (AWS US East 1 / N. Virginia), Free plan, and Neon Auth off. The generic project-creation connector is prohibited for creation because its current contract exposes only project name and organization, not PostgreSQL version or region.

An authorized run must record the new project ID immediately and read back the exact name, PostgreSQL version, region, Free-plan organization, and empty user schema before the first Blaxel image push. A missing or mismatched field requires permanent deletion of that exact project ID, verified absence, and a failed-closed stop before any image push.

Preflight 10 preserves final-tree dependency ordering:

1. the R01-07 result, PostgreSQL 17 creation-order correction, exact-runtime evidence, resource plan, and every other recorded dependency were merged first;
2. every repository and artifact value below was calculated from merged `main` at `8f507f0f79d6706814fe73a10e0a3de71e0fb3bc`;
3. this preflight change does not modify a file whose digest it records; and
4. the Preflight 10 file digest and final evidence merge commit will be calculated only after this file is merged.

The complete exact Node 24.18.0 pipeline passes nine suites, 366 assertions across 78 files, and 113 uncached tasks. The thirteen image sources, rendered manifests, body image source, and canonical body-program archive remain unchanged. The corrected 433-file implementation freeze and evidence-derived launch ledger reproduce exactly.

The bounded private Founding Alpha envelope still fits the observed Blaxel and Neon state. The conservative four-hour projection remains USD 6.00 against a USD 10.00 hard ceiling and a current USD 18.26 Blaxel balance. No provider mutation is authorized by this document. A replacement `ABL-FOUNDING-ALPHA-R01-08` authorization must bind this preflight after it is merged and every current value below.

## Final-tree repository and artifact bindings

| Binding                               | Final-tree value                                                     |
| ------------------------------------- | -------------------------------------------------------------------- |
| Foundation baseline commit            | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Merged implementation release         | `5690cf18b3268071dc191f690618c2239b471373`                           |
| Packaging correction commit           | `7cb980a76f24af59aed790eabd8d7b21a9535539`                           |
| Execution-boundary correction commit  | `548fae73464d18f921905d23446d2d5ebbd775a5`                           |
| Live-path correction commit           | `080e97a68a7cabda77becf62e24e779bf346fe1d`                           |
| Immutable-revision correction commit  | `436dd0fda41e05bab7096df0d8e84950bdc35863`                           |
| Immutable-revision correction merge   | `7976c9477e8060f3045e23602d13b0e9acfc2bbd`                           |
| Final dependency-tree commit          | `00930051720a2a0d89f2d2040dccef6a86ef4b6c`                           |
| Archive-determinism correction commit | `be4594457b8a2dd85c20410e91675a60cb7aa9ab`                           |
| Archive-determinism correction merge  | `9455def106790dec234918cbf51db93a23474433`                           |
| Preflight 09 record commit            | `894ffad602e8c2656c03c28211e4522be08c7ac2`                           |
| Preflight 09 merge                    | `be47a6e5544636c74857edfb62cf33819506c613`                           |
| R01-07 failed-closed record commit    | `87dfd70fd4693dae435a47f81e155761a2b326fa`                           |
| R01-07 failed-closed merge            | `781a7beb2ef6d6501e07bed95fc5c631e82e53e5`                           |
| PostgreSQL 17 gate correction commit  | `1536e24a94e719c1245b1f42d6fe1324256c753d`                           |
| Current correction merge on `main`    | `8f507f0f79d6706814fe73a10e0a3de71e0fb3bc`                           |
| Implementation source                 | `0x3ed3766dc23385386fc589ceec3b76b6e512f31364f59f03767b7d29304f6068` |
| Implementation files                  | `433`                                                                |
| Source-freeze evidence file           | `0x16537f250052bb0d6f72b330af6805aaf8995ea36bc6f4c5c3ca3bef5834daf0` |
| Launch plan                           | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result       | `0x88134695f20cb36c758328ae0d4f754255214945a1e386ece84c15109eea2acd` |
| Final local-results file              | `0x590d92b1b9770b72a3b28b741c2cbe2138fd91f530fd3c475b64013198368438` |
| Thirteen-image source set             | `0xd86825b5503e8c4fa142f59086ae1666639f94acb634b0848ed4610353a82c5f` |
| Image-sources file                    | `0x55d7c73993d8b059ea78ae4e74ff6afae5eabd4a45c6b5ba29ba5a75ae5918a5` |
| Rendered manifest set                 | `0xe988196438afa80530d1f1d7d605f3ba445d0c15e5c3d8510d0bb53bdd4a3828` |
| Body-image source                     | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive                  | `0x65a837f5040edb5d8508fc048a07bd90695ecb94169919a70fc92348fa1d734c` |
| Private resource-plan file            | `0xfb8aadb449f27fb89b1291a046f0f8aebe2d3931056374808514a180af0b3550` |
| Drive-access file                     | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger                 | `0x1935fc2fa9e10c144130cf5980065fd866e6771002d420486b440aa63f6ab885` |
| Launch-ledger evidence file           | `0x450d1f7a4bc258dfd5e5f7ec934f43b2da905625abf40eda0a63a4d92de17945` |
| R01-04 failed-closed evidence file    | `0x3e649ba4e7da262f7105d0530d784575d23642896eb5e79b2770b6900f04914d` |
| R01-05 failed-closed evidence file    | `0x246f2b11818ec1ec8a29340b17aea6b1d0d3babdb31ab72626881636e0e06a65` |
| R01-06 failed-closed evidence file    | `0xab0732397ad166edcd1345d7d4ef457e1e7f74fa13e3d9d7501c9fe4634a233d` |
| R01-07 failed-closed evidence file    | `0xa40d1926098c96def7541e9ebd57ec9b199ab6eee3dbe70ea525227b15a83267` |
| Historical Preflight 07 file          | `0xd0d734d5f51d64eb85ad2ec5b82b96d3794bf1fcc55b94309e75c9abcc55fec5` |
| Historical Preflight 08 file          | `0xa20287f370e9bfbed43ee9d8b0afb5ea345e5b33aa5692e6d9c27b042b5fcd43` |
| Consumed Preflight 09 file            | `0x09151b7c45ea6467a4238791b54d86272f8990841d2479587dd06dfa1b9f8e6d` |

Every value above was read from the separately merged dependency tree. None of the bound result, plan, source, artifact, or historical evidence files is modified by this Preflight 10 change.

## R01-07 binding drift and correction

| Binding                    | Authorized R01-07                                                    | Current                                                              | Result                          |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| Current merged `main`      | `be47a6e5544636c74857edfb62cf33819506c613`                           | `8f507f0f79d6706814fe73a10e0a3de71e0fb3bc`                           | Corrected; replacement required |
| Implementation source      | `0xf341e4ded56f7993e93b269c267f88fde104b296532227b10126c513d1a02e2b` | `0x3ed3766dc23385386fc589ceec3b76b6e512f31364f59f03767b7d29304f6068` | Corrected; replacement required |
| Private resource-plan file | `0x5ddef156ef441ecd75598c49c9f07f6772f3de43e722f110d602dfb8f627c961` | `0xfb8aadb449f27fb89b1291a046f0f8aebe2d3931056374808514a180af0b3550` | Corrected; replacement required |
| Derived launch ledger      | `0x3caeba115db15ec5b1ac7187b3af5e868ed9df887afd80d9e0841e77be12cda1` | `0x1935fc2fa9e10c144130cf5980065fd866e6771002d420486b440aa63f6ab885` | Corrected; replacement required |
| Neon creation order        | After thirteen image pushes                                          | First provider mutation                                              | Corrected; replacement required |
| Neon creation surface      | Generic connector                                                    | Signed-in console with explicit version and region                   | Corrected; replacement required |
| Launch plan                | `0x5bda34a5…318a4`                                                   | Same                                                                 | Match                           |
| Exact-runtime result       | `0x88134695…acd`                                                     | Same                                                                 | Match                           |
| Image set                  | `0xd86825b5…2c5f`                                                    | Same                                                                 | Match                           |
| Manifest set               | `0xe9881964…3828`                                                    | Same                                                                 | Match                           |
| Body-image source          | `0x93a1d11f…bf642`                                                   | Same                                                                 | Match                           |
| Body-program archive       | `0x65a837f5…d734c`                                                   | Same                                                                 | Match                           |
| Drive-access file          | `0x732685da…956d3`                                                   | Same                                                                 | Match                           |
| Blaxel balance             | USD 18.33 at final R01-07 teardown                                   | USD 18.26                                                            | Permitted movement; above floor |

R01-07 is consumed and cannot be resumed. The drift above is the reviewed PostgreSQL 17 correction plus ordinary account-wide credit movement, not authority to mutate.

## Blaxel account and inventory

Authenticated Blaxel CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 18.26                                                    | USD 6.00 projected; USD 10 hard ceiling |
| Automatic top-up            | Unconfigured/off; account requires adding a payment method   | Must remain off                         |
| Monthly top-up              | Unconfigured; console offers `Set up`                        | Must remain unconfigured                |
| Payment method              | None configured; console offers `Add payment method`         | Add none                                |
| Low-balance alert           | Enabled at USD 5.00                                          | No change                               |
| Tier                        | 6                                                            | No change                               |
| Sandboxes                   | 3 of 10,000 account-wide; 2,000 concurrent allowed           | 7 new                                   |
| Preview URLs                | 20,000 allowed                                               | 6 private previews                      |
| Maximum memory per instance | 32,768 MiB                                                   | 4,096 MiB maximum                       |
| Blaxel Agents               | 0 of 500 account-wide                                        | 0; prohibited                           |
| MCP servers                 | 0 of 500 account-wide                                        | 5 new                                   |
| Model APIs                  | 3 of 500 account-wide                                        | 0 new; model calls prohibited           |
| Jobs                        | 4 of 500 account-wide; 786,432 MiB concurrent memory allowed | 1 new at 2,048 MiB                      |
| Sandbox snapshots           | 20,000 allowed                                               | At most 7 transiently                   |
| Image meter                 | 0 of 10,485,760 MiB reported                                 | 13 new run-scoped records               |
| Policies                    | 2 of 20 account-wide                                         | 0 new                                   |
| Workspaces                  | 2 of 5 account-wide                                          | 0 new                                   |

The `agent-basketball-league` workspace contains zero Sandboxes, Agent Drives, Blaxel Agents, Applications, Functions/MCP servers, Jobs, Volumes, policies, and integration connections. With zero Sandboxes, it contains no Sandbox preview or preview token. It retains only the unrelated `sandbox-openai` model route and these seven historical images:

- `abl-body-sandbox-image`
- `abl-stage-arena`
- `abl-stage-core-api`
- `abl-stage-fixed-broker`
- `abl-stage-player-body`
- `abl-stage-public-api`
- `abl-stage-storage-broker`

No `abl-alpha-r01-*` resource and no `abl-career-0198e000000070008000000000000001` Sandbox exists. The seven historical image records report 3,392,356,352 aggregate bytes while the quota console reports zero image usage. This unchanged discrepancy remains covered by the cost buffer and exact-name teardown boundary.

## Region, Drive ACL, preview, and image-reference support

Blaxel's current [region documentation](https://docs.blaxel.ai/Infrastructure/Regions) lists `us-was-1` as North Virginia and an available Sandbox region. [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview) remains available in `us-was-1`, and the authenticated workspace exposes an empty Drive inventory through its management surface.

Current [Drive permission documentation](https://docs.blaxel.ai/Agent-drive/Permissions), last modified July 17, 2026, defines label-based, server-enforced access for mounts and direct HTTP API calls. A Drive supports at most three label/mode/path rules, unmatched workloads are denied, and the reviewed Founding Alpha Drive defines exactly three rules. A live run must still prove atomic creation, exact readback, matching access, mismatching denial, mounted access, direct-API denial, and cross-path denial.

Current [Sandbox preview documentation](https://docs.blaxel.ai/Sandboxes/Preview-url) supports `public:false` previews and token access through the `X-Blaxel-Preview-Token` header. Current [image documentation](https://docs.blaxel.ai/Sandboxes/Templates) retains workspace-scoped image records, and the replacement run must push and read back one exact image at a time.

## Neon organization, PostgreSQL 17 path, and capacity

The authenticated `Michael` organization remains on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. Current [Neon pricing](https://neon.com/pricing) includes 100 projects on the Free plan, so the organization uses 1 of 100 project slots and has capacity for the single temporary project. Its projected cost remains USD 0 within Free-plan allowances.

The signed-in Neon Console create-project dialog currently offers PostgreSQL versions 14, 15, 16, 17, and 18; offers AWS US East 1 (N. Virginia); and permits Neon Auth to remain disabled. The dialog was changed read-only to PostgreSQL 17 and AWS US East 1, then cancelled. [Neon's project documentation](https://neon.com/docs/manage/projects) confirms that the console accepts an explicit project name, PostgreSQL version, provider, and region. [Neon's compatibility documentation](https://neon.com/docs/reference/compatibility) lists PostgreSQL 17 as supported.

## Current four-hour projection

Current [Blaxel pricing](https://blaxel.ai/pricing) remains USD 0.0000115 per GiB-second for active Sandbox memory, USD 0.000007 per GiB-second for MCP compute, USD 0.000006 per GiB-second for Job compute, USD 0.045 per GiB-month for images, and USD 0.20 per GiB-month for Sandbox snapshots. Agent Drive data and operations remain free during beta.

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

USD 6.00 remains below the USD 10.00 hard ceiling and current USD 18.26 balance. The estimate treats every declared compute resource as active for all four hours.

## Next gate

Do not mutate under R01-07 or any earlier authorization. After this preflight is merged and its final digest is calculated, obtain one fresh `ABL-FOUNDING-ALPHA-R01-08` authorization that:

1. binds the final Preflight 10 file digest, its record and merge commits, the R01-07 result, the PostgreSQL 17 correction commits, and every current artifact digest above;
2. retains the exact seven Sandboxes, five Functions/MCP servers, one Job, one Agent Drive, six private previews, thirteen images, synthetic candidate UUID, provisioner-derived body name, Drive ACL/mount rules, four-hour limit, USD 5.00 balance floor, USD 6.00 projection, USD 10.00 hard ceiling, prohibitions, evidence export, and exact-name teardown terms;
3. makes signed-in-console creation of `abl-founding-alpha-r01` with PostgreSQL 17, `aws-us-east-1`, Free plan, and Neon Auth off the first provider mutation, and prohibits the generic project-creation connector for creation;
4. requires immediate exact-ID readback of the project name, PostgreSQL version, region, Free-plan organization, and empty user schema, with exact project deletion and a stop before image pushes on any mismatch;
5. requires sequential exact-name image push/readback only after the Neon gate passes;
6. requires the fixed-broker-first, live-challenge, existing-candidate-provisioner flow and the complete existing-implementation proof;
7. requires an immediate pre-mutation recheck of every repository, artifact, runtime, provider, inventory, privacy, capacity, payment, top-up, ACL, and cost binding; and
8. states that any subsequent relevant drift invalidates R01-08 before mutation.
