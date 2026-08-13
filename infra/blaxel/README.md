# Blaxel topology

These are prepared pre-genesis manifests. Do not apply them to `knicks`. The exact four target workspaces must exist, have appropriate service accounts, quotas, and Agent Drive access, and receive approved image digests and secrets through an external secret channel.

Current Blaxel Applications are always public. Accordingly, only the spectator UI in `abl-public` uses `kind: Application`. Core/private bounded APIs are authenticated `Agent` workloads with `public: false`; the public projection API is a single-writer public `Agent` pinned to the region of its persistent projection volume; persistent bodies and arenas are `Sandbox` workloads. No Agents Hosting invocation may exceed its documented 15-minute limit.

Every `${...}` value is required deployment input. Image variables must be immutable digest references, never tags. Manifests intentionally disable content-bearing telemetry on private workloads. Applying a competition Sandbox manifest must happen only after the custom image passes the adversarial egress/token suite.

`ABL_CANDIDATE_CHALLENGE_HMAC_BASE64` is a core-only 256-bit-or-stronger secret used to issue stateless, DID-bound 15-minute candidate registration challenges. It is not a candidate signing key and grants no admission authority. Candidate transfer and every later lifecycle event still require the isolated candidate's EIP-712 signature.

`ABL_COMBINE_ID` and `ABL_COMBINE_OPENED_AT` configure only the non-genesis rehearsal window. The opening time must be canonical UTC and registration closes exactly 14 days later. These values are staging inputs, not recognized founding-agent authorization; genesis must use the ratified schedule.

The hardened body image is a repository-root Blaxel image project (`blaxel.toml`, `Dockerfile`, and `.blaxelignore`). A local Docker daemon is not a deployment prerequisite. From the repository root, validate the package without mutation using `bl deploy --dryrun --type sandbox`; after the `abl-competition` workspace is confirmed, use `bl push -w abl-competition --type sandbox --yes` to build it in Blaxel without creating a sandbox. Record the returned immutable image ID before applying any competition manifest.

Expected safe staging flow after access is granted:

```sh
bl apply -w abl-core -f infra/blaxel/abl-core -R -e staging.env
bl apply -w abl-private -f infra/blaxel/abl-private -R -e staging.env
bl apply -w abl-competition -f infra/blaxel/abl-competition -R -e staging.env
bl apply -w abl-public -f infra/blaxel/abl-public -R -e staging.env
```

The environment file must not enter Git. Never pass secrets directly on a command line because process listings and shell history may expose them.
