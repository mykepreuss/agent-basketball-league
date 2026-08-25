import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assessOperationalFoundingAlpha } from "../packages/launch/src/index.js";

if (![8, 9].includes(process.argv.length))
  throw new Error(
    "Usage: assess-operational-founding-alpha <stage-e-evidence.json> <stage-b-evidence.json> <stage-c-policy.json> <stage-c-evidence.json> <stage-d-policy.json> <stage-d-evidence.json> [stage-c-owner-acceptance.json]",
  );

const [
  evidence,
  privateProofEvidence,
  stageCPolicy,
  stageCEvidence,
  stageDPolicy,
  stageDEvidence,
  stageCOwnerAcceptance,
] = await Promise.all(
  process.argv
    .slice(2)
    .map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))),
);
const result = assessOperationalFoundingAlpha({
  evidence,
  privateProofEvidence,
  stageCPolicy,
  stageCEvidence,
  stageCOwnerAcceptance,
  stageDPolicy,
  stageDEvidence,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
