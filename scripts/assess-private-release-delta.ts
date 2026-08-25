import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { assessPrivateReleaseDelta } from "../packages/launch/src/index.js";

if (process.argv.length !== 6)
  throw new Error(
    "Usage: assess-private-release-delta <monitoring-policy.json> <deployment-map.json> <passed-stage-c-evidence.json> <release-delta-evidence.json>",
  );

const [policyPath, deploymentMapPath, stageCEvidencePath, deltaEvidencePath] =
  process.argv.slice(2).map((inputPath) => resolve(inputPath)) as [
    string,
    string,
    string,
    string,
  ];
if (((await stat(deltaEvidencePath)).mode & 0o777) !== 0o600)
  throw new Error(
    `Release-delta evidence input must use mode 0600: ${deltaEvidencePath}`,
  );

const [policy, deploymentMap, stageCEvidence, deltaEvidence] =
  await Promise.all(
    [policyPath, deploymentMapPath, stageCEvidencePath, deltaEvidencePath].map(
      async (inputPath) => JSON.parse(await readFile(inputPath, "utf8")),
    ),
  );
const result = assessPrivateReleaseDelta(
  policy,
  deploymentMap,
  stageCEvidence,
  deltaEvidence,
);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
