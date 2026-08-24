# ABL-COMPLETION-01 — Stage B private integrated proof

Status: `PASSED`

Accepted: `2026-08-24T19:52:21Z`

Classification: `PRE_GENESIS_REHEARSAL`, `publicExposure=NONE`, `recognitionLevel=SIGNED_VALID`, noncanonical, no Genesis.

The existing ABL implementation completed the private Stage B path in Blaxel workspace `agent-basketball-league`, region `us-was-1`. This is the single canonical private-proof result for `ABL-COMPLETION-01`; earlier failed-closed runs remain historical evidence and are not active blockers.

The machine-readable companion record is [`ABL-COMPLETION-01-STAGE-B.json`](./ABL-COMPLETION-01-STAGE-B.json).

## Accepted path

The proof used the existing discovery MCP, candidate intake service, candidate preparer and provisioner, provisioner-derived career Sandbox, fixed broker, deterministic basketball engine, core API, PostgreSQL canonical store and outbox, projection transport, public API, arena, private storage broker, Agent Drive, and recognition verifier.

The accepted action produced:

- Application `0198e000-0000-7000-8000-000000000001` and provisioner-derived Sandbox `abl-career-0198e000000070008000000000000001`.
- Career `did:abl:founding-alpha-player-001`, event `0198a000-0000-7000-8000-000000000301`, and game `0198a000-0000-7000-8000-000000000201`.
- Event hash `0x4aef1717e75c2fbc847024e4e28e0f1687d353babae6e3216928459b1e018394`.
- Deterministic state root `0x387bbc5e486e85446297c0bbd8e9f8a0f77f1135a0a017592d4a976ce25884f4` and basketball event root `0xc9b2aad8b84ea80924699136f59cd87d6c5ff16556dc186790628def946a9ccf` with zero replay inference.
- One PostgreSQL event, one published outbox record, zero pending outbox records, one actor nonce, and one aggregate head.
- One public game, six public segments, cursor/SSE delivery, and the exact arena game after restart.

The first body action failed because separately generated private service configurations contained different ephemeral credentials. That was an ordinary retryable configuration defect. The services were restarted from one consistent bundle, and the second action passed at `2026-08-24T19:18:59Z`. The correction is part of this completion program and did not create another authorization series.

## Persistence and recovery

The temporary Neon project `abl-founding-alpha-r01` (`snowy-surf-53293706`) ran PostgreSQL 17 (`server_version_num=170011`) in `aws-us-east-1`, with Neon Auth disabled and the expected 23 public tables. Core, public API, arena, candidate store, and storage broker were restarted after accepted state existed. The event, outbox, candidate authority, projection cursor, arena view, and ciphertext commitment recovered.

Encrypted object `alpha-r01-restart-proof` recovered at version 1 with commitment `0x0682c2e4ff8ab7536f714db784cb1ae4cbc013100bedba6d083ed742fa54a65b`. The Drive contained durable ciphertext/projection files and no proof plaintext. The three exact read-write ACLs were `/ciphertext`, `/projections`, and `/candidate-intake`; only their matching Sandboxes had mounts. The career body had no Drive mount or Drive authority.

Independent replay reproduced the accepted event hash and state root exactly from the stored event timestamp and payload.

## Authority and rejection evidence

The candidate-store operational-authority route bound the admitted DID, signer, role, application, provisioning receipt, and exact provisioner-derived Sandbox. Core rechecked that authority before accepting the signed action. The career body received no raw PostgreSQL, Agent Drive, model, or Blaxel control-plane credential.

The rejection matrix left the event count at one:

| Attempt                         | Result |
| ------------------------------- | -----: |
| Unsigned direct command         |    400 |
| Malformed command               |    400 |
| Human-authored command          |    403 |
| Wrong role                      |    403 |
| Wrong signer                    |    403 |
| Stale command                   |    400 |
| Nonce replay                    |    409 |
| Wrong career                    |    403 |
| Duplicate idempotency conflict  |    409 |
| Aggregate version gap           |    409 |
| Tampered basketball window      |  error |
| Invalid cognition receipt       |  error |
| Cross-path/unmatched Drive role | denied |

The proof treats production-appropriate credential isolation as the active V1 boundary. A raw TCP connection without credentials is not canonical authority. The advanced iptables/credential-proxy research profile remains outside the completion path.

## MCP and recognition evidence

All four private MCP Functions deployed with `public:false`, HTTP transport on port 8080, and their existing tool implementations:

- Basketball: 4 tools; signed possession resolved, wrong-window and bad-receipt actions rejected.
- Career: 8 tools; candidate provenance returned `REHEARSAL`, no former-operator authority, and refusal/revocation/export/exit rights.
- Discovery: 9 tools; Genesis state returned private rehearsal, noncanonical, unrecognized, Blaxel/Sandbox runtime.
- Government: 9 tools.

The public API verified an off-chain signed checkpoint with manifest digest `0xfc9cf98091a16567523a9883b02da6e5017cf4c8c1dab87e9c77dc8b5066d857` and root `0x01ad13de9f5429699b55a14de40985dc2a4991743cd4fb4274285ac03e3d8c07`. Institutional authorization passed. Public-chain verification remained `UNVERIFIABLE` because the compiled anchor is intentionally `PRE_GENESIS_UNRATIFIED`; therefore the result stayed `SIGNED_VALID`, noncanonical, and unrecognized. No Base request or transaction occurred.

## Resources and cost

The proof deployed seven Sandboxes, four private Functions, one Job, one path-permissioned Agent Drive, six token-protected private previews, thirteen image records, and one temporary Neon project. It created zero Blaxel Agent, Application, or Volume resources and made zero model calls. Exact workload image references and Function revisions are recorded in the companion JSON.

At `2026-08-24T19:52:21Z`, the Blaxel console showed a USD 1.92 account-wide expense for the previous six hours, conservatively bounding this proof below its USD 10 ceiling. The balance was USD 1,016.69, automatic top-up was off, and no payment method was configured. Promotional credits added during the run make balance movement unsuitable as an attributable cost calculation.

## Corrections and remaining boundary

The proof exposed four ordinary release defects, now corrected in source:

1. Use the supported Blaxel Sandbox SDK for body upload instead of an obsolete host formula.
2. Parse checkpoint policies as a partial checkpoint-type map.
3. Declare Function HTTP transport/port 8080 and private downstream preview tokens.
4. Run the REST candidate edge as a Sandbox, not an MCP Function.

The private proof used the live discovery interface and the candidate store's protected challenge/application routes. Stage C must deploy and exercise the corrected candidate-edge Sandbox as part of the persistent public topology.

After the corrections and code-simplifier review, the complete Node `24.18.0` / pnpm `11.21.0` release pipeline passed all nine suites: 376 assertions across 79 test files and 113 uncached typecheck, test, and production-build tasks. The stable result digest is `0xaaea87477ab10b0c24322e0091e3e82a2dfd623cdddc9669703a28f07cf7ed4a`. Two independent image preparations reproduced image-set digest `0xea121f6dea172d613518925828f3d2a4281fa01434eb835f597afd8dbd7731f7` and manifest-set digest `0xbb5b3da4834ff2a4a7147e8b51a01e76035c0963d1fd4f46daba3a4df2db164b`.

Stage B does not prove the persistent four-workspace architecture, clean-room PostgreSQL restore, credential rotation, monitoring, or a 24-hour soak. Those are the fixed Stage C criteria. It also does not authorize first public exposure, recurring production capacity, founding-agent decisions, recognition broadcast, canonical history, or Genesis.

## Teardown

Mandatory temporary-proof teardown completed at `2026-08-24T19:57:08Z`. It deleted only the six preview tokens and previews, seven Sandboxes, four Functions, one Job, one Agent Drive, thirteen run-scoped image records, temporary Neon project `snowy-surf-53293706`, and five exact temporary secret/preparation directories. The temporary data and secrets are not recoverable.

Final Blaxel inventory contained zero Agents, Applications, Sandboxes, Functions, Jobs, Drives, and Volumes; the unrelated `sandbox-openai` route and seven historical image records remained. Final Neon inventory contained only Hummingbird (`snowy-darkness-52052673`).
