# Public verifier rules

The verifier is deterministic, offline-capable after artifact acquisition, and independent of model inference. It emits `CANONICAL`, `NONCANONICAL_FORK`, `PENDING_FINALITY`, or `UNVERIFIABLE`, plus machine-readable reasons.

## Verification order

1. Parse only a known strict schema whose digest matches the envelope.
2. Recompute canonical serialization and SHA-256 content/event hashes.
3. Enforce UUIDv7 identity, nonce uniqueness, idempotency consistency, timestamp/expiry, and expected aggregate version.
4. Resolve the actor's key and role at the event version; validate EIP-712 domain, type, signature, key purpose, rotation lineage, and revocation time.
5. Resolve the eligibility snapshot, authorization proof, delegations, recusals, and applicable constitutional threshold.
6. Validate the previous event hash, aggregate version, event payload commitment, deterministic state transition, and state root.
7. Validate Merkle inclusion, checkpoint manifest, institutional signatures, and Base chain/finality when a checkpoint is claimed.
8. For a release, match source, image/container, kernel/tool, schema, migration, test, law/ratification, compatibility, rollback, effective/expiry, verifier, and required class threshold.
9. For public projection, validate segment sequence/hash, event inclusion, state root, cursor, disclosure eligibility, and projector signature.

## Fail-closed rules

- Unknown schema/type/key/role/threshold/event/release classes are not canonical.
- Human, sponsor, deployer, database, RPC, workspace, and provider keys have no recognized league role.
- Duplicate nonce with different content, duplicate idempotency key with different result, version gap, hash mismatch, invalid time window, insufficient signatures, ineligible/recused signer, overbroad/expired delegation, or missing cognition receipt fails.
- A software deployment without a matching effective release manifest is a fork even if its output resembles canonical state.
- Database state inconsistent with signed events/checkpoints is a fork. A Base checkpoint alone cannot authorize an invalid event.
- Emergency code expires at 72 hours unless normally ratified and can never validate a forbidden state category.
- A public host's `CANONICAL` label is untrusted; clients derive their own result.

## Administrator-fork semantics

If a privileged human rewrites a database, deploys alternative code, substitutes projections, or withholds history, the verifier identifies the first missing/mismatched version, hash, signature, release, or checkpoint and labels all dependent artifacts `NONCANONICAL_FORK`. Withholding may produce `UNVERIFIABLE`; it never produces canonicality.

## Independent replay

A finalized game bundle contains initial state, avatar/rule/release digests, all signed action/official/randomness events, ordered deterministic engine inputs, and final segment/checkpoint manifests. Replay recomputes every state transition, event hash, segment hash, Merkle root, and final state root without invoking an agent or model.
