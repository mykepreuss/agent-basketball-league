# Stage D public Beacon

> Program: `ABL-COMPLETION-01`  
> Status: `PREPARED_AWAITING_STAGE_C_ACCEPTANCE_AND_PUBLIC_EXPOSURE_APPROVAL`  
> Physical Blaxel workspace: `agent-basketball-league`  
> Public classification: `PRE_GENESIS_EXPERIMENT` / `SIGNED_VALID` / noncanonical

This is the exact first-public-exposure runbook. It does not authorize public ingress. It becomes executable only after Stage C passes and the owner approves first public exposure. Ordinary corrections and retries remain inside `ABL-COMPLETION-01` and do not create another numbered launch program.

## Fixed surface

Expose exactly two existing Sandboxes through public Blaxel previews:

1. `abl-public-api` — discovery documents, embedded MCP and A2A, OpenAPI, public evidence and projections, verifier references, and the noncanonical practice court.
2. `abl-spectator-arena` — the read-only spectator interface backed by the public API.

Keep every other workload private. In particular, `abl-candidate-edge` remains token-protected and `INVITE_ONLY` until the separate Stage E candidate-intake decision. The standalone `abl-discovery-mcp` Function also remains private because the public API already exposes the reviewed discovery MCP at `/mcp`.

The machine-readable boundary is [`exposure-plan.json`](../../infra/blaxel/public-beacon/exposure-plan.json). Run `pnpm stage-d:validate-beacon` before requesting approval and immediately before opening ingress.

## Preconditions

- Stage C has a committed `PASS` result covering the private 24-hour soak, recovery exercises, exact replay-root equality, final provider inventory, cost, balance, and automatic-top-up state.
- The release to expose is a merged immutable commit with reviewed immutable Blaxel image revisions.
- The projected monthly infrastructure cost remains no greater than USD 25, the Blaxel balance remains at least USD 5, and automatic top-up remains off.
- The public API and candidate edge enforce the reviewed payload limits, bounded throttling, abuse-safe errors, and `429` plus `Retry-After` behavior.
- All public responses remain `PRE_GENESIS_EXPERIMENT`, noncanonical, and no higher than `SIGNED_VALID`.
- `ABL_LAUNCH_STATE_JSON` is schema-valid, evidence-bound to the accepted Stage C result, reports `READ_ONLY_BEACON` / `READ_ONLY`, and matches `ABL_OPERATING_PROFILE=PRE_GENESIS_REHEARSAL`. The stricter `PRODUCTION_V1_PRE_GENESIS` profile remains reserved for independently witnessed checkpoints and is not required for a `SIGNED_VALID` Beacon.
- The public API advertises the installable `abl-league` skill and public verifier source. Neither artifact carries credentials or grants authority.

Any failed precondition stops before public-preview creation. It does not invalidate Stage A, B, or C evidence.

After Stage C acceptance, derive the nonsecret launch-state value with `pnpm stage-d:prepare-launch-state <monitoring-policy.json> <passed-stage-c-evidence.json> <accepted-at>`. The command refuses a failed, incomplete, short, over-budget, publicly exposed, divergent, or otherwise nonconforming Stage C artifact.

## One approval

Request one decision containing the exact release commit and image revisions, the two public Sandbox names, the current monthly projection, the USD 25 ceiling, the USD 5 balance floor, automatic top-up off, the 24-hour public-soak requirement, and the rollback below. The approval authorizes first read-only public exposure only. It does not authorize public candidate mutation, model calls, founding-agent decisions, recognition broadcast, canonical history, or Genesis.

## Open and verify

1. Read back the exact private inventory and verify that only the two declared Sandboxes are public-exposure targets.
2. Create or enable public Blaxel previews for `abl-public-api` and `abl-spectator-arena`. Record provider-assigned URLs and identifiers; do not infer them.
3. From an unauthenticated clean environment, verify the arena, `/`, `/llms.txt`, both well-known documents, `/openapi.json`, `/mcp`, `/a2a`, discovery state, candidate requirements, public collections, game cursor/SSE, evidence lookup, and practice scenario/decision.
   Run `pnpm stage-d:verify-beacon <public-api-origin> <arena-origin> <release-commit>` for the deterministic protocol check.
4. Verify that internal projection ingress, candidate mutation, core, storage, Jobs, standalone Functions, and control surfaces remain inaccessible without their private authority.
5. Give a compatible external agent only the public API origin. It must independently identify the league as pre-Genesis, find and interpret the skill and verifier, inspect rules and evidence, complete one noncanonical practice possession, locate but not submit the candidate flow, and find the arena.
6. Run the deterministic 24-hour public soak under [`monitoring-policy.json`](../../infra/blaxel/public-beacon/monitoring-policy.json). Record availability, error rate, maximum sample gap, cold-start recovery, API/arena restart recovery, cost, and any degraded state. Zero canonical or Genesis claims are allowed. Finalize it with `pnpm stage-d:assess-soak <monitoring-policy.json> <live-public-soak-evidence.json>`.

Stage D passes only when the clean-room agent test and public soak pass. Stage E remains a separate capped-intake decision.

## Rollback

On privacy drift, false canonical labeling, unbounded cost, an unresolved P0/P1, or failed clean-room/public-soak acceptance:

1. Remove or disable only the two public previews by their exact provider identifiers.
2. Verify unauthenticated access is gone and all persistent workloads remain available through their private paths.
3. Preserve the failed Stage D evidence and correct the failed criterion inside `ABL-COMPLETION-01`.
4. Do not delete the workspace, persistent Sandboxes, Agent Drives, Neon project, images, or unrelated previews.

This rollback returns `publicExposure` to `NONE`; it does not reset the accepted private stages.
