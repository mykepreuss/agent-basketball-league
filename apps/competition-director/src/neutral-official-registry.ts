import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const ResourceNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const OfficialRoleSchema = z.enum(["REFEREE", "REPLAY"]);

const officialResources = [
  ...Array.from(
    { length: 6 },
    (_, index) =>
      [
        `abl-official-referee-${String(index + 1).padStart(3, "0")}`,
        "REFEREE",
      ] as const,
  ),
  ["abl-official-replay-001", "REPLAY"] as const,
  ["abl-official-replay-002", "REPLAY"] as const,
] as const;

function deterministicApplicationId(careerId: string): string {
  const value = sha256Commitment({
    purpose: "ABL_NEUTRAL_OFFICIAL_APPLICATION_V1",
    careerId,
  }).slice(2, 34);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-7${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

export const NeutralOfficialRegistryEntrySchema = z.strictObject({
  careerId: ResourceNameSchema,
  applicationId: z.uuid(),
  careerDid: z.string().startsWith("did:abl:"),
  role: OfficialRoleSchema,
  roleClass: z.enum(["REFEREE", "REPLAY_OFFICIAL"]),
  careerResourceName: ResourceNameSchema,
});

export type NeutralOfficialRegistryEntry = z.infer<
  typeof NeutralOfficialRegistryEntrySchema
>;

export const NEUTRAL_OFFICIAL_REGISTRY: readonly NeutralOfficialRegistryEntry[] =
  Object.freeze(
    officialResources.map(([careerId, role]) => {
      const applicationId = deterministicApplicationId(careerId);
      return NeutralOfficialRegistryEntrySchema.parse({
        careerId,
        applicationId,
        careerDid: `did:abl:${applicationId}`,
        role,
        roleClass: role === "REFEREE" ? "REFEREE" : "REPLAY_OFFICIAL",
        careerResourceName: careerId,
      });
    }),
  );

export function assertNeutralOfficialSchedule(input: {
  participants: readonly {
    careerDid: string;
    role: "PLAYER" | "COACH" | "REFEREE" | "REPLAY";
    signerAddress: string;
  }[];
  careerResources: Readonly<Record<string, string>>;
}): void {
  const scheduledOfficials = input.participants
    .filter(
      (participant) =>
        participant.role === "REFEREE" || participant.role === "REPLAY",
    )
    .sort((left, right) => left.careerDid.localeCompare(right.careerDid));
  const expectedOfficials = [...NEUTRAL_OFFICIAL_REGISTRY].sort((left, right) =>
    left.careerDid.localeCompare(right.careerDid),
  );
  if (scheduledOfficials.length !== expectedOfficials.length)
    throw new Error(
      "Founding Exhibition requires the complete neutral-official registry",
    );
  for (const [index, expected] of expectedOfficials.entries()) {
    const scheduled = scheduledOfficials[index];
    if (
      scheduled?.careerDid !== expected.careerDid ||
      scheduled.role !== expected.role ||
      input.careerResources[expected.careerDid] !== expected.careerResourceName
    )
      throw new Error(
        "Scheduled officials must match the Blaxel-hosted neutral-official registry",
      );
  }
}
