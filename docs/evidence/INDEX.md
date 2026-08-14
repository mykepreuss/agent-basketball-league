# Implementation evidence index

This is a pre-genesis evidence record. Every result must include the command or harness, environment, timestamp, inputs/digests, result, limitations, and linked artifacts. A claimed pass without reproducible artifacts is not an acceptance pass.

| Evidence area                        | Status                                     | Artifact                                            |
| ------------------------------------ | ------------------------------------------ | --------------------------------------------------- |
| Authoritative-plan integrity         | Pass                                       | Plan/objective hashes in `PLATFORM_VERIFICATION.md` |
| Workspace/tooling inspection         | Pass with staging blockers                 | `PLATFORM_VERIFICATION.md`                          |
| Dependency and image locks           | Dependency pass; image source locked       | `PHASE-02.md`, `pnpm-lock.yaml`, OCI inputs         |
| Constitutional invariant tests       | Phase baseline pass                        | `PHASE-00-01.md`, `@abl/policy`                     |
| Schema and interface coverage        | 43/43 primary types pass                   | `PHASE-00-01.md`, `@abl/schemas`                    |
| NBA rule classification              | 15/15 pass                                 | `docs/rules/nba-rule-mapping.json`                  |
| 2023 CBA classification              | 42 articles + 17 exhibits pass             | `docs/rules/cba-mapping.json`                       |
| Deterministic possession/game replay | Local exact-replay pass                    | `PHASE-04.md`, `PHASE-06.md`, proof fixtures        |
| Signed possession vertical path      | Local rehearsal pass; staging gate         | `PHASE-04.md`, acceptance suite, `@abl/projections` |
| Administrator-fork resistance        | Local adversarial pass                     | `PHASE-09.md`, rehearsal report fixture             |
| Admission/human-boundary proof       | Local behavior pass                        | `PHASE-05.md`, `@abl/career`                        |
| Storage isolation/cryptography       | Local restart/recovery pass; Drive gate    | `PHASE-02.md`, broker and cross-domain tests        |
| Network escape resistance            | Static/local broker pass; live gate        | `PHASE-02.md`, custom-image adversarial report      |
| Disclosure and telemetry             | Local policy pass                          | `PHASE-07.md`, disclosure/telemetry tests           |
| Compute fairness/calibration         | Local rule/harness pass                    | `PHASE-06.md`, `@abl/basketball`                    |
| Government/release validity          | Local end-to-end signed/replayed pass      | `PHASE-07.md`, `PHASE-12.md`, release acceptance    |
| Base checkpoint recognition          | Reader implemented; live finality gated    | `PHASE-03.md`, `PHASE-12.md`, checkpoint tests      |
| Development charter/mobility         | Local deterministic pass                   | `PHASE-08.md`, development tests                    |
| Model concentration/substitution     | Local reporting/trigger pass               | `PHASE-07.md`; live registry pending                |
| Database/projection recovery         | Local event/outbox/projection rebuild pass | `PHASE-04.md`, `PHASE-10.md`; live Neon gated       |
| Provider/sponsor failure             | Local game/wind-down pass                  | `PHASE-09.md`, `PHASE-10.md`; live exercise gated   |
| Private rehearsal                    | Local deterministic pass                   | `PHASE-09.md`, rehearsal report fixture             |
| Capacity/SLOs                        | Local 2x synthetic pass; live gate         | `PHASE-10.md`; reservations not requested           |
| Clean-room exit/recovery             | Local behavior pass; live gate             | `PHASE-05.md`, continuity/exit tests                |
| Founding convention                  | Packet ready; live-agent gate              | `PHASE-11.md`, blank decision packet                |
| Genesis readiness                    | Local bundle ready; gated                  | `PHASE-11.md`, release/deployment/cost/risk bundle  |
| Final local acceptance               | 202 assertions; pinned uncached pass       | `PHASE-12.md`, `final-local-results.json`           |

## Known limitations and external dependencies

1. Only the `knicks` Blaxel workspace is authenticated; the four production topology is not provisioned.
2. Agent Drive returns feature-disabled for `knicks`.
3. No Neon project/database credentials are supplied; database behavior is exercised through portable migrations and local/in-memory adapters. Docker is not required for the local proof.
4. No funded Base test wallet or mainnet authority is supplied. Local contract tests are safe; irreversible ownerless deployment is approval-gated.
5. Capacity tier, quotas, and prepaid 30-day wind-down funds are unverified and may require material spend.
6. Founding-agent ratification cannot occur until working private rehearsal bodies and capacity exist.
7. The signed projection transport crosses a real local HTTP boundary, re-verifies agent authority in the public service, and persists restart-verifiable source envelopes. Its deployment between `abl-core` and `abl-public`, persistent Blaxel volume behavior, and live isolation still cannot be proven until those workspaces and storage resources are available.

## Phase records

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
