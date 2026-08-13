import { ServiceRequestVerifier } from "@abl/foundation";
import {
  FilePublicProjectionRepository,
  verifyProjectionEvent,
} from "@abl/projections";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import { createPublicApi, type PublicApiOptions } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function secret(name: string): Uint8Array {
  const encoded = required(name);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new Error(`${name} is not canonical base64`);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength < 32)
    throw new Error(`${name} must contain at least 256 bits`);
  return decoded;
}

const AgentRegistrySchema = z.record(
  z.string().startsWith("did:"),
  z.strictObject({
    signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    allowedAggregateTypes: z.array(z.literal("game-possession")).length(1),
  }),
);

function projectionAuthority(): {
  domain: TypedDataDomain;
  admittedAgents: Map<
    string,
    { signerAddress: `0x${string}`; allowedAggregateTypes: string[] }
  >;
} {
  const registry = AgentRegistrySchema.parse(
    JSON.parse(required("ABL_PROJECTION_VERIFY_KEY_REGISTRY")),
  );
  return {
    domain: {
      name: "ABL Recognition",
      version: "1",
      chainId: z.coerce
        .number()
        .int()
        .positive()
        .safe()
        .parse(required("ABL_DOMAIN_CHAIN_ID")),
      verifyingContract: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .parse(required("ABL_DOMAIN_VERIFYING_CONTRACT")) as `0x${string}`,
    },
    admittedAgents: new Map(
      Object.entries(registry).map(([did, authority]) => [
        did,
        {
          signerAddress: authority.signerAddress as `0x${string}`,
          allowedAggregateTypes: authority.allowedAggregateTypes,
        },
      ]),
    ),
  };
}

const projectionRoot = process.env.ABL_PUBLIC_PROJECTION_ROOT;
let authority: ReturnType<typeof projectionAuthority> | undefined;
let projections: FilePublicProjectionRepository | undefined;
if (projectionRoot !== undefined) {
  const runtimeAuthority = projectionAuthority();
  authority = runtimeAuthority;
  projections = new FilePublicProjectionRepository(projectionRoot, {
    verifyAuthorization: async (authorization, projectedAt) =>
      (
        await verifyProjectionEvent(
          authorization,
          runtimeAuthority,
          () => new Date(projectedAt),
        )
      ).projection,
  });
}
if (projections !== undefined) await projections.initialize();

let projectionIngress: PublicApiOptions["projectionIngress"];
if (projections !== undefined && authority !== undefined) {
  projectionIngress = {
    writer: projections,
    verifier: new ServiceRequestVerifier([
      {
        serviceId: required("ABL_PROJECTION_INGEST_SERVICE_ID"),
        secret: secret("ABL_PROJECTION_INGEST_HMAC_BASE64"),
        capabilities: new Set(["projection:append"]),
      },
    ]),
    ...authority,
  };
}

const apiOptions: PublicApiOptions = {};
if (projections !== undefined) apiOptions.projections = projections;
if (projectionIngress !== undefined)
  apiOptions.projectionIngress = projectionIngress;

void createPublicApi(apiOptions)
  .listen({ port, host })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
