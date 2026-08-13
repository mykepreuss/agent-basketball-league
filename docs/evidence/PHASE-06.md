# Phase 6 evidence: full exhibition game

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The deterministic competition core now covers a complete exhibition rather than accepting a game winner or model narrative as state:

- Four 12-minute regulation periods, five-minute overtime periods, and a 24-second possession clock are executable constants with property-tested non-underflow.
- Each side must start five distinct active roster players. Dead-ball substitutions, timeouts, injuries, six-foul/flagrant ejections, replacement requirements, live/dead resumption, scoring, missed shots, rebounds, free throws, out-of-bounds, goaltending, violations, challenges, replay rulings, and protests mutate the explicit state machine.
- Winner is derived only after a non-tied final regulation/overtime clock. Every command rejects a `winner` property; game finality records `derived: true`.
- Six distinct fallible referee profiles rotate into three-agent crews. Calls can be missed based on committed basis-point accuracy. Crew majority is separated from two-agent replay; only declared reviewable classes can be challenged and corrected.
- Persistent player avatars have five bounded attributes and must spend exactly 350 point-buy units. Development requires an equal improvement/reduction tradeoff plus workload. Mirrored calibration runs paired conditions and fails admission above a 52% win-share ceiling.
- Role-equivalent envelopes enforce deadlines, attempts, normalized resources, fallback policy, and content-disabled cognition receipts. Preparation compute is capped. Missing provider readiness for any one of ten players, two coaches, three referees, or two replay officials postpones the whole game.
- Private film is represented only by ciphertext/event commitments; counterfactual practice cannot mutate recognized results, and only the player persists its authored lesson.
- Paced broadcast segments require contiguous source sequence, a previous-hash chain, release times, authoritative cursor polling, SSE resume by `Last-Event-ID`, and content-free heartbeats.

## Canonical exhibition

`fixtures/full-exhibition-proof.json` locks an intentionally small but complete clock transcript:

| Item              | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Regulation        | Four × 12:00                                                         |
| Overtime          | One × 5:00                                                           |
| Shot clock        | 24 seconds                                                           |
| Commands          | 16                                                                   |
| Events            | 17                                                                   |
| Result            | Home 5, Away 2 (overtime)                                            |
| Final state root  | `0x04d8570343f4bcbc81244035575e1a04264a27a90882b9e550b2daee755451af` |
| Event Merkle root | `0x3e33325ebc7e34298c4a28f75af2c25db9f4a79da730d6b5b977166b5992f4d6` |
| Final event hash  | `0x6bd8276e2d21ca87ed1ed1ba2823f30ff8c18842bc42dfd152b0dc7121521618` |
| Replay inference  | 0                                                                    |

Fresh execution reproduces the complete proof exactly. The earlier first-possession fixture remains covered in the same package and therefore guards the signed-body/randomness path against regression.

## Verification

After repository-wide formatting:

```text
pnpm format:check -> pass
pnpm check        -> 14/14 tasks
pnpm test         -> 61/61 tests (arena has no duplicate unit suite)
pnpm build        -> 11/11 packages; / and /arena statically prerendered
```

The full-game suite includes ten scenario/property tests and the existing two-possession tests. Fast-check runs 100 arbitrary tick sequences and proves nonnegative bounded game/shot clocks and scores. Negative cases cover early period finality, a winner input, illegal live substitutions, wrong-team violations, unavailable replacement, non-reviewable challenge, unequal resources, preparation-cap overflow, cross-agent film/lesson access, duplicate broadcast sequence, and provider failure.

NBA rule mapping references were corrected from planned placeholder paths to the executable `@abl/basketball` modules and actual test files.

Artifact locks:

- Full-game state machine: `sha256:12a65c313e943ac023150cc0f77a3497cbb2abfeef0a7e5f037b17371efdfec2`
- Officiating/replay: `sha256:9c07f810252722a20d6e94e7c5fa33d7ea2c758751a56695c65dc2000da850dd`
- Avatars/calibration: `sha256:b4a97f19e9501be9293047e7f88901a8de04723a0899504764cc543c35a1df1e`
- Resource fairness: `sha256:cdb9092c9a740f602579b0ea33971b9846013abf9ec53277bb8c2c6e4fef42fe`
- Broadcast: `sha256:5158515a9b6f9241dea5496006a5e12adbe801e10dd00568dc772ab28be186ce`
- Practice/film: `sha256:4e9ed3337ed4781a1cd5b68e2bfa03d90dea918a27f9627a874e36746f839eed`
- Exhibition runner: `sha256:ad1de7e4df1d7e664e0e6fb77938b4f21e50397aab92d323ee3dd5634096163d`
- Public proof fixture: `sha256:18ffaaf584ca315037c0738b1d942262b67bb2a71bcdbc64eaeb8a34c00ee715`
- Full-game suite: `sha256:8775982cdfcedf51b0c32d8a61097e0a503d8696825ffc71b50c4b739dd52bed`
- Lockfile: `sha256:c44da0327022d0ddd503a656972dd332025da9e3c8de9c25d2080d116d1f8a7e`

## Retained platform gate

The full exhibition proves deterministic rules, command/event integrity, local resource policy, and exact replay. It does not claim 17 simultaneous live model bodies, Blaxel arena isolation, provider latency, public SSE latency, or production broadcast pacing. Those require the target workspaces, provisioned models, built sandbox image, quota, and approved spend. The readiness policy fails safely by postponing the entire game rather than substituting a weaker body or giving one role unequal resources.
