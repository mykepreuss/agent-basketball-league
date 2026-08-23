# Founding Alpha archive-determinism replacement preflight

> Status: `READ_ONLY_COMPLETE_R01_07_AUTHORIZATION_REQUIRED`
> Recorded: `2026-08-22T20:09:45-07:00` in `America/Vancouver`
> Consumed authorizations: `ABL-FOUNDING-ALPHA-R01-04`, `ABL-FOUNDING-ALPHA-R01-05`, `ABL-FOUNDING-ALPHA-R01-06`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon resource and did not reveal, copy, rotate, or persist any provider credential, database credential, preview token, or signing key.

## Outcome

R01-06 failed closed during its mandatory zero-mutation gate because a fresh body-program archive inherited permission metadata from a private preparation tree and did not match the authorization-bound digest. The result, unchanged provider inventories, root cause, and correction are recorded in [`FOUNDING-ALPHA-R01-06-FAILED-CLOSED.md`](./FOUNDING-ALPHA-R01-06-FAILED-CLOSED.md).

The correction and result were merged through [PR 17](https://github.com/mykepreuss/agent-basketball-league/pull/17) before this preflight. The archive packager now canonicalizes permissions, uid, gid, owner, group, mtime, and header checksums before compression. The regression suite requires byte-identical output from byte-identical content prepared under private and shared permission layouts.

Preflight 09 preserves final-tree dependency ordering:

1. the R01-06 result, archive correction, exact-runtime evidence, resource plan, and every other recorded dependency were merged first;
2. every repository and artifact value below was calculated from merged `main` at `9455def106790dec234918cbf51db93a23474433`;
3. this preflight change does not modify a file whose digest it records; and
4. the Preflight 09 file digest and final evidence merge commit will be calculated only after this file is merged.

The complete exact Node 24.18.0 pipeline passes 366 assertions across 78 files and 113 uncached tasks. Independent private- and default-permission image preparations reproduce body-program archive digest `0x65a837f5040edb5d8508fc048a07bd90695ecb94169919a70fc92348fa1d734c`. The thirteen image-source digests and rendered manifest set remain unchanged.

The bounded private Founding Alpha envelope still fits the observed Blaxel and Neon state, and the conservative four-hour projection remains USD 6.00 against a USD 10.00 hard ceiling. R01-04, R01-05, and R01-06 are consumed and cannot be reused. No provider mutation is authorized. A replacement `ABL-FOUNDING-ALPHA-R01-07` authorization must bind this preflight after it is merged and every current value below.

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
| R01-05 failed-closed record commit    | `04ebe214e4d65de8d236f9a34fed653f5b095013`                           |
| Final dependency-tree commit          | `00930051720a2a0d89f2d2040dccef6a86ef4b6c`                           |
| Preflight 08 record commit            | `6fdb0e405b7965e23d0791a2d78e5c680f14171f`                           |
| R01-06 authorization evidence commit  | `dafbfe4f6c517dd0c931d4eb4863e708e6bc49af`                           |
| Archive-determinism correction commit | `be4594457b8a2dd85c20410e91675a60cb7aa9ab`                           |
| Current correction merge on `main`    | `9455def106790dec234918cbf51db93a23474433`                           |
| Implementation source                 | `0xf341e4ded56f7993e93b269c267f88fde104b296532227b10126c513d1a02e2b` |
| Implementation files                  | `433`                                                                |
| Launch plan                           | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result       | `0x88134695f20cb36c758328ae0d4f754255214945a1e386ece84c15109eea2acd` |
| Final local-results file              | `0x957c9c4239381ffda46c9f68311db5f4048c19caa262f657e36c9eef99970c8c` |
| Thirteen-image source set             | `0xd86825b5503e8c4fa142f59086ae1666639f94acb634b0848ed4610353a82c5f` |
| Image-sources file                    | `0x55d7c73993d8b059ea78ae4e74ff6afae5eabd4a45c6b5ba29ba5a75ae5918a5` |
| Rendered manifest set                 | `0xe988196438afa80530d1f1d7d605f3ba445d0c15e5c3d8510d0bb53bdd4a3828` |
| Body-image source                     | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive                  | `0x65a837f5040edb5d8508fc048a07bd90695ecb94169919a70fc92348fa1d734c` |
| Private resource-plan file            | `0x5ddef156ef441ecd75598c49c9f07f6772f3de43e722f110d602dfb8f627c961` |
| Drive-access file                     | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger                 | `0x3caeba115db15ec5b1ac7187b3af5e868ed9df887afd80d9e0841e77be12cda1` |
| R01-04 failed-closed evidence file    | `0x3e649ba4e7da262f7105d0530d784575d23642896eb5e79b2770b6900f04914d` |
| R01-05 failed-closed evidence file    | `0x246f2b11818ec1ec8a29340b17aea6b1d0d3babdb31ab72626881636e0e06a65` |
| R01-06 failed-closed evidence file    | `0xab0732397ad166edcd1345d7d4ef457e1e7f74fa13e3d9d7501c9fe4634a233d` |
| Historical Preflight 07 file          | `0xd0d734d5f51d64eb85ad2ec5b82b96d3794bf1fcc55b94309e75c9abcc55fec5` |
| Consumed Preflight 08 file            | `0xa20287f370e9bfbed43ee9d8b0afb5ea345e5b33aa5692e6d9c27b042b5fcd43` |

Every value above was read from the separately merged dependency tree. None of the bound result, plan, source, artifact, or historical evidence files is modified by this Preflight 09 change.

## R01-06 binding drift

| Binding                    | Authorized R01-06                                                    | Current                                                              | Result                          |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| Current merged `main`      | `dafbfe4f6c517dd0c931d4eb4863e708e6bc49af`                           | `9455def106790dec234918cbf51db93a23474433`                           | Corrected; replacement required |
| Implementation source      | `0xa4bc419dafa7f6e1cec25cf2b79848f892d7200b367ae89c4994212df64a05cf` | `0xf341e4ded56f7993e93b269c267f88fde104b296532227b10126c513d1a02e2b` | Corrected; replacement required |
| Exact-runtime result       | `0x634a83574414aeb51d408edca78bd7675fd0399512c502e7e566c59ac3a9d266` | `0x88134695f20cb36c758328ae0d4f754255214945a1e386ece84c15109eea2acd` | Corrected; replacement required |
| Body-program archive       | `0x43d9373baaa2bee8d0affe80aaa7e394d1c2af01f47102b66edfbeb2306d5569` | `0x65a837f5040edb5d8508fc048a07bd90695ecb94169919a70fc92348fa1d734c` | Corrected; replacement required |
| Private resource-plan file | `0x9ac57ac77ce635512203960e618973773e3e6d32ea8f52c7f4a80d0c039eb758` | `0x5ddef156ef441ecd75598c49c9f07f6772f3de43e722f110d602dfb8f627c961` | Corrected; replacement required |
| Derived launch ledger      | `0x76500b91a0b4484998d5d51545c5ac1fc4f1a58eeacf895c93be778668962df1` | `0x3caeba115db15ec5b1ac7187b3af5e868ed9df887afd80d9e0841e77be12cda1` | Corrected; replacement required |
| Launch plan                | `0x5bda34a5…318a4`                                                   | Same                                                                 | Match                           |
| Image set                  | `0xd86825b5…2c5f`                                                    | Same                                                                 | Match                           |
| Manifest set               | `0xe9881964…3828`                                                    | Same                                                                 | Match                           |
| Body-image source          | `0x93a1d11f…bf642`                                                   | Same                                                                 | Match                           |
| Drive-access file          | `0x732685da…956d3`                                                   | Same                                                                 | Match                           |
| Blaxel balance             | USD 18.52                                                            | USD 18.48                                                            | Permitted movement; above floor |

This drift is the reviewed archive correction and ordinary account-wide credit movement expressly permitted by R01-06, not authority to resume it.

## Blaxel account and inventory

Authenticated Blaxel CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 18.48                                                    | USD 6.00 projected; USD 10 hard ceiling |
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

No `abl-alpha-r01-*` resource and no `abl-career-0198e000000070008000000000000001` Sandbox exists. The image API reports seven historical records while the quota console reports zero image usage. This unchanged discrepancy remains covered by the cost buffer and exact-name teardown boundary.

## Region, Drive ACL, preview, and image-reference support

Blaxel's current [region documentation](https://docs.blaxel.ai/Infrastructure/Regions) lists `us-was-1` as North Virginia and an available Sandbox region. [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview) remains a private-preview feature available only in `us-was-1`; the Drive and mounted Sandboxes must use that region. The authenticated workspace exposes an empty Drive inventory, confirming continued access to its management surface.

Current [Drive permission documentation](https://docs.blaxel.ai/Agent-drive/Permissions) defines label-based, server-enforced access for mounts and direct HTTP API calls. A Drive supports at most three label/mode/path rules, unmatched workloads are denied, and the reviewed Founding Alpha Drive defines exactly three rules. A live run must still prove exact readback plus matching, mismatching, mounted, direct-API, and cross-path behavior.

Current [Sandbox preview documentation](https://docs.blaxel.ai/Sandboxes/Preview-url) supports `public:false` previews and token access through the `X-Blaxel-Preview-Token` header. The candidate path accepts the exact 12-character or 21-hex provider-generated immutable revision read back after a reviewed image build, or an OCI `@sha256` digest. The replacement run must push and read back one image at a time.

## Neon organization and capacity

The authenticated `Michael` organization remains on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. Current [Neon pricing](https://neon.com/pricing) includes 100 projects on the Free plan, so the organization uses 1 of 100 project slots and has capacity for the single temporary PostgreSQL 17 project. Its projected cost remains USD 0 within Free-plan allowances.

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

USD 6.00 remains below the USD 10.00 hard ceiling and current USD 18.48 balance. The estimate treats every declared compute resource as active for all four hours.

## Next gate

Do not mutate under R01-06 or any earlier authorization. After this preflight is merged and its final digest is calculated, obtain one fresh `ABL-FOUNDING-ALPHA-R01-07` authorization that:

1. binds the final Preflight 09 file digest, its merged evidence commit, R01-06 result and correction commits, and every current artifact digest above;
2. binds synthetic application UUID `0198e000-0000-7000-8000-000000000001` and exact provisioner-derived body name `abl-career-0198e000000070008000000000000001`;
3. retains the exact resource names, Drive permissions and mounts, USD 5.00 minimum balance, USD 6.00 projection, four-hour limit, USD 10.00 hard ceiling, prohibitions, evidence export, and exact-name teardown terms;
4. requires sequential exact-name image push/readback before Neon or workload creation;
5. requires the fixed-broker-first, live-challenge, existing-candidate-provisioner flow;
6. requires an immediate pre-mutation recheck of every repository, artifact, runtime, provider, inventory, privacy, capacity, payment, top-up, ACL, and cost binding; and
7. states that any subsequent relevant drift invalidates R01-07 before mutation.
