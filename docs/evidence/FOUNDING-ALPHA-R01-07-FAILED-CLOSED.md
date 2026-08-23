# Founding Alpha R01-07 failed-closed result

> Status: `FAILED_CLOSED_ON_NEON_POSTGRES_VERSION_DRIFT_TEARDOWN_COMPLETE`
> Authorization: `ABL-FOUNDING-ALPHA-R01-07`
> First mutation: `2026-08-23T03:26:12Z`
> Image gate completed: `2026-08-23T04:00:21Z`
> Teardown verified: `2026-08-23T04:04:00Z`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`

## Outcome

R01-07 passed its mandatory pre-mutation gate. Every authorization-bound commit,
source and artifact digest, file count, exact-runtime result, target inventory,
historical-image inventory, quota, region, feature, privacy, ACL, payment, top-up,
Neon-capacity, balance, and projected-cost condition matched. The freshly generated
image contexts, body-program archive, and rendered manifests reproduced the bound
digests exactly.

The run then pushed the thirteen exact run-scoped images sequentially. Before the
next push, each exact image name read back with nonzero size, `BUILT` status, a full
provider-generated immutable revision, and a `linux/amd64` build identity. No
mutable tag, shortened revision, invented digest, inferred cross-image revision,
or parallel push was used.

After the complete image gate, the authorized Neon project creation returned new
project ID `noisy-forest-77691248` with PostgreSQL 18. R01-07 required a new empty
PostgreSQL 17 Free-plan project. That runtime-version drift invalidated the
authorization immediately. The run stopped before migration, connection-string
retrieval, secret creation, Agent Drive creation, Sandbox creation, Function
creation, Job creation, preview or token creation, candidate preparation, body
upload, model use, or any ABL application execution.

The exact Neon project and all thirteen exact image records were deleted. Final
inventories restored the authorized pre-run boundary.

## Sequential image readback

| Ordinal | Resource type | Exact image name                            | Bytes       | Exact provider revision |
| ------- | ------------- | ------------------------------------------- | ----------- | ----------------------- |
| 1       | Sandbox       | `abl-alpha-r01-core-api-image`              | 550,309,888 | `eyy9dfwsfkel`          |
| 2       | Sandbox       | `abl-alpha-r01-public-api-image`            | 549,568,512 | `h63a2ytbkxum`          |
| 3       | Sandbox       | `abl-alpha-r01-storage-broker-image`        | 418,152,448 | `znl3fbodwcg9`          |
| 4       | Sandbox       | `abl-alpha-r01-fixed-broker-image`          | 525,991,936 | `o55xsv020qp8`          |
| 5       | Sandbox       | `abl-alpha-r01-candidate-store-image`       | 543,772,672 | `sx1pfdicr9w3`          |
| 6       | Sandbox       | `abl-alpha-r01-arena-image`                 | 892,829,696 | `e8wl405sllu5`          |
| 7       | Function      | `abl-alpha-r01-candidate-edge-image`        | 489,631,744 | `jfxqymxaqphf`          |
| 8       | Job           | `abl-alpha-r01-candidate-provisioner-image` | 304,631,808 | `x3iyslljilgp`          |
| 9       | Function      | `abl-alpha-r01-basketball-mcp-image`        | 472,301,568 | `ynxihqpq95ih`          |
| 10      | Function      | `abl-alpha-r01-career-mcp-image`            | 357,945,344 | `vdqyg13gnf1u`          |
| 11      | Function      | `abl-alpha-r01-discovery-mcp-image`         | 472,305,664 | `iyhac1kk99zf`          |
| 12      | Function      | `abl-alpha-r01-government-mcp-image`        | 357,937,152 | `wxjria37gli2`          |
| 13      | Sandbox       | `abl-alpha-r01-body-image`                  | 392,036,352 | `b6665512195bd5eafade4` |

The provider build logs for every row showed an amd64 builder and Linux container
base/runtime inputs. The exact latest reference for each image matched the exact
revision in its image record before the next image began.

## Drift boundary

The authenticated Neon connector used for the bounded creation exposes project
name and organization inputs but no PostgreSQL-version input. At the time of this
run, its default creation path produced PostgreSQL 18. The authorization did not
permit accepting PostgreSQL 18, changing the ABL database runtime, creating a
second replacement project, or switching to an unreviewed creation surface after
mutation. Failing closed and tearing down was therefore mandatory.

A replacement run must first establish a reviewed creation path that can request
and read back PostgreSQL 17 before image pushes, or separately amend the ABL
runtime and authorization to PostgreSQL 18 after compatibility review. R01-07
does not authorize either correction.

## Teardown and final inventory

The teardown deleted only:

- Neon project `noisy-forest-77691248`; and
- the thirteen exact image records listed above.

No preview, token, Sandbox, Function, Job, Agent Drive, secret, variable, or
candidate artifact required provider deletion because none was created. Final
readback proved:

- zero Sandboxes, Functions, Jobs, Blaxel Agents, Applications, Agent Drives, or
  Volumes in the target workspace;
- zero `abl-alpha-r01-*` image records;
- exactly the seven untouched historical image records:
  `abl-body-sandbox-image`, `abl-stage-arena`, `abl-stage-core-api`,
  `abl-stage-fixed-broker`, `abl-stage-player-body`, `abl-stage-public-api`, and
  `abl-stage-storage-broker`;
- the unrelated `sandbox-openai` model route remained;
- Neon contained only Hummingbird (`snowy-darkness-52052673`, PostgreSQL 17); and
- no unrelated Blaxel, Neon, GitHub, or filesystem resource was deleted or
  modified.

The displayed Blaxel balance moved from USD 18.47 at preflight to USD 18.33 after
teardown. That USD 0.14 account-wide movement remained above the USD 5.00 minimum
and below the USD 10.00 run ceiling; it is not asserted as a provider invoice.
Automatic and monthly top-up remained unconfigured/off, no payment method was
added, and the low-balance alert remained enabled at USD 5.00.

No public ingress, model call, Blaxel Agent, Blaxel Application, Blaxel Volume,
custom domain, Base transaction, recognition broadcast, founding-agent decision,
recurring capacity, recovery-control removal, canonical-history claim, or Genesis
action occurred. All output remained pre-genesis and no recognition claim was
made.

`ABL-FOUNDING-ALPHA-R01-07` is consumed and cannot be reused.
