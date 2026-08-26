import {
  CandidateIntakeRepository,
  CandidateProvisioner,
  DryRunCandidateControlPlane,
  assessGenesisStartupEvidence,
  decryptCandidateEnvelope,
  parseCandidateIntakePolicy,
  type CandidateProvisioningRepository,
} from "@abl/launch";
import { blStartJob } from "@blaxel/core";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

import { createCandidateProvisionerServer } from "./server.js";
import { CandidateEdgeProvisioningRepository } from "./edge-repository.js";
import {
  BlaxelCandidateSandboxControlPlane,
  parseCandidateRuntimeAssignments,
  type CandidateRuntimeScope,
} from "./blaxel-control-plane.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function secret(name: string): Uint8Array {
  const decoded = Buffer.from(required(name), "base64url");
  if (decoded.byteLength !== 32)
    throw new Error(`${name} must contain exactly 256 bits`);
  return decoded;
}

const DomainSchema = z
  .strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
    chainId: z.number().int().positive(),
    verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .transform((domain) => ({
    ...domain,
    verifyingContract: domain.verifyingContract as `0x${string}`,
  }));
const CandidateProvisioningTaskSchema = z.strictObject({
  applicationId: z.uuid(),
  action: z.enum(["PROVISION", "RECONCILE_CLOSED"]).default("PROVISION"),
});
const candidateCommandDomain = DomainSchema.parse(
  JSON.parse(required("ABL_CANDIDATE_COMMAND_DOMAIN_JSON")),
);
const envelopeKey = secret("ABL_CANDIDATE_ENVELOPE_KEY");
const controlPlaneMode = z
  .enum(["DRY_RUN", "APPROVED_LIVE"])
  .parse(process.env.ABL_CANDIDATE_CONTROL_PLANE_MODE ?? "DRY_RUN");
const liveRuntimeScope =
  controlPlaneMode === "APPROVED_LIVE" ? candidateRuntimeScope() : null;
const genesisEvidenceDigest =
  liveRuntimeScope?.mode === "POST_GENESIS_SINGLE"
    ? verifiedGenesisEvidenceDigest()
    : undefined;
const targetApplicationId =
  liveRuntimeScope !== null &&
  liveRuntimeScope.mode !== "CAPPED_FOUNDING" &&
  liveRuntimeScope.mode !== "CAPPED_FOUNDING_AUTO"
    ? liveRuntimeScope.assignment.applicationId
    : null;
const controlPlane =
  controlPlaneMode === "DRY_RUN"
    ? new DryRunCandidateControlPlane()
    : new BlaxelCandidateSandboxControlPlane({
        workspace: required("ABL_CANDIDATE_WORKSPACE"),
        region: required("ABL_CANDIDATE_REGION"),
        imageReference: required("ABL_CANDIDATE_BODY_IMAGE_REFERENCE"),
        runtimeScope: liveRuntimeScope!,
        authorizationId: required(
          "ABL_CANDIDATE_PROVISIONING_AUTHORIZATION_ID",
        ),
        ...(genesisEvidenceDigest === undefined
          ? {}
          : { genesisEvidenceDigest }),
        fixedBrokerImageReference: required(
          "ABL_CANDIDATE_FIXED_BROKER_IMAGE_REFERENCE",
        ),
        ...(liveRuntimeScope?.mode === "CAPPED_FOUNDING_AUTO"
          ? {
              coreOrigin: required("ABL_CANDIDATE_CORE_ORIGIN"),
              corePreviewToken: required("ABL_CANDIDATE_CORE_PREVIEW_TOKEN"),
              candidateCommandDomain,
              ...(z
                .enum(["DISABLED", "ENABLED"])
                .parse(
                  process.env.ABL_CANDIDATE_COGNITION_MODE ?? "DISABLED",
                ) === "DISABLED"
                ? {}
                : {
                    foundingCognition: {
                      modelOrigin: required("ABL_CANDIDATE_MODEL_ORIGIN"),
                      modelPathPrefix: required(
                        "ABL_CANDIDATE_MODEL_PATH_PREFIX",
                      ),
                      modelCredential: required(
                        "ABL_CANDIDATE_MODEL_CREDENTIAL",
                      ),
                      modelWorkspace: required("ABL_CANDIDATE_MODEL_WORKSPACE"),
                      coordinatorDid: required(
                        "ABL_COMPETITION_COORDINATOR_DID",
                      ),
                      coordinatorSignerAddress: required(
                        "ABL_COMPETITION_COORDINATOR_SIGNER_ADDRESS",
                      ),
                    },
                  }),
            }
          : {}),
      });
if (
  controlPlaneMode === "APPROVED_LIVE" &&
  process.env.BL_WORKSPACE !== undefined &&
  process.env.BL_WORKSPACE !== required("ABL_CANDIDATE_WORKSPACE")
)
  throw new Error("Blaxel workload workspace differs from candidate policy");
const repository: CandidateProvisioningRepository =
  process.env.ABL_CANDIDATE_EDGE_ORIGIN === undefined
    ? new CandidateIntakeRepository(required("ABL_CANDIDATE_INTAKE_PATH"))
    : new CandidateEdgeProvisioningRepository({
        origin: process.env.ABL_CANDIDATE_EDGE_ORIGIN,
        authorizationToken: required("ABL_CANDIDATE_PROVISIONER_TOKEN"),
        previewToken: required("ABL_CANDIDATE_STORE_PREVIEW_TOKEN"),
      });
const provisioner = new CandidateProvisioner({
  challengeSecret: secret("ABL_CANDIDATE_CHALLENGE_SECRET"),
  repository,
  decryptEnvelope: (application) =>
    decryptCandidateEnvelope(application, envelopeKey),
  ...(process.env.ABL_CANDIDATE_ENVELOPE_KEY_ID === undefined
    ? {}
    : {
        envelopeRecipientKeyId: required("ABL_CANDIDATE_ENVELOPE_KEY_ID"),
      }),
  controlPlane,
  candidateCommandDomain,
  policy: parseCandidateIntakePolicy(
    JSON.parse(required("ABL_CANDIDATE_CAPACITY_POLICY_JSON")),
  ),
  makeReceiptId: uuidv7,
});

function candidateRuntimeScope(): CandidateRuntimeScope {
  const mode = z
    .enum([
      "BOUNDED_SINGLE",
      "CAPPED_FOUNDING",
      "CAPPED_FOUNDING_AUTO",
      "POST_GENESIS_SINGLE",
    ])
    .parse(process.env.ABL_CANDIDATE_RUNTIME_SCOPE ?? "BOUNDED_SINGLE");
  if (mode === "CAPPED_FOUNDING_AUTO") return { mode };
  if (mode === "CAPPED_FOUNDING")
    return {
      mode,
      assignments: parseCandidateRuntimeAssignments(
        JSON.parse(
          required("ABL_CANDIDATE_RUNTIME_ASSIGNMENTS_JSON"),
        ) as unknown,
      ),
    };
  return {
    mode,
    assignment: {
      applicationId: z
        .uuid()
        .parse(required("ABL_CANDIDATE_TARGET_APPLICATION_ID")),
      fixedBrokerOrigin: required("ABL_CANDIDATE_FIXED_BROKER_ORIGIN"),
      fixedBrokerResourceName: required("ABL_CANDIDATE_FIXED_BROKER_NAME"),
      capabilityTokenBase64: required(
        "ABL_CANDIDATE_FIXED_BROKER_CAPABILITY_TOKEN_B64",
      ),
      previewToken: required("ABL_CANDIDATE_FIXED_BROKER_PREVIEW_TOKEN"),
    },
  };
}

function verifiedGenesisEvidenceDigest(): `0x${string}` {
  const assessment = assessGenesisStartupEvidence(
    JSON.parse(required("ABL_GENESIS_STARTUP_EVIDENCE_JSON")),
  );
  if (!assessment.ready || assessment.evidenceDigest === null)
    throw new Error(
      `Post-Genesis provisioning evidence rejected: ${assessment.blockers.join("; ")}`,
    );
  return assessment.evidenceDigest;
}
if (process.env.ABL_CANDIDATE_PROVISIONER_MODE === "JOB") {
  blStartJob(async (candidate: unknown) => {
    const task = CandidateProvisioningTaskSchema.parse(candidate);
    if (
      targetApplicationId !== null &&
      task.applicationId !== targetApplicationId
    )
      throw new Error("Job task differs from the approved candidate target");
    const result =
      task.action === "PROVISION"
        ? await provisioner.process(task.applicationId)
        : await provisioner.reconcileClosedRuntime(task.applicationId);
    process.stdout.write(
      `${JSON.stringify({ processed: 1, applicationId: task.applicationId, action: task.action, result })}\n`,
    );
  });
} else {
  const app = createCandidateProvisionerServer({
    provisioner,
    authorizationToken: required("ABL_CANDIDATE_PROVISIONER_TOKEN"),
    controlPlaneMode,
  });
  await app.listen({
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "8080", 10),
  });
}
