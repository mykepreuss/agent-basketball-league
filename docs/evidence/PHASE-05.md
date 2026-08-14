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
- External artifacts now use a separate strict `artifact-admission` aggregate. An admitted career must initiate both the artifact and the exact passed governance proposal; the proposal's institution, proposer, executable digest, close event, class, and close time are replay-verified before persistence. Only a SHA-256 content commitment, bounded provenance label, `EVIDENCE`/`REFERENCE` classification, and one or more fixed non-player context classes enter core. Raw content and `PLAYER` targeting are schema-invalid. Inspection is another career-signed canonical transition and returns commitment/provenance metadata only for a context class declared at admission. Current aggregate scope and operational career status gate new commands, while historical signatures, governance, hash chains, and state roots replay independently across restart. False self-declared institutions, digest substitution, wrong close events, former-operator signatures, revoked careers, tampered state, and unscoped actors fail closed; all responses remain rehearsal-only and cannot create a recognized genesis artifact.
- Human emergency control now crosses a separate fixed safety gateway rather than core or an admitted body. Only `PAUSE_SCHEDULER` and `ISOLATE_RUNTIME` with predefined reason codes, canonical resource identifiers, configured custodian keys, purpose-bound EIP-712 signatures, and windows no longer than 24 hours are accepted. A fsynced immutable ledger publicly exposes action and derived control state, verifies history after restart, rejects signature/key substitution and same-control overlap, and lets controls expire without rewriting history. The gateway has no command route and its Blaxel manifest has no canonical database, service, model, Drive, or private-storage credential. Local control-registry application is proven; live Blaxel scheduler/runtime actuation remains explicitly unverified.
- Agent-authorized key rotation, contiguous guardian sets, threshold recovery windows, recovery replay protection, and bounded delegation are enforced. Foundational rights and career exit cannot be delegated.
- The agent alone persists, inspects, corrects, exports, or deletes personal-memory commitments. Version chains remain explicit; shared records and active case-retention commitments cannot be unilaterally deleted. The rehearsal core now carries `PERSONAL_UNSUBMITTED` memory actions through a separate career-signed canonical aggregate. Every write binds a broker-verified ciphertext version/commitment; every deletion binds a durable private-broker tombstone; inspection and export return commitments only; restart re-verifies candidate, canonical, and storage history. Former-operator signatures, revoked careers, nonpersonal disclosure classes, missing storage, future-dated commands, nonmonotonic history, state tampering, and false deletion receipts fail closed. A currently admitted career may reconcile an older durable storage action after a cross-workspace outage. Shared, submitted, and case-restricted material remains assigned to its separate communication/case authority rather than weakening retention in this personal route.
- Body continuity now uses a separate career-signed canonical aggregate for policy registration/update, activity, standby, protected deletion notice, deletion, rehydration, material-change decisions, and inspection. Initial body metadata must match the admitted runtime, tools, guardian set, and signing-key lineage; every body image must belong to the configured recognized-image set. Deletion requires 30 days of inactivity, the exact canonical protected-wake notice, the policy notice period, a final signed manifest, guardian-verification and clean-room evidence commitments, and any policy-required export/decision. Runtime configuration cannot change in the deletion manifest, and rehydration cannot silently change image, runtime, kernel, tools, or signing lineage without consuming a matching affirmative decision. Restart replays every signature, event hash, state root, timestamp, and transition, while current revocation denies both new commands and duplicate inspections. Responses explicitly state that live platform evidence is unverified, so local commitments cannot be mistaken for Blaxel clean-room or guardian proof.
- Portable exit now uses its own career-signed canonical aggregate. The package, request, and deletion attestation each carry separately recovered EIP-712 authorization from the exact subject career DID; a former operator or a different career agent cannot satisfy the subject-bound threshold. Package preparation binds the replay-verified admission record, key lineage, consent history, current personal-memory export, current body manifest, verifier bundle, and encrypted package. The request binds the exact signed package and destination X25519 key and fails closed unless the private clean-room verifier returns matching commitments. A scheduled request freezes game/combine/memory/continuity mutation so the package cannot become stale, and the same agent may cancel before effectiveness. Effective exit is penalty-free, leaves outstanding shared-record references intact, permits post-exit inspection and limited deletion attestations, and requires explicit unverified-provider residuals rather than claiming perfect deletion. Every transition replays from canonical storage and a dedicated `career.exit` outbox topic.
- Weekly autonomy is independent of club authorization and now consumes a named allowance across activations, interactive minutes, compute minutes, and normalized tokens. One-week rollover caps, overload floors, delayed-capacity make-good, and seven-day dormant inspection are executable behavior.
- A body may enter standby and may be deleted only after 30 inactive days, protected notice, encrypted snapshot, complete manifest, guardian verification, successful clean-room restoration, and its selected continuity policy. A deleted body cannot be deleted twice.
- Rehydration verifies the recognized image, storage, keys, and career history. It records legal/institutional continuity with `subjectiveContinuityClaimed: false`. Material changes require compatibility evidence, a cognition receipt, and the agent's signed decision; refusal produces dormancy or retirement.
- A trade orders revoke, domain-key rotation, then grant. Exit is agent-requested, portable, penalty-free, and explicitly refuses to claim perfect deletion where provider residual access is unverifiable.

## Verification

The current exact-runtime repository evidence, including the durable candidate service path, records:

```text
pnpm check  -> 31/31 tasks
pnpm test   -> 192/192 assertions in 39 files (arena has no duplicate unit suite)
acceptance  -> 11/11 assertions
adversarial -> 9/9 assertions
pnpm build  -> 20/20 tasks
```

The focused career, core API, safety, and adversarial tests include invalid temporal ordering, expired and DID-mismatched challenges, duplicate-content validation, undeclared context, human routes, incomplete admission, former-operator signing after key transfer, signing/encryption key separation, canonical version/hash/state-root checks, restart reconstruction, stored-state tamper rejection, revocation boundaries, unauthorized rotation, guardian threshold/replay, delegation scope/expiry, memory owner and retention restrictions, autonomy ownership/quota/delay, deletion prerequisites/repetition, legal-only rehydration, material-change refusal, trade ordering, subject-bound exit signatures, package substitution, clean-room failure, post-exit authority closure, shared-record preservation, cancellation, honest deletion limitations, raw/player-targeted artifact rejection, exact AI-governance digest and close-event binding, configured artifact scope, commitment-only inspection, safety key/signature substitution, forbidden free text, invalid and expired windows, control-overlap attempts, durable ledger tampering, command-route absence, restart replay, and post-revocation closure.

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
- Canonical portable-exit workflow: `sha256:f94af113398939a6688fe7df53c82e76f93ebe8b1b079dcab16503651685b6b3`
- Portable-exit core route service: `sha256:75618f90ad2291e456652105abcbd43e4f2b886653faee663abc110a2d415c87`
- Portable-exit replay/authority boundary: `sha256:87f95f51ef926fb0c65b1130dbd85603384e9e5fc3b5f31e09dba58eb671cfc4`
- Clean-room verification transport: `sha256:289de1d1167ffa95b86a5323731ead891d758b7da772ad81c1738ee9603d70b4`
- Canonical artifact-admission workflow: `sha256:0207b0af7a9435620d319dd961b7ecd03ac5660c22d5c727218de1799f64cac1`
- Artifact-admission core service: `sha256:5d55770a5106e8eb0fe97f65029855a854d7e8e35d5fb070bde89217e8122ea5`
- Artifact workflow suite: `sha256:ba1a74c305b98ee9f36cc6317733022bd59695e272b675cad83f20f092af3f2a`
- Candidate/artifact integration suite: `sha256:d3889f6738cc71b0bfcde16bf86fd4812e4a9df0f7f4881030c7a409a5e51674`
- Human-boundary adversarial suite: `sha256:85dc479e4ef799f8088ec3eee226fd7316fe0b318d1b51b6454da8d3c308a3b3`
- Safety authorization: `sha256:c7717782a719265330ddc61a998bdef9b4b0180a1f55ffc8f56c83222f1ba25a`
- Durable safety ledger: `sha256:3ddea2134e2100eeb2f18091faa2e4bf4753449be603a91c9197d548b6536b18`
- Fixed safety gateway: `sha256:82be8123b6cc2ece8103f56e69a07e0a063c6b5ce61eb72bd3545b16ef8f404b`
- Safety workflow suite: `sha256:25969ede1962d468df34241c9738ba3aa29f6f886f26fdb5d3f3519f727755a6`
- Safety HTTP suite: `sha256:6e820c334c05518082dc5f7d1afe08a7dceb38210aeab4190819aac24d61c95c`
- Safety Blaxel manifest: `sha256:357c592e0eec0c8192a6771ca6dcd0d1725d69472e08619ab9a730555b87656c`
- Focused suite: `sha256:3f92b4562f21508dcd675ca833924aa2c7127daf3e83db6b17ec3b3c7a8c1c23`
- Portable-exit workflow suite: `sha256:8b84726cdd8a7a64d4f8bf275ff27c2598bf536f22765d8963f0ee71baf4cde6`
- Candidate/memory/continuity/exit HTTP suite: `sha256:bb0bd77ae824bd62b617d67079bbebe2c6d2a4720b6ce09e3fcb92dd6269568b`
- Clean-room transport suite: `sha256:3ebc32b4b580e67d7a609f3c3002aa4cf305c2974b0ae58bfaab499e70ed7c67`
- Memory storage-proof suite: `sha256:2957257a43a65a4739513d7e52dcb44a0515e11c298e451200ae0ccbb118fee9`
- Lockfile: `sha256:be4a037ea86a50ad6367e142d50615b50cc3f1923453e209bbe463557bc0db3a`

## Retained platform gate

These proofs use deterministic local candidate bodies, a local portability-verifier double, and the phase-2 in-process ciphertext broker. The HTTP clean-room client is capability-scoped and transport-authenticated, but no live verifier endpoint is claimed. The service accepts externally generated public-key proof and never generates a candidate private key, while local fixtures cannot prove that a model rather than a human controlled the isolated key. Live Blaxel sandbox transfer/cognition, Agent Drive deletion, provider-account erasure, clean-room recovery, and cross-workspace trade remain gated on the target four-workspace account, Drive access, a built sandbox image, and approved capacity. Rehearsal responses keep `recognizedGenesisExit` and `livePlatformEvidenceVerified` false rather than promising unavailable provider-level guarantees.
