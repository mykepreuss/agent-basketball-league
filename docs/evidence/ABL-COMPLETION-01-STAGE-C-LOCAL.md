# ABL-COMPLETION-01 Stage C local readiness

Status: `PASS_LOCAL_DEPLOYMENT_IN_PROGRESS`

Recorded: `2026-08-24T22:11:26Z`

Source baseline: `656cc2742485f92a83d6755963c2c3daa6d14f47`

Authority boundary: `ABL-COMPLETION-01` authorizes persistent private capacity within the approved USD 25 monthly ceiling. This evidence does not authorize public exposure, model calls, recognition broadcast, canonical-history claims, recovery-control removal, founding-agent decisions, or Genesis.

## Result

The persistent Stage C implementation is locally ready for deployment into the existing `agent-basketball-league` Blaxel workspace. Private, core, and public-surface authority remains separated with scoped service identities, secrets, token-protected previews, PostgreSQL roles, and three separately permissioned Agent Drives. The plan declares seven Sandboxes, four private MCP Functions, two Jobs, three Agent Drives, eleven token-protected private previews, and zero Blaxel Agent, Application, Volume, model, or public-preview resources.

The persistent Neon PostgreSQL 17 project `shy-pine-00200479` exists in `aws-us-east-1`, has Neon Auth disabled, and contains the reviewed 23-table migration. Its runtime, recovery, and monitoring roles are separated by least privilege.

The [persistent-services runbook](../launch/STAGE_C_PERSISTENT_SERVICES.md), [resource plan](../../infra/blaxel/persistent-pre-genesis/resource-plan.json), [deployment map](../../infra/blaxel/persistent-pre-genesis/deployment-map.json), [monitoring policy](../../infra/blaxel/persistent-pre-genesis/monitoring-policy.json), [rollback runbook](../../infra/blaxel/persistent-pre-genesis/ROLLBACK.md), and machine-evaluated soak contract are the sole Stage C execution and acceptance definition.

## Verification

- Node `24.18.0` and pnpm `11.21.0`.
- 386 assertions passed across 81 test files.
- 116 uncached check, test, and build tasks passed.
- Formatting, tooling type-check, repository type-check, production build, browser, loopback load, acceptance/replay/recovery, and adversarial-security suites passed.
- Stable result digest: `0x6193cb6e6d19da2601ac78289d1403c988b781a19f9c67a5c918cc9d03a267d1`.
- Two independent clean-room packaging runs reproduced all 13 image-source digests and the aggregate image-set digest.
- Image-set digest: `0x8a72f1a1c20218ddcd49bd88fddc7995d140536b821fd75bd042fa7a6aa24789`.
- Arena build-source digest: `0xe3a16c5c771500b999f9a1fa10d3ae60e0241807c794d5ea9e582ff656b7d01b`.
- The code-simplifier review found no further behavior-preserving structural simplification was warranted.

## Next action

Merge this single-workspace correction, push the 13 reviewed image contexts sequentially, deploy only the private resources in the canonical map, install scoped secrets and Drive mounts, and start the deterministic 24-hour private soak. Ordinary deployment corrections and retries remain inside `ABL-COMPLETION-01`; they do not create another numbered authorization or reopen accepted `PRIVATE_STAGING` evidence.
