import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { composePublicBeaconSoakEvidence } from "../packages/launch/src/index.js";

if (process.argv.length !== 7)
  throw new Error(
    "Usage: finalize-public-beacon-soak <monitoring-policy.json> <samples.json> <checks.json> <metrics.json> <new-output.json>",
  );

const [policyPath, samplesPath, checksPath, metricsPath, outputPath] =
  process.argv.slice(2).map((inputPath) => resolve(inputPath)) as [
    string,
    string,
    string,
    string,
    string,
  ];
for (const inputPath of [samplesPath, checksPath, metricsPath]) {
  if (((await stat(inputPath)).mode & 0o777) !== 0o600)
    throw new Error(`Evidence input must use mode 0600: ${inputPath}`);
}

const [policy, samples, checks, metrics] = await Promise.all(
  [policyPath, samplesPath, checksPath, metricsPath].map(async (inputPath) =>
    JSON.parse(await readFile(inputPath, "utf8")),
  ),
);
const evidence = composePublicBeaconSoakEvidence({
  policy,
  samples,
  checks,
  metrics,
});
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `${JSON.stringify({
    status: "FINALIZED",
    releaseId: evidence.releaseId,
    startedAt: evidence.startedAt,
    endedAt: evidence.endedAt,
    surfaceCount: evidence.surfaces.length,
    credentialsUsed: false,
    secretValuesPrinted: false,
  })}\n`,
);
