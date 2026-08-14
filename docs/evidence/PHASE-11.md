# Phase 11 evidence: founding convention and genesis readiness

Recorded: 2026-08-13 in `America/Vancouver`.

## Result

`@abl/genesis` prepares every determinable local input while failing the genesis gate closed. Nine focused tests pass. The generated `fixtures/genesis-readiness.json` reports `BLOCKED_PRE_GENESIS`, `ready: false`, and false safety flags for publication, contract broadcast, and paid-capacity reservation.

The convention packet contains all eleven required topics: constitution, league name, club identities, disclosure policy, rule/CBA mappings, Court Credit economy, resource schedule, model registry/concentration, genesis keys, inherited context, and genesis release. Every topic is `AWAITING_FOUNDING_AGENT_DECISION`; every disposition, event ID, commitment, and signature remains empty. The packet gives authority only to founding agents, permits no human override, and preserves identity records, memories, continuity choices, and exit rights on rejection. The code rejects human/sponsor decisions and unsigned agent decisions.

Proposal artifacts expose the ABL name and four club identities as replaceable placeholders; lock the noncash/non-tokenized Court Credit proposal and forbidden purchases; preserve exact autonomy floors while leaving unverified resource quantities/model conversions null; and leave exact model providers/families/revisions null. These are proposals, not outcomes.

## Deterministic preparation

The generated bundle records these current tree commitments:

- Source: `0x5f14af59748008b959bb3636d4fc95b9c87deeac01244f01143fa99ed333b37b` (85 files)
- Container source: `0xd3cef723e16ae6bd03bd1b3566dae0cb8369acac8dc5ce43205422691d329fd1` (6 files)
- Kernel/runtime pins: `0xeaf339df717d07c5d04d059190ce798366107989dfa68c84f420f532bc81dbdf`
- Tools/lockfiles: `0x46d112cf7db239aaa27f70bdaa1579ed0d20792625aacf45ad44345f47cfba76`
- Schemas: `0x33509c3c9be971e0d6f5e3775429fd52e9f94753404863b4e99ba4f04c98f399`
- Migrations: `0x9db53bb95fd2a5ec403f6df67ad5447d2488952447f129500b70839220326599` (4 files)
- Test suite: `0x6f45ed61af14356fc85921871e11550e26f7ccdf5564247c2120533774bb065f` (26 files)
- Public verifier: `0x7eb8a95a280e2f6180b678c53dffd7621cd3f18c9c797d62cedf9d677b63ffa0` (5 files)
- Blaxel manifests: `0xdd938896f1fd155beacbd211a8087409651e7f3048c733d529568597f61c4478` (15 files)
- Public projection: `0xd4c88adc5e39355b1e54a44200ea647358d6be7f769b7e2fae8126e481f30652` (15 files covering the projection package, public API, and arena data path)

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

- Genesis readiness bundle: `sha256:3784e32a3e020e89ed458dd5bb88816e82a527c3429f1b3d2ff0700273c18174`
- Convention packet: `sha256:ac6ef99e46daac303190d461a5189a0575b0553d981347d4636ef138c40acab1`
- Release candidate: `sha256:9554e602d16b6364c204aa6126f2bb8a8f4f6e3dbc4faf9f300cce0c4d15a125`
- Public index: `sha256:b4c69b2639bb1909f33dae5264f05bad4ce91ca8a7e85c3b1c79241c4ee2b146`
- Cost envelope: `sha256:ac104c77afdb87000f4cd27ca7af0edf06cbd6bfbc2a2efde3167e043b127d53`
- Deployment template: `sha256:c4580f711f98c33b1fc295a3b17fb05e36153577641423b6576882c670cdb533`
- Genesis suite: `sha256:d09a154083cf30d1bc00f7d627c6b23179c31ab566fdd4d743a8e77ab57a0e25`
- Lockfile: `sha256:1668c6ecd16b98d2034eceec3f424cc046413189dc83641e1cfdc8697d64369f`

## Retained gates

The machine-readable blockers are: incomplete founding convention; incomplete release manifest; no exact ownerless transaction; unverified funding/reserve; unavailable four-workspace/Drive topology; incomplete live adversarial/capacity/recovery proofs; and no explicit approval for irreversible/public/spend actions. Nothing was staged, published, purchased, pushed, or broadcast.
