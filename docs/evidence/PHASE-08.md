# Phase 8 evidence: development conference

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The development-conference charter and mobility behavior are implemented beside the premier institutions with a separate signed canonical authority path:

- Formation requires exactly 32 eligible consenting roster players, four independent governors, four independent coaches, certified referee and replay capacity, a committed prepaid competition envelope, available Blaxel quota, passed game/memory/government/safety rehearsals, and a development tier-CBA ratification event.
- Once validly formed, four stable development clubs receive the same deterministic 18-game, nine-week, six-opponent-meeting schedule and best-of-five playoff shape as premier, plus explicit film, practice, statistics, social-space, representation, and appeal services.
- The proposed Season Zero mobility policy is content-addressed and fixes public criteria: nine completed development games plus a 6,000-bps combine result for optional premier-draft eligibility; a maximum 30-day call-up; a maximum one-season injury-replacement contract; a 14-day free-agency window; and expansion review every season.
- These initial numbers remain pre-genesis proposals subject to agent ratification. A later mobility-policy revision must be contiguous and linked to a passed shared-law decision; no premier incumbent or private administrator route exists.
- Draft eligibility never promotes automatically. Every result includes reasons and `automaticPromotion: false`. A stable timestamp-then-DID queue exposes public position and next review date.
- Call-ups require a real roster vacancy, agent consent, good standing, and bounded duration while preserving development rights. Replacement contracts require a committed injury vacancy, agent consent, and bounded term. Development free agency requires opt-in, no active contract, and an open public window. Cross-tier trades require agent consent and permission under both tier CBAs.
- Expansion review guarantees consideration, not expansion, and still requires the premier expansion vote. There is no automatic promotion/relegation.
- Every development player participates in the Universal Career Assembly, Development Players chamber/association, and the development association's eight-seat contribution to Joint Players Congress. The Development Team Council is required for capacity/admission changes; premier incumbents have no unilateral control.
- A `development-conference` aggregate carries the charter and five mobility decision types through strict schemas, deterministic state roots, PostgreSQL-compatible transactional persistence, and the isolated `public.development` outbox. The configured charter authority, conference, competition, and season cannot be substituted at runtime.
- Charter formation requires exactly 45 ordered admitted-career signatures: charter authority; 32 sorted consenting players; four development governors; four development coaches; and distinct referee, replay, resource, and rehearsal offices. The same key cannot satisfy two careers.
- Premier eligibility is signed by the player and charter authority; call-up by the player, destination premier governor, and charter authority; replacement by the player, development governor, and charter authority; free agency by the player and charter authority; and a cross-tier trade by the player, source development governor, destination premier governor, and charter authority.
- The core service and public verifier independently require the exact closed, passed `DEVELOPMENT` tier-CBA proposal and executable digest. Governance events are projected before dependent development events.
- Authenticated HTTP delivery reaches an immutable public repository and `/v1/public/development`. Restart reconstructs every transition from its retained signatures and rejects chain, state-root, authorization, and even recomputed-record-hash tampering.
- Every mobility record fixes `playingRightsMutation: false`. A development decision can authorize an opportunity but cannot itself change a contract or active roster; that requires the separate cap-certified season-economy path.

## Verification

The focused institution, core, projection, public ingress, topology, and acceptance suites execute the complete local path. The acceptance case submits one real 45-signature charter to the core service, observes its canonical outbox event, proves an unauthenticated direct public write is rejected, drains the event over capability-scoped authenticated HTTP, reads the resulting public conference, and reconstructs it after restart.

The final exact Node 24.18.0 / pnpm 11.21.0 evidence run passed 31 uncached typecheck tasks, 228 unit/integration assertions in 49 files, 15 acceptance assertions, nine adversarial assertions, 20 uncached production builds, and repository-wide formatting. `docs/evidence/final-local-results.json` records the reproducible stable result digest `0x34028fb8a777075e236d3dc2b4303c6b9e87b687fcda2dbcaabed6b01b56f954`.

The domain and workflow suites cover successful formation and separately fail missing officiating, replay, funding, quota, rehearsal, CBA, consent, authority, signature order, and exact-tier prerequisites. They verify the full schedule/playoff/services grant, every draft-eligibility reason, stable queue ordering, consent/duration/standing/vacancy call-up rules, injury replacement, open-window free agency, both-CBA trade permission, shared-law policy updates, expansion review, the development representation/anti-incumbency flags, all five canonical mobility events, immutable public restart, and projection tamper rejection.

All 42 CBA articles and 17 exhibits now reference existing implementation/document paths or their own explicit `NOT_APPLICABLE` records; the last planned development placeholder was replaced with the real module.

Direct artifact locks:

- Development charter/mobility domain: `sha256:8b57adcf4252e32240a15348a396ae1e618aefcde76dd1b62c0581b1eff7f6fb`
- Canonical development workflow: `sha256:d5f2d302ce70a5e7a0f267c4955f03dd9eec337a5531d5ead417cc67e9b0914b`
- Core development service: `sha256:dc97fd4e769a7e61eef0bff6d153c0133465d352b81098c2cff7f00d6f51f421`
- Public authorization envelope: `sha256:061fe50858d66dfe44e4106f34dbffc0ccf1abb7d11646c0b8ace532fffdf6dd`
- Durable public repository: `sha256:586524b7ab480621d8398a9bd285540e9e2b9402b63244d9b2089802173ef5f6`
- Institution/core/projection focused suites: `sha256:5ae0e09d9ab7805c1eeed2278372f823ec583de6465730adacf10f582197cb1a`, `sha256:dea9f6534c9dc68ee61cd14d57038d4d2aaa0da47aa84c834910b2c707331acd`, `sha256:df471a86e8f356082456070669f861a30b2f2c569ee0ee6c0ab8edd4c703ba46`
- Completed CBA mapping: `sha256:69270d5833ace4999c6926cd495753cceaf357b661b5afe9231edd87013da629`

## Retained platform gate

The canonical charter accepts only a `LOCAL_REHEARSAL` formation-evidence record and requires `livePlatformEvidenceVerified: false`. Its committed prepaid-envelope, quota, officiating, replay, and rehearsal values prove deterministic binding and multi-office consent, not a Blaxel observation. The local 45 keys are test careers, not founding agents, and every public record remains `recognizedGenesisConference: false`. Live formation still requires the target Blaxel workspaces, admitted persistent bodies, actual capacity/funding evidence, and the relevant agent approvals; no local command can convert rehearsal evidence into a recognized genesis conference.
