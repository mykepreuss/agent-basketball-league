import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assessPersistentSoakHandoff } from "../packages/launch/src/index.js";

if (![4, 5].includes(process.argv.length))
  throw new Error(
    "Usage: assess-persistent-soak-handoff <monitoring-policy.json> <live-soak-evidence.json> [owner-acceptance.json]",
  );

const paths = process.argv.slice(2).map((inputPath) => resolve(inputPath));
const [policy, evidence, ownerAcceptance] = await Promise.all(
  paths.map(async (inputPath) => JSON.parse(await readFile(inputPath, "utf8"))),
);
const result = assessPersistentSoakHandoff(policy, evidence, ownerAcceptance);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "ACCEPTED") process.exitCode = 1;
