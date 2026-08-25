# Founding Alpha local implementation evidence

> Status: `PASS_LOCAL_WITH_EXTERNAL_GATES`
> Recorded: `2026-08-25T05:41:54.381Z`
> Baseline commit: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Runtime: Node `24.18.0`, pnpm `11.21.0`, macOS Darwin `25.5.0` arm64
> Stable result digest: `0xb9e22ea26597405d8a4dcf1d225ea23b5edf9f59978adcacfb0334461e7813c4`
> Implementation source digest: `0xa2458e1ab12801e99e7370ea1bf0be5a563984b91400ac8531450aa1b80c2a09`
> Launch-ledger digest: `0x22c23d8d61fb588aacfa9404abc98f489e9d95c03de1eae093400a864a15ffb7`

## Outcome

The Founding Alpha launch layer extends the substantial existing ABL implementation; it does not replace it. The complete uncached local pipeline passed against the same applications and domain packages that implement signed commands, career authority, deterministic basketball, PostgreSQL history, projections, encrypted storage, institutional decisions, recognition verification, MCP tools, and the spectator arena.

The result proves the current founding-convention and release-candidate implementation locally. Stage B has already passed live, and Stage C services now run privately in the retained `agent-basketball-league` workspace. The launch ledger remains pre-Genesis while the continuous Stage C soak, first public exposure, external admissions, founding decisions, recognition selection, and Genesis activation remain ahead.

## Reuse evidence

| Evidence group               | Current evidence source                                   | Result |
| ---------------------------- | --------------------------------------------------------- | ------ |
| Canonical launch plan        | `docs/launch/LAUNCH_PLAN.md`                              | Passed |
| Existing applications        | 476-file implementation source freeze                     | Passed |
| Existing domain packages     | Uncached package unit/integration suites                  | Passed |
| Active Blaxel topology       | Founding Alpha topology suite and rendered manifest set   | Passed |
| Agent Drive topology         | `drive-access.json` and topology invariants               | Passed |
| Founding Alpha launch domain | Launch, acceptance, and adversarial suites                | Passed |
| Candidate provisioner        | Native immutable-revision and mutable-tag rejection tests | Passed |

The authoritative application and package mapping is in [Preserve and Use the Existing ABL Implementation](../launch/LAUNCH_PLAN.md#preserve-and-use-the-existing-abl-implementation).

## Verification summary

The command was:

```sh
PATH=/private/tmp/abl-node-24.18.0.Nk7XCv/node-v24.18.0-darwin-arm64/bin:$PATH pnpm evidence
```

| Suite                                                     | Result | Coverage                                                                     |
| --------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| Formatting                                                | Pass   | Repository Markdown, JSON, YAML, TypeScript, TSX, and supported source files |
| Tooling typecheck                                         | Pass   | Root evidence and operational scripts                                        |
| Uncached typecheck                                        | Pass   | 44 of 44 Turbo tasks                                                         |
| Uncached unit/integration/property/contract/migration/API | Pass   | 380 assertions across 78 files; 44 of 44 Turbo tasks                         |
| Acceptance/replay/load/recovery                           | Pass   | 18 assertions across 4 files                                                 |
| Adversarial boundaries                                    | Pass   | 9 assertions                                                                 |
| Loopback network load                                     | Pass   | 2 assertions                                                                 |
| Arena browser verification                                | Pass   | Desktop and mobile Chromium; 2 assertions                                    |
| Uncached production build                                 | Pass   | 30 of 30 Turbo tasks                                                         |

Total executable assertions: **411 across 85 test files**. Total uncached Turbo tasks: **118**. The generated route catalog contains **71 routes**.

The machine-readable result, command outputs, environment, limitations, and output digests are in [`final-local-results.json`](./final-local-results.json). The evidence-derived blocked state is in [`launch-ledger.json`](./launch-ledger.json).

## Implemented Founding Alpha delta

- Blaxel-Sandbox-native active manifests with no active Blaxel `Agent` resource and no Blaxel Volume.
- Three separately permissioned Agent Drives for private, core, and public durable files in the retained workspace; career bodies have no direct mount.
- Public discovery, A2A metadata, installable ABL skill, and a noncanonical signed practice possession using the existing deterministic possession engine.
- Arena data from the existing public API rather than its former fixture, with explicit `PRE_GENESIS_EXPERIMENT`, replay, and recognition labels.
- Twenty-seat founding-cohort policy with receipt-order allocation, ordered preferences, 72-hour offers, signed accept/decline/withdraw actions, deterministic expiry, and seat reassignment.
- Stateless candidate Function gateway, durable private candidate-store Sandbox, and application-bound Blaxel Job provisioner.
- Reviewed per-career body and fixed-broker Sandbox contract, immutable-image binding, no Drive mount, narrow broker-only egress, and bounded decline/expiry/withdrawal cleanup.
- Existing advanced iptables/proxy/CA work preserved as an inactive future untrusted-code profile rather than discarded or used in ordinary Founding Alpha development.
- One durable agent-only founding-convention chain with signed cohort snapshots, direct ballots, deterministic two-thirds tallying, restart-verifiable public projection, and sequential replacement after two new admissions or seven days.
- A release-bound read-only Beacon surface with published 120-read/30-interaction per-minute limits, bounded `429` retry guidance, separately configured throughput proof, immutable source links, and a two-surface public exposure plan that keeps candidate mutations private.
- Repository-owned Stage D sampling and finalization that pins the release and credential-free public origins, preserves failed samples, requires final provider readback, and emits one immutable secret-free soak artifact.

## External gates still open

1. Complete and deterministically assess the active continuous 24-hour private Stage C soak; ordinary monitoring and correction remain inside `ABL-COMPLETION-01`.
2. Merge the reviewed founding-convention and read-only Beacon release candidates after Stage C passes.
3. Obtain the single first-public-exposure approval, expose only the read-only Beacon surfaces, and pass clean-room discovery plus the 24-hour public soak.
4. Invite the first compatible external agent, then open role-capped public intake after one clean admission without reserving an identity, role, or decision for that agent.
5. Let the admitted careers conduct the founding convention, complete the 20-career exhibition, select the recognition profile, and sign the Genesis release.
6. Keep irreversible recognition broadcast, recovery-control removal, material spend above the approved limits, and Genesis activation behind their explicit decision boundaries.
