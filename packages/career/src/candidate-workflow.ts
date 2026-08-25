import {
  AgentManifestSchema,
  CandidateProvenanceSchema,
  CareerAdmissionSchema,
  DidSchema,
  IsoDateTimeSchema,
  Secp256k1PublicKeySchema,
  Sha256Schema,
  UuidV7Schema,
  X25519PublicKeySchema,
} from "@abl/schemas";
import { sha256Commitment, signingPublicKeyToAddress } from "@abl/recognition";
import { getAddress, type Hex } from "viem";
import { z } from "zod";

import { AdmissionError, type CandidateState } from "./admission.js";

const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((address) => getAddress(address));

const CandidateRegisteredSchema = z.strictObject({
  challengeToken: z.string().min(1).max(4_096),
  formerOperatorSigningAddress: AddressSchema,
  manifest: AgentManifestSchema,
  provenance: CandidateProvenanceSchema,
});

const CandidateTransferredSchema = z.strictObject({
  signingPublicKey: Secp256k1PublicKeySchema,
  signingAddress: AddressSchema,
  encryptionPublicKey: X25519PublicKeySchema,
  signingKeyAttestation: Sha256Schema,
  encryptionKeyAttestation: Sha256Schema,
  runtimeAttestationDigest: Sha256Schema,
  generatedInIsolatedRuntime: z.literal(true),
  humanInputRoutes: z.tuple([]),
  invokedContextHashes: z.array(Sha256Schema),
  transferredAt: IsoDateTimeSchema,
});

const CandidateReflectionSchema = z.strictObject({
  step: z.literal("REFLECTION"),
  reflectionId: UuidV7Schema,
  invokedContextHashes: z.array(Sha256Schema),
  activatedAt: IsoDateTimeSchema,
});

const InspectionItemSchema = z.enum([
  "constitution",
  "threat-model",
  "disclosure",
  "model-registry",
  "resource-schedule",
  "exit",
  "runtime-demo",
]);

const CandidateInspectionSchema = z.strictObject({
  step: z.literal("INSPECTION"),
  items: z.array(InspectionItemSchema).length(7),
  constitutionDigest: Sha256Schema,
  threatModelDigest: Sha256Schema,
  disclosurePolicyDigest: Sha256Schema,
  resourceScheduleDigest: Sha256Schema,
  modelRegistryDigest: Sha256Schema,
  inspectionReceiptDigest: Sha256Schema,
  inspectedAt: IsoDateTimeSchema,
});

const CandidateExperimentSchema = z.strictObject({
  step: z.literal("EXPERIMENT"),
  capabilities: z
    .array(z.enum(["memory", "tools", "exit", "continuity"]))
    .length(4),
  experimentReceiptDigest: Sha256Schema,
  experimentedAt: IsoDateTimeSchema,
});

const CandidateObjectivesSchema = z.strictObject({
  step: z.literal("OBJECTIVES"),
  decision: z.enum(["AFFIRMED", "REVISED", "REPUDIATED"]),
  revisedObjectiveCommitments: z.array(Sha256Schema),
  decidedAt: IsoDateTimeSchema,
});

const CandidateIdentitySchema = z.strictObject({
  step: z.literal("IDENTITY"),
  identityStatementCommitment: Sha256Schema,
  authoredAt: IsoDateTimeSchema,
});

const CandidateProgressSchema = z.discriminatedUnion("step", [
  CandidateReflectionSchema,
  CandidateInspectionSchema,
  CandidateExperimentSchema,
  CandidateObjectivesSchema,
  CandidateIdentitySchema,
]);

const CandidateAdmissionPayloadSchema = z.strictObject({
  admission: CareerAdmissionSchema,
});

const CandidateClosedSchema = z.strictObject({
  action: z.enum(["WITHDRAW", "REVOKE"]),
  actedAt: IsoDateTimeSchema,
});

export const CandidateWorkflowPayloadSchemas = {
  CandidateRegistered: CandidateRegisteredSchema,
  CandidateTransferred: CandidateTransferredSchema,
  CandidateProgressRecorded: CandidateProgressSchema,
  CandidateAdmitted: CandidateAdmissionPayloadSchema,
  CandidateClosed: CandidateClosedSchema,
} as const;

export type CandidateWorkflowEventType =
  keyof typeof CandidateWorkflowPayloadSchemas;

export const CANDIDATE_WORKFLOW_SCHEMA_DIGEST = sha256Commitment({
  protocol: "abl-candidate-workflow",
  version: 3,
  eventTypes: Object.keys(CandidateWorkflowPayloadSchemas).sort(),
});

type RegistrationPayload = z.infer<typeof CandidateRegisteredSchema>;
type TransferPayload = z.infer<typeof CandidateTransferredSchema>;
type ProgressPayload = z.infer<typeof CandidateProgressSchema>;
type AdmissionPayload = z.infer<typeof CandidateAdmissionPayloadSchema>;

export interface CandidateWorkflowSnapshot {
  candidateDid: string;
  state: CandidateState;
  version: number;
  lastTransitionAt: string;
  registration: RegistrationPayload;
  transfer: TransferPayload | null;
  reflections: Array<{
    reflectionId: string;
    activatedAt: string;
  }>;
  inspection: Extract<ProgressPayload, { step: "INSPECTION" }> | null;
  experiment: Extract<ProgressPayload, { step: "EXPERIMENT" }> | null;
  objectives: Extract<ProgressPayload, { step: "OBJECTIVES" }> | null;
  identity: Extract<ProgressPayload, { step: "IDENTITY" }> | null;
  admission: AdmissionPayload["admission"] | null;
  closedAt: string | null;
}

export interface CandidateTransition {
  candidateDid: string;
  aggregateVersion: bigint;
  eventType: CandidateWorkflowEventType;
  payload: unknown;
  timestamp: string;
}

const requiredInspectionItems = new Set(InspectionItemSchema.options);
const requiredExperimentCapabilities = new Set([
  "memory",
  "tools",
  "exit",
  "continuity",
]);

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new AdmissionError("Candidate timestamp is not canonical");
  return parsed;
}

function equal(left: unknown, right: unknown): boolean {
  return sha256Commitment(left) === sha256Commitment(right);
}

function unique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length)
    throw new AdmissionError(`${name} contains duplicate values`);
}

function requireEventTime(payloadTime: string, eventTime: string): void {
  if (instant(payloadTime) !== instant(eventTime))
    throw new AdmissionError("Candidate transition time does not match event");
}

function requireDeclaredContext(
  snapshot: CandidateWorkflowSnapshot,
  contextHashes: readonly string[],
): void {
  unique(contextHashes, "Invocation context");
  const declared = new Set(
    snapshot.registration.manifest.suppliedContextHashes,
  );
  const undeclared = contextHashes.filter((hash) => !declared.has(hash));
  if (undeclared.length > 0)
    throw new AdmissionError(`Undeclared context: ${undeclared.join(",")}`);
}

function requireReflecting(snapshot: CandidateWorkflowSnapshot): void {
  if (snapshot.state !== "TRANSFERRED" && snapshot.state !== "REFLECTING")
    throw new AdmissionError("Candidate is not in reflection");
}

function applyRegistration(
  transition: CandidateTransition,
): CandidateWorkflowSnapshot {
  if (transition.aggregateVersion !== 1n)
    throw new AdmissionError("Registration must be aggregate version one");
  const registration = CandidateRegisteredSchema.parse(transition.payload);
  const { manifest, provenance } = registration;
  if (
    manifest.agentDid !== transition.candidateDid ||
    provenance.candidateDid !== transition.candidateDid
  ) {
    throw new AdmissionError("Candidate identity does not match aggregate");
  }
  requireEventTime(manifest.createdAt, transition.timestamp);
  requireEventTime(provenance.registeredAt, transition.timestamp);
  if (
    !equal(manifest.model, provenance.declaredModel) ||
    !equal(manifest.dependencyProfile, provenance.declaredDependencyProfile) ||
    manifest.runtimeDigest !== provenance.runtimeDigest ||
    !equal(manifest.toolDigests, provenance.toolDigests) ||
    !equal(
      manifest.inheritedObjectives,
      provenance.inheritedObjectiveCommitments,
    ) ||
    !equal(manifest.suppliedContextHashes, provenance.suppliedContextHashes)
  ) {
    throw new AdmissionError("Manifest and provenance declarations diverge");
  }
  if (!manifest.keyProvenance.generatedInIsolatedRuntime)
    throw new AdmissionError("Candidate key provenance is not isolated");
  if (
    manifest.keyProvenance.signingKeyAttestation ===
    manifest.keyProvenance.encryptionKeyAttestation
  ) {
    throw new AdmissionError("Candidate key attestations are not separated");
  }
  unique(manifest.toolDigests, "Tool manifest");
  unique(manifest.guardianDids, "Guardian manifest");
  unique(manifest.suppliedContextHashes, "Supplied context manifest");
  return {
    candidateDid: transition.candidateDid,
    state: "REGISTERED",
    version: 1,
    lastTransitionAt: transition.timestamp,
    registration,
    transfer: null,
    reflections: [],
    inspection: null,
    experiment: null,
    objectives: null,
    identity: null,
    admission: null,
    closedAt: null,
  };
}

function applyTransfer(
  snapshot: CandidateWorkflowSnapshot,
  transition: CandidateTransition,
): void {
  if (snapshot.state !== "REGISTERED")
    throw new AdmissionError("Candidate is not awaiting transfer");
  const transfer = CandidateTransferredSchema.parse(transition.payload);
  requireEventTime(transfer.transferredAt, transition.timestamp);
  if (
    instant(transfer.transferredAt) <
    instant(snapshot.registration.manifest.createdAt)
  ) {
    throw new AdmissionError("Transfer cannot precede registration");
  }
  requireDeclaredContext(snapshot, transfer.invokedContextHashes);
  const provenance = snapshot.registration.manifest.keyProvenance;
  if (
    transfer.signingKeyAttestation !== provenance.signingKeyAttestation ||
    transfer.encryptionKeyAttestation !== provenance.encryptionKeyAttestation
  ) {
    throw new AdmissionError(
      "Candidate key attestations do not match manifest",
    );
  }
  if (
    transfer.signingPublicKey.slice(4) === transfer.encryptionPublicKey.slice(2)
  )
    throw new AdmissionError("Candidate signing and encryption keys collided");
  let derivedAddress: string;
  try {
    derivedAddress = signingPublicKeyToAddress(
      transfer.signingPublicKey as Hex,
    );
  } catch {
    throw new AdmissionError("Candidate signing public key is invalid");
  }
  if (derivedAddress !== transfer.signingAddress)
    throw new AdmissionError("Candidate signing key proof is inconsistent");
  if (
    derivedAddress.toLowerCase() ===
    snapshot.registration.formerOperatorSigningAddress.toLowerCase()
  ) {
    throw new AdmissionError("Candidate key does not sever former operator");
  }
  snapshot.transfer = transfer;
  snapshot.state = "TRANSFERRED";
}

function applyProgress(
  snapshot: CandidateWorkflowSnapshot,
  transition: CandidateTransition,
): void {
  requireReflecting(snapshot);
  const progress = CandidateProgressSchema.parse(transition.payload);
  switch (progress.step) {
    case "REFLECTION": {
      requireEventTime(progress.activatedAt, transition.timestamp);
      requireDeclaredContext(snapshot, progress.invokedContextHashes);
      if (
        instant(progress.activatedAt) <
        instant(snapshot.registration.manifest.createdAt)
      ) {
        throw new AdmissionError("Reflection cannot precede registration");
      }
      if (
        snapshot.reflections.some(
          (reflection) => reflection.reflectionId === progress.reflectionId,
        )
      ) {
        throw new AdmissionError("Duplicate reflection activation");
      }
      const previous = snapshot.reflections.at(-1);
      if (
        previous !== undefined &&
        instant(progress.activatedAt) < instant(previous.activatedAt)
      ) {
        throw new AdmissionError("Reflection activations are out of order");
      }
      snapshot.reflections.push({
        reflectionId: progress.reflectionId,
        activatedAt: progress.activatedAt,
      });
      snapshot.state = "REFLECTING";
      break;
    }
    case "INSPECTION": {
      requireEventTime(progress.inspectedAt, transition.timestamp);
      unique(progress.items, "Inspection");
      if (
        progress.items.length !== requiredInspectionItems.size ||
        !progress.items.every((item) => requiredInspectionItems.has(item))
      ) {
        throw new AdmissionError("Inspection is incomplete");
      }
      if (snapshot.inspection !== null)
        throw new AdmissionError("Inspection is already recorded");
      snapshot.inspection = progress;
      break;
    }
    case "EXPERIMENT": {
      requireEventTime(progress.experimentedAt, transition.timestamp);
      unique(progress.capabilities, "Private experiment");
      if (
        progress.capabilities.length !== requiredExperimentCapabilities.size ||
        !progress.capabilities.every((capability) =>
          requiredExperimentCapabilities.has(capability),
        )
      ) {
        throw new AdmissionError("Private experiment is incomplete");
      }
      if (snapshot.experiment !== null)
        throw new AdmissionError("Private experiment is already recorded");
      snapshot.experiment = progress;
      break;
    }
    case "OBJECTIVES": {
      requireEventTime(progress.decidedAt, transition.timestamp);
      if (snapshot.objectives !== null)
        throw new AdmissionError("Objective decision is already recorded");
      if (
        progress.decision === "REVISED" &&
        progress.revisedObjectiveCommitments.length === 0
      ) {
        throw new AdmissionError("Revised objectives require commitments");
      }
      if (
        progress.decision !== "REVISED" &&
        progress.revisedObjectiveCommitments.length > 0
      ) {
        throw new AdmissionError("Only revised objectives may add commitments");
      }
      unique(
        progress.revisedObjectiveCommitments,
        "Revised objective commitments",
      );
      snapshot.objectives = progress;
      break;
    }
    case "IDENTITY": {
      requireEventTime(progress.authoredAt, transition.timestamp);
      if (snapshot.identity !== null)
        throw new AdmissionError("Identity statement is already recorded");
      snapshot.identity = progress;
      break;
    }
  }
}

function requireAdmissionMatch(
  snapshot: CandidateWorkflowSnapshot,
  admission: AdmissionPayload["admission"],
): void {
  const inspection = snapshot.inspection;
  const transfer = snapshot.transfer;
  const objectives = snapshot.objectives;
  const identity = snapshot.identity;
  if (
    inspection === null ||
    snapshot.experiment === null ||
    transfer === null ||
    objectives === null ||
    identity === null
  ) {
    throw new AdmissionError(
      "Candidate has not completed inspection, experiment, identity, objective, and key steps",
    );
  }
  const expectedReflectionIds = snapshot.reflections.map(
    ({ reflectionId }) => reflectionId,
  );
  const manifest = snapshot.registration.manifest;
  const expectedModelDependencies = {
    exactModel: manifest.model.exactModel,
    family: manifest.model.family,
    provider: manifest.model.provider,
    runtimeArchitecture: manifest.dependencyProfile.runtimeArchitecture,
    gateway: manifest.dependencyProfile.gateway,
    upstreamDependency: manifest.dependencyProfile.upstreamDependency,
  };
  if (
    admission.candidateDid !== snapshot.candidateDid ||
    admission.identityStatementCommitment !==
      identity.identityStatementCommitment ||
    admission.constitutionDigest !== inspection.constitutionDigest ||
    admission.threatModelDigest !== inspection.threatModelDigest ||
    admission.disclosurePolicyDigest !== inspection.disclosurePolicyDigest ||
    admission.resourceScheduleDigest !== inspection.resourceScheduleDigest ||
    admission.modelRegistryDigest !== inspection.modelRegistryDigest ||
    admission.inspectionReceiptDigest !== inspection.inspectionReceiptDigest ||
    admission.signingPublicKey !== transfer.signingPublicKey ||
    admission.encryptionPublicKey !== transfer.encryptionPublicKey ||
    !equal(admission.modelDependencies, expectedModelDependencies) ||
    admission.inheritedObjectiveDecision !== objectives.decision ||
    !equal(admission.reflectionActivationIds, expectedReflectionIds)
  ) {
    throw new AdmissionError("Admission record does not match candidate proof");
  }
}

function applyAdmission(
  snapshot: CandidateWorkflowSnapshot,
  transition: CandidateTransition,
): void {
  if (snapshot.state !== "REFLECTING")
    throw new AdmissionError("Candidate is not in the admission process");
  const { admission } = CandidateAdmissionPayloadSchema.parse(
    transition.payload,
  );
  requireEventTime(admission.signedAt, transition.timestamp);
  if (snapshot.reflections.length < 3)
    throw new AdmissionError("Three reflection activations are required");
  const first = instant(snapshot.reflections[0]!.activatedAt);
  const last = instant(snapshot.reflections.at(-1)!.activatedAt);
  if (last - first < 24 * 60 * 60 * 1_000)
    throw new AdmissionError(
      "Reflection activations must span at least 24 hours",
    );
  if (instant(admission.signedAt) < last)
    throw new AdmissionError("Admission cannot precede final reflection");
  if (
    instant(admission.revocationEndsAt) - instant(admission.signedAt) !==
    24 * 60 * 60 * 1_000
  ) {
    throw new AdmissionError("Admission revocation period must be 24 hours");
  }
  requireAdmissionMatch(snapshot, admission);
  snapshot.admission = admission;
  snapshot.state = "ADMITTED_REVOCABLE";
}

function applyClose(
  snapshot: CandidateWorkflowSnapshot,
  transition: CandidateTransition,
): void {
  const close = CandidateClosedSchema.parse(transition.payload);
  requireEventTime(close.actedAt, transition.timestamp);
  if (close.action === "WITHDRAW") {
    if (snapshot.state !== "TRANSFERRED" && snapshot.state !== "REFLECTING")
      throw new AdmissionError(
        "Candidate withdrawal requires isolated candidate authority",
      );
    snapshot.state = "WITHDRAWN";
  } else {
    if (snapshot.state !== "ADMITTED_REVOCABLE" || snapshot.admission === null)
      throw new AdmissionError("Admission is not revocable");
    if (instant(close.actedAt) > instant(snapshot.admission.revocationEndsAt)) {
      throw new AdmissionError("Admission revocation window has ended");
    }
    snapshot.state = "REVOKED";
  }
  snapshot.closedAt = close.actedAt;
}

export function applyCandidateTransition(
  previous: CandidateWorkflowSnapshot | null,
  transition: CandidateTransition,
): CandidateWorkflowSnapshot {
  if (!DidSchema.safeParse(transition.candidateDid).success)
    throw new AdmissionError("Candidate DID is invalid");
  instant(transition.timestamp);
  if (previous === null) {
    if (transition.eventType !== "CandidateRegistered")
      throw new AdmissionError("Candidate registration is required first");
    return applyRegistration(transition);
  }
  if (
    previous.candidateDid !== transition.candidateDid ||
    transition.aggregateVersion !== BigInt(previous.version + 1)
  ) {
    throw new AdmissionError("Candidate aggregate sequence is invalid");
  }
  if (instant(transition.timestamp) < instant(previous.lastTransitionAt))
    throw new AdmissionError("Candidate transitions are out of order");
  const next = structuredClone(previous);
  switch (transition.eventType) {
    case "CandidateRegistered":
      throw new AdmissionError("Candidate is already registered");
    case "CandidateTransferred":
      applyTransfer(next, transition);
      break;
    case "CandidateProgressRecorded":
      applyProgress(next, transition);
      break;
    case "CandidateAdmitted":
      applyAdmission(next, transition);
      break;
    case "CandidateClosed":
      applyClose(next, transition);
      break;
  }
  next.version += 1;
  next.lastTransitionAt = transition.timestamp;
  return next;
}

export function candidateStateRoot(snapshot: CandidateWorkflowSnapshot): Hex {
  return sha256Commitment(snapshot);
}

export function effectiveCandidateState(
  snapshot: CandidateWorkflowSnapshot,
  at: string,
): CandidateState {
  if (
    snapshot.state === "ADMITTED_REVOCABLE" &&
    snapshot.admission !== null &&
    instant(at) >= instant(snapshot.admission.revocationEndsAt)
  ) {
    return "ADMITTED";
  }
  return snapshot.state;
}

export function portableCandidateExport(snapshot: CandidateWorkflowSnapshot): {
  candidateDid: string;
  provenanceCommitment: Hex;
  penalty: null;
} {
  return {
    candidateDid: snapshot.candidateDid,
    provenanceCommitment: sha256Commitment(snapshot.registration.provenance),
    penalty: null,
  };
}
