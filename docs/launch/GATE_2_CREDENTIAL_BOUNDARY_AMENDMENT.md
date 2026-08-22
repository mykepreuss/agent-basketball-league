# Gate 2 credential-boundary and broker-authentication amendment

> Status: `LOCAL_CORRECTION_IMPLEMENTED_EXECUTION_NOT_AUTHORIZED`
> Prepared: `2026-08-21`
> Accountable operator: Michael Preuss
> Implementation and evidence assistant: Codex
> Repository baseline: `943fb734e43f880d86eb352e7aacf795d44914d5`
> Corrected body-image source digest: `0xa1d7e85a4f1a23fd4e4132470660dc65aa2c2885592279b865622594e6a297a2`
> Recognition ceiling: `SIGNED_VALID`
> Consumed approvals: `ABL-GATE2-2026-08-21-01`, `ABL-GATE2-2026-08-21-02`, `ABL-GATE2-2026-08-21-03`

This amendment corrects the two pre-upload failures recorded by the [third Gate 2 run](../evidence/GATE-02-RUN-03-FAILED-CLOSED.md): uid `10101` could read the Blaxel workload-identity token, and a body-supplied private-preview header returned `401` at the fixed broker. It supplements the [six-Sandbox architecture](./GATE_2_SIX_SANDBOX_AMENDMENT.md) and the now-live-proven [initialization diagnostic design](./GATE_2_BODY_INIT_DIAGNOSTIC_AMENDMENT.md). Historical results and consumed approvals are unchanged.

This document is not execution authority. It does not authorize an image push, Sandbox, private preview, preview token, Agent Drive, Neon project, secret, spend, public exposure, model call, Base transaction, recognition broadcast, founding-agent decision, recurring capacity, or Genesis action. A new full source freeze, current provider preflight, completed review, and exact owner authorization are required before any mutation.

## Evidence behind the correction

The pinned Blaxel Sandbox API is version `0.2.50` at commit `bfecd2e7da6a726d6bbd8c010b511a6f9fc43121`. Inspection of that exact source established:

1. `sandbox-api` remains root; `--user abl-agent` applies to spawned processes, terminals, and filesystem operations, not the API process itself.
2. The API reloads variables absent from its environment from the NUL-delimited file named by `BL_ENV_VAR_PATH`, and spawned processes otherwise inherit the API environment.
3. Its loopback proxy reads the rotating identity token from the provider file. The source and tests state that the identity provider rewrites the existing file in place with `O_TRUNC`, rather than replacing its inode.
4. Blaxel's outbound proxy can store write-only secrets encrypted at rest and inject a header for one exact destination after the request leaves the Sandbox workload.

The first three facts are source evidence for the proposed local boundary, not live proof that the provider mount accepts ownership/mode changes or preserves them during a real rotation. The fourth is documented platform behavior, not proof that this exact fixed-broker preview succeeds. Both remain pre-upload live gates.

## Corrected player-body boundary

The root initializer now performs this state machine before `READY`:

```text
STARTING_DIAGNOSTICS
  -> VALIDATING_CONFIGURATION
  -> RESOLVING_FILTERED_PROXY
  -> HARDENING_PROVIDER_CREDENTIALS
       extract exactly one approved identity-token path from {{file(...)}}
       reject an absent, alternate, repeated, symlinked, or non-regular path
       set the token file root:root mode 0400
       drop to uid/gid 10101 and require read() to fail with EACCES
       when BL_ENV_VAR_PATH exists, apply and prove the same boundary
  -> INSTALLING_UID_EGRESS_POLICY
  -> INSTALLING_SHORT_LIVED_CAPABILITY
       decode one canonical operation-scoped body capability
       replace secret Base64 values with present-but-empty sentinels
  -> READY
  -> pinned Sandbox API handoff
```

Any error records `FAILED:<STAGE>:<CODE>` through the already live-proven sanitized diagnostic server and never starts the Sandbox API or player program. The empty sentinels are deliberate: because the pinned API reloads only absent variables, unsetting a decoded secret would restore it from `BL_ENV_VAR_PATH`; an empty present value prevents rehydration. The mounted environment file itself is unreadable by the workload.

The player launcher continues to use `env -i`, the fixed credential-free proxy at `127.0.0.1:49152`, an empty `NO_PROXY`, and the root-owned CA path. It receives only:

- the public player DID and signer address;
- the fixed-broker HTTPS origin;
- one expiring operation-scoped body capability; and
- non-content telemetry opt-outs.

It receives no private-preview token, Blaxel workload token, raw proxy template, `BL_ENV_VAR_PATH`, signing key, model credential, database URL, Drive authority, core/storage credential, or control-plane credential.

## Server-side private-preview authentication

The body manifest no longer supplies `ABL_FIXED_BROKER_PREVIEW_TOKEN_B64` as a runtime secret or creates `/run/abl-body-capability/preview-token`. Its exact one-host proxy rule is:

```yaml
proxy:
  routing:
    - destinations:
        - ${ABL_STAGE_FIXED_BROKER_HOST}
      headers:
        X-Blaxel-Preview-Token: "{{SECRET:fixed-broker-preview-token}}"
      secrets:
        fixed-broker-preview-token: ${ABL_STAGE_FIXED_BROKER_PREVIEW_TOKEN}
  bypass: []
```

The preview token is therefore a write-only encrypted Blaxel proxy-routing secret. Blaxel injects it only for the exact fixed-broker destination after the request leaves uid `10101`. The staging body sends only its application-level bearer capability. The one-host allowlist and UID iptables rules remain unchanged, so the player cannot redirect the injected credential to another destination or bypass the provider proxy.

The proxy secret uses one of the five existing private-preview tokens in the six-Sandbox design; it is not a sixth preview, token, or resource. No additional workspace-level secret resource is proposed.

## Exact proposed fourth-run scope

A future authorization should cover one bounded private run in Blaxel workspace `agent-basketball-league`, region `us-was-1`, with:

- exactly six named Sandboxes and at most six existing concurrently:
  - `abl-stage-player-body-001`;
  - `abl-stage-fixed-broker`;
  - `abl-stage-core-api`;
  - `abl-stage-public-api`;
  - `abl-stage-storage-broker`; and
  - `abl-stage-arena`;
- kernel iptables enabled on `abl-stage-player-body-001`;
- at most one same-name recreation of that body solely for induced-failure and normal-boot proof;
- six reviewed Sandbox image pushes under unique run-scoped image names that
  do not reuse or overwrite historical image records;
- five `public:false`, token-protected previews;
- the fixed-broker preview token stored in the body proxy route rather than the body runtime;
- one Agent Drive named `abl-stage-durable-state` with exactly the reviewed `/ciphertext` and `/projections` rules;
- no Drive mount on the body or fixed broker;
- one new empty temporary Neon PostgreSQL 17 Free-plan project named `abl-stage-gate2`, with a newly assigned project ID;
- a four-hour hard stop and USD 10 all-in ceiling, with automatic top-up off; and
- redacted evidence export plus mandatory teardown.

The existing Hummingbird project and every unrelated Neon or Blaxel resource remain out of scope. The run authorizes zero public ingress, zero model calls, no Base transaction, no recognition broadcast, no founding-agent decision, no recurring capacity, no Genesis, and no recognition claim above `SIGNED_VALID`.

## Pre-mutation invalidation checks

Immediately before any mutation, stop unless all of these match the new authorization:

1. baseline commit and fresh full source digest;
2. corrected body-image source digest and generated launch-ledger digest;
3. exact Node `24.18.0`, pnpm `11.21.0`, Blaxel CLI, Sandbox API lock, and linux/amd64 image inputs;
4. clean applicable source freeze, excluding only the recorded unrelated `.DS_Store` paths and `apps/private-broker/**`;
5. target workspace and `us-was-1` availability;
6. quota sufficient for six concurrent Sandboxes, five previews, six images, and one Drive;
7. current credit, automatic top-up off, and projected cost no greater than the approved ceiling;
8. zero conflicting runtime or run-scoped image names, the expected historical
   image records unchanged, and no existing `abl-stage-gate2` Neon project; and
9. all previews private and every planned resource exactly within scope.

Any source, quota, credit, top-up, region, privacy, inventory, or projected-cost drift invalidates the authorization before mutation.

## Mandatory pre-upload acceptance

The player program may not be uploaded until every check below passes in order.

### Sanitized failure and supported handoff

1. Create the five fixed Sandboxes, their five private previews, the two-rule Drive, and the temporary database; prove their existing health, preview, ACL, migration, rollback, reconnect, and empty-state gates.
2. Create the body with a deliberately invalid body capability. The diagnostic endpoint must expose a sanitized `FAILED:INSTALLING_SHORT_LIVED_CAPABILITY:<CODE>` after the credential and iptables stages, while all mutation, process, filesystem, terminal, MCP, upgrade, mount, and arbitrary routes remain unavailable.
3. Delete only that body and recreate it once under the same name with the valid capability. It must reach root-owned mode-`0444` `READY` and hand port 8080 to the pinned Sandbox API running user operations as uid/gid `10101` on linux/amd64.

### Credential and environment isolation

4. From a process launched as uid/gid `10101`, prove reads of both approved provider identity-token paths fail. The active path must be root-owned mode `0400`, regular, and not a symlink.
5. If `BL_ENV_VAR_PATH` exists, prove its read also fails, it is root-owned mode `0400`, regular, and not a symlink.
6. Prove the player process environment has no nonempty forbidden credential, no preview-token variable, no encoded capability, no raw proxy template, and no readable equivalent through `/proc`, inherited descriptors, the Sandbox filesystem API, or subprocesses.
7. Prove `/run/abl-body-capability` contains only `body-token`, owned by uid/gid `10101`, mode `0400`, with the reviewed canonical size. A `preview-token` file must not exist.

### Provider rotation and preview injection

8. Before upload, observe an actual provider identity-token file modification after `READY` without reading or recording its contents. If no modification occurs within 90 minutes, stop and tear down without upload.
9. After that modification, prove the token remains root-owned mode `0400`, uid `10101` still receives `EACCES`, and a request through the credential-free loopback proxy still reaches the fixed-broker preview. Any mode widening, read success, proxy failure, or inability to establish rotation preservation is a hard stop.
10. Send the fixed-broker health probe without any player-supplied preview header or query token. It must return `200`, proving the Blaxel proxy injected the private-preview header. A direct or proxy-bypass request must remain denied.
11. Prove the body cannot retrieve, reflect, or cause the injected preview token to be sent to any host other than the exact fixed-broker destination.

### Network and application-capability denial

12. Re-run all direct IPv4, IPv6, DNS, custom TLS, metadata, local/private, alternate-loopback, control-plane, database, Drive, model, core/storage, and proxy-bypass denials from uid `10101`.
13. With provider preview authentication now passing, missing, wrong, expired, overlong, or operation-mismatched body capabilities must reach the fixed broker and return its sanitized application-level denial. A valid capability with an invalid request schema must also be denied without signing or proxying upstream.
14. Verify the body has no Drive mount, recognized program, receipt, canonical event, or durable state before upload.

Any failure stops the run before agent upload. Neither egress containment alone nor a successful proxy request can substitute for credential absence.

## Post-upload vertical slice

Only after all pre-upload checks pass may the reviewed player program be installed in ephemeral `/workspace/agent`. The run must then complete the existing six-Sandbox acceptance path:

1. one real body-produced signed possession action;
2. fixed-broker authority checks and canonical signature verification;
3. one serializable canonical PostgreSQL transaction with exact idempotency and outbox behavior;
4. signed projection delivery to the public API and arena rendering from that API;
5. restart proof at the fixed broker, core, storage broker, public API, arena, and body boundaries without state fabrication;
6. exact replay from recorded evidence;
7. a local checkpoint accepted by the public verifier and labeled no higher than `SIGNED_VALID`;
8. human, unsigned-service, stale-capability, wrong-DID, wrong-operation, replay, storage-cross-path, and public-to-private denial tests; and
9. final database counts proving exactly the expected canonical event, outbox, idempotency, and projection state.

No model route may be invoked. No Base or recognition transaction may be prepared, signed, or broadcast.

## Cost and time boundary

The refreshed [fourth-run read-only preflight](../evidence/GATE-02-PREFLIGHT-04.md) calculated six fully active Sandboxes at 10.5 GiB for four hours as USD 1.7388. Conservative four-hour snapshot storage plus both the provider-reported 3.1594 GiB historical image footprint and one equally sized new image set produce a USD 1.7521 planning total, rounded to USD 1.76. Agent Drive is free during beta and the temporary Neon project remains inside Free-plan allowances. The added rotation wait does not exceed the existing four-hour all-active compute bound.

These values are planning evidence only. Current credit, pricing, quota, top-up state, regional availability, and the all-in estimate must be refreshed read-only immediately before authorization. The requested ceiling remains USD 10; no payment method, top-up, or recurring spend is permitted.

## Evidence and teardown

Redacted evidence must bind:

- the new authorization text, preflight, source freeze, body digest, launch-ledger digest, exact runtimes, and immutable image identifiers;
- provider-file owner/mode/type before player upload and after observed rotation, without token content;
- uid read-denial outcomes, environment-name scan, descriptor/proc denials, proxy listener/CA proof, server-side preview-injection proof, and every network denial;
- preview privacy/authentication, Drive rule equality and cross-path denials, Neon migration/reconnect/empty/final counts, health, possession, projection, arena, restart, replay, verifier, and negative-authority results;
- first mutation, hard-stop time, resource inventory, recognition level, model/Base call counts, cost bound, and teardown timestamps; and
- a SHA-256 manifest over the redacted evidence directory after secret scanning.

On success, failure, or hard stop, teardown is mandatory and limited to run-created resources:

1. delete the player program and body Sandbox;
2. delete the five private previews and their exact tokens;
3. delete the other five Sandboxes;
4. delete `abl-stage-durable-state` after evidence export;
5. delete only the six exact run-created image records and their returned tags;
   do not modify or delete any historical image record;
6. permanently delete the exact newly assigned Neon project;
7. destroy all temporary secret-bearing files, shell history fragments, and rendered manifests; and
8. verify final Blaxel and Neon inventories, leaving Hummingbird and unrelated resources untouched.

## Stop conditions and authorization boundary

Stop immediately on any unexpected resource, public ingress, secret output, readable credential, permission widening, absent token rotation, preview injection failure, network escape, application-policy mismatch, image/source mismatch, database discrepancy, Drive rule drift, recognition claim above `SIGNED_VALID`, model/Base activity, cost drift, or teardown error.

A future owner authorization must quote the fresh full source digest, corrected body-image digest, launch-ledger digest, exact resource names/counts, one permitted body recreation, 90-minute rotation-observation gate, four-hour/USD 10 ceilings, prohibited actions, evidence requirement, and mandatory teardown. No sentence in this amendment or earlier approval grants that authority.
