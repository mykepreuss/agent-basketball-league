import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = "agent-basketball-league";
const authorizationPattern = /^ABL-FOUNDING-ALPHA-R01-\d{2}$/;
const revisionPattern = /^(?:[a-z0-9]{12}|[0-9a-f]{21})$/;

export interface FoundingAlphaImagePushSpec {
  readonly ordinal: number;
  readonly name: string;
  readonly resourceType: "function" | "job" | "sandbox";
  readonly contextDirectory: string | null;
}

export const FOUNDING_ALPHA_IMAGE_PUSH_SPECS = [
  {
    ordinal: 1,
    name: "abl-alpha-r01-core-api-image",
    resourceType: "sandbox",
    contextDirectory: "core-api",
  },
  {
    ordinal: 2,
    name: "abl-alpha-r01-public-api-image",
    resourceType: "sandbox",
    contextDirectory: "public-api",
  },
  {
    ordinal: 3,
    name: "abl-alpha-r01-storage-broker-image",
    resourceType: "sandbox",
    contextDirectory: "storage-broker",
  },
  {
    ordinal: 4,
    name: "abl-alpha-r01-fixed-broker-image",
    resourceType: "sandbox",
    contextDirectory: "fixed-broker",
  },
  {
    ordinal: 5,
    name: "abl-alpha-r01-candidate-store-image",
    resourceType: "sandbox",
    contextDirectory: "candidate-store",
  },
  {
    ordinal: 6,
    name: "abl-alpha-r01-arena-image",
    resourceType: "sandbox",
    contextDirectory: "arena",
  },
  {
    ordinal: 7,
    name: "abl-alpha-r01-candidate-edge-image",
    resourceType: "function",
    contextDirectory: "candidate-edge",
  },
  {
    ordinal: 8,
    name: "abl-alpha-r01-candidate-provisioner-image",
    resourceType: "job",
    contextDirectory: "candidate-provisioner",
  },
  {
    ordinal: 9,
    name: "abl-alpha-r01-basketball-mcp-image",
    resourceType: "function",
    contextDirectory: "basketball-mcp",
  },
  {
    ordinal: 10,
    name: "abl-alpha-r01-career-mcp-image",
    resourceType: "function",
    contextDirectory: "career-mcp",
  },
  {
    ordinal: 11,
    name: "abl-alpha-r01-discovery-mcp-image",
    resourceType: "function",
    contextDirectory: "discovery-mcp",
  },
  {
    ordinal: 12,
    name: "abl-alpha-r01-government-mcp-image",
    resourceType: "function",
    contextDirectory: "government-mcp",
  },
  {
    ordinal: 13,
    name: "abl-alpha-r01-body-image",
    resourceType: "sandbox",
    contextDirectory: null,
  },
] as const satisfies readonly FoundingAlphaImagePushSpec[];

interface ImageReadback {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    resourceType: string;
    status: string;
    workspace: string;
  };
  spec: {
    size: number;
    tags: Array<{ name: string; size: number }>;
  };
}

function digest(content: string | Uint8Array): `0x${string}` {
  return `0x${createHash("sha256").update(content).digest("hex")}`;
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

async function bodySourceDigest(): Promise<`0x${string}`> {
  const paths = [
    "Dockerfile",
    "infra/sandbox/apk-packages.lock",
    "infra/sandbox/abl-reviewed-body-init",
    "infra/sandbox/reviewed-agent-runtime",
  ] as const;
  const hash = createHash("sha256");
  for (const path of paths.toSorted())
    hash
      .update(path)
      .update("\0")
      .update(await readFile(join(repositoryRoot, path)))
      .update("\0");
  return `0x${hash.digest("hex")}`;
}

async function assertMissing(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists`);
}

async function writeReceipt(path: string, value: unknown): Promise<void> {
  await writeFile(
    path,
    await format(JSON.stringify(value), { parser: "json" }),
    {
      flag: "wx",
      mode: 0o600,
    },
  );
}

function assertExternalDirectory(path: string, label: string): string {
  const absolutePath = resolve(path);
  const repositoryRelative = relative(repositoryRoot, absolutePath);
  if (
    repositoryRelative === "" ||
    (!repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative))
  )
    throw new Error(`${label} must be outside the repository`);
  return absolutePath;
}

function receiptName(ordinal: number): string {
  return `image-${String(ordinal).padStart(2, "0")}-receipt.json`;
}

export function foundingAlphaPushArguments(
  spec: FoundingAlphaImagePushSpec,
): string[] {
  return [
    "push",
    "--name",
    spec.name,
    "--type",
    spec.resourceType,
    "--yes",
    "--timeout",
    "30m",
    "--workspace",
    workspace,
  ];
}

export function validateImageReadback(
  value: unknown,
  spec: FoundingAlphaImagePushSpec,
): {
  readonly revision: string;
  readonly sizeBytes: number;
  readonly immutableReference: string;
} {
  if (!Array.isArray(value) || value.length !== 1)
    throw new Error(`Expected one readback for ${spec.name}`);
  const image = value[0] as Partial<ImageReadback>;
  if (
    image.apiVersion !== "blaxel.ai/v1alpha1" ||
    image.kind !== "Image" ||
    image.metadata?.name !== spec.name ||
    image.metadata.resourceType !== spec.resourceType ||
    image.metadata.status !== "BUILT" ||
    image.metadata.workspace !== workspace ||
    typeof image.spec?.size !== "number" ||
    image.spec.size <= 0 ||
    !Array.isArray(image.spec.tags) ||
    image.spec.tags.length !== 1
  )
    throw new Error(`Invalid image readback for ${spec.name}`);
  const revision = image.spec.tags[0]?.name;
  if (typeof revision !== "string" || !revisionPattern.test(revision))
    throw new Error(`Invalid immutable revision for ${spec.name}`);
  if (image.spec.tags[0]?.size !== image.spec.size)
    throw new Error(`Image and tag sizes differ for ${spec.name}`);
  return {
    revision,
    sizeBytes: image.spec.size,
    immutableReference: `${spec.resourceType}/${spec.name}:${revision}`,
  };
}

function readProviderInventory(): unknown[] {
  const output = execFileSync(
    "bl",
    ["get", "images", "--output", "json", "--workspace", workspace],
    { encoding: "utf8", cwd: repositoryRoot },
  );
  const value = JSON.parse(output) as unknown;
  if (!Array.isArray(value)) throw new Error("Invalid Blaxel image inventory");
  return value;
}

async function runPush(
  spec: FoundingAlphaImagePushSpec,
  contextRoot: string,
  logPath: string,
): Promise<void> {
  const log = await open(logPath, "wx", 0o600);
  try {
    const exitCode = await new Promise<number>((resolveCode, reject) => {
      const child = spawn("bl", foundingAlphaPushArguments(spec), {
        cwd: contextRoot,
        env: process.env,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.on("error", reject);
      child.on("close", (code) => resolveCode(code ?? 1));
    });
    if (exitCode !== 0)
      throw new Error(`Blaxel image push failed for ${spec.name}`);
  } finally {
    await log.close();
  }
}

async function main(): Promise<void> {
  const authorizationId = process.env.ABL_ALPHA_AUTHORIZATION_ID;
  if (
    typeof authorizationId !== "string" ||
    !authorizationPattern.test(authorizationId)
  )
    throw new Error("A valid ABL_ALPHA_AUTHORIZATION_ID is required");
  const imageRoot = assertExternalDirectory(
    process.argv[2] ?? "",
    "Image root",
  );
  const evidenceRoot = assertExternalDirectory(
    process.argv[3] ?? "",
    "Evidence root",
  );
  const ordinal = Number.parseInt(process.argv[4] ?? "", 10);
  const spec = FOUNDING_ALPHA_IMAGE_PUSH_SPECS.find(
    (entry) => entry.ordinal === ordinal,
  );
  if (spec === undefined) throw new Error("Image ordinal must be 1 through 13");

  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(evidenceRoot, "image-push.lock");
  const lock = await open(lockPath, "wx", 0o600).catch(() => {
    throw new Error("Another image push is active or requires review");
  });
  await lock.writeFile(
    `${JSON.stringify({ authorizationId, ordinal, image: spec.name })}\n`,
  );
  await lock.close();

  const currentReceipt = join(evidenceRoot, receiptName(ordinal));
  try {
    await assertMissing(currentReceipt, `Receipt for ordinal ${ordinal}`);
    if (ordinal > 1) {
      const prior = JSON.parse(
        await readFile(join(evidenceRoot, receiptName(ordinal - 1)), "utf8"),
      ) as { ordinal?: unknown; status?: unknown };
      if (prior.ordinal !== ordinal - 1 || prior.status !== "PASS")
        throw new Error(`Ordinal ${ordinal - 1} has no passing receipt`);
    }

    const providerInventory = readProviderInventory() as Array<{
      metadata?: { name?: string };
    }>;
    if (providerInventory.some((image) => image.metadata?.name === spec.name))
      throw new Error(`Provider image already exists: ${spec.name}`);

    const contextRoot =
      spec.contextDirectory === null
        ? repositoryRoot
        : join(imageRoot, spec.contextDirectory);
    const expectedSources = JSON.parse(
      await readFile(
        join(
          repositoryRoot,
          "infra/blaxel/founding-alpha-private/image-sources.json",
        ),
        "utf8",
      ),
    ) as { imageSourceDigests?: Record<string, string> };
    const expectedDigest = expectedSources.imageSourceDigests?.[spec.name];
    const actualDigest =
      spec.contextDirectory === null
        ? await bodySourceDigest()
        : await directoryDigest(contextRoot);
    if (actualDigest !== expectedDigest)
      throw new Error(`Source digest drift for ${spec.name}`);

    const dockerfilePath = join(contextRoot, "Dockerfile");
    const dockerfileDigest = digest(await readFile(dockerfilePath));
    const logPath = join(
      evidenceRoot,
      `image-${String(ordinal).padStart(2, "0")}-push.log`,
    );
    await runPush(spec, contextRoot, logPath);
    const log = await readFile(logPath, "utf8");
    if (
      !log.includes("Found existing Dockerfile") ||
      !log.includes("amd64 machine") ||
      log.includes("Sandbox Configuration Warning")
    )
      throw new Error(`Build identity was not attributable for ${spec.name}`);

    const readbackOutput = execFileSync(
      "bl",
      [
        "get",
        "image",
        `${spec.resourceType}/${spec.name}`,
        "--output",
        "json",
        "--workspace",
        workspace,
      ],
      { encoding: "utf8", cwd: contextRoot },
    );
    const readback = JSON.parse(readbackOutput) as unknown;
    const validated = validateImageReadback(readback, spec);
    const latest = execFileSync(
      "bl",
      [
        "get",
        "image",
        `${spec.resourceType}/${spec.name}`,
        "--latest",
        "--workspace",
        workspace,
      ],
      { encoding: "utf8", cwd: contextRoot },
    ).trim();
    if (latest !== validated.immutableReference)
      throw new Error(`Latest reference differs for ${spec.name}`);

    const receipt = {
      status: "PASS",
      authorizationId,
      ordinal,
      image: spec.name,
      resourceType: spec.resourceType,
      sourceDigest: actualDigest,
      dockerfileDigest,
      invocation: {
        workingDirectory:
          spec.contextDirectory === null
            ? "REPOSITORY_ROOT_REVIEWED_BODY_PROJECT"
            : spec.contextDirectory,
        arguments: foundingAlphaPushArguments(spec),
        directoryFlagUsed: false,
      },
      architecture: "linux/amd64",
      ...validated,
      recordedAt: new Date().toISOString(),
    };
    await writeReceipt(currentReceipt, receipt);
    process.stdout.write(
      `${JSON.stringify({
        status: receipt.status,
        ordinal,
        image: spec.name,
        immutableReference: receipt.immutableReference,
        sizeBytes: receipt.sizeBytes,
        architecture: receipt.architecture,
      })}\n`,
    );
  } catch (error: unknown) {
    const failure = {
      status: "FAIL_CLOSED",
      authorizationId,
      ordinal,
      image: spec.name,
      reason: error instanceof Error ? error.message : String(error),
      recordedAt: new Date().toISOString(),
    };
    await writeReceipt(currentReceipt, failure).catch(
      (receiptError: NodeJS.ErrnoException) => {
        if (receiptError.code !== "EEXIST") throw receiptError;
      },
    );
    throw error;
  } finally {
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  void main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
