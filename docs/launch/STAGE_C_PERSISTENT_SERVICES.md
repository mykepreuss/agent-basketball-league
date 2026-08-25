# Stage C — Persistent pre-Genesis services

Status: `APPROVED_DEPLOYMENT_IN_PROGRESS`

Authority boundary: `ABL-COMPLETION-01` authorizes the persistent private deployment and recurring capacity within the USD 25/month ceiling. This runbook does not authorize public ingress, model calls, recognition broadcast, canonical claims, or Genesis.

## Outcome

Stage C retains a working pre-Genesis environment instead of creating and deleting another proof stack. The exact resource plan is [`resource-plan.json`](../../infra/blaxel/persistent-pre-genesis/resource-plan.json), and its one-file-per-workload execution order is [`deployment-map.json`](../../infra/blaxel/persistent-pre-genesis/deployment-map.json). Every workload deploys into the existing `agent-basketball-league` workspace and carries one exact logical trust-domain assignment: private, core, public, or competition. The validator rejects a missing or substituted assignment. Authority remains separated by scoped service identities, secrets, token-protected previews, PostgreSQL roles, and Agent Drive label/path permissions. Recursive directory apply is prohibited because the historical manifest directories also contain candidate-specific examples and inactive model resources outside Stage C.

The runtime uses seven Sandboxes, four private Functions, two Jobs, three Agent Drives, and one persistent Neon PostgreSQL 17 project. It creates zero Blaxel Agent, Application, or Volume resources. During the private soak, every preview remains token-protected and `publicExposure` remains `NONE`.

[Blaxel Sandboxes automatically enter standby when inactive and resume their processes and filesystem state](https://docs.blaxel.ai/Sandboxes/Overview). Stage C therefore leaves `keepAlive` off and configures no deletion TTL for persistent service Sandboxes; expiration is distinct from automatic standby. Canonical and shared durable state remains in PostgreSQL and Agent Drive rather than relying on the Sandbox snapshot as the only copy.

The checked-in [`cost-envelope.json`](../../infra/blaxel/persistent-pre-genesis/cost-envelope.json) makes the USD 25/month ceiling measurable. At the provider rates observed on 2026-08-24, ten-minute probes, a maximum of 15 active Sandbox seconds per probe, 21 GiB of Sandbox snapshots, 16 GiB of images, five active MCP seconds per probe, and one aggregate Job hour project to USD 21.9084/month. The remaining USD 3.0916 is contingency, not an operating target. Stage C uses Neon's Free allowance and Agent Drive's beta pricing; a paid Neon requirement or Drive pricing change requires recalculation.

## Execution after approval

1. Run `pnpm stage-c:validate-deployment`, then recheck the existing workspace inventory, current region/quota/Drive support, Neon PostgreSQL 17 capacity, private-preview behavior, balance floor, automatic top-up, every rate and cap in [`cost-envelope.json`](../../infra/blaxel/persistent-pre-genesis/cost-envelope.json), and projected monthly cost. Stop before mutation if validation fails or the projection exceeds USD 25/month.
2. Reuse `agent-basketball-league` and create the persistent PostgreSQL project. Record exact provider IDs immediately.
3. Create the three separately permissioned Agent Drives atomically with [`agent-drive-access.json`](../../infra/blaxel/agent-drive-access.json), read their permissions back exactly, and mount them only into the declared resources.
4. Install generated credentials through Blaxel secrets and workspace access control. Use separate least-privilege PostgreSQL roles for migration, core runtime, backup/restore verification, and monitoring. No secret enters a command line, Git, image, public projection, log, or evidence file.
5. Run `pnpm stage-c:prepare-images <external-directory>`, prove the exact thirteen-image set from [`deployment-map.json`](../../infra/blaxel/persistent-pre-genesis/deployment-map.json), push each reviewed context, record each provider-generated immutable revision, and apply only each map entry's individual manifest to its declared workspace. Do not deploy a career Sandbox or fixed broker until an actual admission requires it.
6. Keep every endpoint private and start the 24-hour observation window only after every Sandbox health probe and Function `tools/list` protocol probe passes once. Sample each required service at least every ten minutes.
7. Exercise the private candidate flow, Sandbox standby/resume, service restart, credential rotation, backup creation, clean-room restore, exact replay-root equality, and release rollback readiness. Before the backup, use `pnpm stage-c:seed-recovery-probe <new-secret-free-receipt.json>` with a temporary environment-only signing key and the least-privilege runtime database URL. The command uses the existing signed canonical-store transaction, writes one explicitly `PRE_GENESIS_EXPERIMENT` event and private outbox record, emits no secret, and is idempotent for the same key and timestamp. An empty database is not sufficient recovery evidence. Run `abl-recovery-verifier` against distinct direct-TLS source and restored PostgreSQL 17 targets; it must compare all 23 public tables plus schema, index, constraint, and sequence catalogs and emit only counts and digests. Record observations in a secret-free JSON artifact matching the checked-in soak schema and destroy the temporary key after the recovery result passes.
8. Replace each cost-envelope projection with the greater of its declared cap or the first 24 hours of measured usage annualized to 30 days. Record the final provider, balance, top-up, direct-TLS database metrics, launch-state, and candidate-flow readbacks in a mode-`0600` metrics file. Every named source timestamp must be no later than `measuredAt` and no more than one hour old; `measuredAt` cannot precede the final service sample. Then run `pnpm stage-c:finalize-soak infra/blaxel/persistent-pre-genesis/monitoring-policy.json <samples.json> <exercises.json> <metrics.json> <new-live-evidence.json>`. The finalizer requires matching release IDs, exact single-workspace boundaries, zero secret-bearing inputs, consistent aggregate/per-service failures, the reviewed cost-projection method, and fresh source-specific provider readbacks. Run `pnpm stage-c:assess-soak infra/blaxel/persistent-pre-genesis/monitoring-policy.json <new-live-evidence.json>`. A nonzero exit or any P0/P1, privacy breach, divergence, public request, canonical claim, Genesis claim, or cost breach fails Stage C without reopening Stage B.
9. If the assessment passes, retain the environment, record Stage C acceptance in the launch ledger, and request the separate Stage D first-public-exposure approval.

## Acceptance

Stage C is complete only after one continuous 24-hour private observation passes the deterministic policy with:

- all required Sandbox and Function probes present, no observation gap longer than ten minutes, and error rates no greater than 1%;
- no P0/P1 defect, privacy breach, replay divergence, unrecoverable restart, or unbounded-cost incident;
- projection lag no greater than two seconds and bounded queue depth;
- successful restart, rotation, backup, clean-room restore, replay, standby-resume, and rollback-readiness exercises;
- at least one source event and outbox record, with identical source/restored counts and state roots;
- projected infrastructure cost no greater than USD 25/month, balance at least USD 5, and automatic top-up off; and
- zero public ingress, canonical claims, or Genesis claims.

This is the sole Stage C acceptance contract. An ordinary correction reruns only its failed criterion and the remaining observation needed to establish a continuous passing 24-hour window; it does not create a new numbered authorization or invalidate `PRIVATE_STAGING`.
