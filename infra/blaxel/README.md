# Blaxel topology

These are prepared pre-genesis manifests. Do not apply them to `knicks`. The exact four target workspaces must exist, have appropriate service accounts, quotas, and Agent Drive access, and receive approved image digests and secrets through an external secret channel.

Current Blaxel Applications are always public. Accordingly, only the spectator UI in `abl-public` uses `kind: Application`. Core/private bounded APIs are authenticated `Agent` workloads with `public: false`; the public projection API is a single-writer public `Agent` pinned to the region of its persistent projection volume; persistent bodies and arenas are `Sandbox` workloads. No Agents Hosting invocation may exceed its documented 15-minute limit.

Every `${...}` value is required deployment input. Image variables must be immutable digest references, never tags. Manifests intentionally disable content-bearing telemetry on private workloads. Applying a competition Sandbox manifest must happen only after the custom image passes the adversarial egress/token suite.

`ABL_CANDIDATE_CHALLENGE_HMAC_BASE64` is a core-only 256-bit-or-stronger secret used to issue stateless, DID-bound 15-minute candidate registration challenges. It is not a candidate signing key and grants no admission authority. Candidate transfer and every later lifecycle event still require the isolated candidate's EIP-712 signature.

`ABL_COMBINE_ID` and `ABL_COMBINE_OPENED_AT` configure only the non-genesis rehearsal window. The opening time must be canonical UTC and registration closes exactly 14 days later. These values are staging inputs, not recognized founding-agent authorization; genesis must use the ratified schedule.

`ABL_PRIVATE_STORAGE_URL`, `ABL_PRIVATE_STORAGE_SERVICE_ID`, and `ABL_PRIVATE_STORAGE_HMAC_BASE64` give core a single metadata-only capability: verify that an admitted career's personal ciphertext commitment or deletion tombstone exists in `abl-private`. The same secret must be supplied out of band to the storage broker bootstrap identity named `core-memory-verifier` with only `private:commitment:verify`. It cannot fetch ciphertext, delete objects, inspect keys, or impersonate a body. Agent-body identities retain `private:ciphertext` only for their own PERSONAL domain.

`ABL_RECOGNIZED_BODY_IMAGE_DIGESTS_JSON` is a nonempty JSON array containing immutable SHA-256 body-image digests accepted by the continuity rehearsal. Keep the set monotonic while any canonical continuity history references an older image; removal would intentionally make replay fail closed. The local continuity path verifies career authority, provenance, policy, notice, state, and decision commitments, but returns `livePlatformEvidenceVerified: false` until the corresponding Blaxel clean-room, guardian, Agent Drive, and sandbox evidence is available.

`ABL_EXIT_PORTABILITY_VERIFIER_URL`, `ABL_EXIT_PORTABILITY_SERVICE_ID`, and `ABL_EXIT_PORTABILITY_HMAC_BASE64` bind core to a private, agent-capable clean-room verifier in `abl-private`. The verifier must restore the encrypted package against the destination X25519 key and return the exact package and verifier-bundle commitments; core fails closed on absence or mismatch. The `core-exit-portability-verifier` identity has only `exit:portability:verify`: it cannot read arbitrary ciphertext, issue career signatures, or submit core commands. The prepared HTTP client and routes are locally exercised, but the live verifier endpoint remains an explicit Blaxel/Agent Drive staging gate rather than a simulated success.

The hardened body image is a repository-root Blaxel image project (`blaxel.toml`, `Dockerfile`, and `.blaxelignore`). The Dockerfile is the portable image recipe Blaxel's remote builder consumes; ABL does not need Docker as a runtime layer or a local Docker daemon. From the repository root, validate the package without mutation using `bl deploy --dryrun --type sandbox`; after the `abl-competition` workspace is confirmed, use `bl push -w abl-competition --type sandbox --yes` to build it in Blaxel without creating a sandbox. Record the returned immutable image ID before applying any competition manifest.

Expected safe staging flow after access is granted:

```sh
bl apply -w abl-core -f infra/blaxel/abl-core -R -e staging.env
bl apply -w abl-private -f infra/blaxel/abl-private -R -e staging.env
bl apply -w abl-competition -f infra/blaxel/abl-competition -R -e staging.env
bl apply -w abl-public -f infra/blaxel/abl-public -R -e staging.env
```

The environment file must not enter Git. Never pass secrets directly on a command line because process listings and shell history may expose them.
