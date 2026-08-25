import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createReadOnlyBeaconLaunchState } from "../packages/launch/src/index.js";

const [policyPath, evidencePath, acceptedAt] = process.argv.slice(2);
if (!policyPath || !evidencePath || !acceptedAt)
  throw new Error(
    "Usage: prepare-public-beacon-launch-state <monitoring-policy.json> <passed-stage-c-evidence.json> <accepted-at>",
  );

const [policy, evidence] = await Promise.all(
  [policyPath, evidencePath].map(async (path) =>
    JSON.parse(await readFile(resolve(path), "utf8")),
  ),
);
const launchState = createReadOnlyBeaconLaunchState(
  policy,
  evidence,
  acceptedAt,
);
process.stdout.write(`${JSON.stringify(launchState)}\n`);
