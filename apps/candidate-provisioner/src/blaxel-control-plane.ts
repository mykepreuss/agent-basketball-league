import { createHash } from "node:crypto";

import { SandboxInstance } from "@blaxel/core";
import {
  ImmutableSandboxImageReferenceSchema,
  type CandidateRoleClass,
  type CandidateSandboxControlPlane,
} from "@abl/launch";
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
    };

function parseRuntimeScope(
  scope: CandidateRuntimeScope,
): CandidateRuntimeScope {
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
  }): Promise<{
    state: "PROVISIONED_AWAITING_TRANSFER";
    sandboxResourceName: string;
  }> {
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

  async deprovision(input: {
    applicationId: string;
    sandboxResourceName: string;
  }): Promise<{
    state: "DEPROVISIONED" | "ALREADY_ABSENT";
    removedResourceNames: readonly string[];
  }> {
    const assignment = this.#assignment(input.applicationId);
    const expectedBodyName = candidateSandboxName(input.applicationId);
    if (input.sandboxResourceName !== expectedBodyName)
      throw new Error("Provisioning receipt names another Sandbox");
    const expectedNames = [
      expectedBodyName,
      assignment.fixedBrokerResourceName,
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
