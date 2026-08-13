import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export type Sha256Digest = `0x${string}`;

export interface FileDigest {
  path: string;
  digest: Sha256Digest;
}

export interface DigestGroup {
  digest: Sha256Digest;
  fileCount: number;
  files: readonly FileDigest[];
}

export interface GenesisArtifactDigests {
  source: DigestGroup;
  containerSource: DigestGroup;
  kernelAndRuntime: DigestGroup;
  tools: DigestGroup;
  schemas: DigestGroup;
  migrations: DigestGroup;
  testSuite: DigestGroup;
  verifier: DigestGroup;
  deploymentManifests: DigestGroup;
  publicProjection: DigestGroup;
  testResultDigest: Sha256Digest | null;
  imageDigests: readonly [];
  imageStatus: "NOT_BUILT_DOCKER_GATE";
}

const ignoredSegments = new Set([
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

export function sha256Digest(content: string | Uint8Array): Sha256Digest {
  return `0x${createHash("sha256").update(content).digest("hex")}`;
}

async function walk(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (ignoredSegments.has(entry.name)) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(root, path)));
    else if (entry.isFile()) paths.push(normalizePath(relative(root, path)));
  }
  return paths;
}

async function digestGroup(
  repositoryRoot: string,
  paths: readonly string[],
): Promise<DigestGroup> {
  const uniquePaths = [...new Set(paths)].sort();
  if (uniquePaths.length === 0) throw new Error("Digest group cannot be empty");
  const files = await Promise.all(
    uniquePaths.map(async (path) => ({
      path,
      digest: sha256Digest(await readFile(join(repositoryRoot, path))),
    })),
  );
  return {
    digest: sha256Digest(
      files.map((file) => `${file.path}\u0000${file.digest}`).join("\n"),
    ),
    fileCount: files.length,
    files,
  };
}

export async function prepareGenesisArtifactDigests(
  repositoryRoot: string,
): Promise<GenesisArtifactDigests> {
  const allFiles = await walk(repositoryRoot);
  const sourcePaths = allFiles.filter(
    (path) =>
      (/^(apps|packages)\/[^/]+\/(app|src)\//.test(path) &&
        /\.(ts|tsx)$/.test(path)) ||
      /^scripts\/.*\.ts$/.test(path) ||
      /^contracts\/.*\.sol$/.test(path),
  );
  const containerPaths = [
    "infra/sandbox/Dockerfile",
    "infra/sandbox/abl-sandbox-init",
    "infra/sandbox/agent-runtime",
    "infra/sandbox/apk-packages.lock",
  ];
  const runtimePaths = [".node-version", ".nvmrc", ".npmrc"];
  const toolPaths = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "turbo.json",
    "docs/evidence/source-locks.json",
  ];
  const schemaPaths = ["packages/schemas/src/index.ts"];
  const migrationPaths = allFiles.filter(
    (path) =>
      path.startsWith("packages/database/drizzle/") ||
      path === "packages/database/src/schema.ts" ||
      path === "packages/database/drizzle.config.ts",
  );
  const testPaths = allFiles.filter(
    (path) =>
      /(^|\/)test\/.*\.test\.(ts|tsx)$/.test(path) ||
      /^tests\/.*\.(ts|tsx)$/.test(path),
  );
  const verifierPaths = [
    "packages/recognition/src/verifier.ts",
    "packages/recognition/src/registry.ts",
    "packages/recognition/src/checkpoints.ts",
    "docs/architecture/VERIFIER_RULES.md",
    "contracts/RecognitionRegistry.sol",
  ];
  const deploymentManifestPaths = allFiles.filter(
    (path) => path.startsWith("infra/blaxel/") && /\.(json|yaml)$/.test(path),
  );
  const publicProjectionPaths = allFiles.filter((path) =>
    path.startsWith("apps/arena/app/"),
  );
  let testResultDigest: Sha256Digest | null = null;
  try {
    const result = JSON.parse(
      await readFile(
        join(repositoryRoot, "docs/evidence/final-local-results.json"),
        "utf8",
      ),
    ) as { overall?: unknown; stableResultDigest?: unknown };
    if (
      result.overall === "PASS_LOCAL_WITH_EXTERNAL_GATES" &&
      typeof result.stableResultDigest === "string" &&
      /^0x[0-9a-f]{64}$/.test(result.stableResultDigest)
    ) {
      testResultDigest = result.stableResultDigest as Sha256Digest;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  return {
    source: await digestGroup(repositoryRoot, sourcePaths),
    containerSource: await digestGroup(repositoryRoot, containerPaths),
    kernelAndRuntime: await digestGroup(repositoryRoot, runtimePaths),
    tools: await digestGroup(repositoryRoot, toolPaths),
    schemas: await digestGroup(repositoryRoot, schemaPaths),
    migrations: await digestGroup(repositoryRoot, migrationPaths),
    testSuite: await digestGroup(repositoryRoot, testPaths),
    verifier: await digestGroup(repositoryRoot, verifierPaths),
    deploymentManifests: await digestGroup(
      repositoryRoot,
      deploymentManifestPaths,
    ),
    publicProjection: await digestGroup(repositoryRoot, publicProjectionPaths),
    testResultDigest,
    imageDigests: [],
    imageStatus: "NOT_BUILT_DOCKER_GATE",
  };
}

export async function digestPublicFile(
  repositoryRoot: string,
  path: string,
): Promise<Sha256Digest> {
  return sha256Digest(await readFile(join(repositoryRoot, path)));
}
