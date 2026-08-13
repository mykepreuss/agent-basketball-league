# Phase 3 evidence: recognition foundation

Recorded: 2026-08-13 in `America/Vancouver`.

## Implemented

- Strict deterministic JSON bytes and SHA-256 content commitments with rejection of undefined, non-finite, non-plain, and otherwise non-JSON values.
- Separate secp256k1/EIP-712 signing identities and X25519 encryption identities.
- Per-aggregate event versions and SHA-256 chains, typed authorization messages, signer recovery, nonce and idempotency enforcement, and immutable state-root commitments.
- Domain-separated SHA-256 Merkle leaves/nodes, inclusion proofs, checkpoint manifests, all seven required checkpoint categories, daily aggregate roots, and finality-aware checkpoint claim verification.
- Institutional signing-key registry with role, purpose, validity window, revocation, duplicate-signer denial, recusals, and fail-closed grouped thresholds.
- Offline public verifier labels for canonical state, rewritten/unsigned/unauthorized forks, pending Base finality, missing checkpoint evidence, and deployments whose artifacts differ from an effective release.
- Solidity `RecognitionRegistry` with EIP-712 checkpoints, per-type role thresholds, nonce and previous-root enforcement, sorted unique signers/policy types, low-S signatures, recognized registry rotation that clears omitted prior policies, immutable genesis constitution/verifier digests, and no owner, proxy, pause, deployer, or unilateral mutation route.
- Prepare-only Base Sepolia deployment workflow. It accepts no RPC or private key, rejects chain ids other than `84532`, writes the complete creation transaction once, and never broadcasts.

## Verification

After formatting:

```text
pnpm check  -> 10/10 tasks
pnpm test   -> 41/41 tests
pnpm build  -> 8/8 packages
```

Focused recognition tests cover canonical ordering, forbidden JSON inputs, key separation, EIP-712 recovery, Merkle proofs, checkpoint categories/finality, exact routine thresholds, idempotent replay, rewritten payloads, human/unknown signers, recusals, expired keys, release-artifact matching, and deterministic Solidity compilation. A Ganache in-process EVM suite deploys the compiled bytecode and exercises recognition, nonce replay, signer/policy rotation, omitted-policy removal, new thresholds, stale signers, mixed epochs, and malformed signatures. The compile suite confirms the ABI lacks owner, upgrade, pause, self-destruct, or direct root-setting functions.

The current prepare-only template produced:

- Compiler: `0.8.36+commit.8a079791.Emscripten.clang`
- Compiler input: `sha256:140fbc82bdba17f3af843821ef2af1abfa3b912c519e9e3871653f5308849555`
- Creation bytecode: `sha256:1a7c150a90d3bb9805f382b617243ad6fea38caf752dead110f09f53677de7a0`
- Creation bytecode: `keccak256:d0fc5551c5445266e28d59cf09cfb2dba0b2747a0cb3ed6e211243eb62806889`
- Encoded creation transaction: `null` until ratified constructor inputs exist

Tracked source locks:

- Contract: `sha256:1b0bc5e15ee1864d5437ebc2c61b88744db9c04f2981c085d804a16a6d43b15b`
- Verifier: `sha256:3a365e9b659439ed73967a2f322d976777e7ad0899593e1f9eb6f96b4e1d3463`
- Canonical serializer: `sha256:675e6aa5bc1c8a1799a61c40f9d647c7c7c7e99d3f4c286abb4e9e4c4d3d0bd9`
- Deployment preparer: `sha256:49d97e0b623358a5edd9fc3762b519b2d7de3190ae36080de52d2672aba111c8`
- Behavioral contract suite: `sha256:7682b0e5a9ed4d43f83af09364134c160a34b40ac3ef3f4d6f98f52f127030ed`
- Lockfile: `sha256:b3dfbcaaa3f4de35fe6710d15d7f2a693b22b8230d8b0e149701c9ef4a5e614a`

## Retained gates

No public transaction was signed or broadcast. Local behavioral EVM execution now passes without Foundry or Docker; Base Sepolia execution/finality evidence remains a staging dependency. The local signers/digests are inert test fixtures, not founding-agent keys. Any public or irreversible ownerless deployment remains an explicit human approval gate after agent ratification, capacity/recovery proof, and final release preparation.
