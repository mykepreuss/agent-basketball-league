# Founding Alpha R01-04 failed-closed result

> Status: `FAILED_CLOSED_AFTER_IMAGE_PUSH_TEARDOWN_COMPLETE`
> Authorization: `ABL-FOUNDING-ALPHA-R01-04`
> First mutation: `2026-08-23T01:59:35Z`
> Teardown verified: `2026-08-23T02:07:45Z`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`

## Outcome

The authorization passed its mandatory zero-mutation gate. Every bound commit and digest reproduced, the target workload inventory was empty, the seven historical images and unrelated `sandbox-openai` route were unchanged, and the provider, privacy, ACL, quota, payment, top-up, Neon-capacity, and USD 6.00 cost conditions remained within the authorized envelope.

The run pushed exactly the thirteen authorized image records and then failed closed before creating Neon, Agent Drive, a Sandbox, a Function, a Job, a preview, a token, or any secret. Blaxel CLI `0.1.108` returned only new 21-character hexadecimal image revisions, while the bound synthetic-candidate preparer and candidate-provisioner accepted only the previously documented 12-character Blaxel revision or an OCI `@sha256` digest. The body reference read back as:

`sandbox/abl-alpha-r01-body-image:b05103ad9158991c22153`

Using `latest`, shortening the returned revision, inventing an OCI digest, or changing the authorization-bound implementation during the run would have violated R01-04. The run therefore stopped before candidate or runtime creation.

## Image readback

Every exact image name existed and returned a provider-generated revision before teardown:

| Resource type | Exact image names                                                                                                                                                                                                                          | Provider revision       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Sandbox       | `abl-alpha-r01-arena-image`, `abl-alpha-r01-body-image`, `abl-alpha-r01-candidate-store-image`, `abl-alpha-r01-core-api-image`, `abl-alpha-r01-fixed-broker-image`, `abl-alpha-r01-public-api-image`, `abl-alpha-r01-storage-broker-image` | `b05103ad9158991c22153` |
| Function      | `abl-alpha-r01-basketball-mcp-image`, `abl-alpha-r01-candidate-edge-image`, `abl-alpha-r01-career-mcp-image`, `abl-alpha-r01-discovery-mcp-image`, `abl-alpha-r01-government-mcp-image`                                                    | `be3e950e8bfe829074b4d` |
| Job           | `abl-alpha-r01-candidate-provisioner-image`                                                                                                                                                                                                | `b9855d4ccd5cb24e3d274` |

The same revision text appeared in different image namespaces of the same resource type. That may be a provider implementation detail, but concurrent pushes prevent the proof from attributing each build log and readback to one image without ambiguity. A replacement run must push images sequentially and read each exact name, nonzero size, build status, revision, and architecture evidence back before starting the next push.

## Teardown and final inventory

The teardown deleted only the thirteen exact run-scoped image records. No other authorized resource class had been created, so no preview, token, Sandbox, Function, Job, Drive, secret, variable, or Neon project required deletion.

Final readback proved:

- zero Sandboxes, Functions, Jobs, Blaxel Agents, Applications, Agent Drives, or Volumes in the target workspace;
- exactly the seven historical images remained: `abl-body-sandbox-image`, `abl-stage-arena`, `abl-stage-core-api`, `abl-stage-fixed-broker`, `abl-stage-player-body`, `abl-stage-public-api`, and `abl-stage-storage-broker`;
- the unrelated `sandbox-openai` model route remained;
- Neon still contained only Hummingbird (`snowy-darkness-52052673`); and
- the external image and manifest contexts were destroyed, with no candidate or other secret-bearing material ever created.

The displayed Blaxel balance moved from USD 18.61 before mutation to USD 18.60 after teardown. Automatic and monthly top-up remained unconfigured, no payment method was added, and the USD 5.00 minimum was never approached. No public ingress, model call, Base transaction, recognition broadcast, founding decision, canonical-history claim, or Genesis action occurred.

## Local correction boundary

The narrow correction preserves the existing ABL implementation:

1. one shared launch-domain schema accepts either an OCI SHA-256 digest, the documented 12-character Blaxel revision, or the 21-hex provider revision observed live;
2. `latest`, operator tags, malformed revision lengths, and non-hex 21-character values remain rejected, while the runbook separately requires byte-for-byte equality with the provider readback;
3. both the existing candidate preparer and candidate-provisioner consume the same schema; and
4. the runbook requires sequential image pushes with immediate exact-name readback.

The local correction passed focused review and code simplification. Two independent external image-context generations reproduced image-set digest `0xd86825b5503e8c4fa142f59086ae1666639f94acb634b0848ed4610353a82c5f`; their body archives were byte-identical at `0x43d9373baaa2bee8d0affe80aaa7e394d1c2af01f47102b66edfbeb2306d5569`. Two independent manifest renders remained byte-identical at `0xe988196438afa80530d1f1d7d605f3ba445d0c15e5c3d8510d0bb53bdd4a3828`. The complete exact Node 24.18.0 pipeline passed 365 assertions across 78 files and 113 uncached tasks with stable result digest `0x634a83574414aeb51d408edca78bd7675fd0399512c502e7e566c59ac3a9d266`.

`ABL-FOUNDING-ALPHA-R01-04` is consumed and cannot be reused. The correction is merged and [`FOUNDING_ALPHA_PREFLIGHT_07.md`](./FOUNDING_ALPHA_PREFLIGHT_07.md) records the refreshed read-only provider state. A replacement authorization must bind the merged evidence commit, the Preflight 07 file digest, and every refreshed digest before any new provider mutation.
