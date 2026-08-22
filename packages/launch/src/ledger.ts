import { LaunchStateSchema, SchemaVersion } from "@abl/schemas";
import { sha256Commitment } from "@abl/recognition";
import { z } from "zod";

const RequirementSchema = z.strictObject({
  requirementId: z.string().min(1).max(160),
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
    "RECOVERY_CONTROL_REMOVAL",
  ]),
  state: z.enum(["NOT_REQUESTED", "PENDING", "GRANTED", "DENIED"]),
  approvalId: z.string().min(1).max(200).nullable(),
});

const SignatureSchema = z.strictObject({
  signatureId: z.string().min(1).max(200),
  purpose: z.string().min(1).max(500),
  signerDid: z.string().min(1).max(500).nullable(),
  state: z.enum(["NOT_REQUIRED", "REQUIRED", "VERIFIED", "FAILED"]),
  evidenceId: z.string().min(1).max(200).nullable(),
});

export const LaunchLedgerInputSchema = z.strictObject({
  launchStage: z.enum([
    "LOCAL_GATE_1",
    "PRIVATE_STAGING",
    "READ_ONLY_BEACON",
    "PRIVATE_FOUNDING_ALPHA",
    "CAPPED_FOUNDING_INTAKE",
    "WITNESSED_PRE_GENESIS_V1",
    "PRODUCTION_GENESIS",
  ]),
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
      state: z.enum(["NOT_APPLIED", "PRIVATE", "PUBLIC", "ROLLED_BACK"]),
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

export function deriveLaunchLedger(candidate: unknown): LaunchLedger {
  const input = LaunchLedgerInputSchema.parse(candidate);
  const evidenceById = new Map(
    input.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const blockingReasons: string[] = [];
  for (const requirement of input.requirements) {
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

  const genesisRequested = input.operatingProfile === "PRODUCTION_GENESIS";
  if (genesisRequested) {
    if (input.recognitionLevel !== "ONCHAIN_FINALIZED")
      blockingReasons.push("Genesis recognition is not ONCHAIN_FINALIZED");
    for (const action of [
      "MATERIAL_SPEND",
      "RESOURCE_CREATION",
      "PUBLIC_EXPOSURE",
      "RECOGNITION_BROADCAST",
      "FOUNDING_AGENT_DECISION",
    ] as const) {
      const approval = input.approvals.find((item) => item.action === action);
      if (approval?.state !== "GRANTED" || approval.approvalId === null)
        blockingReasons.push(`${action}: approval not granted`);
    }
  }

  const ready = blockingReasons.length === 0;
  const evidenceDigest = sha256Commitment({
    requirements: input.requirements,
    evidence: input.evidence,
    signatures: input.signatures,
    approvals: input.approvals,
    resources: input.resources,
    deployments: input.deployments,
    incidents: input.incidents,
  });
  const launchState = LaunchStateSchema.parse({
    schemaVersion: SchemaVersion,
    launchStage: ready ? input.launchStage : "LOCAL_GATE_1",
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
    productionV1Ready: ready,
    publicExposure:
      ready && genesisRequested
        ? "GENESIS"
        : input.deployments.some((deployment) => deployment.state === "PUBLIC")
          ? "READ_ONLY"
          : "NONE",
    candidateIntake: input.intake,
    evidenceDigest,
    blockingReasons: [...new Set(blockingReasons)].sort(),
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
