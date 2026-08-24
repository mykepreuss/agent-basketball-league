import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assessPersistentSoak } from "../packages/launch/src/index.js";

if (process.argv.length !== 4)
  throw new Error(
    "Usage: assess-persistent-soak <monitoring-policy.json> <live-soak-evidence.json>",
  );

const [policy, evidence] = await Promise.all(
  process.argv
    .slice(2)
    .map(async (inputPath) =>
      JSON.parse(await readFile(resolve(inputPath), "utf8")),
    ),
);
const result = assessPersistentSoak(policy, evidence);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
