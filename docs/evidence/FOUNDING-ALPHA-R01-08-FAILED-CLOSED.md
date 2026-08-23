# Founding Alpha R01-08 failed-closed result

> Status: `FAILED_CLOSED_ON_IMAGE_CONTEXT_ATTRIBUTION_TEARDOWN_COMPLETE`
> Authorization: `ABL-FOUNDING-ALPHA-R01-08`
> First mutation: `2026-08-23T04:58:22Z`
> Failure detected: `2026-08-23T05:03:55Z`
> Teardown verified: `2026-08-23T05:06:06Z`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`

## Outcome

R01-08 passed every mandatory pre-mutation repository, source, runtime,
inventory, quota, region, privacy, ACL, balance, payment, top-up, Neon-capacity,
and projected-cost gate. The source-minimal image contexts reproduced the bound
thirteen-image digest, the reviewed body archive reproduced, and the rendered
manifests reproduced the authorized digest.

The signed-in Neon Console then created exact project
`broad-fire-46722827`, named `abl-founding-alpha-r01`, as the first provider
mutation. Immediate readback proved:

- PostgreSQL `17` (`server_version_num` `170011`);
- region `aws-us-east-1`;
- organization `Michael` (`org-billowing-wind-64503405`) on the Free plan;
- Neon Auth left disabled;
- one empty `production` branch and zero user relations before migration; and
- the existing foundation migration installed all 23 expected public tables.

The run then failed closed during the sequential image gate. The operator invoked
Blaxel CLI `0.1.108` from the repository root with `bl push -d <context>`. For the
first image name, `abl-alpha-r01-core-api-image`, the CLI resolved the
repository-root body-image configuration and Dockerfile rather than the supplied
core service context. Its build log copied `abl-reviewed-body-init` and
`reviewed-agent-runtime`, proving that the body image had been published under the
core image name.

The first exact image record returned `BUILT`, 392,036,352 bytes, provider
revision `bae6e24e113ec222b96d1`, and an amd64 builder. Those readback fields were
individually valid, but they did not identify the authorized core source.

The second invocation targeted `abl-alpha-r01-public-api-image` through the same
ambiguous `-d` form. The CLI emitted a Sandbox Dockerfile configuration warning
and reused the identical 392,036,352-byte body build with the same provider
revision. It supplied no new attributable amd64 build trace. The second image
therefore could not satisfy the source, Dockerfile, architecture, or independent
revision assertions. No third image was started.

Retrying with a different invocation would have exceeded the authorization's
exact sequential image-push boundary. The run stopped before Agent Drive,
Sandbox, Function, Job, preview, token, candidate, body-program upload, model,
canonical command, projection, arena, or recognition execution.

## Exact teardown

The teardown deleted only:

- `sandbox/abl-alpha-r01-core-api-image`;
- `sandbox/abl-alpha-r01-public-api-image`; and
- Neon project `broad-fire-46722827`.

Final readback proved:

- zero Sandboxes, Functions/MCP servers, Jobs, Agent Drives, Blaxel Agents,
  Applications, or Volumes in the target workspace;
- zero `abl-alpha-r01-*` image records;
- exactly the seven untouched historical image records:
  `abl-body-sandbox-image`, `abl-stage-arena`, `abl-stage-core-api`,
  `abl-stage-fixed-broker`, `abl-stage-player-body`, `abl-stage-public-api`, and
  `abl-stage-storage-broker`;
- the unrelated `sandbox-openai` route remained unchanged; and
- Neon contained only Hummingbird (`snowy-darkness-52052673`), unchanged on
  PostgreSQL 17 in `aws-us-east-1`.

No broad cleanup, wildcard deletion, workspace deletion, unrelated-resource
mutation, public ingress, model call, Blaxel Agent, Blaxel Application, Blaxel
Volume, custom domain, Base transaction, recognition broadcast, founding-agent
decision, recurring capacity, recovery-control removal, canonical-history claim,
or Genesis action occurred.

## Correction boundary

The replacement path introduces
[`scripts/push-founding-alpha-image.ts`](../../scripts/push-founding-alpha-image.ts).
For one ordinal at a time it:

1. requires the active Founding Alpha authorization ID;
2. recomputes the exact bound source digest;
3. uses the exact context as the child process working directory;
4. never passes `--directory` or `-d` to `bl push`;
5. refuses an existing target image or concurrent push;
6. requires the preceding ordinal's passing receipt;
7. rejects missing Dockerfiles, configuration warnings, source drift, missing
   amd64 evidence, mutable or malformed revisions, and readback disagreement; and
8. records a redacted passing receipt before the next ordinal is eligible.

The helper and its tests are local correction material, not authority to retry.
R01-08 is consumed. A replacement run requires the correction and this result to
be merged, refreshed exact-runtime evidence and artifact digests, a new read-only
provider preflight, and a new digest-bound authorization.
