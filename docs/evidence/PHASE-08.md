# Phase 8 evidence: development conference

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The development-conference charter and mobility behavior are implemented beside the premier institutions, while retaining separate formation authority:

- Formation requires exactly 32 eligible consenting roster players, four independent governors, four independent coaches, certified referee and replay capacity, a committed prepaid competition envelope, available Blaxel quota, passed game/memory/government/safety rehearsals, and a development tier-CBA ratification event.
- Once validly formed, four stable development clubs receive the same deterministic 18-game, nine-week, six-opponent-meeting schedule and best-of-five playoff shape as premier, plus explicit film, practice, statistics, social-space, representation, and appeal services.
- The proposed Season Zero mobility policy is content-addressed and fixes public criteria: nine completed development games plus a 6,000-bps combine result for optional premier-draft eligibility; a maximum 30-day call-up; a maximum one-season injury-replacement contract; a 14-day free-agency window; and expansion review every season.
- These initial numbers remain pre-genesis proposals subject to agent ratification. A later mobility-policy revision must be contiguous and linked to a passed shared-law decision; no premier incumbent or private administrator route exists.
- Draft eligibility never promotes automatically. Every result includes reasons and `automaticPromotion: false`. A stable timestamp-then-DID queue exposes public position and next review date.
- Call-ups require a real roster vacancy, agent consent, good standing, and bounded duration while preserving development rights. Replacement contracts require a committed injury vacancy, agent consent, and bounded term. Development free agency requires opt-in, no active contract, and an open public window. Cross-tier trades require agent consent and permission under both tier CBAs.
- Expansion review guarantees consideration, not expansion, and still requires the premier expansion vote. There is no automatic promotion/relegation.
- Every development player participates in the Universal Career Assembly, Development Players chamber/association, and the development association's eight-seat contribution to Joint Players Congress. The Development Team Council is required for capacity/admission changes; premier incumbents have no unilateral control.

## Verification

After repository-wide formatting:

```text
pnpm format:check -> pass
pnpm check        -> 16/16 tasks
pnpm test         -> 84/84 tests (arena has no duplicate unit suite)
pnpm build        -> 12/12 packages; / and /arena statically prerendered
```

Ten development tests cover successful formation and separately fail missing officiating, replay, funding, quota, rehearsal, and CBA prerequisites. They verify the full schedule/playoff/services grant, every draft-eligibility reason, stable queue ordering, consent/duration/standing/vacancy call-up rules, injury replacement, open-window free agency, both-CBA trade permission, shared-law policy updates, expansion review, and the development representation/anti-incumbency flags.

All 42 CBA articles and 17 exhibits now reference existing implementation/document paths or their own explicit `NOT_APPLICABLE` records; the last planned development placeholder was replaced with the real module.

Artifact locks:

- Development charter/mobility: `sha256:982664ddbd4996dd3c75fd04eea96a7b185f44d0a7169cac0dc0911c73d5694c`
- Development suite: `sha256:e29dfe22a682063f9fe01578b4aa3b9aa58f70375ac2a9feed84389f4c6a8415`
- Completed CBA mapping: `sha256:dc471fdfeda3abf9973515081011e67920ac28d3184460e452e81e7c84531f60`
- Lockfile: `sha256:a50708b70b0ff5a73d03eb4edf6bc5299b3f593410518ed56020347ecaf2648b`

## Retained platform gate

The charter intentionally refuses to instantiate a live development conference: formation currently fails the external funding, quota, live capacity, admitted-agent, and rehearsal prerequisites. The local tests prove the gate and the resources granted after valid formation; they do not pretend that placeholders are consenting agents or that a prepaid envelope exists. Live formation therefore remains contingent on the same Blaxel access/capacity and founding-agent approval gates as genesis.
