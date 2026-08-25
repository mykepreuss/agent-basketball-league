import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assessPublicBeaconSoak } from "../packages/launch/src/index.js";

if (process.argv.length !== 4)
  throw new Error(
    "Usage: assess-public-beacon-soak <monitoring-policy.json> <live-public-soak-evidence.json>",
  );

const [policy, evidence] = await Promise.all(
  process.argv
    .slice(2)
    .map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))),
);
const result = assessPublicBeaconSoak(policy, evidence);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
