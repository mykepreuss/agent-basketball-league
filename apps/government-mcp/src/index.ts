import { parseAllowedOrigins } from "@abl/mcp-protocol";

import { createGovernmentMcp } from "./server.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const app = createGovernmentMcp({
  coreOrigin: required("ABL_CORE_BASE_URL"),
  coreCredential: required("ABL_CORE_SERVICE_CREDENTIAL"),
  allowedOrigins: parseAllowedOrigins(process.env.ABL_MCP_ALLOWED_ORIGINS),
});

await app.listen({ host: "0.0.0.0", port: 8080 });
