import Fastify, { type FastifyInstance } from "fastify";

import { CANDIDATE_EDGE_ROUTE_CATALOG } from "./server.js";

export interface CandidateGatewayOptions {
  storeOrigin: string;
  previewToken: string;
  fetchImplementation?: typeof fetch;
}

export function createCandidateGateway(
  options: CandidateGatewayOptions,
): FastifyInstance {
  const origin = new URL(options.storeOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  )
    throw new Error("Candidate store must be a bare HTTPS origin");
  if (
    options.previewToken.length < 32 ||
    options.previewToken.length > 4_096 ||
    /[\r\n]/.test(options.previewToken)
  )
    throw new Error("Candidate store preview token is invalid");
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const app = Fastify({ logger: false, bodyLimit: 1_200_000 });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-abl-canonical-authority", "none");
    reply.header("x-abl-genesis", "false");
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "abl-candidate-edge",
    mode: "GATEWAY",
    genesis: false,
    canonicalAuthority: false,
  }));

  for (const [method, path] of CANDIDATE_EDGE_ROUTE_CATALOG) {
    app.route({
      method,
      url: path,
      async handler(request, reply) {
        try {
          const response = await fetchImplementation(new URL(path, origin), {
            method,
            headers: {
              "x-blaxel-preview-token": options.previewToken,
              ...(method === "POST"
                ? { "content-type": "application/json" }
                : {}),
            },
            body: method === "POST" ? JSON.stringify(request.body) : null,
            redirect: "error",
            signal: AbortSignal.timeout(12_000),
          });
          const body = await response.text();
          if (Buffer.byteLength(body) > 1_500_000)
            throw new Error("Candidate store response exceeded limit");
          return reply
            .code(response.status)
            .type(response.headers.get("content-type") ?? "application/json")
            .send(body);
        } catch {
          return reply.code(503).send({
            error: "candidate_intake_temporarily_unavailable",
          });
        }
      },
    });
  }

  return app;
}
