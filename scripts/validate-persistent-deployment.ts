import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";
import { z } from "zod";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const WorkspaceSchema = z.literal("agent-basketball-league");
const TrustDomainSchema = z.enum([
  "abl-core",
  "abl-private",
  "abl-public",
  "abl-competition",
]);
const WorkloadKindSchema = z.enum(["Sandbox", "Function", "Job"]);
const WorkloadSchema = z.strictObject({
  ordinal: z.number().int().positive(),
  workspace: WorkspaceSchema,
  trustDomain: TrustDomainSchema,
  kind: WorkloadKindSchema,
  name: z.string().min(1).max(49),
  manifest: z.string().startsWith("infra/blaxel/"),
  imageName: z.string().regex(/^abl-stage-c-[a-z0-9-]+-image$/),
  imageContext: z.string().regex(/^[a-z0-9-]+$/),
  imageEnvironment: z.string().regex(/^ABL_[A-Z0-9_]+_IMAGE_DIGEST$/),
  memoryMiB: z.number().int().positive(),
  privateEndpoint: z.boolean(),
});
const DeploymentMapSchema = z.strictObject({
  $schema: z.string(),
  programId: z.literal("ABL-COMPLETION-01"),
  stage: z.literal("READ_ONLY_BEACON_PRIVATE_SOAK"),
  status: z.literal("APPROVED_DEPLOYMENT_IN_PROGRESS"),
  region: z.literal("us-was-1"),
  publicExposure: z.literal("NONE"),
  recursiveDirectoryApplyAllowed: z.literal(false),
  workloads: z.array(WorkloadSchema).length(15),
  prohibitions: z.array(z.string().min(1)).min(1),
});
const ResourcePlanSchema = z
  .object({
    deploymentMap: z.literal(
      "infra/blaxel/persistent-pre-genesis/deployment-map.json",
    ),
    workspaces: z.array(
      z.object({
        name: z.string(),
        resources: z.array(
          z.object({ kind: z.string(), name: z.string() }).strict(),
        ),
      }),
    ),
    resourceCounts: z.object({
      sandboxes: z.literal(9),
      functions: z.literal(4),
      jobs: z.literal(2),
      privatePreviews: z.literal(13),
      publicPreviews: z.literal(0),
    }),
  })
  .passthrough();
const CostEnvelopeSchema = z
  .object({
    usageCaps: z.object({
      sandboxAllocatedGiB: z.literal(25),
      mcpAllocatedGiB: z.literal(8),
      jobAllocatedGiB: z.literal(6),
    }),
  })
  .passthrough();
const ManifestSchema = z
  .object({
    kind: WorkloadKindSchema,
    metadata: z
      .object({
        name: z.string(),
        labels: z.record(z.string(), z.string()),
      })
      .passthrough(),
    spec: z
      .object({
        public: z.boolean().optional(),
        region: z.literal("us-was-1"),
        runtime: z
          .object({
            image: z.string(),
            memory: z.number().int().positive(),
            minScale: z.number().int().nonnegative().optional(),
            maxScale: z.number().int().positive().optional(),
            envs: z
              .array(
                z
                  .object({ name: z.string(), value: z.unknown() })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

function resourceId(workspace: string, kind: string, name: string): string {
  return `${workspace}/${kind}/${name}`;
}

export interface PersistentDeploymentValidation {
  status: "PASS";
  workloadCount: number;
  privateEndpointCount: number;
  imageCount: number;
  trustDomainCounts: Record<z.infer<typeof TrustDomainSchema>, number>;
  memoryMiB: { sandboxes: number; functions: number; jobs: number };
  deploymentDigest: `0x${string}`;
}

const expectedTrustDomains = new Map<string, z.infer<typeof TrustDomainSchema>>(
  [
    ["abl-private-storage-broker", "abl-private"],
    ["abl-core-api", "abl-core"],
    ["abl-safety-gateway", "abl-core"],
    ["abl-public-api", "abl-public"],
    ["abl-spectator-arena", "abl-public"],
    ["abl-candidate-store", "abl-public"],
    ["abl-candidate-edge", "abl-public"],
    ["abl-basketball-mcp", "abl-competition"],
    ["abl-career-mcp", "abl-core"],
    ["abl-government-mcp", "abl-core"],
    ["abl-discovery-mcp", "abl-public"],
    ["abl-candidate-provisioner", "abl-core"],
    ["abl-recovery-verifier", "abl-core"],
    ["abl-cognition-relay", "abl-competition"],
    ["abl-competition-director", "abl-competition"],
  ],
);

export async function validatePersistentDeployment(
  root = repositoryRoot,
): Promise<PersistentDeploymentValidation> {
  const deploymentPath = join(
    root,
    "infra/blaxel/persistent-pre-genesis/deployment-map.json",
  );
  const resourcePlanPath = join(
    root,
    "infra/blaxel/persistent-pre-genesis/resource-plan.json",
  );
  const costEnvelopePath = join(
    root,
    "infra/blaxel/persistent-pre-genesis/cost-envelope.json",
  );
  const [deploymentSource, resourcePlanSource, costEnvelopeSource] =
    await Promise.all([
      readFile(deploymentPath, "utf8"),
      readFile(resourcePlanPath, "utf8"),
      readFile(costEnvelopePath, "utf8"),
    ]);
  const deployment = DeploymentMapSchema.parse(
    JSON.parse(deploymentSource) as unknown,
  );
  const resourcePlan = ResourcePlanSchema.parse(
    JSON.parse(resourcePlanSource) as unknown,
  );
  const costEnvelope = CostEnvelopeSchema.parse(
    JSON.parse(costEnvelopeSource) as unknown,
  );
  const expectedOrdinals = Array.from({ length: 15 }, (_, index) => index + 1);
  if (
    JSON.stringify(deployment.workloads.map(({ ordinal }) => ordinal)) !==
    JSON.stringify(expectedOrdinals)
  )
    throw new Error("Stage C workload ordinals must be contiguous and ordered");

  const expectedResources = resourcePlan.workspaces
    .filter(({ name }) => WorkspaceSchema.safeParse(name).success)
    .flatMap(({ name, resources }) =>
      resources
        .filter(({ kind }) => WorkloadKindSchema.safeParse(kind).success)
        .map(({ kind, name: resourceName }) =>
          resourceId(name, kind, resourceName),
        ),
    )
    .sort();
  const declaredResources = deployment.workloads
    .map(({ workspace, kind, name }) => resourceId(workspace, kind, name))
    .sort();
  if (JSON.stringify(declaredResources) !== JSON.stringify(expectedResources))
    throw new Error("Deployment map differs from the persistent resource plan");

  const uniqueManifests = new Set<string>();
  const uniqueImages = new Set<string>();
  const uniqueContexts = new Set<string>();
  const manifestSources: string[] = [];
  const manifestsByName = new Map<string, z.infer<typeof ManifestSchema>>();
  const memoryMiB = { sandboxes: 0, functions: 0, jobs: 0 };
  const trustDomainCounts = {
    "abl-core": 0,
    "abl-private": 0,
    "abl-public": 0,
    "abl-competition": 0,
  };
  for (const workload of deployment.workloads) {
    if (expectedTrustDomains.get(workload.name) !== workload.trustDomain)
      throw new Error(
        `Stage C trust-domain assignment differs for ${workload.name}`,
      );
    trustDomainCounts[workload.trustDomain] += 1;
    if (
      workload.manifest.endsWith(".example.yaml") ||
      workload.manifest.includes("/model-")
    )
      throw new Error(
        `Stage C includes a prohibited manifest: ${workload.manifest}`,
      );
    if (uniqueManifests.has(workload.manifest))
      throw new Error(`Stage C repeats manifest ${workload.manifest}`);
    if (uniqueImages.has(workload.imageName))
      throw new Error(`Stage C repeats image ${workload.imageName}`);
    if (uniqueContexts.has(workload.imageContext))
      throw new Error(`Stage C repeats image context ${workload.imageContext}`);
    uniqueManifests.add(workload.manifest);
    uniqueImages.add(workload.imageName);
    uniqueContexts.add(workload.imageContext);

    const manifestSource = await readFile(
      resolve(root, workload.manifest),
      "utf8",
    );
    const manifest = ManifestSchema.parse(parse(manifestSource) as unknown);
    manifestSources.push(manifestSource);
    manifestsByName.set(workload.name, manifest);
    if (
      manifest.kind !== workload.kind ||
      manifest.metadata.name !== workload.name
    )
      throw new Error(`Manifest identity differs for ${workload.name}`);
    if (manifest.metadata.labels["abl-trust-domain"] !== workload.trustDomain)
      throw new Error(`Manifest trust domain differs for ${workload.name}`);
    if (manifest.spec.public === true)
      throw new Error(`Stage C workload is public: ${workload.name}`);
    if (workload.kind === "Function" && manifest.spec.public !== false)
      throw new Error(
        `Stage C Function lacks explicit private mode: ${workload.name}`,
      );
    if (
      workload.kind === "Function" &&
      (manifest.spec.runtime.minScale !== 0 ||
        manifest.spec.runtime.maxScale !== 1)
    )
      throw new Error(
        `Stage C Function exceeds its scale-to-zero quota: ${workload.name}`,
      );
    if (manifest.spec.runtime.memory !== workload.memoryMiB)
      throw new Error(`Manifest memory differs for ${workload.name}`);
    if (manifest.spec.runtime.image !== `\${${workload.imageEnvironment}}`)
      throw new Error(`Manifest image input differs for ${workload.name}`);
    const expectedPrivateEndpoint = workload.kind !== "Job";
    if (workload.privateEndpoint !== expectedPrivateEndpoint)
      throw new Error(
        `Private endpoint classification differs for ${workload.name}`,
      );

    if (workload.kind === "Sandbox") memoryMiB.sandboxes += workload.memoryMiB;
    else if (workload.kind === "Function")
      memoryMiB.functions += workload.memoryMiB;
    else memoryMiB.jobs += workload.memoryMiB;
  }
  if (
    memoryMiB.sandboxes !== costEnvelope.usageCaps.sandboxAllocatedGiB * 1024 ||
    memoryMiB.functions !== costEnvelope.usageCaps.mcpAllocatedGiB * 1024 ||
    memoryMiB.jobs !== costEnvelope.usageCaps.jobAllocatedGiB * 1024
  )
    throw new Error("Deployment memory differs from the Stage C cost envelope");

  const candidateProvisioner = manifestsByName.get("abl-candidate-provisioner");
  if (candidateProvisioner === undefined)
    throw new Error("Candidate provisioner manifest is missing");
  const candidateWorkspace = candidateProvisioner.spec.runtime.envs?.find(
    ({ name }) => name === "ABL_CANDIDATE_WORKSPACE",
  )?.value;
  if (candidateWorkspace !== "agent-basketball-league")
    throw new Error(
      "Candidate provisioner does not target agent-basketball-league",
    );
  const environmentValue = (
    manifest: z.infer<typeof ManifestSchema>,
    name: string,
  ) => manifest.spec.runtime.envs?.find((entry) => entry.name === name)?.value;
  const storageBroker = manifestsByName.get("abl-private-storage-broker");
  if (
    storageBroker === undefined ||
    environmentValue(
      storageBroker,
      "ABL_CAREER_STORAGE_SERVICE_CREDENTIAL_B64",
    ) !== "${ABL_CAREER_STORAGE_SERVICE_CREDENTIAL_B64}" ||
    environmentValue(
      candidateProvisioner,
      "ABL_CANDIDATE_STORAGE_SERVICE_CREDENTIAL_B64",
    ) !== "${ABL_CAREER_STORAGE_SERVICE_CREDENTIAL_B64}"
  )
    throw new Error(
      "Career storage gateway credential is not paired across provisioning and storage",
    );

  const privateEndpointCount = deployment.workloads.filter(
    ({ privateEndpoint }) => privateEndpoint,
  ).length;
  if (
    privateEndpointCount !== resourcePlan.resourceCounts.privatePreviews ||
    uniqueImages.size !== deployment.workloads.length
  )
    throw new Error("Deployment endpoint or image count differs from policy");

  const deploymentHash = createHash("sha256");
  deploymentHash.update(deploymentSource).update("\0");
  for (const [index, source] of manifestSources.entries())
    deploymentHash
      .update(deployment.workloads[index]!.manifest)
      .update("\0")
      .update(source)
      .update("\0");
  return {
    status: "PASS",
    workloadCount: deployment.workloads.length,
    privateEndpointCount,
    imageCount: uniqueImages.size,
    trustDomainCounts,
    memoryMiB,
    deploymentDigest: `0x${deploymentHash.digest("hex")}`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validatePersistentDeployment()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
