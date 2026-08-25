# Stage C experimental-launch acceptance

Status: `OWNER_ACCEPTED_EXPERIMENTAL_LAUNCH`

This record preserves the Stage C R04 technical result as `FAIL` while accepting its bounded evidence for the experimental ABL launch. It is not a claim that the original continuous 24-hour criterion passed.

## Observed result

- Release: `ad73a9ff151ac5599ad90e581114ebf179d9e848`
- Observation: 13.502821666666666 hours and 242 samples per required service
- Privacy: no public exposure and no recorded secret value
- Incidents: no P0/P1, privacy breach, replay divergence, unrecoverable restart, or unbounded-cost event
- Service failures: one Government MCP timeout; the focused initialize and `tools/list` follow-up passed
- Recovery: one signed `PRE_GENESIS_EXPERIMENT` event and one private outbox record reproduced on an exact Neon child branch with equal state roots; the branch was deleted
- Database: PostgreSQL 17 project `shy-pine-00200479`, 23 public tables, direct TLS, only the primary branch retained
- Final Blaxel readback: seven deployed Sandboxes, four deployed private MCP servers, two Jobs, three Agent Drives, zero Agents, Applications, or Volumes
- Cost controls: USD 21.9084 projected monthly cost, USD 9.51 conservative account-balance movement since the Stage C preflight, USD 1006.76 balance, and automatic top-up off

The technical assessor reported only the shortened-duration blocker and the eleven sampling-gap blockers caused by the local monitor interruption. Its result digest is `0xe19241f61b25b35c04f8b7069567951996a8e00636f801bcecf742065bacdfa9`.

During preparation, an invalid local parsing attempt printed a recovery-only database credential into transient tool output. The credential was immediately rotated, its old value was proved rejected, the retained recovery credential was replaced, and the clean recovery proof was rerun without exposure. No application or canonical-write credential was exposed, and no secret is present in the committed evidence artifacts.

The bounded owner acceptance binds that exact result and is independently validated by `pnpm stage-c:assess-handoff`. Its acceptance digest is `0x8ac1b9641d954b7758b01d68e0e7d87cc8234c4c2f7ebaa88ec4878657cda7b6`; the accepted handoff result digest is `0xda632bdd17b1f34d0b689a0526e08234d5a1ed77f50028172019a68c68abf4c1`.

## Limits

The exception can cover only a minimum 12-hour observation, a maximum 1800-second local sampling gap, and at most one service failure. It cannot waive a privacy, cost, recovery, replay, public-ingress, canonical-history, Genesis, or secret-recording failure. The required follow-ups are a focused Government MCP health check—which passed—and live public monitoring with rollback after first-public-exposure approval.

This acceptance permits the private merged-release handoff. It does not authorize public exposure, candidate mutation, model calls, recognition broadcast, canonical history, founding-agent decisions, or Genesis.
