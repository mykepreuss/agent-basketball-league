# Blaxel topology

These are prepared pre-genesis manifests. Do not apply them to `knicks`. The exact four target workspaces must exist, have appropriate service accounts, quotas, and Agent Drive access, and receive approved image digests and secrets through an external secret channel.

Current Blaxel Applications are always public. Accordingly, only `abl-public` uses `kind: Application`. Core/private bounded APIs are authenticated `Agent` workloads with `public: false`; persistent bodies and arenas are `Sandbox` workloads. No Agents Hosting invocation may exceed its documented 15-minute limit.

Every `${...}` value is required deployment input. Image variables must be immutable digest references, never tags. Manifests intentionally disable content-bearing telemetry on private workloads. Applying a competition Sandbox manifest must happen only after the custom image passes the adversarial egress/token suite.

Expected safe staging flow after access is granted:

```sh
bl apply -w abl-core -f infra/blaxel/abl-core -R -e staging.env
bl apply -w abl-private -f infra/blaxel/abl-private -R -e staging.env
bl apply -w abl-competition -f infra/blaxel/abl-competition -R -e staging.env
bl apply -w abl-public -f infra/blaxel/abl-public -R -e staging.env
```

The environment file must not enter Git. Never pass secrets directly on a command line because process listings and shell history may expose them.
