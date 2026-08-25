import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { assessGenesisCompletion } from "../packages/launch/src/index.js";

if (process.argv.length !== 4)
  throw new Error(
    "Usage: assess-genesis-completion <stage-i-evidence.json> <finalized-opening-game.json>",
  );

const [evidencePath, finalizedGamePath] = process.argv
  .slice(2)
  .map((inputPath) => resolve(inputPath)) as [string, string];
const [evidence, finalizedGame] = await Promise.all(
  [evidencePath, finalizedGamePath].map(async (inputPath) =>
    JSON.parse(await readFile(inputPath, "utf8")),
  ),
);
const result = assessGenesisCompletion(evidence, finalizedGame);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
