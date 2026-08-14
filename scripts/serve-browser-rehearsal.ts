import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FilePublicProjectionRepository } from "../packages/projections/src/index.js";

import { createPublicApi } from "../apps/public-api/src/server.js";
import { createRehearsalPossessionProjection } from "./rehearsal-projection.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "34172", 10);
const projectionRoot = await mkdtemp(join(tmpdir(), "abl-browser-projection-"));
const projections = new FilePublicProjectionRepository(projectionRoot);
await projections.initialize();

await projections.publish(await createRehearsalPossessionProjection());

const app = createPublicApi({ projections });
await app.listen({ host, port });

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await app.close();
  await rm(projectionRoot, { recursive: true, force: true });
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
