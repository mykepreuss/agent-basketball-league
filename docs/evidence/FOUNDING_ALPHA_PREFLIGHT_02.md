# Founding Alpha replacement-authorization preflight

> Status: `READ_ONLY_COMPLETE_PRIOR_AUTHORIZATION_INVALIDATED`
> Recorded: `2026-08-22T14:05:08-07:00` in `America/Vancouver`
> Run ID: `ABL-FOUNDING-ALPHA-R01`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon resource and did not reveal, copy, rotate, or persist any provider credential, database credential, preview token, or signing key.

## Outcome

The execution authorization supplied as `ABL-FOUNDING-ALPHA-R01` was invalidated before its first mutation because it quoted superseded repository and artifact digests. No part of that authorization was consumed.

The merged implementation is locally verified and the requested resource envelope still fits the observed provider state. A replacement authorization must bind the implementation release commit and digests below. Provider state must be checked once more immediately before the first mutation because credit, quota, inventory, pricing, and feature availability can change independently of the repository.

## Current repository and artifact bindings

| Binding                         | Current value                                                        |
| ------------------------------- | -------------------------------------------------------------------- |
| Foundation baseline commit      | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Merged implementation release   | `5690cf18b3268071dc191f690618c2239b471373`                           |
| Implementation source           | `0x0dc96e69d12042effa21aa2d044c962737474174d797e8511c1c39560e879c38` |
| Implementation files            | `428`                                                                |
| Launch plan                     | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result | `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5` |
| Thirteen-image source set       | `0x2a49f2ead328fc3fe39979ede40b701d74a7428807e369e98345f14e8f16a9e6` |
| Rendered manifest set           | `0xe53d58cea4490fc3090132fad6bf8634b02d2b0fd65398cb8c55f8b645a792f7` |
| Body-image source               | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive            | `0x5142588fa09bb4036e2ab08eb656cdb03960593873816fc9b11026c9d8f162ef` |
| Private resource-plan file      | `0x3d11c65f7ea4175be0cd885a9914dda89cb57c305af57c5c11de417840cfed5f` |
| Drive-access file               | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger           | `0x5d006f4b4e71f3560f066c2a82ee2de74b70e47871e5650f3a1c745eee33f1a3` |

The local suite passed 354 assertions across 75 test files and 113 uncached Turbo tasks. Consecutive launch-ledger generations produced the same digest after generated build, test, dependency, report, and operating-system artifacts were excluded from source-evidence hashing.

## Authorization drift

| Binding                    | Quoted authorization                                                 | Current                                                              | Result             |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| Implementation release     | Not quoted; foundation baseline used as the only commit              | `5690cf18b3268071dc191f690618c2239b471373`                           | Replacement needed |
| Implementation source      | `0x38567e7b89d2169221dd8df0225582b70f6f97038124e90ed7afc52d592bc215` | `0x0dc96e69d12042effa21aa2d044c962737474174d797e8511c1c39560e879c38` | Drift              |
| Launch plan                | `0x55f09f0188040b13a4be3e75f1acca5382ec878ddcbdf445db494c6a266ff512` | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` | Drift              |
| Exact-runtime result       | `0xd0652414ba1bc09a3aac850be89dcf7e5163f055ba8fb1c97431ef72147ee1b5` | `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5` | Drift              |
| Image set                  | `0x3d7e9251b4cf7826284635e5ff42ea1f9c2b1c76b62f520e22993517e6800941` | `0x2a49f2ead328fc3fe39979ede40b701d74a7428807e369e98345f14e8f16a9e6` | Drift              |
| Manifest set               | `0xe53d58cea4490fc3090132fad6bf8634b02d2b0fd65398cb8c55f8b645a792f7` | Same                                                                 | Match              |
| Body source and archive    | `0x93a1…bf642` and `0x5142…162ef`                                    | Same                                                                 | Match              |
| Private resource-plan file | `0xd27d295639d3ace203b8a2e1740ee3582c416facebf40de31e3179dea27aaf21` | `0x3d11c65f7ea4175be0cd885a9914dda89cb57c305af57c5c11de417840cfed5f` | Drift              |
| Launch ledger              | `0xc21e820afb770126fb731a28b00f8f462faf67bbb9aeea10e6d132926b719ba6` | `0x5d006f4b4e71f3560f066c2a82ee2de74b70e47871e5650f3a1c745eee33f1a3` | Drift              |

## Blaxel account and inventory

Authenticated CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 19.25                                                    | USD 6.00 projected; USD 10 hard ceiling |
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

The `agent-basketball-league` workspace contains zero Sandboxes, Agent Drives, Blaxel Agents, Applications, Functions/MCP servers, Jobs, Volumes, policies, and integration connections. It retains only the unrelated `sandbox-openai` model route and seven historical image records. The image API reports those records at 3,392,356,352 bytes total while the quota console reports zero image usage; the known provider-reporting discrepancy remains and is covered by the cost buffer and resource-specific teardown rule.

No target `abl-alpha-r01-*` name exists.

## Region, Drive, and preview support

Current Blaxel documentation lists `us-was-1` as North Virginia and an available Sandbox region. Agent Drive remains a private-preview feature available only in `us-was-1`, and both a Drive and its mounted Sandbox must use that region. The authenticated workspace exposes the empty Agent Drive inventory, confirming the account still has the relevant management surface. [Regions](https://docs.blaxel.ai/Infrastructure/Regions), [Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview)

Private Sandbox previews still support `public:false` and require a preview token supplied through either the query parameter or `X-Blaxel-Preview-Token` header. The run requires the header form and must read every preview back as private before use. [Private previews](https://docs.blaxel.ai/Sandboxes/Preview-url)

## Neon organization and capacity

The signed-in `Michael` organization remains on the Free plan and contains exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. Current organization usage is 0.5 CU-hours, 0.18 GB storage, 0.02 GB history, and 0.08 GB network transfer since August 1. Neon currently lists the Free plan at USD 0 with 100 projects, 100 CU-hours monthly and 0.5 GB storage per project. One empty temporary PostgreSQL 17 project remains within the visible capacity and is projected at USD 0 if the proof stays inside those allowances. [Neon pricing](https://neon.com/pricing)

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

USD 6.00 remains below the USD 10 hard ceiling and the current USD 19.25 balance.

## Next gate

Do not mutate under the invalidated authorization. Obtain a replacement authorization that:

1. identifies `5690cf18b3268071dc191f690618c2239b471373` as the merged implementation release while retaining `943fb734e43f880d86eb352e7aacf795d44914d5` as the foundation baseline;
2. quotes every current digest in this record, including the Drive-access file digest;
3. retains the exact resource envelope, USD 5 minimum balance, USD 6 projection, four-hour limit, USD 10 hard ceiling, prohibitions, evidence export, and resource-specific teardown terms; and
4. states that any subsequent repository, provider, pricing, privacy, inventory, or cost drift invalidates the replacement before mutation.
