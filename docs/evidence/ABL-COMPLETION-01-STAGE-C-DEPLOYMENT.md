# ABL-COMPLETION-01 Stage C executable deployment packet

Status: `PRIVATE_DEPLOYMENT_ACTIVE_SOAK_PENDING`

Recorded: `2026-08-25T00:14:23Z`

Source baseline commit: `656cc2742485f92a83d6755963c2c3daa6d14f47`

Correction release commit: `0f349d0e8b8976dde6dd0aa7d718e8455d5905e8`

Authority boundary: `ABL-COMPLETION-01` authorizes this persistent private deployment within the USD 25 monthly ceiling. It authorizes no public exposure, model call, recognition broadcast, canonical-history claim, founding-agent decision, recovery-control removal, or Genesis.

## Result

Stage C has one exact, machine-validated deployment map for all 13 persistent workloads in the existing `agent-basketball-league` Blaxel workspace. The map binds one reviewed manifest, image name, packaging context, image-digest variable, process kind, memory limit, and private endpoint policy to every workload. It rejects recursive manifest application, example/model manifests, mutable image tags, and premature career-body resources.

The single physical workspace does not collapse the logical privacy model. The private, core, and public-surface trust domains retain distinct resource names, scoped service credentials, token-protected private previews, PostgreSQL roles, and Agent Drive label/path permissions. Three separately permissioned Drives isolate candidate/private, core safety, and public projection state. Career bodies still receive no Drive mount or raw infrastructure credential.

The persistent Neon PostgreSQL 17 project `shy-pine-00200479` is active in `aws-us-east-1`, migrated to the reviewed 23-table schema, and assigned least-privilege runtime, recovery, and monitoring roles.

The private Blaxel deployment is now active in the single `agent-basketball-league` workspace:

- 7 immutable-revision Sandboxes in `us-was-1`;
- 4 private scale-to-zero Functions, each bounded to `minScale: 0` and `maxScale: 1`;
- 2 deployed Jobs that have not been invoked;
- 3 path-permissioned Agent Drives mounted at 4 reviewed paths;
- 7 token-protected `public:false` Sandbox previews; and
- zero public endpoints, Blaxel Agents, Applications, Volumes, or model calls.

The projected persistent infrastructure cost remains USD 21.9084 per month, below the approved USD 25 ceiling.

## Exact deployment result

The exact Node 24.18.0 validator reported:

```json
{
  "status": "PASS",
  "workloadCount": 13,
  "privateEndpointCount": 11,
  "imageCount": 13,
  "memoryMiB": { "sandboxes": 21504, "functions": 8192, "jobs": 6144 },
  "deploymentDigest": "0x22aeee9c6a0d2f69e5933999ee0b8d91bd00b801617beef5e8ca2f2faa406e0e"
}
```

The canonical map is [`deployment-map.json`](../../infra/blaxel/persistent-pre-genesis/deployment-map.json). Its file SHA-256 is `0x8ac53025986843fd2c049965b56c8c27cf84cc1c7b74a3601652c0132167cb30`.

## Reproducible image contexts

Two clean, isolated packaging runs under exact Node 24.18.0 produced the same 13 per-image source digests and aggregate image-set digest:

- arena build-source digest: `0xe3a16c5c771500b999f9a1fa10d3ae60e0241807c794d5ea9e582ff656b7d01b`;
- image-set digest: `0x8a72f1a1c20218ddcd49bd88fddc7995d140536b821fd75bd042fa7a6aa24789`; and
- candidate-specific career-body and fixed-broker images: absent, as required for the persistent base deployment.

The complete per-image digest record is in [`ABL-COMPLETION-01-STAGE-C-DEPLOYMENT.json`](./ABL-COMPLETION-01-STAGE-C-DEPLOYMENT.json).

## Live acceptance result

- All 7 Sandbox previews returned `401` without a token and `200` with the scoped token.
- All 4 private MCP Functions passed authenticated `initialize` and `tools/list` using protocol `2025-11-25`.
- Agent Drive permission and mount readback passed for all 3 Drives and 4 mounts.
- Direct exclusive immutable writes were selected for Agent Drive because the provider does not preserve the POSIX hard-link primitive across a remount.
- The final storage broker image is pinned to immutable revision `xy6zndpwotr9`.
- Existing encrypted policy state remained readable after a full storage-process stop, Drive unmount/remount, and service restart.
- The exact Node 24.18.0 suite passed with stable result digest `0x336ded13b6b6bb5820ab585245f3942231b594f653b455d4232c429e443191a8` and launch-ledger digest `0x399bb6c252243e07765e8dc7202176fc7639746157fa2113ac4906989d565411`.

## Remaining Stage C actions

1. Merge the reviewed runtime correction and bind the retained environment to that merged release.
2. Complete the private candidate-flow exercise without creating a persistent career body.
3. Rotate the scoped runtime credentials and prove the services recover.
4. Perform a provider-created clean-room PostgreSQL restore and exact replay-root comparison.
5. Complete one continuous 24-hour private soak and record measured cost, health, restart, recovery, and replay-root evidence.

These are the fixed Stage C acceptance criteria. An ordinary correction or retry remains inside `ABL-COMPLETION-01` and does not invalidate completed Stage B evidence.
