# Founding Alpha private slice runbook

> Status: `READY_FOR_DIGEST_BOUND_AUTHORIZATION`
> Run ID: `ABL-FOUNDING-ALPHA-R01`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`
> Maximum duration: four hours
> Projected all-in cost: USD 6.00
> Hard ceiling: USD 10.00
> Minimum pre-mutation Blaxel balance: USD 5.00
> Automatic top-up: off

This document is an execution packet, not execution authority. It does not authorize image pushes, secrets, resource creation, spend, public exposure, model calls, founding-agent decisions, recognition broadcast, recurring capacity, recovery-control removal, or Genesis. A new approval must quote the final digests and exact resource envelope below.

## Existing implementation is the launch foundation

The private slice deploys the ABL already built in this repository. It does not scaffold a new league, substitute a demo application, or replace the established domain model.

| Live surface                                        | Existing implementation reused                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core command and canonical transaction path         | [`apps/core-api`](../../apps/core-api), [`packages/database`](../../packages/database), [`packages/schemas`](../../packages/schemas)                                                                 |
| Public projections and stream                       | [`apps/public-api`](../../apps/public-api), [`packages/projections`](../../packages/projections)                                                                                                     |
| Spectator arena                                     | [`apps/arena`](../../apps/arena)                                                                                                                                                                     |
| Career body and fixed cognition boundary            | [`apps/staging-body`](../../apps/staging-body), [`apps/body-broker`](../../apps/body-broker), [`packages/career`](../../packages/career)                                                             |
| Private encrypted state                             | [`apps/private-storage-broker`](../../apps/private-storage-broker), [`packages/storage`](../../packages/storage)                                                                                     |
| Candidate intake and deterministic provisioning     | [`apps/candidate-edge`](../../apps/candidate-edge), [`apps/candidate-provisioner`](../../apps/candidate-provisioner), [`packages/launch`](../../packages/launch)                                     |
| Basketball behavior and signed role decisions       | [`packages/basketball`](../../packages/basketball)                                                                                                                                                   |
| Discovery, career, basketball, and government tools | [`apps/discovery-mcp`](../../apps/discovery-mcp), [`apps/career-mcp`](../../apps/career-mcp), [`apps/basketball-mcp`](../../apps/basketball-mcp), [`apps/government-mcp`](../../apps/government-mcp) |
| Institutional authority and recognition             | [`packages/institutions`](../../packages/institutions), [`packages/recognition`](../../packages/recognition), [`contracts`](../../contracts)                                                         |
| Boundary and launch assurance                       | [`packages/assurance`](../../packages/assurance), [`packages/foundation`](../../packages/foundation), [`packages/genesis`](../../packages/genesis)                                                   |

The immutable reuse rule is: wire, deploy, and prove these implementations. Do not introduce a parallel identity system, basketball engine, canonical ledger, projection protocol, storage protocol, governance system, verifier, or spectator application. Any necessary glue must remain thin, package-bound, and covered by the existing local suite.

The source freeze binds 429 implementation files to `0x0861fdf09bc8c97a0499ddd6f191144673162702074936277780f0f9d87f4655`. The exact freeze is recorded in [`founding-alpha-source-freeze.json`](../evidence/founding-alpha-source-freeze.json).

## Exact bounded resource envelope

The machine-readable source of truth is [`resource-plan.json`](../../infra/blaxel/founding-alpha-private/resource-plan.json). The run may create only:

- Seven Blaxel Sandboxes: `abl-alpha-r01-arena`, `abl-alpha-r01-candidate-store`, `abl-alpha-r01-core-api`, `abl-alpha-r01-fixed-broker`, `abl-alpha-r01-public-api`, `abl-alpha-r01-storage-broker`, and `abl-career-0198e000000070008000000000000001`.
- Five private Blaxel Functions/MCP servers: `abl-alpha-r01-basketball-mcp`, `abl-alpha-r01-candidate-edge`, `abl-alpha-r01-career-mcp`, `abl-alpha-r01-discovery-mcp`, and `abl-alpha-r01-government-mcp`.
- One Blaxel Job: `abl-alpha-r01-candidate-provisioner`.
- One Blaxel Agent Drive: `abl-alpha-r01-state`, with only the three rules in [`drive-access.json`](../../infra/blaxel/founding-alpha-private/drive-access.json).
- Six token-protected `public:false` Sandbox previews, exactly as named in the resource plan. The career body receives no preview and no Drive mount.
- Thirteen new run-scoped Blaxel image records, exactly as named in the resource plan. Seven historical image records remain untouched.
- One new empty temporary Neon PostgreSQL 17 Free-plan project named `abl-founding-alpha-r01`; its newly assigned project ID becomes the sole teardown target.

The run creates zero Blaxel `Agent`, Application, or Volume resources. The existing `sandbox-openai` model route is out of scope and must not be called.

The synthetic application ID is fixed to `0198e000-0000-7000-8000-000000000001`. The existing candidate provisioner derives the corresponding body name `abl-career-0198e000000070008000000000000001`; both bindings are recorded in the resource plan. This keeps the live Job's rule-based naming path intact while making the bounded teardown target exact before mutation.

## Frozen local artifacts

| Artifact                      | Digest                                                               |
| ----------------------------- | -------------------------------------------------------------------- |
| Baseline commit               | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Launch plan                   | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Implementation source         | `0x0861fdf09bc8c97a0499ddd6f191144673162702074936277780f0f9d87f4655` |
| Exact-runtime local result    | `0x04b2ea099dc44dce30ca0888fe895a31d573a710231a7a755ddcc0d36fb46fe4` |
| Thirteen-image source set     | `0x9072d771bb75ebfb0181334179caa89608f84bfb553c478fc9ebc31bcf32660a` |
| Thirteen rendered manifests   | `0x31598bba8e517d0d43fd23f385833cb3a701034ec02656a35dc81a6bb15b6013` |
| Reviewed body image source    | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Reviewed body program archive | `0x6bf97a5d0e0652ffa40a3b4277dca925c010eab9979d6144fd0e4eea39609557` |
| Launch ledger                 | `0xdd66dc98c811c3ef0d278cf897554745767492398053f679b95b2e85b1956e7a` |

[`image-sources.json`](../../infra/blaxel/founding-alpha-private/image-sources.json) records every per-image source digest. Image IDs remain empty until an authorized push succeeds. The manifest renderer derives the bounded resources from the active production manifests and leaves all secret values unresolved.

## Pre-mutation drift gate

Immediately before the first mutation, stop unless all of the following are true:

1. `HEAD`, the launch plan, implementation source, image set, manifest set, body source, body archive, and launch ledger exactly reproduce the authorized values.
2. Blaxel workspace is `agent-basketball-league`; target region is `us-was-1`; Agent Drive, path permissions, Sandboxes, Functions/MCP, Jobs, private previews, and image pushes remain available.
3. The ABL-created inventory remains empty and the seven historical images plus the unrelated `sandbox-openai` model are unchanged.
4. The Blaxel balance is at least USD 5.00, automatic top-up remains unconfigured/off, no payment method has been added, projected all-in cost is no more than USD 6.00, and the hard ceiling remains USD 10.00.
5. Neon organization `org-billowing-wind-64503405` remains Free plan, contains no `abl-founding-alpha-r01`, and still has capacity for one temporary project. `Hummingbird` (`snowy-darkness-52052673`) remains untouched.
6. Every preview manifest remains `public:false`; model routes remain disabled; the body still has no Drive mount, database credential, provider credential, or Blaxel control-plane authority.

Any drift stops the run before mutation and requires a new authorization.

## Authorized-run sequence

If and only if the digest-bound authorization is granted:

1. Produce the 13 source-minimal image contexts outside the repository and reproduce the recorded image-set and body-archive digests.
2. Push only the 13 exact run-scoped images; record each provider-generated immutable revision in the form returned by Blaxel (`sandbox/<image-name>:<12-character-revision>`) and verify every image architecture/runtime identity before resource creation. Mutable tags such as `latest` or operator-selected labels are prohibited.
3. Create the single Neon project, record its new project ID, install the existing Drizzle migrations over a direct connection, then provide pooled application access through Blaxel-managed secrets. Never write credentials to the repository or a career body.
4. Create `abl-alpha-r01-state` atomically with the reviewed `/ciphertext`, `/projections`, and `/candidate-intake` label/path permissions. Verify exact rule equality before any mount.
5. Create the candidate-store, storage-broker, core-api, public-api, arena, and fixed-broker Sandboxes from the rendered manifests; create their six private previews and short-lived preview tokens; read every preview back as `public:false`.
6. Mount only the permitted Drive path into candidate-store, storage-broker, and public-api. Prove cross-path denial and prove the career body has no mount.
7. Deploy the five existing MCP/Function packages privately and the deterministic candidate-provisioner Job. Verify that no Blaxel Agent, Application, Volume, custom domain, or public preview appeared.
8. Prove service health, signed-command rejection, database capability checks, transaction/outbox behavior, projection delivery, SSE cursor delivery, encrypted storage, and arena rendering through the existing implementations.
9. Restart candidate-store, storage-broker, core-api, public-api, and arena individually. Prove durable intake, ciphertext metadata, canonical events/outbox, projections, cursors, and spectator state recover without fixtures or in-memory-only assumptions.
10. Use the existing candidate flow with the frozen synthetic application ID to create the fixed broker first, then invoke the existing provisioner for `abl-career-0198e000000070008000000000000001`. Pass only the exact provider-generated body and fixed-broker image revisions read back after their pushes. Verify the provisioner-derived name, application binding, immutable image revisions, workspace/region, port, no-Drive posture, and no model access before body start.
11. Upload only the reviewed body archive, start the existing body runtime, and run one noncanonical signed practice possession through the existing basketball engine, core validation boundary, database transaction, projection transport, public stream, arena, and recognition verifier. The result must remain labeled `PRE_GENESIS_EXPERIMENT`, noncanonical, and no higher than `SIGNED_VALID`.
12. Prove unsigned, human-authored, wrong-career, wrong-role, replayed, stale, malformed, and direct-service mutation attempts cannot create accepted history.
13. Export redacted logs, manifests, immutable IDs, readbacks, restart results, signed envelopes, event/projection hashes, recognition output, cost, and final inventory. Export no credentials or preview-token values.
14. Teardown immediately after success, failure, timeout, balance breach, cost drift, privacy drift, or any stop condition.

## Acceptance boundary

Passing the private slice proves that one small piece of the league can live from an existing ABL agent decision to durable event history and the spectator window. It does not open candidate intake, invite GPT-5.6 Sol, reserve a founding seat, make a founding decision, establish canonical history, claim recognition, broadcast to Base, remove recovery controls, authorize recurring capacity, or declare Genesis.

## Mandatory teardown

Delete only the run-created six previews and tokens, seven Sandboxes, five Functions, one Job, one Agent Drive, 13 image records, Blaxel run-scoped secrets/variables, and the exact newly assigned Neon project ID. Destroy temporary local secret-bearing material and externally generated image/manifest contexts. Then re-list every resource class and verify that only the seven historical Blaxel images, unrelated `sandbox-openai` model route, unrelated Neon Hummingbird project, and all pre-existing account resources remain.

Do not use broad cleanup, workspace deletion, wildcard deletion, or name inference. If an exact created identifier was not recorded, stop and resolve it read-only before teardown.
