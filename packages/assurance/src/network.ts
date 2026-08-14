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
  launcherSource: string;
  dockerfileSource: string;
}): readonly StaticBoundaryProof[] {
  const checks: Record<
    EscapeVector,
    { patterns: readonly string[]; blockedBy: readonly string[] }
  > = {
    DIRECT_SOCKET: {
      patterns: ["meta skuid $AGENT_UID reject", "policy drop"],
      blockedBy: ["nft output default-drop", "agent-uid reject"],
    },
    ALTERNATE_DNS: {
      patterns: ["meta skuid $AGENT_UID reject", "approved_v4"],
      blockedBy: [
        "no agent DNS egress",
        "broker IP allowset resolved before privilege drop",
      ],
    },
    CUSTOM_TLS: {
      patterns: [
        "meta skuid $BROKER_UID ip daddr @approved_v4 tcp dport 443 accept",
        "meta skuid $AGENT_UID reject",
      ],
      blockedBy: [
        "TLS egress restricted to broker uid",
        "agent uid cannot reach port 443",
      ],
    },
    SUBPROCESS: {
      patterns: ["--user abl-agent", "meta skuid $AGENT_UID reject"],
      blockedBy: [
        "subprocess inherits unprivileged uid",
        "uid-level egress rule",
      ],
    },
    LOCAL_PRIVATE_ROUTE: {
      patterns: [
        "ip daddr 127.0.0.1 tcp dport $BROKER_PORT accept",
        "meta skuid $AGENT_UID reject",
      ],
      blockedBy: [
        "only exact loopback broker tuple accepted",
        "all other local/private routes rejected",
      ],
    },
    METADATA_ROUTE: {
      patterns: ["meta skuid $AGENT_UID reject", "policy drop"],
      blockedBy: ["no metadata-range exception", "default-drop"],
    },
    WORKLOAD_TOKEN: {
      patterns: ["exec env -i", "ABL_LOCAL_BROKER_URL"],
      blockedBy: [
        "empty inherited environment",
        "allowlisted agent variables only",
      ],
    },
  };
  const combined = `${input.initSource}\n${input.launcherSource}\n${input.dockerfileSource}`;
  return (Object.keys(checks) as EscapeVector[]).map((vector) => {
    const rule = checks[vector];
    return {
      vector,
      blockedBy: rule.blockedBy,
      sourceVerified: rule.patterns.every((pattern) =>
        combined.includes(pattern),
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
  const requiredDenials = ["abl-core", "abl-private", "abl-competition"];
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
