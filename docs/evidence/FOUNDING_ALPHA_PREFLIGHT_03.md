# Founding Alpha post-correction preflight

> Status: `READ_ONLY_COMPLETE_REPLACEMENT_AUTHORIZATION_REQUIRED`
> Recorded: `2026-08-22T14:33:27-07:00` in `America/Vancouver`
> Prior authorization: `ABL-FOUNDING-ALPHA-R01-02` (invalidated; cannot be reused)
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon resource and did not reveal, copy, rotate, or persist any provider credential, database credential, preview token, or signing key.

## Outcome

The path-independent packaging correction is merged and locally verified. The requested private Founding Alpha envelope still fits the observed Blaxel and Neon state, and its conservative four-hour projection remains USD 6.00 against a USD 10.00 hard ceiling.

`ABL-FOUNDING-ALPHA-R01-02` cannot authorize a mutation because its main commit, implementation-source, image-set, body-archive, resource-plan, and launch-ledger bindings precede the correction. A replacement authorization must bind the merged preflight evidence and the current values below. Every mutable provider fact must then be checked again immediately before the first mutation.

## Current repository and artifact bindings

| Binding                         | Current value                                                        |
| ------------------------------- | -------------------------------------------------------------------- |
| Foundation baseline commit      | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Merged implementation release   | `5690cf18b3268071dc191f690618c2239b471373`                           |
| Packaging correction commit     | `7cb980a76f24af59aed790eabd8d7b21a9535539`                           |
| Preflight source main commit    | `004412465d5f19a12d59d74b31f45d38eaa99414`                           |
| Implementation source           | `0x5da38ce9f97ffbd101179e9c3f84a860ee31e66dd9e44cfedc8b32ea48c40cf4` |
| Implementation files            | `428`                                                                |
| Launch plan                     | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result | `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5` |
| Thirteen-image source set       | `0xdcca250c22f294cd665a31d2626cf00a5d035ff46a311074195a48cbeb8eb72f` |
| Rendered manifest set           | `0xe53d58cea4490fc3090132fad6bf8634b02d2b0fd65398cb8c55f8b645a792f7` |
| Body-image source               | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive            | `0x6bf97a5d0e0652ffa40a3b4277dca925c010eab9979d6144fd0e4eea39609557` |
| Private resource-plan file      | `0x17ae19aa2122bdd631758c00556179d165613de01b5a7bda409d25a9a414ef08` |
| Drive-access file               | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger           | `0xb8839479d92d85975eb7a690766b23b043132de3a8a82d12ce4cf0004c658450` |

The complete exact-runtime pipeline passed 354 assertions across 75 test files and 113 uncached Turbo tasks. Independent image generation beneath `/tmp` and `/private/tmp` produced the same thirteen image-source digests and byte-identical body archives.

## Prior-authorization drift

| Binding                    | R01-02 value                                                         | Current                                                              | Result             |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| Current main evidence      | `024bb66d00481ad2aa2d014f775facd0c48fc826`                           | `004412465d5f19a12d59d74b31f45d38eaa99414`                           | Replacement needed |
| Implementation source      | `0x0dc96e69d12042effa21aa2d044c962737474174d797e8511c1c39560e879c38` | `0x5da38ce9f97ffbd101179e9c3f84a860ee31e66dd9e44cfedc8b32ea48c40cf4` | Drift              |
| Image set                  | `0x2a49f2ead328fc3fe39979ede40b701d74a7428807e369e98345f14e8f16a9e6` | `0xdcca250c22f294cd665a31d2626cf00a5d035ff46a311074195a48cbeb8eb72f` | Drift              |
| Body-program archive       | `0x5142588fa09bb4036e2ab08eb656cdb03960593873816fc9b11026c9d8f162ef` | `0x6bf97a5d0e0652ffa40a3b4277dca925c010eab9979d6144fd0e4eea39609557` | Drift              |
| Private resource-plan file | `0x3d11c65f7ea4175be0cd885a9914dda89cb57c305af57c5c11de417840cfed5f` | `0x17ae19aa2122bdd631758c00556179d165613de01b5a7bda409d25a9a414ef08` | Drift              |
| Launch ledger              | `0x5d006f4b4e71f3560f066c2a82ee2de74b70e47871e5650f3a1c745eee33f1a3` | `0xb8839479d92d85975eb7a690766b23b043132de3a8a82d12ce4cf0004c658450` | Drift              |
| Launch plan                | `0x5bda34a5…318a4`                                                   | Same                                                                 | Match              |
| Exact-runtime result       | `0xd7801310…addd5`                                                   | Same                                                                 | Match              |
| Manifest set               | `0xe53d58ce…92f7`                                                    | Same                                                                 | Match              |
| Body-image source          | `0x93a1d11f…bf642`                                                   | Same                                                                 | Match              |
| Drive-access file          | `0x732685da…956d3`                                                   | Same                                                                 | Match              |

## Blaxel account and inventory

Authenticated Blaxel CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 19.16                                                    | USD 6.00 projected; USD 10 hard ceiling |
| Automatic top-up            | Unconfigured/off; account requires adding a payment method   | Must remain off                         |
| Payment method              | None configured; console offers `Add payment method`         | Add none                                |
| Low-balance alert           | Enabled at USD 5.00                                          | No change                               |
| Tier                        | 6                                                            | No change                               |
| Sandboxes                   | 3 of 10,000 account-wide; 2,000 concurrent allowed           | 7 new                                   |
| Preview URLs                | 20,000 allowed                                               | 6 private previews                      |
| Maximum memory per instance | 32,768 MiB                                                   | 4,096 MiB maximum                       |
| MCP servers                 | 0 of 500 account-wide                                        | 5 new                                   |
| Jobs                        | 4 of 500 account-wide; 786,432 MiB concurrent memory allowed | 1 new at 2,048 MiB                      |
| Sandbox snapshots           | 20,000 allowed                                               | At most 7 transiently                   |
| Image meter                 | 0 of 10,485,760 MiB reported                                 | 13 new run-scoped records               |
| Policies                    | 2 of 20 account-wide                                         | 0 new                                   |
| Workspaces                  | 2 of 5 account-wide                                          | 0 new                                   |

The `agent-basketball-league` workspace contains zero Sandboxes, Agent Drives, Blaxel Agents, Applications, Functions/MCP servers, Jobs, Volumes, policies, and integration connections. Because it contains no Sandboxes, it also contains no Sandbox previews or preview tokens. It retains only the unrelated `sandbox-openai` model route and seven historical image records. The image API reports those records at 3,392,356,352 bytes total while the quota console reports zero image usage; the known provider-reporting discrepancy remains covered by the cost buffer and resource-specific teardown rule.

No target `abl-alpha-r01-*` name exists.

## Region, Drive, and preview support

Current Blaxel documentation lists `us-was-1` as North Virginia and an available Sandbox region. Agent Drive remains a private-preview feature available only in `us-was-1`, and a Drive and its mounted Sandbox must use that region. The authenticated workspace exposes the empty Agent Drive inventory, confirming that the management surface remains available. [Regions](https://docs.blaxel.ai/Infrastructure/Regions), [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview)

Private Sandbox previews still support `public:false` and require a preview token supplied through either the query parameter or `X-Blaxel-Preview-Token` header. The run requires the header form and must read every preview back as private before use. [Private previews](https://docs.blaxel.ai/Sandboxes/Preview-url)

## Neon organization and capacity

The authenticated `Michael` organization remains on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. Neon currently lists the Free plan at USD 0 with 100 projects, 100 CU-hours monthly and 0.5 GB storage per project. One empty temporary PostgreSQL 17 project remains within the visible capacity and is projected at USD 0 if the proof stays inside those allowances. [Neon pricing](https://neon.com/pricing)

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

USD 6.00 remains below the USD 10.00 hard ceiling and current USD 19.16 balance. The estimate is deliberately conservative because it treats every declared compute resource as active for the entire four hours.

## Next gate

Do not mutate under `ABL-FOUNDING-ALPHA-R01-02`. After this preflight is merged, obtain a replacement authorization that:

1. binds the merged preflight evidence commit plus every current digest in this record;
2. retains the exact resource envelope, USD 5.00 minimum balance, USD 6.00 projection, four-hour limit, USD 10.00 hard ceiling, prohibitions, evidence export, and resource-specific teardown terms;
3. requires an immediate pre-mutation recheck of all repository and provider bindings; and
4. states that any subsequent repository, runtime, quota, region, feature, privacy, inventory, payment, top-up, image-metering, Neon-capacity, or projected-cost drift invalidates the replacement before mutation.
