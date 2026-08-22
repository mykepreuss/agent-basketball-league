import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveLaunchLedger } from "../packages/launch/src/index.js";
import { format } from "prettier";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(
  repositoryRoot,
  "docs/launch/launch-ledger.source.json",
);
const outputPath = join(repositoryRoot, "docs/evidence/launch-ledger.json");
const sha256Pattern = /^0x[0-9a-f]{64}$/;
const ignoredDirectoryNames = new Set([
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

interface EvidenceSource {
  evidenceId: string;
  source:
    | { type: "FILE_SHA256"; path: string }
    | { type: "DIRECTORY_SHA256"; path: string }
    | {
        type: "JSON_FIELD";
        path: string;
        field: string;
        statusField: string;
        statusValue: string;
      };
  verification: "PASSED" | "LIVE_PROOF_REQUIRED" | "FAILED";
}

function digest(value: string | Buffer): `0x${string}` {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function repositoryPath(candidate: unknown): string {
  if (typeof candidate !== "string" || candidate.length === 0)
    throw new Error("Evidence path must be a non-empty string");
  const resolved = resolve(repositoryRoot, candidate);
  const relativePath = relative(repositoryRoot, resolved);
  if (relativePath.startsWith("..") || relativePath === "")
    throw new Error(`Evidence path is outside the repository: ${candidate}`);
  return resolved;
}

async function directoryDigest(path: string): Promise<`0x${string}`> {
  const entries: Array<{ path: string; digest: `0x${string}` }> = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectoryNames.has(entry.name))
        await walk(absolutePath);
      else if (entry.isFile())
        entries.push({
          path: relative(path, absolutePath),
          digest: digest(await readFile(absolutePath)),
        });
    }
  }
  await walk(path);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return digest(JSON.stringify(entries));
}

function evidenceSource(candidate: unknown): EvidenceSource {
  if (candidate === null || typeof candidate !== "object")
    throw new Error("Launch-ledger evidence entry must be an object");
  const entry = candidate as Record<string, unknown>;
  if (
    typeof entry.evidenceId !== "string" ||
    !["PASSED", "LIVE_PROOF_REQUIRED", "FAILED"].includes(
      String(entry.verification),
    ) ||
    entry.source === null ||
    typeof entry.source !== "object"
  )
    throw new Error("Invalid launch-ledger evidence entry");
  const source = entry.source as Record<string, unknown>;
  const allowedKeys =
    source.type === "JSON_FIELD"
      ? ["field", "path", "statusField", "statusValue", "type"]
      : ["path", "type"];
  if (
    !["FILE_SHA256", "DIRECTORY_SHA256", "JSON_FIELD"].includes(
      String(source.type),
    ) ||
    Object.keys(source).some((key) => !allowedKeys.includes(key)) ||
    typeof source.path !== "string" ||
    (source.type === "JSON_FIELD" &&
      (typeof source.field !== "string" ||
        typeof source.statusField !== "string" ||
        typeof source.statusValue !== "string"))
  )
    throw new Error(`Invalid evidence source for ${entry.evidenceId}`);
  return entry as unknown as EvidenceSource;
}

async function resolveEvidence(entry: EvidenceSource) {
  const path = repositoryPath(entry.source.path);
  let evidenceDigest: string;
  if (entry.source.type === "FILE_SHA256")
    evidenceDigest = digest(await readFile(path));
  else if (entry.source.type === "DIRECTORY_SHA256")
    evidenceDigest = await directoryDigest(path);
  else {
    const document = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    if (document[entry.source.statusField] !== entry.source.statusValue)
      throw new Error(
        `${entry.source.path}#${entry.source.statusField} does not equal ${entry.source.statusValue}`,
      );
    evidenceDigest = String(document[entry.source.field] ?? "");
    if (!sha256Pattern.test(evidenceDigest))
      throw new Error(
        `${entry.source.path}#${entry.source.field} is not a SHA-256 digest`,
      );
  }
  return {
    evidenceId: entry.evidenceId,
    digest: evidenceDigest,
    verification: entry.verification,
  };
}

export async function generateLaunchLedger(): Promise<string> {
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as Record<
    string,
    unknown
  >;
  if ("ready" in source)
    throw new Error("Launch-ledger source cannot assert readiness");
  if (!Array.isArray(source.evidence))
    throw new Error("Launch-ledger source evidence must be an array");
  const evidence = await Promise.all(
    source.evidence.map((entry) => resolveEvidence(evidenceSource(entry))),
  );
  const { $schema: _schema, ...input } = source;
  const ledger = deriveLaunchLedger({ ...input, evidence });
  const output = await format(JSON.stringify(ledger), { parser: "json" });
  await writeFile(outputPath, output, { mode: 0o600 });
  return ledger.ledgerDigest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateLaunchLedger()
    .then((ledgerDigest) => process.stdout.write(`${ledgerDigest}\n`))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
