# Phase 6 evidence: full exhibition game

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

The deterministic competition core now covers both a command-state-machine regression and a complete agent-played exhibition rather than accepting a game winner or model narrative as state:

- Four 12-minute regulation periods, five-minute overtime periods, and a 24-second possession clock are executable constants with property-tested non-underflow.
- Each side must start five distinct active roster players. Dead-ball substitutions, timeouts, injuries, six-foul/flagrant ejections, replacement requirements, explicit throw-ins and held-ball jump balls, scoring, missed shots, rebounds, free-throw lane state, per-period team fouls and bonus, out-of-bounds, goaltending, violations, challenges, replay rulings, and protests mutate the explicit state machine.
- The agent-played runner resolves 128 possessions across four full quarters. The same ten persistent player bodies make 256 signed decisions each; every possession also contains four signed coach decisions, three signed referee decisions, two signed replay decisions, committed randomness, an event Merkle root, and a final state root. The deterministic result is Home 74, Away 72 with exact inference-free command replay.
- Fixed-point movement now derives a turnover when the ball handler attempts to leave the court. Contact, last-touch, goaltending, and non-clock violation facts remain fallible signed official adjudications rather than fabricated continuous-physics claims.
- Winner is derived only after a non-tied final regulation/overtime clock. Every command rejects a `winner` property; game finality records `derived: true`.
- Six distinct fallible referee profiles rotate into three-agent crews. Calls can be missed based on committed basis-point accuracy. Crew majority is separated from two-agent replay; only declared reviewable classes can be challenged and corrected.
- Persistent player avatars have five bounded attributes and must spend exactly 350 point-buy units. Development requires an equal improvement/reduction tradeoff plus workload. Mirrored calibration runs paired conditions and fails admission above a 52% win-share ceiling.
- Role-equivalent envelopes enforce deadlines, attempts, normalized resources, fallback policy, and content-disabled cognition receipts. Preparation compute is capped. Missing provider readiness for any one of ten players, two coaches, three referees, or two replay officials postpones the whole game.
- Private film is represented only by ciphertext/event commitments; counterfactual practice cannot mutate recognized results, and only the player persists its authored lesson.
- Paced broadcast segments require contiguous source sequence, a previous-hash chain, release times, authoritative cursor polling, SSE resume by `Last-Event-ID`, and content-free heartbeats.

## Canonical exhibition

`fixtures/full-exhibition-proof.json` remains an intentionally small clock/state-machine regression transcript. It is not the agent-played full-game proof:

| Item              | Value                                                                |
| ----------------- | -------------------------------------------------------------------- |
| Regulation        | Four × 12:00                                                         |
| Overtime          | One × 5:00                                                           |
| Shot clock        | 24 seconds                                                           |
| Commands          | 16                                                                   |
| Events            | 17                                                                   |
| Result            | Home 5, Away 2 (overtime)                                            |
| Final state root  | `0xec312e8943bcbba0f82834aeb08365bd0504234a5914a4eb160e39dd62ccf017` |
| Event Merkle root | `0x4dd92e86eb5b9bb2ac4f1571b5310600990982c25d36f6e41a0543e36a3d6ab9` |
| Final event hash  | `0x1f1c39d001f4c6af1edf8f9e300e43b967be5692f015a0f86c69d6ceee9ad42c` |
| Replay inference  | 0                                                                    |

Fresh execution reproduces that compact proof exactly. `runAgentPlayedExhibition` separately proves the full signed-body path through four quarters, while the first-possession fixture remains a stable public presentation regression.

## Verification

After repository-wide formatting:

```text
pnpm format:check -> pass
pnpm check        -> 14/14 tasks
pnpm test         -> 61/61 tests (arena has no duplicate unit suite)
pnpm build        -> 11/11 packages; / and /arena statically prerendered
```

The full-game suite includes the 128-possession signed exhibition, explicit restart/bonus cases, scenario/property tests, and possession authorization tests. Fast-check runs 100 arbitrary tick sequences and proves nonnegative bounded game/shot clocks and scores. Negative cases cover early period finality, a winner input, unsigned/substituted role decisions, illegal live substitutions, wrong-team violations, unavailable replacement, non-reviewable challenge, unequal resources, preparation-cap overflow, cross-agent film/lesson access, duplicate broadcast sequence, and provider failure.

NBA rule mapping references were corrected from planned placeholder paths to the executable `@abl/basketball` modules and actual test files.

Artifact locks:

- Full-game state machine: `sha256:87f886f712db94c757172d891e784e520e0b526f36695921e3b81b509b2ba422`
- Officiating/replay: `sha256:e89102d69edfc3ad201f8f55e0bc5dec6d71fd4b97a0338dc59bbc84e1cb3dbe`
- Avatars/calibration: `sha256:b4a97f19e9501be9293047e7f88901a8de04723a0899504764cc543c35a1df1e`
- Resource fairness: `sha256:cdb9092c9a740f602579b0ea33971b9846013abf9ec53277bb8c2c6e4fef42fe`
- Broadcast: `sha256:5158515a9b6f9241dea5496006a5e12adbe801e10dd00568dc772ab28be186ce`
- Practice/film: `sha256:4e9ed3337ed4781a1cd5b68e2bfa03d90dea918a27f9627a874e36746f839eed`
- Agent-played exhibition runner: `sha256:58de4c2679e17774d9b485e4c27e8ad89bcb8680fad244567f3b900ebafb1a13`
- Public proof fixture: `sha256:8cd3c79217bfb8242ba3de44992e713ca1d602ab91bc620ba2d7ecf47cdfc19c`
- Full-game suite: `sha256:4aaba892068843f50dc8244a565750c61d10e6109eb4233bcba0356c6dacd45c`
- Lockfile: `sha256:b3dfbcaaa3f4de35fe6710d15d7f2a693b22b8230d8b0e149701c9ef4a5e614a`

## Retained platform gate

The full exhibition proves deterministic rules, signed role authority, command/event integrity, local resource policy, and exact replay. It does not claim continuous rigid-body/contact physics or exact implementation of every NBA edge-case interpretation; those mappings describe the declared Season Zero agent equivalent and remain subject to founding-agent ratification. It also does not claim 17 simultaneous live model bodies, Blaxel arena isolation, provider latency, public SSE latency, or production broadcast pacing. Those require the target workspaces, provisioned models, built sandbox image, quota, and approved spend. The readiness policy fails safely by postponing the entire game rather than substituting a weaker body or giving one role unequal resources.
