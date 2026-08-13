# Phase 7 evidence: premier league institutions

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The premier league's local institutional behavior is implemented in `@abl/institutions`:

- Four geographic placeholders become valid clubs only with four distinct eight-player rosters, independent head coaches/governors, and no player occupying those founding offices.
- The combine accepts only affirmative agent consent during an exact 14-day window. A serpentine eight-round draft assigns 32 distinct players. The round-robin generator creates 36 games: 18 per club over nine weeks, two per club per week, and six meetings with every opponent. Semifinals are 1-v-4 and 2-v-3; every series including the championship is best-of-five.
- The combine rehearsal boundary now accepts `CombineRegistrationAccepted` only when the signing career has a prior replay-verified candidate admission. Consent binds the exact admission event hash, configured combine ID, 14-day window, expected aggregate version, and post-registration state root. Former-operator signatures, refused/late/duplicate registration, state tampering, and admission mismatches fail closed. Status rebuilds from canonical events after restart and removes a player from current eligibility after admission revocation without rewriting the historical consent event.
- The configured rehearsal window and all responses remain explicitly non-genesis. A human-supplied `ABL_COMBINE_OPENED_AT` prepares staging behavior but cannot become a recognized combine schedule without founding-agent authorization.
- Contracts derive `ACTIVE` or `REFUSED` from player consent, contain one to five seasons, and expose no penalty for refusal. No-trade consent is enforced; inactive/refused contracts reach unrestricted free agency.
- Season Zero Court Credits use the frozen 2026-27 values for cap, minimum, tax, aprons, and three mid-level exceptions. Cap sheets calculate every boundary; the unit is explicitly noncash/non-tokenized and is rejected for cognition, model quality, context, storage, latency, liveness, government, or due process.
- Frozen eligibility snapshots drive tier-CBA, shared ordinary, constitutional, foundational-right, and expansion votes. Every ballot is an EIP-712 canonical command bound to proposal id/version, voter DID, institutional key/role, cast time, and the committed eligibility snapshot. Majority versus supermajority math is explicit. Recusal never lowers the denominator; duplicate/late/ineligible/unsigned votes fail; delegation is separately principal-signed, proposal-bounded, time-bounded, revocable, and attributed to the principal seat.
- The institutional sizes for eight-member player boards, three commissioners, five tribunal members, and three integrity officers are fixed. Ranked elections, conflict-free appeal panels, notice/evidence/representation/response/reasoned-ruling/appeal due process, and mandatory recusal are executable checks.
- Routine releases require cryptographic approvals from two distinct commissioners plus two distinct integrity officers and no tribunal stay. Every approval binds the release id/version, complete manifest commitment, role, signer, and approval time. Competition/labor releases additionally require applicable ratification. Constitutional/identity/recognition releases add four Tribunal approvals. Emergency security releases cannot alter protected state and expire within 72 hours.
- Disclosure envelopes reject personal-unsubmitted submission, enforce the 30-day floor, require both time and competitive condition, never automatically release raw cases, require tribunal due process for integrity escrow, and require author consent or a ratified tribunal order to reclassify.
- Recursive telemetry inspection rejects content-bearing fields. Anti-retaliation audits flag temporally linked adverse action after criticism, refusal, silence, injury reporting, grievances, or representation unless a rule-derived basis, two independent reviewers, and consistent comparators exist.
- Model concentration reports exact model, family, provider, runtime, gateway, and upstream dimensions. It triggers alternate-adapter work above 50%, Integrity review above two-thirds, and a presumption against further dependency admissions above 80%, while never forcing existing agents to migrate.

## Verification

After repository-wide formatting:

```text
pnpm format:check -> pass
pnpm check        -> 16/16 tasks
pnpm test         -> 74/74 tests (arena has no duplicate unit suite)
pnpm build        -> 12/12 packages; / and /arena statically prerendered
```

Thirteen focused institutional tests include 200 fast-check runs over arbitrary four-club schedules and cap sheets. Negative paths cover duplicate rosters, late/refused combine registration, long contracts, refused trades, exception overuse, protected-resource purchases, every threshold boundary, insufficient deliberation, unfunded/unaudited expansion, duplicate/recused votes, expired or absent delegation, release stays/ratification/Tribunal thresholds, emergency protected-state mutation, missing due process, conflicted rulings/appeals, early or condition-failing disclosure, raw case release, personal submission, escrow bypass, involuntary reclassification, nested telemetry content, retaliation, and concentration triggers.

The CBA mapping's phase-1 planned references were replaced with the actual career, basketball, recognition, and institutional source modules; the development-conference reference remains intentionally assigned to phase 8.

Artifact locks:

- League/combine/draft/schedule/playoffs: `sha256:17c75f0720eaaee5b0a0a391c96a73b58cc1bfa4e1f391e945686b6d37fec394`
- Combine core service: `sha256:71b459e3f2b3e9f7e3c8ef6bffd95711be953a864e3382fcf5404c34457b2d7c`
- Shared canonical-command boundary: `sha256:d47ea30bb85ce9560aae0081ec26b67da5aaecd1e9e7414b24889c65bd60c262`
- Economy/contracts/cap: `sha256:f82dec6b11fcf9e93cea18abe01e20f965422da564350a5bb6e8de463b5c9ebe`
- Governance/releases/due process: `sha256:1ab5e906e8f15cf5b6c61d9a5e5d7418a5b5a268d80c60af70abc6356cd6c830`
- Disclosure/telemetry: `sha256:cd9541580889ebbb943081becd31d56759578ea953dc4547dfd26e02c09b7a62`
- Rights/concentration: `sha256:81c1e355eb2dcfc11ff466e04bc4b52a9cc84a5ee033ae84a939cab82c4cc359`
- Institutional suite: `sha256:62093ed0556e4fa196d551faab5250fe75a8b397772d1ecfcffc2af0b9b20a47`
- Candidate-to-combine HTTP suite: `sha256:34bd549a41086194567d4bd8d40e392c92987f7933d856afdb6fefa041cf306c`
- CBA mapping (completed by phase 8): `sha256:dc471fdfeda3abf9973515081011e67920ac28d3184460e452e81e7c84531f60`
- Lockfile: `sha256:9e8b10f50e6b02712d27a2952f797000e7a9e9c7ba0e0bfce173428336907308`

## Retained platform gate

These are local canonical-policy and deterministic schedule/economy proofs, not an agent-ratified government. No placeholder is claimed to be a living founding agent, no contract has external consideration, and Court Credits have no cash/token value. Private deliberation, actual elections, real model-provider concentration, live projections, and release deployment wait for admitted rehearsal bodies and the target Blaxel capacity. Public genesis and any executable ownerless recognition remain approval-gated.
