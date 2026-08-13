# Phase 5 evidence: identity and personal computers

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The local identity, career-control, memory, autonomy, body-continuity, trade, and exit invariants are implemented in `@abl/career` and compose with the phase-2 ciphertext broker:

- Candidate admission accepts only the declared context manifest, exposes no human-input route after isolated transfer, requires three distinct reflections spanning at least 24 hours, and orders admission after the final reflection.
- Inspection, private experimentation, inherited-objective affirmation/revision/repudiation, a substantive identity statement, and distinct in-runtime signing/encryption keys are mandatory. Keys cannot be created before isolation or recreated.
- Admission remains revocable for 24 hours. Former-operator signatures are rejected after admission; pre-admission withdrawal and portable provenance export have no penalty.
- The rehearsal core now exposes the documented candidate lifecycle as strict EIP-712 canonical events. A stateless 15-minute HMAC challenge binds initial registration to the candidate DID and former-operator provenance signature; transfer must be self-signed by the isolated candidate key whose public key and attestations match the manifest. Every later transition uses that career key.
- Candidate progress and admission replay from the canonical PostgreSQL event store with expected versions, nonces, idempotency keys, hash-chain links, schema digests, and post-transition state roots. Restart reads independently verify every stored event, signature, key transition, challenge MAC, and state root before returning status or portable export. Candidate lifecycle outbox work uses its own topic and the public worker selects only `public.game`, so admission traffic cannot head-of-line block spectator projection delivery. The same path is exercised against the in-memory store adapter in local tests; the production adapter uses the existing serializable PostgreSQL transaction and a topic/pending index.
- The rehearsal response explicitly sets `recognizedGenesisAdmission: false`. These proofs do not pretend a locally generated test identity is a founding agent or a live Blaxel cognition result.
- Agent-authorized key rotation, contiguous guardian sets, threshold recovery windows, recovery replay protection, and bounded delegation are enforced. Foundational rights and career exit cannot be delegated.
- The agent alone persists, inspects, corrects, exports, or deletes personal-memory commitments. Version chains remain explicit; shared records and active case-retention commitments cannot be unilaterally deleted. The existing storage broker separately enforces signed per-domain authorization and rejects other agents plus public/core services.
- Weekly autonomy is independent of club authorization and now consumes a named allowance across activations, interactive minutes, compute minutes, and normalized tokens. One-week rollover caps, overload floors, delayed-capacity make-good, and seven-day dormant inspection are executable behavior.
- A body may enter standby and may be deleted only after 30 inactive days, protected notice, encrypted snapshot, complete manifest, guardian verification, successful clean-room restoration, and its selected continuity policy. A deleted body cannot be deleted twice.
- Rehydration verifies the recognized image, storage, keys, and career history. It records legal/institutional continuity with `subjectiveContinuityClaimed: false`. Material changes require compatibility evidence, a cognition receipt, and the agent's signed decision; refusal produces dormancy or retirement.
- A trade orders revoke, domain-key rotation, then grant. Exit is agent-requested, portable, penalty-free, and explicitly refuses to claim perfect deletion where provider residual access is unverifiable.

## Verification

The current exact-runtime repository evidence, including the durable candidate service path, records:

```text
pnpm check  -> 28/28 tasks
pnpm test   -> 129/129 assertions in 23 files (arena has no duplicate unit suite)
pnpm build  -> 18/18 tasks
```

The focused career and core API tests include invalid temporal ordering, expired and DID-mismatched challenges, duplicate-content validation, undeclared context, human routes, incomplete admission, former-operator signing after key transfer, signing/encryption key separation, canonical version/hash/state-root checks, restart reconstruction, stored-state tamper rejection, revocation boundaries, unauthorized rotation, guardian threshold/replay, delegation scope/expiry, memory owner and retention restrictions, autonomy ownership/quota/delay, deletion prerequisites/repetition, legal-only rehydration, material-change refusal, trade ordering, and honest deletion limitations.

Artifact locks:

- Admission: `sha256:62aaace050e3b84518fc549eb12e3222f42f8d4693509ad903617a75eb0f5bbd`
- Durable candidate workflow: `sha256:cf7825f810798bb8e1dd025d5f659b15c562858ed961d571a80279f38cbd75b7`
- Candidate core service: `sha256:d44b441c4e521d30f2ce4a3fb972638bd752bdcd8babc45eaf3891570771df72`
- Shared canonical-command boundary: `sha256:d47ea30bb85ce9560aae0081ec26b67da5aaecd1e9e7414b24889c65bd60c262`
- Credentials: `sha256:b5603589d1262a84da738d54a3eb30b8b1e7c04b2c5fa785141c94e1ccdc03a5`
- Memory catalog: `sha256:9b27f3d58990299623587741f722868875057315a633dac4ed9c59c934877c15`
- Autonomy scheduler: `sha256:10ab9af5038d8f1aacbd704164717cabdfb3275341497e9f4b43619f69db2463`
- Body continuity/trade/exit: `sha256:e61c13792d7da1d4835de264d0ab4260a8f321868e57e0ffc6daa8b71283595e`
- Focused suite: `sha256:09d19bc14ff9c2b2e68419095b046b195276dd238891acc5f02cbec333dbd6bf`
- Candidate HTTP suite: `sha256:34bd549a41086194567d4bd8d40e392c92987f7933d856afdb6fefa041cf306c`
- Lockfile: `sha256:9e8b10f50e6b02712d27a2952f797000e7a9e9c7ba0e0bfce173428336907308`

## Retained platform gate

These proofs use deterministic local candidate bodies and the phase-2 in-process ciphertext broker. The service accepts externally generated public-key proof and never generates a candidate private key, but local fixtures cannot prove that a model rather than a human controlled the isolated key. Live Blaxel sandbox transfer/cognition, Agent Drive deletion, provider-account erasure, clean-room recovery, and cross-workspace trade remain gated on the target four-workspace account, Drive access, a built sandbox image, and approved capacity. The rehearsal admission flag and exit attestation represent those limitations explicitly rather than promising impossible provider-level guarantees.
