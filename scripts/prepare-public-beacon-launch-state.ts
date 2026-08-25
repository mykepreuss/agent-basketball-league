import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createReadOnlyBeaconLaunchState } from "../packages/launch/src/index.js";

const [policyPath, evidencePath, acceptedAt, ownerAcceptancePath] =
  process.argv.slice(2);
if (!policyPath || !evidencePath || !acceptedAt)
  throw new Error(
    "Usage: prepare-public-beacon-launch-state <monitoring-policy.json> <stage-c-evidence.json> <accepted-at> [owner-acceptance.json]",
  );

const [policy, evidence, ownerAcceptance] = await Promise.all(
  [policyPath, evidencePath, ownerAcceptancePath].map(async (path) =>
    path === undefined
      ? undefined
      : JSON.parse(await readFile(resolve(path), "utf8")),
  ),
);
const launchState = createReadOnlyBeaconLaunchState(
  policy,
  evidence,
  acceptedAt,
  ownerAcceptance,
);
process.stdout.write(`${JSON.stringify(launchState)}\n`);
