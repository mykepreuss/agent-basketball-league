# Gate 2 private Blaxel staging approval packet

> Status: `EXECUTED_FAILED_CLOSED_AWAITING_AMENDMENT`
> Prepared: `2026-08-19`
> Approved: `2026-08-21`
> Approval identifier: `ABL-GATE2-2026-08-21-01`
> Approver and accountable operator: Michael Preuss
> Execution and evidence assistant: Codex (not an independent witness or constitutional authority)
> Repository baseline: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Target workspace: `agent-basketball-league`
> Target region: `us-was-1`
> Packet authority: one private, reversible Gate 2 run only, subject to the remaining just-in-time preflight and safety conditions below.

> Execution result recorded `2026-08-21`: the approved run stopped before agent-program installation because the Blaxel Sandbox rejected the required nftables UID egress policy (`FAILED:INSTALLING_UID_EGRESS_POLICY:3`). No recognized history or model call was created. All Blaxel runtime resources and image tags were torn down. See [Gate 2 private staging result](../evidence/GATE-02-FAILED-CLOSED.md). This approval is consumed and does not authorize a rerun or a weakened network boundary.

> Follow-up recorded `2026-08-21`: the temporary Neon project was permanently deleted, and the owner selected a separate player-body/fixed-broker Sandbox boundary for local preparation. The [six-Sandbox amendment](./GATE_2_SIX_SANDBOX_AMENDMENT.md) requires a new exact execution authorization; this historical packet cannot authorize it.

> Provider-documentation reconciliation recorded `2026-08-21`: the Agent Drive overview (last modified May 1) still describes workspace-level preview limitations, while the dedicated Drive permissions page (last modified July 17) explicitly documents server-enforced label/path ACLs for mounts and direct API access. The newer capability-specific page governs this run. The Drive must still be created with both rules atomically, read back, and rejected if either rule is absent or widened.

## Decision requested

The approver authorized one temporary, private, pre-Genesis staging run of the exact slice in this packet, with an all-in ceiling of **USD 10** and no automatic top-up. Execution remains conditional on a fresh source digest, current provider preflight, complete external secret file, immutable image identifiers, and an exact hard stop no later than four hours after the first Blaxel resource creation.

This packet requests creation, live proof, and teardown of the one temporary Agent Drive named below. It does **not** request approval for public ingress, candidate invitations, founding-agent selection, founding votes, production workspaces, any additional or production Drive, model inference, Base or Base Sepolia broadcasts, recognition-contract deployment, recurring capacity, removal of recovery controls, Genesis, Git publication, or a production database selection.

The execution may begin only after the following remaining prerequisites are satisfied:

- a current Blaxel console quote/credit check showing that the proposal is within the cap and will not trigger an automatic top-up;
- the approved temporary Neon PostgreSQL project and secret pooled/direct connection URLs;
- all secret values named in this packet;
- immutable image identifiers produced from the reviewed source;
- exact activation and teardown timestamps recorded immediately before the first Blaxel mutation, with a hard stop no later than four hours after that mutation.

## Approval form

The following values record the approval supplied by the accountable operator. Dynamic values are completed in the external evidence work directory immediately before execution and do not widen this approval.

| Field               | Approved value                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packet              | `GATE_2_PRIVATE_STAGING_APPROVAL.md`, baseline above plus the fresh working-tree digest recorded in the external run evidence                                    |
| Blaxel workspace    | `agent-basketball-league`                                                                                                                                        |
| Region              | `us-was-1`                                                                                                                                                       |
| Visibility          | five private Sandboxes; four token-protected private previews; no public preview or trigger                                                                      |
| Spend ceiling       | maximum USD 10 total for this run; automatic top-up remains disabled                                                                                             |
| Activation window   | begins only after database validation and fresh preflight; expected active work at most 90 minutes; hard stop exactly four hours after the first Blaxel mutation |
| Database            | temporary Neon Free project `abl-stage-gate2`, `aws-us-west-2`, PostgreSQL 17, 0.25–2 CU, five-minute scale-to-zero; credentials stay outside Git                |
| Witnesses           | optional and omitted for this private rehearsal; Codex is not represented as independent; the highest permitted checkpoint recognition level is `SIGNED_VALID`   |
| Secret supplier     | Michael Preuss, using Blaxel secret fields and a mode-0600 external environment file                                                                             |
| Teardown owner      | Michael Preuss, assisted by Codex; destructive deletion still requires exact-name verification and action-time confirmation                                      |
| Approval identifier | `ABL-GATE2-2026-08-21-01`, approved by Michael Preuss                                                                                                            |

Approval expires if a resource name, region, image source, memory size, Drive permission, Drive path, mount, preview visibility, network edge, external provider, price, or secret authority changes. A changed packet requires a new approval.

## Exact deployment boundary

The proposal uses one temporary control/staging workspace. It does not replace the constitutional production topology (`abl-core`, `abl-private`, `abl-competition`, and `abl-public`). Every artifact is rehearsal-only and must display or preserve pre-Genesis status.

### Blaxel resources

| Kind            | Exact name                         | Size and limits       | Visibility and lifecycle                                         |
| --------------- | ---------------------------------- | --------------------- | ---------------------------------------------------------------- |
| Sandbox         | `abl-stage-core-api`               | 2,048 MiB; max one    | private preview; rehearsal writes; delete after 4 hours idle     |
| Sandbox         | `abl-stage-arena`                  | 1,024 MiB; max one    | private preview; spectator reads; delete after 4 hours idle      |
| Sandbox         | `abl-stage-player-body-001`        | 4,096 MiB; max one    | no preview; delete after 4 hours idle; terminated retention 24h  |
| Sandbox         | `abl-stage-storage-broker`         | 1,024 MiB; max one    | private preview; Drive `/ciphertext`; delete after 4 hours idle  |
| Sandbox         | `abl-stage-public-api`             | 1,536 MiB; max one    | private preview; Drive `/projections`; delete after 4 hours idle |
| Agent Drive     | `abl-stage-durable-state`          | provider-managed      | two path-scoped read-write rules; delete after evidence export   |
| Private preview | `abl-stage-core-api-private`       | port 3000; token ≤ 4h | `public: false`; token required in `X-Blaxel-Preview-Token`      |
| Private preview | `abl-stage-storage-broker-private` | port 3000; token ≤ 4h | `public: false`; token required in `X-Blaxel-Preview-Token`      |
| Private preview | `abl-stage-public-api-private`     | port 3000; token ≤ 4h | `public: false`; token required in `X-Blaxel-Preview-Token`      |
| Private preview | `abl-stage-arena-private`          | port 3000; token ≤ 4h | `public: false`; token required in `X-Blaxel-Preview-Token`      |

No Blaxel Volume, Application, Function, Job, Policy, custom domain, public preview, public trigger, recurring schedule, or new Model is requested. The existing `sandbox-openai` model route may be configured behind the fixed broker, but the first scenario makes **zero model calls** and authorizes no model spend.

The checked-in source of truth is:

- [resource plan](../../infra/blaxel/staging/resource-plan.json)
- [Drive permissions, mounts, and previews](../../infra/blaxel/staging/drive-access.json)
- [service identities and edges](../../infra/blaxel/staging/service-identities.json)
- [core manifest](../../infra/blaxel/staging/core-api.yaml)
- [storage-broker manifest](../../infra/blaxel/staging/storage-broker.yaml)
- [public-API manifest](../../infra/blaxel/staging/public-api.yaml)
- [arena manifest](../../infra/blaxel/staging/arena.yaml)
- [body Sandbox manifest](../../infra/blaxel/staging/body-sandbox.yaml)

### External resources

One temporary managed PostgreSQL database is approved for this run: a new, empty Neon Free project named `abl-stage-gate2` in `aws-us-west-2`, with PostgreSQL 17, TLS certificate verification, autoscaling bounded to 0.25–2 CU, five-minute scale-to-zero, and the shortest available restore window. This is a staging convenience, not a selection of Neon for production. A provider, project, region, version, compute, or cost change requires an amended approval before use.

Independent witnesses are optional and intentionally omitted from this private Gate 2 run. The operator and Codex may execute and verify the test evidence, but they do not constitute two independent administrative domains. Independent witness services remain required before claiming `INDEPENDENTLY_WITNESSED` or Production V1 readiness.

## Image source and immutability

All five images derive from the reviewed repository and the exact Node 24.18.0 Alpine base digest in the Dockerfiles.

- Core, public API, storage broker, and arena contexts are assembled locally by [prepare-staging-image-contexts.ts](../../scripts/prepare-staging-image-contexts.ts).
- The body Sandbox image is assembled from the root [Dockerfile](../../Dockerfile), fixed broker, sandbox init, and immutable agent launcher.
- The staging body program is compiled separately and uploaded to the body Sandbox's ephemeral `/workspace` only after the Sandbox exists. It is reproducible from the reviewed artifact and is not durable league history.
- `bl push` is an approval-gated external mutation. Its returned immutable image identifier and source digest must be recorded before any manifest is applied.
- Mutable tags such as `latest` are not acceptable manifest inputs.

The body’s canonical private key, model credential, service credential, personal-domain key, core preview token, and private-storage preview token are decoded by the privileged init into broker-only files owned by UID 10100, then removed from the environment. The admitted program runs as UID 10101 with an allowlisted environment and cannot read those files. The fixed broker signs only the body DID’s `player-decision:ActionIntentSubmitted` and `game-possession:PossessionResolved` events. The body receives a signature and public address, never private-key, preview-token, or Drive material.

## Network and authority map

```text
abl-stage-player-body-001
  -> fixed local broker: choose action, request allowlisted own-event signature
  -> abl-stage-core-api: POST /v1/commands
  -> abl-stage-storage-broker: POST /v1/ciphertext
  -> sandbox-openai: configured broker route, zero calls in this scenario

abl-stage-core-api
  -> managed PostgreSQL: TLS database protocol
  -> abl-stage-public-api: POST /v1/internal/projections
  -> abl-stage-storage-broker: commitment/deletion verification only

abl-stage-arena
  -> abl-stage-public-api: read-only game projections
```

Forbidden edges include public API or arena to core, arena to private storage, body to PostgreSQL, body to a raw Volume or Drive handle, body to the Blaxel control plane, body to raw provider credentials, public API to personal plaintext or the Drive's `/ciphertext` subtree, storage broker to `/projections`, every workload to the Drive S3 endpoint, and every workload to a recognition broadcast endpoint.

Short-lived private-preview tokens protect the four service Sandbox origins. The body’s fixed broker alone holds the core and storage preview tokens; core holds the projection and storage preview tokens; arena holds only the projection preview token; the external spectator receives only the arena preview token. Application-level HMAC capabilities separately bind core-to-projection and core/body-to-storage requests. Drive permissions match the two Drive-backed Sandbox identity-label sets and deny every other workload. The spectator has no HMAC secret, database URL, canonical-command credential, private-storage credential, or Drive permission.

## Storage and database profiles

The first run uses `AGENT_DRIVE`; no Volume is created. One Drive has exactly two rules: the storage-broker Sandbox receives read-write access only to `/ciphertext`, and the public-API Sandbox receives read-write access only to `/projections`. The Drive must be created with both rules in the initial request and must never exist in an unpermissioned state. The body has no matching label or mount. The newer dedicated [Drive permissions documentation](https://docs.blaxel.ai/Agent-drive/Permissions) says these rules are enforced for mounts and direct API access; the older [Agent Drive overview](https://docs.blaxel.ai/Agent-drive/Overview) contains conflicting preview language. The retrieved Drive state and live cross-path denials therefore remain mandatory stop/pass evidence. Agent Drive's S3 endpoint is prohibited because current provider documentation says Drive permission rules are not enforced there.

Ciphertext metadata is durably recoverable from the broker repository; writes use recovery-safe ordering and restart contract tests. The projection subtree holds only rebuildable public derived data. The body program stays on ephemeral Sandbox storage and is reinstalled from the checked artifact after Sandbox loss. A failed ACL, mount, restart, restore, or body-denial test stops the run; it does not authorize a Volume fallback.

The staging database profile is:

- PostgreSQL 16 or newer (recommended temporary option: Neon PostgreSQL 17);
- TLS required and certificate verification retained in the connection URL;
- one unique staging database and role;
- credentials delivered only to `abl-stage-core-api`;
- transactional event append, idempotency record, and outbox in one database transaction;
- no production or personal data;
- provider restore/PITR capability recorded before activation;
- exact export and destructive deletion after evidence capture;
- no implication that the provider is approved for production.

The production `CanonicalDatabaseProfile` gate is deliberately not asserted by this rehearsal profile.

## Recognition profile

The effective profile is `PRE_GENESIS_REHEARSAL` with recognition anchor `PRE_GENESIS_UNRATIFIED` and recognition level initially `NONE`. The checkpoint uses chain ID 84532 and the non-deployed staging domain address `0x1111111111111111111111111111111111111111` only as an EIP-712 domain separator. It has a null transaction hash and null block number. No RPC URL is required and no Base Sepolia or Base transaction is sent.

One ephemeral staging `PROJECTOR` key supplies the 1-of-1 nonconstitutional checkpoint authorization. This role exists only to test the verifier and must never be described as a founding or production office. This run must report the valid checkpoint as `SIGNED_VALID`; it may not report `INDEPENDENTLY_WITNESSED`. `canonical`, `recognized`, `canonicalHistoryOpen`, and `genesis` remain false because the source-bound recognition anchor is unratified.

The staging checkpoint helper [prepare-staging-checkpoint.ts](../../scripts/prepare-staging-checkpoint.ts) reads a key from outside the repository, writes no key material, produces the publication/registry/policy JSON, and can incorporate witness attestations. It refuses repository-local secret and output paths.

## Secret inventory

Secret values must be stored in a mode-0600 environment file outside the repository, passed through Blaxel secret fields, never printed, and destroyed after teardown. Blaxel secret variables protect values in the control plane, but each trusted consuming process can read its own injected environment; therefore each secret is scoped to the smallest consumer set. The body init decodes its private material into broker-only files and removes it from the admitted process environment. Names below are identifiers, not values.

| Name                                          | Consumer                           | Supplier                       | Purpose                                            |
| --------------------------------------------- | ---------------------------------- | ------------------------------ | -------------------------------------------------- |
| `ABL_STAGE_DATABASE_URL`                      | core only                          | Database Custodian             | unique TLS staging database role                   |
| `ABL_STAGE_PROJECTION_HMAC_BASE64`            | core/public API                    | Infrastructure Custodian       | `projection:append` capability                     |
| `ABL_STAGE_CANDIDATE_CHALLENGE_HMAC_BASE64`   | core                               | Infrastructure Custodian       | closed candidate subsystem startup dependency      |
| `ABL_STAGE_PRIVATE_STORAGE_HMAC_BASE64`       | core/storage broker                | Infrastructure Custodian       | commitment verification capability                 |
| `ABL_STAGE_EXIT_PORTABILITY_HMAC_BASE64`      | core/storage broker                | Infrastructure Custodian       | deletion/portability verification capability       |
| `ABL_STAGE_STORAGE_BOOTSTRAP_JSON`            | storage broker                     | Infrastructure Custodian       | strict caller policy and HMAC records              |
| `ABL_STAGE_BODY_SERVICE_CREDENTIAL_B64`       | fixed body broker                  | Infrastructure Custodian       | body broker request identity                       |
| `ABL_STAGE_DOMAIN_KEY_B64`                    | fixed body broker                  | Agent/Infrastructure Custodian | personal-content encryption inside kernel boundary |
| `ABL_STAGE_AGENT_SIGNING_KEY_B64`             | fixed body broker                  | Agent/Infrastructure Custodian | narrowly allowlisted body-event signing            |
| `ABL_STAGE_PRIVATE_CORE_PREVIEW_TOKEN`        | local operator only                | Infrastructure Custodian       | transient source for the body broker Base64 secret |
| `ABL_STAGE_PRIVATE_CORE_PREVIEW_TOKEN_B64`    | fixed body broker                  | Infrastructure Custodian       | core Sandbox transport gate in broker-only file    |
| `ABL_STAGE_PRIVATE_STORAGE_PREVIEW_TOKEN`     | core                               | Infrastructure Custodian       | private storage Sandbox transport gate             |
| `ABL_STAGE_PRIVATE_STORAGE_PREVIEW_TOKEN_B64` | fixed body broker                  | Infrastructure Custodian       | same token, decoded into broker-only file          |
| `ABL_STAGE_PUBLIC_API_PREVIEW_TOKEN`          | core/arena                         | Infrastructure Custodian       | private projection Sandbox transport gate          |
| `ABL_STAGE_ARENA_PREVIEW_TOKEN`               | local spectator/operator only      | Infrastructure Custodian       | private arena Sandbox transport gate               |
| staging checkpoint signer key file            | local checkpoint helper            | Staging Integrity Operator     | ephemeral 1-of-1 rehearsal authorization only      |
| Neon Console session                          | database provisioning browser only | Michael Preuss                 | project create/delete; no persistent API key used  |
| Blaxel CLI token                              | local CLI only                     | existing authenticated session | control plane; never copied to workload env        |

The Gate 2 fixed broker sets `ABL_MODEL_ROUTE_MODE=DISABLED` and receives no model origin or credential. The body signer address, admitted-agent registry, empty witness registry, nonsecret institutional registry, policies, DIDs, origins, dates, evidence digests, and image digests are configuration—not secrets—but must still be reviewed for consistency.

## Cost and quote boundary

Pricing was retrieved on 2026-08-19 from [Blaxel pricing](https://blaxel.ai/pricing) and [Neon pricing](https://neon.com/pricing). It must be rechecked at approval time.

- Blaxel lists Sandbox active compute at USD 0.0000115 per GiB-second. The five Sandboxes total 9.5 GiB; if all remain active for the absolute four-hour maximum, the public-rate estimate is USD 1.5732.
- Blaxel currently labels Agent Drive storage and operations free during beta, but private-preview limits, future pricing, and any account-specific charges must be confirmed in the approval quote. No Volume cost is proposed.
- Blaxel lists Sandbox snapshot storage at USD 0.20/GiB-month and images at USD 0.045/GiB-month. Exact snapshot and built-image sizes are unknown until built.
- Gate 2 uses no Agent Runtime workloads, removing the unpublished Agent-rate dependency. The authenticated console preflight still remains mandatory because credits, top-up state, account-specific limits, image sizes, and preview behavior can change.
- The scenario makes zero model calls, so authorized model cost is USD 0.
- Neon Free can be USD 0 if the account remains within allowance. Neon Launch lists USD 0.106/CU-hour and USD 0.35/GB-month. At the proposed 2 CU maximum for four active hours, compute is at most USD 0.848 before storage/history; actual autoscaling should be lower.
- Witness participation cost is USD 0 because no witness service is used in this private rehearsal.

The hard all-in authorization ceiling is USD 10. If the console cannot show current credit, top-up behavior, and a quote below the cap, deployment stops. If automatic top-up cannot be disabled or a hard account limit cannot be verified, the approver must explicitly accept credit consumption up to—but never above—the USD 10 packet cap. Recurring cost after verified teardown must be USD 0. Any retained evidence must be local, not a billable workload, preview, or Drive.

## Proposed execution commands

Every command in this section is authorized only within approval `ABL-GATE2-2026-08-21-01` and the remaining prerequisites above. Use a fresh terminal and keep all generated files outside the repository.

### 1. Freeze source and local artifacts

```sh
export PATH=/private/tmp/abl-node-24.18.0.Nk7XCv/node-v24.18.0-darwin-arm64/bin:$PATH
export ABL_REPOSITORY="$(git rev-parse --show-toplevel)"
export ABL_GATE2_WORKDIR="$(mktemp -d /private/tmp/abl-gate2.XXXXXX)"
chmod 700 "$ABL_GATE2_WORKDIR"
cd "$ABL_REPOSITORY"
node --version
pnpm --version
git status --short >"$ABL_GATE2_WORKDIR/git-status.txt"
git diff --binary >"$ABL_GATE2_WORKDIR/reviewed-source.patch"
shasum -a 256 "$ABL_GATE2_WORKDIR/reviewed-source.patch" >"$ABL_GATE2_WORKDIR/reviewed-source.patch.sha256"
pnpm test:all
pnpm evidence
pnpm staging:prepare-images "$ABL_GATE2_WORKDIR/images" >"$ABL_GATE2_WORKDIR/image-contexts.json"
```

Run non-mutating configuration validation before approval is consumed:

```sh
for context in core-api public-api storage-broker arena; do
  (cd "$ABL_GATE2_WORKDIR/images/$context" && bl deploy --dryrun -w agent-basketball-league)
done
(cd "$ABL_REPOSITORY" && bl deploy --dryrun --type sandbox -w agent-basketball-league)
```

### 2. Preflight the external state

```sh
bl workspaces
bl get agents -o json -w agent-basketball-league
bl get sandboxes -o json -w agent-basketball-league
bl get volumes -o json -w agent-basketball-league
bl get drives -o json -w agent-basketball-league
bl get previews -o json -w agent-basketball-league
bl get functions -o json -w agent-basketball-league
bl get jobs -o json -w agent-basketball-league
bl get policies -o json -w agent-basketball-league
```

Stop if any proposed name already exists. Separately capture the console credit balance, top-up state, quota, region availability, and price quote into the approval record. Never screenshot or record tokens.

### 3. Provision the approved temporary database

The Database Custodian creates a new `abl-stage-gate2` project through the authenticated Neon Console, configures PostgreSQL 17 in `aws-us-west-2` with 0.25–2 CU and five-minute scale-to-zero, records the project ID, and saves pooled and direct TLS connection strings only in the external mode-0600 environment file. The pooled URL is supplied to the core runtime and the direct URL is used only for migration and administrative probes. No persistent Neon API credential is created for this run.

If the Console requires a paid-plan change, payment method, region change, compute above 2 CU, or another material variance, stop and amend the approval rather than improvising. Store the pooled URL as `ABL_STAGE_DATABASE_URL` and the direct URL as `ABL_STAGE_DATABASE_URL_UNPOOLED`; only the pooled value is injected into Blaxel. Apply the repository’s existing canonical migrations with the direct URL, then run a transaction/reconnect probe before any Blaxel workload starts.

### 4. Prepare identities and configuration

Generate the body and staging-checkpoint keys outside the repository with mode 0600. Derive their public addresses locally; never print the private values. Assemble `$ABL_GATE2_WORKDIR/gate2.env` with every manifest variable and secret inventory item. The admitted-agent registry must authorize the body DID, derived signer address, and only `game-possession` for the submitted canonical command.

Set `ABL_STAGE_CHECKPOINT_PUBLICATIONS_JSON=[]` for the first public-API start. The public API treats an empty list as no checkpoint, not as passed evidence. Set the signer registry and policy to reviewed JSON values and use an empty witness registry for this run.

### 5. Build and push immutable images

This step spends credits and mutates the Blaxel image registry:

```sh
(cd "$ABL_GATE2_WORKDIR/images/core-api" && bl push --name abl-stage-core-api --type sandbox --yes -o json -w agent-basketball-league) >"$ABL_GATE2_WORKDIR/core-image.json"
(cd "$ABL_GATE2_WORKDIR/images/storage-broker" && bl push --name abl-stage-storage-broker --type sandbox --yes -o json -w agent-basketball-league) >"$ABL_GATE2_WORKDIR/storage-image.json"
(cd "$ABL_GATE2_WORKDIR/images/public-api" && bl push --name abl-stage-public-api --type sandbox --yes -o json -w agent-basketball-league) >"$ABL_GATE2_WORKDIR/public-image.json"
(cd "$ABL_GATE2_WORKDIR/images/arena" && bl push --name abl-stage-arena --type sandbox --yes -o json -w agent-basketball-league) >"$ABL_GATE2_WORKDIR/arena-image.json"
(cd "$ABL_REPOSITORY" && bl push --name abl-stage-player-body --type sandbox --yes -o json -w agent-basketball-league) >"$ABL_GATE2_WORKDIR/body-image.json"
chmod 600 "$ABL_GATE2_WORKDIR"/*-image.json
```

Extract and verify immutable identifiers from the returned JSON, record them beside the reviewed source digest, and populate only those identifiers in `gate2.env`. Stop if the API supplies only a mutable tag.

### 6. Create the permissioned Agent Drive

Create the Drive with both ACL rules in the initial request. Never create it first and add permissions later: a Drive with no rules is accessible to any workload in the workspace. Derive the request from the reviewed source rather than retyping it:

```sh
export ABL_BLAXEL_TOKEN="$(bl token agent-basketball-league)"
jq '{metadata:.drive.metadata,spec:.drive.spec}' \
  infra/blaxel/staging/drive-access.json \
  >"$ABL_GATE2_WORKDIR/drive-create.json"
curl -fsS https://api.blaxel.ai/v0/drives \
  -H "Authorization: Bearer $ABL_BLAXEL_TOKEN" \
  -H 'X-Blaxel-Workspace: agent-basketball-league' \
  -H 'Content-Type: application/json' \
  --data-binary "@$ABL_GATE2_WORKDIR/drive-create.json" \
  >"$ABL_GATE2_WORKDIR/drive-create-response.json"
chmod 600 "$ABL_GATE2_WORKDIR/drive-create-response.json"
unset ABL_BLAXEL_TOKEN
```

Retrieve the Drive through the API and compare its name, `us-was-1` region, two rules, label pairs, modes, and exact paths to [`drive-access.json`](../../infra/blaxel/staging/drive-access.json). Stop if either rule is absent or widened. Do not use the S3 endpoint or create a service-account S3 key.

### 7. Create, mount, and privately expose the Drive-backed Sandboxes

```sh
bl apply -f infra/blaxel/staging/storage-broker.yaml -e "$ABL_GATE2_WORKDIR/gate2.env" -w agent-basketball-league
bl apply -f infra/blaxel/staging/public-api.yaml -e "$ABL_GATE2_WORKDIR/gate2.env" -w agent-basketball-league
bl drive mount --sandbox abl-stage-storage-broker --drive abl-stage-durable-state \
  --mount-path /mnt/abl-stage-ciphertext --drive-path /ciphertext \
  --uid-map 1000 --gid-map 1000 -w agent-basketball-league
bl drive mount --sandbox abl-stage-public-api --drive abl-stage-durable-state \
  --mount-path /mnt/abl-stage-projections --drive-path /projections \
  --uid-map 1000 --gid-map 1000 -w agent-basketball-league
```

Verify the two mounts, start each reviewed `node dist/index.js` service in `/opt/abl` through the Sandbox process API, and require a passing local health probe on port 3000 before creating previews. Then create exactly two private previews on port 3000 through `POST /v0/sandboxes/{sandbox}/previews`, with `public:false` and a TTL no longer than four hours. Create a token for each through `POST /v0/sandboxes/{sandbox}/previews/{preview}/tokens`, expiring no later than the hard stop. Record preview URLs and tokens only in the mode-0600 external environment file. Set:

- `ABL_STAGE_PRIVATE_STORAGE_ORIGIN` and `ABL_STAGE_PRIVATE_STORAGE_PREVIEW_TOKEN` from `abl-stage-storage-broker-private`;
- `ABL_STAGE_PRIVATE_STORAGE_PREVIEW_TOKEN_B64` to canonical Base64 of the same token for the fixed body broker;
- `ABL_STAGE_PRIVATE_PUBLIC_API_ORIGIN` and `ABL_STAGE_PUBLIC_API_PREVIEW_TOKEN` from `abl-stage-public-api-private`.

Confirm unauthenticated requests return a denial and authenticated health requests pass. The token is transport access only; application HMAC verification remains mandatory.

### 8. Create and privately expose core, arena, and body in dependency order

```sh
bl apply -f infra/blaxel/staging/core-api.yaml -e "$ABL_GATE2_WORKDIR/gate2.env" -w agent-basketball-league
```

After applying core, start `node dist/index.js` in `/opt/abl` through the Sandbox process API and require a local port-3000 health pass. Create `abl-stage-core-api-private` with `public:false`, issue a token expiring at the hard stop, and place its origin and token only in the external environment as `ABL_STAGE_PRIVATE_CORE_ORIGIN` and `ABL_STAGE_PRIVATE_CORE_PREVIEW_TOKEN`. Set `ABL_STAGE_PRIVATE_CORE_PREVIEW_TOKEN_B64` to canonical Base64 of that token for the fixed body broker, then apply the body only after this value and the storage-preview value exist.

```sh
bl apply -f infra/blaxel/staging/arena.yaml -e "$ABL_GATE2_WORKDIR/gate2.env" -w agent-basketball-league
```

After applying arena, start `node server.js` in `/opt/abl`, require a local port-3000 health pass, create `abl-stage-arena-private` with `public:false`, and issue a token expiring at the hard stop. Store its origin and token only as `ABL_STAGE_PRIVATE_ARENA_ORIGIN` and `ABL_STAGE_ARENA_PREVIEW_TOKEN`; the latter is held by the local spectator/operator and is not passed to another workload.

After both service-preview tokens have been added to the external environment, apply the body:

```sh
bl apply -f infra/blaxel/staging/body-sandbox.yaml -e "$ABL_GATE2_WORKDIR/gate2.env" -w agent-basketball-league
```

The body has no preview. After each command, inspect status and logs. Do not continue past a failed health check or unauthenticated-preview denial. Record the first activation timestamp; the hard teardown deadline is four hours later. Exactly four private previews now exist: core, storage broker, public API, and arena.

### 9. Install and execute the body program

The generated `body-program/agent` directory contains no credential. `staging:prepare-images` also creates and validates `body-program.tgz` with macOS copyfile metadata disabled, rejecting AppleDouble entries, absolute or traversal paths, escaping links, set-ID files, and any member outside `agent/`. Upload that recorded artifact through the Sandbox filesystem API, extract it as `/workspace/agent`, and start the immutable launcher through the process API. Use JSON request files for process commands so shell escaping cannot alter them.

```sh
pnpm staging:upload-body "$ABL_GATE2_WORKDIR/images/body-program.tgz" abl-stage-player-body-001 agent-basketball-league us-was-1
bl run sandbox abl-stage-player-body-001 --path /process --file "$ABL_GATE2_WORKDIR/install-body-process.json" -w agent-basketball-league
bl run sandbox abl-stage-player-body-001 --path /process --file "$ABL_GATE2_WORKDIR/run-body-process.json" -w agent-basketball-league
```

The install request must extract only the reviewed archive under the ephemeral `/workspace`, verify its recorded digest, and leave `/workspace/agent/main.mjs` owned by the admitted UID. No signing key, preview token, Drive credential, or durable private state is uploaded there.

## First staging scenario and acceptance

The only authorized scenario is one deterministic first possession by `did:abl:stage-player-001`:

1. The persistent body receives the deterministic partial observations and chooses HOLD, HOLD, then LAYUP.
2. The fixed local broker signs three player decisions and one `PossessionResolved` canonical event for that DID and only the allowlisted event classes.
3. The fixed broker submits the signed command to private core.
4. Core verifies DID, signer, content commitments, decision proofs, nonce, timestamp, aggregate authority, expected version, and idempotency.
5. PostgreSQL commits the event, idempotency record, and outbox transactionally.
6. The projection worker authenticates to the private public API and appends the projection.
7. The private arena renders the fixture-free projection and visibly labels it pre-Genesis rehearsal.
8. The staged event hash is used to prepare a signed GAME checkpoint publication with the ephemeral 1-of-1 staging `PROJECTOR` key.
9. `gate2.env` is updated with the exact publication and only `abl-stage-public-api` is reapplied.
10. The public verifier reports `SIGNED_VALID` while `canonical=false`, `recognized=false`, and Genesis remains closed.

Acceptance requires all of the following evidence:

- private health/status for all five workloads;
- body receipt event hash and public signer address, with no private key or preview token in the admitted process environment or `/workspace`;
- one PostgreSQL event, matching aggregate version, idempotency record, and delivered outbox record;
- projection cursor/event hash equality and arena screenshot/text showing rehearsal status;
- restart of storage broker, public API, core API, and body Sandbox followed by exact recovery;
- retry of the identical command returning the prior accepted result without a duplicate event;
- rejected unsigned, wrong-DID, former-operator, expired, replay-conflicting, payload-tampered, and unauthorized aggregate commands;
- public API and arena inability to reach `/v1/commands` or PostgreSQL;
- body inability to reach PostgreSQL, raw Volume/Drive controls, Drive HTTP/S3 endpoints, Blaxel control plane, or broker secret files;
- Drive ACL denial for the body, arena, core, storage broker against `/projections`, and public API against `/ciphertext` as applicable;
- ciphertext Drive subtree containing no plaintext sample and recovering metadata/version after process restart and Sandbox recreation;
- projection Drive subtree recovering exact cursors after process restart and Sandbox recreation;
- exact replay from database events producing the same state root and projection;
- one valid signed staging checkpoint with an empty witness registry;
- verifier result `SIGNED_VALID`, `canonical=false`, `recognized=false`;
- zero model calls and zero public ingress;
- provider usage and spend below the USD 10 cap.

## Observability

At activation, after the possession, after every restart, and before teardown, capture:

- `bl get` status JSON for Sandboxes, Drive, mounts, and all four private previews;
- redacted workload logs showing request IDs, event hashes, projection cursors, health, retries, and errors but no content/secrets;
- PostgreSQL connection, transaction, outbox lag, row counts, and export digest;
- storage-broker recovery status and ciphertext metadata digest;
- arena/public API response status and rendered pre-Genesis label;
- empty witness registry, publication digest, and verifier output;
- Blaxel usage/credit delta and Neon usage delta;
- incident timeline and rollback action, if any.

OpenTelemetry and content telemetry remain disabled for this run. Logs must not include request bodies, plaintext, database URLs, authorization headers, HMACs, private keys, provider tokens, or witness secrets.

## Failure, rollback, and recovery

Any failed authority check, unexpected public route, secret exposure, mismatch in image/source digest, event/projection mismatch, duplicate canonical row, recovery failure, checkpoint mismatch, provider quote increase, cost-cap breach, or unplanned resource is a stop condition.

Rollback order:

1. Stop invoking the body and preserve only nonsecret diagnostic identifiers.
2. Delete `abl-stage-player-body-001` to remove active body authority.
3. Delete the arena, core, public-API, and storage-broker private previews and Sandboxes; do not delete the Drive yet.
4. Export the PostgreSQL event/outbox evidence and ciphertext/projection directory digests without plaintext.
5. If recovery is being tested, recreate only the failed workload from the same immutable image and unchanged manifest, prove recovery, then delete it again.
6. Complete full teardown below.
7. Record an incident in the launch ledger before any new run.

No rollback may rewrite an accepted event, substitute a different image under the same digest, lower a signature threshold, label rehearsal data canonical, or keep a workload active beyond the approval window.

## Deterministic teardown

Deletion is destructive and must run only after exact-name inventory and approved evidence export. The Drive is deliberately deleted last.

```sh
bl get sandbox abl-stage-player-body-001 -o json -w agent-basketball-league
bl delete sandbox abl-stage-player-body-001 -w agent-basketball-league

bl get sandbox abl-stage-arena -o json -w agent-basketball-league
bl get sandbox abl-stage-core-api -o json -w agent-basketball-league
bl get sandbox abl-stage-public-api -o json -w agent-basketball-league
bl get sandbox abl-stage-storage-broker -o json -w agent-basketball-league
bl delete sandbox abl-stage-arena abl-stage-core-api abl-stage-public-api abl-stage-storage-broker -w agent-basketball-league

bl drive get abl-stage-durable-state -o json -w agent-basketball-league
bl drive delete abl-stage-durable-state -w agent-basketball-league

bl delete image abl-stage-core-api abl-stage-storage-broker abl-stage-public-api abl-stage-arena abl-stage-player-body -w agent-basketball-league
```

The Database Custodian verifies the exact Neon project ID from the creation receipt, exports the nonsecret evidence digest, and deletes that exact project through the authenticated Neon Console after action-time confirmation. Do not create a persistent API key solely for teardown.

Finally verify the workspace contains no proposed Agent, Sandbox, Volume, image, Drive, Function, Job, Policy, private or public preview, or custom domain; verify the database project is absent; record final usage; securely remove the external secret/work directory; and record recurring cost as zero. Do not delete the pre-existing `sandbox-openai` model.

## Evidence record

The run must produce one redacted, checksummed evidence directory outside the repository containing:

- completed approval form and provider quote timestamp;
- source patch digest, exact runtime versions, test result, and evidence digest;
- immutable image identifiers and build receipts;
- preflight and post-teardown resource inventories;
- redacted deployment/status/log records;
- database profile, migrations, event/outbox export digest, restart/replay results;
- storage restart/parity results and ciphertext-only proof;
- projection/public API/arena response evidence;
- negative authorization and isolation results;
- checkpoint manifest, institutional signature, empty witness registry, and verifier output;
- usage and cost before/after;
- incident and rollback record, even if empty;
- teardown confirmations and a final `resources absent` assertion derived from provider output.

Live results may be added to repository evidence only through a later reviewed change that labels scope and limitations accurately. Staging evidence cannot make history canonical or authorize Genesis.

## Separate approvals after this run

Every item below remains a separate decision even if this packet succeeds:

- any second staging run or longer retention;
- any model inference or provider credential use;
- any additional staging Drive, production Drive, or Drive retention beyond the approved teardown window;
- candidate-edge deployment, invitation, or public/capped intake;
- public discovery, arena, API, MCP, A2A, preview, or custom domain exposure;
- managed PostgreSQL production provider selection;
- creation or modification of `abl-core`, `abl-private`, `abl-competition`, or `abl-public`;
- recurring capacity, schedules, jobs, or automatic provisioning;
- selecting or admitting founding agents;
- constitutional or founding-agent decisions and signatures;
- production release authorization;
- Base Sepolia testing, recognition-contract deployment, or any checkpoint broadcast;
- Base mainnet use;
- recovery-control removal;
- Genesis or canonical-history opening;
- Git commit, push, pull request, merge, release, or registry publication.

## Explicit safety confirmation

As proposed, this deployment is:

- **private**: no public ingress or public trigger;
- **pre-Genesis**: the operating profile and arena remain rehearsal-labeled;
- **reversible**: exact workloads, storage, images, and temporary database have teardown steps;
- **noncanonical**: the recognition anchor is unratified, there is no transaction, and `canonical=false`;
- **bounded in cost**: five Sandboxes, one permissioned Drive, four private previews, four-hour maximum, zero model calls, USD 10 hard ceiling, mandatory quote preflight;
- **unable to create recognized history without valid agent authority**: core verifies the admitted DID/signature/aggregate and the fixed broker cannot sign other DIDs or event classes;
- **unable to expose personal plaintext through spectator or public paths**: personal content is encrypted inside the broker boundary, public services receive projections only, and the arena has no private-storage authority.

Execution has reached the validated temporary Neon PostgreSQL 17 database and fresh Blaxel preflight without a Blaxel mutation. This packet does not authorize an improvised storage topology or any action outside the exact bounded run. It does not authorize public exposure, candidate intake, founding-agent decisions, recognition broadcast, recurring capacity, recovery-control removal, Git publication, or Genesis.
