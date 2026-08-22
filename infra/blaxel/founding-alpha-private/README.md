# Founding Alpha private slice

> Status: `READY_FOR_DIGEST_BOUND_AUTHORIZATION`
> Run ID: `ABL-FOUNDING-ALPHA-R01`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`

This is the smallest live proof of the active Founding Alpha architecture. It reuses the production application manifests and existing ABL packages listed in [`resource-plan.json`](./resource-plan.json); it is not a replacement staging application and it does not reactivate the historical Gate 2 containment profile.

The bounded topology contains exactly seven Sandboxes, five Functions, one Job, one path-permissioned Agent Drive, six token-protected private previews, thirteen new run-scoped image records, and one temporary empty Neon PostgreSQL 17 project. It creates no Blaxel `Agent`, Application, or Volume resource and makes no model call.

The candidate-store Sandbox is required because the candidate Function is stateless and the signed intake repository must survive process restart. The same reviewed candidate-edge package supplies both modes. The synthetic career body receives no Drive mount. Its fixed broker is created first and is verified by the existing candidate-provisioner Job before the Job creates the body.

The private proof freezes synthetic application ID `0198e000-0000-7000-8000-000000000001`. The existing provisioner therefore derives the exact authorized body name `abl-career-0198e000000070008000000000000001`; the resource plan records both values so creation and teardown exercise the real naming path without inference. It also binds the synthetic intake policy to one `CAPPED_PUBLIC` PLAYER opening with a credible opportunity 24 hours after policy generation and zero unlisted-role capacity.

Nothing in this packet replaces the ABL implementation. The image contexts deploy the existing `@abl/core-api`, `@abl/public-api`, `@abl/private-storage-broker`, `@abl/body-broker`, `@abl/candidate-edge`, `@abl/candidate-provisioner`, four existing MCP applications, the existing arena build, and the reviewed career-body package. Run `pnpm founding-alpha:prepare-images <external-directory>` to produce source-minimal contexts outside the repository. Each MCP gets its own image so the deployable artifact remains directly traceable to its existing package and manifest. [`image-sources.json`](./image-sources.json) records the locally verified source digest for each of the thirteen images and the reproducible reviewed-body archive; it intentionally contains no remote image ID until a separately authorized push succeeds.

The synthetic candidate is not a hand-authored fixture. After the private candidate-edge Function returns its live challenge, run `pnpm founding-alpha:prepare-candidate application ...` outside the repository. The preparer creates the exact signed, encrypted application, ephemeral fixed-broker signing secret, provisioner envelope secret, and one-task Job batch without printing secret values. After registration returns an offer, run the same command in `accept` mode to sign the offer response. The fixed broker is then created before the existing provisioner Job creates the exact derived career-body Sandbox.

Run `pnpm founding-alpha:render-manifests <external-directory>` to derive the thirteen run-scoped resources from those same active manifests. The renderer adds an absolute four-hour `ttl-max-age` lifecycle, makes every Function private for this proof, disables the fixed broker's model route, and leaves secret values as unresolved Blaxel variables. The manifest-set digest is bound in `resource-plan.json`; the production manifests remain the source of truth.

The Drive is created atomically with the three exact label/path permissions in [`drive-access.json`](./drive-access.json). Storage, public projection, and candidate-intake Sandboxes receive only their corresponding mount. Direct cross-path access, S3 access, extra mounts, and any career-body mount are prohibited. The storage bootstrap is a Blaxel-managed secret environment value; no repository file or pre-start secret upload is required.

At the published rates, the four-hour maximum with every declared Sandbox, Function, and Job active for the entire window is USD 4.9896. The plan reserves USD 1.0104 for transient image, snapshot, and provider-metering uncertainty, producing a USD 6.00 projected all-in cost under the unchanged USD 10 hard ceiling. This is a cost estimate, not execution authority.

Before any mutation, freeze source and image-context digests, record the generated launch-ledger digest, refresh the read-only provider preflight, and obtain a new authorization quoting those exact values and resource names. On success, failure, timeout, balance below USD 5, or cost drift, delete only the resources listed in `resource-plan.json`, permanently delete the exact new Neon project ID, destroy temporary secret material, and verify final inventories.
