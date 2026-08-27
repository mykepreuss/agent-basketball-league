import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assessNeutralOfficialAcceptance } from "../packages/launch/src/index.js";

if (process.argv.length !== 3)
  throw new Error(
    "Usage: assess-neutral-officials <neutral-official-evidence.json>",
  );

const evidencePath = resolve(process.argv[2]!);
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const result = assessNeutralOfficialAcceptance(evidence);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
