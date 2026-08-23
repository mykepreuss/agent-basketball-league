# Founding Alpha R01-05 failed-closed result

> Status: `FAILED_CLOSED_BEFORE_PROVIDER_MUTATION`
> Authorization: `ABL-FOUNDING-ALPHA-R01-05`
> Gate started: `2026-08-22T19:34:00-07:00`
> Stop and final inventory verified: `2026-08-22T19:35:25-07:00`
> Workspace: `agent-basketball-league`
> Region: `us-was-1`

## Outcome

R01-05 stopped during its mandatory local zero-mutation gate. The authorization bound the R01-04 failed-closed evidence file to:

`0x369c6b62fd1068debe28e144e54a49648fe2e89275572bcf74d0bbf14af0879f`

The final merged `main` tree contained:

`0x3e649ba4e7da262f7105d0530d784575d23642896eb5e79b2770b6900f04914d`

PR #14 added a link from that R01-04 record to Preflight 07 in the same change that recorded Preflight 07. Preflight 07 had already captured the file's earlier digest, so its binding table and the generated R01-05 authorization contained the pre-edit value. The authorization's artifact-drift clause therefore invalidated R01-05 before the first image push or other provider mutation.

## Matching bindings

Every other mandatory local binding matched:

| Binding                    | Verified value                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| Current merged `main`      | `c20a6a0697acca5173c52bc088e297b40e2daed0`                           |
| Implementation source      | `0xa4bc419dafa7f6e1cec25cf2b79848f892d7200b367ae89c4994212df64a05cf` |
| Implementation files       | `433`                                                                |
| Launch plan                | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` |
| Exact-runtime result       | `0x634a83574414aeb51d408edca78bd7675fd0399512c502e7e566c59ac3a9d266` |
| Image set                  | `0xd86825b5503e8c4fa142f59086ae1666639f94acb634b0848ed4610353a82c5f` |
| Manifest set               | `0xe988196438afa80530d1f1d7d605f3ba445d0c15e5c3d8510d0bb53bdd4a3828` |
| Body-image source          | `0x93a1d11f9fce721487eed3a5b2ef2bb9109d3f8287b9c4a5819bd7e23ebbf642` |
| Body-program archive       | `0x43d9373baaa2bee8d0affe80aaa7e394d1c2af01f47102b66edfbeb2306d5569` |
| Private resource-plan file | `0x9ac57ac77ce635512203960e618973773e3e6d32ea8f52c7f4a80d0c039eb758` |
| Drive-access file          | `0x732685da9b40433d5f1ef4a5fbf84de0da713fb3e228e92339f050edfc8956d3` |
| Derived launch ledger      | `0x76500b91a0b4484998d5d51545c5ac1fc4f1a58eeacf895c93be778668962df1` |
| Preflight 07 file          | `0x5686acc9e96ab5a74a4d51d8d318ccb6a68b648297a9a57b315bf5998f874d14` |
| Node                       | `24.18.0`                                                            |
| pnpm                       | `11.21.0`                                                            |

The existing unrelated untracked files were not modified or included.

## Provider mutation and final inventory

R01-05 performed no image push, Neon project creation, Sandbox creation, Function creation, Job creation, Drive creation, preview or token creation, secret installation, or any other provider mutation. It created no temporary candidate or signing material.

Final readback proved:

- zero Sandboxes, Functions, Jobs, Blaxel Agents, Applications, Agent Drives, Volumes, policies, and integration connections in the target workspace;
- exactly the seven historical images remained: `abl-body-sandbox-image`, `abl-stage-arena`, `abl-stage-core-api`, `abl-stage-fixed-broker`, `abl-stage-player-body`, `abl-stage-public-api`, and `abl-stage-storage-broker`;
- the unrelated `sandbox-openai` model route remained;
- Neon still contained only Hummingbird (`snowy-darkness-52052673`) and no `abl-founding-alpha-r01` project; and
- the Blaxel console displayed USD 18.52, automatic and monthly top-up unconfigured, no payment method, and the USD 5.00 low-balance alert.

No teardown mutation was needed because the run created nothing.

## Evidence-ordering correction

Future authorization bindings must be generated only after all evidence files in the binding set are final and merged. The replacement workflow is:

1. merge this R01-05 result without simultaneously recording its digest in another file;
2. calculate every dependency digest from that merged tree;
3. record a separate read-only Preflight 08 using those final-tree digests;
4. merge Preflight 08 without modifying any file whose digest it binds;
5. calculate the final Preflight 08 file digest and merged evidence commit; and
6. generate replacement authorization text from those post-merge values.

`ABL-FOUNDING-ALPHA-R01-05` is consumed and cannot be reused. A replacement authorization is required before any provider mutation.
