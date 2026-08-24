# ABL-COMPLETION-01 Stage C executable deployment packet

Status: `LOCAL_DEPLOYMENT_PACKET_PASS_PROVIDER_MUTATION_NOT_AUTHORIZED`

Recorded: `2026-08-24T21:24:31Z`

Baseline commit: `abc66700bb51d367a7a2d45454fb3637304ba4f4`

Authority boundary: this is local deployment-readiness evidence. It did not push an image or create, modify, or delete any Blaxel, Neon, billing, credential, or application resource. It does not authorize recurring capacity or public exposure.

## Result

Stage C now has one exact, machine-validated deployment map for all 13 persistent workloads. The map assigns each workload to one of `abl-private`, `abl-core`, and `abl-public`; binds one reviewed manifest, image name, packaging context, image-digest variable, process kind, and memory limit; explicitly keeps every endpoint private; and rejects recursive manifest application, example/model manifests, mutable image tags, and premature career-body resources.

The production packet now includes the two previously undeployable components:

- a packaged safety-gateway Sandbox; and
- a packaged `abl-recovery-verifier` Job in `abl-core`.

The recovery verifier compares a provider-created clean-room PostgreSQL 17 restore with its source using deterministic roots for all table rows plus public columns, constraints, indexes, and sequences. It requires distinct direct TLS database targets, rejects pooler endpoints, expects the reviewed 23-table schema, and emits only counts and digests.

## Exact deployment result

The exact Node 24.18.0 validator reported:

```json
{
  "status": "PASS",
  "workloadCount": 13,
  "privateEndpointCount": 11,
  "imageCount": 13,
  "memoryMiB": { "sandboxes": 21504, "functions": 8192, "jobs": 6144 },
  "deploymentDigest": "0x65c4d2076fefe5c98449f78827b438a0647ce01c24ade423ef2b497eba310ea8"
}
```

The canonical map is [`deployment-map.json`](../../infra/blaxel/persistent-pre-genesis/deployment-map.json). Its file SHA-256 is `0xa78d14c75f6a2a8cbae03955049654e9dd39e3fb18448dcb170420ce307a4c6e`.

## Reproducible image contexts

Two clean, isolated packaging runs under exact Node 24.18.0 produced the same 13 per-image source digests and the same aggregate image-set digest:

- arena build-source digest: `0xb54bdb9ddb334c52562ad77309b4745d70a2c72541bbb739977052fd4bbefd2d`;
- image-set digest: `0x29632d1c3c6dc4bcee5f599b48b324321652ca5cf9052870436e323e179c9a54`; and
- candidate-specific career-body and fixed-broker images: absent, as required for the persistent base deployment.

The complete per-image digest record is in [`ABL-COMPLETION-01-STAGE-C-DEPLOYMENT.json`](./ABL-COMPLETION-01-STAGE-C-DEPLOYMENT.json).

## Corrections made

- Replaced the ambiguous recursive `bl apply` guidance with an exact ordered deployment map.
- Added Stage C-specific private discovery, candidate-store, and cross-workspace candidate-provisioner manifests without changing the accepted historical Stage B manifest set.
- Packaged every declared workload, including the safety gateway and recovery verifier.
- Moved the recovery Job to its declared `abl-core` workspace and supplied its executable implementation.
- Bound topology tests, persistent-soak tests, resource accounting, and the launch ledger to the same deployment map.
- Ran the code-simplifier review over changed production code; it reduced the image-prefix selection without changing behavior.

## Remaining Stage C actions

1. Receive explicit recurring-capacity approval for the three persistent workspaces and the USD 25/month ceiling.
2. Refresh the expired Blaxel CLI login interactively and repeat the immediate no-drift preflight.
3. Create the persistent PostgreSQL 17 project, push these 13 images sequentially, and deploy only the mapped private resources.
4. Exercise credential rotation and a provider-created clean-room restore.
5. Complete one continuous 24-hour private soak and record measured cost, health, restart, recovery, and replay-root evidence.

These are the same fixed Stage C acceptance criteria; an ordinary correction or retry does not create a new launch program or invalidate completed Stage B evidence.
