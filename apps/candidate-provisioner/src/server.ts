import { CandidateIntakeError, type CandidateProvisioner } from "@abl/launch";
import Fastify, { type FastifyInstance } from "fastify";

export const CANDIDATE_PROVISIONER_ROUTE_CATALOG = [
  ["GET", "/healthz"],
  ["POST", "/internal/v1/candidates/:applicationId/provision"],
] as const;

export function createCandidateProvisionerServer(input: {
  provisioner: CandidateProvisioner;
  authorizationToken: string;
}): FastifyInstance {
  if (Buffer.byteLength(input.authorizationToken) < 32)
    throw new Error("Provisioner authorization token is too short");
  const app = Fastify({ logger: false, bodyLimit: 8_192 });

  app.get("/healthz", async () => ({
    ok: true,
    controlPlaneMode: "DRY_RUN",
    canonicalAuthority: false,
  }));
  app.post<{ Params: { applicationId: string } }>(
    "/internal/v1/candidates/:applicationId/provision",
    async (request, reply) => {
      if (
        request.headers.authorization !== `Bearer ${input.authorizationToken}`
      )
        return reply.code(404).send({ error: "not_found" });
      try {
        return await input.provisioner.process(request.params.applicationId);
      } catch (error) {
        if (error instanceof CandidateIntakeError)
          return reply
            .code(400)
            .send({ error: "candidate_provisioning_rejected" });
        throw error;
      }
    },
  );
  return app;
}
