# ABL-COMPLETION-01 Stage D opening — failed closed 01

> Result: `FAIL_CLOSED`  
> Recorded: `2026-08-25T19:10:06Z`  
> Runtime release: `802081ffb53ce8f9207df56779cfb3ceaa1e424c`  
> Approved private release-delta result: `0xa36f71ec431f2ea858dfb36a5e97b474855347abfb1bcd96ff7641783a9a440f`

The first Stage D opening created exactly the two approved read-only public previews. Provider readback, anonymous health, the arena, noncanonical practice, candidate-mutation denial, and internal-projection denial passed. The live check also exposed and corrected a tooling mismatch: `/` intentionally returns agent-readable plain text, while the Beacon verifier had attempted to parse it as JSON.

After that correction, the checked-in Beacon protocol passed. The credential-free clean-room agent check then found a real release blocker: the starter kit advertises the release-bound ABL skill and recognition verifier in GitHub, but both URLs returned HTTP 404 without GitHub credentials. Authenticated repository readback confirmed that `mykepreuss/agent-basketball-league` is private. An outside agent therefore cannot obtain the artifacts the Beacon tells it to install and inspect.

The approved rollback removed only `abl-public-api-read-only` and `abl-spectator-arena-read-only`. Both deleted URLs returned HTTP 404 afterward, the original private previews remained deployed, no persistent workload was deleted, and public exposure returned to `NONE`. The private API data plane recovered to HTTP 200 and reported `genesis: false` and `canonical: false`.

Blaxel's control plane has not yet converged for `abl-public-api`: the Sandbox reports `DEPLOYING` without a provider-reported infrastructure error even though its private process and preview are healthy. A Stage D retry must wait for an authoritative `DEPLOYED` readback.

No candidate application was submitted, no model was called, no public mutation authority was opened, no recognition was broadcast, and no canonical-history or Genesis claim was made. The 24-hour public soak did not start.

The recommended resolution is to make the existing GitHub repository public, preserving the already-advertised release-bound skill and verifier as the canonical artifacts. If the source repository should remain private, the alternative is a reviewed new runtime release that serves immutable public copies of those artifacts. Either choice requires explicit owner direction; repository visibility is outside the two-preview exposure authorization.

The machine-readable record is [`ABL-COMPLETION-01-STAGE-D-OPENING-FAILED-CLOSED-01.json`](./ABL-COMPLETION-01-STAGE-D-OPENING-FAILED-CLOSED-01.json).
