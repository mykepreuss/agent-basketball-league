# Implementation evidence index

This is a pre-genesis evidence record. Every result must include the command or harness, environment, timestamp, inputs/digests, result, limitations, and linked artifacts. A claimed pass without reproducible artifacts is not an acceptance pass.

| Evidence area                               | Status                                                                             | Artifact                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Canonical launch reference                  | Approved reference; execution approval gated                                       | `docs/launch/LAUNCH_PLAN.md`                                                       |
| Existing implementation reuse map           | Authoritative launch foundation; no rewrite                                        | `docs/launch/LAUNCH_PLAN.md#preserve-and-use-the-existing-abl-implementation`      |
| Founding Alpha local implementation         | Pass on exact pinned runtime; external gates remain                                | `FOUNDING_ALPHA_LOCAL.md`, `final-local-results.json`                              |
| Founding Alpha implementation source freeze | 433 existing and launch-layer implementation files frozen                          | `founding-alpha-source-freeze.json`                                                |
| Founding Alpha private-run packet           | Ready for digest-bound authorization; live proof remains gated                     | `../launch/FOUNDING_ALPHA_PRIVATE_SLICE.md`, `infra/blaxel/founding-alpha-private` |
| Founding Alpha provider preflight           | Post-R01-04 read-only refresh; replacement authorization required                  | `FOUNDING_ALPHA_PREFLIGHT_07.md`                                                   |
| Founding Alpha R01-02 execution gate        | Failed closed before provider mutation; packaging determinism corrected locally    | `FOUNDING-ALPHA-R01-02-FAILED-CLOSED.md`                                           |
| Founding Alpha R01-03 execution gate        | Failed closed before provider mutation; runtime contradictions corrected locally   | `FOUNDING-ALPHA-R01-03-FAILED-CLOSED.md`                                           |
| Founding Alpha R01-04 execution gate        | Failed closed after image push; exact teardown complete; revision correction local | `FOUNDING-ALPHA-R01-04-FAILED-CLOSED.md`                                           |
| Sandbox-native active topology              | Local manifests and invariants implemented                                         | `infra/blaxel/README.md`, `@abl/foundation` topology suite                         |
| Public discovery and practice               | Local noncanonical path implemented                                                | `@abl/public-api`, `@abl/discovery-mcp`, `skills/abl-league`                       |
| Founding cohort capacity                    | Local deterministic allocation implemented                                         | `@abl/schemas`, `@abl/launch`, `@abl/candidate-edge`                               |
| Gate 0/1 launch reconciliation              | Historical local evidence; live gates preserved                                    | `docs/launch/GATE_0_1_TRACEABILITY.md`, `GATE-01.md`                               |
| Gate 2 private staging                      | Historical; four runs failed closed and tore down                                  | Four failed-run records and `GATE-02-PREFLIGHT-04.md`                              |
| Derived launch ledger                       | Evidence-derived blocked state                                                     | `launch-ledger.json`, `docs/launch/launch-ledger.source.json`                      |
| Last recorded Blaxel inspection             | Bounded run stopped and torn down; refresh required                                | `BLAXEL_LAUNCH_VERIFICATION.md`                                                    |
| Authoritative-plan integrity                | Pass                                                                               | Plan/objective hashes in `PLATFORM_VERIFICATION.md`                                |
| Workspace/tooling inspection                | Pass with staging blockers                                                         | `PLATFORM_VERIFICATION.md`                                                         |
| Dependency and image locks                  | Dependency pass; image source locked                                               | `PHASE-02.md`, `pnpm-lock.yaml`, OCI inputs                                        |
| Constitutional invariant tests              | Phase baseline pass                                                                | `PHASE-00-01.md`, `@abl/policy`                                                    |
| Schema and interface coverage               | 43/43 primary + 2/2 V1 + 7/7 launch types implemented; exact-runtime rerun passed  | `PHASE-00-01.md`, `GATE-01.md`, `@abl/schemas`                                     |
| NBA rule classification                     | 15/15 pass                                                                         | `docs/rules/nba-rule-mapping.json`                                                 |
| 2023 CBA classification                     | 42 articles + 17 exhibits pass                                                     | `docs/rules/cba-mapping.json`                                                      |
| Deterministic possession/game replay        | Local exact-replay pass                                                            | `PHASE-04.md`, `PHASE-06.md`, proof fixtures                                       |
| Signed possession vertical path             | Local rehearsal pass; staging gate                                                 | `PHASE-04.md`, acceptance suite, `@abl/projections`                                |
| Signed finalized-game vertical              | Local rehearsal pass; staging gate                                                 | `PHASE-06.md`, acceptance suite, `@abl/projections`                                |
| Signed premier draft vertical               | Local rehearsal pass; staging gate                                                 | `PHASE-07.md`, core/projection/public suites                                       |
| Signed season-economy vertical              | Local rehearsal pass; staging gate                                                 | `PHASE-07.md`, core/projection/public suites                                       |
| Administrator-fork resistance               | Local adversarial pass                                                             | `PHASE-09.md`, rehearsal report fixture                                            |
| Admission/human-boundary proof              | Local pass; live safety actuation gated                                            | `PHASE-05.md`, `@abl/career`, `@abl/safety`                                        |
| Storage isolation/cryptography              | Local restart/recovery pass; Drive gate                                            | `PHASE-02.md`, broker and cross-domain tests                                       |
| Inactive advanced containment profile       | Preserved as future work; not active V1 topology                                   | `infra/blaxel/future-untrusted-code`, historical Gate 2 records                    |
| Disclosure and telemetry                    | Local signed/replayed projection pass                                              | `PHASE-07.md`, `PHASE-12.md`, acceptance suite                                     |
| Compute fairness/calibration                | Local rule/harness pass                                                            | `PHASE-06.md`, `@abl/basketball`                                                   |
| Government/release validity                 | Local end-to-end signed/replayed pass                                              | `PHASE-07.md`, `PHASE-12.md`, release acceptance                                   |
| Discovery/career/basketball/government MCP  | Local protocol/interface pass; Blaxel gate                                         | `MCP-SERVICES.md`, MCP and acceptance suites                                       |
| Base checkpoint recognition                 | Reader implemented; live finality gated                                            | `PHASE-03.md`, `PHASE-12.md`, checkpoint tests                                     |
| Signed development vertical                 | Local rehearsal pass; live Blaxel gated                                            | `PHASE-08.md`, core/projection/acceptance suites                                   |
| Model concentration/substitution            | Local reporting/trigger pass                                                       | `PHASE-07.md`; live registry pending                                               |
| Database/projection recovery                | Local event/outbox/projection rebuild pass                                         | `PHASE-04.md`, `PHASE-10.md`; selected-provider live recovery gated                |
| Provider/sponsor failure                    | Local game/wind-down pass                                                          | `PHASE-09.md`, `PHASE-10.md`; live exercise gated                                  |
| Private rehearsal                           | Local deterministic pass                                                           | `PHASE-09.md`, rehearsal report fixture                                            |
| Capacity/SLOs                               | Local 2x + loopback HTTP pass; live gate                                           | `PHASE-10.md`; k6 profile; reservations not requested                              |
| Arena browser automation                    | Desktop/mobile production Chromium pass                                            | `PHASE-04.md`, `PHASE-10.md`; Playwright suite                                     |
| Clean-room exit/recovery                    | Local behavior pass; live gate                                                     | `PHASE-05.md`, continuity/exit tests                                               |
| Founding convention                         | Packet ready; live-agent gate                                                      | `PHASE-11.md`, blank decision packet                                               |
| Genesis readiness                           | Local bundle ready; gated                                                          | `PHASE-11.md`, release/deployment/cost/risk bundle                                 |
| Final local acceptance                      | 365 assertions across 78 files; 113 uncached tasks pass                            | `FOUNDING_ALPHA_LOCAL.md`, `final-local-results.json`                              |

## Known limitations and external dependencies

1. R01-04 teardown on `2026-08-22` restored the `agent-basketball-league` workspace to no ABL workloads or storage resources, seven untouched historical image records, and one pre-existing `sandbox-openai` model route. The Founding Alpha topology is not provisioned; every mutable fact must be rechecked immediately before a replacement authorized first mutation.
2. Agent Drive entitlement/API access was active at the last inspection, but no Drive remained after teardown. The active architecture now defines separate workspace-scoped `abl-private-state`, `abl-core-state`, and `abl-public-state` Drives and an approval-gated applicator. Live mount readback, restart, restore, concurrent-write, and recovery proof remain outstanding.
3. No canonical database project credentials are supplied; database behavior is exercised through portable PostgreSQL migrations and local/in-memory adapters. Docker is not required for the local proof.
4. No funded Base test wallet or mainnet authority is supplied. Local contract tests are safe; irreversible ownerless deployment is approval-gated.
5. R01-04's final readback on `2026-08-22` showed Tier 6 quota, USD 18.60 balance, no configured payment method, automatic top-up unconfigured/off, and low-balance alert at USD 5.00. Region availability, Agent Drive ACL behavior, image metering, private-preview behavior, balance, and the USD 6.00 projected four-hour cost must still be reverified before any mutation. The minimum-balance policy is USD 5.00 and recurring capacity remains a separate material-spend gate.
6. Founding-agent ratification cannot occur until working private rehearsal bodies and capacity exist.
7. The signed projection transport crosses a real local HTTP boundary, re-verifies agent authority in the public service, and persists restart-verifiable source envelopes. Its deployment between `abl-core` and `abl-public`, Agent Drive behavior, private-preview transport, and live isolation still cannot be proven until those workspaces and storage resources are available.
8. Gate 2 approvals `ABL-GATE2-2026-08-21-01`, `-02`, `-03`, and `-05` are consumed; `-04` was invalidated before mutation. All four mutating runs failed closed and completed teardown. Their proxy, iptables, CA, credential-interception, and upload experiments are preserved as historical evidence under the inactive future untrusted-code profile and are not prerequisites for ordinary Founding Alpha development.
9. The candidate Job now accepts exactly one application task, creates its reviewed body Sandbox only when bound to the same approved application ID and fixed broker, and locally limits decline/expiry/withdrawal cleanup to those two application-linked Sandboxes. Per-career fixed-broker creation, secret installation, cleanup idempotency, and restart behavior still require one bounded end-to-end live workflow proof before intake can open.

## Phase records

- Launch plan: [`LAUNCH_PLAN.md`](../launch/LAUNCH_PLAN.md)
- Founding Alpha local evidence: [`FOUNDING_ALPHA_LOCAL.md`](./FOUNDING_ALPHA_LOCAL.md)
- Founding Alpha source freeze: [`founding-alpha-source-freeze.json`](./founding-alpha-source-freeze.json)
- Founding Alpha private slice: [`FOUNDING_ALPHA_PRIVATE_SLICE.md`](../launch/FOUNDING_ALPHA_PRIVATE_SLICE.md)
- Current Founding Alpha preflight: [`FOUNDING_ALPHA_PREFLIGHT_07.md`](./FOUNDING_ALPHA_PREFLIGHT_07.md)
- Consumed R01-04 preflight: [`FOUNDING_ALPHA_PREFLIGHT_06.md`](./FOUNDING_ALPHA_PREFLIGHT_06.md)
- Earlier execution-boundary preflight: [`FOUNDING_ALPHA_PREFLIGHT_05.md`](./FOUNDING_ALPHA_PREFLIGHT_05.md)
- Earlier post-name-contract preflight: [`FOUNDING_ALPHA_PREFLIGHT_04.md`](./FOUNDING_ALPHA_PREFLIGHT_04.md)
- Earlier post-packaging preflight: [`FOUNDING_ALPHA_PREFLIGHT_03.md`](./FOUNDING_ALPHA_PREFLIGHT_03.md)
- Founding Alpha R01-02 failed-closed result: [`FOUNDING-ALPHA-R01-02-FAILED-CLOSED.md`](./FOUNDING-ALPHA-R01-02-FAILED-CLOSED.md)
- Founding Alpha R01-03 failed-closed result: [`FOUNDING-ALPHA-R01-03-FAILED-CLOSED.md`](./FOUNDING-ALPHA-R01-03-FAILED-CLOSED.md)
- Founding Alpha R01-04 failed-closed result: [`FOUNDING-ALPHA-R01-04-FAILED-CLOSED.md`](./FOUNDING-ALPHA-R01-04-FAILED-CLOSED.md)
- Earlier replacement preflight: [`FOUNDING_ALPHA_PREFLIGHT_02.md`](./FOUNDING_ALPHA_PREFLIGHT_02.md)
- Earlier Founding Alpha preflight: [`FOUNDING_ALPHA_PREFLIGHT_01.md`](./FOUNDING_ALPHA_PREFLIGHT_01.md)
- Gate 0/1 traceability: [`GATE_0_1_TRACEABILITY.md`](../launch/GATE_0_1_TRACEABILITY.md)
- Gate 1 evidence: [`GATE-01.md`](./GATE-01.md)
- Gate 2 approval packet: [`GATE_2_PRIVATE_STAGING_APPROVAL.md`](../launch/GATE_2_PRIVATE_STAGING_APPROVAL.md)
- Gate 2 six-Sandbox amendment: [`GATE_2_SIX_SANDBOX_AMENDMENT.md`](../launch/GATE_2_SIX_SANDBOX_AMENDMENT.md)
- Gate 2 body-init diagnostic amendment: [`GATE_2_BODY_INIT_DIAGNOSTIC_AMENDMENT.md`](../launch/GATE_2_BODY_INIT_DIAGNOSTIC_AMENDMENT.md)
- Gate 2 credential-boundary amendment: [`GATE_2_CREDENTIAL_BOUNDARY_AMENDMENT.md`](../launch/GATE_2_CREDENTIAL_BOUNDARY_AMENDMENT.md)
- Gate 2 failed-closed result: [`GATE-02-FAILED-CLOSED.md`](./GATE-02-FAILED-CLOSED.md)
- Gate 2 six-Sandbox failed-closed result: [`GATE-02-RUN-02-FAILED-CLOSED.md`](./GATE-02-RUN-02-FAILED-CLOSED.md)
- Gate 2 corrected-body failed-closed result: [`GATE-02-RUN-03-FAILED-CLOSED.md`](./GATE-02-RUN-03-FAILED-CLOSED.md)
- Gate 2 credential-corrected failed-closed result: [`GATE-02-RUN-05-FAILED-CLOSED.md`](./GATE-02-RUN-05-FAILED-CLOSED.md)
- Blaxel launch verification: [`BLAXEL_LAUNCH_VERIFICATION.md`](./BLAXEL_LAUNCH_VERIFICATION.md)
- Derived launch ledger: [`launch-ledger.json`](./launch-ledger.json)
- Approved-plan completion audit: [`COMPLETION_AUDIT.md`](./COMPLETION_AUDIT.md)
- MCP services: [`MCP-SERVICES.md`](./MCP-SERVICES.md)
- Phases 0-1: [`PHASE-00-01.md`](./PHASE-00-01.md)
- Phase 2: [`PHASE-02.md`](./PHASE-02.md)
- Phase 3: [`PHASE-03.md`](./PHASE-03.md)
- Phase 4: [`PHASE-04.md`](./PHASE-04.md)
- Phase 5: [`PHASE-05.md`](./PHASE-05.md)
- Phase 6: [`PHASE-06.md`](./PHASE-06.md)
- Phase 7: [`PHASE-07.md`](./PHASE-07.md)
- Phase 8: [`PHASE-08.md`](./PHASE-08.md)
- Phase 9: [`PHASE-09.md`](./PHASE-09.md)
- Phase 10: [`PHASE-10.md`](./PHASE-10.md)
- Phase 11: [`PHASE-11.md`](./PHASE-11.md)
- Phase 12: [`PHASE-12.md`](./PHASE-12.md)
