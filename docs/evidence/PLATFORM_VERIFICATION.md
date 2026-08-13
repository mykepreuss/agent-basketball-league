# Platform verification and plan differences

Verified: 2026-08-12 in `America/Vancouver` before implementation approach changes.

## Local environment

| Item                    | Verified state                                                                      | Decision                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Target repository       | Did not exist; initialized as a standalone Git repository                           | Build from the approved plan; no legacy behavior to preserve                                      |
| Applicable instructions | `/Users/mp/.codex/AGENTS.md` exists but is empty; no ancestor or target `AGENTS.md` | Follow the task and Codex workspace rules                                                         |
| Node                    | System `v24.7.0`; exact pinned `v24.18.0` binary is installed separately            | Run evidence through `v24.18.0`; custom-image verification remains a platform gate                |
| pnpm                    | Local `10.13.1`; registry current `11.21.0`                                         | Pin `11.21.0` through Corepack and lockfile                                                       |
| Blaxel CLI              | `0.1.108`, commit `12b88d7b291c74d8ece32dc3b9fd835fd9435641`, built 2026-07-30      | Pin in evidence and deployment prerequisites                                                      |
| Local Docker CLI        | `29.2.0`; daemon unavailable                                                        | Optional image preflight only; Blaxel performs the authoritative image build and sandbox run      |
| PostgreSQL client       | `14.19`; no local server verified                                                   | Keep SQL portable; use containerized current Postgres for tests                                   |
| Foundry                 | Not installed                                                                       | Contract source/tests may use a pinned container or JS compiler until an approved test deployment |

## Blaxel account capability probe

Authenticated CLI access currently lists only the workspace `knicks`. It contains two deployed Agents, no Sandboxes, no Applications, two Models, no Policies, and no Volumes. `GET /drives` returns `403` with `Drives feature is not enabled for this workspace`.

Plan difference and response:

1. The approved four workspaces (`abl-core`, `abl-private`, `abl-competition`, `abl-public`) are not currently accessible. Workspace creation is supported by the official SDK/console, but invoking it would create account resources and the target names/capability are not yet confirmed. The repository will contain exact four-workspace manifests and validation. Live staging is an external access/approval gate, not grounds to collapse isolation into `knicks`.
2. Agent Drive is not enabled on the accessible workspace despite the plan's assumption of private-preview access. The encrypted broker, ciphertext layout, and local emulator will be implemented and tested; live Drive proof remains blocked pending feature access.
3. Official Drive documentation is internally transitional. The Overview (modified 2026-05-01) says access is workspace-level and warns that a workload token plus `blfs` can bypass mount mode. A newer Permissions page documents server-enforced label/path ACLs but also says drives default open within a workspace and mounts are not boundaries. Because availability/GA and adversarial behavior are unverified—and the current account has no Drive—the plan's encrypted broker remains mandatory. Native ACLs may be additive only after live adversarial proof.
4. Proxy and domain filtering remain public preview and are explicitly not recommended for production. Domain filtering depends on clients honoring proxy variables; routing-level enforcement is future work. Proxy configuration always bypasses localhost, RFC1918, link-local metadata, `.local`, and `.internal`. Therefore the fixed local broker plus OS-level egress restrictions is necessary, and the custom image must block direct and local-route bypasses.
5. Blaxel documents first-class non-root sandbox workloads while its root sandbox API retains mount/network duties. We will use `USER`, `BL_SANDBOX_USER_ENABLED=true`, and immutable image ownership, then adversarially verify that agent processes cannot reach root API capabilities or identity tokens.
6. Blaxel deployment OpenTelemetry defaults on and may include inputs/outputs/steps. ABL private workloads must explicitly set `BL_ENABLE_OPENTELEMETRY=false`, `DO_NOT_TRACK=1`, `TELEMETRY_ENABLED=false`, and the sandbox API disable flag where applicable; custom metrics are content-free.
7. Agents Hosting has a 15-minute maximum invocation and retains only five revisions. Persistent bodies and games therefore use named Sandboxes/arena Sandboxes; Agents Hosting is limited to bounded interfaces. ABL maintains its own immutable release artifacts beyond platform revision retention.
8. Blaxel quota tiers depend on trailing 30-day real-fund top-ups. Capacity and 2x headroom cannot be presumed or purchased without the user's material-spend approval. The load harness and manifests will be prepared locally; reservations and paid capacity remain gated.
9. The current Application API describes Applications as always public. Therefore `abl-core` and `abl-private` cannot use Applications without violating their prohibited-public-access rules. Their bounded HTTP/MCP services use authenticated private Agents/MCP Hosting; bodies and arenas use Sandboxes; the spectator UI uses an Application. The public projection API uses a public Agent because Blaxel Agents support both public HTTP access and regional persistent volumes. It is pinned with `minScale: 1`, `maxScale: 1` as the single file-chain writer. The 15-minute Agents Hosting limit is acceptable only for bounded requests, never persistent bodies or games.
10. Drizzle ORM `0.45.2` publishes declarations for optional Gel/MySQL/SingleStore drivers that do not typecheck under TypeScript `6.0.3`, including missing optional peer types and exact-optional incompatibilities. Fastify's transitive `thread-stream` declaration also references a worker-thread type absent from the pinned Node declaration set. The affected database and Fastify application packages set `skipLibCheck: true` only for dependency declarations; all ABL source and tests retain every strict compiler option. PostgreSQL and HTTP behavior are separately checked through migration, integration, and request-injection tests.
11. Current Blaxel CLI `bl push` packages source, builds the container image in Blaxel, and stores it without creating a workload. A local Docker daemon is therefore not a staging prerequisite. The repository-root image project passes `bl deploy --dryrun --type sandbox`; the remaining proof is the authoritative remote build and adversarial execution in the unavailable `abl-competition` workspace.

## Official source verification

| Source               | Verified fact                                                                                     | URL                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Blaxel docs index    | Current product and API documentation index                                                       | https://docs.blaxel.ai/llms.txt                                |
| Agent Drive Overview | Private preview, `us-was-1`, workspace-token/`blfs` risk                                          | https://docs.blaxel.ai/Agent-drive/Overview                    |
| Drive Permissions    | Label/path rules exist in current docs; default is workspace-open                                 | https://docs.blaxel.ai/Agent-drive/Permissions                 |
| Sandbox Proxy        | Preview, recreation on policy change, automatic local/private bypass                              | https://docs.blaxel.ai/Sandboxes/Proxy                         |
| Domain Filtering     | Proxy-variable dependent; routing enforcement planned                                             | https://docs.blaxel.ai/Sandboxes/Proxy-domains                 |
| Non-root workloads   | Root infrastructure API with workload privilege drop                                              | https://docs.blaxel.ai/Sandboxes/Non-root-user                 |
| Data/privacy         | Deployed OpenTelemetry default and independent opt-outs                                           | https://docs.blaxel.ai/Security/Data-collection-and-privacy    |
| Workspaces           | Multi-workspace account model and SDK creation                                                    | https://docs.blaxel.ai/Security/Workspace-access-control       |
| Quotas               | Shared account quotas and real-fund tier requirements                                             | https://docs.blaxel.ai/Security/Quotas                         |
| Agents Hosting       | 15-minute limit and five retained revisions                                                       | https://docs.blaxel.ai/Agents/Deploy-an-agent                  |
| Agent volumes        | Public Agents may attach persistent regional volumes that survive redeployment                    | https://docs.blaxel.ai/Agents/Volumes                          |
| Sandbox Images       | Custom Sandbox images use a Dockerfile plus Sandbox API and may be built in Blaxel                | https://docs.blaxel.ai/Sandboxes/Templates                     |
| Blaxel image push    | `bl push` builds and stores an image without creating or updating a workload                      | https://docs.blaxel.ai/cli-reference/commands/bl_push          |
| Node.js              | Node `24.18.0` is a 24 LTS release dated 2026-06-23                                               | https://nodejs.org/en/blog/release/v24.18.0                    |
| NBA rules            | Official rulebook index exposes Rules 1-14 and comments                                           | https://official.nba.com/rulebook/                             |
| NBPA CBA             | 2023 agreement effective 2023-07-01 through 2029-30 subject to opt-out                            | https://nbpa.com/cba/                                          |
| NBA cap              | Approved Court Credit numbers match the official 2026-27 announcement                             | https://www.nba.com/news/nba-salary-cap-2026-27-season         |
| Neon recovery        | Instant restore/snapshots preserve stable application connection behavior with documented caveats | https://neon.com/docs/ai/ai-database-versioning                |
| Base networks        | Base Sepolia chain ID `84532`; public RPC is rate-limited and not production                      | https://docs.base.org/base-chain/quickstart/connecting-to-base |

## Pin and hash record

- Approved implementation plan: `sha256:9bc695db70c60f271bc4be9dab56742c0afb07538c17021ad45ff720b79cbfe5`
- Goal objective: `sha256:88067fd834205b4660fe1e55dd7108c8fd6228edce2cae45dc772f08aa1b71f2`
- Official 2023 NBA-NBPA CBA PDF (676 pages): `sha256:bf178ca0f2d64f9dfe6fde095d3ae43d576b12e19ce7a679618d632584f7ab32`
- Node 24.18.0 Linux x64 tar.xz: `sha256:55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742`
- Node 24.18.0 Linux arm64 tar.xz: `sha256:58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6`
- Node 24.18.0 source tar.xz: `sha256:e94afde24db08e0c564ee7110a2d5aab51ee0059382c9fd8233c54eec47b28f9`
- Node upstream `SHASUMS256.txt`: `sha256:3927bab574a00ca0560c9583fe19655ba19603a1c5851414e4325d34ac50e469`
- pnpm 11.21.0 package integrity: `sha512-UhcFvOaJkk6scvWjWHEi82JonvZXHlW6gAdv1jfBETLs/62ib61Op5xIW/3b/T1aKlsFgFp36JPeceyKbMo7sQ==`
- Turborepo 2.10.9 package integrity: `sha512-Yl9+ukxH+UmPtKidpDkjn82tvPoEvFNb9UACd9vUomN1Ft0cwl3rx0P8yC1D93W9EOsWRMjllvIDG8y25sFOog==`
- Solidity compiler 0.8.36 package integrity: `sha512-cnDhjWo8dC5FxnEwCrWxUsJS7RPsHf+pVUe9Tr/+b15sQ40WCVn4vX4R+tOvN5gRfEgiquvFzfF4VV0kSnknhw==`
- `@blaxel/core` 0.3.11 package integrity: `sha512-vkFMd3jVbC4zz8BQ5LuVw4BcK1KVVIgQTeHTG/1cGu9CAeaHined1WP68XRoxksXC+zGmCnMv619IuMGjQhkDw==`

The pnpm lockfile and OCI digests become the authoritative dependency/image hash record after installation and image build. Documentation snapshots are referenced and hashed without redistributing protected NBA/NBPA prose.

The retrieved-byte manifest is `docs/evidence/source-locks.json`. Framework choices were checked against the current official Next.js 16 installation guide, Fastify v5 full-JSON-schema requirement, Zod 4 native JSON Schema exporter, Drizzle Postgres serializable transaction API, Vitest projects guidance, Playwright Node 24 support, and viem EIP-712 utilities.
