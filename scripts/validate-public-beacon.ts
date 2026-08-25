import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { PublicBeaconSoakPolicySchema } from "../packages/launch/src/index.js";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ResourceSchema = z.strictObject({
  kind: z.enum(["Sandbox", "Function", "Job"]),
  name: z.string().min(1),
});
const PublicResourceSchema = ResourceSchema.extend({
  purpose: z.string().min(1),
  public: z.literal(true),
});
const PlanSchema = z.strictObject({
  $schema: z.string(),
  programId: z.literal("ABL-COMPLETION-01"),
  stage: z.literal("READ_ONLY_BEACON"),
  status: z.literal("PREPARED_AWAITING_PUBLIC_EXPOSURE_APPROVAL"),
  workspace: z.literal("agent-basketball-league"),
  region: z.literal("us-was-1"),
  publicExposure: z.literal("READ_ONLY"),
  recognitionLevel: z.literal("SIGNED_VALID"),
  canonical: z.literal(false),
  genesis: z.literal(false),
  requiresStageCAcceptance: z.literal(true),
  requiresExplicitPublicExposureApproval: z.literal(true),
  publicSurfaces: z.array(PublicResourceSchema).length(2),
  privateSurfaces: z.array(ResourceSchema).length(11),
  candidateIntake: z.strictObject({
    public: z.literal(false),
    mode: z.literal("INVITE_ONLY"),
    publicRequirementsOnly: z.literal(true),
    opensInStage: z.literal("CAPPED_FOUNDING_INTAKE"),
  }),
  discovery: z.strictObject({
    embeddedMcpPath: z.literal("/mcp"),
    skillSource: z.string().url(),
    verifierSource: z.string().url(),
    cleanRoomExternalAgentRequired: z.literal(true),
  }),
  budget: z.strictObject({
    maximumProjectedMonthlyInfrastructureUsd: z.literal(25),
    minimumBlaxelBalanceUsd: z.literal(5),
    automaticTopUp: z.literal(false),
  }),
  publicSoak: z.strictObject({
    monitoringPolicy: z.literal(
      "infra/blaxel/public-beacon/monitoring-policy.json",
    ),
    requiredDurationHours: z.literal(24),
    maximumErrorRate: z.number().positive().max(0.01),
    maximumSampleGapSeconds: z.literal(600),
    canonicalClaimsAllowed: z.literal(0),
    genesisClaimsAllowed: z.literal(0),
  }),
  rollback: z.strictObject({
    action: z.literal("REMOVE_PUBLIC_PREVIEWS_ONLY"),
    retainPersistentWorkloads: z.literal(true),
    restorePublicExposure: z.literal("NONE"),
  }),
  prohibitions: z.array(z.string().min(1)).min(1),
});

const DeploymentSchema = z.object({
  workloads: z.array(
    z
      .object({
        kind: z.enum(["Sandbox", "Function", "Job"]),
        name: z.string().min(1),
        workspace: z.string(),
      })
      .passthrough(),
  ),
});
const RouteCatalogSchema = z.object({
  routes: z.array(
    z
      .object({
        service: z.string(),
        method: z.string(),
        path: z.string(),
        exposure: z.enum(["PUBLIC_DISCOVERY", "PUBLIC_READ_ONLY"]).optional(),
      })
      .passthrough(),
  ),
});

function ids(resources: readonly z.infer<typeof ResourceSchema>[]): string[] {
  return resources.map(({ kind, name }) => `${kind}/${name}`).sort();
}

function routeId(route: {
  service: string;
  method: string;
  path: string;
}): string {
  return `${route.service}:${route.method}:${route.path}`;
}

export async function validatePublicBeacon(root = repositoryRoot) {
  const planPath = join(root, "infra/blaxel/public-beacon/exposure-plan.json");
  const [planSource, deploymentSource, routeCatalogSource, soakPolicySource] =
    await Promise.all([
      readFile(planPath, "utf8"),
      readFile(
        join(root, "infra/blaxel/persistent-pre-genesis/deployment-map.json"),
        "utf8",
      ),
      readFile(join(root, "docs/architecture/ROUTE_CATALOG.json"), "utf8"),
      readFile(
        join(root, "infra/blaxel/public-beacon/monitoring-policy.json"),
        "utf8",
      ),
    ]);
  const plan = PlanSchema.parse(JSON.parse(planSource) as unknown);
  const deployment = DeploymentSchema.parse(
    JSON.parse(deploymentSource) as unknown,
  );
  const routeCatalog = RouteCatalogSchema.parse(
    JSON.parse(routeCatalogSource) as unknown,
  );
  const soakPolicy = PublicBeaconSoakPolicySchema.parse(
    JSON.parse(soakPolicySource) as unknown,
  );

  const expectedPublic = [
    "Sandbox/abl-public-api",
    "Sandbox/abl-spectator-arena",
  ];
  if (
    JSON.stringify(ids(plan.publicSurfaces)) !== JSON.stringify(expectedPublic)
  )
    throw new Error(
      "Stage D public surface differs from the two approved targets",
    );

  const declared = ids([...plan.publicSurfaces, ...plan.privateSurfaces]);
  const deployed = ids(deployment.workloads);
  if (JSON.stringify(declared) !== JSON.stringify(deployed))
    throw new Error("Stage D exposure plan does not classify every workload");

  const invalidPublicRoute = routeCatalog.routes.find(
    (route) =>
      route.exposure !== undefined &&
      route.service !== "abl-public-api" &&
      route.service !== "abl-arena",
  );
  if (invalidPublicRoute)
    throw new Error(
      `Unexpected public route service: ${invalidPublicRoute.service}`,
    );
  const publicPostRoutes = routeCatalog.routes
    .filter((route) => route.exposure !== undefined && route.method === "POST")
    .map(routeId)
    .sort();
  const expectedPublicPostRoutes = [
    "abl-public-api:POST:/a2a",
    "abl-public-api:POST:/mcp",
    "abl-public-api:POST:/v1/practice/decision",
  ];
  if (
    JSON.stringify(publicPostRoutes) !==
    JSON.stringify(expectedPublicPostRoutes)
  )
    throw new Error(
      "Stage D public POST routes differ from the safe allowlist",
    );
  const exposedPrivatePath = routeCatalog.routes.find(
    (route) =>
      route.exposure !== undefined &&
      (route.path.startsWith("/v1/internal/") ||
        route.path.startsWith("/v1/candidate-intake") ||
        route.path.startsWith("/v1/candidates/")),
  );
  if (exposedPrivatePath)
    throw new Error(
      `Stage D exposes a private mutation path: ${routeId(exposedPrivatePath)}`,
    );

  if (
    soakPolicy.requiredDurationHours !==
      plan.publicSoak.requiredDurationHours ||
    soakPolicy.thresholds.maximumErrorRate !==
      plan.publicSoak.maximumErrorRate ||
    soakPolicy.thresholds.maximumSampleGapSeconds !==
      plan.publicSoak.maximumSampleGapSeconds ||
    soakPolicy.thresholds.maximumProjectedMonthlyCostUsd !==
      plan.budget.maximumProjectedMonthlyInfrastructureUsd ||
    soakPolicy.thresholds.minimumBlaxelBalanceUsd !==
      plan.budget.minimumBlaxelBalanceUsd
  )
    throw new Error("Public soak policy differs from the exposure plan");

  const digest = createHash("sha256").update(planSource).digest("hex");
  return {
    status: "PASS" as const,
    publicSurfaceCount: plan.publicSurfaces.length,
    privateSurfaceCount: plan.privateSurfaces.length,
    publicRouteCount: routeCatalog.routes.filter(
      ({ exposure }) => exposure !== undefined,
    ).length,
    requiredPublicCheckCount: soakPolicy.requiredChecks.length,
    exposurePlanDigest: `0x${digest}` as const,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.stdout.write(`${JSON.stringify(await validatePublicBeacon())}\n`);
