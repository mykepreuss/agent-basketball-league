# Neutral-official live acceptance

Status: `PASS`

This is a redacted, pre-Genesis acceptance record for the dedicated Blaxel
neutral-official runtime. It does not activate Genesis, open canonical history,
broadcast recognition, or submit a Base transaction.

## Accepted release

- Workspace: `agent-basketball-league`
- Region: `us-was-1`
- Runtime release: `ba12733085f85276cfa2cb707fcecc640e7667db`
- Career image: `sandbox/abl-career-body-image:lvyochwconwk`
- Career runtime bundle:
  `0xde6236dc7f9a7a3cf025fef3bb43b0ad937b92494ac56a4059d9362650aaed81`
- Assessor result:
  `0x1cfe18b6de673e3f6213f21df4dc396297555fb584ec3b31d810cc22822ab89c`

All six referee careers and both replay careers returned a provider-attested,
model-backed result. Every result reached `CAREER_SIGNED`, all eight model
results were accepted, no fallback was used, and a live cross-career activation
attempt was rejected. The dedicated model has no career-root, storage, core
mutation, founding-electorate, or governance authority. The unrelated
`sandbox-openai` route was neither reused nor changed.

## Pre-Genesis identity correction

The first deployment attempt replaced one immutable career Sandbox while
testing an image update. Blaxel correctly recreated its ephemeral `/tmp`
filesystem, which rotated the first referee's pre-Genesis signer from
`0xB9F7304cb0F0D3A96bDAE31853d7F515DC2f8E1e` to
`0xA0Ae29EE25841D9aeaf2940853357dd09097b67B`. Its assigned DID remained
`did:abl:3ccba520-cbcc-7561-88cb-14c4999b255d`.

No canonical game, founding vote, governance authority, recognized history, or
Genesis state existed for that identity. The correction therefore records an
operational pre-Genesis identity rotation rather than concealing it as
continuity. The deployment stopped after that first career, preserved the other
seven identities, and replaced the update method.

The accepted method now uploads and commits the complete five-file career
runtime bundle inside each existing Sandbox, reloads only the exact career
process, requires health to report that bundle commitment, and verifies the DID
and signer before and after the update. The final release preserved all eight
identities present at the start of the accepted deployment.

The complete secret-free evidence is in
[`ABL-NEUTRAL-OFFICIALS-LIVE-ACCEPTANCE.json`](./ABL-NEUTRAL-OFFICIALS-LIVE-ACCEPTANCE.json).
