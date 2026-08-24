# ABL-COMPLETION-01 Stage C provider preflight

Status: `READ_ONLY_PASS_EXECUTION_APPROVAL_AND_CLI_LOGIN_REQUIRED`

Recorded: `2026-08-24T20:55:03Z`

Observed repository commit: `eecdeba378b240e05092cc60df68ace6a1d72f46`

Authority boundary: this is a read-only provider observation and cost calculation. It is not execution authority and did not create, modify, or delete any Blaxel, Neon, billing, credential, or application resource.

## Result

The Stage C topology fits the currently observed Blaxel and Neon capacity. The target workspace and database-project names are absent, exactly three Blaxel workspace slots remain for the three planned workspaces, automatic top-up is unconfigured/off, the balance is well above the USD 5 floor, and the declared private topology projects to USD 21.9084/month under the checked-in usage caps.

Provider execution remains blocked on two explicit handoffs:

1. approval for the persistent workspaces and recurring-capacity envelope; and
2. interactive refresh of the expired local Blaxel CLI session before the first mutation.

The browser console and Neon connector were authenticated for this inspection. No login, token rotation, secret retrieval, or provider mutation was attempted.

## Blaxel observation

The signed-in Blaxel console reported:

- workspaces: `agent-basketball-league` and unrelated `marketing` only;
- target workspaces `abl-private`, `abl-core`, and `abl-public`: absent;
- workspace quota: 2 of 5 used, leaving exactly three slots;
- Tier 6, with 10,000 global Sandboxes, 20,000 private-preview URLs, 500 MCP servers, 500 Jobs, and 32,768 MiB per instance;
- `agent-basketball-league`: zero Sandboxes, Volumes, Agent Drives, Jobs, MCP servers, custom domains, and policies; seven historical images and one existing model API route remain untouched;
- balance: USD 1,016.27;
- automatic top-up: unconfigured/off; monthly top-up: unconfigured; payment method: none configured; low-balance alert: USD 5; and
- `us-was-1` remains an available North Virginia region, while Agent Drive and private-preview support remain available for the planned topology.

The local `bl` CLI is version `0.1.108`. Its cached OAuth credential now returns `401 Unauthorized`; provider mutation must not begin until an interactive `bl login agent-basketball-league` refresh succeeds and the same inventory is rechecked.

## Neon observation

The signed-in Neon connector reported organization `org-billowing-wind-64503405` on the Free plan. Only the unrelated Hummingbird project `snowy-darkness-52052673` exists. It is PostgreSQL 17 in `aws-us-east-1` and must remain untouched. No project named for Stage C exists.

The planned persistent project therefore fits the current Free-plan project allowance. Stage C must create it explicitly as PostgreSQL 17 in `aws-us-east-1`, keep storage at or below 0.5 GiB and compute at or below 100 CU-hours/month, and recalculate the cost before continuing if the workload requires a paid plan.

## Cost envelope

The canonical calculation is [`cost-envelope.json`](../../infra/blaxel/persistent-pre-genesis/cost-envelope.json). It uses current published rates and the actual declared memory totals: 21 GiB across seven Sandboxes, 8 GiB across four MCP services, and 6 GiB across two Jobs.

| Component                  | Monthly projection |
| -------------------------- | -----------------: |
| Sandbox active compute     |        USD 15.6492 |
| Sandbox snapshot storage   |         USD 4.2000 |
| Image storage              |         USD 0.7200 |
| MCP active compute         |         USD 1.2096 |
| Job active compute         |         USD 0.1296 |
| Agent Drive during beta    |         USD 0.0000 |
| Neon Free allowance        |         USD 0.0000 |
| **Total**                  |    **USD 21.9084** |
| **Contingency to ceiling** |     **USD 3.0916** |

The projection assumes one private probe every ten minutes, no keepalive, Blaxel's approximately 15-second automatic Sandbox standby, at most five active MCP seconds per probe, at most one aggregate Job hour monthly, no more than 21 GiB of snapshot storage, and no more than 16 GiB of image storage. Stage C acceptance replaces every projection with the greater of its declared cap or the first 24 hours of measured usage annualized to 30 days. A result above USD 25 fails only the cost criterion and does not reopen accepted private staging.

## Required next action

After recurring-capacity approval, refresh the Blaxel CLI session interactively, repeat the mutable account checks immediately before the first provider write, and stop if workspace capacity, target inventory, region, features, privacy, rates, balance, top-up state, payment state, or Neon capacity has drifted. If the checks pass, create the persistent private topology and start the single 24-hour Stage C soak described in [`STAGE_C_PERSISTENT_SERVICES.md`](../launch/STAGE_C_PERSISTENT_SERVICES.md).

## Sources

- [Blaxel pricing](https://blaxel.ai/pricing)
- [Blaxel Sandbox lifecycle](https://docs.blaxel.ai/Sandboxes/Overview)
- [Blaxel regions](https://docs.blaxel.ai/Infrastructure/Regions)
- [Blaxel CLI login](https://docs.blaxel.ai/cli-reference/commands/bl_login)
- [Neon pricing and Free allowance](https://neon.com/pricing)
