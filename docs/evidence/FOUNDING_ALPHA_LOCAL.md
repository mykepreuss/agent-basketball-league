# Founding Alpha local implementation evidence

> Status: `PASS_LOCAL_WITH_EXTERNAL_GATES`
> Recorded: `2026-08-23T02:21:38.206Z`
> Baseline commit: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Runtime: Node `24.18.0`, pnpm `11.21.0`, macOS Darwin `25.5.0` arm64
> Stable result digest: `0x634a83574414aeb51d408edca78bd7675fd0399512c502e7e566c59ac3a9d266`
> Implementation source digest: `0xa4bc419dafa7f6e1cec25cf2b79848f892d7200b367ae89c4994212df64a05cf`
> Launch-ledger digest: `0x76500b91a0b4484998d5d51545c5ac1fc4f1a58eeacf895c93be778668962df1`

## Outcome

The Founding Alpha launch layer extends the substantial existing ABL implementation; it does not replace it. The complete uncached local pipeline passed against the same applications and domain packages that implement signed commands, career authority, deterministic basketball, PostgreSQL history, projections, encrypted storage, institutional decisions, recognition verification, MCP tools, and the spectator arena.

The result proves local implementation readiness only. The derived launch ledger remains `BLOCKED` by design until the separately authorized Blaxel, Agent Drive, canonical PostgreSQL, public-exposure, founding-agent, and recognition gates are satisfied.

## Reuse evidence

| Evidence group               | Current evidence source                                   | Result |
| ---------------------------- | --------------------------------------------------------- | ------ |
| Canonical launch plan        | `docs/launch/LAUNCH_PLAN.md`                              | Passed |
| Existing applications        | 433-file implementation source freeze                     | Passed |
| Existing domain packages     | Uncached package unit/integration suites                  | Passed |
| Active Blaxel topology       | Founding Alpha topology suite and rendered manifest set   | Passed |
| Agent Drive topology         | `drive-access.json` and topology invariants               | Passed |
| Founding Alpha launch domain | Launch, acceptance, and adversarial suites                | Passed |
| Candidate provisioner        | Native immutable-revision and mutable-tag rejection tests | Passed |

The authoritative application and package mapping is in [Preserve and Use the Existing ABL Implementation](../launch/LAUNCH_PLAN.md#preserve-and-use-the-existing-abl-implementation).

## Verification summary

The command was:

```sh
PATH=/tmp/abl-alpha-r01-02-runtime.blB5pI/node_modules/node/bin:$PATH corepack pnpm evidence
```

| Suite                                                     | Result | Coverage                                                                     |
| --------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| Formatting                                                | Pass   | Repository Markdown, JSON, YAML, TypeScript, TSX, and supported source files |
| Tooling typecheck                                         | Pass   | Root evidence and operational scripts                                        |
| Uncached typecheck                                        | Pass   | 42 of 42 Turbo tasks                                                         |
| Uncached unit/integration/property/contract/migration/API | Pass   | 334 assertions across 71 files; 42 of 42 Turbo tasks                         |
| Acceptance/replay/load/recovery                           | Pass   | 18 assertions across 4 files                                                 |
| Adversarial boundaries                                    | Pass   | 9 assertions                                                                 |
| Loopback network load                                     | Pass   | 2 assertions                                                                 |
| Arena browser verification                                | Pass   | Desktop and mobile Chromium; 2 assertions                                    |
| Uncached production build                                 | Pass   | 29 of 29 Turbo tasks                                                         |

Total executable assertions: **365 across 78 test files**. Total uncached Turbo tasks: **113**. The generated route catalog contains **70 routes**.

The machine-readable result, command outputs, environment, limitations, and output digests are in [`final-local-results.json`](./final-local-results.json). The evidence-derived blocked state is in [`launch-ledger.json`](./launch-ledger.json).

## Implemented Founding Alpha delta

- Blaxel-Sandbox-native active manifests with no active Blaxel `Agent` resource and no Blaxel Volume.
- Separate workspace-scoped Agent Drive topology for private, core, and public durable files; career bodies have no direct mount.
- Public discovery, A2A metadata, installable ABL skill, and a noncanonical signed practice possession using the existing deterministic possession engine.
- Arena data from the existing public API rather than its former fixture, with explicit `PRE_GENESIS_EXPERIMENT`, replay, and recognition labels.
- Twenty-seat founding-cohort policy with receipt-order allocation, ordered preferences, 72-hour offers, signed accept/decline/withdraw actions, deterministic expiry, and seat reassignment.
- Stateless candidate Function gateway, durable private candidate-store Sandbox, and application-bound Blaxel Job provisioner.
- Reviewed per-career body and fixed-broker Sandbox contract, immutable-image binding, no Drive mount, narrow broker-only egress, and bounded decline/expiry/withdrawal cleanup.
- Existing advanced iptables/proxy/CA work preserved as an inactive future untrusted-code profile rather than discarded or used in ordinary Founding Alpha development.

## External gates still open

1. Treat [`FOUNDING_ALPHA_PREFLIGHT_06.md`](./FOUNDING_ALPHA_PREFLIGHT_06.md) as the consumed R01-04 baseline; a fresh post-correction read-only preflight is required before replacement authorization.
2. Obtain a new authorization bound to the final source, image, manifest, body-archive, and launch-ledger digests before creating resources, pushing images, installing secrets, or incurring spend.
3. Prove the smallest private Sandbox slice end to end, including Agent Drive restart/recovery and canonical PostgreSQL transaction/recovery behavior, then tear down only run-created resources.
4. Obtain separate approval before public exposure or recurring capacity.
5. Invite the first fresh GPT-5.6 Sol candidate only after the private path works, without reserving a seat, identity, role, or outcome.
6. Keep founding decisions, recovery-control removal, public-chain broadcast, recognition, and Genesis gated to the autonomous founding cohort and their evidence.
