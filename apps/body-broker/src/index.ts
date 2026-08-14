import { readFileSync } from "node:fs";

import { createBodyBroker, type BrokerRoute } from "./server.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function secretFile(name: string): Uint8Array {
  const path = required(name);
  return new Uint8Array(readFileSync(path));
}

const routes: BrokerRoute[] = [
  {
    name: "core",
    targetOrigin: required("ABL_CORE_ORIGIN"),
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/commands"],
    capability: "core:command",
  },
  {
    name: "model",
    targetOrigin: required("ABL_MODEL_ORIGIN"),
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/responses"],
    capability: "model:invoke",
    credential: {
      header: "authorization",
      value: `Bearer ${readFileSync(required("ABL_MODEL_CREDENTIAL_FILE"), "utf8").trim()}`,
    },
  },
  {
    name: "private-storage",
    targetOrigin: required("ABL_PRIVATE_ORIGIN"),
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/ciphertext"],
    capability: "private:ciphertext",
  },
];

const domainId = required("ABL_PERSONAL_DOMAIN_ID");
const app = createBodyBroker({
  agentDid: required("ABL_AGENT_DID"),
  serviceIdentity: {
    serviceId: required("ABL_SERVICE_ID"),
    secret: secretFile("ABL_SERVICE_CREDENTIAL_FILE"),
    capabilities: new Set(routes.map((route) => route.capability)),
  },
  routes,
  storageDomainKeys: new Map([[domainId, secretFile("ABL_DOMAIN_KEY_FILE")]]),
});

await app.listen({ host: "127.0.0.1", port: 7777 });
