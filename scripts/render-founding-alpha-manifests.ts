import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, stringify } from "yaml";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = "ABL-FOUNDING-ALPHA-R01";
const runLabel = "founding-alpha-r01";
const syntheticApplicationId = "0198e000-0000-7000-8000-000000000001";
const syntheticBodySandboxName = `abl-career-${syntheticApplicationId.replaceAll("-", "")}`;

interface ManifestSpec {
  source: string;
  targetName: string;
  imageEnvironmentName: string;
}

interface Manifest {
  apiVersion: string;
  kind: "Function" | "Job" | "Sandbox";
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
  spec: {
    public?: boolean;
    region?: string;
    lifecycle?: Record<string, unknown>;
    network?: { allowedDomains?: string[] };
    runtime: {
      image: string;
      envs?: Array<{ name: string; value: unknown; secret: boolean }>;
    };
  };
}

const manifests: readonly ManifestSpec[] = [
  {
    source: "infra/blaxel/abl-core/core-api.yaml",
    targetName: "abl-alpha-r01-core-api",
    imageEnvironmentName: "ABL_ALPHA_CORE_API_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-private/storage-broker.yaml",
    targetName: "abl-alpha-r01-storage-broker",
    imageEnvironmentName: "ABL_ALPHA_STORAGE_BROKER_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-public/public-api.yaml",
    targetName: "abl-alpha-r01-public-api",
    imageEnvironmentName: "ABL_ALPHA_PUBLIC_API_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-public/arena.yaml",
    targetName: "abl-alpha-r01-arena",
    imageEnvironmentName: "ABL_ALPHA_ARENA_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-public/candidate-store.yaml",
    targetName: "abl-alpha-r01-candidate-store",
    imageEnvironmentName: "ABL_ALPHA_CANDIDATE_STORE_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-public/candidate-edge.yaml",
    targetName: "abl-alpha-r01-candidate-edge",
    imageEnvironmentName: "ABL_ALPHA_CANDIDATE_EDGE_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-competition/fixed-broker-sandbox.example.yaml",
    targetName: "abl-alpha-r01-fixed-broker",
    imageEnvironmentName: "ABL_ALPHA_FIXED_BROKER_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-competition/body-sandbox.example.yaml",
    targetName: syntheticBodySandboxName,
    imageEnvironmentName: "ABL_ALPHA_BODY_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-competition/candidate-provisioner.yaml",
    targetName: "abl-alpha-r01-candidate-provisioner",
    imageEnvironmentName: "ABL_ALPHA_CANDIDATE_PROVISIONER_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-competition/basketball-mcp.yaml",
    targetName: "abl-alpha-r01-basketball-mcp",
    imageEnvironmentName: "ABL_ALPHA_BASKETBALL_MCP_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-core/career-mcp.yaml",
    targetName: "abl-alpha-r01-career-mcp",
    imageEnvironmentName: "ABL_ALPHA_CAREER_MCP_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-core/government-mcp.yaml",
    targetName: "abl-alpha-r01-government-mcp",
    imageEnvironmentName: "ABL_ALPHA_GOVERNMENT_MCP_IMAGE_ID",
  },
  {
    source: "infra/blaxel/abl-public/discovery-mcp.yaml",
    targetName: "abl-alpha-r01-discovery-mcp",
    imageEnvironmentName: "ABL_ALPHA_DISCOVERY_MCP_IMAGE_ID",
  },
] as const;

function digest(content: string): `0x${string}` {
  return `0x${createHash("sha256").update(content).digest("hex")}`;
}

function parseManifest(source: string, path: string): Manifest {
  const manifest = parse(source) as Partial<Manifest>;
  if (
    manifest.apiVersion !== "blaxel.ai/v1alpha1" ||
    !["Function", "Job", "Sandbox"].includes(String(manifest.kind)) ||
    manifest.metadata === undefined ||
    manifest.spec?.runtime === undefined
  )
    throw new Error(`Invalid active Blaxel source manifest: ${path}`);
  return manifest as Manifest;
}

function makePrivateAndBounded(manifest: Manifest): void {
  manifest.metadata.labels = {
    ...manifest.metadata.labels,
    "abl-run": runLabel,
  };
  if (manifest.kind === "Function") {
    manifest.spec.public = false;
    return;
  }
  if (manifest.kind === "Sandbox")
    manifest.spec.lifecycle = {
      expirationPolicies: [
        { action: "delete", type: "ttl-max-age", value: "4h" },
      ],
      terminatedRetention: "24h",
    };
}

function setEnvironment(
  manifest: Manifest,
  name: string,
  value: string,
  secret: boolean,
): void {
  const envs = manifest.spec.runtime.envs ?? [];
  const existing = envs.find((entry) => entry.name === name);
  if (existing === undefined) envs.push({ name, value, secret });
  else Object.assign(existing, { value, secret });
  manifest.spec.runtime.envs = envs;
}

function removeEnvironment(
  manifest: Manifest,
  names: ReadonlySet<string>,
): void {
  manifest.spec.runtime.envs = (manifest.spec.runtime.envs ?? []).filter(
    ({ name }) => !names.has(name),
  );
}

function removeModelRoute(manifest: Manifest): void {
  if (manifest.metadata.name !== "abl-alpha-r01-fixed-broker") return;
  if (manifest.spec.network?.allowedDomains !== undefined)
    manifest.spec.network.allowedDomains =
      manifest.spec.network.allowedDomains.filter(
        (domain) => !domain.includes("MODEL"),
      );
  manifest.spec.runtime.envs = (manifest.spec.runtime.envs ?? []).filter(
    ({ name }) => !name.startsWith("ABL_MODEL_"),
  );
}

function configurePrivateServiceLinks(manifest: Manifest): void {
  if (manifest.metadata.name === "abl-alpha-r01-core-api") {
    setEnvironment(
      manifest,
      "ABL_PUBLIC_PROJECTION_PREVIEW_TOKEN",
      "${ABL_ALPHA_PUBLIC_API_PREVIEW_TOKEN}",
      true,
    );
    setEnvironment(
      manifest,
      "ABL_PRIVATE_STORAGE_PREVIEW_TOKEN",
      "${ABL_ALPHA_STORAGE_BROKER_PREVIEW_TOKEN}",
      true,
    );
  }
  if (manifest.metadata.name === "abl-alpha-r01-arena")
    setEnvironment(
      manifest,
      "ABL_PUBLIC_API_PREVIEW_TOKEN",
      "${ABL_ALPHA_PUBLIC_API_PREVIEW_TOKEN}",
      true,
    );
  if (manifest.metadata.name === "abl-alpha-r01-discovery-mcp")
    setEnvironment(
      manifest,
      "ABL_PUBLIC_API_PREVIEW_TOKEN",
      "${ABL_ALPHA_PUBLIC_API_PREVIEW_TOKEN}",
      true,
    );
  if (
    ["abl-alpha-r01-career-mcp", "abl-alpha-r01-government-mcp"].includes(
      manifest.metadata.name,
    )
  )
    setEnvironment(
      manifest,
      "ABL_CORE_PREVIEW_TOKEN",
      "${ABL_ALPHA_CORE_API_PREVIEW_TOKEN}",
      true,
    );
  if (manifest.metadata.name !== "abl-alpha-r01-fixed-broker") return;
  removeEnvironment(
    manifest,
    new Set([
      "ABL_CORE_ACCESS_TOKEN_B64",
      "ABL_CORE_WORKSPACE",
      "ABL_PRIVATE_ACCESS_TOKEN_B64",
      "ABL_PRIVATE_WORKSPACE",
    ]),
  );
  setEnvironment(
    manifest,
    "ABL_CORE_AUTH_MODE",
    "BLAXEL_PRIVATE_PREVIEW",
    false,
  );
  setEnvironment(
    manifest,
    "ABL_PRIVATE_AUTH_MODE",
    "BLAXEL_PRIVATE_PREVIEW",
    false,
  );
  setEnvironment(
    manifest,
    "ABL_CORE_PREVIEW_TOKEN_B64",
    "${ABL_ALPHA_CORE_API_PREVIEW_TOKEN_B64}",
    true,
  );
  setEnvironment(
    manifest,
    "ABL_PRIVATE_PREVIEW_TOKEN_B64",
    "${ABL_ALPHA_STORAGE_BROKER_PREVIEW_TOKEN_B64}",
    true,
  );
}

export async function renderFoundingAlphaManifests(outputPath?: string) {
  const outputRoot = resolve(
    outputPath ?? (await mkdtemp(join(tmpdir(), "abl-alpha-manifests-"))),
  );
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const rendered: Array<{
    kind: Manifest["kind"];
    name: string;
    path: string;
    sha256: `0x${string}`;
    source: string;
  }> = [];
  for (const spec of manifests) {
    const source = await readFile(join(repositoryRoot, spec.source), "utf8");
    const manifest = parseManifest(source, spec.source);
    manifest.metadata.name = spec.targetName;
    manifest.spec.runtime.image = `\${${spec.imageEnvironmentName}}`;
    makePrivateAndBounded(manifest);
    removeModelRoute(manifest);
    configurePrivateServiceLinks(manifest);
    const contents = stringify(manifest, { lineWidth: 100 });
    const path = join(outputRoot, `${spec.targetName}.yaml`);
    await writeFile(path, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    rendered.push({
      kind: manifest.kind,
      name: spec.targetName,
      path,
      sha256: digest(contents),
      source: spec.source,
    });
  }
  const manifestSetDigest = digest(
    rendered
      .map(({ name, sha256 }) => `${name}\0${sha256}`)
      .sort()
      .join("\n"),
  );
  return {
    runId,
    outputRoot,
    publicIngress: false,
    manifestSetDigest,
    rendered,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  renderFoundingAlphaManifests(process.argv[2])
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
