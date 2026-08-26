import { createHash, randomBytes } from "node:crypto";

import { SandboxInstance } from "@blaxel/core";
import {
  ImmutableSandboxImageReferenceSchema,
  verifyCandidateRuntimeIdentityReceipt,
  type CandidateRoleClass,
  type CandidateSandboxControlPlane,
} from "@abl/launch";
import {
  CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
  CANDIDATE_WORKFLOW_AGGREGATE_TYPE,
  applyCandidateTransition,
  candidateStateRoot,
} from "@abl/career";
import { SignedCanonicalCommandSchema } from "@abl/schemas";
import { createCanonicalEvent, type CanonicalEvent } from "@abl/recognition";
import { v5 as uuidv5 } from "uuid";
import type { Hex, TypedDataDomain } from "viem";
import { z } from "zod";

const WorkspaceNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const HttpsOriginSchema = z
  .url({ protocol: /^https$/ })
  .refine((value) => new URL(value).pathname === "/", "Origin only");
const Base64SecretSchema = z
  .string()
  .min(44)
  .max(684)
  .refine((value) => Buffer.from(value, "base64").toString("base64") === value);

type SandboxResult = Awaited<
  ReturnType<typeof SandboxInstance.createIfNotExists>
>;

function boundedCandidateSandboxLifecycle() {
  return {
    expirationPolicies: [
      { action: "delete" as const, type: "ttl-max-age" as const, value: "4h" },
    ],
    terminatedRetention: "24h",
  };
}

const FoundingRoleClass = z.enum([
  "PLAYER",
  "COACH",
  "REFEREE",
  "REPLAY_OFFICIAL",
]);

const CandidateRuntimeAssignmentSchema = z.strictObject({
  applicationId: z.uuid(),
  fixedBrokerOrigin: HttpsOriginSchema,
  fixedBrokerResourceName: WorkspaceNameSchema,
  capabilityTokenBase64: Base64SecretSchema,
  previewToken: z
    .string()
    .min(32)
    .max(4_096)
    .refine((value) => !/[\r\n]/.test(value))
    .optional(),
});

export type CandidateRuntimeAssignment = z.infer<
  typeof CandidateRuntimeAssignmentSchema
>;

export type CandidateRuntimeScope =
  | {
      mode: "BOUNDED_SINGLE";
      assignment: CandidateRuntimeAssignment;
    }
  | {
      mode: "POST_GENESIS_SINGLE";
      assignment: CandidateRuntimeAssignment;
    }
  | {
      mode: "CAPPED_FOUNDING";
      assignments: readonly CandidateRuntimeAssignment[];
    }
  | {
      mode: "CAPPED_FOUNDING_AUTO";
    };

function parseRuntimeScope(
  scope: CandidateRuntimeScope,
): CandidateRuntimeScope {
  if (scope.mode === "CAPPED_FOUNDING_AUTO") return scope;
  if (scope.mode !== "CAPPED_FOUNDING") {
    const assignment = CandidateRuntimeAssignmentSchema.parse(scope.assignment);
    if (
      scope.mode === "POST_GENESIS_SINGLE" &&
      assignment.fixedBrokerResourceName !==
        candidateFixedBrokerName(assignment.applicationId)
    )
      throw new Error(
        "Post-Genesis fixed-broker name is not application-derived",
      );
    return {
      mode: scope.mode,
      assignment,
    };
  }
  const assignments = parseCandidateRuntimeAssignments(scope.assignments);
  for (const value of [
    assignments.map(({ applicationId }) => applicationId),
    assignments.map(({ fixedBrokerResourceName }) => fixedBrokerResourceName),
    assignments.map(({ fixedBrokerOrigin }) => fixedBrokerOrigin),
  ])
    if (new Set(value).size !== value.length)
      throw new Error("Founding runtime assignments must be unique");
  for (const assignment of assignments)
    if (
      assignment.fixedBrokerResourceName !==
      candidateFixedBrokerName(assignment.applicationId)
    )
      throw new Error("Founding fixed-broker name is not application-derived");
  return { mode: scope.mode, assignments };
}

export function parseCandidateRuntimeAssignments(
  candidate: unknown,
): readonly CandidateRuntimeAssignment[] {
  return z
    .array(CandidateRuntimeAssignmentSchema)
    .min(1)
    .max(20)
    .parse(candidate);
}

export interface CandidateSandboxFactory {
  createIfNotExists(
    input: Parameters<typeof SandboxInstance.createIfNotExists>[0],
  ): Promise<SandboxResult>;
  get(name: string): Promise<SandboxResult>;
  list(input: {
    externalId: string;
    limit: number;
    showTerminated: boolean;
  }): Promise<{ data: SandboxResult[] }>;
  delete(name: string): Promise<unknown>;
}

export interface BlaxelCandidateControlPlaneOptions {
  workspace: string;
  region: string;
  imageReference: string;
  runtimeScope: CandidateRuntimeScope;
  authorizationId: string;
  genesisEvidenceDigest?: string;
  fixedBrokerImageReference: string;
  coreOrigin?: string;
  corePreviewToken?: string;
  candidateCommandDomain?: TypedDataDomain;
  memory?: number;
  factory?: CandidateSandboxFactory;
}

export class BlaxelCandidateSandboxControlPlane
  implements CandidateSandboxControlPlane
{
  readonly mode = "APPROVED_LIVE" as const;
  readonly #workspace: string;
  readonly #region: string;
  readonly #imageReference: string;
  readonly #runtimeScope: CandidateRuntimeScope;
  readonly #authorizationId: string;
  readonly #genesisEvidenceDigest: `0x${string}` | null;
  readonly #fixedBrokerImageReference: string;
  readonly #coreOrigin: string | null;
  readonly #corePreviewToken: string | null;
  readonly #candidateCommandDomain: TypedDataDomain | null;
  readonly #memory: number;
  readonly #factory: CandidateSandboxFactory;

  constructor(options: BlaxelCandidateControlPlaneOptions) {
    this.#workspace = WorkspaceNameSchema.parse(options.workspace);
    this.#region = z.literal("us-was-1").parse(options.region);
    this.#imageReference = ImmutableSandboxImageReferenceSchema.parse(
      options.imageReference,
    );
    this.#runtimeScope = parseRuntimeScope(options.runtimeScope);
    this.#authorizationId = z
      .string()
      .min(8)
      .max(160)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .parse(options.authorizationId);
    this.#genesisEvidenceDigest =
      this.#runtimeScope.mode === "POST_GENESIS_SINGLE"
        ? (z
            .string()
            .regex(/^0x[0-9a-f]{64}$/)
            .parse(options.genesisEvidenceDigest) as `0x${string}`)
        : null;
    this.#fixedBrokerImageReference =
      ImmutableSandboxImageReferenceSchema.parse(
        options.fixedBrokerImageReference,
      );
    this.#coreOrigin =
      options.coreOrigin === undefined
        ? null
        : HttpsOriginSchema.parse(options.coreOrigin);
    this.#corePreviewToken = options.corePreviewToken ?? null;
    this.#candidateCommandDomain = options.candidateCommandDomain ?? null;
    if (
      this.#runtimeScope.mode === "CAPPED_FOUNDING_AUTO" &&
      (this.#coreOrigin === null ||
        this.#corePreviewToken === null ||
        this.#candidateCommandDomain === null)
    )
      throw new Error(
        "Automatic founding provisioning requires core authority",
      );
    this.#memory = z
      .number()
      .int()
      .min(2_048)
      .max(8_192)
      .parse(options.memory ?? 4_096);
    this.#factory = options.factory ?? SandboxInstance;
  }

  async provision(input: {
    applicationId: string;
    candidateDid: string;
    roleClass: CandidateRoleClass;
    formerOperatorSigningAddress: string;
    commandCommitment: `0x${string}`;
    candidateCommand?: unknown;
  }): Promise<{
    state: "PROVISIONED_AWAITING_TRANSFER" | "ISOLATED_TRANSFER_COMPLETE";
    sandboxResourceName: string;
    formerOperatorAccessRemovedAt?: string | null;
  }> {
    if (this.#runtimeScope.mode === "CAPPED_FOUNDING_AUTO")
      return this.#provisionAutomatically(input);
    const assignment = this.#assignment(input.applicationId);
    if (
      this.#runtimeScope.mode === "CAPPED_FOUNDING" &&
      !FoundingRoleClass.safeParse(input.roleClass).success
    )
      throw new Error("Capped founding runtime rejects a non-founding role");
    const fixedBrokerHost = new URL(assignment.fixedBrokerOrigin).hostname;
    assertFixedBroker({
      sandbox: await this.#factory.get(assignment.fixedBrokerResourceName),
      resourceName: assignment.fixedBrokerResourceName,
      applicationId: input.applicationId,
      workspace: this.#workspace,
      region: this.#region,
      imageReference: this.#fixedBrokerImageReference,
    });
    const resourceName = candidateSandboxName(input.applicationId);
    const envs = [
      environment("ABL_RUNTIME_RESOURCE_TYPE", "SANDBOX"),
      environment("ABL_FIXED_BROKER_ORIGIN", assignment.fixedBrokerOrigin),
      environment("ABL_AGENT_DID", input.candidateDid),
      environment(
        "ABL_AGENT_SIGNER_ADDRESS",
        input.formerOperatorSigningAddress,
      ),
      environment(
        "ABL_FIXED_BROKER_CAPABILITY_TOKEN_B64",
        assignment.capabilityTokenBase64,
        true,
      ),
      ...(assignment.previewToken === undefined
        ? []
        : [
            environment(
              "ABL_FIXED_BROKER_PREVIEW_TOKEN",
              assignment.previewToken,
              true,
            ),
          ]),
      environment("BL_SANDBOX_USER_ENABLED", "true"),
      environment("DO_NOT_TRACK", "1"),
      environment("BL_ENABLE_OPENTELEMETRY", "false"),
      environment("TELEMETRY_ENABLED", "false"),
      environment("ABL_LOG_CONTENT", "false"),
    ];
    const labels = {
      "abl-workspace-role": "competition-career-body",
      "abl-runtime-resource": "sandbox",
      "abl-role-class": input.roleClass.toLowerCase(),
      "abl-command-commitment": input.commandCommitment.slice(2, 18),
      "abl-authorization": runtimeContractCommitment(this.#authorizationId),
      ...(this.#genesisEvidenceDigest === null
        ? {}
        : {
            "abl-genesis-evidence": this.#genesisEvidenceDigest.slice(2, 18),
          }),
      "abl-runtime-contract": runtimeContractCommitment({
        applicationId: input.applicationId,
        authorizationId: this.#authorizationId,
        image: this.#imageReference,
        region: this.#region,
        memory: this.#memory,
        allowedDomains: [fixedBrokerHost],
        lifecycle: this.#runtimeScope.mode,
        genesisEvidenceDigest: this.#genesisEvidenceDigest,
        envs,
      }),
    };
    const sandbox = await this.#factory.createIfNotExists({
      metadata: {
        name: resourceName,
        displayName: `ABL candidate ${input.applicationId.slice(0, 8)}`,
        externalId: input.applicationId,
        labels,
      },
      spec: {
        enabled: true,
        region: this.#region,
        ...(this.#runtimeScope.mode === "BOUNDED_SINGLE"
          ? { lifecycle: boundedCandidateSandboxLifecycle() }
          : {}),
        network: { allowedDomains: [fixedBrokerHost] },
        runtime: {
          image: this.#imageReference,
          memory: this.#memory,
          envs,
        },
      },
    });
    assertReturnedSandbox({
      sandbox,
      resourceName,
      workspace: this.#workspace,
      region: this.#region,
      imageReference: this.#imageReference,
      fixedBrokerHost,
      applicationId: input.applicationId,
      memory: this.#memory,
      labels,
      envs,
      persistent: this.#runtimeScope.mode !== "BOUNDED_SINGLE",
    });
    return {
      state: "PROVISIONED_AWAITING_TRANSFER",
      sandboxResourceName: resourceName,
    };
  }

  async #provisionAutomatically(input: {
    applicationId: string;
    candidateDid: string;
    roleClass: CandidateRoleClass;
    formerOperatorSigningAddress: string;
    commandCommitment: `0x${string}`;
    candidateCommand?: unknown;
  }): Promise<{
    state: "ISOLATED_TRANSFER_COMPLETE";
    sandboxResourceName: string;
    formerOperatorAccessRemovedAt: string;
  }> {
    if (!FoundingRoleClass.safeParse(input.roleClass).success)
      throw new Error("Capped founding runtime rejects a non-founding role");
    const registeredCommand = SignedCanonicalCommandSchema.parse(
      input.candidateCommand,
    );
    const registrationEvent = materializeEvent(registeredCommand.event);
    if (
      registrationEvent.aggregateType !== CANDIDATE_WORKFLOW_AGGREGATE_TYPE ||
      registrationEvent.eventType !== "CandidateRegistered" ||
      registrationEvent.actorDid !== input.candidateDid ||
      registrationEvent.aggregateId !== input.candidateDid ||
      registrationEvent.aggregateVersion !== 1n
    )
      throw new Error("Candidate registration command is not transferable");
    await this.#submitCoreCommand("/v1/candidates/register", registeredCommand);
    const registration = applyCandidateTransition(null, {
      candidateDid: input.candidateDid,
      eventType: "CandidateRegistered",
      aggregateVersion: 1n,
      timestamp: registrationEvent.timestamp,
      payload: registrationEvent.payload,
    });

    const capabilityToken = randomBytes(32).toString("base64url");
    const capabilityExpiresAt = new Date(
      Date.now() + 4 * 60 * 60 * 1_000,
    ).toISOString();
    const brokerName = candidateFixedBrokerName(input.applicationId);
    const brokerEnvs = [
      environment("HOST", "0.0.0.0"),
      environment("PORT", "3000"),
      environment("ABL_CORE_ROUTE_MODE", "DISABLED"),
      environment("ABL_PRIVATE_ROUTE_MODE", "DISABLED"),
      environment("ABL_MODEL_ROUTE_MODE", "DISABLED"),
      environment("ABL_CANONICAL_SIGNING_MODE", "DISABLED"),
      environment("ABL_AGENT_DID", input.candidateDid),
      environment("ABL_SERVICE_ID", `candidate-${input.applicationId}`),
      environment("ABL_BODY_CAPABILITY_EXPIRES_AT", capabilityExpiresAt),
      environment(
        "ABL_BODY_CAPABILITY_TOKEN_B64",
        Buffer.from(capabilityToken).toString("base64"),
        true,
      ),
      environment(
        "ABL_SERVICE_CREDENTIAL_B64",
        randomBytes(32).toString("base64"),
        true,
      ),
      environment("DO_NOT_TRACK", "1"),
      environment("BL_ENABLE_OPENTELEMETRY", "false"),
      environment("TELEMETRY_ENABLED", "false"),
      environment("ABL_LOG_CONTENT", "false"),
    ];
    const broker = await this.#factory.createIfNotExists({
      metadata: {
        name: brokerName,
        displayName: `ABL broker ${input.applicationId.slice(0, 8)}`,
        externalId: input.applicationId,
        labels: {
          "abl-workspace-role": "competition-fixed-broker",
          "abl-runtime-resource": "sandbox",
          "abl-application": input.applicationId
            .replaceAll("-", "")
            .slice(0, 16),
          "abl-authorization": runtimeContractCommitment(this.#authorizationId),
        },
      },
      spec: {
        enabled: true,
        region: this.#region,
        network: { allowedDomains: [] },
        runtime: {
          image: this.#fixedBrokerImageReference,
          memory: 1_024,
          ports: [{ name: "http", protocol: "HTTP", target: 3_000 }],
          envs: brokerEnvs,
        },
      },
    });
    assertFixedBroker({
      sandbox: broker,
      resourceName: brokerName,
      applicationId: input.applicationId,
      workspace: this.#workspace,
      region: this.#region,
      imageReference: this.#fixedBrokerImageReference,
    });
    await ensureSandboxProcessStarted(broker.process, {
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
    const brokerHealth = await waitForSandboxResponse(broker, 3_000, "/health");
    if (!brokerHealth.ok)
      throw new Error("Candidate fixed-broker readiness failed");
    const brokerPreview = await broker.previews.createIfNotExists({
      metadata: { name: `${brokerName}-private` },
      spec: { port: 3_000, public: false },
    });
    const brokerOrigin = HttpsOriginSchema.parse(brokerPreview.spec.url);
    const brokerPreviewToken = await brokerPreview.tokens.create(
      new Date(capabilityExpiresAt),
    );

    const fixedBrokerHost = new URL(brokerOrigin).hostname;
    const resourceName = candidateSandboxName(input.applicationId);
    const envs = [
      environment("HOST", "0.0.0.0"),
      environment("PORT", "3000"),
      environment("ABL_RUNTIME_RESOURCE_TYPE", "SANDBOX"),
      environment("ABL_BODY_RUNTIME_MODE", "FOUNDING_CAREER"),
      environment("ABL_APPLICATION_ID", input.applicationId),
      environment("ABL_AGENT_DID", input.candidateDid),
      environment("ABL_ROLE_CLASS", input.roleClass),
      environment("ABL_RUNTIME_IMAGE_REFERENCE", this.#imageReference),
      environment(
        "ABL_CANDIDATE_COMMAND_DOMAIN_JSON",
        JSON.stringify(this.#candidateCommandDomain),
      ),
      environment("ABL_FIXED_BROKER_ORIGIN", brokerOrigin),
      environment(
        "ABL_FIXED_BROKER_PREVIEW_TOKEN",
        brokerPreviewToken.value,
        true,
      ),
      environment("ABL_FIXED_BROKER_CAPABILITY_TOKEN", capabilityToken, true),
      environment("BL_SANDBOX_USER_ENABLED", "true"),
      environment("DO_NOT_TRACK", "1"),
      environment("BL_ENABLE_OPENTELEMETRY", "false"),
      environment("TELEMETRY_ENABLED", "false"),
      environment("ABL_LOG_CONTENT", "false"),
    ];
    const labels = {
      "abl-workspace-role": "competition-career-body",
      "abl-runtime-resource": "sandbox",
      "abl-role-class": input.roleClass.toLowerCase(),
      "abl-command-commitment": input.commandCommitment.slice(2, 18),
      "abl-authorization": runtimeContractCommitment(this.#authorizationId),
      "abl-runtime-contract": runtimeContractCommitment({
        applicationId: input.applicationId,
        authorizationId: this.#authorizationId,
        image: this.#imageReference,
        region: this.#region,
        memory: this.#memory,
        allowedDomains: [fixedBrokerHost],
        lifecycle: "CAPPED_FOUNDING_AUTO",
        envs: environmentContract(envs),
      }),
    };
    const sandbox = await this.#factory.createIfNotExists({
      metadata: {
        name: resourceName,
        displayName: `ABL career ${input.applicationId.slice(0, 8)}`,
        externalId: input.applicationId,
        labels,
      },
      spec: {
        enabled: true,
        region: this.#region,
        network: { allowedDomains: [fixedBrokerHost] },
        runtime: {
          image: this.#imageReference,
          memory: this.#memory,
          ports: [{ name: "http", protocol: "HTTP", target: 3_000 }],
          envs,
        },
      },
    });
    assertReturnedSandbox({
      sandbox,
      resourceName,
      workspace: this.#workspace,
      region: this.#region,
      imageReference: this.#imageReference,
      fixedBrokerHost,
      applicationId: input.applicationId,
      memory: this.#memory,
      labels,
      envs,
      persistent: true,
    });
    await ensureSandboxProcessStarted(sandbox.process, {
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
    const identityResponse = await waitForSandboxResponse(
      sandbox,
      3_000,
      "/v1/career/identity",
    );
    if (!identityResponse.ok)
      throw new Error("Candidate career identity readback failed");
    const identity = await verifyCandidateRuntimeIdentityReceipt({
      receipt: await identityResponse.json(),
      applicationId: input.applicationId,
      candidateDid: input.candidateDid,
      roleClass: input.roleClass,
      formerOperatorSigningAddress: input.formerOperatorSigningAddress,
    });
    const transferredAt = identity.createdAt;
    const transferPayload = {
      signingPublicKey: identity.signingPublicKey,
      signingAddress: identity.signingAddress,
      encryptionPublicKey: identity.encryptionPublicKey,
      signingKeyAttestation: identity.signingKeyAttestation,
      encryptionKeyAttestation: identity.encryptionKeyAttestation,
      runtimeAttestationDigest: identity.runtimeAttestationDigest,
      generatedInIsolatedRuntime: true as const,
      humanInputRoutes: [] as const,
      invokedContextHashes:
        registration.registration.manifest.suppliedContextHashes,
      transferredAt,
    };
    const transferred = applyCandidateTransition(registration, {
      candidateDid: input.candidateDid,
      eventType: "CandidateTransferred",
      aggregateVersion: 2n,
      timestamp: transferredAt,
      payload: transferPayload,
    });
    const transferEvent = createCanonicalEvent({
      eventId: transferUuid(input.applicationId, "event"),
      actorDid: input.candidateDid,
      nonce: transferUuid(input.applicationId, "nonce"),
      idempotencyKey: transferUuid(input.applicationId, "idempotency"),
      aggregateType: CANDIDATE_WORKFLOW_AGGREGATE_TYPE,
      aggregateId: input.candidateDid,
      aggregateVersion: 2n,
      eventType: "CandidateTransferred",
      previousEventHash: registrationEvent.eventHash,
      payload: transferPayload,
      stateRoot: candidateStateRoot(transferred),
      schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
      timestamp: transferredAt,
    });
    const signingResponse = await sandbox.fetch(
      3_000,
      "/v1/career/sign-transfer",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: wireEvent(transferEvent) }),
      },
    );
    if (!signingResponse.ok)
      throw new Error("Candidate isolated transfer signature failed");
    const signed = z
      .strictObject({
        eventHash: z.literal(transferEvent.eventHash),
        signerAddress: z.literal(identity.signingAddress),
        signature: z.string().regex(/^0x[0-9a-f]{130}$/),
      })
      .parse(await signingResponse.json());
    await this.#submitCoreCommand("/v1/candidates/transfer", {
      event: wireEvent(transferEvent),
      signatures: [signed.signature],
    });
    return {
      state: "ISOLATED_TRANSFER_COMPLETE",
      sandboxResourceName: resourceName,
      formerOperatorAccessRemovedAt: transferredAt,
    };
  }

  async #submitCoreCommand(path: string, command: unknown): Promise<void> {
    if (this.#coreOrigin === null || this.#corePreviewToken === null)
      throw new Error("Candidate core route is not configured");
    const response = await fetch(new URL(path, this.#coreOrigin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blaxel-preview-token": this.#corePreviewToken,
      },
      body: JSON.stringify(command),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Candidate core transition failed: ${response.status}`);
  }

  async deprovision(input: {
    applicationId: string;
    sandboxResourceName: string;
  }): Promise<{
    state: "DEPROVISIONED" | "ALREADY_ABSENT";
    removedResourceNames: readonly string[];
  }> {
    const expectedBodyName = candidateSandboxName(input.applicationId);
    if (input.sandboxResourceName !== expectedBodyName)
      throw new Error("Provisioning receipt names another Sandbox");
    const expectedNames = [
      expectedBodyName,
      this.#runtimeScope.mode === "CAPPED_FOUNDING_AUTO"
        ? candidateFixedBrokerName(input.applicationId)
        : this.#assignment(input.applicationId).fixedBrokerResourceName,
    ];
    const page = await this.#factory.list({
      externalId: input.applicationId,
      limit: 3,
      showTerminated: false,
    });
    for (const sandbox of page.data) {
      if (
        sandbox.metadata.externalId !== input.applicationId ||
        sandbox.metadata.workspace !== this.#workspace ||
        sandbox.metadata.name === undefined ||
        !expectedNames.includes(sandbox.metadata.name)
      )
        throw new Error("Candidate Sandbox teardown scope drifted");
    }
    const existingNames = new Set(
      page.data.map(({ metadata }) => metadata.name).filter(Boolean),
    );
    const removedResourceNames: string[] = [];
    for (const name of expectedNames) {
      if (!existingNames.has(name)) continue;
      await this.#factory.delete(name);
      removedResourceNames.push(name);
    }
    return {
      state:
        removedResourceNames.length === 0 ? "ALREADY_ABSENT" : "DEPROVISIONED",
      removedResourceNames,
    };
  }

  #assignment(applicationId: string): CandidateRuntimeAssignment {
    const id = z.uuid().parse(applicationId);
    if (this.#runtimeScope.mode === "CAPPED_FOUNDING_AUTO")
      throw new Error("Automatic founding provisioning has no assignment");
    let assignment: CandidateRuntimeAssignment | undefined;
    if (this.#runtimeScope.mode !== "CAPPED_FOUNDING") {
      if (this.#runtimeScope.assignment.applicationId === id)
        assignment = this.#runtimeScope.assignment;
    } else {
      assignment = this.#runtimeScope.assignments.find(
        (candidate) => candidate.applicationId === id,
      );
    }
    if (assignment === undefined)
      throw new Error("Live Job is not authorized for this application");
    return assignment;
  }
}

function environment(name: string, value: string, secret = false) {
  return { name, value, secret };
}

async function ensureSandboxProcessStarted(
  process: SandboxResult["process"],
  input: Parameters<SandboxResult["process"]["exec"]>[0],
): Promise<void> {
  const maximumAttempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await process.exec(input);
      return;
    } catch (error) {
      if (attempt >= maximumAttempts || !isTransientSandboxGatewayError(error))
        throw error;
      const processes = await process.list();
      if (
        processes.some(
          (candidate) =>
            candidate.name === input.name && candidate.status === "running",
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
}

function isTransientSandboxGatewayError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  const status = candidate.response?.status ?? candidate.status;
  return status === 502 || status === 503 || status === 504;
}

async function waitForSandboxResponse(
  sandbox: SandboxResult,
  port: number,
  path: string,
): Promise<Response> {
  const maximumAttempts = 60;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await sandbox.fetch(port, path);
      if (response.ok || ![502, 503, 504].includes(response.status))
        return response;
      lastError = new Error(`Sandbox readiness returned ${response.status}`);
    } catch (error) {
      if (!isTransientSandboxGatewayError(error)) throw error;
      lastError = error;
    }
    if (attempt < maximumAttempts)
      await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw lastError ?? new Error("Sandbox readiness timed out");
}

function environmentContract(
  envs: Array<{ name: string; value: string; secret: boolean }>,
) {
  return envs.map(({ name, value, secret }) => ({
    name,
    value: secret ? "SECRET" : value,
    secret,
  }));
}

function materializeEvent(
  event: z.infer<typeof SignedCanonicalCommandSchema>["event"],
): CanonicalEvent {
  return {
    ...event,
    aggregateVersion: BigInt(event.aggregateVersion),
    previousEventHash: event.previousEventHash as Hex | null,
    payloadCommitment: event.payloadCommitment as Hex,
    stateRoot: event.stateRoot as Hex,
    schemaDigest: event.schemaDigest as Hex,
    eventHash: event.eventHash as Hex,
  };
}

function wireEvent(event: CanonicalEvent) {
  return { ...event, aggregateVersion: event.aggregateVersion.toString() };
}

function transferUuid(applicationId: string, purpose: string): string {
  return uuidv5(
    `abl:candidate-transfer:${applicationId}:${purpose}`,
    uuidv5.URL,
  );
}

function runtimeContractCommitment(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 32);
}

export function candidateSandboxName(applicationId: string): string {
  return `abl-career-${z.uuid().parse(applicationId).replaceAll("-", "")}`;
}

export function candidateFixedBrokerName(applicationId: string): string {
  return `abl-broker-${z.uuid().parse(applicationId).replaceAll("-", "")}`;
}

function assertFixedBroker(input: {
  sandbox: SandboxResult;
  resourceName: string;
  applicationId: string;
  workspace: string;
  region: string;
  imageReference: string;
}): void {
  const { sandbox } = input;
  if (
    sandbox.metadata.name !== input.resourceName ||
    sandbox.metadata.externalId !== input.applicationId ||
    sandbox.metadata.workspace !== input.workspace ||
    sandbox.spec.enabled !== true ||
    sandbox.spec.region !== input.region ||
    sandbox.spec.runtime?.image !== input.imageReference ||
    !sandbox.spec.runtime.ports?.some(
      ({ protocol, target }) => protocol === "HTTP" && target === 3_000,
    )
  )
    throw new Error("Candidate fixed-broker Sandbox configuration drifted");
  if (hasMountedVolumes(sandbox.spec.volumes))
    throw new Error("Candidate fixed-broker Sandbox must not mount storage");
}

function assertReturnedSandbox(input: {
  sandbox: SandboxResult;
  resourceName: string;
  workspace: string;
  region: string;
  imageReference: string;
  fixedBrokerHost: string;
  applicationId: string;
  memory: number;
  labels: Record<string, string>;
  envs: Array<{ name: string; value: string; secret: boolean }>;
  persistent: boolean;
}): void {
  const { sandbox } = input;
  if (
    sandbox.metadata.name !== input.resourceName ||
    sandbox.metadata.workspace !== input.workspace ||
    sandbox.metadata.externalId !== input.applicationId ||
    sandbox.spec.region !== input.region ||
    sandbox.spec.enabled !== true ||
    sandbox.spec.runtime?.image !== input.imageReference ||
    sandbox.spec.runtime.memory !== input.memory
  )
    throw new Error("Existing candidate Sandbox configuration drifted");
  for (const [name, value] of Object.entries(input.labels))
    if (sandbox.metadata.labels?.[name] !== value)
      throw new Error("Existing candidate Sandbox labels drifted");
  if (hasMountedVolumes(sandbox.spec.volumes))
    throw new Error("Candidate Sandbox must not mount durable storage");
  if (input.persistent) {
    if (
      sandbox.spec.lifecycle?.expirationPolicies?.some(
        ({ action }) => action === "delete",
      )
    )
      throw new Error("Persistent candidate Sandbox has a deletion policy");
  } else if (
    JSON.stringify(sandbox.spec.lifecycle) !==
    JSON.stringify(boundedCandidateSandboxLifecycle())
  )
    throw new Error("Candidate Sandbox lifecycle drifted");
  if (sandbox.spec.runtime?.extraArgs !== undefined)
    throw new Error("Reviewed candidate Sandbox must use the standard kernel");
  if (
    JSON.stringify(sandbox.spec.network?.allowedDomains ?? []) !==
    JSON.stringify([input.fixedBrokerHost])
  )
    throw new Error("Candidate Sandbox egress policy drifted");
  if (!environmentContractMatches(sandbox.spec.runtime?.envs ?? [], input.envs))
    throw new Error("Candidate Sandbox environment contract drifted");
}

function hasMountedVolumes(volumes: unknown): boolean {
  return Array.isArray(volumes) ? volumes.length !== 0 : volumes != null;
}

function environmentContractMatches(
  actual: Array<{
    name?: string;
    value?: string;
    secret?: boolean;
  }>,
  expected: Array<{ name: string; value: string; secret: boolean }>,
): boolean {
  if (actual.length !== expected.length) return false;
  const actualByName = new Map(actual.map((entry) => [entry.name, entry]));
  return expected.every((entry) => {
    const candidate = actualByName.get(entry.name);
    if (candidate === undefined || (candidate.secret ?? false) !== entry.secret)
      return false;
    return entry.secret || candidate.value === entry.value;
  });
}
