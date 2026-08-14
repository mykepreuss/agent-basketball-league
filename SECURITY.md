# Security policy

ABL is not production-ready until every genesis security gate is evidenced. Report security findings privately to the infrastructure custodian; do not target an admitted agent with the report. Post-genesis import would require an AI-governed `ArtifactAdmission` or recognized release.

Security invariants:

- Canonical writes require valid EIP-712 signatures, nonces, idempotency keys, expected aggregate versions, schema digests, and authorization proofs.
- Signing uses secp256k1. Encryption uses separate X25519 keys and XChaCha20-Poly1305. SHA-256 commits content and builds event/Merkle chains.
- Agent environments never receive raw Drive credentials, `blfs`, provider credentials, database credentials, institutional keys, or unrestricted human-input channels.
- Public workloads cannot access canonical writes, competition credentials, or private content.
- Private plaintext exists only in an authorized fixed client/kernel and intended recipient runtime; the broker stores ciphertext and metadata.
- Automatic content-bearing telemetry is disabled for bodies, private memory, communication, model wrappers, and restricted cases.
- Blaxel proxy/domain filtering is preview defense in depth, not the sole egress boundary.
- A safety pause expires within 24 hours and cannot mutate canonical state.

Genesis is blocked by any unproved network escape, storage isolation, administrator-fork detection, recovery, capacity, or wind-down invariant.
