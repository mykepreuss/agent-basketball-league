import { PostgresCanonicalStore } from "@abl/database";
import {
  FilePublicProjectionRepository,
  PublicProjectionWorker,
} from "@abl/projections";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import { createCoreApi, createLiveCoreApi } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const AdmittedAgentsSchema = z.record(
  z.string().startsWith("did:"),
  z.strictObject({
    signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    allowedAggregateTypes: z.array(z.literal("game-possession")).length(1),
  }),
);

function rehearsalAuthority(): {
  domain: TypedDataDomain;
  admittedAgents: Map<
    string,
    { signerAddress: `0x${string}`; allowedAggregateTypes: string[] }
  >;
} {
  const chainId = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .parse(required("ABL_DOMAIN_CHAIN_ID"));
  const verifyingContract = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .parse(required("ABL_DOMAIN_VERIFYING_CONTRACT")) as `0x${string}`;
  const admitted = AdmittedAgentsSchema.parse(
    JSON.parse(required("ABL_ADMITTED_AGENTS_JSON")),
  );
  return {
    domain: {
      name: "ABL Recognition",
      version: "1",
      chainId,
      verifyingContract,
    },
    admittedAgents: new Map(
      Object.entries(admitted).map(([did, authority]) => [
        did,
        {
          signerAddress: authority.signerAddress as `0x${string}`,
          allowedAggregateTypes: authority.allowedAggregateTypes,
        },
      ]),
    ),
  };
}

const rehearsal = process.env.ABL_REHEARSAL_MODE === "1";
let closeStore: (() => Promise<void>) | undefined;
let projectionTimer: NodeJS.Timeout | undefined;
const app = rehearsal
  ? await (async () => {
      const authority = rehearsalAuthority();
      const store = new PostgresCanonicalStore(required("DATABASE_URL"));
      closeStore = async () => store.close();
      const projections = new FilePublicProjectionRepository(
        required("ABL_PUBLIC_PROJECTION_ROOT"),
      );
      await projections.initialize();
      const worker = new PublicProjectionWorker({
        store,
        writer: projections,
        ...authority,
      });
      projectionTimer = setInterval(() => {
        void worker
          .drain()
          .catch((error: unknown) =>
            process.stderr.write(
              `Projection worker: ${error instanceof Error ? error.message : String(error)}\n`,
            ),
          );
      }, 250);
      projectionTimer.unref();
      return createLiveCoreApi({
        store,
        ...authority,
        competitionId: required("ABL_COMPETITION_ID"),
        seasonId: required("ABL_SEASON_ID"),
      });
    })()
  : createCoreApi();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    if (projectionTimer !== undefined) clearInterval(projectionTimer);
    await Promise.allSettled([
      app.close(),
      closeStore?.() ?? Promise.resolve(),
    ]);
    process.exit(0);
  });
}

void app.listen({ port, host }).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
