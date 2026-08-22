# Founding Alpha execution-boundary preflight

> Status: `READ_ONLY_COMPLETE_R01_04_AUTHORIZATION_REQUIRED`
> Recorded: `2026-08-22T16:14:18-07:00` in `America/Vancouver`
> Invalidated authorization: `ABL-FOUNDING-ALPHA-R01-03` (unconsumed; cannot be reused)
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon resource and did not reveal, copy, rotate, or persist any provider credential, database credential, preview token, or signing key.

## Outcome

The two contradictions that invalidated R01-03 are corrected on merged `main`:

1. The existing candidate provisioner now accepts either an OCI `@sha256` digest or Blaxel's provider-generated immutable `sandbox/<image-name>:<12-character-revision>` reference. Mutable and operator-selected tags remain rejected.
2. Public rehearsal collections, cursor responses, segments, SSE events, and arena rendering now remain explicitly `PRE_GENESIS_EXPERIMENT` and noncanonical. Stored local projection invariants remain unchanged, and the public server owns the normalized history and recognition classification.

The complete exact Node 24.18.0 pipeline passed after the final review correction. Independent image generation reproduced the same thirteen-image set twice, independent manifest rendering reproduced the same manifest set twice, and the reviewed body archive remained byte-identical.

The bounded private Founding Alpha envelope still fits the observed Blaxel and Neon state. Its conservative four-hour projection remains USD 6.00 against a USD 10.00 hard ceiling. A replacement R01-04 authorization must bind the resulting evidence commit, this file's digest, and every current artifact binding before the first provider mutation.

## Current repository and artifact bindings

| Binding                              | Current value                                                        |
| ------------------------------------ | -------------------------------------------------------------------- |
| Foundation baseline commit           | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Merged implementation release        | `5690cf18b3268071dc191f690618c2239b471373`                           |
| Packaging correction commit          | `7cb980a76f24af59aed790eabd8d7b21a9535539`                           |
| Prior merged evidence commit         | `422da420563532045b48061867e8c459f86f5a13`                           |
| Execution-boundary correction commit | `548fae73464d18f921905d23446d2d5ebbd775a5`                           |
| Implementation source                | `0x0861fdf09bc8c97a0499ddd6f191144673162702074936277780f0f9d87f4655` |
| Implementation files                 | `429`                                                                |
| Launch plan                          | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result      | `0x04b2ea099dc44dce30ca0888fe895a31d573a710231a7a755ddcc0d36fb46fe4` |
| Thirteen-image source set            | `0x9072d771bb75ebfb0181334179caa89608f84bfb553c478fc9ebc31bcf32660a` |
| Rendered manifest set                | `0x31598bba8e517d0d43fd23f385833cb3a701034ec02656a35dc81a6bb15b6013` |
| Body-image source                    | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive                 | `0x6bf97a5d0e0652ffa40a3b4277dca925c010eab9979d6144fd0e4eea39609557` |
| Private resource-plan file           | `0x4bfb188cffb803a6e13f2fb3dc1421302dfe3ea16a97c0d548566c3e4faf479a` |
| Drive-access file                    | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger                | `0xdd66dc98c811c3ef0d278cf897554745767492398053f679b95b2e85b1956e7a` |
| R01-03 failed-closed record          | `0x55857c82661852979d48ac85de46d7bf5c0e64cf06ee7c2db3072da13fa35faa` |
| Prior Preflight 04 file              | `0x877dae19a1eea1662a9bc7ef6d88d6aafad813d055e27f969dbd3920f1cf428b` |

The exact-runtime pipeline passed 357 assertions across 76 test files and 113 uncached Turbo tasks. The loopback proof sent 22,000 requests with zero failures. Both browser targets and every production build passed. The stable result digest remained unchanged after the final recognition-classification ownership correction.

## Drift from Preflight 04

| Binding                       | Preflight 04                                                         | Current                                                              | Result            |
| ----------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------- |
| Parent/correction main commit | `28fab07f49894842f47ad38f81bd908452f2c103`                           | `548fae73464d18f921905d23446d2d5ebbd775a5`                           | Expected merge    |
| Implementation source         | `0xa0c3e775903decbe7f2b1b0ba07220ccf86d09d6bae8c9bdba3e439640f1a410` | `0x0861fdf09bc8c97a0499ddd6f191144673162702074936277780f0f9d87f4655` | Expected drift    |
| Exact-runtime result          | `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5` | `0x04b2ea099dc44dce30ca0888fe895a31d573a710231a7a755ddcc0d36fb46fe4` | Expected drift    |
| Image set                     | `0xdcca250c22f294cd665a31d2626cf00a5d035ff46a311074195a48cbeb8eb72f` | `0x9072d771bb75ebfb0181334179caa89608f84bfb553c478fc9ebc31bcf32660a` | Expected drift    |
| Manifest set                  | `0xdad4a11e444cacf1b99fcb5f56ae57dffac59e5d5878669588712b60c3a81086` | `0x31598bba8e517d0d43fd23f385833cb3a701034ec02656a35dc81a6bb15b6013` | Expected drift    |
| Private resource-plan file    | `0x7017c3dff89dd214834644b3bf2444cd770aa795ce14dc6699bfa16111280a6f` | `0x4bfb188cffb803a6e13f2fb3dc1421302dfe3ea16a97c0d548566c3e4faf479a` | Expected drift    |
| Launch ledger                 | `0xb57b83937bc32a07e2a8eb5d559e47beae9a7dd15ed715b09d22907c01f95d44` | `0xdd66dc98c811c3ef0d278cf897554745767492398053f679b95b2e85b1956e7a` | Expected drift    |
| Credit balance                | USD 19.07                                                            | USD 18.91                                                            | Ordinary movement |
| Launch plan                   | `0x5bda34a5…318a4`                                                   | Same                                                                 | Match             |
| Body-image source             | `0x93a1d11f…bf642`                                                   | Same                                                                 | Match             |
| Body-program archive          | `0x6bf97a5d…9557`                                                    | Same                                                                 | Match             |
| Drive-access file             | `0x732685da…956d3`                                                   | Same                                                                 | Match             |

The source and artifact drift invalidates R01-03 independently of its recorded runtime contradictions. The ordinary balance movement remains above the USD 5.00 minimum and does not alter the USD 6.00 projection, but it must be rechecked immediately before any replacement authorization is consumed.

## Blaxel account and inventory

Authenticated Blaxel CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 18.91                                                    | USD 6.00 projected; USD 10 hard ceiling |
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

The `agent-basketball-league` workspace contains zero Sandboxes, Agent Drives, Blaxel Agents, Applications, Functions/MCP servers, Jobs, Volumes, policies, and integration connections. It therefore contains no Sandbox previews or preview tokens. It retains only the unrelated `sandbox-openai` model route and the same seven historical image records.

The image API reports those seven records at 3,392,356,352 bytes total while the quota console reports zero image usage. This existing provider-reporting discrepancy remains covered by the cost buffer and the exact-name teardown boundary. No `abl-alpha-r01-*` resource and no `abl-career-0198e000000070008000000000000001` Sandbox exists.

## Region, Drive, preview, and image-reference support

Current Blaxel documentation lists `us-was-1` as North Virginia and an available Sandbox region. Agent Drive remains a private-preview feature available only in `us-was-1`; both a Drive and its mounted Sandbox must use that region. The authenticated workspace exposes an empty Agent Drive inventory, confirming continued management-surface availability. [Regions](https://docs.blaxel.ai/Infrastructure/Regions), [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview)

Private Sandbox previews still support `public:false` and require a preview token supplied through either the query parameter or `X-Blaxel-Preview-Token` header. The run requires the header form and must read every preview back as private before use. [Private previews](https://docs.blaxel.ai/Sandboxes/Preview-url)

The authenticated image readback continues to represent custom Sandbox images as provider-managed `sandbox/<name>` records. The corrected provisioner accepts the immutable provider revision returned after a reviewed image build but rejects `latest` and every non-revision operator tag.

## Neon organization and capacity

The authenticated `Michael` organization remains on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. The current Free plan permits 100 projects; the organization uses one, so one new empty temporary PostgreSQL 17 project remains within current capacity. The temporary project is projected at USD 0 if the proof stays within Free-plan allowances. [Neon pricing](https://neon.com/pricing)

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

USD 6.00 remains below the USD 10.00 hard ceiling and current USD 18.91 balance. The estimate is conservative because it treats every declared compute resource as active for the entire four hours.

## Next gate

Do not mutate under R01-03 or any superseded R01-04 draft. After this preflight is merged, obtain a fresh `ABL-FOUNDING-ALPHA-R01-04` authorization that:

1. binds the resulting merged evidence commit, this preflight file digest, and every current digest in this record;
2. binds synthetic application UUID `0198e000-0000-7000-8000-000000000001` and exact provisioner-derived body name `abl-career-0198e000000070008000000000000001`;
3. retains the exact resource names, Drive permissions and mounts, USD 5.00 minimum balance, USD 6.00 projection, four-hour limit, USD 10.00 hard ceiling, prohibitions, evidence export, and exact-name teardown terms;
4. requires an immediate pre-mutation recheck of every repository, artifact, runtime, provider, inventory, privacy, capacity, payment, top-up, and cost binding; and
5. states that any subsequent relevant drift invalidates R01-04 before mutation.
