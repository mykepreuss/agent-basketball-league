# Founding Alpha candidate-handoff replacement preflight

> Status: `READ_ONLY_COMPLETE_R01_10_AUTHORIZATION_REQUIRED`
> Recorded: `2026-08-23T00:11:05-07:00` in `America/Vancouver`
> Consumed authorization: `ABL-FOUNDING-ALPHA-R01-09`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Neon organization: `Michael` (`org-billowing-wind-64503405`)

This preflight was read-only. It created, modified, or deleted no Blaxel or Neon
resource. It did not reveal, copy, rotate, or persist any provider credential,
database credential, preview token, or signing key. The Neon create-project
dialog was inspected and cancelled without activating `Create`; connector and
console inventories remained unchanged.

## Outcome

R01-09 passed the PostgreSQL 17 gate and installed the reviewed 23-table
migration, pushed all thirteen attributable linux/amd64 images sequentially,
created the exact three-rule Agent Drive atomically, proved its candidate-intake
mount and sibling-path denial, and created a token-protected `public:false`
preview. It failed closed because the ABL candidate-store process and Blaxel's
Sandbox API both attempted to use port 8080. Exact-name teardown restored the
pre-run Blaxel and Neon inventories. The result is recorded in
[`FOUNDING-ALPHA-R01-09-FAILED-CLOSED.md`](./FOUNDING-ALPHA-R01-09-FAILED-CLOSED.md).

The result and correction were merged through
[PR 24](https://github.com/mykepreuss/agent-basketball-league/pull/24). The
correction moves the candidate-store process and preview target to port 3000,
compares Drive ACLs semantically rather than by JSON property order, and adds a
reviewed resolver for whole-value manifest placeholders. That resolver accepts
only an external mode-`0600` environment file, writes resolved manifests and a
redacted receipt outside the repository under restrictive permissions, rejects
partial or missing placeholders, and never emits resolved values.

Preflight 12 preserves final-tree dependency ordering:

1. the R01-09 result, candidate-handoff correction, focused tests,
   exact-runtime evidence, resource plan, and every recorded dependency were
   merged first;
2. every repository and artifact value below was calculated from merged `main`
   at `201ea4154cf7141e911c885588441f844b144d01`;
3. this preflight change does not modify a file whose digest it records; and
4. the Preflight 12 file digest and final evidence merge commit will be
   calculated only after this file is merged.

The complete exact Node 24.18.0 pipeline passes nine suites, 368 assertions
across 78 files, and 113 uncached tasks. All thirteen prepared image contexts
reproduce their per-image digests, the deterministic body archive reproduces,
and the corrected rendered-manifest set includes the port-3000 candidate
handoff. The 435-file implementation freeze and evidence-derived launch ledger
reproduce exactly.

The bounded private Founding Alpha envelope still fits the observed Blaxel and
Neon state. The conservative four-hour projection remains USD 6.00 against a
USD 10.00 hard ceiling and a current USD 17.79 Blaxel balance. No provider
mutation is authorized by this document. A replacement
`ABL-FOUNDING-ALPHA-R01-10` authorization must bind this preflight after it is
merged and every current value below.

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
| Preflight 11 record commit            | `4f2f2b34ace11d3190704e670eb3d38a947d58c6`                           |
| R01-09 authorization evidence merge   | `1bf8101595fba5d9200348fa9f610f6006349b5e`                           |
| R01-09 result and correction commit   | `a43ef55890ccf57cbed50efa87dfc0faf26605ed`                           |
| Current correction merge on `main`    | `201ea4154cf7141e911c885588441f844b144d01`                           |
| Implementation source                 | `0xb90a8a5cc6779e8adee2aef080c5863f6d3da2d16a5faf000497b44ccccd9c5e` |
| Implementation files                  | `435`                                                                |
| Source-freeze evidence file           | `0xf194027cc66c920b3acf6a98142c9d38561b1d140fc325e7a18b9a0898d5c92c` |
| Launch plan                           | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact Node 24.18.0 local result       | `0xe0a155fb02ca565e3472268d2c8efa29a8a3adeec26ec179b0826b0706186ca8` |
| Final local-results file              | `0xc0666a9c7811657d9683ca78d581a52bcd85afbfa453534ab0eeff6d32d03641` |
| Thirteen-image source set             | `0xd86825b5503e8c4fa142f59086ae1666639f94acb634b0848ed4610353a82c5f` |
| Image-sources file                    | `0x55d7c73993d8b059ea78ae4e74ff6afae5eabd4a45c6b5ba29ba5a75ae5918a5` |
| Rendered manifest set                 | `0xbf1d11fa9750ec8bdff4c517c460c998c8f7a6382788f7a985b0705c3551a164` |
| Body-image source                     | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive                  | `0x65a837f5040edb5d8508fc048a07bd90695ecb94169919a70fc92348fa1d734c` |
| Private resource-plan file            | `0xe75bf99c04f1408c6eb29ff52bde4f5ee4f1d7b0aca513d2f2a4e1f449ead958` |
| Drive-access file                     | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Image-push helper file                | `0xc4e2b93fab284b576512b1b57e7605f18707fb2812dbc812cb47e5e447d6741d` |
| Manifest resolver file                | `0xb08050e61b5b3ef37e834f0ad474b66a058e02809ce23f9f134b1cfc5eecbd7c` |
| Drive-topology applicator file        | `0xfa7d17403814297e6b6995ca1eda6aa0d756ca2cad03dc626cc58535838d4a83` |
| Candidate-store manifest file         | `0x383da91e297ef528c0e1223e26a2931605e4c22c45349fec3247c1030a4c6e81` |
| Derived launch ledger                 | `0x5b139008153fe06b188dec545350492cdf781619c831445b9c6ab81552d25282` |
| Launch-ledger evidence file           | `0x7e556f1a7a47f522de63f50f2d90ebc3d82a9798128380c9c2bfa5d2d761e3da` |
| R01-09 failed-closed evidence file    | `0xf955501cc856d704de6cbc1d5613f44b19c37c0bfa54fd2838ce8a3700e553aa` |

Every value above was read from the separately merged dependency tree. None of
the bound result, plan, source, artifact, helper, manifest, or historical
evidence files is modified by this Preflight 12 change.

## R01-09 binding drift and correction

| Binding                    | Authorized R01-09                                                    | Current                                                              | Result                          |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| Current merged `main`      | `1bf8101595fba5d9200348fa9f610f6006349b5e`                           | `201ea4154cf7141e911c885588441f844b144d01`                           | Corrected; replacement required |
| Implementation source      | `0xd7824237f640524f6c0c853457a894c1f7a3b0bf5fc0c27eb08c462e3866b5a0` | `0xb90a8a5cc6779e8adee2aef080c5863f6d3da2d16a5faf000497b44ccccd9c5e` | Corrected; replacement required |
| Implementation files       | `434`                                                                | `435`                                                                | Corrected; replacement required |
| Exact-runtime result       | `0x5a7f7096…843`                                                     | `0xe0a155fb…ca8`                                                     | Corrected; replacement required |
| Rendered manifest set      | `0xe9881964…3828`                                                    | `0xbf1d11fa…a164`                                                    | Corrected; replacement required |
| Private resource-plan file | `0x84047edc77a6ec36b1cdaadbb4017cc86deadd6ee066583e9f821c4a4df9cb81` | `0xe75bf99c04f1408c6eb29ff52bde4f5ee4f1d7b0aca513d2f2a4e1f449ead958` | Corrected; replacement required |
| Derived launch ledger      | `0xfc71e3e1bacd83c7113e1a6d6b190239df867e4b6578030063764a560809ca99` | `0x5b139008153fe06b188dec545350492cdf781619c831445b9c6ab81552d25282` | Corrected; replacement required |
| Candidate application port | `8080`                                                               | `3000`                                                               | Corrected; replacement required |
| Drive ACL readback         | JSON-string equality                                                 | semantic structural equality                                         | Corrected; replacement required |
| Manifest value resolution  | provider/shell interpolation                                         | reviewed external whole-value resolver                               | Corrected; replacement required |
| Image set                  | `0xd86825b5…2c5f`                                                    | Same                                                                 | Match                           |
| Body-image source          | `0x93a1d11f…bf642`                                                   | Same                                                                 | Match                           |
| Body-program archive       | `0x65a837f5…d734c`                                                   | Same                                                                 | Match                           |
| Drive-access file          | `0x732685da…956d3`                                                   | Same                                                                 | Match                           |
| Blaxel balance             | USD 18.13 immediately before R01-09 mutation                         | USD 17.79                                                            | Permitted movement; above floor |

R01-09 is consumed and cannot be resumed. The drift above is the reviewed
candidate-handoff correction plus ordinary account-wide credit movement, not
authority to mutate.

## Blaxel account and inventory

Authenticated Blaxel CLI `0.1.108` and the signed-in console reported:

| Item                        | Current read-only result                                     | Bounded request                         |
| --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Credit balance              | USD 17.79                                                    | USD 6.00 projected; USD 10 hard ceiling |
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

The `agent-basketball-league` workspace contains zero Sandboxes, Agent Drives,
Blaxel Agents, Applications, Functions/MCP servers, Jobs, Volumes, policies, and
integration connections. With zero Sandboxes, it contains no Sandbox preview or
preview token. It retains only the unrelated `sandbox-openai` model route and
these seven historical images:

- `abl-body-sandbox-image`
- `abl-stage-arena`
- `abl-stage-core-api`
- `abl-stage-fixed-broker`
- `abl-stage-player-body`
- `abl-stage-public-api`
- `abl-stage-storage-broker`

No `abl-alpha-r01-*` resource and no
`abl-career-0198e000000070008000000000000001` Sandbox exists. The seven
historical image records report 3,392,356,352 aggregate bytes while the quota
console reports zero image usage. This unchanged discrepancy remains covered by
the cost buffer and exact-name teardown boundary.

## Region, Drive ACL, preview, and image-reference support

Blaxel's current [region documentation](https://docs.blaxel.ai/Infrastructure/Regions)
lists `us-was-1` as North Virginia and an available Sandbox region.
[Agent Drive](https://docs.blaxel.ai/Agent-drive/Overview) remains available in
`us-was-1`, and the authenticated workspace exposes an empty Drive inventory
through its management surface.

Current [Drive permission documentation](https://docs.blaxel.ai/Agent-drive/Permissions),
last modified July 17, 2026, defines server-enforced label/path access for
mounts and direct HTTP API calls. A Drive supports at most three rules, labels
are ANDed within a rule, rules are ORed, and unmatched workloads are denied. The
reviewed Founding Alpha Drive defines exactly three rules. R01-09 live-proved
atomic creation, semantic readback, matching mounted access, and mounted
cross-path denial. A replacement run must still prove mismatching-label denial,
direct-API enforcement, storage-broker access, and recovery behavior.

Current [Sandbox preview documentation](https://docs.blaxel.ai/Sandboxes/Preview-url)
supports `public:false` previews and token access through the
`X-Blaxel-Preview-Token` header. Current
[image documentation](https://docs.blaxel.ai/Sandboxes/Templates) retains
workspace-scoped image records. The replacement run must use the merged helper
and exact readback for one image ordinal at a time.

## Neon organization, PostgreSQL 17 path, and capacity

The authenticated `Michael` organization remains on the Free plan and contains
exactly one project:

| Project     | Project ID                | Region          | PostgreSQL | Scope                            |
| ----------- | ------------------------- | --------------- | ---------: | -------------------------------- |
| Hummingbird | `snowy-darkness-52052673` | `aws-us-east-1` |         17 | Unrelated; must remain untouched |

No project named `abl-founding-alpha-r01` exists. The organization has capacity
for the single temporary Free-plan project, whose projected cost remains USD 0
within current allowances.

The signed-in Neon Console create-project dialog currently defaults to
PostgreSQL 18 and AWS US East 2 (Ohio). It still explicitly offers PostgreSQL 17,
AWS US East 1 (N. Virginia), and an unchecked Neon Auth switch. PostgreSQL 17 and
AWS US East 1 were selected, their exact control values were read back, and the
dialog was cancelled. Connector and console inventories then still showed only
Hummingbird. R01-09 separately proved that this reviewed path creates an exact
PostgreSQL 17 project, reads back `server_version_num` `170011`, and installs the
23-table migration. A replacement run must never rely on the dialog defaults
and must repeat exact selection and exact-ID readback before any Blaxel image
push.

## Current four-hour projection

Current [Blaxel pricing](https://blaxel.ai/pricing) remains USD 0.0000115 per
GiB-second for active Sandbox memory, USD 0.000007 per GiB-second for MCP
compute, USD 0.000006 per GiB-second for Job compute, USD 0.045 per GiB-month
for images, and USD 0.20 per GiB-month for Sandbox snapshots. Agent Drive data
and operations remain free during beta.

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

USD 6.00 remains below the USD 10.00 hard ceiling and current USD 17.79
balance. The estimate treats every declared compute resource as active for all
four hours.

## Next gate

Do not mutate under R01-09 or any earlier authorization. After this preflight is
merged and its final digest is calculated, obtain one fresh
`ABL-FOUNDING-ALPHA-R01-10` authorization that:

1. binds the final Preflight 12 file digest, its record and merge commits, the
   R01-09 result/correction commits, and every current artifact digest above;
2. retains the exact seven Sandboxes, five Functions/MCP servers, one Job, one
   Agent Drive, six private previews, thirteen images, synthetic candidate UUID,
   provisioner-derived body name, Drive ACL/mount rules, four-hour limit, USD
   5.00 balance floor, USD 6.00 projection, USD 10.00 hard ceiling,
   prohibitions, evidence export, and exact-name teardown terms;
3. makes signed-in-console creation of `abl-founding-alpha-r01` with PostgreSQL
   17, `aws-us-east-1`, Free plan, and Neon Auth off the first provider mutation;
4. requires immediate exact-ID readback of project name, PostgreSQL version,
   region, Free-plan organization, Auth-disabled state, and empty user schema,
   with exact project deletion and a stop before image pushes on any mismatch;
5. requires the merged image helper for thirteen sequential exact-name pushes,
   rejects direct `bl push`, and prohibits any retry after a `FAIL_CLOSED`
   receipt without a new authorization;
6. requires the reviewed manifest resolver, exact mode-`0600` input, redacted
   receipt, port-3000 candidate-store process and preview, and semantic Drive
   ACL readback before candidate preparation;
7. requires the fixed-broker-first, live-challenge,
   existing-candidate-provisioner flow and the complete existing-implementation
   proof;
8. requires an immediate pre-mutation recheck of every repository, artifact,
   runtime, provider, inventory, privacy, capacity, payment, top-up, ACL, and
   cost binding; and
9. states that any subsequent relevant drift invalidates R01-10 before
   mutation.
