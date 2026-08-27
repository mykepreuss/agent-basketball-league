import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const officialRoster = [
  ["abl-official-referee-001", "REFEREE"],
  ["abl-official-referee-002", "REFEREE"],
  ["abl-official-referee-003", "REFEREE"],
  ["abl-official-referee-004", "REFEREE"],
  ["abl-official-referee-005", "REFEREE"],
  ["abl-official-referee-006", "REFEREE"],
  ["abl-official-replay-001", "REPLAY"],
  ["abl-official-replay-002", "REPLAY"],
] as const;

const ImmutableSandboxImageSchema = z
  .string()
  .regex(/^sandbox\/[a-z0-9][a-z0-9-]*:[a-z0-9]{12}$/);
const ProviderEndpointNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/);

export const NeutralOfficialDeploymentInputSchema = z
  .strictObject({
    version: z.literal(1),
    releaseCommit: z.string().regex(/^[0-9a-f]{40}$/),
    workspace: z.literal("agent-basketball-league"),
    region: z.literal("us-was-1"),
    modelGateway: z.strictObject({
      name: z.literal("abl-neutral-official-model"),
      integrationConnection: z
        .string()
        .regex(/^abl-neutral-official-[a-z0-9-]+$/)
        .refine((value) => !value.includes("sandbox-openai")),
      endpointName: ProviderEndpointNameSchema,
      generation: z.enum(["mk2", "mk3"]),
      providerType: z.enum([
        "openai",
        "anthropic",
        "mistral",
        "cohere",
        "xai",
        "deepseek",
      ]),
      providerOrganization: z.string().max(200),
      providerModel: z.string().min(1).max(200),
      sandbox: z.literal(false),
    }),
    images: z.strictObject({
      career: ImmutableSandboxImageSchema,
      fixedBroker: ImmutableSandboxImageSchema,
    }),
    privateStorage: z.strictObject({
      origin: z
        .url({ protocol: /^https$/ })
        .refine((value) => new URL(value).origin === value),
      host: z
        .string()
        .regex(
          /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
        ),
      serviceId: z.literal("abl-career-storage-gateway"),
    }),
    coordinator: z.strictObject({
      did: z.string().startsWith("did:").max(500),
      signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    }),
    commandDomain: z.strictObject({
      name: z.string().min(1).max(120),
      version: z.string().min(1).max(40),
      chainId: z.number().int().positive(),
      verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    }),
    modelServiceBuildDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    modelAdapterBuildDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .superRefine((config, context) => {
    if (
      new URL(config.privateStorage.origin).hostname !==
      config.privateStorage.host
    )
      context.addIssue({
        code: "custom",
        path: ["privateStorage", "host"],
        message: "Private-storage host differs from its exact origin",
      });
  });

export type NeutralOfficialDeploymentInput = z.infer<
  typeof NeutralOfficialDeploymentInputSchema
>;

function deterministicApplicationId(careerId: string): string {
  const value = sha256Commitment({
    purpose: "ABL_NEUTRAL_OFFICIAL_APPLICATION_V1",
    careerId,
  }).slice(2, 34);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-7${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

function personalDomainId(careerDid: string): string {
  return `abl-personal-${sha256Commitment({ careerDid, purpose: "CAREER_MEMORY_V2" }).slice(2, 34)}`;
}

export function prepareNeutralOfficialDeployment(input: unknown) {
  const config = NeutralOfficialDeploymentInputSchema.parse(input);
  const officials = officialRoster.map(([careerId, role]) => {
    const applicationId = deterministicApplicationId(careerId);
    const careerDid = `did:abl:${applicationId}`;
    return {
      careerId,
      role,
      roleClass: role === "REFEREE" ? "REFEREE" : "REPLAY_OFFICIAL",
      applicationId,
      careerDid,
      careerResourceName: careerId,
      fixedBrokerResourceName: `${careerId}-broker`,
      personalDomainId: personalDomainId(careerDid),
      capabilitySecretName: `ABL_${careerId.replaceAll("-", "_").toUpperCase()}_CAPABILITY`,
      domainKeySecretName: `ABL_${careerId.replaceAll("-", "_").toUpperCase()}_DOMAIN_KEY`,
    };
  });
  const packet = {
    version: 1 as const,
    packetClass: "NEUTRAL_OFFICIAL_DEPLOYMENT_PREPARATION" as const,
    releaseCommit: config.releaseCommit,
    workspace: config.workspace,
    region: config.region,
    modelGateway: config.modelGateway,
    images: config.images,
    privateStorage: config.privateStorage,
    coordinator: config.coordinator,
    commandDomain: config.commandDomain,
    modelServiceBuildDigest: config.modelServiceBuildDigest,
    modelAdapterBuildDigest: config.modelAdapterBuildDigest,
    officials,
    phases: [
      {
        ordinal: 1,
        name: "MODEL_GATEWAY",
        mutation: "CREATE_DEDICATED_MODEL_GATEWAY",
        requiredReadback: [
          "exact name",
          "DEPLOYED status",
          "sandbox false",
          "dedicated integration connection",
          "exact provider model",
          "unrelated sandbox-openai unchanged",
        ],
      },
      {
        ordinal: 2,
        name: "FIXED_BROKERS",
        mutation: "CREATE_EIGHT_FIXED_BROKER_SANDBOXES_SEQUENTIALLY",
        requiredReadback: [
          "exact immutable image",
          "private storage and model routes only",
          "canonical signing disabled",
          "private preview token created",
        ],
      },
      {
        ordinal: 3,
        name: "CAREER_SANDBOXES",
        mutation: "CREATE_EIGHT_CAREER_SANDBOXES_SEQUENTIALLY",
        requiredReadback: [
          "exact immutable image",
          "no Agent Drive mount",
          "no model credential",
          "identity generated in career Sandbox",
          "distinct public identity receipt",
        ],
      },
      {
        ordinal: 4,
        name: "BROKER_RENEWAL_BINDING",
        mutation: "RESTART_EACH_BROKER_WITH_ITS_CAREER_SIGNER",
        requiredReadback: [
          "capability renewal enabled",
          "signer equals paired career receipt",
          "career and broker health pass",
        ],
      },
      {
        ordinal: 5,
        name: "BOUNDED_ACCEPTANCE",
        mutation: "RUN_STRUCTURED_ADVICE_AND_DENIAL_MATRIX",
        requiredReadback: [
          "valid structured advice",
          "invalid advice fallback",
          "cross-career denial",
          "direct mutation denial",
          "career-signed decision",
          "neutral-official assessor PASS",
        ],
      },
    ],
    secretRequirements: {
      sharedExternalOnly: [
        "ABL_OFFICIAL_MODEL_ACCESS_TOKEN_B64",
        "ABL_PRIVATE_PREVIEW_TOKEN_B64",
        "ABL_STORAGE_SERVICE_CREDENTIAL_B64",
      ],
      generatedPerCareerOutsideEvidence: [
        "body capability token",
        "personal-domain encryption key",
        "private-preview token",
      ],
      generatedInsideCareerSandbox: [
        "career signing root",
        "career encryption root",
      ],
    },
    prohibitions: [
      "REUSE_SANDBOX_OPENAI",
      "EXPORT_CAREER_ROOT_KEY",
      "MODEL_CREDENTIAL_IN_CAREER",
      "AGENT_DRIVE_MOUNT_IN_CAREER",
      "MODEL_CANONICAL_SIGNING",
      "OFFICIAL_FOUNDING_VOTE",
      "BLAXEL_AGENT",
      "BLAXEL_APPLICATION",
      "BLAXEL_VOLUME",
      "ADDITIONAL_WORKSPACE",
      "GENESIS",
    ],
  };
  return { ...packet, packetDigest: sha256Commitment(packet) };
}
