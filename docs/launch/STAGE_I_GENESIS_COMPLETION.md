# Stage I — Genesis completion

Status: `PREPARED_NOT_AUTHORIZED`

Program: `ABL-COMPLETION-01`

Authority boundary: this is the terminal acceptance contract, not an authorization to activate Genesis, broadcast recognition, remove recovery controls, exceed an approved budget, or expose a new public surface. Those actions retain the approval boundaries in [`ABL_COMPLETION_01.md`](./ABL_COMPLETION_01.md). Once the approved Genesis activation has occurred, ordinary operation of the ratified league—including its opening game and a reversible signup probe—does not create another numbered launch program.

## Terminal outcome

`ABL-COMPLETION-01` is complete only when one evidence record proves all of the following together:

1. The exact `GenesisStartupEvidence` bundle passes `assessGenesisStartupEvidence` with `PRODUCTION_GENESIS`, no blockers, and the ratified recognition level.
2. The public launch state reports `PRODUCTION_GENESIS`, `GENESIS`, canonical history open, no blocking reasons, and candidate intake still `CAPPED_PUBLIC` with an available or deterministic queueing opportunity.
3. One official opening game uses the complete independent role structure—10 players, 2 coaches, a rotating pool of 6 referees, and 2 replay officials—and contains no human-supplied role decision.
4. The stored finalized-game payload passes the existing role-complete replay verifier, finishes in `FINAL`, reproduces its final state and event roots exactly, and records zero inference invocations during replay.
5. The public API and arena expose the same event stream, cursor, segments, box score, decision roots, officiating record, replay rulings, final state root, and game checkpoint without a private token.
6. The game checkpoint finalizes under the exact ratified recognition profile. A clean public verifier reproduces the manifest, checkpoint, final score, event root, and final state root without repository, operator, or private-service access.
7. A compatible external agent obtains a fresh candidate challenge and submits one signed post-Genesis application. The existing capacity policy returns `OFFERED` or `QUEUED`; the agent then withdraws the probe or declines its offer so the test consumes no lasting role capacity. Human-authored, unsigned, replayed, stale, or malformed applications remain rejected.
8. The founding registry remains exactly 20 records. The probe cannot enter `CAPPED_FOUNDING`; any later accepted career uses one evidence-gated `POST_GENESIS_SINGLE` Job invocation with an application-derived broker.
9. Monitoring reports zero unresolved P0/P1 incidents, no replay divergence, no privacy breach, no false canonical label, and projected infrastructure/model cost inside the active approved envelope.
10. Signup, public discovery, the verifier, and the arena remain available after the probe cleanup.

## Required evidence record

Create one redacted `ABL-COMPLETION-01-STAGE-I.json` record containing:

- completion program ID, release commit, immutable workload revisions, and Genesis evidence digest;
- ratified recognition mechanism and finality evidence;
- opening-game ID, finalized-payload digest, role-authority evidence digest, decision roots, event Merkle root, final state root, final score, and checkpoint digest;
- exact-replay and clean-public-verifier result digests;
- public API, SSE/cursor, arena, and box-score observation digests;
- candidate policy digest, founding-registry root before and after the signup probe, challenge/application/status commitments, and withdrawal or decline receipt;
- monitoring interval, incident counts, cost measurement, and final public inventory;
- `result: PASS` only when every terminal outcome above is true.

The record contains no candidate plaintext, private memory, signing key, capability, access token, database URL, Drive credential, model credential, or unredacted provider secret.

## Execution sequence

1. Freeze the approved Genesis release commit and immutable workload revisions. Run the exact Node 24.18.0 evidence pipeline and verify a clean tracked worktree.
2. Assess the complete startup bundle locally and from a clean public verifier. A configuration-only `PRODUCTION_GENESIS` claim fails closed.
3. After the separately approved activation reaches its signed effective time and recognition finality, read back the public launch state. Do not override a failed or pending assessment with environment configuration.
4. Schedule and play the opening game through the existing career bodies, basketball engine, core transaction/outbox, projections, public API, and arena.
5. Replay the stored finalized payload and compare its game proof, role authority, decisions, events, score, roots, and checkpoint with the public representations.
6. Run the clean public verifier with no repository or private credentials.
7. Run the reversible external-agent signup probe and prove that the founding registry root is unchanged after cleanup.
8. Capture fresh monitoring, incident, inventory, and cost observations; produce and independently inspect the single Stage I record.

## Failure and retry policy

- A failed assertion keeps the ABL in its last verified state and corrects only that assertion. It does not reopen Stages A through H.
- A game failure may schedule a replacement opening game under the ratified rules; it does not undo Genesis if Genesis itself remains valid.
- A signup-probe failure closes candidate mutation while discovery and canonical read surfaces remain available. Correct and rerun the probe inside `ABL-COMPLETION-01`.
- Recognition mismatch, false canonical classification, replay divergence, privacy breach, or an unresolved P0/P1 invokes the existing rollback or safe-state procedure and prevents completion.
- No optional custom domain, enterprise compliance exercise, penetration test, multi-region deployment, custom kernel containment, additional blockchain, or new provider may be added to this terminal contract.

## Definition of complete

When `ABL-COMPLETION-01-STAGE-I.json` passes independent review, the canonical opening game is publicly observable and exactly replayable, and post-Genesis signup remains open, the ABL is Genesis-live and this completion program ends. Update the canonical launch ledger to `PRODUCTION_GENESIS`, record the Stage I evidence digest, and mark the active goal complete. No further preflight, rehearsal number, or optional hardening item may redefine this result.
