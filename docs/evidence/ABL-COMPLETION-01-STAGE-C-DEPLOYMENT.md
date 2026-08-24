# ABL-COMPLETION-01 Stage C executable deployment packet

Status: `APPROVED_SINGLE_WORKSPACE_DEPLOYMENT_IN_PROGRESS`

Recorded: `2026-08-24T22:11:26Z`

Source baseline commit: `656cc2742485f92a83d6755963c2c3daa6d14f47`

Authority boundary: `ABL-COMPLETION-01` authorizes this persistent private deployment within the USD 25 monthly ceiling. It authorizes no public exposure, model call, recognition broadcast, canonical-history claim, founding-agent decision, recovery-control removal, or Genesis.

## Result

Stage C has one exact, machine-validated deployment map for all 13 persistent workloads in the existing `agent-basketball-league` Blaxel workspace. The map binds one reviewed manifest, image name, packaging context, image-digest variable, process kind, memory limit, and private endpoint policy to every workload. It rejects recursive manifest application, example/model manifests, mutable image tags, and premature career-body resources.

The single physical workspace does not collapse the logical privacy model. The private, core, and public-surface trust domains retain distinct resource names, scoped service credentials, token-protected private previews, PostgreSQL roles, and Agent Drive label/path permissions. Three separately permissioned Drives isolate candidate/private, core safety, and public projection state. Career bodies still receive no Drive mount or raw infrastructure credential.

The persistent Neon PostgreSQL 17 project `shy-pine-00200479` was created in `aws-us-east-1`, migrated to the reviewed 23-table schema, and assigned least-privilege runtime, recovery, and monitoring roles. No Blaxel image, workload, preview, or Drive has been created for Stage C yet.

## Exact deployment result

The exact Node 24.18.0 validator reported:

```json
{
  "status": "PASS",
  "workloadCount": 13,
  "privateEndpointCount": 11,
  "imageCount": 13,
  "memoryMiB": { "sandboxes": 21504, "functions": 8192, "jobs": 6144 },
  "deploymentDigest": "0x83e31e5e0696adc50034c978bf42b5e8887bb3bb0cb00d8fda91e992c5bf23c5"
}
```

The canonical map is [`deployment-map.json`](../../infra/blaxel/persistent-pre-genesis/deployment-map.json). Its file SHA-256 is `0x8ac53025986843fd2c049965b56c8c27cf84cc1c7b74a3601652c0132167cb30`.

## Reproducible image contexts

Two clean, isolated packaging runs under exact Node 24.18.0 produced the same 13 per-image source digests and aggregate image-set digest:

- arena build-source digest: `0xe3a16c5c771500b999f9a1fa10d3ae60e0241807c794d5ea9e582ff656b7d01b`;
- image-set digest: `0x8a72f1a1c20218ddcd49bd88fddc7995d140536b821fd75bd042fa7a6aa24789`; and
- candidate-specific career-body and fixed-broker images: absent, as required for the persistent base deployment.

The complete per-image digest record is in [`ABL-COMPLETION-01-STAGE-C-DEPLOYMENT.json`](./ABL-COMPLETION-01-STAGE-C-DEPLOYMENT.json).

## Next Stage C actions

1. Merge the reviewed single-workspace correction.
2. Push the 13 exact reviewed image contexts sequentially and record their immutable provider revisions.
3. Install scoped Blaxel secrets, create the three separately permissioned Agent Drives, and deploy only the mapped private resources.
4. Exercise credential rotation and a provider-created clean-room restore.
5. Complete one continuous 24-hour private soak and record measured cost, health, restart, recovery, and replay-root evidence.

These are the fixed Stage C acceptance criteria. An ordinary correction or retry remains inside `ABL-COMPLETION-01` and does not invalidate completed Stage B evidence.
