# Gate 2 player-body initialization diagnostic amendment

> Status: `LIVE_HANDOFF_PROVED_CREDENTIAL_BOUNDARY_FAILED_NOT_EXECUTION_AUTHORITY`
> Prepared: `2026-08-21`
> Accountable operator: Michael Preuss
> Implementation and evidence assistant: Codex
> Repository baseline: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Corrected body-image source digest: `0xd035e3db3bc72e42e5753c4dd408643eb3a8a6e1f8a1ef939682450432215d2b`
> Exact-runtime result digest: `0xf42031fce5d477f0a845d46a38f72d8305ec45a667c106a84eb53b8dc12e0b5a`
> Consumed approvals: `ABL-GATE2-2026-08-21-01`, `ABL-GATE2-2026-08-21-02`, `ABL-GATE2-2026-08-21-03`

This amendment records the correction to the player-body initialization boundary exposed by the [second failed-closed Gate 2 run](../evidence/GATE-02-RUN-02-FAILED-CLOSED.md). Approval `ABL-GATE2-2026-08-21-03` live-proved its sanitized failure surface and normal `READY`/Sandbox API handoff, then exposed two later boundaries: uid `10101` could read the Blaxel workload-identity token, and the body-to-fixed-broker private-preview request returned `401`. See the [third failed-closed result](../evidence/GATE-02-RUN-03-FAILED-CLOSED.md). This document does not authorize an image push, Sandbox, preview, Agent Drive, replacement database, secret, spending, public exposure, model call, Base transaction, recognition broadcast, recurring capacity, founding-agent decision, or Genesis action. Another live run requires a new reviewed correction and exact authorization; no consumed approval may be reused.

## Failure being corrected

The six-Sandbox run correctly created the body last and refused to upload agent code without a root-owned `READY` marker. The image nevertheless started the supported Sandbox API only after configuration, proxy discovery, iptables installation, and capability-file installation. If any protected step failed, the same API needed to read the marker was absent. Blaxel returned HTTP 404 and exposed no boot logs, so the exact failing instruction could not be determined.

The correction must satisfy both requirements simultaneously:

1. every protected pre-agent stage remains externally observable; and
2. no process, filesystem, terminal, upload, or arbitrary read surface exists before the UID egress policy and short-lived capability are ready.

Starting the full privileged Sandbox API early would violate the second requirement. Logging secret-bearing environment or proxy values would also violate it.

## Corrected initialization state machine

```text
PID 1 root entrypoint
  -> write root-owned STARTING_DIAGNOSTICS marker
  -> start uid 10102 diagnostics with env -i
       GET/HEAD /abl-init-status only
       every mutation or other path denied
  -> validate nonsecret configuration and proxy presence
  -> install uid 10101 IPv4/IPv6 egress policy
  -> install short-lived body capability files
  -> write READY
  -> stop diagnostics
  -> exec pinned Sandbox API with all user operations as uid 10101
  -> operator may upload the reviewed body program

Any protected-step failure
  -> write FAILED:<STAGE>:<EXIT_CODE>
  -> keep read-only diagnostics alive
  -> never start Sandbox API or agent program
```

The diagnostic process:

- runs as dedicated uid/gid `10102`;
- receives only its fixed status-file path, port, and uid/gid through `env -i`;
- deletes its environment after startup;
- accepts only the strict nonsecret status vocabulary;
- returns `INVALID_STATUS` without echoing malformed marker content;
- sets `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`;
- has no child-process, filesystem-write, arbitrary-file, terminal, proxy, credential, or upload implementation;
- stops before the supported Sandbox API binds port 8080.

The root image has no `CMD`, so it cannot start an embedded player before the operator has observed `READY` and uploaded the reviewed ephemeral program.

## Pinned credential-proxy handoff

The corrected firewall no longer attempts to parse, resolve, or expose the raw provider proxy URL. The exact pinned Blaxel image and extracted binary were inspected and locked in [`blaxel-sandbox-api.lock.json`](../../infra/sandbox/blaxel-sandbox-api.lock.json):

| Field                    | Locked value                                                              |
| ------------------------ | ------------------------------------------------------------------------- |
| Sandbox API version      | `0.2.50`                                                                  |
| Git commit               | `bfecd2e7da6a726d6bbd8c010b511a6f9fc43121`                                |
| OCI index                | `sha256:3bbf1ce15194f5aff6557d5b48a5a7c32b17b84b9bd94000a952130e08000ccb` |
| linux/amd64 manifest     | `sha256:e62a65ee685bcb3b4396756b4a02b5cea495c3580ff135a578be8458e2db1e2d` |
| Extracted binary SHA-256 | `0c6130d53b3e4448ba120a84e5bcd71a6ae47674ed7b8d215c8e2f0a2b217076`        |
| Credential-proxy port    | `49152`                                                                   |

That Sandbox API reads the rotating workload token from its provider file, binds a credential-hiding proxy on loopback, rewrites proxy variables to the credential-free local URL, and merges the provider CA before exposing its process API. The manifest explicitly pins `SANDBOX_LOCAL_PROXY_PORT=49152`.

Root permits agent uid `10101` to open IPv4 TCP only to `127.0.0.1:49152`, rejects every other IPv4 route, and rejects all IPv6 output. The immutable launcher uses `HTTP_PROXY` and `HTTPS_PROXY` fixed to that address, clears `NO_PROXY`, and carries only the Sandbox API's root-owned `NODE_EXTRA_CA_CERTS` path. It does not inherit the raw proxy template or workload identity token. If the pinned local proxy or CA is absent, the launcher fails closed.

The platform proxy retains the one-host allowlist for the fixed-broker preview. The kernel rule prevents proxy-variable bypass; the provider proxy prevents the permitted local tuple from reaching any other destination.

The production competition examples now use the same uncredentialed body/fixed-broker split. The fixed broker supports only two explicit upstream authentication modes: private-preview tokens for bounded staging, or short-lived Blaxel service-account access tokens with a fixed workspace header for private production Agents. The body receives neither credential class.

## Local proof completed

Using the exact Node `24.18.0` runtime:

- the behavioral diagnostic suite passed status, method, route, invalid-marker, no-cache, and no-secret-echo assertions;
- broker-origin parsing, proxy-file inspection, the local diagnostic probe, and capability decoding are fail-closed; helper processes inherit no secret-bearing environment and capability inputs must be canonical Base64;
- the foundation topology suite passed 17 assertions across three files;
- the assurance suite passed nine assertions;
- the adversarial boundary suite passed nine assertions;
- shell syntax validation passed for the root init;
- five fixed-service image contexts and the body program assembled successfully;
- the corrected body-image source digest includes the diagnostic server source;
- all five fixed-service contexts and the repository-root body image passed `bl deploy --dryrun` without creating resources.
- the full exact-Node evidence pipeline passed 298 unit/integration assertions in 67 files, 30 acceptance/adversarial/load/browser assertions in six files, 42/42 type-check tasks, 42/42 test tasks, and 29/29 build tasks.

The security-focused diff review additionally removed secret-bearing environment inheritance from all bootstrap helper processes, replaced permissive string matching with bare-HTTPS-origin parsing, rejected empty proxy-file values, required canonical Base64 capabilities, reconciled the production body manifest with the separate fixed broker, and limited broker upstream authentication to private-preview or short-lived workspace-bound Blaxel access tokens. The third live run proved the diagnostic and API-handoff behavior but invalidated the stronger credential-absence claim: an arbitrary uid-10101 process could read the provider workload-identity token. It also showed that the installed private-preview token did not authenticate the proxied fixed-broker request. Those findings are unresolved and supersede the earlier local-only conclusion.

These checks prove the local source shape and diagnostic behavior. They do not prove that Blaxel routes port 8080 to diagnostics during boot, that kernel iptables accepts the exact rules, that the pinned credential proxy binds after handoff, or that direct/proxy-bypass attempts fail in the live microVM.

## Mandatory live acceptance for a future run

Before body-program upload:

1. `GET /abl-init-status` must return a strict nonsecret stage from diagnostics while initialization is in progress.
2. `POST /abl-init-status`, `/process`, `/filesystem/*`, terminal, MCP, upgrade, mount, and arbitrary paths must be unavailable during diagnostics.
3. An induced pre-API failure must leave `FAILED:<STAGE>:<CODE>` readable until teardown without logging any secret.
4. A normal boot must hand port 8080 to the authenticated Sandbox API only after `READY`.
5. The body must have no image `CMD`, uploaded program, Drive/Volume mount, long-lived credential, signing key, model credential, database URL, or control-plane token.
6. The agent process must see only the credential-free loopback proxy and CA path, never the raw provider proxy template or workload token.
7. Direct IPv4/IPv6, DNS, custom TLS, private/local/metadata, Sandbox API, core, storage, model, PostgreSQL, Drive, and control-plane routes must fail from uid 10101.
8. Only a valid CONNECT through the pinned local proxy to the fixed-broker host may succeed.
9. Missing proxy configuration, a mismatched proxy port, missing CA, an invalid capability, or any iptables failure must stop before agent upload.
10. The built image and running microVM must report `linux/amd64`, matching the locked manifest and extracted Sandbox API binary; any other architecture must stop the run before upload.

If these pre-upload checks pass, the future packet must still run the complete signed possession, database transaction, projection, arena, restart, replay, denial, local checkpoint, evidence, cost, and teardown requirements from the consumed six-Sandbox packet. Recognition may not exceed `SIGNED_VALID`, and no Base or recognition broadcast is implied.

## Review and authorization boundary

Required before requesting execution:

1. record a fresh final worktree/source digest immediately before the run and bind it to the corrected body digest above;
2. refresh Blaxel quota, balance, top-up, region, proxy, Drive, image, and cost facts;
3. request a new approval identifier covering the exact replacement Neon project, image pushes, six Sandboxes, five private previews, one path-permissioned Agent Drive, kernel iptables, four-hour/USD 10 ceilings, evidence export, and mandatory teardown.

Local preparation or approval of this document is not execution authority.
