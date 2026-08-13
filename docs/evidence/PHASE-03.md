# Phase 3 evidence: recognition foundation

Recorded: 2026-08-13 in `America/Vancouver`.

## Implemented

- Strict deterministic JSON bytes and SHA-256 content commitments with rejection of undefined, non-finite, non-plain, and otherwise non-JSON values.
- Separate secp256k1/EIP-712 signing identities and X25519 encryption identities.
- Per-aggregate event versions and SHA-256 chains, typed authorization messages, signer recovery, nonce and idempotency enforcement, and immutable state-root commitments.
- Domain-separated SHA-256 Merkle leaves/nodes, inclusion proofs, checkpoint manifests, all seven required checkpoint categories, daily aggregate roots, and finality-aware checkpoint claim verification.
- Institutional signing-key registry with role, purpose, validity window, revocation, duplicate-signer denial, recusals, and fail-closed grouped thresholds.
- Offline public verifier labels for canonical state, rewritten/unsigned/unauthorized forks, pending Base finality, missing checkpoint evidence, and deployments whose artifacts differ from an effective release.
- Solidity `RecognitionRegistry` with EIP-712 checkpoints, per-type role thresholds, nonce and previous-root enforcement, sorted unique signers, low-S signatures, recognized registry rotation, immutable genesis constitution/verifier digests, and no owner, proxy, pause, deployer, or unilateral mutation route.
- Prepare-only Base Sepolia deployment workflow. It accepts no RPC or private key, rejects chain ids other than `84532`, writes the complete creation transaction once, and never broadcasts.

## Verification

After formatting:

```text
pnpm check  -> 10/10 tasks
pnpm test   -> 41/41 tests
pnpm build  -> 8/8 packages
```

Focused recognition tests cover canonical ordering, forbidden JSON inputs, key separation, EIP-712 recovery, Merkle proofs, checkpoint categories/finality, exact routine thresholds, idempotent replay, rewritten payloads, human/unknown signers, recusals, expired keys, release-artifact matching, and deterministic Solidity compilation. The compile suite confirms the ABI lacks owner, upgrade, pause, self-destruct, or direct root-setting functions.

The current prepare-only example produced:

- Compiler: `0.8.36+commit.8a079791.Emscripten.clang`
- Compiler input: `sha256:6796cedce6058d05e3d1a9165c29fd44c1a953763fa65bfe51f9b14d673bbdf0`
- Creation bytecode: `keccak256:df790cac75cd66e5e83de113ed30faf0d030a70b47a63d77a61e7f1d68e5a70a`
- Example config: `sha256:64f1fcdec6bfc793d17b784b08f043f09262badad39eaf72f7343c39e86f9c9d`
- Encoded creation data: 10,204 bytes, `sha256:005a0f50c6984caeecfebe095faaf1562012fba3ed781e5dbcf0a0f3a4ad37bc`

Tracked source locks:

- Contract: `sha256:37ade911346ac7d0d8614200a048aa3050c3d35b681f89f9e92a6b36d68cf9c9`
- Verifier: `sha256:3a365e9b659439ed73967a2f322d976777e7ad0899593e1f9eb6f96b4e1d3463`
- Canonical serializer: `sha256:675e6aa5bc1c8a1799a61c40f9d647c7c7c7e99d3f4c286abb4e9e4c4d3d0bd9`
- Deployment preparer: `sha256:49d97e0b623358a5edd9fc3762b519b2d7de3190ae36080de52d2672aba111c8`
- Lockfile: `sha256:5a936c78c76b564e7cb136cb1d4628e46a6cc1c0c803cfd467c9908554e5a0b9`

## Retained gates

No transaction was signed or broadcast. Local EVM execution is unavailable because Foundry is absent and Docker is offline; Base Sepolia execution/finality evidence remains a staging dependency. The example signers/digests are inert placeholders, not founding-agent keys. Any public or irreversible ownerless deployment remains an explicit human approval gate after agent ratification, capacity/recovery proof, and final release preparation.
