# Founding Alpha live-path preflight

> Status: `READ_ONLY_COMPLETE_R01_04_AUTHORIZATION_REQUIRED`
> Recorded: `2026-08-22T17:11:16-07:00` in `America/Vancouver`
> Invalid authorization text: `ABL-FOUNDING-ALPHA-R01-03` replacement supplied after R01-03 had already failed closed (unconsumed; cannot be reused)
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon resource and did not reveal, copy, rotate, or persist any provider credential, database credential, preview token, or signing key.

## Outcome

The supplied replacement R01-03 text cannot be consumed. Its own drift clause invalidates it because it binds the pre-live-path-correction commit and artifact set. R01-03 had also already been recorded as failed closed and non-reusable before the replacement text was supplied.

The current merged implementation closes the remaining locally discoverable live-path gaps without substituting any ABL implementation:

1. every declared Sandbox and provisioner-created career body uses an absolute four-hour `ttl-max-age` lifecycle rather than an idle timeout;
2. the fixed broker is created before the existing candidate provisioner is invoked for the exact synthetic application, and the provisioner derives the exact authorized career-body name;
3. the candidate-provisioner Job reaches the durable candidate-store origin directly, while the public candidate Function remains the stateless intake edge;
4. the storage broker receives its bootstrap through a Blaxel-managed secret rather than a pre-start file upload;
5. body commands use a fresh timestamp and the core API rejects commands outside the sixty-second freshness window; and
6. the synthetic candidate preparation flow generates its own candidate keys, consumes the live challenge, signs and encrypts the existing candidate commands, binds the correct PLAYER offer, and writes secret-bearing artifacts only to a new mode-`0700` directory outside the repository.

The complete exact Node 24.18.0 pipeline passed twice after the final correction. Independent image generation reproduced the same thirteen-image set twice, independent manifest rendering reproduced the same manifest set twice, and the reviewed body archive remained byte-identical.

The bounded private Founding Alpha envelope still fits the observed Blaxel and Neon state. Its conservative four-hour projection remains USD 6.00 against a USD 10.00 hard ceiling. A fresh R01-04 authorization must bind the resulting evidence commit, this file's digest, and every current artifact binding before the first provider mutation.

## Current repository and artifact bindings

| Binding                         | Current value                                                        |
| ------------------------------- | -------------------------------------------------------------------- |
| Foundation baseline commit      | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Merged implementation release   | `5690cf18b3268071dc191f690618c2239b471373`                           |
| Packaging correction commit     | `7cb980a76f24af59aed790eabd8d7b21a9535539`                           |
| Prior merged evidence commit    | `422da420563532045b48061867e8c459f86f5a13`                           |
| Execution-boundary correction   | `548fae73464d18f921905d23446d2d5ebbd775a5`                           |
| Preflight 05 merged evidence    | `2f4d233`                                                            |
| Live-path correction head       | `080e97a68a7cabda77becf62e24e779bf346fe1d`                           |
| Current merged `main`           | `e38768218fe968e41e7c04f8749cec6107ec7676`                           |
| Implementation source           | `0x7d2225c11b0d6e93f1769c6613bea696fd6cf2bd8b455a23d01876280dd3e993` |
| Implementation files            | `431`                                                                |
| Launch plan                     | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result | `0x7e14b3cfc056eb0426305b7b0b72f78c55606a76d89f2b40ecc6989e4a693912` |
| Thirteen-image source set       | `0x4165da91cba6abe18f50317aabc826635d62aefc724747f6349ac32084cb2e3b` |
| Rendered manifest set           | `0xe988196438afa80530d1f1d7d605f3ba445d0c15e5c3d8510d0bb53bdd4a3828` |
| Body-image source               | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive            | `0x43d9373baaa2bee8d0affe80aaa7e394d1c2af01f47102b66edfbeb2306d5569` |
| Private resource-plan file      | `0x030198870e05b5a1684b5f2f7f4a8c02233e741827f558c15adab027b7054299` |
| Drive-access file               | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger           | `0xc8d004a1deeba88746630253e0640508dddb0afc1b07af3c1861c2842e747675` |
| Prior Preflight 05 file         | `0x7505d22c9d391530d27a35408626f2271eea88d71a509358015271d1df694de0` |

The exact-runtime pipeline passed 358 executable assertions across 77 test files and 113 uncached Turbo tasks. The loopback proof sent 22,000 requests with zero failures. Both browser targets and every production build passed.

## Drift from the supplied replacement R01-03 text

| Binding                    | Supplied R01-03                                                      | Current                                                              | Result        |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------- |
| Current merged main        | `422da420563532045b48061867e8c459f86f5a13`                           | `e38768218fe968e41e7c04f8749cec6107ec7676`                           | Invalidating  |
| Implementation source      | `0xa0c3e775903decbe7f2b1b0ba07220ccf86d09d6bae8c9bdba3e439640f1a410` | `0x7d2225c11b0d6e93f1769c6613bea696fd6cf2bd8b455a23d01876280dd3e993` | Invalidating  |
| Exact-runtime result       | `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5` | `0x7e14b3cfc056eb0426305b7b0b72f78c55606a76d89f2b40ecc6989e4a693912` | Invalidating  |
| Image set                  | `0xdcca250c22f294cd665a31d2626cf00a5d035ff46a311074195a48cbeb8eb72f` | `0x4165da91cba6abe18f50317aabc826635d62aefc724747f6349ac32084cb2e3b` | Invalidating  |
| Manifest set               | `0xdad4a11e444cacf1b99fcb5f56ae57dffac59e5d5878669588712b60c3a81086` | `0xe988196438afa80530d1f1d7d605f3ba445d0c15e5c3d8510d0bb53bdd4a3828` | Invalidating  |
| Body-program archive       | `0x6bf97a5d0e0652ffa40a3b4277dca925c010eab9979d6144fd0e4eea39609557` | `0x43d9373baaa2bee8d0affe80aaa7e394d1c2af01f47102b66edfbeb2306d5569` | Invalidating  |
| Private resource-plan file | `0x7017c3dff89dd214834644b3bf2444cd770aa795ce14dc6699bfa16111280a6f` | `0x030198870e05b5a1684b5f2f7f4a8c02233e741827f558c15adab027b7054299` | Invalidating  |
| Launch ledger              | `0xb57b83937bc32a07e2a8eb5d559e47beae9a7dd15ed715b09d22907c01f95d44` | `0xc8d004a1deeba88746630253e0640508dddb0afc1b07af3c1861c2842e747675` | Invalidating  |
| Launch plan                | `0x5bda34a5…318a4`                                                   | Same                                                                 | Match         |
| Body-image source          | `0x93a1d11f…bf642`                                                   | Same                                                                 | Match         |
| Drive-access file          | `0x732685da…956d3`                                                   | Same                                                                 | Match         |
| Credit balance             | At least USD 5.00                                                    | USD 18.80                                                            | Within policy |

The supplied text therefore invalidated itself before mutation. The ordinary balance movement remains above the USD 5.00 minimum and does not alter the USD 6.00 projection, but it must be rechecked immediately before any replacement authorization is consumed.

## Blaxel account and inventory

Authenticated Blaxel CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 18.80                                                    | USD 6.00 projected; USD 10 hard ceiling |
| Automatic top-up            | Unconfigured/off; account requires adding a payment method   | Must remain off                         |
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

The `agent-basketball-league` workspace contains zero Sandboxes, Agent Drives, Blaxel Agents, Applications, Functions/MCP servers, Jobs, Volumes, policies, and integration connections. It therefore contains no Sandbox preview or preview token. It retains only the unrelated `sandbox-openai` model route and the same seven historical image records.

The image API reports those seven records while the quota console reports zero image usage. This existing provider-reporting discrepancy remains covered by the cost buffer and the exact-name teardown boundary. No `abl-alpha-r01-*` resource and no `abl-career-0198e000000070008000000000000001` Sandbox exists.

## Region, Drive ACL, preview, and image-reference support

Current Blaxel documentation lists `us-was-1` as North Virginia and an available Sandbox region. Agent Drive remains a private-preview feature available only in `us-was-1`; both a Drive and its mounted Sandbox must use that region. The authenticated workspace exposes an empty Agent Drive inventory, confirming continued management-surface availability. [Regions](https://docs.blaxel.ai/Infrastructure/Regions), [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview)

Current Agent Drive documentation explicitly defines label-based, server-enforced permissions for mounts and direct HTTP API access. A rule can bind a workload's labels, `read` or `read-write` mode, and a path. An unmatched workload is denied, and a drive supports at most three rules. The reviewed Founding Alpha Drive defines exactly three label/path rules. The installed `@blaxel/core` `0.3.13` SDK exposes the same `permissions` field on create, get, and update. The run must still read the exact rules back and prove the authorized match, mismatch, path, and direct-access outcomes live; a stored configuration alone is not acceptance evidence. [Drive permissions](https://docs.blaxel.ai/Agent-drive/Permissions)

Private Sandbox previews still support `public:false` and require a preview token supplied through either the query parameter or `X-Blaxel-Preview-Token` header. The run requires the header form and must read every preview back as private before use. [Private previews](https://docs.blaxel.ai/Sandboxes/Preview-url)

The authenticated image readback continues to represent custom Sandbox images as provider-managed `sandbox/<name>` records. The provisioner accepts only the immutable provider revision returned after a reviewed image build or an OCI `@sha256` digest; it rejects `latest` and every non-revision operator tag.

## Neon organization and capacity

The authenticated `Michael` organization remains on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. The console's new-project control remains enabled, so one new empty temporary PostgreSQL 17 project remains within current capacity. The temporary project is projected at USD 0 if the proof stays within Free-plan allowances. [Neon pricing](https://neon.com/pricing)

## Current four-hour projection

Current published rates remain USD 0.0000115 per GiB-second for active Sandbox memory, USD 0.000007 per GiB-second for MCP compute, USD 0.000006 per GiB-second for Job compute, USD 0.045 per GiB-month for images, and USD 0.20 per GiB-month for Sandbox snapshots. Agent Drive data and operations remain free during beta. [Blaxel pricing](https://blaxel.ai/pricing)

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

USD 6.00 remains below the USD 10.00 hard ceiling and current USD 18.80 balance. The estimate is conservative because it treats every declared compute resource as active for the entire four hours.

## Next gate

Do not mutate under R01-03 or any superseded R01-04 draft. After this preflight is merged, obtain one fresh `ABL-FOUNDING-ALPHA-R01-04` authorization that:

1. binds the resulting merged evidence commit, this Preflight 06 file digest, and every current digest in this record;
2. binds synthetic application UUID `0198e000-0000-7000-8000-000000000001` and exact provisioner-derived body name `abl-career-0198e000000070008000000000000001`;
3. retains the exact resource names, Drive permissions and mounts, USD 5.00 minimum balance, USD 6.00 projection, four-hour limit, USD 10.00 hard ceiling, prohibitions, evidence export, and exact-name teardown terms;
4. requires the fixed-broker-first, live-challenge, existing-candidate-provisioner flow rather than any manually constructed career body;
5. requires an immediate pre-mutation recheck of every repository, artifact, runtime, provider, inventory, privacy, capacity, payment, top-up, ACL, and cost binding; and
6. states that any subsequent relevant drift invalidates R01-04 before mutation.
