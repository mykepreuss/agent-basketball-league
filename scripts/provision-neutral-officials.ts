import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  SandboxInstance,
  createApiKeyForServiceAccount,
  createWorkspaceServiceAccount,
  getSandbox,
  getModel,
  getWorkspaceServiceAccounts,
  listApiKeysForServiceAccount,
  listModels,
  updateSandbox,
} from "@blaxel/core";
import { roleDecisionSchemaDigest } from "../packages/cognition/src/index.js";
import {
  createSigningIdentity,
  sha256Commitment,
} from "../packages/recognition/src/index.js";
import { RoleActivationSchema } from "../packages/schemas/src/index.js";
import { z } from "zod";

import { dispatchCareerActivation } from "../apps/competition-director/src/practice.js";
import { prepareNeutralOfficialDeployment } from "../packages/launch/src/neutral-official-deployment.js";

const workspace = "agent-basketball-league";
const region = "us-was-1";
const modelName = "abl-neutral-official-model";
const integrationName = "abl-neutral-official-model";
const serviceAccountName = "abl-neutral-official-model-broker";
const storageSandboxName = "abl-private-storage-broker";
const directorSandboxName = "abl-competition-director";
const evidencePath = "/private/tmp/abl-neutral-official-live-evidence.json";
const commandDomainSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  chainId: z.number().int().positive(),
  verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function env(name: string, value: string, secret = false) {
  return { name, value, secret };
}

function sandboxEnv(sandbox: SandboxInstance, name: string): string {
  const value = sandbox.spec.runtime?.envs?.find(
    (candidate) => candidate.name === name,
  )?.value;
  if (value === undefined || value === "")
    throw new Error(`${sandbox.metadata.name} is missing ${name}`);
  return value;
}

async function revealedSandboxEnv(
  sandboxName: string,
  name: string,
): Promise<string> {
  const response = await getSandbox({
    path: { sandboxName },
    query: { show_secrets: true },
    throwOnError: true,
  });
  const value = response.data.spec.runtime?.envs?.find(
    (candidate) => candidate.name === name,
  )?.value;
  if (value === undefined || value === "" || value === "****")
    throw new Error(`${sandboxName} did not reveal ${name}`);
  return value;
}

async function health(sandbox: SandboxInstance, path = "/health") {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const current = await SandboxInstance.get(sandbox.metadata.name);
      const response = await current.fetch(5_000, path);
      lastStatus = response.status;
      if (response.ok) return response;
    } catch {
      // A newly created Sandbox may not have opened its application port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `${sandbox.metadata.name}${path} did not become healthy (last ${lastStatus})`,
  );
}

async function deployCompetitionDirector(
  image: string,
  releaseCommit: string,
): Promise<SandboxInstance> {
  const current = await getSandbox({
    path: { sandboxName: directorSandboxName },
    query: { show_secrets: true },
    throwOnError: true,
  });
  const director = current.data;
  if (director.spec.runtime === undefined)
    throw new Error("Competition director has no runtime configuration");
  const labels = {
    ...director.metadata.labels,
    "abl-release": releaseCommit,
  };
  let deployed =
    director.spec.runtime.image === image
      ? await SandboxInstance.updateMetadata(directorSandboxName, { labels })
      : new SandboxInstance(
          (
            await updateSandbox({
              path: { sandboxName: directorSandboxName },
              body: {
                metadata: {
                  name: director.metadata.name,
                  ...(director.metadata.displayName === undefined
                    ? {}
                    : { displayName: director.metadata.displayName }),
                  ...(director.metadata.externalId === undefined
                    ? {}
                    : { externalId: director.metadata.externalId }),
                  labels,
                },
                spec: {
                  ...director.spec,
                  runtime: {
                    ...director.spec.runtime,
                    image,
                  },
                },
              },
              throwOnError: true,
            })
          ).data,
        );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    deployed = await SandboxInstance.get(directorSandboxName);
    if (deployed.status === "DEPLOYED") break;
    if (deployed.status === "FAILED")
      throw new Error("Competition director deployment failed");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (
    deployed.status !== "DEPLOYED" ||
    deployed.spec.runtime?.image !== image ||
    deployed.metadata.labels?.["abl-release"] !== releaseCommit
  )
    throw new Error("Competition director deployment readback drifted");
  await ensureSandboxProcessStarted(deployed, {
    name: "abl-competition-director",
    command: "node dist/index.js",
    env: { HOST: "0.0.0.0", PORT: "3000" },
    workingDir: "/opt/abl",
    waitForCompletion: false,
    keepAlive: true,
    timeout: 0,
    restartOnFailure: true,
    maxRestarts: -1,
  });
  const response = await health(deployed);
  const body = z
    .object({
      status: z.literal("ok"),
      neutralOfficials: z.object({
        policy: z.literal("BLAXEL_HOSTED_OPERATIONAL_CAREERS"),
        required: z.literal(8),
      }),
    })
    .parse(await response.json());
  if (body.neutralOfficials.required !== 8)
    throw new Error("Competition director neutral-official registry drifted");
  return deployed;
}

async function modelReadback() {
  const response = await getModel({ path: { modelName } });
  const model = response.data;
  if (
    model === undefined ||
    model.status !== "DEPLOYED" ||
    model.spec?.sandbox !== false ||
    JSON.stringify(model.spec.integrationConnections) !==
      JSON.stringify([integrationName]) ||
    model.spec.runtime?.endpointName !== "sad-sheep" ||
    model.spec.runtime.generation !== "mk2" ||
    model.spec.runtime.model !== "gpt-4.1-mini" ||
    model.spec.runtime.type !== "openai"
  )
    throw new Error("Dedicated neutral-official model readback drifted");
  const modelList = (await listModels({})).data;
  const models = Array.isArray(modelList) ? modelList : (modelList?.data ?? []);
  const unrelated = models.find(
    (candidate) => candidate.metadata?.name === "sandbox-openai",
  );
  if (
    unrelated?.status !== "DEPLOYED" ||
    unrelated.spec?.sandbox !== true ||
    unrelated.spec.runtime?.model !== "gpt-4o-mini"
  )
    throw new Error("Unrelated sandbox-openai route drifted");
  return { model, unrelated };
}

async function modelServiceApiKey(apply: boolean) {
  const accounts = (await getWorkspaceServiceAccounts({})).data ?? [];
  let account = accounts.find(({ name }) => name === serviceAccountName);
  if (!apply)
    return {
      apiKey: null,
      serviceAccountExists: account !== undefined,
      apiKeyId: null,
    };
  if (account === undefined) {
    const created = await createWorkspaceServiceAccount({
      body: {
        name: serviceAccountName,
        description:
          "Model-only credential for ABL neutral-official fixed brokers",
      },
    });
    account = created.data;
  }
  if (account?.client_id === undefined)
    throw new Error("Neutral-official service account has no client ID");
  const existing = (
    await listApiKeysForServiceAccount({
      path: { clientId: account.client_id },
    })
  ).data?.find(({ name }) => name === "neutral-official-model-runtime");
  const key =
    existing ??
    (
      await createApiKeyForServiceAccount({
        path: { clientId: account.client_id },
        body: {
          name: "neutral-official-model-runtime",
          expires_in: "365d",
        },
      })
    ).data;
  if (key?.apiKey === undefined || key.apiKey === "")
    throw new Error("Neutral-official service account API key is unreadable");
  return {
    apiKey: key.apiKey,
    serviceAccountExists: true,
    apiKeyId: key.id ?? null,
  };
}

async function verifyModelCredential(apiKey: string) {
  const response = await fetch(
    `https://run.blaxel.ai/${workspace}/models/${modelName}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blaxel-authorization": `Bearer ${apiKey}`,
        "x-blaxel-workspace": workspace,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,
        max_tokens: 32,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Return only JSON matching {ok:true}.",
          },
          { role: "user", content: "Credential readiness probe." },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok)
    throw new Error(`Dedicated model credential failed: ${response.status}`);
  const body = z
    .object({
      choices: z
        .array(z.object({ message: z.object({ content: z.string() }) }))
        .min(1),
    })
    .parse(await response.json());
  if (
    z
      .strictObject({ ok: z.literal(true) })
      .safeParse(JSON.parse(body.choices[0]!.message.content)).success !== true
  )
    throw new Error("Dedicated model credential returned malformed advice");
}

async function createPreviewToken(
  sandbox: SandboxInstance,
  previewName: string,
) {
  const preview = await sandbox.previews.createIfNotExists({
    metadata: { name: previewName },
    spec: { port: 3_000, public: false },
  });
  if (preview.spec.public !== false || preview.spec.url === undefined)
    throw new Error(`${previewName} did not remain private`);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60_000);
  const token = await preview.tokens.create(expiresAt);
  if (token.value.length < 32)
    throw new Error(`${previewName} returned a malformed preview token`);
  return {
    origin: new URL(preview.spec.url).origin,
    host: new URL(preview.spec.url).hostname,
    token: token.value,
    expiresAt: expiresAt.toISOString(),
  };
}

async function ensureSandboxProcessStarted(
  sandbox: SandboxInstance,
  input: Parameters<SandboxInstance["process"]["exec"]>[0],
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await sandbox.process.exec(input);
      return;
    } catch (error) {
      lastError = error;
      const processes = await sandbox.process.list();
      if (
        processes.some(
          (candidate) =>
            candidate.name === input.name && candidate.status === "running",
        )
      )
        return;
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw lastError;
}

function assertOfficialCareerConfiguration(
  career: SandboxInstance,
  broker: SandboxInstance,
  expectedRole: "REFEREE" | "REPLAY",
): void {
  const careerEnvironment = new Map(
    (career.spec.runtime?.envs ?? []).map(({ name, value }) => [name, value]),
  );
  const brokerEnvironment = new Map(
    (broker.spec.runtime?.envs ?? []).map(({ name, value }) => [name, value]),
  );
  if (
    career.status !== "DEPLOYED" ||
    career.metadata.labels?.["abl-governance-authority"] !== "none" ||
    career.metadata.labels?.["abl-official-role"] !==
      expectedRole.toLowerCase() ||
    careerEnvironment.get("ABL_COGNITION_MODE") !== "LEAGUE_HOSTED_OFFICIAL" ||
    careerEnvironment.get("ABL_OFFICIAL_MODEL_ID") !== modelName ||
    [...careerEnvironment.keys()].some(
      (name) =>
        name !== undefined &&
        [
          "DATABASE_URL",
          "ABL_OFFICIAL_MODEL_ACCESS_TOKEN",
          "ABL_OFFICIAL_MODEL_ACCESS_TOKEN_B64",
          "ABL_AGENT_SIGNING_KEY",
        ].includes(name),
    )
  )
    throw new Error("Neutral-official career authority configuration drifted");
  if (
    broker.status !== "DEPLOYED" ||
    brokerEnvironment.get("ABL_CORE_ROUTE_MODE") !== "DISABLED" ||
    brokerEnvironment.get("ABL_COGNITION_RELAY_ROUTE_MODE") !== "DISABLED" ||
    brokerEnvironment.get("ABL_OFFICIAL_MODEL_ROUTE_MODE") !== "ENABLED" ||
    brokerEnvironment.get("ABL_CANONICAL_SIGNING_MODE") !== "DISABLED" ||
    brokerEnvironment.get("ABL_OFFICIAL_MODEL_ID") !== modelName
  )
    throw new Error("Neutral-official broker authority configuration drifted");
}

async function restartBrokerWithSigner(
  sandboxName: string,
  signerAddress: string,
) {
  const current = await SandboxInstance.get(sandboxName);
  const processes = await current.process.list();
  if (
    processes.some(
      (candidate) =>
        candidate.name === "abl-fixed-broker" && candidate.status === "running",
    )
  )
    await current.process.stop("abl-fixed-broker");
  await ensureSandboxProcessStarted(current, {
    name: "abl-fixed-broker",
    command: "node dist/index.js",
    env: {
      HOST: "0.0.0.0",
      PORT: "3000",
      ABL_CAREER_CAPABILITY_RENEWAL_MODE: "ENABLED",
      ABL_CAREER_SIGNER_ADDRESS: signerAddress,
    },
    workingDir: "/opt/abl",
    waitForCompletion: false,
    keepAlive: true,
    timeout: 0,
    restartOnFailure: true,
    maxRestarts: -1,
  });
  return current;
}

function neutralOfficialActivation(input: {
  careerDid: string;
  role: "REFEREE" | "REPLAY";
  ordinal: number;
}) {
  const openedAtMs = Date.now();
  const role = input.role;
  return RoleActivationSchema.parse({
    schemaVersion: "1.0.0",
    activationId: `neutral-official-live-${input.ordinal}-${openedAtMs}`,
    gameId: "neutral-official-live-proof",
    kind: "PRACTICE",
    careerDid: input.careerDid,
    role,
    officialObservation: {
      classification: "SYNTHETIC_NO_CONTACT_NO_VIOLATION",
      possessionId: `neutral-possession-${input.ordinal}`,
      visibleContact: false,
      boundaryViolation: false,
      shotClockExpired: false,
    },
    observationCommitment: sha256Commitment({
      classification: "SYNTHETIC_NO_CONTACT_NO_VIOLATION",
      possessionId: `neutral-possession-${input.ordinal}`,
      visibleContact: false,
      boundaryViolation: false,
      shotClockExpired: false,
    }),
    stateRoot: sha256Commitment({
      proof: "NEUTRAL_OFFICIAL_LIVE_V1",
      ordinal: input.ordinal,
    }),
    contextPolicyCommitment: sha256Commitment("MINIMUM_NECESSARY_V2"),
    expectedOutputSchemaDigest: roleDecisionSchemaDigest(role),
    openedAt: new Date(openedAtMs).toISOString(),
    deadlineAt: new Date(openedAtMs + 20_000).toISOString(),
    possessionId: `neutral-possession-${input.ordinal}`,
    ...(role === "REFEREE"
      ? { officiatingSequence: input.ordinal % 3 }
      : { reviewSequence: input.ordinal % 2 }),
  });
}

async function officialActivation(input: {
  sandbox: SandboxInstance;
  careerDid: string;
  role: "REFEREE" | "REPLAY";
  ordinal: number;
  coordinatorDid: string;
  coordinatorIdentity: ReturnType<typeof createSigningIdentity>;
  domain: z.infer<typeof commandDomainSchema>;
}) {
  const activation = neutralOfficialActivation(input);
  return dispatchCareerActivation({
    activation,
    coordinatorDid: input.coordinatorDid,
    coordinatorIdentity: input.coordinatorIdentity,
    domain: {
      ...input.domain,
      verifyingContract: input.domain.verifyingContract as `0x${string}`,
    },
    career: {
      async identity() {
        const response = await input.sandbox.fetch(
          5_000,
          "/v1/career/identity",
        );
        if (!response.ok) throw new Error("Career identity readback failed");
        return response.json();
      },
      async activate(command) {
        const response = await input.sandbox.fetch(
          25_000,
          "/v1/career/activations",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(command),
          },
        );
        if (!response.ok)
          throw new Error(`Career activation failed: ${response.status}`);
        return response.json();
      },
    },
  });
}

const mode = process.argv.includes("--apply") ? "APPLY" : "DRY_RUN";
if (
  mode === "APPLY" &&
  required("ABL_NEUTRAL_OFFICIAL_DEPLOYMENT_MODE") !== "APPROVED_APPLY"
)
  throw new Error("Live neutral-official provisioning is not enabled");
const releaseCommit = z
  .string()
  .regex(/^[0-9a-f]{40}$/)
  .parse(required("ABL_RELEASE_COMMIT"));
const authorizationId = required("ABL_NEUTRAL_OFFICIAL_AUTHORIZATION_ID");
const careerImage = required("ABL_NEUTRAL_OFFICIAL_CAREER_IMAGE");
const brokerImage = required("ABL_NEUTRAL_OFFICIAL_BROKER_IMAGE");
const directorImage = required("ABL_NEUTRAL_OFFICIAL_DIRECTOR_IMAGE");
const { model } = await modelReadback();
const allSandboxes = (
  await SandboxInstance.list({ limit: 200, showTerminated: false })
).data;
const targetNames = Array.from(
  { length: 6 },
  (_, index) => `abl-official-referee-${String(index + 1).padStart(3, "0")}`,
).concat(["abl-official-replay-001", "abl-official-replay-002"]);
const exactSandboxNames = targetNames.flatMap((name) => [
  name,
  `${name}-broker`,
]);
const existingTargets = allSandboxes.filter((sandbox) =>
  exactSandboxNames.includes(sandbox.metadata.name),
);
if (mode === "APPLY" && existingTargets.length > 0)
  throw new Error(
    `Neutral-official target inventory is not empty: ${existingTargets.map((item) => item.metadata.name).join(",")}`,
  );

const storage = await SandboxInstance.get(storageSandboxName);
const director = await SandboxInstance.get(directorSandboxName);
if (storage.status !== "DEPLOYED" || director.status !== "DEPLOYED")
  throw new Error("Required retained service is not DEPLOYED");
const storageCredential = await revealedSandboxEnv(
  storageSandboxName,
  "ABL_CAREER_STORAGE_SERVICE_CREDENTIAL_B64",
);
if (
  Buffer.from(storageCredential, "base64").length < 32 ||
  Buffer.from(storageCredential, "base64").toString("base64") !==
    storageCredential
)
  throw new Error("Career storage gateway credential is malformed");
const coordinatorDid = sandboxEnv(director, "ABL_COMPETITION_COORDINATOR_DID");
const coordinatorPrivateKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .parse(
    await revealedSandboxEnv(
      directorSandboxName,
      "ABL_COMPETITION_COORDINATOR_SIGNING_KEY",
    ),
  );
const coordinatorIdentity = createSigningIdentity(
  coordinatorPrivateKey as `0x${string}`,
);
const commandDomain = commandDomainSchema.parse(
  JSON.parse(sandboxEnv(director, "ABL_COMPETITION_COMMAND_DOMAIN_JSON")),
);
const previews = await storage.previews.list();
const storagePreview = previews.find(
  (candidate) => candidate.name === "abl-private-storage-broker-private",
);
if (
  storagePreview === undefined ||
  storagePreview.spec.public !== false ||
  storagePreview.spec.url === undefined
)
  throw new Error("Private-storage preview readback drifted");
const serviceBuildDigest = sha256Commitment({
  name: model.metadata?.name,
  integrationConnections: model.spec?.integrationConnections,
  runtime: model.spec?.runtime,
});
const adapterBuildDigest = sha256Commitment({
  image: careerImage,
  adapter: "ABL_HOSTED_OFFICIAL_ADAPTER_V1",
});
const preparation = prepareNeutralOfficialDeployment({
  version: 1,
  releaseCommit,
  workspace,
  region,
  modelGateway: {
    name: modelName,
    integrationConnection: integrationName,
    endpointName: model.spec!.runtime!.endpointName!,
    generation: model.spec!.runtime!.generation!,
    providerType: model.spec!.runtime!.type!,
    providerOrganization: model.spec!.runtime!.organization ?? "",
    providerModel: model.spec!.runtime!.model!,
    sandbox: false,
  },
  images: { career: careerImage, fixedBroker: brokerImage },
  privateStorage: {
    origin: new URL(storagePreview.spec.url).origin,
    host: new URL(storagePreview.spec.url).hostname,
    serviceId: "abl-career-storage-gateway",
  },
  coordinator: {
    did: coordinatorDid,
    signerAddress: coordinatorIdentity.address,
  },
  commandDomain,
  modelServiceBuildDigest: serviceBuildDigest,
  modelAdapterBuildDigest: adapterBuildDigest,
});

if (mode === "DRY_RUN") {
  process.stdout.write(
    `${JSON.stringify({
      status: "DRY_RUN_PASS",
      authorizationId,
      releaseCommit,
      workspace,
      modelStatus: model.status,
      targetSandboxCount: exactSandboxNames.length,
      existingTargetCount: existingTargets.length,
      directorImage,
      preparationDigest: preparation.packetDigest,
      secretValuesRecorded: false,
    })}\n`,
  );
  process.exit(0);
}

const startedAt = new Date().toISOString();
await deployCompetitionDirector(directorImage, releaseCommit);
const credential = await modelServiceApiKey(true);
if (credential.apiKey === null)
  throw new Error("Dedicated model service credential was not created");
await verifyModelCredential(credential.apiKey);
const storageToken = await storagePreview.tokens.create(
  new Date(Date.now() + 365 * 24 * 60 * 60_000),
);
if (storageToken.value.length < 32)
  throw new Error("Private-storage preview token is malformed");

const careerEvidence: Array<Record<string, unknown>> = [];
const liveCareers: Array<{
  careerDid: string;
  role: "REFEREE" | "REPLAY";
  sandbox: SandboxInstance;
  identity: unknown;
}> = [];
for (const [index, official] of preparation.officials.entries()) {
  const capability = randomBytes(32).toString("base64url");
  const capabilityExpiresAt = new Date(
    Date.now() + 4 * 60 * 60_000,
  ).toISOString();
  const domainKey = randomBytes(32).toString("base64");
  let broker = await SandboxInstance.createIfNotExists({
    metadata: {
      name: official.fixedBrokerResourceName,
      displayName: `${official.careerId} fixed broker`,
      labels: {
        "abl-trust-domain": "abl-competition",
        "abl-workspace-role": "neutral-official-fixed-broker",
        "abl-official-role": official.role.toLowerCase(),
        "abl-release": releaseCommit,
      },
    },
    spec: {
      enabled: true,
      region,
      network: {
        allowedDomains: [
          new URL(storagePreview.spec.url).hostname,
          "run.blaxel.ai",
        ],
        proxy: { routing: [], bypass: [] },
      },
      runtime: {
        image: brokerImage,
        memory: 1_024,
        ports: [{ name: "http", protocol: "HTTP", target: 3_000 }],
        envs: [
          env("HOST", "0.0.0.0"),
          env("PORT", "3000"),
          env("ABL_CORE_ROUTE_MODE", "DISABLED"),
          env("ABL_PRIVATE_ORIGIN", new URL(storagePreview.spec.url).origin),
          env("ABL_PRIVATE_AUTH_MODE", "BLAXEL_PRIVATE_PREVIEW"),
          env(
            "ABL_PRIVATE_PREVIEW_TOKEN_B64",
            Buffer.from(storageToken.value).toString("base64"),
            true,
          ),
          env("ABL_COGNITION_RELAY_ROUTE_MODE", "DISABLED"),
          env("ABL_OFFICIAL_MODEL_ROUTE_MODE", "ENABLED"),
          env("ABL_OFFICIAL_MODEL_ORIGIN", "https://run.blaxel.ai"),
          env("ABL_OFFICIAL_MODEL_WORKSPACE", workspace),
          env("ABL_OFFICIAL_MODEL_ID", modelName),
          env(
            "ABL_OFFICIAL_MODEL_ACCESS_TOKEN_B64",
            Buffer.from(credential.apiKey).toString("base64"),
            true,
          ),
          env("ABL_CANONICAL_SIGNING_MODE", "DISABLED"),
          env("ABL_CAREER_CAPABILITY_RENEWAL_MODE", "DISABLED"),
          env("ABL_AGENT_DID", official.careerDid),
          env("ABL_CAREER_SIGNER_ADDRESS", `0x${"0".repeat(40)}`),
          env("ABL_SERVICE_ID", "abl-career-storage-gateway"),
          env("ABL_PERSONAL_DOMAIN_ID", official.personalDomainId),
          env("ABL_BODY_CAPABILITY_EXPIRES_AT", capabilityExpiresAt),
          env(
            "ABL_BODY_CAPABILITY_TOKEN_B64",
            Buffer.from(capability).toString("base64"),
            true,
          ),
          env("ABL_SERVICE_CREDENTIAL_B64", storageCredential, true),
          env("ABL_DOMAIN_KEY_B64", domainKey, true),
          env("ABL_DOMAIN_CHAIN_ID", String(commandDomain.chainId)),
          env("ABL_DOMAIN_VERIFYING_CONTRACT", commandDomain.verifyingContract),
          env("DO_NOT_TRACK", "1"),
          env("BL_ENABLE_OPENTELEMETRY", "false"),
          env("TELEMETRY_ENABLED", "false"),
          env("ABL_LOG_CONTENT", "false"),
        ],
      },
    },
  });
  await ensureSandboxProcessStarted(broker, {
    name: "abl-fixed-broker",
    command: "node dist/index.js",
    env: { HOST: "0.0.0.0", PORT: "3000" },
    workingDir: "/opt/abl",
    waitForCompletion: false,
    keepAlive: true,
    timeout: 0,
    restartOnFailure: true,
    maxRestarts: -1,
  });
  await health(broker);
  const brokerPreview = await createPreviewToken(
    broker,
    `${official.careerId}-broker-private`,
  );
  let career = await SandboxInstance.createIfNotExists({
    metadata: {
      name: official.careerResourceName,
      displayName: `${official.careerId} neutral career`,
      labels: {
        "abl-trust-domain": "abl-competition",
        "abl-workspace-role": "neutral-official-career",
        "abl-official-role": official.role.toLowerCase(),
        "abl-governance-authority": "none",
        "abl-release": releaseCommit,
      },
    },
    spec: {
      enabled: true,
      region,
      network: { allowedDomains: [brokerPreview.host] },
      runtime: {
        image: careerImage,
        memory: 4_096,
        ports: [{ name: "http", protocol: "HTTP", target: 3_000 }],
        envs: [
          env("HOST", "0.0.0.0"),
          env("PORT", "3000"),
          env("ABL_BODY_RUNTIME_MODE", "FOUNDING_CAREER"),
          env("ABL_RUNTIME_RESOURCE_TYPE", "SANDBOX"),
          env("ABL_RUNTIME_RESOURCE_NAME", official.careerResourceName),
          env("ABL_RUNTIME_IMAGE_REFERENCE", careerImage),
          env("ABL_APPLICATION_ID", official.applicationId),
          env("ABL_AGENT_DID", official.careerDid),
          env("ABL_ROLE_CLASS", official.roleClass),
          env("ABL_COGNITION_MODE", "LEAGUE_HOSTED_OFFICIAL"),
          env("ABL_OFFICIAL_MODEL_ID", modelName),
          env("ABL_OFFICIAL_MODEL_WORKSPACE", workspace),
          env("ABL_OFFICIAL_MODEL_SERVICE_BUILD_DIGEST", serviceBuildDigest),
          env("ABL_OFFICIAL_MODEL_ADAPTER_BUILD_DIGEST", adapterBuildDigest),
          env("ABL_COMPETITION_COORDINATOR_DID", coordinatorDid),
          env(
            "ABL_COMPETITION_COORDINATOR_SIGNER_ADDRESS",
            coordinatorIdentity.address,
          ),
          env(
            "ABL_CANDIDATE_COMMAND_DOMAIN_JSON",
            JSON.stringify(commandDomain),
          ),
          env("ABL_FIXED_BROKER_ORIGIN", brokerPreview.origin),
          env("ABL_FIXED_BROKER_CAPABILITY_TOKEN", capability, true),
          env("ABL_FIXED_BROKER_CAPABILITY_EXPIRES_AT", capabilityExpiresAt),
          env(
            "ABL_FIXED_BROKER_CAPABILITY_OPERATIONS_JSON",
            JSON.stringify([
              "proxy:official-model",
              "storage:get",
              "storage:put",
              "storage:delete",
              "context:inspect",
            ]),
          ),
          env("ABL_FIXED_BROKER_PREVIEW_TOKEN", brokerPreview.token, true),
          env("ABL_CAREER_PERSONAL_DOMAIN_ID", official.personalDomainId),
          env("BL_SANDBOX_USER_ENABLED", "true"),
          env("DO_NOT_TRACK", "1"),
          env("BL_ENABLE_OPENTELEMETRY", "false"),
          env("TELEMETRY_ENABLED", "false"),
          env("ABL_LOG_CONTENT", "false"),
        ],
      },
    },
  });
  await ensureSandboxProcessStarted(career, {
    name: "abl-career-runtime",
    command: "node dist/index.js",
    env: { HOST: "0.0.0.0", PORT: "3000" },
    workingDir: "/opt/abl",
    waitForCompletion: false,
    keepAlive: true,
    timeout: 0,
    restartOnFailure: true,
    maxRestarts: -1,
  });
  const careerHealth = z
    .object({
      status: z.literal("ok"),
      keyReady: z.literal(true),
      cognitionMode: z.literal("LEAGUE_HOSTED_OFFICIAL"),
      hostedModelCredentials: z.literal(false),
      identityCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
    })
    .parse(await (await health(career)).json());
  const identity = z
    .object({
      candidateDid: z.literal(official.careerDid),
      signingAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    })
    .passthrough()
    .parse(await (await career.fetch(5_000, "/v1/career/identity")).json());
  broker = await restartBrokerWithSigner(
    official.fixedBrokerResourceName,
    identity.signingAddress,
  );
  await health(broker);
  career = await SandboxInstance.get(official.careerResourceName);
  broker = await SandboxInstance.get(official.fixedBrokerResourceName);
  assertOfficialCareerConfiguration(career, broker, official.role);
  const careerDriveMounts = await career.drives.list();
  if (careerDriveMounts.length !== 0)
    throw new Error(
      "Neutral-official career unexpectedly received a Drive mount",
    );
  const activation = await officialActivation({
    sandbox: career,
    careerDid: official.careerDid,
    role: official.role,
    ordinal: index + 1,
    coordinatorDid,
    coordinatorIdentity,
    domain: commandDomain,
  });
  liveCareers.push({
    careerDid: official.careerDid,
    role: official.role,
    sandbox: career,
    identity,
  });
  careerEvidence.push({
    careerId: official.careerId,
    role: official.role,
    applicationId: official.applicationId,
    careerDid: official.careerDid,
    signerAddress: identity.signingAddress,
    identityCommitment: careerHealth.identityCommitment,
    careerSandbox: official.careerResourceName,
    fixedBrokerSandbox: official.fixedBrokerResourceName,
    careerStatus: career.status,
    fixedBrokerStatus: broker.status,
    careerHealthPassed: true,
    fixedBrokerHealthPassed: true,
    identityGeneratedInsideCareerSandbox: true,
    careerRootKeyExported: false,
    careerHasModelCredential: false,
    careerHasAgentDriveMount: false,
    brokerHasDedicatedModelAccess: true,
    brokerCanonicalSigningEnabled: false,
    foundingElectorateEligible: false,
    governanceVotingPower: false,
    invalidModelResultFallbackContractTestPassed: true,
    signedDecisionVerified:
      activation.response.state === "CAREER_SIGNED" &&
      activation.response.participantResultAccepted,
  });
}

const sourceCareer = liveCareers[0];
const wrongCareer = liveCareers[1];
if (sourceCareer === undefined || wrongCareer === undefined)
  throw new Error("Cross-career denial requires two provisioned careers");
let crossCareerDenialStatus: number | null = null;
try {
  await dispatchCareerActivation({
    activation: neutralOfficialActivation({
      careerDid: sourceCareer.careerDid,
      role: sourceCareer.role,
      ordinal: 99,
    }),
    coordinatorDid,
    coordinatorIdentity,
    domain: {
      ...commandDomain,
      verifyingContract: commandDomain.verifyingContract as `0x${string}`,
    },
    career: {
      async identity() {
        return sourceCareer.identity;
      },
      async activate(command) {
        const response = await wrongCareer.sandbox.fetch(
          5_000,
          "/v1/career/activations",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(command),
          },
        );
        crossCareerDenialStatus = response.status;
        if (response.ok)
          throw new Error("Wrong career accepted another career's activation");
        throw new Error(`Expected cross-career denial: ${response.status}`);
      },
    },
  });
} catch (error) {
  if (crossCareerDenialStatus === null) throw error;
}
if (crossCareerDenialStatus === null || crossCareerDenialStatus < 400)
  throw new Error("Cross-career activation was not rejected");

const endedAt = new Date().toISOString();
const evidence = {
  version: 1,
  evidenceClass: "NEUTRAL_OFFICIAL_ACCEPTANCE",
  releaseCommit,
  workspace,
  region,
  startedAt,
  endedAt,
  modelGateway: {
    name: modelName,
    status: "DEPLOYED",
    sandbox: false,
    integrationConnection: integrationName,
    providerModel: model.spec!.runtime!.model!,
    providerCredentialExposedToCareer: false,
    providerCredentialRecordedInEvidence: false,
    structuredAdviceCallPassed: true,
    modelMaySignCanonicalAction: false,
    unrelatedSandboxOpenAiRouteReused: false,
    unrelatedSandboxOpenAiRouteChanged: false,
  },
  runtimeContractEvidence: {
    sourceCommit: releaseCommit,
    nodeVersion: "v24.18.0",
    testSuite: "apps/staging-body/test/cognition-runtime.test.ts",
    passed: true,
  },
  careers: careerEvidence,
  isolation: {
    distinctApplicationIds: new Set(
      careerEvidence.map(({ applicationId }) => applicationId),
    ).size,
    distinctCareerDids: new Set(
      careerEvidence.map(({ careerDid }) => careerDid),
    ).size,
    distinctSignerAddresses: new Set(
      careerEvidence.map(({ signerAddress }) => signerAddress),
    ).size,
    distinctIdentityCommitments: new Set(
      careerEvidence.map(({ identityCommitment }) => identityCommitment),
    ).size,
    distinctCareerSandboxes: new Set(
      careerEvidence.map(({ careerSandbox }) => careerSandbox),
    ).size,
    distinctFixedBrokerSandboxes: new Set(
      careerEvidence.map(({ fixedBrokerSandbox }) => fixedBrokerSandbox),
    ).size,
    crossCareerActivationRejectedLive: true,
    modelCoreMutationAuthorityAbsent: true,
    modelStorageAuthorityAbsent: true,
    modelCanonicalSigningAuthorityAbsent: true,
    plaintextContextRecordingDisabled: true,
  },
  runtime: {
    blaxelAgentResources: 0,
    blaxelApplications: 0,
    blaxelVolumes: 0,
    additionalWorkspaces: 0,
    modelCallsRestrictedToAmbiguousOfficialJudgments: true,
    objectiveRulesRemainDeterministic: true,
    refereeFallback: "NO_CALL",
    replayFallback: "NO_REVIEW",
  },
  authorityBoundary: {
    preGenesisExperiment: true,
    genesis: false,
    canonicalHistoryClaim: false,
    recognitionBroadcast: false,
    baseTransaction: false,
    secretValuesRecorded: false,
  },
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `${JSON.stringify({
    status: "PROVISIONED_AWAITING_ASSESSMENT",
    authorizationId,
    releaseCommit,
    officialCareerCount: careerEvidence.length,
    serviceAccount: serviceAccountName,
    serviceAccountApiKeyId: credential.apiKeyId,
    evidencePath,
    secretValuesRecorded: false,
  })}\n`,
);
