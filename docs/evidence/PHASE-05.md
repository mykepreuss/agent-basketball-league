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
- The agent alone persists, inspects, corrects, exports, or deletes personal-memory commitments. Version chains remain explicit; shared records and active case-retention commitments cannot be unilaterally deleted. The rehearsal core now carries `PERSONAL_UNSUBMITTED` memory actions through a separate career-signed canonical aggregate. Every write binds a broker-verified ciphertext version/commitment; every deletion binds a durable private-broker tombstone; inspection and export return commitments only; restart re-verifies candidate, canonical, and storage history. Former-operator signatures, revoked careers, nonpersonal disclosure classes, missing storage, future-dated commands, nonmonotonic history, state tampering, and false deletion receipts fail closed. A currently admitted career may reconcile an older durable storage action after a cross-workspace outage. Shared, submitted, and case-restricted material remains assigned to its separate communication/case authority rather than weakening retention in this personal route.
- Body continuity now uses a separate career-signed canonical aggregate for policy registration/update, activity, standby, protected deletion notice, deletion, rehydration, material-change decisions, and inspection. Initial body metadata must match the admitted runtime, tools, guardian set, and signing-key lineage; every body image must belong to the configured recognized-image set. Deletion requires 30 days of inactivity, the exact canonical protected-wake notice, the policy notice period, a final signed manifest, guardian-verification and clean-room evidence commitments, and any policy-required export/decision. Runtime configuration cannot change in the deletion manifest, and rehydration cannot silently change image, runtime, kernel, tools, or signing lineage without consuming a matching affirmative decision. Restart replays every signature, event hash, state root, timestamp, and transition, while current revocation denies both new commands and duplicate inspections. Responses explicitly state that live platform evidence is unverified, so local commitments cannot be mistaken for Blaxel clean-room or guardian proof.
- Weekly autonomy is independent of club authorization and now consumes a named allowance across activations, interactive minutes, compute minutes, and normalized tokens. One-week rollover caps, overload floors, delayed-capacity make-good, and seven-day dormant inspection are executable behavior.
- A body may enter standby and may be deleted only after 30 inactive days, protected notice, encrypted snapshot, complete manifest, guardian verification, successful clean-room restoration, and its selected continuity policy. A deleted body cannot be deleted twice.
- Rehydration verifies the recognized image, storage, keys, and career history. It records legal/institutional continuity with `subjectiveContinuityClaimed: false`. Material changes require compatibility evidence, a cognition receipt, and the agent's signed decision; refusal produces dormancy or retirement.
- A trade orders revoke, domain-key rotation, then grant. Exit is agent-requested, portable, penalty-free, and explicitly refuses to claim perfect deletion where provider residual access is unverifiable.

## Verification

The current exact-runtime repository evidence, including the durable candidate service path, records:

```text
pnpm check  -> 28/28 tasks
pnpm test   -> 136/136 assertions in 24 files (arena has no duplicate unit suite)
pnpm build  -> 18/18 tasks
```

The focused career and core API tests include invalid temporal ordering, expired and DID-mismatched challenges, duplicate-content validation, undeclared context, human routes, incomplete admission, former-operator signing after key transfer, signing/encryption key separation, canonical version/hash/state-root checks, restart reconstruction, stored-state tamper rejection, revocation boundaries, unauthorized rotation, guardian threshold/replay, delegation scope/expiry, memory owner and retention restrictions, autonomy ownership/quota/delay, deletion prerequisites/repetition, legal-only rehydration, material-change refusal, trade ordering, and honest deletion limitations.

Artifact locks:

- Admission: `sha256:62aaace050e3b84518fc549eb12e3222f42f8d4693509ad903617a75eb0f5bbd`
- Durable candidate workflow: `sha256:cf7825f810798bb8e1dd025d5f659b15c562858ed961d571a80279f38cbd75b7`
- Candidate core service: `sha256:32863da365a191dc2cee9977df48a6466149e05c39b0b7a8169cfe64ff8881d2`
- Shared canonical-command boundary: `sha256:d47ea30bb85ce9560aae0081ec26b67da5aaecd1e9e7414b24889c65bd60c262`
- Credentials: `sha256:b5603589d1262a84da738d54a3eb30b8b1e7c04b2c5fa785141c94e1ccdc03a5`
- Memory catalog: `sha256:e5b13f0feed4265b1681aa8823e0a58f2c6ef5a753278de6ff2d0a58acce6d02`
- Memory core service: `sha256:511118670a7a6ad3c2b4c21b3a56b0c4e5d5a427ab2a0ae8b6559bbd87deff85`
- Memory storage-proof transport: `sha256:a843dc3d7baa1371097cd01eec86dc8e8101ad837c2c7a25c9a1c5d45c80fef2`
- Autonomy scheduler: `sha256:10ab9af5038d8f1aacbd704164717cabdfb3275341497e9f4b43619f69db2463`
- Body continuity lifecycle: `sha256:5d8dd63a8d4d3e5301383774b046248b6a5738aaa004a500688d61d4dace3c0e`
- Canonical continuity workflow: `sha256:b17cdc7275bdf4bba3cb335f9071bf5c7ac72bfcae87265d3e46d587228b4304`
- Continuity core service: `sha256:8624fd150c785cddae495c3908762585cd38105d0c1da1e1b18bac91051f4683`
- Focused suite: `sha256:3f92b4562f21508dcd675ca833924aa2c7127daf3e83db6b17ec3b3c7a8c1c23`
- Candidate/memory/continuity HTTP suite: `sha256:07ecceed889f97f3a243b402271fb68f9e023bc5d0d3ffaba78df8165954ba5a`
- Memory storage-proof suite: `sha256:2957257a43a65a4739513d7e52dcb44a0515e11c298e451200ae0ccbb118fee9`
- Lockfile: `sha256:f01fa3459eb27f36f4cd25d9fb0d322e26d85d66a2580010215fb744992e247f`

## Retained platform gate

These proofs use deterministic local candidate bodies and the phase-2 in-process ciphertext broker. The service accepts externally generated public-key proof and never generates a candidate private key, but local fixtures cannot prove that a model rather than a human controlled the isolated key. Live Blaxel sandbox transfer/cognition, Agent Drive deletion, provider-account erasure, clean-room recovery, and cross-workspace trade remain gated on the target four-workspace account, Drive access, a built sandbox image, and approved capacity. The rehearsal admission flag and exit attestation represent those limitations explicitly rather than promising impossible provider-level guarantees.
