import { stringify } from "yaml";

export function participantBlaxelManifest(input: {
  name: string;
  immutableImage: string;
  relayOrigin: string;
}): string {
  return stringify({
    apiVersion: "blaxel.ai/v1alpha1",
    kind: "Sandbox",
    metadata: {
      name: input.name,
      labels: {
        "abl-owned-by": "participant",
        "abl-purpose": "distributed-cognition-runner",
      },
    },
    spec: {
      enabled: true,
      region: "us-was-1",
      network: {
        allowedDomains: [new URL(input.relayOrigin).hostname],
      },
      runtime: {
        image: input.immutableImage,
        memory: 2048,
        ports: [],
        command: ["node", "/opt/abl/abl-runner.mjs", "run"],
        envs: [
          { name: "ABL_RELAY_ORIGIN", value: input.relayOrigin, secret: false },
          {
            name: "ABL_RUNNER_STORE_B64",
            value: "${ABL_RUNNER_STORE_B64}",
            secret: true,
          },
          {
            name: "ABL_RUNNER_ADAPTER",
            value: "${ABL_RUNNER_ADAPTER}",
            secret: false,
          },
        ],
      },
    },
  });
}
