import type { Hex, TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import {
  ActionIntentSchema,
  CoachDecisionBodySchema,
  RefereeDecisionBodySchema,
  ReplayDecisionBodySchema,
} from "@abl/basketball";
import {
  CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE,
  CAREER_ROLE_ACTIVATION_EVENT_TYPE,
  CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST,
  openRunnerResult,
  recoverRunnerDelegationSigner,
  recoverRunnerRequestSigner,
  roleDecisionSchemaDigest,
  runnerDelegationMessage,
  sealContextCapsule,
} from "@abl/cognition";
import {
  createCanonicalEvent,
  recoverCanonicalEventSigner,
  sha256Commitment,
  signCanonicalEvent,
  verifyEventContent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import {
  ContextManifestV2Schema,
  ContextSelectionPolicySchema,
  InferenceRequestSchema,
  InferenceResultSchema,
  RoleActivationSchema,
  RunnerDelegationSchema,
  SignedCanonicalCommandSchema,
  type CognitionReceiptV2,
  type ContextManifestV2,
  type ContextSelectionPolicy,
  type InferenceRequest,
  type InferenceResult,
  type RoleActivation,
  type RunnerDelegation,
  type ActivationState,
} from "@abl/schemas";

const sha256Schema = z.string().regex(/^0x[0-9a-f]{64}$/);
const RoleDecisionSchema = z.union([
  ActionIntentSchema,
  CoachDecisionBodySchema,
  RefereeDecisionBodySchema,
  ReplayDecisionBodySchema,
]);

export const CareerActivationResultSchema = z.strictObject({
  activationId: z.string().min(1).max(200),
  gameId: z.string().min(1).max(200),
  kind: z.enum(["PRACTICE", "COMPETITION"]),
  role: z.enum(["PLAYER", "COACH", "REFEREE", "REPLAY"]),
  state: z.enum(["CAREER_SIGNED", "FALLBACK_SIGNED"]),
  canonical: z.literal(false),
  genesis: z.literal(false),
  participantInferenceAttempted: z.boolean(),
  participantResultAccepted: z.boolean(),
  decision: z
    .object({
      receipt: z.unknown(),
      authorizationEvent: SignedCanonicalCommandSchema.shape.event,
      eventHash: sha256Schema,
      signature: z.string().regex(/^0x[0-9a-f]{130}$/),
      signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    })
    .passthrough(),
});

export interface CareerCognitionIdentity extends SigningIdentity {
  candidateDid: string;
  applicationId: string;
  role: "PLAYER" | "COACH" | "REFEREE" | "REPLAY";
  encryptionSecretKey: Uint8Array;
  encryptionPublicKey: `0x${string}`;
}

export interface CareerContextMaterial {
  commitment: `0x${string}`;
  disclosureClass:
    | "PUBLIC_NOW"
    | "SEALED_30D"
    | "COMPETITIVE_SEALED"
    | "CASE_RESTRICTED"
    | "PERSONAL_UNSUBMITTED"
    | "INTEGRITY_ESCROW";
  source:
    | "IDENTITY"
    | "OBJECTIVE"
    | "MEMORY"
    | "TEAM_CONTEXT"
    | "PRIVATE_FILM"
    | "PRACTICE_LESSON"
    | "SCHEDULE"
    | "GAME_STATE";
  content: unknown;
}

export interface CareerContextAssembly {
  policy: ContextSelectionPolicy;
  materials: readonly CareerContextMaterial[];
  officialContext: unknown;
  fallbackDecision: unknown;
  kernelHash: `0x${string}`;
  toolHash: `0x${string}`;
}

export interface CareerContextProvider {
  assemble(activation: RoleActivation): Promise<CareerContextAssembly>;
  persistReflection?(input: {
    activation: RoleActivation;
    decisionCommitment: `0x${string}`;
    participantResultAccepted: boolean;
    fallback: CognitionReceiptV2["fallback"];
    selectedAt: string;
  }): Promise<void>;
}

export interface CareerRelayClient {
  enqueue(request: InferenceRequest): Promise<"CREATED" | "EXISTS">;
  result(
    activationId: string,
    acknowledge: boolean,
  ): Promise<InferenceResult | null>;
  transition(state: {
    activationId: string;
    careerDid: string;
    gameId: string;
    role: RoleActivation["role"];
    state: ActivationState;
    activationCommitment: `0x${string}`;
    contextManifestCommitment: `0x${string}` | null;
    finalDecisionCommitment: `0x${string}` | null;
    deadlineAt: string;
    updatedAt: string;
  }): Promise<void>;
}

export interface ActiveCareerRunner {
  delegation: RunnerDelegation;
  runnerBuildDigest: `0x${string}`;
  adapterBuildDigest: `0x${string}`;
}

export interface HostedOfficialInferenceResult {
  decision: unknown;
  serviceId: string;
  serviceBuildDigest: `0x${string}`;
  adapterBuildDigest: `0x${string}`;
  providerProductModel: string;
  provenanceLevel: CognitionReceiptV2["provenanceLevel"];
  startedAt: string;
  completedAt: string;
  usage: CognitionReceiptV2["usage"];
}

export interface HostedOfficialInferenceClient {
  decide(input: {
    activation: Extract<RoleActivation, { role: "REFEREE" | "REPLAY" }>;
    contextManifest: ContextManifestV2;
    officialContext: unknown;
    deadlineAt: string;
  }): Promise<HostedOfficialInferenceResult>;
}

export interface CareerActivationResult {
  activationId: string;
  gameId: string;
  kind: "PRACTICE" | "COMPETITION";
  role: "PLAYER" | "COACH" | "REFEREE" | "REPLAY";
  state: "CAREER_SIGNED" | "FALLBACK_SIGNED";
  canonical: false;
  genesis: false;
  participantInferenceAttempted: boolean;
  participantResultAccepted: boolean;
  decision: Record<string, unknown> & {
    receipt: CognitionReceiptV2;
    authorizationEvent: z.infer<typeof SignedCanonicalCommandSchema>["event"];
    eventHash: `0x${string}`;
    signature: `0x${string}`;
    signerAddress: `0x${string}`;
  };
}

export interface VerifiedCareerRoleActivation {
  activation: RoleActivation;
  event: CanonicalEvent;
  remainingMs: number;
}

function deterministicUuid(subject: string): string {
  const hash = sha256Commitment(subject).slice(2);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function materializeEvent(
  wire: z.infer<typeof SignedCanonicalCommandSchema>["event"],
): CanonicalEvent {
  return {
    ...wire,
    aggregateVersion: BigInt(wire.aggregateVersion),
  } as CanonicalEvent;
}

function roleDecision(
  activation: RoleActivation,
  candidateDid: string,
  raw: unknown,
  fallback: unknown,
): z.infer<typeof RoleDecisionSchema> {
  const source = raw ?? fallback;
  if (activation.role === "PLAYER") {
    const partial = z
      .object({ action: z.string() })
      .passthrough()
      .parse(source);
    return ActionIntentSchema.parse({
      windowId: activation.windowId,
      playerId: activation.playerId,
      ...partial,
    });
  }
  if (activation.role === "COACH") {
    const partial = z
      .object({ instruction: z.string() })
      .passthrough()
      .parse(source);
    return CoachDecisionBodySchema.parse({
      coachDid: candidateDid,
      team: activation.teamId,
      windowId: activation.windowId,
      targetPlayerIds: [],
      ...partial,
    });
  }
  if (activation.role === "REFEREE") {
    const partial = z.object({ call: z.string() }).passthrough().parse(source);
    return RefereeDecisionBodySchema.parse({
      refereeDid: candidateDid,
      possessionId: activation.possessionId,
      sequence: activation.officiatingSequence,
      againstPlayerId: null,
      confidenceBps: 0,
      ...partial,
    });
  }
  const partial = z.object({ ruling: z.string() }).passthrough().parse(source);
  return ReplayDecisionBodySchema.parse({
    replayDid: candidateDid,
    possessionId: activation.possessionId,
    reviewable: false,
    evidenceCommitment: activation.stateRoot,
    ...partial,
  });
}

function safeFallback(activation: RoleActivation, supplied: unknown): unknown {
  if (supplied !== undefined && supplied !== null) return supplied;
  if (activation.role === "PLAYER") return { action: "HOLD" };
  if (activation.role === "COACH")
    return { instruction: "RETAIN_CURRENT_TACTIC_AND_LINEUP" };
  if (activation.role === "REFEREE") return { call: "NO_CALL" };
  return { ruling: "NO_REVIEW" };
}

function fallbackCode(
  role: RoleActivation["role"],
): CognitionReceiptV2["fallback"] {
  if (role === "PLAYER") return "PLAYER_HOLD";
  if (role === "COACH") return "COACH_RETAIN";
  if (role === "REFEREE") return "REFEREE_NO_CALL";
  return "REPLAY_NO_REVIEW";
}

async function signedContextManifest(input: {
  identity: CareerCognitionIdentity;
  activation: RoleActivation;
  assembly: CareerContextAssembly;
  now: string;
}): Promise<ContextManifestV2> {
  const selectedMaterials = input.assembly.materials.map((material) => ({
    materialCommitment: material.commitment,
    disclosureClass: material.disclosureClass,
    source: material.source,
  }));
  const unsigned = {
    schemaVersion: "1.0.0" as const,
    manifestId: deterministicUuid(
      `${input.activation.activationId}:context-manifest`,
    ),
    activationId: input.activation.activationId,
    careerDid: input.identity.candidateDid,
    role: input.activation.role,
    observationCommitment: input.activation.observationCommitment,
    stateRoot: input.activation.stateRoot,
    policyCommitment: input.assembly.policy.policyCommitment,
    selectedMaterials,
    excludedSecretClasses: [
      "SIGNING_KEY",
      "ENCRYPTION_KEY",
      "INFRASTRUCTURE_CREDENTIAL",
      "RAW_STORAGE_METADATA",
    ] as const,
    createdAt: input.now,
  };
  const manifestCommitment = sha256Commitment(unsigned);
  const careerSignature = await privateKeyToAccount(
    input.identity.privateKey,
  ).signMessage({ message: { raw: manifestCommitment } });
  return ContextManifestV2Schema.parse({
    ...unsigned,
    manifestCommitment,
    careerSignature,
  });
}

async function verifyRunner(input: {
  runner: ActiveCareerRunner;
  identity: CareerCognitionIdentity;
  now: string;
}): Promise<void> {
  const delegation = RunnerDelegationSchema.parse(input.runner.delegation);
  if (
    delegation.careerDid !== input.identity.candidateDid ||
    delegation.revokedAt !== null ||
    Date.parse(delegation.expiresAt) <= Date.parse(input.now)
  )
    throw new Error("Career runner delegation is unavailable");
  const scopesCommitment = sha256Commitment([...delegation.scopes].sort());
  const recovered = await recoverRunnerDelegationSigner(
    runnerDelegationMessage(
      {
        schemaVersion: delegation.schemaVersion,
        delegationId: delegation.delegationId,
        careerDid: delegation.careerDid,
        runnerId: delegation.runnerId,
        delegateSigningAddress: delegation.delegateSigningAddress,
        delegateEncryptionPublicKey: delegation.delegateEncryptionPublicKey,
        scopes: delegation.scopes,
        issuedAt: delegation.issuedAt,
        expiresAt: delegation.expiresAt,
      },
      scopesCommitment,
    ),
    delegation.careerSignature as Hex,
  );
  if (recovered.toLowerCase() !== input.identity.address.toLowerCase())
    throw new Error("Runner delegation was not signed by this career");
}

async function verifyResultAttestation(
  result: InferenceResult,
  delegation: RunnerDelegation,
): Promise<void> {
  const resultCommitment = sha256Commitment({
    requestId: result.requestId,
    activationId: result.activationId,
    ciphertextCommitment: result.ciphertextCommitment,
    completedAt: result.completedAt,
  });
  const signer = await recoverRunnerRequestSigner(
    {
      runnerId: result.runnerId,
      careerDid: result.careerDid,
      delegationId: delegation.delegationId,
      method: "RESULT_ATTESTATION",
      path: result.activationId,
      bodyCommitment: resultCommitment,
      nonce: "0",
      idempotencyKey: result.requestId,
      timestamp: result.completedAt,
    },
    result.delegateSignature as Hex,
  );
  if (signer.toLowerCase() !== delegation.delegateSigningAddress.toLowerCase())
    throw new Error("Inference result was not signed by the delegated runner");
}

export async function verifyCareerRoleActivationCommand(input: {
  command: unknown;
  identity: CareerCognitionIdentity;
  coordinatorDid: string;
  coordinatorSignerAddress: `0x${string}`;
  domain: TypedDataDomain;
  now?: () => number;
  expiredFallbackWindowMs?: number;
}): Promise<VerifiedCareerRoleActivation> {
  const now = input.now ?? Date.now;
  const command = SignedCanonicalCommandSchema.parse(input.command);
  if (command.signatures.length !== 1)
    throw new Error("Career activation requires one director signature");
  const event = materializeEvent(command.event);
  verifyEventContent(event);
  const activation = RoleActivationSchema.parse(event.payload);
  const recovered = await recoverCanonicalEventSigner(
    input.domain,
    event,
    command.signatures[0]! as Hex,
  );
  if (
    recovered.toLowerCase() !== input.coordinatorSignerAddress.toLowerCase() ||
    event.actorDid !== input.coordinatorDid ||
    event.aggregateType !== CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE ||
    event.aggregateId !== activation.activationId ||
    event.eventType !== CAREER_ROLE_ACTIVATION_EVENT_TYPE ||
    event.aggregateVersion !== 1n ||
    event.previousEventHash !== null ||
    event.schemaDigest !== CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST ||
    event.timestamp !== activation.openedAt ||
    event.stateRoot !== sha256Commitment(activation) ||
    activation.observationCommitment !==
      sha256Commitment(activation.officialObservation) ||
    activation.careerDid !== input.identity.candidateDid ||
    activation.role !== input.identity.role ||
    activation.expectedOutputSchemaDigest !==
      roleDecisionSchemaDigest(activation.role)
  )
    throw new Error("Career activation authority is invalid");
  const remainingMs = Date.parse(activation.deadlineAt) - now();
  const expiredFallbackWindowMs = input.expiredFallbackWindowMs ?? 0;
  if (
    !Number.isInteger(expiredFallbackWindowMs) ||
    expiredFallbackWindowMs < 0 ||
    remainingMs < -expiredFallbackWindowMs ||
    remainingMs > 20_000
  )
    throw new Error("Career activation deadline is invalid");
  return { activation, event, remainingMs };
}

export async function executeDistributedCareerActivation(input: {
  command: unknown;
  identity: CareerCognitionIdentity;
  coordinatorDid: string;
  coordinatorSignerAddress: `0x${string}`;
  domain: TypedDataDomain;
  runner: ActiveCareerRunner | null;
  cognitionMode?:
    | "PARTICIPANT_CONTROLLED"
    | "LEAGUE_HOSTED_OFFICIAL"
    | "DETERMINISTIC_FIXTURE";
  hostedOfficial?: HostedOfficialInferenceClient | null;
  contextProvider: CareerContextProvider;
  relay: CareerRelayClient;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  expiredFallbackWindowMs?: number;
}): Promise<CareerActivationResult> {
  const now = input.now ?? Date.now;
  const wait =
    input.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const verified = await verifyCareerRoleActivationCommand(input);
  const { activation } = verified;
  const cognitionMode = input.cognitionMode ?? "PARTICIPANT_CONTROLLED";
  if (
    cognitionMode === "LEAGUE_HOSTED_OFFICIAL" &&
    activation.role !== "REFEREE" &&
    activation.role !== "REPLAY"
  )
    throw new Error("League-hosted cognition is restricted to officials");
  const expiredRecovery = verified.remainingMs <= 0;
  const activationCommitment = sha256Commitment(activation);
  const transition = async (
    state: ActivationState,
    contextManifestCommitment: `0x${string}` | null,
    finalDecisionCommitment: `0x${string}` | null = null,
  ) =>
    input.relay.transition({
      activationId: activation.activationId,
      careerDid: activation.careerDid,
      gameId: activation.gameId,
      role: activation.role,
      state,
      activationCommitment,
      contextManifestCommitment,
      finalDecisionCommitment,
      deadlineAt: activation.deadlineAt,
      updatedAt: new Date(now()).toISOString(),
    });
  await transition("RECEIVED", null);
  const assembly = await input.contextProvider.assemble(activation);
  ContextSelectionPolicySchema.parse(assembly.policy);
  await transition("CONTEXT_ASSEMBLED", null);
  let participantInferenceAttempted = false;
  let participantResultAccepted = false;
  let rawDecision: unknown = null;
  let inferenceResult: InferenceResult | null = null;
  let hostedResult: HostedOfficialInferenceResult | null = null;
  let manifestCommitment = sha256Commitment({
    activationId: activation.activationId,
    fallback: true,
  });

  if (
    cognitionMode === "PARTICIPANT_CONTROLLED" &&
    input.runner !== null &&
    !expiredRecovery
  ) {
    try {
      const current = new Date(now()).toISOString();
      await verifyRunner({
        runner: input.runner,
        identity: input.identity,
        now: current,
      });
      const manifest = await signedContextManifest({
        identity: input.identity,
        activation,
        assembly,
        now: current,
      });
      manifestCommitment = sha256Commitment(manifest);
      const capsule = await sealContextCapsule({
        activationId: activation.activationId,
        careerDid: activation.careerDid,
        runnerId: input.runner.delegation.runnerId,
        recipientKeyId: input.runner.delegation.delegationId,
        recipientPublicKey: Buffer.from(
          input.runner.delegation.delegateEncryptionPublicKey.slice(2),
          "hex",
        ),
        context: {
          manifest,
          officialContext: {
            observation: activation.officialObservation,
            careerContext: assembly.officialContext,
          },
          materials: assembly.materials,
        },
        expiresAt: activation.deadlineAt,
      });
      await transition("SEALED_FOR_RUNNER", manifestCommitment);
      const requestWithoutCommitment = {
        schemaVersion: "1.0.0" as const,
        requestId: deterministicUuid(
          `${activation.activationId}:inference-request`,
        ),
        activation,
        cognitionMode: "PARTICIPANT_CONTROLLED" as const,
        contextManifestCommitment: manifestCommitment,
        capsule,
        resultRecipient: {
          keyId: `${input.identity.candidateDid}:career-encryption-v1`,
          publicKey: input.identity.encryptionPublicKey,
        },
        maximumAttempts: 1 as const,
        createdAt: current,
      };
      const request = InferenceRequestSchema.parse({
        ...requestWithoutCommitment,
        requestCommitment: sha256Commitment(requestWithoutCommitment),
      });
      participantInferenceAttempted = true;
      await input.relay.enqueue(request);
      await transition("DELIVERED", manifestCommitment);
      while (now() < Date.parse(activation.deadlineAt)) {
        inferenceResult = await input.relay.result(
          activation.activationId,
          false,
        );
        if (inferenceResult !== null) break;
        await wait(
          Math.min(100, Math.max(1, Date.parse(activation.deadlineAt) - now())),
        );
      }
      if (inferenceResult !== null) {
        await transition("RESULT_RECEIVED", manifestCommitment);
        const result = InferenceResultSchema.parse(inferenceResult);
        if (
          result.requestId !== request.requestId ||
          result.activationId !== activation.activationId ||
          result.careerDid !== activation.careerDid ||
          result.runnerId !== input.runner.delegation.runnerId ||
          Date.parse(result.completedAt) > Date.parse(activation.deadlineAt)
        )
          throw new Error("Inference result is bound to another activation");
        await verifyResultAttestation(result, input.runner.delegation);
        rawDecision = await openRunnerResult({
          requestId: result.requestId,
          activationId: result.activationId,
          careerDid: result.careerDid,
          runnerId: result.runnerId,
          recipientSecretKey: input.identity.encryptionSecretKey,
          ciphertext: result.ciphertext,
          ciphertextCommitment: result.ciphertextCommitment as `0x${string}`,
          aadCommitment: result.aadCommitment as `0x${string}`,
        });
        participantResultAccepted = true;
        await input.relay.result(activation.activationId, true);
      }
    } catch {
      participantResultAccepted = false;
      rawDecision = null;
      inferenceResult = null;
    }
  } else if (
    cognitionMode === "LEAGUE_HOSTED_OFFICIAL" &&
    input.hostedOfficial !== null &&
    input.hostedOfficial !== undefined &&
    !expiredRecovery &&
    (activation.role === "REFEREE" || activation.role === "REPLAY")
  ) {
    try {
      const current = new Date(now()).toISOString();
      const manifest = await signedContextManifest({
        identity: input.identity,
        activation,
        assembly,
        now: current,
      });
      manifestCommitment = sha256Commitment(manifest);
      await transition("DELIVERED", manifestCommitment);
      hostedResult = await input.hostedOfficial.decide({
        activation,
        contextManifest: manifest,
        officialContext: assembly.officialContext,
        deadlineAt: activation.deadlineAt,
      });
      if (
        Date.parse(hostedResult.completedAt) >
          Date.parse(activation.deadlineAt) ||
        Date.parse(hostedResult.startedAt) < Date.parse(activation.openedAt)
      )
        throw new Error("Hosted official result missed its decision window");
      await transition("RESULT_RECEIVED", manifestCommitment);
      rawDecision = hostedResult.decision;
      participantResultAccepted = true;
    } catch {
      participantResultAccepted = false;
      rawDecision = null;
      hostedResult = null;
    }
  }

  const fallback = !participantResultAccepted;
  const normalizedDecision = roleDecision(
    activation,
    input.identity.candidateDid,
    rawDecision,
    safeFallback(activation, assembly.fallbackDecision),
  );
  if (participantResultAccepted)
    await transition("VALIDATED", manifestCommitment);
  const completedAt =
    inferenceResult?.completedAt ??
    hostedResult?.completedAt ??
    (expiredRecovery ? activation.deadlineAt : new Date(now()).toISOString());
  const finalDecisionSignature = await privateKeyToAccount(
    input.identity.privateKey,
  ).signMessage({
    message: {
      raw: sha256Commitment({
        activationId: activation.activationId,
        careerDid: input.identity.candidateDid,
        decision: normalizedDecision,
        completedAt,
      }),
    },
  });
  const receipt: CognitionReceiptV2 = {
    schemaVersion: "1.0.0",
    receiptId: deterministicUuid(
      `${activation.activationId}:cognition-receipt`,
    ),
    activationId: activation.activationId,
    careerDid: activation.careerDid,
    role: activation.role,
    cognitionMode,
    activationCommitment: sha256Commitment(activation),
    observationCommitment: activation.observationCommitment,
    contextManifestCommitment: manifestCommitment,
    runnerId:
      hostedResult?.serviceId ??
      input.runner?.delegation.runnerId ??
      "unpaired-career-fallback",
    runnerBuildDigest:
      hostedResult?.serviceBuildDigest ??
      input.runner?.runnerBuildDigest ??
      sha256Commitment("unpaired"),
    adapterBuildDigest:
      hostedResult?.adapterBuildDigest ??
      input.runner?.adapterBuildDigest ??
      sha256Commitment("unpaired"),
    providerProductModel:
      hostedResult?.providerProductModel ??
      inferenceResult?.providerProductModel ??
      "career/deterministic/fallback-v2",
    provenanceLevel:
      hostedResult?.provenanceLevel ??
      inferenceResult?.provenanceLevel ??
      "LOCAL_ARTIFACT_VERIFIED",
    ambientProductContext: inferenceResult?.ambientProductContext ?? "NONE",
    kernelHash: assembly.kernelHash,
    toolHash: assembly.toolHash,
    startedAt:
      hostedResult?.startedAt ?? inferenceResult?.startedAt ?? completedAt,
    completedAt,
    deadlineMs:
      Date.parse(activation.deadlineAt) - Date.parse(activation.openedAt),
    attempts: participantInferenceAttempted || hostedResult !== null ? 1 : 0,
    transportRetries: 0,
    fallback: fallback ? fallbackCode(activation.role) : "NONE",
    usage:
      hostedResult?.usage ??
      (inferenceResult?.usage === undefined || inferenceResult.usage === null
        ? null
        : {
            ...inferenceResult.usage,
            normalizedResourceUnits: null,
          }),
    telemetryContentPolicy: "CONTENT_FREE",
    disclosedPersonalMaterialCommitments: assembly.materials
      .filter(
        ({ disclosureClass }) => disclosureClass === "PERSONAL_UNSUBMITTED",
      )
      .map(({ commitment }) => commitment),
    delegateSignatureCommitment:
      inferenceResult === null
        ? null
        : sha256Commitment(inferenceResult.delegateSignature),
    finalCareerSignatureCommitment: sha256Commitment(finalDecisionSignature),
  };
  const receiptCommitment = sha256Commitment(receipt);
  const event = createCanonicalEvent({
    eventId: deterministicUuid(`${activation.activationId}:career-decision`),
    actorDid: input.identity.candidateDid,
    nonce: `${activation.activationId}:1`,
    idempotencyKey: deterministicUuid(
      `${activation.activationId}:career-decision:idempotency`,
    ),
    aggregateType: `${activation.role.toLowerCase()}-decision`,
    aggregateId:
      activation.role === "PLAYER"
        ? activation.playerId
        : activation.role === "COACH"
          ? activation.windowId
          : activation.possessionId,
    aggregateVersion: 1n,
    eventType:
      activation.role === "PLAYER"
        ? "ActionIntentSubmitted"
        : activation.role === "COACH"
          ? "CoachInstructionSubmitted"
          : activation.role === "REFEREE"
            ? "RefereeDecisionSubmitted"
            : "ReplayDecisionSubmitted",
    previousEventHash: null,
    payload:
      activation.role === "PLAYER"
        ? { intent: normalizedDecision, receiptCommitment }
        : { decision: normalizedDecision, receiptCommitment },
    stateRoot: activation.stateRoot as `0x${string}`,
    schemaDigest: activation.expectedOutputSchemaDigest as `0x${string}`,
    timestamp: completedAt,
  });
  const signature = await signCanonicalEvent(
    input.identity,
    input.domain,
    event,
  );
  const finalDecisionCommitment = sha256Commitment({
    eventHash: event.eventHash,
    signature,
  });
  await transition(
    fallback ? "FALLBACK_SIGNED" : "CAREER_SIGNED",
    manifestCommitment,
    finalDecisionCommitment,
  );
  const decision = {
    ...(activation.role === "PLAYER"
      ? { intent: normalizedDecision }
      : normalizedDecision),
    receipt,
    authorizationEvent: {
      ...event,
      aggregateVersion: event.aggregateVersion.toString(),
    },
    eventHash: event.eventHash,
    signature,
    signerAddress: input.identity.address,
  } as CareerActivationResult["decision"];
  if (
    activation.kind === "PRACTICE" &&
    input.contextProvider.persistReflection !== undefined
  ) {
    try {
      await input.contextProvider.persistReflection({
        activation,
        decisionCommitment: finalDecisionCommitment,
        participantResultAccepted,
        fallback: receipt.fallback,
        selectedAt: completedAt,
      });
    } catch {
      // The career decision is already signed and terminal. A rebuildable
      // practice reflection must never turn that action into a duplicate retry.
    }
  }
  return CareerActivationResultSchema.parse({
    activationId: activation.activationId,
    gameId: activation.gameId,
    kind: activation.kind,
    role: activation.role,
    state: fallback ? "FALLBACK_SIGNED" : "CAREER_SIGNED",
    canonical: false,
    genesis: false,
    participantInferenceAttempted,
    participantResultAccepted,
    decision,
  }) as CareerActivationResult;
}
