import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import { parse, stringify } from "yaml";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRootPath = realpath(repositoryRoot);
const placeholderPattern = /^\$\{([A-Z][A-Z0-9_]*)\}$/;
const partialPlaceholderPattern = /\$\{[A-Z][A-Z0-9_]*\}/;

interface Manifest {
  apiVersion: string;
  kind: "Function" | "Job" | "Sandbox";
  metadata: { name: string; labels?: Record<string, string> };
  spec: unknown;
}

function digest(contents: string): `0x${string}` {
  return `0x${createHash("sha256").update(contents).digest("hex")}`;
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

async function requireExternalExistingFile(path: string): Promise<string> {
  const resolved = await realpath(resolve(path));
  if (isWithin(await repositoryRootPath, resolved))
    throw new Error("Founding Alpha resolution inputs must remain external");
  if (!(await stat(resolved)).isFile())
    throw new Error(`Expected an external file: ${path}`);
  return resolved;
}

async function externalOutputPath(path: string): Promise<string> {
  const requested = resolve(path);
  const parent = await realpath(dirname(requested));
  const output = join(parent, basename(requested));
  if (isWithin(await repositoryRootPath, output))
    throw new Error("Resolved manifests must remain outside the repository");
  return output;
}

function decodeEnvironmentValue(value: string, lineNumber: number): string {
  if (value.startsWith('"')) {
    if (!value.endsWith('"'))
      throw new Error(
        `Unterminated quoted value on environment line ${lineNumber}`,
      );
    try {
      const decoded = JSON.parse(value) as unknown;
      if (typeof decoded !== "string") throw new Error("not a string");
      return decoded;
    } catch {
      throw new Error(
        `Invalid double-quoted value on environment line ${lineNumber}`,
      );
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'"))
      throw new Error(
        `Unterminated quoted value on environment line ${lineNumber}`,
      );
    return value.slice(1, -1);
  }
  return value;
}

export function parseExternalEnvironment(
  contents: string,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const [index, sourceLine] of contents.split(/\r?\n/u).entries()) {
    const line = sourceLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match === null)
      throw new Error(`Invalid environment assignment on line ${index + 1}`);
    const [, name, encodedValue] = match;
    if (values.has(name!))
      throw new Error(`Duplicate environment value: ${name}`);
    const value = decodeEnvironmentValue(encodedValue!, index + 1);
    if (value === "") throw new Error(`Empty environment value: ${name}`);
    values.set(name!, value);
  }
  return values;
}

function resolvePlaceholders(
  value: unknown,
  environment: ReadonlyMap<string, string>,
  used: Set<string>,
): unknown {
  if (typeof value === "string") {
    const match = placeholderPattern.exec(value);
    if (match !== null) {
      const name = match[1]!;
      const replacement = environment.get(name);
      if (replacement === undefined)
        throw new Error(`Missing manifest environment value: ${name}`);
      used.add(name);
      return replacement;
    }
    if (partialPlaceholderPattern.test(value))
      throw new Error(`Partial manifest placeholder is prohibited: ${value}`);
    return value;
  }
  if (Array.isArray(value))
    return value.map((entry) => resolvePlaceholders(entry, environment, used));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        resolvePlaceholders(entry, environment, used),
      ]),
    );
  return value;
}

function parseManifest(contents: string): Manifest {
  const manifest = parse(contents) as Partial<Manifest>;
  if (
    manifest.apiVersion !== "blaxel.ai/v1alpha1" ||
    !["Function", "Job", "Sandbox"].includes(String(manifest.kind)) ||
    manifest.metadata?.name === undefined ||
    manifest.spec === undefined
  )
    throw new Error("Invalid rendered Founding Alpha manifest");
  if (!/^abl-(?:alpha-r01-|career-)[a-z0-9-]+$/u.test(manifest.metadata.name))
    throw new Error("Manifest is outside the Founding Alpha resource envelope");
  if (manifest.metadata.labels?.["abl-run"] !== "founding-alpha-r01")
    throw new Error("Manifest is missing the Founding Alpha run label");
  return manifest as Manifest;
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export async function resolveFoundingAlphaManifest(
  manifestPath: string,
  environmentPath: string,
  outputPath: string,
) {
  const manifestFile = await requireExternalExistingFile(manifestPath);
  const environmentFile = await requireExternalExistingFile(environmentPath);
  const environmentMode = (await stat(environmentFile)).mode & 0o777;
  if (environmentMode !== 0o600)
    throw new Error("External environment file must use mode 0600");
  const outputRoot = await externalOutputPath(outputPath);

  const source = await readFile(manifestFile, "utf8");
  const manifest = parseManifest(source);
  if (basename(manifestFile) !== `${manifest.metadata.name}.yaml`)
    throw new Error(
      "Rendered manifest filename does not match its resource name",
    );
  const environment = parseExternalEnvironment(
    await readFile(environmentFile, "utf8"),
  );
  const used = new Set<string>();
  const resolved = resolvePlaceholders(manifest, environment, used) as Manifest;
  const contents = stringify(resolved, { lineWidth: 100 });
  await mkdir(outputRoot, { mode: 0o700 });
  const resolvedPath = join(outputRoot, basename(manifestFile));
  await writePrivateFile(resolvedPath, contents);

  const receipt = {
    status: "RESOLVED_EXTERNAL_VALUES_REDACTED",
    kind: manifest.kind,
    name: manifest.metadata.name,
    sourceDigest: digest(source),
    resolvedDigest: digest(contents),
    environmentNames: [...used].sort(),
    resolvedPath,
  } as const;
  await writePrivateFile(
    join(outputRoot, "manifest-resolution-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , manifestPath, environmentPath, outputPath] = process.argv;
  if (
    manifestPath === undefined ||
    environmentPath === undefined ||
    outputPath === undefined ||
    process.argv.length !== 5
  ) {
    process.stderr.write(
      "Usage: pnpm founding-alpha:resolve-manifest <external-rendered-manifest> <external-env-file> <new-external-output-directory>\n",
    );
    process.exitCode = 1;
  } else {
    resolveFoundingAlphaManifest(manifestPath, environmentPath, outputPath)
      .then((receipt) =>
        process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`),
      )
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      });
  }
}
