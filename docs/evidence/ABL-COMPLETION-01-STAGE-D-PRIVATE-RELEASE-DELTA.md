# ABL Completion 01 — merged private release delta

Status: `PASS`

Recorded: `2026-08-25`

Stage C release: `ad73a9ff151ac5599ad90e581114ebf179d9e848`

Target release: `802081ffb53ce8f9207df56779cfb3ceaa1e424c`

Workspace: `agent-basketball-league`

Public exposure: `NONE`

Assessment result digest: `0xa36f71ec431f2ea858dfb36a5e97b474855347abfb1bcd96ff7641783a9a440f`

## Outcome

The merged release was installed into the existing retained private deployment without creating another Blaxel workspace. All thirteen declared workloads report the exact target-release label, reviewed trust-domain label, and provider immutable image reference. The seven Sandboxes and four persistent Functions recovered after restart. Both Jobs remain deployed.

The private vertical path passed from a signed player possession through core validation, PostgreSQL transaction and outbox, projection, public read model, and spectator-facing API. The accepted event remains available after service restart with an equal replay root. Unsigned, wrong-role, stale, duplicate, and direct-projection mutation cases remained rejected. The resulting history remains `PRE_GENESIS_EXPERIMENT`, noncanonical, and no higher than `SIGNED_VALID`.

All seven Sandbox previews remain `public:false`. An unauthenticated request to every preview returned `401`; the corresponding private-token request returned `200`. All four MCP Functions remain private and passed fresh MCP `initialize` and `tools/list` probes.

The retained Neon project is `shy-pine-00200479`, named `agent-basketball-league`, on the Free plan in `aws-us-east-1`. It reports PostgreSQL 17, one `main` branch (`br-mute-sound-au3izgso`), and exactly 23 public tables. The final direct-TLS read found two recognized events and two outbox rows.

## Cost policy

The owner removed the USD 25/month launch ceiling as a hard constraint. The current USD 21.9084/month infrastructure estimate is advisory and remains visible for waste control; it cannot fail this release. The observed Blaxel release delta was USD 0.79, the final balance was USD 1,005.97, automatic top-up was off, monthly top-up was not configured, and no payment method was configured. The retained hard billing safeguards are the USD 5 balance floor and automatic top-up remaining off.

## Contained credential-handling event

During private operator diagnostics, one command emitted resolved configuration values into the private execution transcript. This was contained before public exposure: all affected database roles, service credentials, HMAC material, application authority values, and preview tokens were rotated; old database credentials were verified rejected; the Sandboxes and previews were recreated with the new values; and the complete private path passed afterward. No secret value is present in the committed evidence. The event caused no public access, canonical claim, Genesis claim, replay divergence, or unrecoverable restart, so it is not classified as a P0, P1, or privacy breach. It remains recorded here as an operational lesson: diagnostic commands must select explicit non-secret fields and must never dump resolved manifests.

## Evidence basis

- Machine-readable release evidence: [`ABL-COMPLETION-01-STAGE-D-PRIVATE-RELEASE-DELTA.json`](./ABL-COMPLETION-01-STAGE-D-PRIVATE-RELEASE-DELTA.json)
- Accepted Stage C handoff: [`ABL-COMPLETION-01-STAGE-C-OWNER-ACCEPTANCE-01.md`](./ABL-COMPLETION-01-STAGE-C-OWNER-ACCEPTANCE-01.md)
- Stage C technical observation: [`ABL-COMPLETION-01-STAGE-C-R04.json`](./ABL-COMPLETION-01-STAGE-C-R04.json)
- Deployment map: [`deployment-map.json`](../../infra/blaxel/persistent-pre-genesis/deployment-map.json)
- Stage D runbook: [`STAGE_D_PUBLIC_BEACON.md`](../launch/STAGE_D_PUBLIC_BEACON.md)

## Remaining gate

The private build and retained deployment are ready for the first-public-exposure decision. This evidence does not itself create public ingress, open candidate intake, activate Genesis, make canonical-history claims, authorize model calls, or broadcast recognition. Those actions remain in the single public activation approval.
