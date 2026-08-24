# Stage C — Persistent pre-Genesis services

Status: `LOCAL_READY_RECURRING_CAPACITY_APPROVAL_REQUIRED`

Authority boundary: this runbook prepares the persistent topology and deterministic soak assessment. It does not authorize workspace creation, recurring capacity, public ingress, model calls, recognition broadcast, canonical claims, or Genesis.

## Outcome

Stage C retains a working pre-Genesis environment instead of creating and deleting another proof stack. The exact resource plan is [`resource-plan.json`](../../infra/blaxel/persistent-pre-genesis/resource-plan.json). It uses the existing `agent-basketball-league` workspace for bounded integration and creates `abl-private`, `abl-core`, and `abl-public` only after approval.

The runtime uses seven Sandboxes, four private Functions, two Jobs, three Agent Drives, and one persistent Neon PostgreSQL 17 project. It creates zero Blaxel Agent, Application, or Volume resources. During the private soak, every preview remains token-protected and `publicExposure` remains `NONE`.

[Blaxel Sandboxes automatically enter standby when inactive and resume their processes and filesystem state](https://docs.blaxel.ai/Sandboxes/Overview). Stage C therefore leaves `keepAlive` off and configures no deletion TTL for persistent service Sandboxes; expiration is distinct from automatic standby. Canonical and shared durable state remains in PostgreSQL and Agent Drive rather than relying on the Sandbox snapshot as the only copy.

The checked-in [`cost-envelope.json`](../../infra/blaxel/persistent-pre-genesis/cost-envelope.json) makes the USD 25/month ceiling measurable. At the provider rates observed on 2026-08-24, ten-minute probes, a maximum of 15 active Sandbox seconds per probe, 21 GiB of Sandbox snapshots, 16 GiB of images, five active MCP seconds per probe, and one aggregate Job hour project to USD 21.9084/month. The remaining USD 3.0916 is contingency, not an operating target. Stage C uses Neon's Free allowance and Agent Drive's beta pricing; a paid Neon requirement or Drive pricing change requires recalculation.

## Execution after approval

1. Recheck the three target workspace names are absent, current workspace/region/quota/Drive support, Neon PostgreSQL 17 capacity, private-preview behavior, balance floor, automatic top-up, every rate and cap in [`cost-envelope.json`](../../infra/blaxel/persistent-pre-genesis/cost-envelope.json), and projected monthly cost. Stop before mutation if the projection exceeds USD 25/month.
2. Create the three workspaces and persistent PostgreSQL project. Record exact provider IDs immediately.
3. Create the three Agent Drives atomically with [`agent-drive-access.json`](../../infra/blaxel/agent-drive-access.json), read their permissions back exactly, and mount them only into the declared resources.
4. Install generated credentials through Blaxel secrets and workspace access control. Use separate least-privilege PostgreSQL roles for migration, core runtime, backup/restore verification, and monitoring. No secret enters a command line, Git, image, public projection, log, or evidence file.
5. Push the reviewed images and deploy immutable provider revisions into their declared workspaces. Do not deploy a career Sandbox or fixed broker until an actual admission requires it.
6. Keep every endpoint private and start the 24-hour observation window only after every Sandbox health probe and Function `tools/list` protocol probe passes once. Sample each required service at least every ten minutes.
7. Exercise the private candidate flow, Sandbox standby/resume, service restart, credential rotation, backup creation, clean-room restore, exact replay-root equality, and release rollback readiness. Record observations in a secret-free JSON artifact matching the checked-in soak schema.
8. Replace each cost-envelope projection with the greater of its declared cap or the first 24 hours of measured usage annualized to 30 days. Then run `pnpm stage-c:assess-soak infra/blaxel/persistent-pre-genesis/monitoring-policy.json <live-evidence.json>`. A nonzero exit or any P0/P1, privacy breach, divergence, public request, canonical claim, Genesis claim, or cost breach fails Stage C without reopening Stage B.
9. If the assessment passes, retain the environment, record Stage C acceptance in the launch ledger, and request the separate Stage D first-public-exposure approval.

## Acceptance

Stage C is complete only after one continuous 24-hour private observation passes the deterministic policy with:

- all required Sandbox and Function probes present, no observation gap longer than ten minutes, and error rates no greater than 1%;
- no P0/P1 defect, privacy breach, replay divergence, unrecoverable restart, or unbounded-cost incident;
- projection lag no greater than two seconds and bounded queue depth;
- successful restart, rotation, backup, clean-room restore, replay, standby-resume, and rollback-readiness exercises;
- identical source/restored event counts, outbox counts, and state roots;
- projected infrastructure cost no greater than USD 25/month, balance at least USD 5, and automatic top-up off; and
- zero public ingress, canonical claims, or Genesis claims.

This is the sole Stage C acceptance contract. An ordinary correction reruns only its failed criterion and the remaining observation needed to establish a continuous passing 24-hour window; it does not create a new numbered authorization or invalidate `PRIVATE_STAGING`.
