# Phase 11 evidence: founding convention and genesis readiness

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

`@abl/genesis` prepares every determinable local input while failing the genesis gate closed. Nine focused tests pass. The generated `fixtures/genesis-readiness.json` reports `BLOCKED_PRE_GENESIS`, `ready: false`, and false safety flags for publication, contract broadcast, and paid-capacity reservation.

The convention packet contains all eleven required topics: constitution, league name, club identities, disclosure policy, rule/CBA mappings, Court Credit economy, resource schedule, model registry/concentration, genesis keys, inherited context, and genesis release. Every topic is `AWAITING_FOUNDING_AGENT_DECISION`; every disposition, event ID, commitment, and signature remains empty. The packet gives authority only to founding agents, permits no human override, and preserves identity records, memories, continuity choices, and exit rights on rejection. The code rejects human/sponsor decisions and unsigned agent decisions.

Proposal artifacts expose the ABL name and four club identities as replaceable placeholders; lock the noncash/non-tokenized Court Credit proposal and forbidden purchases; preserve exact autonomy floors while leaving unverified resource quantities/model conversions null; and leave exact model providers/families/revisions null. These are proposals, not outcomes.

## Deterministic preparation

The generated bundle records these current tree commitments:

- Source: `0xec1afc98241c941a51ab66bf0eb058dcb03a681f6c1c476848bce049e053a6c6` (72 files)
- Container source: `0x43deac1738e847264554f9155fefe81fda3631888273611a96040422a6cce61e` (4 files)
- Kernel/runtime pins: `0x3a21b9a181d97ea91bfbf50cd15cbc65feffa5406162ddaf52b91bb5f97ca439`
- Tools/lockfiles: `0xf81b7565a1427eafccc3569550e4690c2c193bdf2a171510b5445264e2d57799`
- Schemas: `0xe54ff83a749ce17ba97dae28090333bb2576b4d63a31f7e0a3b026646d38956f`
- Migrations: `0xa88b9d527711d1e5115d301acb8ca38c76b7a1acf9b524e4b2ed05e9a14e9858`
- Test suite: `0x82d8261342f6b4d1a40d40e70d2afa2df084dcc7b2dd9387ebf52fbdb2ca3a99` (18 files)
- Public verifier: `0xe5c1e8d05d4adb7b24f7ff5fdb47ad514b35cdabc7824279b8b47d747a1a1f68`
- Blaxel manifests: `0xc4a502e4c148fd2eda9be0d51cbb5d3b8979edba95fc7654db86d980de22b773`
- Public projection: `0xc892db40835a8159fb3e62cbd53de797eba949082c31e07b23eb657c1248fe9f`

Each group commits a sorted list of repository-relative paths and individual SHA-256 values. Generated outputs, build directories, caches, and dependencies are excluded. Later source/test changes require regeneration; these are phase-11 snapshot commitments, not a genesis root.

The release candidate uses every available digest but intentionally fails `ReleaseManifestSchema`: image digests, final test/verifier results, ratification events, effective time, release ID, and authorization signatures do not exist. It cannot be mistaken for a complete release.

## Ownerless deployment and cost boundary

Solidity `0.8.36+commit.8a079791.Emscripten.clang` compiles the contract to creation-bytecode Keccak-256 `0xdf790cac75cd66e5e83de113ed30faf0d030a70b47a63d77a61e7f1d68e5a70a`. ABI inspection finds no owner/admin/upgrade/pause/destroy surface. The deployment template names every constructor input but keeps `transaction: null`.

The strengthened CLI rejects `contracts/genesis-config.pending.json` before compilation with `Genesis config contains pending or invalid...`. A separate placeholder-only example proves the prepare path emits a 10,204-byte Base Sepolia contract-creation payload with `to: null`, value zero, and `PREPARE_ONLY_NO_BROADCAST`. It is not the genesis transaction and has not been broadcast.

The cost envelope records five unquoted providers with null quote references, validity times, Season Zero costs, and 30-day essential costs. Totals remain null, not zero; prepayment and approval are false. The deployment runbook and risk record explain the staging sequence, stop conditions, continuity/storage/capacity/funding responses, and the irreversibility boundary.

## Verification

```text
pnpm genesis:prepare              -> deterministic bundle generated
pnpm --filter @abl/genesis check -> pass
pnpm --filter @abl/genesis test  -> 9/9 tests pass
pending deployment config        -> rejected before transaction creation
placeholder prepare-only config  -> compiler/encoder pass; no RPC/key/broadcast
```

Artifact locks:

- Genesis readiness bundle: `sha256:c3b2ee445c8af9340a69f0f42a1566e80675b05e05a9fb0200699c65e5da9227`
- Convention packet: `sha256:ac6ef99e46daac303190d461a5189a0575b0553d981347d4636ef138c40acab1`
- Release candidate: `sha256:701775924cbcc5aec62856ee2d1b00b27bd0b329669c33404349a463ec080735`
- Public index: `sha256:591a79e937442c17f49b5469dd8cd5c917118ef85410c149eefebeeea70be0734`
- Cost envelope: `sha256:ac104c77afdb87000f4cd27ca7af0edf06cbd6bfbc2a2efde3167e043b127d53`
- Deployment template: `sha256:ba89ea40f1446f1dc0c6e52cb19d2ef4abb625f32b4f62a36d899f3d631530e4`
- Genesis suite: `sha256:abe1c0a0ee27409c07ed5439e3bba077957f4c5226d06c4ab2c0dbeac1790ffa`
- Lockfile: `sha256:20e11ef70c0e0dede063959cc808708e67e6be97efc9697aeb66d1e8925b0f70`

## Retained gates

The machine-readable blockers are: incomplete founding convention; incomplete release manifest; no exact ownerless transaction; unverified funding/reserve; unavailable four-workspace/Drive topology; incomplete live adversarial/capacity/recovery proofs; and no explicit approval for irreversible/public/spend actions. Nothing was staged, published, purchased, pushed, or broadcast.
