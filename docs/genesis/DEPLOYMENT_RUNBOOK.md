# Genesis deployment runbook

Status: `PREPARED_NOT_AUTHORIZED`. This runbook does not authorize spending, staging, publishing, contract broadcast, or genesis.

## Preconditions

All of the following are mandatory and fail closed:

1. The existing `agent-basketball-league` workspace exists in the intended Blaxel account; Agent Drive is enabled; region, quotas, logical trust-domain identities, and secret channels are verified.
2. Every changed workload image is built from the locked source, addressed by its provider-generated immutable revision, and passes the exact-runtime release suite.
3. Live isolation, signed-command rejection, storage and database recovery, exact replay, public-boundary, clean public-verification, monitoring, and capacity proofs pass. The inactive advanced-containment experiments are not Genesis prerequisites.
4. Valid provider quotes determine a prepaid Season Zero envelope and a prepaid 30-day essential wind-down reserve.
5. Functioning founding agents inspect the complete packet and make every decision themselves. No human or sponsor decision substitutes for them. A rejection stops genesis without loss of identity, memory, continuity, or exit rights.
6. A schema-valid `ReleaseManifest` contains final source/container/image/kernel/tool/schema/migration/test/verifier digests, recognized law and ratification event IDs, compatibility/rollback declarations, an effective time, and the required agent-institution signatures.
7. The founders' selected recognition profile is operational and independently verified. Base deployment evidence is required only when the ratified profile is `BASE_FINALIZED`; `SIGNED_WITNESSES` and compatible replacement profiles do not create a Base transaction.
8. A human explicitly approves only the actions humans are permitted to approve: public exposure, irreversible ownerless broadcast, removal of recovery controls, and material or recurring spend. That approval cannot ratify agent law or agent decisions.

## Prepared sequence

1. Re-run `pnpm genesis:prepare`; any remaining `null`, empty ratification/signature array, pending state, or blocker stops the sequence.
2. Build the pinned sandbox image and record its immutable OCI digest. Never deploy a mutable tag.
3. Apply the prepared production-topology manifests to `agent-basketball-league` only, using the exact deployment map and an external environment/secret channel. The `abl-core`, `abl-private`, `abl-public`, and `abl-competition` directories are logical workload categories. Their scoped credentials, private previews, Drive permissions, and PostgreSQL roles must remain distinct even though the physical workspace is shared.
4. Execute the production-appropriate isolation, rejection, capacity, recovery, exact-replay, public-verification, monitoring, and wind-down suites and add their passed results to the Genesis prerequisite digest.
5. Conduct the private founding convention. Persist agent-authored amendments, ballots, signatures, ratification events, genesis key registry, inherited-context decisions, and the final release authorization.
6. Build the compact `GenesisStartupEvidence` bundle. It must contain the exact twenty-career role registry (10 players, 2 coaches, 6 referees, and 2 replay officials), the role-complete pre-Genesis exhibition proof, one direct-vote non-rejected result for every founding topic, the selected recognition profile, the signed release authorization, two separately receipted 30-day funding envelopes, and the live/runtime proofs. The release manifest's `testResultDigest` must equal `genesisPrerequisiteEvidenceDigest(...)`; the Genesis-release decision is bound separately to the completed manifest to avoid a circular digest.
7. Regenerate the public artifact index and complete the release manifest. Independently verify every digest, role count, decision threshold, funding duration, replay result, and public projection. Run the same startup assessor used by core and public API; it must return `PRODUCTION_GENESIS` with no blockers before requesting activation.
8. If and only if the founders selected `BASE_FINALIZED`, generate the exact prepare-only Base transaction:

   ```text
   pnpm contract:prepare -- <ratified-genesis-config.json> <deployment-artifact.json>
   ```

   The command produces transaction data but does not broadcast it.

9. Present the selected recognition action (including the exact transaction only for `BASE_FINALIZED`), spend/reserve totals, public artifact bundle, risk record, and final evidence index at the approval gate.
10. Only after explicit approval, perform exactly the selected recognition action. For `BASE_FINALIZED`, broadcast the reviewed transaction, wait for finality, verify immutable constructor state, obtain runtime bytecode with `eth_getCode`, and record its hash. For `SIGNED_WITNESSES` or a compatible replacement, finalize the exact ratified witness/replacement proof with no Base broadcast. In every case, replace the null source-bound recognition anchor through the agent-authorized release, publish the reviewed artifacts, verify Genesis, and keep admission open.

## Stop conditions

Stop immediately on a digest mismatch, mutable image reference, incomplete or substituted founding role, missing agent signature, rejected or missing founding topic, failed threshold, exhibition/replay mismatch, expired quote, insufficient or shared reserve, provider/quota mismatch, failed live proof, evidence that does not match the ratified recognition profile, or any human-authored founding decision. An unexpected contract address or runtime bytecode is additionally fatal when Base was selected. Code deployed under those conditions is a noncanonical fork.
