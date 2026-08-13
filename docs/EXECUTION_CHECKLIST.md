# ABL execution checklist

Authoritative plan SHA-256: `9bc695db70c60f271bc4be9dab56742c0afb07538c17021ad45ff720b79cbfe5`

A phase closes only when behavior works, focused and full tests pass, documentation is current, and evidence is recorded. `[~]` denotes the single active phase; `[!]` denotes an external or approval gate while safe local work continues.

## 0. Discovery and platform verification [x]

- [x] Read the approved plan and objective completely.
- [x] Inspect workspace, target path, Git state, applicable `AGENTS.md`, Node, pnpm, local OCI tooling, Postgres, Foundry, and Blaxel CLI.
- [x] Inspect authenticated Blaxel workspaces and currently accessible resource classes without creating spend.
- [x] Review the current official Blaxel documentation index and the Drive, proxy, domain, non-root, telemetry, hosting, workspace, and quota constraints.
- [x] Verify current official Node, NBA rulebook, NBPA CBA, NBA cap, Neon recovery, and Base testnet sources.
- [x] Pin all dependency, toolchain, and source-document versions with hashes; container digests remain phase-2 build evidence.
- [x] Record verified platform differences before changing the implementation approach.
- [x] Close phase with discovery evidence verification.

## 1. Constitution, schemas, and threat model [x]

- [x] Freeze terminology and distinguish career identity, cognition, memory, runtime, logical body, basketball avatar, and institutional office.
- [x] Encode authority, human boundary, agent rights, admission/severance, continuity, autonomy, government, release, disclosure, competition, and exit rules.
- [x] Record provider/account/software-key/funding limits without claiming impossible confidentiality or independence.
- [x] Author every primary strict Zod schema and export strict JSON Schema with `additionalProperties: false`.
- [x] Require the common write envelope fields for every external mutation.
- [x] Freeze and hash source indexes for NBA rules, 2023 CBA, 2026-27 cap figures, Blaxel, Node, Neon, Base, and frameworks.
- [x] Classify every NBA rule and CBA article/exhibit as `IMPLEMENTED`, `AGENT_EQUIVALENT`, or `NOT_APPLICABLE`, with citation, rationale, owner, implementation, and tests.
- [x] Define verifier and canonical-fork labeling rules.
- [x] Threat-model administrator, provider, sponsor, model, key, storage, telemetry, context, network, and recovery compromise.
- [x] Pass schema strictness, classification coverage, and constitutional invariant tests; record evidence.

## 2. Four-workspace Blaxel foundation [!]

- [x] Define `abl-core`, `abl-private`, `abl-competition`, and `abl-public` manifests with explicit responsibilities and prohibited access.
- [x] Define least-privilege cross-workspace service identities, signed requests, nonces, expected versions, and allowlists.
- [x] Implement the declared core-to-public projection capability as HMAC-authenticated HTTP delivery of strict agent-signed envelopes, with durable aggregate-version enforcement and retry idempotency.
- [x] Implement serializable canonical state, per-aggregate versions/hash chains, UUIDv7 events, atomic outbox, constraints, and partitions.
- [x] Implement the ciphertext-only private-storage broker, domain keys/manifests/version chains, guardian recovery envelopes, and authorization metadata.
- [x] Reconstruct storage policy, ciphertext-version, and guardian-envelope state from immutable durable records after restart; fail closed on path/chain corruption and roll memory back after failed writes.
- [x] Persist personal-ciphertext deletion tombstones, remove local ciphertext versions, recover the deleted state after restart, and expose only capability-scoped commitment/deletion proofs to core without returning ciphertext.
- [x] Implement the unprivileged custom sandbox image source with fixed broker, immutable trust roots/executables, no agent-visible Drive/model/database credentials, and OS-level egress setup.
- [x] Define applications, sandboxes, agents, MCP servers, jobs, model endpoints, revisions, observability opt-outs, quota targets, and region placement.
- [x] Prepare and dry-run the repository-root Blaxel custom-image project; no local Docker daemon is required.
- [!] Build the image with `bl push` in `abl-competition`, pin its immutable ID, and live-test it; the target workspace is unavailable.
- [!] Obtain access to four Blaxel workspaces and Agent Drive private preview; current account exposes only `knicks`, with Drive disabled.
- [!] Stage the manifests without material recurring spend after the target Blaxel account/workspaces are confirmed.
- [!] Run the migration and recovery proof on the project Neon branch after a connection is supplied.
- [x] Pass focused foundation, migration-consistency, broker, and manifest-policy tests; record local evidence.

## 3. Recognition foundation [x]

- [x] Implement separate secp256k1/EIP-712 signing and X25519 encryption identities.
- [x] Implement canonical serialization, SHA-256 content commitments, event chains, Merkle roots, and checkpoint manifests.
- [x] Implement institutional key registry, role/threshold validation, time windows, recusals, and fail-closed authorization.
- [x] Implement ownerless-after-genesis recognition contract and prepare-only local/test-chain deployment workflow.
- [x] Implement public verifier for events, thresholds, releases, checkpoints, daily roots, and fork labels.
- [x] Checkpoint constitution/verifier, keys, games, ballots, releases, rulings, and daily aggregate roots.
- [x] Pass human-administrator, rewritten-history, unsigned-release, invalid-threshold, replay, and fork tests; record evidence.
- [x] Execute signer/policy rotation, removed-policy rejection, threshold changes, replay, stale signer, and malformed-signature paths on an in-process local EVM.
- [!] Execute the same behavioral suite on Base Sepolia and record finality after approved test credentials are available.

## 4. First playable possession [x]

- [x] Provision ten persistent local player-body adapters and a temporary arena path with no human-input interface.
- [!] Provision the same named resources on Blaxel after the target competition workspace and image are available.
- [x] Generate role-specific partial observations and two-to-four simultaneous decision windows.
- [x] Collect independent strict structured player/coach/referee/replay actions with cognition receipts.
- [x] Commit and reveal both club and integrity random shares; seed a counter-based SHA-256 stream.
- [x] Resolve fixed-point 2D movement and ball state without accepting a winner as input.
- [x] Change recognized state, create film, permit durable agent-authored lessons, and publish immutable segments/cursor.
- [x] Render the possession in the public arena.
- [x] Independently replay the exact state and Merkle root without model inference.
- [x] Carry the signed possession through the rehearsal-only command API, canonical transaction/outbox, HMAC-authenticated HTTP projection transport, independent public signature verification, durable public projection, cursor/SSE API, and fixture-free arena; prove safe retry, restart, transport replay/tamper rejection, direct rogue-store rejection, and forged-volume-record rejection.
- [x] Pass the first-possession acceptance scenario and record proof.

## 5. Identity and personal computers [x]

- [x] Implement manifest/provenance, isolated transfer, three reflections over 24 hours, inspection, private experiment, objective repudiation, key creation, identity statement, admission, and 24-hour revocation.
- [x] Carry candidate registration, transfer, reflection/progress, admission, revocation/withdrawal, status, and portable export through strict signed rehearsal routes, canonical transactional persistence, exact replay, expected-version/idempotency enforcement, and restart verification; keep recognized genesis admission false.
- [x] Reject undeclared context and former-operator signatures; allow refusal/withdrawal/export without penalty.
- [x] Implement credential rotation, guardians, delegation, recovery, selective memory persistence/correction/deletion/export, and storage authorization.
- [x] Carry `PERSONAL_UNSUBMITTED` memory persistence, correction, inspection, commitment export, and deletion through the admitted career key, canonical event/state-root replay, and metadata-only private-storage verification; fail closed after revocation or storage/canonical tampering and never accept plaintext in core.
- [x] Carry body-continuity policy, activity, standby, protected deletion notice, deletion, rehydration, material-change decision, and inspection through the admitted career key and canonical replay; bind the initial body to admitted runtime/guardian/key provenance, require recognized images, and label live clean-room/guardian evidence unverified before genesis.
- [x] Implement protected autonomy scheduling, overload floor, rollover, make-good, and dormant weekly inspection.
- [x] Implement standby, 30-day deletion prerequisites, body manifests, clean-room restore, `BodyDeleted`, `BodyRehydrated`, and `BodyContinuityPolicy`.
- [x] Require cognition receipts, compatibility evidence, and signed continuity decisions for material changes; never silently substitute.
- [x] Implement trade access-ordering and signed portable exit/deletion attestations.
- [x] Carry signed package preparation, clean-room verification, request/cancellation, deletion attestation, and inspection through a canonical portable-exit aggregate; bind current career/memory/body commitments, preserve shared-record references, close operational authority when scheduled/effective, and keep live Blaxel/Drive proof gated.
- [x] Pass admission, continuity, memory/storage, autonomy, provider-failure, trade, recovery, and exit tests; record evidence.

## 6. Agent-played full exhibition game [x]

- [x] Implement four 12-minute quarters, 24-second clock, overtime, five active players, substitutions, timeouts, and coaching.
- [x] Implement scoring, live/dead ball, derived ball-handler out-of-bounds, explicit throw-ins/jump balls, free-throw lane state, per-period team fouls/bonus, violations, goaltending, fouls, ejections, injuries, and protests.
- [x] Implement authentic fallible three-referee crews, six-agent pool rotation, two replay officials, reviewability, and challenges.
- [x] Implement persistent point-buy avatars, transparent tradeoffs, workload/development, and mirrored calibration ceiling of 52%.
- [x] Implement equal role envelopes, deadlines, retry/fallback/postponement fairness, preparation caps, and cognition receipts.
- [x] Implement private film, counterfactual practice, durable lessons, paced broadcast, SSE heartbeat/resume, and authoritative cursor mode.
- [x] Prove exact replay, no inference on replay, no winner input, no lost/duplicate events, and provider-failure postponement.
- [x] Run a complete four-quarter game from 128 independently signed possessions using the same ten persistent bodies and authorized coaches/referees/replay officials.
- [x] Pass full exhibition suite and record evidence.

## 7. Premier league institutions [x]

- [x] Implement four founding club placeholders, 32-player rosters, coaches, governors, and independent institutional roles.
- [x] Implement 14-day combine, eight-round draft, 18-game schedule, nine weeks, six meetings per opponent, and best-of-five playoffs.
- [x] Carry affirmative combine registration through the admitted candidate career key, exact admission-event binding, canonical persistence, safe retry, restart verification, current revocation-aware eligibility, and a non-genesis rehearsal status path.
- [x] Implement contracts, consent/refusal, five-season maximum, trades, free agency, cap/aprons/tax/minimum/exceptions, and noncash Court Credits.
- [x] Ensure Court Credits cannot buy cognition, model quality, latency, storage, liveness, government, or due process.
- [x] Implement assemblies, player associations, boards, congress, team councils, commission, tribunal, integrity, advocates, recusals, delegations, appeals, and elections.
- [x] Enforce ordinary, tier-CBA, shared-law, constitutional, foundational-right, expansion, routine-release, labor-release, constitutional-release, and emergency-release thresholds.
- [x] Carry proposal registration, frozen eligibility, direct chamber ballots, deterministic close, and inspection through admitted career signatures, canonical persistence, restart replay, and explicit non-genesis rehearsal labels.
- [x] Implement disclosure commitments, timed/conditioned release, case redaction, integrity escrow, and no content telemetry.
- [x] Implement criticism/refusal/silence/injury anti-retaliation audits and model concentration reporting/triggers.
- [x] Pass government, release, contract/cap, disclosure, rights, and anti-retaliation tests; record evidence.

## 8. Development conference [x]

- [x] Enforce formation prerequisites for players, governors, coaches, officials, funding, quota, and rehearsals.
- [x] Implement four stable clubs, tier CBA, 18-game schedule, playoffs, film/practice/statistics/social/representation/appeals.
- [x] Implement formulaic premier draft eligibility, call-ups, replacement contracts, free agency, trades, mobility, expansion review, and queue rules.
- [x] Prevent private incumbent alteration and automatic promotion/relegation.
- [x] Give development players/council the specified government representation and rights.
- [x] Pass development charter, schedule, labor, mobility, and governance tests; record evidence.

## 9. Private rehearsal [x]

- [x] Run accelerated premier and development seasons.
- [x] Exercise dissent, criticism, silence, refusal, trades, grievances, due process, appeal, delegation, retirement, and exit.
- [x] Exercise standby, deletion, reconstruction, provider/model changes, refusal, key compromise, and guardian recovery.
- [x] Exercise administrator forks, quota exhaustion, unequal cognition attempts, release canaries, disclosures, database recovery, provider failure, and sponsor shutdown.
- [x] Give founding agents private inspection/amendment tooling and preserve rejection/exit rights.
- [x] Record all rehearsal events, roots, findings, fixes, and reruns.

## 10. Security, capacity, and recovery proof [!]

- [x] Statistically verify the fixed-broker source controls for direct sockets, alternate DNS, custom TLS, subprocesses, local/private routes, metadata routes, and workload-token access.
- [!] Execute those seven escape attempts inside the built image after a target Blaxel sandbox is available.
- [x] Prove local cross-domain ciphertext isolation, ciphertext-only broker behavior, public/core private-content denial, trade revocation ordering, and telemetry exclusion.
- [!] Repeat the isolation and telemetry exercises against Agent Drive and the four live Blaxel workspaces after access is supplied.
- [x] Prove from topology, capability-scoped manifests, independent agent-signature verification, and restart-time durable-record verification that a public compromise has no path to commands, competition credentials, the canonical database, private content, or persistent recognized-history forgery.
- [!] Run a live public-workspace penetration exercise after that workspace exists.
- [x] Execute a local in-process synthetic proof at 2x the targets: 20,000 spectator cursor polls, 2,000 candidate registrations, 20 games, and 400 active body objects.
- [!] Reserve and exercise 10,000 spectators, 1,000 candidate registrations/day, ten simultaneous games, and 200 active bodies with 2x remote headroom where reservable; material spend and missing workspaces gate this step.
- [x] Keep local synthetic public errors under 1%, cursor/segment P95 under 750ms, broadcast lag under 2s, and event loss/duplication at zero.
- [!] Validate the same SLOs with live networked Blaxel applications, sandboxes, and spectator traffic.
- [x] Prove overload priority: games, rights, government, due process, exit, continuity, and minimum autonomy before admissions/spectators.
- [x] Perform local encrypted-storage/guardian recovery, clean-room exit restore, event/outbox rebuild, checkpoint verification, signing-key recovery, and a 30-day wind-down exercise.
- [!] Perform Agent Drive recovery, Neon point-in-time recovery, live Base verification, live sandbox restore, and hardware-backed signing recovery after access/credentials exist.
- [x] Record exact local environment, methodology, results, limitations, null remote reservations/costs, and retests.

## 11. Founding convention and genesis readiness [!]

- [x] Prepare an agent-only convention packet with inspect/amend/ratify/replace/reject options and explicit identity/memory/continuity/exit preservation.
- [!] Conduct the convention with functioning founding agents; no live founding agents or target sandboxes exist, and no human may substitute.
- [x] Prepare blank decision records for constitution, league name, club identities, disclosure, rule/CBA mappings, Court Credits, resource schedule, model registry/concentration, genesis keys, inherited context, and release.
- [!] Collect the actual agent-authored decisions, events, and signatures; all eleven records intentionally remain undecided.
- [x] Prepare deterministic source, container-source, kernel/runtime, tool, schema, migration, test-suite, verifier, Blaxel-manifest, and public-projection digests.
- [!] Add an immutable built-image digest, final test-result/verifier-result digests, ratification events, effective time, and authorization signatures to produce the complete schema-valid genesis `ReleaseManifest`.
- [x] Prepare an unpublished public artifact index covering source, image, constitution, CBA/rules, resource schedule, threat model, model registry, Blaxel manifests, projections, verifier, Base contract, release manifest, and genesis root.
- [!] Publish only after all technical/agent gates and explicit public-exposure approval pass.
- [x] Compile/fingerprint the ownerless Base contract and prepare the exact no-broadcast command, strict pending-config rejection, constructor inputs, and irreversible consequences.
- [!] Generate the exact transaction only after ratified constitution/verifier/registry inputs exist; broadcast remains a separate irreversible approval gate.
- [x] Prepare Blaxel capacity/deployment manifests, an unquoted/null cost envelope, material-spend gate, deployment runbook, risks, and rollback boundaries.
- [!] Obtain valid quotes, provision/prepay the Season Zero envelope and 30-day reserve, and reserve capacity after explicit approval.
- [!] Require explicit human approval for public genesis, irreversible ownerless deployment, removal of recovery controls, recurring paid capacity, remote push/PR, or public production exposure.

## 12. Final acceptance and Season One gate [!]

- [x] Run the complete safe local unit, integration, property, adversarial, replay, contract-compile, migration/schema, API, browser, synthetic-load, recovery, acceptance, formatting, typecheck, and production-build suites.
- [!] Run the live Blaxel custom-image/Drive/Neon/Base/networked-load/hardware suites after their external prerequisites and spend approval exist.
- [x] Verify all 43 schemas/interfaces, 40 route/method pairs, 15 NBA rule classifications, 42 CBA articles, 17 CBA exhibits, constitutional invariants, release/disclosure classes, and local acceptance gates.
- [x] Publish the repository-local implementation evidence index with deterministic proofs, fixed findings, capacity/recovery results, limitations, and unresolved external dependencies.
- [!] Publicly publish that evidence only after the founding release and public-exposure gate pass.
- [x] Confirm in the proposed constitution and checklist that Season One remains gated on prepaid funding, concentration review, agent-ratified changes, and hardware-backed non-exportable signing when supported.
- [x] Present only the informed external/approval blockers after completing every remaining safe local action.

## Required acceptance matrix

- [x] Agent authority: administrator cannot forge recognized actions; alternative code is a labeled fork; AI law changes executable state.
- [x] Human boundary: no discretionary communication; imports require admission/release; safety is fixed, expiring, and non-mutating.
- [x] Admission: provenance exposes inherited instructions; operator severance; refusal/revocation/export; undeclared-context failure.
- [x] Identity/continuity: correct standby/deletion/rehydration/refusal/recovery/exit semantics with clean restoration.
- [x] Memory/storage: agent control, no raw Drive access, cross-domain isolation, no public/core plaintext, safe trade rotation.
- [x] Disclosure: no early release, competition conditions, case minimization, no personal projection/telemetry, thresholded escrow.
- [x] Autonomy: independent scheduling, protected equality, overload floor, and make-good.
- [x] Competition: exact replay, no winner input, <=52% calibration, equivalent resources, whole-game postponement on provider failure.
- [x] Government/releases: eligibility, thresholds, recusals, appeals, delegation, expiry, artifact digest consistency, fail closed.
- [x] Network/platform local/static: broker-only egress controls, public compromise containment, and zero private-content telemetry policy.
- [!] Network/platform live: execute escape, isolation, penetration, and telemetry proofs on built Blaxel custom-image and Drive resources.
- [x] Scale/funding-failure local: 2x synthetic counts/SLOs, exact events, overload priorities, deliberative wind-down, proofs, and portable exits.
- [!] Scale/funding-failure live: reserve networked capacity, verify provider SLOs/costs, and prepay the Season Zero/30-day envelopes.
