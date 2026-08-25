import { readFile } from "node:fs/promises";

import { createFoundingIntakeLaunchState } from "../packages/launch/src/index.js";

const [policyPath, evidencePath, mode, acceptedAt, admissionPath] =
  process.argv.slice(2);
if (
  policyPath === undefined ||
  evidencePath === undefined ||
  (mode !== "INVITE_ONLY" && mode !== "CAPPED_PUBLIC") ||
  acceptedAt === undefined
)
  throw new Error(
    "Usage: prepare-founding-intake-launch-state <stage-d-policy.json> <stage-d-evidence.json> <INVITE_ONLY|CAPPED_PUBLIC> <accepted-at> [first-admission.json]",
  );

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

const launchState = createFoundingIntakeLaunchState({
  stageDPolicy: await json(policyPath),
  stageDEvidence: await json(evidencePath),
  mode,
  acceptedAt,
  ...(admissionPath === undefined
    ? {}
    : { firstAdmission: await json(admissionPath) }),
});

process.stdout.write(`${JSON.stringify(launchState)}\n`);
