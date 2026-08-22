# Inactive untrusted-code profile

This directory preserves the advanced kernel and network containment work for a
future, separately authorized experiment that executes participant-supplied
untrusted code. It is not part of the ABL Founding Alpha deployment set, is not
recursively applied with any active workspace directory, and must never be
enabled by the normal launch workflow.

Founding Alpha runs only reviewed, immutable ABL body images. Its active body
manifest uses Blaxel's standard Sandbox domain allowlist and token-protected
preview authentication without custom iptables, loopback credential proxies,
custom certificate authorities, or provider credential interception.

The preserved implementation inputs are:

- `../../sandbox/abl-sandbox-init`
- `../../sandbox/agent-runtime`
- `../../sandbox/abl-init-diagnostics.mjs`
- `../../sandbox/abl-provider-credential-guard.mjs`

The active root `Dockerfile` does not copy or execute those files. It uses
`abl-reviewed-body-init` and `reviewed-agent-runtime` instead.
