import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packageStagingBody } from "./package-staging-body.js";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const templatesRoot = join(repositoryRoot, "infra/blaxel/staging/images");
const outputRoot = resolve(
  process.argv[2] ?? (await mkdtemp(join(tmpdir(), "abl-stage-images-"))),
);
const corepackPath = execFileSync("which", ["corepack"], {
  encoding: "utf8",
}).trim();
const lifecycleEvent = process.env.npm_lifecycle_event;
const foundingAlpha = lifecycleEvent === "founding-alpha:prepare-images";
const persistentStageC = lifecycleEvent === "stage-c:prepare-images";
const cognitionOnly = lifecycleEvent === "cognition:prepare-image";
let imageNamePrefix = "abl-stage";
if (foundingAlpha) imageNamePrefix = "abl-alpha-r01";
else if (persistentStageC) imageNamePrefix = "abl-stage-c";
else if (cognitionOnly) imageNamePrefix = "abl";
const imageNameSuffix =
  foundingAlpha || persistentStageC || cognitionOnly ? "-image" : "";

interface ImageService {
  directory: string;
  packageName: string;
  memory: number;
  type: "function" | "job" | "sandbox";
}

const privateProofImageServices = [
  {
    directory: "core-api",
    packageName: "@abl/core-api",
    memory: 4096,
    type: "sandbox",
  },
  {
    directory: "public-api",
    packageName: "@abl/public-api",
    memory: 4096,
    type: "sandbox",
  },
  {
    directory: "storage-broker",
    packageName: "@abl/private-storage-broker",
    memory: 4096,
    type: "sandbox",
  },
  {
    directory: "fixed-broker",
    packageName: "@abl/body-broker",
    memory: 1024,
    type: "sandbox",
  },
  {
    directory: "candidate-store",
    packageName: "@abl/candidate-edge",
    memory: 2048,
    type: "sandbox",
  },
  {
    directory: "candidate-edge",
    packageName: "@abl/candidate-edge",
    memory: 2048,
    type: "sandbox",
  },
  {
    directory: "candidate-provisioner",
    packageName: "@abl/candidate-provisioner",
    memory: 2048,
    type: "job",
  },
  {
    directory: "basketball-mcp",
    packageName: "@abl/basketball-mcp",
    memory: 2048,
    type: "function",
  },
  {
    directory: "career-mcp",
    packageName: "@abl/career-mcp",
    memory: 2048,
    type: "function",
  },
  {
    directory: "discovery-mcp",
    packageName: "@abl/discovery-mcp",
    memory: 2048,
    type: "function",
  },
  {
    directory: "government-mcp",
    packageName: "@abl/government-mcp",
    memory: 2048,
    type: "function",
  },
] as const satisfies readonly ImageService[];
const persistentImageServices = [
  ...privateProofImageServices,
  {
    directory: "career-body",
    packageName: "@abl/staging-body",
    memory: 4096,
    type: "sandbox",
  },
  {
    directory: "safety-gateway",
    packageName: "@abl/safety-gateway",
    memory: 1024,
    type: "sandbox",
  },
  {
    directory: "recovery-job",
    packageName: "@abl/recovery-job",
    memory: 4096,
    type: "job",
  },
  {
    directory: "cognition-relay",
    packageName: "@abl/cognition-relay",
    memory: 2048,
    type: "sandbox",
  },
  {
    directory: "competition-director",
    packageName: "@abl/competition-director",
    memory: 2048,
    type: "sandbox",
  },
] satisfies readonly ImageService[];
const cognitionImageServices = [
  {
    directory: "cognition-relay",
    packageName: "@abl/cognition-relay",
    memory: 2048,
    type: "sandbox",
  },
  {
    directory: "competition-director",
    packageName: "@abl/competition-director",
    memory: 2048,
    type: "sandbox",
  },
] as const satisfies readonly ImageService[];
const imageServices: readonly ImageService[] = cognitionOnly
  ? cognitionImageServices
  : persistentStageC
    ? persistentImageServices
    : privateProofImageServices;
const imageContextIgnore = ".git\n.DS_Store\n";
const developmentEntries = [
  ".turbo",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "src",
  "test",
  "tsconfig.json",
  "tsconfig.test.json",
] as const;
const volatileRuntimeMetadata = [
  "node_modules/.modules.yaml",
  "node_modules/.pnpm/lock.yaml",
  "node_modules/.pnpm-workspace-state-v1.json",
] as const;
const ignoredBodyInputNames = new Set([
  ".DS_Store",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

function pnpm(
  arguments_: readonly string[],
  additionalEnvironment: Readonly<Record<string, string>> = {},
): void {
  execFileSync(process.execPath, [corepackPath, "pnpm", ...arguments_], {
    cwd: repositoryRoot,
    env: { ...process.env, ...additionalEnvironment },
    stdio: "inherit",
  });
}

function configuration(
  name: string,
  memory: number,
  type: "function" | "job" | "sandbox",
): string {
  const imageName = `${imageNamePrefix}-${name}${imageNameSuffix}`;
  return `name = "${imageName}"
type = "${type}"
region = "us-was-1"

[build]
slim = false

[runtime]
memory = ${memory}
`;
}

async function directoryDigest(root: string): Promise<`0x${string}`> {
  const hash = createHash("sha256");
  async function collect(relativePath: string): Promise<void> {
    const absolutePath = join(root, relativePath);
    const info = await lstat(absolutePath);
    if (info.isDirectory()) {
      for (const entry of (await readdir(absolutePath)).sort())
        await collect(join(relativePath, entry));
      return;
    }
    if (info.isSymbolicLink()) {
      hash
        .update("link\0")
        .update(relativePath)
        .update("\0")
        .update(await readlink(absolutePath))
        .update("\0");
      return;
    }
    if (!info.isFile())
      throw new Error(`Unsupported image-context input: ${relativePath}`);
    hash
      .update("file\0")
      .update(relativePath)
      .update("\0")
      .update(await readFile(absolutePath))
      .update("\0");
  }
  for (const entry of (await readdir(root)).sort()) await collect(entry);
  return `0x${hash.digest("hex")}`;
}

async function pruneDeployedPackage(packageRoot: string): Promise<void> {
  await Promise.all(
    developmentEntries.map((entry) =>
      rm(join(packageRoot, entry), { recursive: true, force: true }),
    ),
  );
}

async function listDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return entries.filter((entry) => entry.isDirectory()).map(({ name }) => name);
}

async function sourceDigest(inputs: readonly string[]): Promise<`0x${string}`> {
  const files: string[] = [];
  async function collect(relativePath: string): Promise<void> {
    const name = relativePath.split("/").at(-1) ?? relativePath;
    if (
      ignoredBodyInputNames.has(name) ||
      name.endsWith(".log") ||
      name.endsWith(".tsbuildinfo")
    )
      return;
    const absolutePath = join(repositoryRoot, relativePath);
    const info = await lstat(absolutePath);
    if (info.isDirectory()) {
      const entries = await readdir(absolutePath);
      for (const entry of entries.sort())
        await collect(join(relativePath, entry));
      return;
    }
    if (!info.isFile())
      throw new Error(`Unsupported body image input: ${relativePath}`);
    files.push(relativePath);
  }
  for (const input of inputs) await collect(input);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    const contents = await readFile(join(repositoryRoot, file));
    hash.update(file).update("\0").update(contents).update("\0");
  }
  return `0x${hash.digest("hex")}`;
}

function bodyImageSourceDigest(): Promise<`0x${string}`> {
  return sourceDigest([
    "Dockerfile",
    "infra/sandbox/apk-packages.lock",
    "infra/sandbox/abl-reviewed-body-init",
    "infra/sandbox/reviewed-agent-runtime",
  ]);
}

async function injectedWorkspacePackageRoots(
  packageRoot: string,
): Promise<string[]> {
  const virtualStore = join(packageRoot, "node_modules/.pnpm");
  const dependencies = await listDirectories(virtualStore);
  const roots = await Promise.all(
    dependencies.map(async (dependency) => {
      const scope = join(virtualStore, dependency, "node_modules/@abl");
      return (await listDirectories(scope)).map((name) => join(scope, name));
    }),
  );
  return roots.flat();
}

async function hoistedWorkspacePackageRoots(
  packageRoot: string,
): Promise<string[]> {
  const scope = join(packageRoot, "node_modules/@abl");
  return (await listDirectories(scope)).map((name) => join(scope, name));
}

async function assertPortableRuntimeTree(
  root: string,
  current = root,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        if (!path.includes(`${join("node_modules", ".bin")}/`))
          throw new Error(`Staging runtime contains nonportable link: ${path}`);
        return;
      }
      if (entry.isDirectory()) await assertPortableRuntimeTree(root, path);
    }),
  );
}

async function verifyWorkspacePackageImports(
  packageRoot: string,
): Promise<void> {
  const names = await listDirectories(join(packageRoot, "node_modules/@abl"));
  for (const name of names) {
    execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import("@abl/${name}")`],
      { cwd: packageRoot, env: process.env, stdio: "pipe" },
    );
  }
}

async function prepareRuntimePackageTree(packageRoot: string): Promise<void> {
  const roots = [
    packageRoot,
    ...(await injectedWorkspacePackageRoots(packageRoot)),
    ...(await hoistedWorkspacePackageRoots(packageRoot)),
  ];
  await Promise.all(
    [...new Set(roots)].map((root) => pruneDeployedPackage(root)),
  );
  await Promise.all(
    volatileRuntimeMetadata.map((path) =>
      rm(join(packageRoot, path), { force: true }),
    ),
  );
  for (const root of roots) {
    const remaining = new Set(await readdir(root));
    const forbidden = developmentEntries.filter((entry) =>
      remaining.has(entry),
    );
    if (forbidden.length > 0)
      throw new Error(
        `Staging runtime package still contains development entries: ${forbidden.join(
          ", ",
        )}`,
      );
  }
  await assertPortableRuntimeTree(packageRoot);
  await verifyWorkspacePackageImports(packageRoot);
}

await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const buildPackageNames = new Set([
  ...imageServices.map(({ packageName }) => packageName),
  ...(cognitionOnly ? [] : ["@abl/arena"]),
  ...(persistentStageC || cognitionOnly ? [] : ["@abl/staging-body"]),
]);
const arenaBuildSourceDigest = cognitionOnly
  ? null
  : await sourceDigest([
      "apps/arena/app",
      "apps/arena/next.config.mjs",
      "apps/arena/package.json",
      "packages/projections/src",
      "packages/schemas/src",
      "pnpm-lock.yaml",
    ]);
const arenaBuildId =
  arenaBuildSourceDigest === null
    ? null
    : `abl-${arenaBuildSourceDigest.slice(2, 34)}`;
pnpm(
  [
    ...[...buildPackageNames].flatMap((packageName) => [
      "--filter",
      `${packageName}...`,
    ]),
    "build",
  ],
  arenaBuildId === null ? {} : { ABL_ARENA_BUILD_ID: arenaBuildId },
);
for (const service of imageServices) {
  const context = join(outputRoot, service.directory);
  await mkdir(context, { recursive: true, mode: 0o700 });
  pnpm([
    "--config.node-linker=hoisted",
    "--config.inject-workspace-packages=true",
    "--filter",
    service.packageName,
    "deploy",
    "--prod",
    join(context, "app"),
  ]);
  await prepareRuntimePackageTree(join(context, "app"));
  const contextFiles: Promise<unknown>[] = [
    cp(
      join(
        templatesRoot,
        service.type === "sandbox"
          ? "Dockerfile.sandbox-service"
          : "Dockerfile.hosted-service",
      ),
      join(context, "Dockerfile"),
    ),
    writeFile(join(context, ".blaxelignore"), imageContextIgnore),
    writeFile(
      join(context, "blaxel.toml"),
      configuration(service.directory, service.memory, service.type),
    ),
  ];
  if (service.type === "sandbox")
    contextFiles.push(
      cp(
        join(templatesRoot, "sandbox-service-entrypoint"),
        join(context, "sandbox-service-entrypoint"),
      ),
    );
  await Promise.all(contextFiles);
}

const arenaContext = cognitionOnly ? null : join(outputRoot, "arena");
if (arenaContext !== null) {
  const arenaApp = join(arenaContext, "app");
  const arenaRoot = join(repositoryRoot, "apps/arena");
  await mkdir(arenaContext, { recursive: true, mode: 0o700 });
  pnpm([
    "--config.node-linker=hoisted",
    "--config.inject-workspace-packages=true",
    "--filter",
    "@abl/arena",
    "deploy",
    "--prod",
    arenaApp,
  ]);
  await rm(join(arenaApp, ".next"), { recursive: true, force: true });
  await cp(join(arenaRoot, ".next/standalone/apps/arena"), arenaApp, {
    recursive: true,
    dereference: true,
    force: true,
  });
  await cp(join(arenaRoot, ".next/static"), join(arenaApp, ".next/static"), {
    recursive: true,
  });
  await rm(join(arenaApp, ".next/cache"), { recursive: true, force: true });
  await prepareRuntimePackageTree(arenaApp);
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'await Promise.all([import("next"), import("@swc/helpers/_/_interop_require_default")])',
    ],
    { cwd: arenaApp, env: process.env, stdio: "pipe" },
  );
  await Promise.all([
    cp(
      join(templatesRoot, "Dockerfile.sandbox-service"),
      join(arenaContext, "Dockerfile"),
    ),
    cp(
      join(templatesRoot, "sandbox-service-entrypoint"),
      join(arenaContext, "sandbox-service-entrypoint"),
    ),
    writeFile(join(arenaContext, ".blaxelignore"), imageContextIgnore),
    writeFile(
      join(arenaContext, "blaxel.toml"),
      configuration("arena", 4096, "sandbox"),
    ),
  ]);
}

const bodyContext = join(outputRoot, "body-program");
let bodyProgramArchive:
  | Awaited<ReturnType<typeof packageStagingBody>>
  | undefined;
if (!persistentStageC && !cognitionOnly) {
  await mkdir(bodyContext, { recursive: true, mode: 0o700 });
  pnpm([
    "--config.node-linker=hoisted",
    "--config.inject-workspace-packages=true",
    "--filter",
    "@abl/staging-body",
    "deploy",
    "--prod",
    join(bodyContext, "agent"),
  ]);
  await prepareRuntimePackageTree(join(bodyContext, "agent"));
  await writeFile(
    join(bodyContext, "agent/main.mjs"),
    'await import("./dist/index.js");\n',
    { mode: 0o600 },
  );
  bodyProgramArchive = await packageStagingBody(
    bodyContext,
    join(outputRoot, "body-program.tgz"),
  );
}
const sandboxImageContexts = imageServices
  .filter(({ type }) => type === "sandbox")
  .map(({ directory }) => join(outputRoot, directory))
  .concat(arenaContext === null ? [] : [arenaContext]);
const hostedImageContexts = imageServices
  .filter(({ type }) => type !== "sandbox")
  .map(({ directory }) => join(outputRoot, directory));
const contextDirectories = [...sandboxImageContexts, ...hostedImageContexts];
const imageSourceDigests = Object.fromEntries(
  await Promise.all(
    contextDirectories.map(
      async (context) =>
        [
          `${imageNamePrefix}-${context.split("/").at(-1)}${imageNameSuffix}`,
          await directoryDigest(context),
        ] as const,
    ),
  ),
);
if (!persistentStageC && !cognitionOnly)
  imageSourceDigests[`${imageNamePrefix}-body${imageNameSuffix}`] =
    await bodyImageSourceDigest();
const imageSetHash = createHash("sha256");
for (const [name, digest] of Object.entries(imageSourceDigests).sort(
  ([left], [right]) => left.localeCompare(right),
))
  imageSetHash.update(name).update("\0").update(digest).update("\0");

const contexts = {
  outputRoot,
  sandboxImageContexts,
  hostedImageContexts,
  ...(arenaBuildId === null ? {} : { arenaBuildId }),
  ...(arenaBuildSourceDigest === null ? {} : { arenaBuildSourceDigest }),
  imageSourceDigests,
  imageSetDigest: `0x${imageSetHash.digest("hex")}`,
  ...(persistentStageC || cognitionOnly
    ? {}
    : {
        bodyProgram: bodyContext,
        bodyProgramArchive,
        bodyImageProject: repositoryRoot,
        bodyImageSourceDigest:
          imageSourceDigests[`${imageNamePrefix}-body${imageNameSuffix}`],
      }),
};
process.stdout.write(`${JSON.stringify(contexts, null, 2)}\n`);
