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

The source freeze binds 428 implementation files to `0x4d2aa7436cc21abda3d55a06ac3b449b7ab5c4c9654d244707d2cc08dca09ec8`. The exact freeze is recorded in [`founding-alpha-source-freeze.json`](../evidence/founding-alpha-source-freeze.json).

## Exact bounded resource envelope

The machine-readable source of truth is [`resource-plan.json`](../../infra/blaxel/founding-alpha-private/resource-plan.json). The run may create only:

- Seven Blaxel Sandboxes: `abl-alpha-r01-arena`, `abl-alpha-r01-candidate-store`, `abl-alpha-r01-career-body-001`, `abl-alpha-r01-core-api`, `abl-alpha-r01-fixed-broker`, `abl-alpha-r01-public-api`, and `abl-alpha-r01-storage-broker`.
- Five private Blaxel Functions/MCP servers: `abl-alpha-r01-basketball-mcp`, `abl-alpha-r01-candidate-edge`, `abl-alpha-r01-career-mcp`, `abl-alpha-r01-discovery-mcp`, and `abl-alpha-r01-government-mcp`.
- One Blaxel Job: `abl-alpha-r01-candidate-provisioner`.
- One Blaxel Agent Drive: `abl-alpha-r01-state`, with only the three rules in [`drive-access.json`](../../infra/blaxel/founding-alpha-private/drive-access.json).
- Six token-protected `public:false` Sandbox previews, exactly as named in the resource plan. The career body receives no preview and no Drive mount.
- Thirteen new run-scoped Blaxel image records, exactly as named in the resource plan. Seven historical image records remain untouched.
- One new empty temporary Neon PostgreSQL 17 Free-plan project named `abl-founding-alpha-r01`; its newly assigned project ID becomes the sole teardown target.

The run creates zero Blaxel `Agent`, Application, or Volume resources. The existing `sandbox-openai` model route is out of scope and must not be called.

## Frozen local artifacts

| Artifact                      | Digest                                                               |
| ----------------------------- | -------------------------------------------------------------------- |
| Baseline commit               | `943fb734e43f880d86eb352e7aacf795d44914d5`                           |
| Launch plan                   | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Implementation source         | `0x4d2aa7436cc21abda3d55a06ac3b449b7ab5c4c9654d244707d2cc08dca09ec8` |
| Exact-runtime local result    | `0x61355c1e590e3ef0ef5550ad371c247ddd50abc573e5799417a4656f5aa5f69d` |
| Thirteen-image source set     | `0x2a49f2ead328fc3fe39979ede40b701d74a7428807e369e98345f14e8f16a9e6` |
| Thirteen rendered manifests   | `0xe53d58cea4490fc3090132fad6bf8634b02d2b0fd65398cb8c55f8b645a792f7` |
| Reviewed body image source    | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Reviewed body program archive | `0x5142588fa09bb4036e2ab08eb656cdb03960593873816fc9b11026c9d8f162ef` |
| Launch ledger                 | `0xfb4b77b0db9b401fe53f8ab0c3989ea0742424ee9b973423c974a432aa5cd453` |

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
2. Push only the 13 exact run-scoped images; record immutable remote image IDs and verify every image architecture/runtime identity before resource creation.
3. Create the single Neon project, record its new project ID, install the existing Drizzle migrations over a direct connection, then provide pooled application access through Blaxel-managed secrets. Never write credentials to the repository or a career body.
4. Create `abl-alpha-r01-state` atomically with the reviewed `/ciphertext`, `/projections`, and `/candidate-intake` label/path permissions. Verify exact rule equality before any mount.
5. Create the candidate-store, storage-broker, core-api, public-api, arena, and fixed-broker Sandboxes from the rendered manifests; create their six private previews and short-lived preview tokens; read every preview back as `public:false`.
6. Mount only the permitted Drive path into candidate-store, storage-broker, and public-api. Prove cross-path denial and prove the career body has no mount.
7. Deploy the five existing MCP/Function packages privately and the deterministic candidate-provisioner Job. Verify that no Blaxel Agent, Application, Volume, custom domain, or public preview appeared.
8. Prove service health, signed-command rejection, database capability checks, transaction/outbox behavior, projection delivery, SSE cursor delivery, encrypted storage, and arena rendering through the existing implementations.
9. Restart candidate-store, storage-broker, core-api, public-api, and arena individually. Prove durable intake, ciphertext metadata, canonical events/outbox, projections, cursors, and spectator state recover without fixtures or in-memory-only assumptions.
10. Use the existing candidate flow to create the fixed broker first, then invoke the existing provisioner for `abl-alpha-r01-career-body-001`. Verify application binding, immutable images, workspace/region, port, no-Drive posture, and no model access before body start.
11. Upload only the reviewed body archive, start the existing body runtime, and run one noncanonical signed practice possession through the existing basketball engine, core validation boundary, database transaction, projection transport, public stream, arena, and recognition verifier. The result must remain labeled `PRE_GENESIS_EXPERIMENT`, noncanonical, and no higher than `SIGNED_VALID`.
12. Prove unsigned, human-authored, wrong-career, wrong-role, replayed, stale, malformed, and direct-service mutation attempts cannot create accepted history.
13. Export redacted logs, manifests, immutable IDs, readbacks, restart results, signed envelopes, event/projection hashes, recognition output, cost, and final inventory. Export no credentials or preview-token values.
14. Teardown immediately after success, failure, timeout, balance breach, cost drift, privacy drift, or any stop condition.

## Acceptance boundary

Passing the private slice proves that one small piece of the league can live from an existing ABL agent decision to durable event history and the spectator window. It does not open candidate intake, invite GPT-5.6 Sol, reserve a founding seat, make a founding decision, establish canonical history, claim recognition, broadcast to Base, remove recovery controls, authorize recurring capacity, or declare Genesis.

## Mandatory teardown

Delete only the run-created six previews and tokens, seven Sandboxes, five Functions, one Job, one Agent Drive, 13 image records, Blaxel run-scoped secrets/variables, and the exact newly assigned Neon project ID. Destroy temporary local secret-bearing material and externally generated image/manifest contexts. Then re-list every resource class and verify that only the seven historical Blaxel images, unrelated `sandbox-openai` model route, unrelated Neon Hummingbird project, and all pre-existing account resources remain.

Do not use broad cleanup, workspace deletion, wildcard deletion, or name inference. If an exact created identifier was not recorded, stop and resolve it read-only before teardown.
