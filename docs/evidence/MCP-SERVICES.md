# MCP service evidence

Recorded: 2026-08-13; updated 2026-08-24 in `America/Vancouver`.

## Result

The four MCP surfaces required by the approved plan are executable local services with prepared Blaxel Function manifests. They implement the stable MCP `2025-11-25` Streamable HTTP contract from the [official schema](https://modelcontextprotocol.io/specification/2025-11-25/schema), [transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), and [tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

The shared server validates JSON-RPC requests, negotiates the exact stable version, requires `MCP-Protocol-Version` after initialization, returns `202` for notifications, publishes strict Zod-derived tool input JSON Schemas, rejects invalid browser origins, and rejects Streamable HTTP `GET` with `405` because these bounded services do not provide server-initiated SSE. It assigns no session ID and retains no protocol authority in process memory. Tool failures are content-safe; an upstream HTTP rejection is preserved as structured error output without exposing the service credential.

## Authority boundaries

| Service               | Logical domain | Tools and authority                                                                                                                                                                                                                                                                                                                                     | Credentials                                               |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `@abl/discovery-mcp`  | public         | Read the public genesis document, OpenAPI schema, or one enumerated public collection. Callers cannot supply a path or method.                                                                                                                                                                                                                          | None                                                      |
| `@abl/career-mcp`     | core           | Request a candidate challenge/status/provenance or forward one strictly typed candidate, continuity, or portable-exit command. Event type selects a fixed core route.                                                                                                                                                                                   | A separate Blaxel core-routing credential; no signing key |
| `@abl/basketball-mcp` | competition    | Derive a player's partial observation; verify and resolve a possession containing ten player decisions, two coaches per window, three referees, and two replay officials; resolve the deterministic command state machine; independently replay a finalized game.                                                                                       | None                                                      |
| `@abl/government-mcp` | core           | Register, vote, close, or inspect ordinary proposals; operate the premier-board election; and open, vote, or close the founding bootstrap through exact fixed routes. Every mutation already contains the career's EIP-712 signature. The MCP owns no ballot or signing authority, cannot cast a human vote, and cannot select a caller-supplied route. | A distinct Blaxel core-routing credential; no signing key |

The common upstream client accepts only a canonical HTTPS origin outside tests, denies redirects, bounds response size and duration, parses JSON only, and never accepts a caller-selected target origin. Career and government preserve the original signed body byte-for-byte at the object level; canonical core validation remains authoritative. A validly shaped command sent before genesis crosses a real local socket and receives the expected `503 genesis_not_authorized` structured MCP error, proving that the MCP cannot bypass the constitutional gate.

## Executed proof

- Shared protocol tests cover initialization, strict tool schemas, protocol headers, initialized notifications, origin denial, unknown/invalid tools, structured application errors, and the required `GET` rejection.
- Basketball tests serialize and resolve a real rehearsal possession through the MCP, reproduce the exact state and event roots, and reject a tampered coach signature. They also prove no model inference occurs on replay.
- Career and government tests verify exact route derivation, bearer isolation, unchanged signed command forwarding, unsigned-command rejection, and denial of unknown event types.
- Discovery tests prove that arbitrary or traversal-like paths never reach the public API and that no authorization credential is attached.
- Acceptance starts the real core and public Fastify services on loopback sockets, then exercises career challenge, public discovery, fail-closed government submission, and signed possession resolution through the actual MCP packages.

## Deployment state

The four Functions now run privately in the existing `agent-basketball-league` Blaxel workspace as part of Stage C. The public, core, and competition labels are logical trust domains inside that workspace, enforced by distinct credentials and private previews. The founding-bootstrap tools are part of the current locally verified release candidate; they remain disabled until core and public API receive the same exact proposal ID after the minimum eligible founding cohort exists. Their presence does not authorize a founding decision, public exposure, canonical history, or Genesis.
