# Founding Alpha immutable-revision replacement preflight

> Status: `READ_ONLY_COMPLETE_R01_05_AUTHORIZATION_REQUIRED`
> Recorded: `2026-08-22T19:28:51-07:00` in `America/Vancouver`
> Consumed authorization: `ABL-FOUNDING-ALPHA-R01-04`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon resource and did not reveal, copy, rotate, or persist any provider credential, database credential, preview token, or signing key.

## Outcome

R01-04 passed its zero-mutation gate, pushed the thirteen exact run-scoped images, and then failed closed because Blaxel returned 21-character immutable revisions that the authorization-bound candidate path did not accept. Exact teardown restored the target inventories before the local correction began. The complete result is recorded in [`FOUNDING-ALPHA-R01-04-FAILED-CLOSED.md`](./FOUNDING-ALPHA-R01-04-FAILED-CLOSED.md).

The correction is now merged without substituting any ABL implementation:

1. the existing candidate preparer and candidate provisioner share one launch-domain immutable-image schema;
2. the schema accepts an exact OCI `@sha256` digest, Blaxel's documented 12-character Sandbox revision, or the 21-hex revision observed live;
3. `latest`, operator tags, malformed lengths, and non-hex 21-character revisions remain rejected; and
4. the runbook requires sequential image pushes and an exact-name status, size, revision, and architecture readback before each next push.

The complete exact Node 24.18.0 pipeline passed after the correction. Two independent image-context generations reproduced the same thirteen-image set and byte-identical body archive. Two independent manifest renders remained byte-identical. The bounded private Founding Alpha envelope still fits the observed Blaxel and Neon state, and its conservative four-hour projection remains USD 6.00 against a USD 10.00 hard ceiling.

R01-04 is consumed and cannot be reused. No new provider mutation is authorized. A replacement `ABL-FOUNDING-ALPHA-R01-05` authorization must bind the merged evidence commit, this file's final digest, and every current binding below before the first mutation.

## Current repository and artifact bindings

| Binding                              | Current value                                                        |
| ------------------------------------ | -------------------------------------------------------------------- |
| Foundation baseline commit           | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Merged implementation release        | `5690cf18b3268071dc191f690618c2239b471373`                           |
| Packaging correction commit          | `7cb980a76f24af59aed790eabd8d7b21a9535539`                           |
| Execution-boundary correction commit | `548fae73464d18f921905d23446d2d5ebbd775a5`                           |
| Live-path correction commit          | `080e97a68a7cabda77becf62e24e779bf346fe1d`                           |
| R01-04 evidence baseline             | `94e58ba4f70935614cc6b7be1222ace4bc9d426e`                           |
| Immutable-revision correction commit | `436dd0fda41e05bab7096df0d8e84950bdc35863`                           |
| Current correction merge on `main`   | `7976c9477e8060f3045e23602d13b0e9acfc2bbd`                           |
| Implementation source                | `0xa4bc419dafa7f6e1cec25cf2b79848f892d7200b367ae89c4994212df64a05cf` |
| Implementation files                 | `433`                                                                |
| Launch plan                          | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result      | `0x634a83574414aeb51d408edca78bd7675fd0399512c502e7e566c59ac3a9d266` |
| Thirteen-image source set            | `0xd86825b5503e8c4fa142f59086ae1666639f94acb634b0848ed4610353a82c5f` |
| Rendered manifest set                | `0xe988196438afa80530d1f1d7d605f3ba445d0c15e5c3d8510d0bb53bdd4a3828` |
| Body-image source                    | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive                 | `0x43d9373baaa2bee8d0affe80aaa7e394d1c2af01f47102b66edfbeb2306d5569` |
| Private resource-plan file           | `0x9ac57ac77ce635512203960e618973773e3e6d32ea8f52c7f4a80d0c039eb758` |
| Drive-access file                    | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger                | `0x76500b91a0b4484998d5d51545c5ac1fc4f1a58eeacf895c93be778668962df1` |
| R01-04 failed-closed evidence file   | `0x369c6b62fd1068debe28e144e54a49648fe2e89275572bcf74d0bbf14af0879f` |
| Prior Preflight 06 file              | `0xcdd7e15394642b3c8802e24f147f4fe6c09d31161018376c54afb1fe2bf267f0` |

The exact-runtime pipeline passed 365 executable assertions across 78 test files and 113 uncached Turbo tasks. The loopback proof sent 22,000 requests with zero failures. Both browser targets and every production build passed.

## R01-04 binding drift

| Binding                    | Authorized R01-04                                                    | Current                                                              | Result       |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------ |
| Current merged `main`      | `94e58ba4f70935614cc6b7be1222ace4bc9d426e`                           | `7976c9477e8060f3045e23602d13b0e9acfc2bbd`                           | Invalidating |
| Implementation source      | `0x7d2225c11b0d6e93f1769c6613bea696fd6cf2bd8b455a23d01876280dd3e993` | `0xa4bc419dafa7f6e1cec25cf2b79848f892d7200b367ae89c4994212df64a05cf` | Invalidating |
| Exact-runtime result       | `0x7e14b3cfc056eb0426305b7b0b72f78c55606a76d89f2b40ecc6989e4a693912` | `0x634a83574414aeb51d408edca78bd7675fd0399512c502e7e566c59ac3a9d266` | Invalidating |
| Image set                  | `0x4165da91cba6abe18f50317aabc826635d62aefc724747f6349ac32084cb2e3b` | `0xd86825b5503e8c4fa142f59086ae1666639f94acb634b0848ed4610353a82c5f` | Invalidating |
| Private resource-plan file | `0x030198870e05b5a1684b5f2f7f4a8c02233e741827f558c15adab027b7054299` | `0x9ac57ac77ce635512203960e618973773e3e6d32ea8f52c7f4a80d0c039eb758` | Invalidating |
| Launch ledger              | `0xc8d004a1deeba88746630253e0640508dddb0afc1b07af3c1861c2842e747675` | `0x76500b91a0b4484998d5d51545c5ac1fc4f1a58eeacf895c93be778668962df1` | Invalidating |
| Launch plan                | `0x5bda34a5…318a4`                                                   | Same                                                                 | Match        |
| Manifest set               | `0xe9881964…3828`                                                    | Same                                                                 | Match        |
| Body-image source          | `0x93a1d11f…bf642`                                                   | Same                                                                 | Match        |
| Body-program archive       | `0x43d9373b…5569`                                                    | Same                                                                 | Match        |
| Drive-access file          | `0x732685da…956d3`                                                   | Same                                                                 | Match        |

The drift is the reviewed correction, not permission to resume R01-04. Replacement authority is required.

## Blaxel account and inventory

Authenticated Blaxel CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 18.54                                                    | USD 6.00 projected; USD 10 hard ceiling |
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

The `agent-basketball-league` workspace contains zero Sandboxes, Agent Drives, Blaxel Agents, Applications, Functions/MCP servers, Jobs, Volumes, policies, and integration connections. With zero Sandboxes, it also contains no Sandbox preview or preview token. It retains only the unrelated `sandbox-openai` model route and these seven historical image records:

- `abl-body-sandbox-image`
- `abl-stage-arena`
- `abl-stage-core-api`
- `abl-stage-fixed-broker`
- `abl-stage-player-body`
- `abl-stage-public-api`
- `abl-stage-storage-broker`

No `abl-alpha-r01-*` resource and no `abl-career-0198e000000070008000000000000001` Sandbox exists. The image API reports seven historical records while the quota console reports zero image usage. This unchanged provider-reporting discrepancy remains covered by the cost buffer and exact-name teardown boundary.

## Region, Drive ACL, preview, and image-reference support

Blaxel's current [region documentation](https://docs.blaxel.ai/Infrastructure/Regions) lists `us-was-1` as North Virginia and an available Sandbox region. [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview) remains a private-preview feature available only in `us-was-1`; the Drive and mounted Sandboxes must use that region. The authenticated workspace exposes an empty Drive inventory, confirming continued access to its management surface.

Current [Drive permission documentation](https://docs.blaxel.ai/Agent-drive/Permissions) defines label-based, server-enforced access for mounts and direct HTTP API calls. A rule binds workload labels, `read` or `read-write` mode, and a path; unmatched workloads are denied; and a Drive supports at most three rules. The reviewed Founding Alpha Drive defines exactly three label/path rules. A live run must still read the exact rules back and prove matching, mismatching, mounted, direct-API, and cross-path outcomes. Stored configuration alone is not acceptance evidence.

Current [Sandbox preview documentation](https://docs.blaxel.ai/Sandboxes/Preview-url) supports `public:false` previews and requires a token through either a `bl_preview_token` query parameter or `X-Blaxel-Preview-Token` header. The run requires the header form and exact `public:false` readback before use.

The candidate path accepts only the exact provider-generated immutable revision read back after a reviewed image build, or an OCI `@sha256` digest. The replacement run must push and read back one image at a time. It may not use `latest`, shorten a revision, invent a digest, or infer that a revision returned for one image belongs to another.

## Neon organization and capacity

The authenticated `Michael` organization remains on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. Current [Neon pricing](https://neon.com/pricing) includes 100 projects on the Free plan, so the organization uses 1 of 100 project slots and has capacity for the single temporary PostgreSQL 17 project. The temporary project remains projected at USD 0 if the proof stays within Free-plan allowances.

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

USD 6.00 remains below the USD 10.00 hard ceiling and the current USD 18.54 balance. The estimate is conservative because it treats every declared compute resource as active for the entire four hours.

## Next gate

Do not mutate under R01-04 or any earlier authorization. After this preflight is merged, obtain one fresh `ABL-FOUNDING-ALPHA-R01-05` authorization that:

1. binds the resulting merged evidence commit, this Preflight 07 file digest, the R01-04 result file digest, and every current digest in this record;
2. binds synthetic application UUID `0198e000-0000-7000-8000-000000000001` and exact provisioner-derived body name `abl-career-0198e000000070008000000000000001`;
3. retains the exact resource names, Drive permissions and mounts, USD 5.00 minimum balance, USD 6.00 projection, four-hour limit, USD 10.00 hard ceiling, prohibitions, evidence export, and exact-name teardown terms;
4. requires sequential image push/readback before Neon or workload creation;
5. requires the fixed-broker-first, live-challenge, existing-candidate-provisioner flow rather than any manually constructed career body;
6. requires an immediate pre-mutation recheck of every repository, artifact, runtime, provider, inventory, privacy, capacity, payment, top-up, ACL, and cost binding; and
7. states that any subsequent relevant drift invalidates R01-05 before mutation.
