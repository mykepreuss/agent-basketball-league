import { parseAllowedOrigins } from "@abl/mcp-protocol";

import { createBasketballMcp } from "./server.js";

const app = createBasketballMcp({
  allowedOrigins: parseAllowedOrigins(process.env.ABL_MCP_ALLOWED_ORIGINS),
});

await app.listen({ host: "0.0.0.0", port: 8080 });
