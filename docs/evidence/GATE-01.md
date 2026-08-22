# Gate 1 launch-readiness evidence

> Status: `PASS_LOCAL_WITH_EXTERNAL_GATES`
> Recorded: `2026-08-19` in `America/Vancouver`
> Baseline commit: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Runtime: Node `24.18.0`, pnpm `11.21.0`
> Authority: local implementation, non-mutating provider inspection, and deployment preparation only. This record does not authorize resource creation, public exposure, material spending, candidate invitations, founding-agent decisions, recognition broadcast, recovery-control removal, Git staging, commit, push, PR, or merge.

## Outcome

The repository's protected pre-Genesis implementation was preserved and reconciled against the approved launch plan, historical evidence, current source, current official provider documentation, and authenticated read-only inspection of the `agent-basketball-league` Blaxel workspace. The locally implementable Gate 1 delta is complete. The machine-readable launch ledger remains `BLOCKED`, as required, on fresh provider preflight, temporary-database and live storage/platform proof, and founding-agent signatures. Gate 2 resource creation and up to USD 10 of non-recurring spend were approved on 2026-08-21 as `ABL-GATE2-2026-08-21-01`; independent witnesses were explicitly deferred and the private rehearsal cannot claim more than `SIGNED_VALID` recognition.

No Blaxel resource, Agent Drive, database project, image, public endpoint, Base transaction, candidate invitation, or recognized history was created. No Git staging, commit, push, PR, or merge occurred.

## Implemented Gate 1 delta

- Truthful pre-Genesis `LaunchState`, extended well-known discovery, `llms.txt`, OpenAPI, MCP discovery tools, A2A 1.0 Agent Card and read-only `SendMessage` endpoint, and checked-in MCP Registry `server.json`.
- Isolated candidate edge with strict signed/encrypted envelopes, expiring DID challenges, bounded modes and capacity, serialized admission decisions, idempotent redelivery, restart recovery, and no canonical authority.
- Private candidate provisioner with independent cryptographic and capacity-policy verification, unchanged-command receipts, restart safety, and a dry-run-only control plane.
- Six strict launch schemas, canonical autonomy/delegation/trade-access service paths, explicit storage repository profiles, and a fail-closed `PRODUCTION_GENESIS` startup proof gate.
- Signed-decision-bound recognition network profile and an evidence-derived launch ledger that cannot accept a source `ready` assertion.
- Private, reversible `abl-stage-*` manifests; broker-only body signing boundary; compiled source-minimal image contexts; non-broadcast staging checkpoint helper; cost, secret, recovery, teardown, and approval packet.
- `2026-08-19` owner-approved reference amendments replace the Gate 2 Volume topology with one path-permissioned Agent Drive and convert core and arena to Sandboxes. The resulting slice has five Sandboxes, four token-protected private previews, and an ephemeral body workspace; it does not authorize provisioning.
- Current Blaxel account/provider evidence and reconciliation of dated `knicks`/Drive-disabled observations without rewriting historical phase records.

## Exact final verification

Command:

```sh
PATH="<external-node-24.18.0-bin>:$PATH" CI=true pnpm evidence
```

Result:

| Suite                                            | Result   | Assertions | Test files | Uncached tasks |
| ------------------------------------------------ | -------- | ---------- | ---------- | -------------- |
| formatting                                       | pass     | 0          | 0          | —              |
| tooling typecheck                                | pass     | 0          | 0          | —              |
| workspace typecheck                              | pass     | 0          | 0          | 42/42          |
| unit/integration/property/contract/migration/API | pass     | 293        | 66         | 42/42          |
| acceptance/replay/load/recovery                  | pass     | 17         | 3          | —              |
| adversarial security                             | pass     | 9          | 1          | —              |
| loopback network load                            | pass     | 2          | 1          | —              |
| browser                                          | pass     | 2          | 1          | —              |
| production build                                 | pass     | 0          | 0          | 29/29          |
| **Total**                                        | **pass** | **323**    | **72**     | **113/113**    |

- Stable result digest: `0x93de3ea831270a129256253a45b6b004b7fea982077ef0b6dadccd56ac7f2fa7`
- Deterministic launch-ledger digest: `0x6161fac696da39ae2f57ca11e5ea6a8a11c5d70945f9f7f1a3fe60e56f7a75b6` (identical on immediate regeneration)
- Route/method pairs: `67`
- Schema registry: `43` primary + `2` V1 operational + `6` launch = `51`
- Result artifact: [`final-local-results.json`](./final-local-results.json)
- Derived blocked-state artifact: [`launch-ledger.json`](./launch-ledger.json)

Focused regression runs also passed for the public API (`18`), launch package (`13`), candidate edge (`3`), candidate provisioner (`1`), storage broker (`8`), foundation topology (`16`), basketball (`17`), body broker (`4`), and staging body (`1`) tests. The acceptance schema inventory initially exposed a stale expected count of `45`; it was corrected to the implemented `51`, after which all acceptance scenarios passed.

## Staging artifact and provider validation

The staging image generator ran outside the repository with the exact runtime. It preserved root development tooling and generated four Sandbox service contexts and a separate body program. Runtime package trees contain compiled applications and production dependencies but no injected ABL source directories, tests, TypeScript configuration, lockfiles, or Turbo logs.

Blaxel CLI `0.1.108` dry-runs executed from each generated context and from the body-image project. All exited zero and resolved:

| Name                       | Kind    | Public | Region         | Memory  |
| -------------------------- | ------- | ------ | -------------- | ------- |
| `abl-stage-core-api`       | Sandbox | n/a    | `us-was-1`     | 2 GiB   |
| `abl-stage-public-api`     | Sandbox | n/a    | `us-was-1`     | 1.5 GiB |
| `abl-stage-storage-broker` | Sandbox | n/a    | `us-was-1`     | 1 GiB   |
| `abl-stage-arena`          | Sandbox | n/a    | `us-was-1`     | 1 GiB   |
| `abl-body-sandbox-image`   | Sandbox | n/a    | manifest-gated | 4 GiB   |

All four generated service images include the pinned Sandbox API and use application port 3000; all five dry-runs resolved as Sandboxes without a missing-Sandbox-API warning. This is not treated as remote runtime proof. Absolute external `-d` selection was unreliable in this CLI version, so the approval packet changes into each context before dry-run or proposed push.

Authenticated read-only inspection still showed no applications, agents, functions, jobs, sandboxes, volumes, Drives, policies, or integration connections, and one pre-existing `sandbox-openai` model route. A second authorized preflight verified Tier 6 capacity, enabled Drive access, credit above the USD 10 packet cap, and automatic top-up off without recording the exact balance. See [`BLAXEL_LAUNCH_VERIFICATION.md`](./BLAXEL_LAUNCH_VERIFICATION.md).

## Determinism and authority checks

- Launch history is `genesis=false`, `canonical=false`, `recognized=false`, with candidate intake `CLOSED`.
- `PRODUCTION_GENESIS` rejects an environment-only assertion and requires complete release, database, source/image/live-proof, ratified-network, and finalized-checkpoint evidence.
- The launch ledger derives its `BLOCKED` status from evidence and required signatures; source records cannot assert readiness.
- The staging recognition profile uses a non-deployed domain separator, null transaction/block fields, and no RPC call or broadcast.
- Candidate and staging control-plane implementations default to closed or dry-run behavior.
- No credential, private key, provider token, database URL, or workload identity is recorded in the repository evidence.

## Simplification review

The required `$code-simplifier` pass covered the final implementation diff without changing behavior. It centralized candidate-policy parsing and body-broker text-file reads, removed a redundant A2A runtime type guard after schema validation, reduced staging-package traversal to one reusable directory reader and one pruning path, and made the checkpoint helper's outside-repository path test explicit across platforms. Focused tests and the complete evidence pipeline were rerun after the changes.

## Remaining external and approval gates

1. A fresh-at-execution Blaxel console check confirming quota, credits, automatic top-up state, region availability, and an all-in estimate below the packet's USD 10 ceiling.
2. Provision and validate the approved temporary Neon PostgreSQL 17 project and keep its credentials outside the repository.
3. Record the exact four-hour activation window, immutable images, and complete external secret inventory before the first Blaxel mutation.
4. Live image build, private networking, workload identity, storage restart/recovery, prohibited-edge, telemetry, rollback, and teardown proof.
5. Separate future approvals for public exposure, candidate invitations, recurring capacity, production workspaces and storage, Base or Base Sepolia broadcast, founding-agent decisions, recovery-control removal, and Genesis. The Gate 2 decision itself now includes exactly one temporary staging Drive and its teardown.

The exact next decision is documented in [`GATE_2_PRIVATE_STAGING_APPROVAL.md`](../launch/GATE_2_PRIVATE_STAGING_APPROVAL.md). Its existence is not execution authority.
