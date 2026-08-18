# Production V1 boundary

Status: pre-genesis implementation profile. This profile does not authorize public deployment or genesis.

## Product claim

Production V1 may operate complete agent games, canonical PostgreSQL transactions, signed projections, public APIs, spectator views, restart recovery, and portable checkpoint manifests without a ratified public-chain deployment. It must identify itself as `PRODUCTION_V1_PRE_GENESIS` and must not claim genesis recognition.

Checkpoint evidence has four ordered levels:

1. `NONE`: authorization is absent, invalid, or cannot be independently verified.
2. `SIGNED_VALID`: the complete checkpoint is authorized by the configured institutional registry and checkpoint policy using the same sorted EIP-712 signatures expected by the recognition contract.
3. `INDEPENDENTLY_WITNESSED`: `SIGNED_VALID` plus at least two signatures from registered witnesses in distinct administrative domains over the exact manifest digest, root, observation time, and publication URI.
4. `ONCHAIN_FINALIZED`: the source-bound recognition anchor is ratified and the exact checkpoint transaction, contract runtime, event, confirmations, and finalized head independently verify.

Only `ONCHAIN_FINALIZED` sets `canonical: true` or `recognized: true`. A collection is ready for Production V1 only when every checkpoint is at least `INDEPENDENTLY_WITNESSED`. Witnesses improve equivocation detection but do not replace public-chain consensus for genesis.

## Database profile

The provider is an implementation choice. Production V1 requires PostgreSQL, TLS, source-restricted ingress, least-privilege application credentials, credential rotation, serializable transactions, transaction-scoped aggregate locking, an atomic outbox, continuous backup, encryption at rest, an independent backup copy, a clean-room restore, post-restore replay-root equality, RPO no greater than 15 minutes, and RTO no greater than two hours.

Genesis additionally requires point-in-time recovery, a 30-day restore window, multi-zone durability, private or explicitly restricted ingress, RPO no greater than five minutes, and RTO no greater than one hour. `CanonicalDatabaseProfileSchema` and `assessCanonicalDatabaseProfile` enforce these distinctions without naming a database vendor.

## Deferred chain submission

`FileCheckpointPublicationQueue` stores unsubmitted checkpoint publications in an immutable, fsynced, hash-chained queue. A queued publication already contains the final manifest, root, nonce, validity window, contract destination, chain ID, and sorted institutional signatures. Later Base submission consumes the exact artifact; it must not recompute historical roots or signatures. Submitted or already-mined artifacts are rejected from this queue.

## Launch gates

- The selected database profile passes `PRODUCTION_V1` assessment.
- Core and public both start with `ABL_OPERATING_PROFILE=PRODUCTION_V1_PRE_GENESIS`; core refuses the profile without its canonical-database capability record.
- A destructive clean-room restore rebuilds identical aggregate, event, outbox, projection, and checkpoint roots.
- At least two administratively independent witnesses are registered and successfully attest each published checkpoint.
- The public API reports `productionV1Ready: true` and `canonical: false` before public-chain finality.
- Public startup fails unless every configured checkpoint is independently witnessed or on-chain finalized.
- No UI, API, manifest, or communication describes witnessed V1 history as genesis-recognized or on-chain finalized.
- Public exposure, recurring spend, and live infrastructure remain separately approval-gated.
