import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareNeutralOfficialDeployment } from "../packages/launch/src/index.js";

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

if (process.argv.length !== 4)
  throw new Error(
    "Usage: prepare-neutral-official-deployment <external-input.json> <new-external-output.json>",
  );

const repositoryRoot = await realpath(
  resolve(fileURLToPath(new URL("..", import.meta.url))),
);
const inputPath = await realpath(resolve(process.argv[2]!));
const outputPath = resolve(process.argv[3]!);
const outputParent = await realpath(dirname(outputPath));
if (isWithin(repositoryRoot, inputPath) || isWithin(repositoryRoot, outputPath))
  throw new Error(
    "Neutral-official preparation artifacts must remain external",
  );
if (((await stat(inputPath)).mode & 0o777) !== 0o600)
  throw new Error("Neutral-official preparation input must use mode 0600");
if (
  !outputPath.startsWith("/private/tmp/abl-neutral-official-") ||
  outputParent !== "/private/tmp"
)
  throw new Error(
    "Neutral-official preparation output must be a direct /private/tmp/abl-neutral-official-* file",
  );

const input = JSON.parse(await readFile(inputPath, "utf8"));
const packet = prepareNeutralOfficialDeployment(input);
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
  flag: "wx",
});
process.stdout.write(
  `${JSON.stringify({ status: "PREPARED", packetDigest: packet.packetDigest, officialCareers: packet.officials.length })}\n`,
);
