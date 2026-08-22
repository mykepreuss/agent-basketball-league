# Founding Alpha R01-03 failed-closed result

> Status: `FAILED_CLOSED_BEFORE_PROVIDER_MUTATION`
> Authorization: `ABL-FOUNDING-ALPHA-R01-03`
> Recorded: `2026-08-22T15:21:08-07:00` in `America/Vancouver`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`

## Outcome

The authorization failed closed during its mandatory pre-mutation executable-path audit. No Blaxel or Neon resource was created, modified, or deleted. No image was pushed, no secret or preview token was created, no spend-bearing workload was started, and no model or Base call occurred.

The authorized commits and file digests reproduced before the audit. The live sequence could not satisfy two authorization-bound assertions with the frozen implementation:

1. The candidate provisioner accepted only OCI references ending in `@sha256:<digest>`, while the authenticated Blaxel image readback and official CLI return provider-generated immutable revisions in the form `sandbox/<image-name>:<12-character-revision>`. The existing Job would reject both exact image references produced by its authorized image pushes before it could create the provisioner-derived career body.
2. The public API serialized every rehearsal collection and game segment as `canonical:true`, and the arena rejected any game projection that was not canonical. The authorized run required every exposed result to remain explicitly `PRE_GENESIS_EXPERIMENT`, noncanonical, and no higher than `SIGNED_VALID`.

Proceeding would therefore have required either substituting an unreviewed image identifier or making a canonical-history claim prohibited by the authorization. The run stopped before its first provider mutation.

## Read-only provider state at stop

The authenticated read-only recheck immediately preceding the executable audit reported:

- Blaxel Tier 6 with USD 19.05 credit, no configured payment method, and automatic top-up unconfigured/off;
- the target workspace with zero Sandboxes, Agent Drives, Blaxel Agents, Applications, Functions, Jobs, Volumes, policies, previews, or preview tokens;
- only the unrelated `sandbox-openai` model route and seven historical image records in the workspace;
- `us-was-1`, Agent Drive, and private `public:false` previews available;
- the Neon Free organization containing only Hummingbird (`snowy-darkness-52052673`) and no `abl-founding-alpha-r01` project; and
- the unchanged conservative four-hour projection of USD 6.00 against the USD 10.00 hard ceiling.

These observations were read-only. Hummingbird, the historical Blaxel images, `sandbox-openai`, and every unrelated account resource remained untouched.

## Local correction

The narrow correction preserves the existing ABL implementations and their internal replay-verified projection records:

- the live candidate control plane accepts either an OCI digest reference or Blaxel's exact provider-generated 12-character image revision, while rejecting `latest`, operator-selected tags, and every other mutable form;
- the candidate Job and active manifest use `IMAGE_REFERENCE` terminology for those exact readback values;
- the public serialization boundary suppresses canonical flags while Genesis history is closed, adds the explicit `PRE_GENESIS_EXPERIMENT` classification, and reports the applicable recognition level;
- game cursor, segment, and SSE responses use the same noncanonical classification;
- the arena accepts internally consistent pre-Genesis experimental output, continues to accept consistent future Genesis history, and rejects mixed classification; and
- focused tests prove native Blaxel revision acceptance, mutable-tag rejection, noncanonical collection/SSE output, preservation of the internal durable projection, and arena mixed-classification rejection.

## Replacement boundary

`ABL-FOUNDING-ALPHA-R01-03` is invalidated and cannot be reused. The correction passed the complete exact Node 24.18.0 pipeline with 357 assertions across 76 files and 113 uncached tasks. Independent image generation reproduced image-set digest `0x9072d771bb75ebfb0181334179caa89608f84bfb553c478fc9ebc31bcf32660a`; independent manifest rendering reproduced `0x31598bba8e517d0d43fd23f385833cb3a701034ec02656a35dc81a6bb15b6013`; and the reviewed body archive remained `0x6bf97a5d0e0652ffa40a3b4277dca925c010eab9979d6144fd0e4eea39609557`.

The correction must still merge to `main` and receive a fresh read-only Blaxel and Neon preflight. A replacement `ABL-FOUNDING-ALPHA-R01-04` authorization must bind the resulting commits and all refreshed digests before any provider mutation.
