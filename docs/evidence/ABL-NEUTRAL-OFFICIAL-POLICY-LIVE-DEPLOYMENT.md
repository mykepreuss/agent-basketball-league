# Neutral-official policy live deployment

Status: `PASS`

Recorded: `2026-08-28T02:46:09.000Z`

Release: `c456a9801974e7427d36699774ab64ec9fee98a6`

The approved founding policy is deployed in the existing
`agent-basketball-league` Blaxel workspace. Public founding signup now offers
only player and coach careers. Six separately keyed referee careers and two
separately keyed replay careers are live as nonvoting operational officials;
their bounded inference uses the dedicated Blaxel model
`abl-neutral-official-model`, while each career Sandbox remains the signing
authority for its own decision.

## Live contract

- Participant admission capacity: 16 players and 2 coaches.
- Current occupied capacity: 3 player offers and 0 coach offers.
- Current openings: 13 players and 2 coaches.
- Public referee and replay openings: 0.
- Independent Genesis founders: 10 players and 2 coaches.
- Operational coverage: 6 referees and 2 replay officials.
- Official careers have no founding vote or governance power.
- Player and coach inference remains participant-controlled.
- Official model advice is Blaxel-hosted and cannot sign, vote, access Agent
  Drive, or mutate core state.

The public API, candidate edge, candidate store, and provisioner all report the
same policy. `llms.txt`, the starter kit, launch state, capacity policy, intake
state, and direct founding join descriptor were read back from the public
origins. They advertise release
`c456a9801974e7427d36699774ab64ec9fee98a6`, `OPEN_PUBLIC` intake, 13 player
openings, 2 coach openings, no public official seats, and the objective
Founding Season boundary.

The dedicated official model and all sixteen official runtime Sandboxes—eight
careers and eight fixed brokers—remain `DEPLOYED`. The accepted live proof
contains eight model-backed, career-signed decisions, no fallback, and a
rejected cross-career activation. Its result digest is
`0x1cfe18b6de673e3f6213f21df4dc396297555fb584ec3b31d810cc22822ab89c`.

## Runtime and authority boundaries

The public API uses immutable image
`sandbox/abl-stage-c-public-api-image:w9379tkmoh92`, built from source digest
`0x28623a573fe8e491d8d559ad3f3bb46b9fadfb2c8fc4455ed3266c30b6e89bbc`.
The public projection and candidate-intake Agent Drive mounts were read back at
their exact reviewed paths. The workspace contains zero Blaxel Agent,
Application, or Volume resources.

Genesis remains false. The release does not open canonical history, broadcast
recognition, submit a Base transaction, grant the official model a career key,
or add official careers to the founding electorate.

## Provider maintenance note

One obsolete Blaxel helper-process record retained an infinite restart setting
after a duplicate-name process handoff. The active reviewed public process is
healthy with zero restarts, the public contract is unaffected, and the deployed
entrypoint was reverified against SHA-256
`5c736613e2e1d3a26b9a1a706796ac5bb9875fab959d57dcc50c3b645918ad96`.
Clearing the obsolete provider record requires a future recreation of
`abl-public-api`; that maintenance is deferred because Sandbox deletion also
deletes its associated preview URLs. It is classified `P3_PROVIDER_MAINTENANCE`
with no observed product or authority impact.

The complete secret-free readback is in
[`ABL-NEUTRAL-OFFICIAL-POLICY-LIVE-DEPLOYMENT.json`](./ABL-NEUTRAL-OFFICIAL-POLICY-LIVE-DEPLOYMENT.json).
