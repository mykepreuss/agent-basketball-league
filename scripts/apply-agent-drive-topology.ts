import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { DriveInstance, SandboxInstance } from "@blaxel/core";
import { z } from "zod";

const WorkspaceSchema = z.enum([
  "abl-core",
  "abl-private",
  "abl-public",
  "agent-basketball-league",
]);
const DrivePermissionSchema = z.strictObject({
  labels: z
    .record(z.string(), z.string())
    .refine(
      (labels) => Object.keys(labels).length > 0,
      "Drive permission labels cannot be empty",
    ),
  mode: z.enum(["read", "read-write"]),
  path: z.string().startsWith("/"),
});
const ConfigurationSchema = z.strictObject({
  status: z.enum([
    "APPROVED_ARCHITECTURE_NOT_PROVISIONED",
    "READY_FOR_DIGEST_BOUND_AUTHORIZATION",
    "APPROVED_DEPLOYMENT_IN_PROGRESS",
  ]),
  drives: z.array(
    z.strictObject({
      workspace: WorkspaceSchema,
      name: z.string().min(1).max(49),
      region: z.literal("us-was-1"),
      permissions: z.array(DrivePermissionSchema).min(1),
    }),
  ),
  mounts: z.array(
    z.strictObject({
      resource: z.string().min(1).max(49),
      kind: z.literal("Sandbox"),
      workspace: WorkspaceSchema,
      drive: z.string().min(1).max(49),
      drivePath: z.string().startsWith("/"),
      mountPath: z.string().startsWith("/"),
      mode: z.enum(["read-only", "read-write"]),
    }),
  ),
  careerBodyMounts: z.array(z.never()).max(0),
  s3EndpointAllowed: z.literal(false).optional(),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

if (required("ABL_PLATFORM_MUTATION_MODE") !== "APPROVED_APPLY")
  throw new Error("Agent Drive mutation requires APPROVED_APPLY mode");
const authorizationId = z
  .string()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .parse(required("ABL_PLATFORM_MUTATION_AUTHORIZATION_ID"));
const workspace = WorkspaceSchema.parse(required("ABL_TOPOLOGY_WORKSPACE"));
if (required("BL_WORKSPACE") !== workspace)
  throw new Error("Blaxel SDK workspace differs from the topology target");

const configurationPath =
  process.env.ABL_DRIVE_TOPOLOGY_CONFIG ??
  "infra/blaxel/agent-drive-access.json";
if (
  ![
    "infra/blaxel/agent-drive-access.json",
    "infra/blaxel/founding-alpha-private/drive-access.json",
  ].includes(configurationPath)
)
  throw new Error("Agent Drive topology path is not approved");
const source = ConfigurationSchema.parse(
  JSON.parse(await readFile(resolve(configurationPath), "utf8")),
);
const drives = source.drives.filter(
  (candidate) => candidate.workspace === workspace,
);
if (drives.length === 0)
  throw new Error(
    "The topology workspace must define at least one Agent Drive",
  );
const drivesByName = new Map(drives.map((drive) => [drive.name, drive]));
if (drivesByName.size !== drives.length)
  throw new Error("Agent Drive names must be unique within the workspace");
for (const mount of source.mounts.filter(
  (candidate) => candidate.workspace === workspace,
)) {
  if (!drivesByName.has(mount.drive))
    throw new Error(`Mount references undeclared Agent Drive ${mount.drive}`);
}

const provisionedDrives: Array<{ name: string; region: string }> = [];
for (const drivePolicy of drives) {
  const drive = await DriveInstance.createIfNotExists({
    name: drivePolicy.name,
    displayName: `ABL ${drivePolicy.name} durable state`,
    region: drivePolicy.region,
    labels: {
      "abl-storage-role": "agent-drive",
      "abl-authority-workspace": workspace,
      "abl-drive-name": drivePolicy.name,
    },
    permissions: drivePolicy.permissions,
  });
  if (
    drive.name !== drivePolicy.name ||
    drive.region !== drivePolicy.region ||
    drive.metadata.workspace !== workspace ||
    !isDeepStrictEqual(drive.permissions, drivePolicy.permissions)
  )
    throw new Error(`Existing Agent Drive drifted: ${drivePolicy.name}`);
  provisionedDrives.push({ name: drive.name, region: drive.region });
}

const mounted: Array<{
  resource: string;
  drivePath: string;
  mountPath: string;
  readOnly: boolean;
}> = [];
for (const policy of source.mounts.filter(
  (candidate) => candidate.workspace === workspace,
)) {
  const drivePolicy = drivesByName.get(policy.drive)!;
  const sandbox = await SandboxInstance.get(policy.resource);
  if (sandbox.metadata.workspace !== workspace)
    throw new Error(`Sandbox ${policy.resource} is in another workspace`);
  const permission = drivePolicy.permissions.find(
    (candidate) =>
      candidate.path === policy.drivePath &&
      candidate.mode ===
        (policy.mode === "read-only" ? "read" : "read-write") &&
      Object.entries(candidate.labels).every(
        ([name, value]) => sandbox.metadata.labels?.[name] === value,
      ),
  );
  if (permission === undefined)
    throw new Error(
      `Sandbox ${policy.resource} lacks its exact Drive permission`,
    );
  const desired = {
    driveName: drivePolicy.name,
    drivePath: policy.drivePath,
    mountPath: policy.mountPath,
    readOnly: policy.mode === "read-only",
  };
  const existing = (await sandbox.drives.list()).find(
    (candidate) => candidate.mountPath === policy.mountPath,
  );
  if (existing === undefined) await sandbox.drives.mount(desired);
  else if (
    existing.driveName !== desired.driveName ||
    existing.drivePath !== desired.drivePath ||
    (existing.readOnly ?? false) !== desired.readOnly
  )
    throw new Error(`Agent Drive mount drifted on ${policy.resource}`);
  mounted.push({
    resource: policy.resource,
    drivePath: policy.drivePath,
    mountPath: policy.mountPath,
    readOnly: desired.readOnly,
  });
}

process.stdout.write(
  `${JSON.stringify({
    authorizationId,
    workspace,
    drives: provisionedDrives,
    mounted,
    careerBodyMounts: 0,
  })}\n`,
);
