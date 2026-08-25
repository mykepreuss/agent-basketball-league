import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { assessPrivateReleaseDelta } from "../packages/launch/src/index.js";

if (![6, 7].includes(process.argv.length))
  throw new Error(
    "Usage: assess-private-release-delta <monitoring-policy.json> <deployment-map.json> <stage-c-evidence.json> <release-delta-evidence.json> [owner-acceptance.json]",
  );

const [
  policyPath,
  deploymentMapPath,
  stageCEvidencePath,
  deltaEvidencePath,
  ownerAcceptancePath,
] = process.argv.slice(2).map((inputPath) => resolve(inputPath)) as [
  string,
  string,
  string,
  string,
  string | undefined,
];
if (((await stat(deltaEvidencePath)).mode & 0o777) !== 0o600)
  throw new Error(
    `Release-delta evidence input must use mode 0600: ${deltaEvidencePath}`,
  );

const [policy, deploymentMap, stageCEvidence, deltaEvidence, ownerAcceptance] =
  await Promise.all(
    [
      policyPath,
      deploymentMapPath,
      stageCEvidencePath,
      deltaEvidencePath,
      ownerAcceptancePath,
    ].map(async (inputPath) =>
      inputPath === undefined
        ? undefined
        : JSON.parse(await readFile(inputPath, "utf8")),
    ),
  );
const result = assessPrivateReleaseDelta(
  policy,
  deploymentMap,
  stageCEvidence,
  deltaEvidence,
  ownerAcceptance,
);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
