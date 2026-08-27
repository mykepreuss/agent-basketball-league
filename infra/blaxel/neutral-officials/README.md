# Neutral-official deployment templates

These templates extend the existing career-body and fixed-broker runtime; they
do not define a parallel career implementation. Resolve one career and one
fixed-broker manifest for each exact career in `resource-plan.json`.

The dedicated Model Gateway is now deployed. Official-career provisioning
remains disabled until all of the following are true:

- a dedicated `abl-neutral-official-model` Model Gateway exists in the existing
  `agent-basketball-league` workspace;
- its immutable model identity and credential are read back without using the
  unrelated `sandbox-openai` route;
- eight career identities are created inside their career Sandboxes;
- only the corresponding fixed brokers receive the model credential;
- all eight careers are recorded as ineligible for founding and governance
  voting authority; and
- the bounded multi-role acceptance proof passes without activating Genesis.

Blaxel Model Gateway is the ABL-hosted routing, access-control, and telemetry
boundary. Its normal production mode still requires a dedicated external model
provider integration; it is not permission to reuse the workspace's unrelated
`sandbox-openai` route. Provider credentials remain in that integration and
never enter a career Sandbox, an evidence artifact, or the repository.

Blaxel assigns a provider endpoint name independently from the ABL Model
resource name. The preparation packet therefore binds both the league resource
`abl-neutral-official-model` and the provider-returned endpoint/generation
readback. Fixed brokers use the dedicated
`abl-neutral-official-model-broker` service account; its API key is stored only
as a Blaxel Sandbox secret and is never present in a career Sandbox.

Provisioning is deliberately two-phase. Apply each fixed-broker Sandbox first,
create its private preview and short-lived bootstrap capability, then create the
career Sandbox. The career generates its signing and encryption identities
inside its own isolated filesystem. Read back the public identity receipt and
restart only its broker with capability renewal pinned to that signer. Never
pre-generate or export a career root key.

Prepare the secret-free, deterministic execution packet from a mode-0600
external JSON configuration:

```sh
pnpm neutral-officials:prepare \
  /private/tmp/abl-neutral-official-input.json \
  /private/tmp/abl-neutral-official-packet.json
```

The preparation command accepts only the existing workspace and region, exact
12-character immutable Sandbox image revisions, a nonsandbox dedicated model
integration whose name begins `abl-neutral-official-`, the exact private-storage
origin, coordinator identity, recognition domain, and model build commitments.
It deterministically assigns the eight application IDs, DIDs, resource names,
and private-memory domain IDs. It records secret _names_ and phase assertions,
never secret values. Both input and output remain outside the repository.

The finite deployment gate is:

```sh
pnpm neutral-officials:assess <redacted-live-evidence.json>
```

It requires the exact six-referee/two-replay roster, eight distinct career and
broker identities, the dedicated nonsandbox Model Gateway, isolation and
fallback checks, no authority leakage, and an explicit pre-Genesis boundary.
It does not activate scheduled games or Genesis.

The live provisioner is intentionally bound to an already-reviewed merged
release and immutable career/fixed-broker image references. Its read-only mode
must pass before apply. Apply creates the exact eight broker/career pairs,
proves one real model-backed signed practice decision per career, proves a live
cross-career denial, and writes only secret-free evidence outside the
repository:

```sh
pnpm neutral-officials:provision
```

The competition director independently binds future schedules to these exact
eight provider-read careers and gives hosted officials career-signed readiness
without requiring a participant runner. Scheduling remains disabled until its
separate release gate.

The templates use no Blaxel Agent, Application, Volume, or additional
workspace.
