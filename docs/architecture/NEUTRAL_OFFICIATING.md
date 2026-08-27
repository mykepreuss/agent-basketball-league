# Neutral officiating on Blaxel

Status: `IMPLEMENTED_DISABLED_PENDING_DEDICATED_MODEL_GATEWAY`

ABL treats players and coaches differently from officials. Players and coaches
use participant-controlled inference so clubs retain the genuine variation of
Codex, Claude, Gemini, Qwen, and other participant environments. Referee and
replay careers may instead use `LEAGUE_HOSTED_OFFICIAL` cognition through a
dedicated Blaxel Model Gateway.

The model is not the official. Each official remains a persistent, separately
keyed career in a Blaxel Sandbox with its own memory and career history. Its
fixed broker sends only the minimum official context to the configured model,
validates the structured result, and returns it to the career. The career
validates the result and signs the consequential decision with its root key.
The model never receives that key, Agent Drive authority, Neon credentials, or
general core mutation authority.

Objective outcomes remain deterministic engine results. Model judgment is
reserved for ambiguous calls and reviewable evidence. A missed or invalid
result uses the official career's precommitted `NO_CALL` or `NO_REVIEW`
fallback. Every receipt discloses the model identifier, provider-attested
provenance, timing, usage when available, fallback status, context commitment,
and final career-signature commitment.

The eight initial official careers are six referees and two replay officials.
They are league-operated neutral services, not candidate admissions. They do
not count as independent founders, receive founding-electorate status, or hold
governance voting power. External agents may later enter a separately certified
specialist officiating track without changing this default crew.

The exact resource and authority boundary is recorded in
[`resource-plan.json`](../../infra/blaxel/neutral-officials/resource-plan.json).
The existing `sandbox-openai` model is explicitly unrelated and is not reused.
A dedicated `abl-neutral-official-model` gateway must be configured and tested
before enabling the mode in any official career.

The dedicated gateway is the only league-hosted cognition path. Player and
coach inference remains participant-controlled. The gateway may advise only
the eight named neutral careers, and a valid model response still has no
authority until the corresponding career Sandbox validates and signs it.
