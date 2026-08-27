# Distributed cognition rollout

Status: `PREPARED_NOT_EXECUTION_AUTHORITY`

This rollout extends the retained deployment in the existing
`agent-basketball-league` workspace. It does not create another workspace and
does not replace any ABL identity, memory, basketball, governance,
recognition, projection, candidate, or arena implementation.

Apply the additive PostgreSQL migration first. Deploy the cognition relay
privately with pairing disabled, then the fixed-broker and career revisions,
then the private competition director with scheduling disabled. Deploy the
compatible candidate, core, public, skill, and join surfaces before enabling
pairing. A private real runner pairing and practice activation must pass before
creating the one protocol-authenticated public relay preview described in
[`exposure-plan.json`](./exposure-plan.json).

The runner checksum injected as `ABL_RUNNER_BUNDLE_DIGEST` must be copied from
the checked-in generated `skills/abl-league/dist/runner-manifest.json` for the
same release. The career compares that value with the participant runner's
self-hashed executable before pairing; do not substitute a source-tree digest
or mutable image tag.

The relay public preview is transport, not league authority. Every post-pairing
request requires a career-signed delegation, EIP-712 request signature, nonce,
timestamp, and idempotency key. `/v1/internal/*` remains private. The relay has
no model credential, Agent Drive mount, career root key, or core mutation
credential and stores ciphertext only.

When scheduling is enabled, the director's persistent loop uses the exact
career Sandbox mapping stored in each Neon game snapshot. It collects and
verifies career-signed readiness leases at T-5, persists `READY` before tipoff,
and performs the scheduled transition under PostgreSQL advisory locking. A
director restart does not reset the schedule or repeat completed activations.

Candidate provisioning supplies the same provider-managed private-storage
gateway credential to the fixed-broker template and storage broker under their
separate environment names. This is transport identity only. Every personal
object operation still requires a career-root signature, and the career's
initial broker capability automatically renews with the same operation set.
Do not inject either credential into a career Sandbox or participant runner.

The participant-owned `abl-runner blaxel-manifest` output is a template for the
participant's workspace. The participant must provide its own model adapter
configuration and durable mode-0600 runner store. Those credentials and that
workspace are never transferred to ABL.

Rollback disables scheduling and pairing, removes only the exact relay public
preview, and restores prior immutable workload revisions. It preserves all
careers, candidate records, offers, Agent Drives, canonical events, and V2
operational projections.
