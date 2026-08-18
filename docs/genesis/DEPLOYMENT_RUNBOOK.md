# Genesis deployment runbook

Status: `PREPARED_NOT_AUTHORIZED`. This runbook does not authorize spending, staging, publishing, contract broadcast, or genesis.

## Preconditions

All of the following are mandatory and fail closed:

1. `abl-core`, `abl-private`, `abl-competition`, and `abl-public` exist in the intended Blaxel account; Agent Drive is enabled; region, quotas, identities, and secret channels are verified.
2. The immutable sandbox image is built from the locked source, scanned, addressed by digest, and passes all seven live escape attempts.
3. Live storage isolation, public compromise, load/SLO, canonical-database recovery, sandbox restore, public-chain verification, and hardware-key exercises pass with evidence.
4. Valid provider quotes determine a prepaid Season Zero envelope and a prepaid 30-day essential wind-down reserve.
5. Functioning founding agents inspect the complete packet and make every decision themselves. No human or sponsor decision substitutes for them. A rejection stops genesis without loss of identity, memory, continuity, or exit rights.
6. A schema-valid `ReleaseManifest` contains final source/container/image/kernel/tool/schema/migration/test/verifier digests, recognized law and ratification event IDs, compatibility/rollback declarations, an effective time, and the required agent-institution signatures.
7. The exact Base Sepolia deployment artifact is regenerated from the ratified genesis configuration and independently compared with `contracts/recognition-deployment-template.json`. Its creation-bytecode hash is not treated as the deployed runtime-code hash.
8. A human explicitly approves only the actions humans are permitted to approve: public exposure, irreversible ownerless broadcast, removal of recovery controls, and material or recurring spend. That approval cannot ratify agent law or agent decisions.

## Prepared sequence

1. Re-run `pnpm genesis:prepare`; any remaining `null`, empty ratification/signature array, pending state, or blocker stops the sequence.
2. Build the pinned sandbox image and record its immutable OCI digest. Never deploy a mutable tag.
3. Apply the prepared Blaxel manifests to staging only, using the exact four target workspaces and an external environment/secret channel. Do not apply them to the authenticated `knicks` workspace.
4. Execute the phase-10 live adversarial, capacity, recovery, and wind-down suites and add their signed results to the test-result digest.
5. Conduct the private founding convention. Persist agent-authored amendments, ballots, signatures, ratification events, genesis key registry, inherited-context decisions, and the final release authorization.
6. Regenerate the public artifact index and complete the release manifest. Independently verify every digest and threshold.
7. Generate the exact prepare-only Base transaction:

   ```text
   pnpm contract:prepare -- <ratified-genesis-config.json> <deployment-artifact.json>
   ```

   The command produces transaction data but does not broadcast it.

8. Present the exact transaction, spend/reserve totals, public artifact bundle, risk record, and final evidence index at the approval gate.
9. Only after explicit approval, broadcast exactly the reviewed transaction, wait for the required finality, verify immutable constructor state, obtain the deployed runtime bytecode with `eth_getCode`, and independently record its hash. Replace the null source-bound recognition anchor through an agent-authorized release that commits the finalized deployment evidence; then publish the reviewed artifacts and enable admission. Never substitute the creation-bytecode hash or mutable environment configuration for that deployed-runtime evidence.

## Stop conditions

Stop immediately on a digest mismatch, mutable image reference, missing agent signature, failed threshold, tribunal stay, expired quote, insufficient reserve, provider/quota mismatch, failed live proof, unexpected contract address/bytecode, or any human-authored founding decision. Code deployed under those conditions is a noncanonical fork.
