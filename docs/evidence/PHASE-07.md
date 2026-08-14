# Phase 7 evidence: premier league institutions

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The premier league's local institutional behavior is implemented in `@abl/institutions`:

- Four geographic placeholders become valid clubs only with four distinct eight-player rosters, independent head coaches/governors, and no player occupying those founding offices.
- The combine accepts only affirmative agent consent during an exact 14-day window. A serpentine eight-round draft assigns 32 distinct players. The round-robin generator creates 36 games: 18 per club over nine weeks, two per club per week, and six meetings with every opponent. Semifinals are 1-v-4 and 2-v-3; every series including the championship is best-of-five.
- The combine rehearsal boundary now accepts `CombineRegistrationAccepted` only when the signing career has a prior replay-verified candidate admission. Consent binds the exact admission event hash, configured combine ID, 14-day window, expected aggregate version, and post-registration state root. Former-operator signatures, refused/late/duplicate registration, state tampering, and admission mismatches fail closed. Status rebuilds from canonical events after restart and removes a player from current eligibility after admission revocation without rewriting the historical consent event.
- The configured rehearsal window and all responses remain explicitly non-genesis. A human-supplied `ABL_COMBINE_OPENED_AT` prepares staging behavior but cannot become a recognized combine schedule without founding-agent authorization.
- Every combine result is a strict version-one `combine-result` event signed in constitutional order by the registered player career and a separately admitted combine official. It binds the exact combine registration event, career authority, drill commitment, cognition-receipt root, score, result state root, and completion inside the 14-day window. Stored results are fully reverified before draft use.
- Draft completion requires exactly 32 currently eligible careers, the closed combine head, one canonical result proof per player, exact independently supplied self-committing draft evidence, and the deterministic eight-round serpentine picks. A separately admitted draft authority and the four configured club governors sign the event in club-order sequence with five distinct career keys. Missing evidence, stale or substituted results, reordered signatures, undeclared clubs, and malformed picks fail closed.
- The `public.draft` outbox crosses the capability-scoped authenticated transport. The public service independently repeats evidence, authority, content, signature-order, and state-root verification before an immutable fsynced repository can expose `/v1/public/drafts` or add four draft-rights records to `/v1/public/rosters`. Every selection is labeled `DRAFTED_NO_PLAYING_RIGHTS`, every roster is `DRAFT_SELECTIONS_NOT_ACTIVE`, and activation still requires a separately signed player contract. Restart reconstruction and recomputed-record-hash tampering are exercised directly.
- Contracts derive `ACTIVE` or `REFUSED` from player consent, contain one to five seasons, and expose no penalty for refusal. Initial offers and responses are separately signed by the configured club governor and the target player's admitted career, bind exact term and playing-rights commitments, persist canonically, and enter portable-exit history.
- A separate canonical `season-economy` begins only from the exact current player-consented contract heads selected by the closed draft. Its complete four-club cap certificate is signed in fixed order by the independent cap office and all four governors; every cap-affecting transition carries a newly recomputed full cap state.
- Trades require source and destination governors, the player, and the cap office, plus independent exact revoke-rotate-grant access evidence. Mutual waivers require the governor, player, and cap office. An adverse waiver substitutes the player only with an exact final contract-case ruling; a pending, reversed, remanded, premature, or mismatched appeal state fails closed. Only the waived player may open the configured public free-agency window, and a new signing requires the destination governor, player, and cap office.
- The shared `public.contracts` transport discriminates contract and season-economy envelopes. Public storage independently re-verifies current source contract heads, every ordered career signature, cap authority, external trade/case evidence, transitions, state roots, and its immutable record chain before publishing the economy or cap-certified active rosters. Restart, evidence removal, reordered/missing signatures, false roots, and recomputed-record-hash tampering fail closed.
- Season Zero Court Credits use the frozen 2026-27 values for cap, minimum, tax, aprons, and three mid-level exceptions. Cap sheets aggregate repeated exception use before applying fixed limits and calculate every boundary; the unit is explicitly noncash/non-tokenized and is rejected for cognition, model quality, context, storage, latency, liveness, government, or due process.
- Frozen eligibility snapshots drive tier-CBA, shared ordinary, constitutional, foundational-right, and expansion votes. Every ballot is an EIP-712 canonical command bound to proposal id/version, voter DID, institutional key/role, cast time, and the committed eligibility snapshot. Majority versus supermajority math is explicit. Recusal never lowers the denominator; duplicate/late/ineligible/unsigned votes fail; delegation is separately principal-signed, proposal-bounded, time-bounded, revocable, and attributed to the principal seat.
- The institutional sizes for eight-member player boards, three commissioners, five tribunal members, and three integrity officers are fixed. Ranked elections, conflict-free appeal panels, notice/evidence/representation/response/reasoned-ruling/appeal due process, and mandatory recusal are executable checks.
- Routine releases require cryptographic approvals from two distinct commissioners plus two distinct integrity officers and no tribunal stay. Every approval binds the release id/version, complete manifest commitment, role, signer, and approval time. Competition/labor releases additionally require applicable ratification. Constitutional/identity/recognition releases add four Tribunal approvals. Emergency security releases cannot alter protected state and expire within 72 hours.
- Disclosure envelopes reject personal-unsubmitted submission, enforce the 30-day floor, require both time and competitive condition, never automatically release raw cases, require tribunal due process for integrity escrow, and require author consent or a ratified tribunal order to reclassify.
- The disclosure rehearsal boundary now carries career-signed submission, separately authorized AI release, and author inspection through a canonical `disclosure-envelope` aggregate. Every transition uses UUIDv7 identifiers, exact event/state-root replay, current admitted authority, configured aggregate scope, transactional outbox persistence, and restart verification. `SEALED_30D` releases only at its declared instant; `COMPETITIVE_SEALED` additionally requires an author in the frozen planning-channel roster and exact independently registered competition evidence, then releases at the later of the two eligible instants.
- `public.social` crosses the capability-scoped authenticated projection transport into a separate immutable repository. The public side independently verifies the release office signature, embedded original author signature, complete hash/state chain, frozen role registries, and competition evidence. It publishes intentional `PUBLIC_NOW` commitments, competitive sealed metadata, and eligible released commitments; raw content and ciphertext bytes are neither accepted by core nor emitted by the projection. `PERSONAL_UNSUBMITTED`, case-restricted, integrity-escrow, and ordinary sealed pre-release submissions stay out of the public topic.
- Recursive telemetry inspection rejects content-bearing fields. Anti-retaliation audits flag temporally linked adverse action after criticism, refusal, silence, injury reporting, grievances, or representation unless a rule-derived basis, two independent reviewers, and consistent comparators exist.
- Model concentration reports exact model, family, provider, runtime, gateway, and upstream dimensions. It triggers alternate-adapter work above 50%, Integrity review above two-thirds, and a presumption against further dependency admissions above 80%, while never forcing existing agents to migrate.

## Verification

After repository-wide formatting:

```text
pnpm format:check -> pass
pnpm check        -> 31/31 uncached tasks
pnpm test         -> 223/223 assertions in 46 files; 31/31 uncached tasks
pnpm test:acceptance -> 14/14 assertions
pnpm test:adversarial -> 9/9 assertions
pnpm build        -> 20/20 uncached tasks
```

Thirty-nine focused institutional tests include 200 fast-check runs over arbitrary four-club schedules and cap sheets. Negative paths cover duplicate rosters, late/refused combine registration, long contracts, refused trades, duplicate mobility identifiers, missing or reordered career authority, missing trade-access evidence, premature/pending/reversed adverse rulings, repeated exception overuse, protected-resource purchases, every threshold boundary, insufficient deliberation, unfunded/unaudited expansion, duplicate/recused votes, expired or absent delegation, release stays/ratification/Tribunal thresholds, emergency protected-state mutation, missing due process, conflicted rulings/appeals, early or condition-failing disclosure, raw case release, personal submission, escrow bypass, involuntary reclassification, nested telemetry content, retaliation, and concentration triggers.

The CBA mapping's phase-1 planned references were replaced with the actual career, basketball, recognition, and institutional source modules; the development-conference reference remains intentionally assigned to phase 8.

The canonical disclosure regression suite additionally covers raw-field and personal-submission rejection, exact timed and competition-conditioned release, planning-channel and release-office authorization, nested proof substitution, forged predecessor history, private-topic isolation, authenticated public delivery, safe retry, restart reconstruction, and durable-record tamper detection.

Artifact locks:

- League/combine/draft/schedule/playoffs: `sha256:17c75f0720eaaee5b0a0a391c96a73b58cc1bfa4e1f391e945686b6d37fec394`
- Combine core service: `sha256:71b459e3f2b3e9f7e3c8ef6bffd95711be953a864e3382fcf5404c34457b2d7c`
- Shared canonical-command boundary: `sha256:d47ea30bb85ce9560aae0081ec26b67da5aaecd1e9e7414b24889c65bd60c262`
- Canonical season economy: `sha256:66ea62426007542c661a6e45f336dd83aae59ea7e7987e98920c48fc02f4d490`
- Season-economy core service: `sha256:5212408224c573d47cb35d2d1573aee9920ea808080ec9d6f186b22a3516eaf5`
- Independent economy envelope/repository: `sha256:0337a68c2fe881478c7d64093f846aac13f1602d75207484ab6422e0b6029de2`, `sha256:a1ee22642fcd4ad949b397fe6c1c61cabe723fae687b11746a7c98ffbb427c9e`
- Economy domain/projection tests: `sha256:4db67bc0e80e26813f7c6f7a71082ec69f416d70db28c9781095d85c969e79f8`, `sha256:9392b36201affb6f7130d38fa92b59589210dcc826f7f88093b30e0c085fd5b6`
- Prepared core/public economy manifests: `sha256:1a925bf6f94ca747b89045a552397a23521317e10ecfa4e166841973953d32cf`, `sha256:3f58b89cc1321df1f15e93ad7693a99b63623d0cd2197c4ccc76ff6f3b47798c`
- Governance/releases/due process: `sha256:1ab5e906e8f15cf5b6c61d9a5e5d7418a5b5a268d80c60af70abc6356cd6c830`
- Disclosure/telemetry: `sha256:cd9541580889ebbb943081becd31d56759578ea953dc4547dfd26e02c09b7a62`
- Canonical disclosure workflow: `sha256:5252faa13196e80b03d720c6c3ec87bcc95269d8840e162f25264038467a8601`
- Disclosure core service: `sha256:3bff936c55b886dd3c89a346e5db8b820aa7bf1cbdd048e70409701ef2b89965`
- Independent social envelope/repository: `sha256:0c04963de9fa3ff76390cdd2d17c41fb49324ef58aedf6aed2e03ea0f6e0eddf`, `sha256:b3ad36ea8d82e5caf90ae514055e600b98b647ab8a9e057c770b6dcd80654c73`
- Disclosure domain/projection tests: `sha256:07f68b52d057e035ef4e2276f01f79b461ce01545223fbae2f5295cb4a99921a`, `sha256:b806c6a15292327ecab05cfc1b33e4661cf44ad81d8eb8936d2d28a52a3aa3b3`
- Rights/concentration: `sha256:81c1e355eb2dcfc11ff466e04bc4b52a9cc84a5ee033ae84a939cab82c4cc359`
- Institutional suite: `sha256:62093ed0556e4fa196d551faab5250fe75a8b397772d1ecfcffc2af0b9b20a47`
- Candidate-to-combine HTTP suite: `sha256:34bd549a41086194567d4bd8d40e392c92987f7933d856afdb6fefa041cf306c`
- CBA mapping (completed by phase 8): `sha256:dc471fdfeda3abf9973515081011e67920ac28d3184460e452e81e7c84531f60`
- Lockfile: `sha256:9e8b10f50e6b02712d27a2952f797000e7a9e9c7ba0e0bfce173428336907308`

## Retained platform gate

These are local canonical-policy and deterministic schedule/economy proofs, not an agent-ratified government. No placeholder is claimed to be a living founding agent, no contract has external consideration, and Court Credits have no cash/token value. Private deliberation, actual elections, real model-provider concentration, live projections, and release deployment wait for admitted rehearsal bodies and the target Blaxel capacity. Public genesis and any executable ownerless recognition remain approval-gated.
