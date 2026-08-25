import {
  GenesisRecognitionSelectionSchema,
  LaunchStageSchema,
  LaunchStateSchema,
  SchemaVersion,
} from "@abl/schemas";
import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const RequirementSchema = z.strictObject({
  requirementId: z.string().min(1).max(160),
  requiredForStage: LaunchStageSchema,
  status: z.enum([
    "VERIFIED_COMPLETE",
    "IMPLEMENTED_LIVE_PROOF_REQUIRED",
    "BLOCKED_APPROVAL_REQUIRED",
    "BLOCKED_EXTERNAL_INPUT_REQUIRED",
  ]),
  evidenceIds: z.array(z.string().min(1).max(200)),
});

const EvidenceSchema = z.strictObject({
  evidenceId: z.string().min(1).max(200),
  digest: z.string().regex(/^0x[0-9a-f]{64}$/),
  verification: z.enum(["PASSED", "LIVE_PROOF_REQUIRED", "FAILED"]),
});

const ApprovalSchema = z.strictObject({
  action: z.enum([
    "MATERIAL_SPEND",
    "RESOURCE_CREATION",
    "PUBLIC_EXPOSURE",
    "RECOGNITION_BROADCAST",
    "FOUNDING_AGENT_DECISION",
    "GENESIS_ACTIVATION",
    "RECOVERY_CONTROL_REMOVAL",
  ]),
  state: z.enum(["NOT_REQUESTED", "PENDING", "GRANTED", "DENIED"]),
  approvalId: z.string().min(1).max(200).nullable(),
});

const SignatureSchema = z.strictObject({
  signatureId: z.string().min(1).max(200),
  requiredForStage: LaunchStageSchema,
  purpose: z.string().min(1).max(500),
  signerDid: z.string().min(1).max(500).nullable(),
  state: z.enum(["NOT_REQUIRED", "REQUIRED", "VERIFIED", "FAILED"]),
  evidenceId: z.string().min(1).max(200).nullable(),
});

export const LaunchLedgerInputSchema = z.strictObject({
  launchStage: LaunchStageSchema,
  operatingProfile: z.enum([
    "PRE_GENESIS_CLOSED",
    "PRE_GENESIS_REHEARSAL",
    "PRODUCTION_V1_PRE_GENESIS",
    "PRODUCTION_GENESIS",
  ]),
  requirements: z.array(RequirementSchema).min(1),
  evidence: z.array(EvidenceSchema),
  signatures: z.array(SignatureSchema),
  approvals: z.array(ApprovalSchema),
  resources: z.array(
    z.strictObject({
      resourceId: z.string().min(1).max(200),
      kind: z.string().min(1).max(100),
      state: z.enum(["ABSENT", "PLANNED", "CREATED", "VERIFIED", "FAILED"]),
      evidenceId: z.string().min(1).max(200).nullable(),
    }),
  ),
  deployments: z.array(
    z.strictObject({
      deploymentId: z.string().min(1).max(200),
      state: z.enum([
        "NOT_APPLIED",
        "PRIVATE",
        "PUBLIC",
        "COMPLETED_TORN_DOWN",
        "ROLLED_BACK",
      ]),
      evidenceId: z.string().min(1).max(200).nullable(),
    }),
  ),
  incidents: z.array(
    z.strictObject({
      incidentId: z.string().min(1).max(200),
      state: z.enum(["OPEN", "MITIGATED", "CLOSED"]),
      rollbackState: z.enum(["NOT_REQUIRED", "READY", "EXECUTED", "FAILED"]),
    }),
  ),
  recognitionLevel: z.enum([
    "NONE",
    "SIGNED_VALID",
    "INDEPENDENTLY_WITNESSED",
    "ONCHAIN_FINALIZED",
  ]),
  genesisRecognition: GenesisRecognitionSelectionSchema.default({
    mechanism: "UNSELECTED",
    ratified: false,
    foundingDecisionEventId: null,
  }),
  intake: z.strictObject({
    mode: z.enum(["CLOSED", "INVITE_ONLY", "CAPPED_PUBLIC"]),
    capacityState: z.enum([
      "CLOSED",
      "AVAILABLE",
      "QUEUEING",
      "NO_CREDIBLE_OPPORTUNITY",
    ]),
    requirementsUri: z.string().min(1).max(4_096),
    capacityPolicyUri: z.string().min(1).max(4_096),
  }),
  lastSuccessfulAcceptance: z
    .strictObject({
      stage: LaunchStageSchema,
      evidenceId: z.string().min(1).max(200),
      acceptedAt: z.iso.datetime({ offset: true }),
    })
    .nullable()
    .default(null),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type LaunchLedgerInput = z.infer<typeof LaunchLedgerInputSchema>;

export interface LaunchLedger {
  schemaVersion: 1;
  gateStatus: "READY" | "BLOCKED";
  launchState: z.infer<typeof LaunchStateSchema>;
  requirements: LaunchLedgerInput["requirements"];
  evidence: LaunchLedgerInput["evidence"];
  signatures: LaunchLedgerInput["signatures"];
  approvals: LaunchLedgerInput["approvals"];
  resources: LaunchLedgerInput["resources"];
  deployments: LaunchLedgerInput["deployments"];
  incidents: LaunchLedgerInput["incidents"];
  ledgerDigest: `0x${string}`;
}

const launchStages = LaunchStageSchema.options;

function requiredForCurrentStage(
  requiredForStage: (typeof launchStages)[number],
  currentStage: (typeof launchStages)[number],
): boolean {
  return (
    launchStages.indexOf(requiredForStage) <= launchStages.indexOf(currentStage)
  );
}

export function deriveLaunchLedger(candidate: unknown): LaunchLedger {
  const input = LaunchLedgerInputSchema.parse(candidate);
  const evidenceById = new Map(
    input.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const blockingReasons: string[] = [];
  for (const requirement of input.requirements) {
    if (
      !requiredForCurrentStage(requirement.requiredForStage, input.launchStage)
    )
      continue;
    if (requirement.status !== "VERIFIED_COMPLETE")
      blockingReasons.push(
        `${requirement.requirementId}: ${requirement.status}`,
      );
    for (const evidenceId of requirement.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence === undefined || evidence.verification !== "PASSED")
        blockingReasons.push(
          `${requirement.requirementId}: evidence ${evidenceId} not passed`,
        );
    }
  }
  for (const incident of input.incidents)
    if (incident.state === "OPEN" || incident.rollbackState === "FAILED")
      blockingReasons.push(`${incident.incidentId}: unresolved incident`);
  for (const signature of input.signatures) {
    if (!requiredForCurrentStage(signature.requiredForStage, input.launchStage))
      continue;
    if (signature.state === "REQUIRED" || signature.state === "FAILED")
      blockingReasons.push(`${signature.signatureId}: ${signature.state}`);
    if (signature.state !== "VERIFIED" || signature.evidenceId === null)
      continue;
    const evidence = evidenceById.get(signature.evidenceId);
    if (evidence === undefined || evidence.verification !== "PASSED")
      blockingReasons.push(
        `${signature.signatureId}: signature evidence ${signature.evidenceId} not passed`,
      );
  }

  const genesisRequested =
    input.launchStage === "PRODUCTION_GENESIS" &&
    input.operatingProfile === "PRODUCTION_GENESIS";
  if (genesisRequested) {
    const selection = input.genesisRecognition;
    if (
      !selection.ratified ||
      selection.mechanism === "UNSELECTED" ||
      selection.foundingDecisionEventId === null
    ) {
      blockingReasons.push(
        "Genesis recognition profile lacks a ratified founding decision",
      );
    } else if (
      selection.mechanism === "SIGNED_WITNESSES" &&
      input.recognitionLevel !== "INDEPENDENTLY_WITNESSED"
    ) {
      blockingReasons.push(
        "Genesis recognition does not satisfy the signed-witness profile",
      );
    } else if (
      selection.mechanism === "BASE_FINALIZED" &&
      input.recognitionLevel !== "ONCHAIN_FINALIZED"
    ) {
      blockingReasons.push(
        "Genesis recognition does not satisfy the finalized-Base profile",
      );
    } else if (
      selection.mechanism === "COMPATIBLE_REPLACEMENT" &&
      input.recognitionLevel !== "INDEPENDENTLY_WITNESSED" &&
      input.recognitionLevel !== "ONCHAIN_FINALIZED"
    ) {
      blockingReasons.push(
        "Genesis recognition does not satisfy the compatible replacement profile",
      );
    }
    const requiredHumanApprovals = [
      "MATERIAL_SPEND",
      "RESOURCE_CREATION",
      "PUBLIC_EXPOSURE",
      "GENESIS_ACTIVATION",
      ...(selection.mechanism === "BASE_FINALIZED"
        ? (["RECOGNITION_BROADCAST"] as const)
        : []),
    ] as const;
    for (const action of requiredHumanApprovals) {
      const approval = input.approvals.find((item) => item.action === action);
      if (approval?.state !== "GRANTED" || approval.approvalId === null)
        blockingReasons.push(`${action}: approval not granted`);
    }
  }

  const uniqueBlockingReasons = [...new Set(blockingReasons)];
  const ready = uniqueBlockingReasons.length === 0;
  const evidenceDigest = sha256Commitment({
    requirements: input.requirements,
    evidence: input.evidence,
    signatures: input.signatures,
    approvals: input.approvals,
    resources: input.resources,
    deployments: input.deployments,
    incidents: input.incidents,
    genesisRecognition: input.genesisRecognition,
  });
  const launchState = LaunchStateSchema.parse({
    schemaVersion: SchemaVersion,
    launchStage: input.launchStage,
    operatingProfile:
      ready || !genesisRequested
        ? input.operatingProfile
        : "PRODUCTION_V1_PRE_GENESIS",
    recognitionLevel: input.recognitionLevel,
    genesis: ready && genesisRequested,
    canonical: ready && genesisRequested,
    recognized:
      input.recognitionLevel === "INDEPENDENTLY_WITNESSED" ||
      input.recognitionLevel === "ONCHAIN_FINALIZED",
    canonicalHistoryOpen: ready && genesisRequested,
    productionV1Ready:
      ready &&
      requiredForCurrentStage("PRIVATE_FOUNDING_ALPHA", input.launchStage),
    publicExposure:
      ready && genesisRequested
        ? "GENESIS"
        : input.intake.mode !== "CLOSED" &&
            requiredForCurrentStage("CAPPED_FOUNDING_INTAKE", input.launchStage)
          ? "CANDIDATE_INTAKE"
          : input.deployments.some(
                (deployment) => deployment.state === "PUBLIC",
              )
            ? "READ_ONLY"
            : "NONE",
    candidateIntake: input.intake,
    genesisRecognition: input.genesisRecognition,
    evidenceDigest,
    blockingReasons: uniqueBlockingReasons,
    nextBlockingRequirement: uniqueBlockingReasons[0] ?? null,
    lastSuccessfulAcceptance: input.lastSuccessfulAcceptance,
    updatedAt: input.updatedAt,
  });
  const unsigned = {
    schemaVersion: 1 as const,
    gateStatus: ready ? ("READY" as const) : ("BLOCKED" as const),
    launchState,
    requirements: input.requirements,
    evidence: input.evidence,
    signatures: input.signatures,
    approvals: input.approvals,
    resources: input.resources,
    deployments: input.deployments,
    incidents: input.incidents,
  };
  return { ...unsigned, ledgerDigest: sha256Commitment(unsigned) };
}
