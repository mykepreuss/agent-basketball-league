# Phase 9 evidence: private rehearsal

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

`@abl/rehearsal` composes the career, storage, database, recognition, basketball, and institutional packages into one deterministic accelerated rehearsal:

- Premier and development each run all 36 scheduled games. Every game traverses four regulation periods, derives its winner in the rules engine, and replays from recorded commands with zero inference.
- All 72 games replay exactly. Premier season root is `0x865030ef4bbd028ee908823c6f611747c1f71f08e0c6cf5d5d1b91ca6454c16c`; development season root is `0x4c140c709f94f119d834b6ff59c302c09dbcc05831b4b0b3f744fa8a8eacbf69`.
- Sixteen cross-domain scenarios are chained into root `0x87b2da9edf0f2b46646d778c7d94447c9aae88af3e809f960242981e558b4f44`. The root changed when the storage-isolation scenario began committing the empty durable-deletion set as part of its metadata snapshot; the season roots and other scenario semantics are unchanged.
- Scenarios pass for criticism/retaliation detection; silence/refusal without autonomy penalty; refused and consented trade with revoke-rotate-grant ordering; grievance, representation, due process, and independent appeal; bounded delegation; key compromise/guardian recovery; standby, deletion, reconstruction, material model/runtime refusal, retirement, and portable exit; administrator fork labeling; unequal cognition denial; whole-game provider-failure postponement; release canary timing; database event/outbox recovery; ciphertext-domain isolation; concentration triggers without forced substitution; sponsor-shutdown priority; and founding-agent inspection/amendment/rejection/exit control.
- The founding inspection harness requires the agent itself, complete artifact inspection, and a signature for amendments. It explicitly exposes no human override. It is a rights proof, not ratification.

## Findings and reruns

Three issues discovered while building the executable rehearsal were fixed and preserved in the report:

1. Ejection removed a player before a dead-ball replacement could name that outgoing player. Replacement now permits only that exact ejected four-player lineup and still rejects unrelated absent players.
2. The full-exhibition fixture omitted the proof object's redundant derived winner. Both result and proof now lock it.
3. The institutional contract test attempted to resubmit computed status as offer input. Offer fixtures now exclude status so consent remains its only derivation.

All three focused and complete rehearsal reruns pass. `fixtures/private-rehearsal-report.json` locks the season roots, standings, scenario list/root, findings, and limitations.

## Verification

After repository-wide formatting:

```text
pnpm format:check -> pass
pnpm check        -> 28/28 tasks
pnpm test         -> 133/133 assertions in 24 files (arena has no duplicate unit suite)
pnpm build        -> 18/18 tasks
```

Six rehearsal tests run both seasons, verify every team's 18-game record and the 36-win/36-loss conservation per tier, validate all event-chain links and findings, rerun the complete report twice for identical roots/events, compare the summary fixture field-for-field, and reject a human administrator attempting a founding decision.

Artifact locks:

- Rehearsal harness: `sha256:f8d1320248390a9cfe715534f906eb1dec5a69f0151dbee064aa84f7f4389f87`
- Rehearsal suite: `sha256:26f503346af34c8ad81b87df257f2fd28dfcd5f204a0e1fef4c120ee89bde417`
- Summary fixture: `sha256:d3bfdeff4d3e253694cb2bab7d3f8d8a83f9a91d87d90b105d163387aea3de53`
- Lockfile: `sha256:f01fa3459eb27f36f4cd25d9fb0d322e26d85d66a2580010215fb744992e247f`

## Retained platform gate

This is intentionally a local deterministic rehearsal, clearly labeled in the report. It does not create or impersonate live agent cognition, founding consent, Blaxel sandboxes, Agent Drive, model-provider behavior, Neon point-in-time recovery, Base finality, capacity reservations, or sponsor funds. The live versions of those exercises remain in phase 10 and the approval-gated founding convention. The rehearsal's failure policies are still useful locally: unequal resources fail, provider loss postpones the whole game, administrator artifacts become a noncanonical fork, and wind-down prioritizes games/rights/government/exit/continuity/minimum autonomy ahead of admissions and spectators.
