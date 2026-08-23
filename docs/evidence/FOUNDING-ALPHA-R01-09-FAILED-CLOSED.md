# Founding Alpha R01-09 failed-closed result

> Status: `FAILED_CLOSED_ON_CANDIDATE_STORE_PORT_COLLISION_TEARDOWN_COMPLETE`
> Authorization: `ABL-FOUNDING-ALPHA-R01-09`
> First mutation: `2026-08-23T05:47:14Z`
> Failure detected: `2026-08-23T06:37:18Z`
> Teardown verified: `2026-08-23T06:42:09Z`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`

## Outcome

R01-09 passed every mandatory pre-mutation repository, source, runtime,
inventory, quota, region, privacy, ACL, balance, payment, top-up, Neon-capacity,
and projected-cost gate. The source freeze reproduced the bound 434-file
implementation digest. All thirteen source-minimal image contexts, the reviewed
career-body archive, and the rendered manifest set reproduced their authorized
digests.

## Authorized bindings reproduced

| Binding                             | Authorized value                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Current merged main evidence commit | `1bf8101595fba5d9200348fa9f610f6006349b5e`                                       |
| Implementation source               | `0xd7824237f640524f6c0c853457a894c1f7a3b0bf5fc0c27eb08c462e3866b5a0` (434 files) |
| Source-freeze evidence file         | `0x14e1cc1ec110f6e61ce8a74a7bea03b407fdea51ed37d4a7795e2651609cd187`             |
| Launch plan                         | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4`             |
| Exact-runtime result                | `0x5a7f7096fe7d8177143df775ff30c021b4ff9da5a9ef8c43fa6c3aced8604843`             |
| Final local-results file            | `0xb3a309200c623cee8011aed2afebffc5d33afb470ebd3c2a87c51f785ca2b4c5`             |
| Thirteen-image source set           | `0xd86825b5503e8c4fa142f59086ae1666639f94acb634b0848ed4610353a82c5f`             |
| Image-sources file                  | `0x55d7c73993d8b059ea78ae4e74ff6afae5eabd4a45c6b5ba29ba5a75ae5918a5`             |
| Rendered manifest set               | `0xe988196438afa80530d1f1d7d605f3ba445d0c15e5c3d8510d0bb53bdd4a3828`             |
| Reviewed body image source          | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642`             |
| Reviewed body program archive       | `0x65a837f5040edb5d8508fc048a07bd90695ecb94169919a70fc92348fa1d734c`             |
| Private resource-plan file          | `0x84047edc77a6ec36b1cdaadbb4017cc86deadd6ee066583e9f821c4a4df9cb81`             |
| Drive-access file                   | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3`             |
| Image-push helper file              | `0xc4e2b93fab284b576512b1b57e7605f18707fb2812dbc812cb47e5e447d6741d`             |
| Derived launch ledger               | `0xfc71e3e1bacd83c7113e1a6d6b190239df867e4b6578030063764a560809ca99`             |
| Launch-ledger evidence file         | `0x358cd9df4d7c4d284780cc1858cd5199c5cb55fd78431e9d679f347427898fa6`             |
| Founding Alpha Preflight 11         | `0xeb8b4958a8ce078cabf7a5c1b21d18c85b6df04396d7ef634474edad6bc78a26`             |

The signed-in Neon Console created exact temporary project
`flat-wave-82712036`, named `abl-founding-alpha-r01`, as the first provider
mutation. Immediate exact-ID readback proved:

- PostgreSQL `17` (`server_version_num` `170011`);
- region `aws-us-east-1`;
- organization `Michael` (`org-billowing-wind-64503405`) on the Free plan;
- Neon Auth disabled;
- zero user relations before migration; and
- the existing reviewed migration installed all 23 expected public tables.

The context-bound image helper then pushed all thirteen exact images, one
ordinal at a time. Each push reproduced its bound source digest before mutation,
proved that the target image name was absent, and produced a passing receipt
with nonzero size, `BUILT` status, reviewed Dockerfile attribution, linux/amd64
build identity, and a provider-generated immutable revision:

| Ordinal | Exact image                                     | Immutable revision      | Size (bytes) |
| ------: | ----------------------------------------------- | ----------------------- | -----------: |
|       1 | `sandbox/abl-alpha-r01-core-api-image`          | `h9bv9lv6zy8r`          |  550,309,888 |
|       2 | `sandbox/abl-alpha-r01-public-api-image`        | `p3c3h9l96l3k`          |  549,568,512 |
|       3 | `sandbox/abl-alpha-r01-storage-broker-image`    | `s6m4x1hznpq4`          |  418,152,448 |
|       4 | `sandbox/abl-alpha-r01-fixed-broker-image`      | `qw1heyls423s`          |  525,991,936 |
|       5 | `sandbox/abl-alpha-r01-candidate-store-image`   | `jaja0xs26yb5`          |  543,772,672 |
|       6 | `sandbox/abl-alpha-r01-arena-image`             | `vr9iltpx0uu4`          |  892,829,696 |
|       7 | `function/abl-alpha-r01-candidate-edge-image`   | `plrnmwzbr22v`          |  489,631,744 |
|       8 | `job/abl-alpha-r01-candidate-provisioner-image` | `cfpubvix5sj9`          |  304,631,808 |
|       9 | `function/abl-alpha-r01-basketball-mcp-image`   | `t0uz5ahie2iw`          |  472,301,568 |
|      10 | `function/abl-alpha-r01-career-mcp-image`       | `d8mzyfuwewqr`          |  357,945,344 |
|      11 | `function/abl-alpha-r01-discovery-mcp-image`    | `jv2jwxh1we1c`          |  472,305,664 |
|      12 | `function/abl-alpha-r01-government-mcp-image`   | `jixrj395u2jz`          |  357,937,152 |
|      13 | `sandbox/abl-alpha-r01-body-image`              | `bf1affbe8b4181b99e466` |  392,036,352 |

The run next created Agent Drive `abl-alpha-r01-state` atomically with the exact
three reviewed label/path permissions for `/ciphertext`, `/projections`, and
`/candidate-intake`. Provider readback returned the same rule order, modes,
paths, and label pairs. Its JSON serializer alphabetized each label object's
keys; the local applicator incorrectly treated that harmless key-order change as
configuration drift because it compared serialized JSON strings. The live
provider configuration itself was exact.

The run created only Sandbox `abl-alpha-r01-candidate-store`, mounted the exact
`/candidate-intake` rule at `/mnt/abl-candidate-intake`, and proved a matching
write. The sibling `/projections` and `/ciphertext` paths were unavailable. Its
exact private preview was `public:false` and token protected.

The run then failed closed at the candidate-store application handoff.
`infra/blaxel/abl-public/candidate-store.yaml` assigned port `8080` to the ABL
process, but every Blaxel Sandbox image also starts the provider's `sandbox-api`
on port `8080`. The platform additionally supplied `PORT=80` to the process. The
unprivileged ABL process could not bind port 80, and explicitly restoring the
reviewed port produced `EADDRINUSE` because `sandbox-api` already owned port 8080. The private preview therefore reached `sandbox-api`, not the candidate
store, and returned `404`.

Changing the port during the live run would have changed the digest-bound
reviewed manifest. The run stopped without obtaining or consuming a candidate
challenge and before creating the fixed broker, invoking the provisioner, or
creating a career body. No retry or substitute implementation was attempted.

## Structured environment finding

The first manifest apply also exposed an ambiguity in the operator path. Blaxel
CLI environment substitution did not preserve the structured candidate-capacity
policy as a whole YAML value. A temporary, external, mode-`0600` manifest
prepared by parsing the YAML and replacing whole-value placeholders delivered
the value correctly, without printing a secret. This proved the intended data
path but also showed that the run packet needs a reviewed, tested resolver rather
than relying on shell or CLI interpolation for JSON and secret-bearing values.

The correction boundary therefore includes:

1. assigning the ABL candidate-store process and preview target to port `3000`,
   which is already the ordinary service port used by the other ABL Sandboxes;
2. comparing Agent Drive permissions structurally instead of comparing JSON
   property order; and
3. providing a fail-closed external manifest resolver that parses YAML, replaces
   only whole-value placeholders, writes only outside the repository with
   restrictive permissions, and never emits resolved values.

These corrections are local work, not authority to retry R01-09.

## Proof boundary

R01-09 live-proved:

- exact PostgreSQL 17 and `aws-us-east-1` console selection and readback;
- installation of the existing 23-table migration;
- all thirteen reviewed image sources built sequentially with attributable,
  immutable linux/amd64 revisions;
- atomic creation and exact semantic readback of all three Agent Drive ACLs;
- the candidate-intake mount and matching write;
- cross-path denial at the mounted filesystem boundary; and
- private, token-protected, `public:false` preview configuration.

It did not reach a candidate challenge, synthetic application, provisioner,
career-body Sandbox, signed basketball action, core validation, PostgreSQL
transaction/outbox, projection, public cursor/SSE stream, arena render,
encrypted storage restart, exact replay, or public recognition verification.
No claim is made for any unexecuted assertion.

## Exact teardown

Teardown deleted only:

- the one run-created private preview and its one run-created token;
- Sandbox `abl-alpha-r01-candidate-store`;
- Agent Drive `abl-alpha-r01-state`;
- the thirteen exact run-scoped image records listed above; and
- Neon project `flat-wave-82712036`.

No other Sandbox, Function/MCP server, Job, preview, token, Agent Drive, image,
secret, variable, or Neon project had been created by the run.

Final readback proved:

- zero Sandboxes, Functions/MCP servers, Jobs, Agent Drives, Blaxel Agents,
  Applications, or Volumes in the target workspace;
- exactly the seven untouched historical image records, totaling
  3,392,356,352 bytes: `abl-body-sandbox-image`, `abl-stage-arena`,
  `abl-stage-core-api`, `abl-stage-fixed-broker`, `abl-stage-player-body`,
  `abl-stage-public-api`, and `abl-stage-storage-broker`;
- the unrelated `sandbox-openai` route remained unchanged;
- Neon contained only Hummingbird (`snowy-darkness-52052673`), unchanged on
  PostgreSQL 17 in `aws-us-east-1`;
- Blaxel balance was USD 17.90 after teardown, above the USD 5.00 minimum; and
- automatic and monthly top-up remained unconfigured/off with no payment method
  configured.

No broad cleanup, wildcard deletion, workspace deletion, unrelated-resource
mutation, public ingress, model call, Blaxel Agent, Blaxel Application, Blaxel
Volume, custom domain, Base transaction, recognition broadcast, founding-agent
decision, recurring capacity, recovery-control removal, canonical-history claim,
or Genesis action occurred.

R01-09 is consumed. A replacement run requires these corrections and this
result to be merged, refreshed exact-runtime evidence and artifact digests, a
new read-only provider preflight, and a new digest-bound authorization.
