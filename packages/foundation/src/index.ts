import { z } from "zod";

export * from "./service-auth.js";

export const WorkspaceNameSchema = z.enum([
  "abl-core",
  "abl-private",
  "abl-competition",
  "abl-public",
]);
export type WorkspaceName = z.infer<typeof WorkspaceNameSchema>;

const ExternalNameSchema = z.enum([
  "base",
  "canonical-postgres",
  "agent-drive-direct",
]);

const WorkspaceSpecSchema = z.strictObject({
  name: WorkspaceNameSchema,
  displayName: z.string().min(1),
  responsibilities: z.array(z.string().min(1)).min(1),
  prohibitedAccess: z.array(z.string().min(1)).min(1),
});

const AllowedCallSchema = z.strictObject({
  from: WorkspaceNameSchema,
  to: z.union([WorkspaceNameSchema, ExternalNameSchema]),
  capabilities: z.array(z.string().min(1)).min(1),
});

const ForbiddenCallSchema = z.strictObject({
  from: WorkspaceNameSchema,
  to: z.union([WorkspaceNameSchema, ExternalNameSchema]),
});

export const TopologySchema = z.strictObject({
  $schema: z.literal("https://json-schema.org/draft/2020-12/schema"),
  version: z.string().min(1),
  region: z.literal("us-was-1"),
  workspaces: z.array(WorkspaceSpecSchema).length(4),
  allowedCalls: z.array(AllowedCallSchema),
  explicitlyForbiddenCalls: z.array(ForbiddenCallSchema),
});

export type Topology = z.infer<typeof TopologySchema>;

export function validateTopology(input: unknown): Topology {
  const topology = TopologySchema.parse(input);
  const names = new Set(topology.workspaces.map((workspace) => workspace.name));
  if (names.size !== 4)
    throw new Error("Topology must contain four distinct workspaces");

  const allowed = new Set(
    topology.allowedCalls.map((edge) => `${edge.from}->${edge.to}`),
  );
  for (const edge of topology.explicitlyForbiddenCalls) {
    if (allowed.has(`${edge.from}->${edge.to}`)) {
      throw new Error(
        `Call is both allowed and forbidden: ${edge.from}->${edge.to}`,
      );
    }
  }

  return topology;
}

export const forbiddenCompetitionEnvironmentNames = new Set([
  "DATABASE_URL",
  "BL_API_KEY",
  "BLAXEL_API_KEY",
  "DRIVE_TOKEN",
  "BLFS_TOKEN",
  "NEON_DATABASE_URL",
  "CANONICAL_POSTGRES_URL",
  "PRIVATE_STORAGE_KEY",
  "MODEL_PROVIDER_API_KEY",
]);

export const privateTelemetryOptOut = {
  DO_NOT_TRACK: "1",
  BL_ENABLE_OPENTELEMETRY: "false",
  ABL_LOG_CONTENT: "false",
} as const;

export function assertImmutableImageReference(image: string): void {
  if (!image.includes("DIGEST") && !image.includes("@sha256:")) {
    throw new Error(
      `Image must be supplied as an immutable digest reference: ${image}`,
    );
  }
  if (image.endsWith(":latest"))
    throw new Error("Latest image tags are forbidden");
}
