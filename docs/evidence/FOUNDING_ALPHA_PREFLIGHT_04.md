# Founding Alpha name-contract preflight

> Status: `READ_ONLY_COMPLETE_REPLACEMENT_AUTHORIZATION_REQUIRED`
> Recorded: `2026-08-22T14:50:59-07:00` in `America/Vancouver`
> Prior authorization: `ABL-FOUNDING-ALPHA-R01-02` (invalidated; cannot be reused)
> Superseded draft: proposed `ABL-FOUNDING-ALPHA-R01-03` text (unconsumed; must not be used)
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon resource and did not reveal, copy, rotate, or persist any provider credential, database credential, preview token, or signing key.

## Outcome

The pre-mutation tooling audit found one additional local inconsistency before any provider action: the private resource plan authorized the synthetic body name `abl-alpha-r01-career-body-001`, while the existing candidate provisioner deterministically derives `abl-career-<application-id-without-hyphens>`. The exact resource envelope and the real candidate-provisioning path therefore could not both have been satisfied.

The correction preserves the existing candidate provisioner. It freezes synthetic application UUID `0198e000-0000-7000-8000-000000000001`, derives the exact body name `abl-career-0198e000000070008000000000000001`, and asserts that binding in the topology suite and private-run packet. The complete exact Node 24.18.0 evidence pipeline passed again after the correction.

The bounded private Founding Alpha envelope still fits the observed Blaxel and Neon state. Its conservative four-hour projection remains USD 6.00 against a USD 10.00 hard ceiling. No existing or proposed authorization may be consumed until this correction is merged and a new authorization binds the resulting main commit, this preflight, and every current digest below.

## Current repository and artifact bindings

| Binding                         | Current value                                                        |
| ------------------------------- | -------------------------------------------------------------------- |
| Foundation baseline commit      | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Merged implementation release   | `5690cf18b3268071dc191f690618c2239b471373`                           |
| Packaging correction commit     | `7cb980a76f24af59aed790eabd8d7b21a9535539`                           |
| Parent main commit              | `28fab07f49894842f47ad38f81bd908452f2c103`                           |
| Implementation source           | `0xa0c3e775903decbe7f2b1b0ba07220ccf86d09d6bae8c9bdba3e439640f1a410` |
| Implementation files            | `428`                                                                |
| Launch plan                     | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result | `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5` |
| Thirteen-image source set       | `0xdcca250c22f294cd665a31d2626cf00a5d035ff46a311074195a48cbeb8eb72f` |
| Rendered manifest set           | `0xdad4a11e444cacf1b99fcb5f56ae57dffac59e5d5878669588712b60c3a81086` |
| Body-image source               | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive            | `0x6bf97a5d0e0652ffa40a3b4277dca925c010eab9979d6144fd0e4eea39609557` |
| Private resource-plan file      | `0x7017c3dff89dd214834644b3bf2444cd770aa795ce14dc6699bfa16111280a6f` |
| Drive-access file               | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger           | `0xb57b83937bc32a07e2a8eb5d559e47beae9a7dd15ed715b09d22907c01f95d44` |

The exact-runtime pipeline passed 354 assertions across 75 test files and 113 uncached Turbo tasks. The focused topology and candidate-provisioner rerun passed 24 assertions. The source, manifest, resource-plan, and launch-ledger bindings changed only because the deterministic synthetic-body contract became part of the implementation freeze; the image set and reviewed body archive did not change.

## Name-contract correction

| Contract item               | Corrected exact value                                |
| --------------------------- | ---------------------------------------------------- |
| Synthetic application UUID  | `0198e000-0000-7000-8000-000000000001`               |
| Provisioner-derived body    | `abl-career-0198e000000070008000000000000001`        |
| Provisioner naming function | `abl-career-<application UUID without hyphens>`      |
| Body Drive mount            | None                                                 |
| Runtime resource type       | Blaxel Sandbox; never a Blaxel Agent                 |
| Teardown target             | The exact derived body name above; no name inference |

The fixed UUID is synthetic and run-scoped. It does not create a career, reserve a seat, make an admission decision, or grant canonical status. The live proof must create the fixed broker first and then invoke the existing candidate provisioner for this application ID so the provisioner itself produces the authorized body name.

## Drift from Preflight 03

| Binding                    | Preflight 03                                                         | Current                                                              | Result            |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------- |
| Implementation source      | `0x5da38ce9f97ffbd101179e9c3f84a860ee31e66dd9e44cfedc8b32ea48c40cf4` | `0xa0c3e775903decbe7f2b1b0ba07220ccf86d09d6bae8c9bdba3e439640f1a410` | Drift             |
| Rendered manifest set      | `0xe53d58cea4490fc3090132fad6bf8634b02d2b0fd65398cb8c55f8b645a792f7` | `0xdad4a11e444cacf1b99fcb5f56ae57dffac59e5d5878669588712b60c3a81086` | Drift             |
| Private resource-plan file | `0x17ae19aa2122bdd631758c00556179d165613de01b5a7bda409d25a9a414ef08` | `0x7017c3dff89dd214834644b3bf2444cd770aa795ce14dc6699bfa16111280a6f` | Drift             |
| Launch ledger              | `0xb8839479d92d85975eb7a690766b23b043132de3a8a82d12ce4cf0004c658450` | `0xb57b83937bc32a07e2a8eb5d559e47beae9a7dd15ed715b09d22907c01f95d44` | Drift             |
| Credit balance             | USD 19.16                                                            | USD 19.07                                                            | Ordinary movement |
| Launch plan                | `0x5bda34a5…318a4`                                                   | Same                                                                 | Match             |
| Exact-runtime result       | `0xd7801310…addd5`                                                   | Same                                                                 | Match             |
| Image set                  | `0xdcca250c…b72f`                                                    | Same                                                                 | Match             |
| Body-image source          | `0x93a1d11f…bf642`                                                   | Same                                                                 | Match             |
| Body-program archive       | `0x6bf97a5d…9557`                                                    | Same                                                                 | Match             |
| Drive-access file          | `0x732685da…956d3`                                                   | Same                                                                 | Match             |

The source and resource drift invalidates every earlier digest-bound authorization or draft before mutation. The ordinary balance movement remains above the USD 5.00 minimum but must be rechecked immediately before any newly authorized mutation.

## Blaxel account and inventory

Authenticated Blaxel CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 19.07                                                    | USD 6.00 projected; USD 10 hard ceiling |
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

The `agent-basketball-league` workspace contains zero Sandboxes, Agent Drives, Blaxel Agents, Applications, Functions/MCP servers, Jobs, Volumes, policies, and integration connections. Because it contains no Sandboxes, it also contains no Sandbox previews or preview tokens. It retains only the unrelated `sandbox-openai` model route and seven historical image records. The image API reports those records at 3,392,356,352 bytes total while the quota console reports zero image usage; the provider-reporting discrepancy remains covered by the cost buffer and resource-specific teardown rule.

No `abl-alpha-r01-*` resource and no `abl-career-0198e000000070008000000000000001` Sandbox exists.

## Region, Drive, and preview support

Current Blaxel documentation lists `us-was-1` as North Virginia and an available Sandbox region. Agent Drive remains a private-preview feature available only in `us-was-1`, and a Drive and its mounted Sandbox must use that region. The authenticated workspace exposes the empty Agent Drive inventory, confirming that the management surface remains available. [Regions](https://docs.blaxel.ai/Infrastructure/Regions), [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview)

Private Sandbox previews support `public:false` and require a preview token supplied through either the query parameter or `X-Blaxel-Preview-Token` header. The run requires the header form and must read every preview back as private before use. [Private previews](https://docs.blaxel.ai/Sandboxes/Preview-url)

## Neon organization and capacity

The authenticated `Michael` organization remains on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. The existing project count remains within the visible Free-plan capacity for one new empty temporary PostgreSQL 17 project. The temporary project is projected at USD 0 if the proof remains within the plan allowances. [Neon pricing](https://neon.com/pricing)

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

USD 6.00 remains below the USD 10.00 hard ceiling and current USD 19.07 balance. The estimate is conservative because it treats every declared compute resource as active for the entire four hours.

## Next gate

Do not mutate under `ABL-FOUNDING-ALPHA-R01-02` or the superseded proposed R01-03 text. After this correction and preflight are merged, obtain a fresh authorization that:

1. binds the resulting merged main commit, this preflight file digest, and every current digest in this record;
2. binds the synthetic application UUID and exact provisioner-derived body name;
3. retains the exact resource envelope, USD 5.00 minimum balance, USD 6.00 projection, four-hour limit, USD 10.00 hard ceiling, prohibitions, evidence export, and resource-specific teardown terms;
4. requires an immediate pre-mutation recheck of all repository and provider bindings; and
5. states that any subsequent repository, runtime, quota, region, feature, privacy, inventory, payment, top-up, image-metering, Neon-capacity, or projected-cost drift invalidates the replacement before mutation.
