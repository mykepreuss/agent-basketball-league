import { FilePublicProjectionRepository } from "@abl/projections";

import { createPublicApi } from "./server.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

const projectionRoot = process.env.ABL_PUBLIC_PROJECTION_ROOT;
const projections =
  projectionRoot === undefined
    ? undefined
    : new FilePublicProjectionRepository(projectionRoot);
if (projections !== undefined) await projections.initialize();

void createPublicApi({ ...(projections === undefined ? {} : { projections }) })
  .listen({ port, host })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
