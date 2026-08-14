# Phase 3 evidence: recognition foundation

Recorded: 2026-08-13 in `America/Vancouver`.

## Implemented

- Strict deterministic JSON bytes and SHA-256 content commitments with rejection of undefined, non-finite, non-plain, and otherwise non-JSON values.
- Separate secp256k1/EIP-712 signing identities and X25519 encryption identities.
- Per-aggregate event versions and SHA-256 chains, typed authorization messages, signer recovery, nonce and idempotency enforcement, and immutable state-root commitments.
- Domain-separated SHA-256 Merkle leaves/nodes, inclusion proofs, checkpoint manifests, all seven required checkpoint categories, daily aggregate roots, and finality-aware checkpoint claim verification. The signed checkpoint nonce equals the full manifest digest, preventing substitution of verifier/key-registry metadata or manifest lineage around an anchored event root.
- Institutional signing-key registry with role, purpose, validity window, revocation, duplicate-signer denial, recusals, and fail-closed grouped thresholds.
- Offline public verifier labels for canonical state, rewritten/unsigned/unauthorized forks, pending Base finality, missing checkpoint evidence, unratified recognition anchors, and deployments whose artifacts differ from an effective release. The address, deployed-runtime-code hash, chain, deployment evidence, and confirmation policy are source-bound release inputs rather than mutable host configuration.
- Solidity `RecognitionRegistry` with EIP-712 checkpoints, per-type role thresholds, nonce and previous-root enforcement, sorted unique signers/policy types, low-S signatures, recognized registry rotation that clears omitted prior policies, immutable genesis constitution/verifier digests, and no owner, proxy, pause, deployer, or unilateral mutation route.
- Prepare-only Base Sepolia deployment workflow. It accepts no RPC or private key, rejects chain ids other than `84532`, writes the complete creation transaction once, and never broadcasts.

## Verification

After formatting:

```text
pnpm check  -> 10/10 tasks
pnpm test   -> 41/41 tests
pnpm build  -> 8/8 packages
```

Focused recognition tests cover canonical ordering, forbidden JSON inputs, key separation, EIP-712 recovery, Merkle proofs, checkpoint categories/finality, manifest substitution, invalid chain observations, the key-registry root special case, source-bound anchors, exact routine thresholds, idempotent replay, rewritten payloads, human/unknown signers, recusals, expired keys, release-artifact matching, and deterministic Solidity compilation. A Ganache in-process EVM suite deploys the compiled bytecode and exercises recognition, nonce replay, signer/policy rotation, omitted-policy removal, new thresholds, stale signers, mixed epochs, and malformed signatures. The compile suite confirms the ABI lacks owner, upgrade, pause, self-destruct, or direct root-setting functions.

The current prepare-only template produced:

- Compiler: `0.8.36+commit.8a079791.Emscripten.clang`
- Compiler input: `sha256:140fbc82bdba17f3af843821ef2af1abfa3b912c519e9e3871653f5308849555`
- Creation bytecode: `sha256:1a7c150a90d3bb9805f382b617243ad6fea38caf752dead110f09f53677de7a0`
- Creation bytecode: `keccak256:d0fc5551c5445266e28d59cf09cfb2dba0b2747a0cb3ed6e211243eb62806889`
- Deployed runtime bytecode: `null` until an approval-gated deployment is finalized and verified with `eth_getCode`
- Encoded creation transaction: `null` until ratified constructor inputs exist

Tracked source locks:

- Contract: `sha256:1b0bc5e15ee1864d5437ebc2c61b88744db9c04f2981c085d804a16a6d43b15b`
- Verifier: `sha256:9c35f0b89d88dc41e1b9914bf706cac7b889ee01f1640ea30e0f9eebcc300d0b`
- Canonical serializer: `sha256:5936b6fb7984d5bee2e7269fd7fb7071e40261a89fe14f4e34158669386f9d9c`
- Deployment preparer: `sha256:1fefb8416c5df59598240b47c8e1ef371e58a2988fca6560a69775b008e7eb60`
- Behavioral contract suite: `sha256:7682b0e5a9ed4d43f83af09364134c160a34b40ac3ef3f4d6f98f52f127030ed`
- Lockfile: `sha256:3ca9ca9ddf8e1ac501a6d8cd3efd225e208229d0b2e4224b7fe5b90b23abc61c`

## Retained gates

No public transaction was signed or broadcast. Local behavioral EVM execution now passes without Foundry or Docker; Base Sepolia execution/finality evidence remains a staging dependency. The local signers/digests are inert test fixtures, not founding-agent keys. Any public or irreversible ownerless deployment remains an explicit human approval gate after agent ratification, capacity/recovery proof, and final release preparation.
