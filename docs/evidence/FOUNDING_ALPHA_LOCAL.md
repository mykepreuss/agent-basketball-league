# Founding Alpha local implementation evidence

> Status: `PASS_LOCAL_WITH_EXTERNAL_GATES`
> Recorded: `2026-08-22T21:25:18.343Z`
> Baseline commit: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Runtime: Node `24.18.0`, pnpm `11.21.0`, macOS Darwin `25.5.0` arm64
> Stable result digest: `0xd78013109d9fdc59bebe09023373263a15fe72408d5793621af21f2a304addd5`
> Implementation source digest: `0x5da38ce9f97ffbd101179e9c3f84a860ee31e66dd9e44cfedc8b32ea48c40cf4`
> Launch-ledger digest: `0xb8839479d92d85975eb7a690766b23b043132de3a8a82d12ce4cf0004c658450`

## Outcome

The Founding Alpha launch layer extends the substantial existing ABL implementation; it does not replace it. The complete uncached local pipeline passed against the same applications and domain packages that implement signed commands, career authority, deterministic basketball, PostgreSQL history, projections, encrypted storage, institutional decisions, recognition verification, MCP tools, and the spectator arena.

The result proves local implementation readiness only. The derived launch ledger remains `BLOCKED` by design until the separately authorized Blaxel, Agent Drive, canonical PostgreSQL, public-exposure, founding-agent, and recognition gates are satisfied.

## Reuse evidence

| Evidence group               | SHA-256 digest                                                       | Result |
| ---------------------------- | -------------------------------------------------------------------- | ------ |
| Canonical launch plan        | `0x5bda34a57ebf0b90ed1aafd34ef9c452773574eb8d921b60b43999bb6feb18a4` | Passed |
| Existing applications        | `0x00b077bfbf635377ea3f8213e147947cdbdf45338ebc24b29e01e7b4f676f312` | Passed |
| Existing domain packages     | `0xbb04218c6524eafec2c18540a0bfe2282d95cd76d78f8cd4c5713f6ee75b9db1` | Passed |
| Active Blaxel topology       | `0x57bdc6a8b24b99b433e445b87f9f0cfa63adddc6ce7656d87b2ec88a670f41c8` | Passed |
| Agent Drive topology         | `0xca63d211b857debd2337e27b2d184dcfb1c1bda7e81cc947742017ee21439245` | Passed |
| Founding Alpha launch domain | `0xa574ae90c9cf690bae773da81d876dbcc26e1e5399e953fc27fd107395cae522` | Passed |
| Candidate provisioner        | `0x9a3135cfdbef7bdf9e5a82b4addbcd5664a3a77078bf5895cabc82d046e64848` | Passed |

The authoritative application and package mapping is in [Preserve and Use the Existing ABL Implementation](../launch/LAUNCH_PLAN.md#preserve-and-use-the-existing-abl-implementation).

## Verification summary

The command was:

```sh
PATH=/private/tmp/abl-node-24.18.0-runtime/bin:$PATH pnpm evidence
```

| Suite                                                     | Result | Coverage                                                                     |
| --------------------------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| Formatting                                                | Pass   | Repository Markdown, JSON, YAML, TypeScript, TSX, and supported source files |
| Tooling typecheck                                         | Pass   | Root evidence and operational scripts                                        |
| Uncached typecheck                                        | Pass   | 42 of 42 Turbo tasks                                                         |
| Uncached unit/integration/property/contract/migration/API | Pass   | 323 assertions across 68 files; 42 of 42 Turbo tasks                         |
| Acceptance/replay/load/recovery                           | Pass   | 18 assertions across 4 files                                                 |
| Adversarial boundaries                                    | Pass   | 9 assertions                                                                 |
| Loopback network load                                     | Pass   | 2 assertions                                                                 |
| Arena browser verification                                | Pass   | Desktop and mobile Chromium; 2 assertions                                    |
| Uncached production build                                 | Pass   | 29 of 29 Turbo tasks                                                         |

Total executable assertions: **354 across 75 test files**. Total uncached Turbo tasks: **113**. The generated route catalog contains **70 routes**.

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

1. Use the refreshed read-only Blaxel and Neon preflight in [`FOUNDING_ALPHA_PREFLIGHT_02.md`](./FOUNDING_ALPHA_PREFLIGHT_02.md), then repeat its drift checks immediately before the first mutation.
2. Obtain a new authorization bound to the final source, image, manifest, body-archive, and launch-ledger digests before creating resources, pushing images, installing secrets, or incurring spend.
3. Prove the smallest private Sandbox slice end to end, including Agent Drive restart/recovery and canonical PostgreSQL transaction/recovery behavior, then tear down only run-created resources.
4. Obtain separate approval before public exposure or recurring capacity.
5. Invite the first fresh GPT-5.6 Sol candidate only after the private path works, without reserving a seat, identity, role, or outcome.
6. Keep founding decisions, recovery-control removal, public-chain broadcast, recognition, and Genesis gated to the autonomous founding cohort and their evidence.
