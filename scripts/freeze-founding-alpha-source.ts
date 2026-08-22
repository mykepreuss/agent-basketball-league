import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoots = [
  "apps",
  "contracts",
  "infra/blaxel",
  "infra/sandbox",
  "packages",
  "scripts",
  "skills",
] as const;
const sourceFiles = [
  ".blaxelignore",
  ".node-version",
  ".npmrc",
  ".nvmrc",
  "Dockerfile",
  "blaxel.toml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.tools.json",
  "turbo.json",
] as const;
const ignoredNames = new Set([
  ".DS_Store",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const ignoredPaths = new Set(["apps/private-broker"]);

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

function digest(content: string | Uint8Array): `0x${string}` {
  return `0x${createHash("sha256").update(content).digest("hex")}`;
}

async function collect(path: string): Promise<string[]> {
  const normalized = normalizePath(path);
  if (ignoredPaths.has(normalized)) return [];
  const absolutePath = join(repositoryRoot, path);
  const info = await lstat(absolutePath);
  if (info.isFile()) return [normalized];
  if (!info.isDirectory())
    throw new Error(`Unsupported source-freeze input: ${normalized}`);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (ignoredNames.has(entry.name)) continue;
    files.push(...(await collect(join(path, entry.name))));
  }
  return files;
}

export async function freezeFoundingAlphaSource() {
  const paths = (
    await Promise.all([...sourceRoots, ...sourceFiles].map(collect))
  )
    .flat()
    .sort();
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: digest(await readFile(join(repositoryRoot, path))),
    })),
  );
  const implementationSourceDigest = digest(
    files.map(({ path, sha256 }) => `${path}\0${sha256}`).join("\n"),
  );
  const launchPlanDigest = digest(
    await readFile(join(repositoryRoot, "docs/launch/LAUNCH_PLAN.md")),
  );
  const imageSources = JSON.parse(
    await readFile(
      join(
        repositoryRoot,
        "infra/blaxel/founding-alpha-private/image-sources.json",
      ),
      "utf8",
    ),
  ) as { imageSetDigest?: unknown; bodyProgramArchive?: { sha256?: unknown } };
  if (
    typeof imageSources.imageSetDigest !== "string" ||
    typeof imageSources.bodyProgramArchive?.sha256 !== "string"
  )
    throw new Error("Founding Alpha image-source evidence is incomplete");
  return {
    baselineCommit: "943fb734e43f880d86eb352e7aacf795d44914d5",
    implementationSourceDigest,
    implementationFileCount: files.length,
    launchPlanDigest,
    imageSetDigest: imageSources.imageSetDigest,
    bodyProgramArchiveDigest: imageSources.bodyProgramArchive.sha256,
    sourceRoots,
    sourceFiles,
    exclusions: {
      names: [...ignoredNames].sort(),
      paths: [...ignoredPaths].sort(),
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  freezeFoundingAlphaSource()
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
