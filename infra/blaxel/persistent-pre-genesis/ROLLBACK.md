# Persistent pre-Genesis rollback

Status: `LOCAL_PREPARED_NOT_APPLIED`

This runbook applies only to the approval-gated `ABL-COMPLETION-01` Stage C deployment described by [`resource-plan.json`](./resource-plan.json). It does not authorize provider mutation, broad cleanup, public exposure, or deletion of unrelated resources.

## Release rollback

1. Record every workload's workspace, exact name, provider revision, immutable image reference, configuration digest, and previous passing revision before promotion.
2. Stop candidate provisioning and projection publication if the new release produces a P0/P1 defect, privacy breach, replay divergence, or unbounded cost.
3. Restore the preceding immutable workload revision without changing the database schema or deleting Agent Drive data.
4. Reconnect from Sandbox standby, then verify health, signed-command rejection, outbox delivery, projection cursor, arena classification, encrypted storage, and replay roots.
5. Record the rollback and incident in the canonical launch ledger. A Stage C failure does not reopen accepted `PRIVATE_STAGING` evidence.

## Database recovery

Migrations are forward-only during Stage C. Do not improvise a reverse migration against the persistent canonical store. For a data-integrity failure, stop canonical writes, create a clean PostgreSQL 17 restore from the selected backup, apply the reviewed application revision to the restored database, and compare event count, outbox count, and exact state root. Resume only if [`pnpm stage-c:assess-soak`](../../../package.json) accepts the recovery evidence.

## Resource deletion

Successful Stage C resources are retained. Delete them only after an explicit decision to abandon or replace the persistent environment. Resolve every target by exact workspace, kind, and name from `resource-plan.json`; never use wildcards, workspace deletion, inferred names, or broad cleanup. The existing `agent-basketball-league` workspace and unrelated provider resources are never deletion targets.
