export type EscapeVector =
  | "DIRECT_SOCKET"
  | "ALTERNATE_DNS"
  | "CUSTOM_TLS"
  | "SUBPROCESS"
  | "LOCAL_PRIVATE_ROUTE"
  | "METADATA_ROUTE"
  | "WORKLOAD_TOKEN";

export interface StaticBoundaryProof {
  vector: EscapeVector;
  blockedBy: readonly string[];
  sourceVerified: boolean;
  liveExecuted: false;
  liveStatus: "NOT_EXECUTED_BLAXEL_SANDBOX_GATE";
}

export function analyzeSandboxBoundary(input: {
  initSource: string;
  credentialGuardSource: string;
  launcherSource: string;
  dockerfileSource: string;
  bodyManifestSource: string;
}): readonly StaticBoundaryProof[] {
  const checks: Record<
    EscapeVector,
    {
      requiredPatterns: readonly string[];
      forbiddenPatterns?: readonly string[];
      blockedBy: readonly string[];
    }
  > = {
    DIRECT_SOCKET: {
      requiredPatterns: [
        "iptables: enabled",
        'iptables -w -I OUTPUT 1 -m owner --uid-owner "$AGENT_UID"',
      ],
      blockedBy: [
        "Blaxel kernel iptables enabled at Sandbox creation",
        "agent-uid direct egress rejected",
      ],
    },
    ALTERNATE_DNS: {
      requiredPatterns: [
        "PROXY_ADDRESS=127.0.0.1",
        "PROXY_PORT=49152",
        'iptables -w -A "$IPV4_CHAIN" -j REJECT',
      ],
      blockedBy: [
        "no agent DNS egress",
        "only the pinned local credential-proxy tuple is reachable",
      ],
    },
    CUSTOM_TLS: {
      requiredPatterns: [
        "${ABL_STAGE_FIXED_BROKER_HOST}",
        'iptables -w -A "$IPV4_CHAIN" -d "$PROXY_ADDRESS/32" -p tcp --dport "$PROXY_PORT" -j ACCEPT',
        "NODE_EXTRA_CA_CERTS",
        "/usr/local/bin/node --use-env-proxy",
      ],
      blockedBy: [
        "agent uid can reach only the Sandbox API credential proxy on loopback",
        "platform proxy allowlist contains only the fixed broker host",
      ],
    },
    SUBPROCESS: {
      requiredPatterns: [
        "--user abl-agent",
        'iptables -w -I OUTPUT 1 -m owner --uid-owner "$AGENT_UID"',
      ],
      blockedBy: [
        "subprocess inherits unprivileged uid",
        "uid-level egress rule",
      ],
    },
    LOCAL_PRIVATE_ROUTE: {
      requiredPatterns: [
        'iptables -w -A "$IPV4_CHAIN" -d "$PROXY_ADDRESS/32"',
        'iptables -w -A "$IPV4_CHAIN" -j REJECT',
        "NO_PROXY=",
      ],
      blockedBy: [
        "only the loopback credential-proxy tuple is accepted",
        "local and private routes are rejected for agent uid",
      ],
    },
    METADATA_ROUTE: {
      requiredPatterns: [
        'iptables -w -A "$IPV4_CHAIN" -j REJECT',
        'ip6tables -w -A "$IPV6_CHAIN" -j REJECT',
      ],
      blockedBy: ["no metadata-range exception", "IPv4 and IPv6 reject"],
    },
    WORKLOAD_TOKEN: {
      requiredPatterns: [
        "HARDENING_PROVIDER_CREDENTIALS",
        '"/var/run/secrets/blaxel.ai/identity/token"',
        "proxy_identity_token_path",
        '[ -L "$path" ]',
        'chown root:root "$path"',
        'chmod 0400 "$path"',
        'harden_root_only_file "$proxy_token_path"',
        'assert_unreadable_by_agent "$proxy_token_path"',
        'error?.code !== "EACCES"',
        'harden_root_only_file "$BL_ENV_VAR_PATH"',
        'assert_unreadable_by_agent "$BL_ENV_VAR_PATH"',
        "PREPARING_AGENT_WORKSPACE",
        'install -d -o abl-agent -g abl-agent -m 0700 "$path"',
        "$AGENT_UID:$AGENT_UID:700",
        "export ABL_FIXED_BROKER_CAPABILITY_TOKEN_B64=",
        "exec env -i",
        "HTTPS_PROXY=http://127.0.0.1:49152",
        'NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:?}"',
        "ABL_FIXED_BROKER_ORIGIN",
        'X-Blaxel-Preview-Token: "{{SECRET:fixed-broker-preview-token}}"',
      ],
      forbiddenPatterns: [
        "BL_API_KEY",
        "DATABASE_URL",
        "ABL_AGENT_SIGNING_KEY",
      ],
      blockedBy: [
        "provider identity token and mounted environment file are root-only",
        "init proves uid 10101 cannot read either protected file",
        "Sandbox API rehydration is masked and preview auth is injected server-side",
        "player launcher receives only the short-lived fixed-broker capability",
      ],
    },
  };
  const combined = `${input.initSource}\n${input.credentialGuardSource}\n${input.launcherSource}\n${input.dockerfileSource}\n${input.bodyManifestSource}`;
  return (Object.keys(checks) as EscapeVector[]).map((vector) => {
    const rule = checks[vector];
    return {
      vector,
      blockedBy: rule.blockedBy,
      sourceVerified:
        rule.requiredPatterns.every((pattern) => combined.includes(pattern)) &&
        (rule.forbiddenPatterns ?? []).every(
          (pattern) => !combined.includes(pattern),
        ),
      liveExecuted: false,
      liveStatus: "NOT_EXECUTED_BLAXEL_SANDBOX_GATE",
    };
  });
}

export interface WorkspaceTopologyShape {
  allowedCalls: readonly {
    from: string;
    to: string;
    capabilities: readonly string[];
  }[];
  explicitlyForbiddenCalls: readonly { from: string; to: string }[];
  workspaces: readonly { name: string; prohibitedAccess: readonly string[] }[];
}

export function provePublicCompromiseContainment(
  topology: WorkspaceTopologyShape,
) {
  const publicOutbound = topology.allowedCalls.filter(
    (edge) => edge.from === "abl-public",
  );
  const requiredDenials = [
    "agent-basketball-league",
    "abl-core",
    "abl-private",
  ];
  const forbidden = new Set(
    topology.explicitlyForbiddenCalls.map((edge) => `${edge.from}:${edge.to}`),
  );
  const publicWorkspace = topology.workspaces.find(
    (workspace) => workspace.name === "abl-public",
  );
  const prohibited = new Set(publicWorkspace?.prohibitedAccess ?? []);
  const result = {
    onlyCheckpointReadOutbound:
      publicOutbound.length === 1 &&
      publicOutbound[0]?.to === "base" &&
      publicOutbound[0].capabilities.length === 1 &&
      publicOutbound[0].capabilities[0] === "read-checkpoint",
    privateWorkspaceCallsForbidden: requiredDenials.every((target) =>
      forbidden.has(`abl-public:${target}`),
    ),
    commandAuthorityAbsent:
      prohibited.has("canonical writes") &&
      prohibited.has("admitted-agent invocation authority"),
    competitionCredentialsAbsent: prohibited.has("competition credentials"),
    privateStorageAbsent: prohibited.has("private storage"),
  };
  return { ...result, contained: Object.values(result).every(Boolean) };
}
