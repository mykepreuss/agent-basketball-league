import {
  CareerExitSchema,
  DeletionAttestationSchema,
  DidSchema,
  ExitPackageSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidV7Schema,
} from "@abl/schemas";
import { sha256Commitment, type SigningIdentity } from "@abl/recognition";
import {
  getAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const UnsignedCareerExitSchema = CareerExitSchema.omit({ signature: true });
const UnsignedExitPackageSchema = ExitPackageSchema.omit({
  institutionalSignatures: true,
});
const UnsignedDeletionAttestationSchema = DeletionAttestationSchema.omit({
  institutionalSignatures: true,
});

const ExitPackagePreparedSchema = z.strictObject({
  package: ExitPackageSchema,
});
const CareerExitRequestedSchema = z.strictObject({
  exit: CareerExitSchema,
});
const CareerExitCancelledSchema = z.strictObject({
  exitId: UuidV7Schema,
  agentDid: DidSchema,
  cancelledAt: IsoDateTimeSchema,
  reasonCommitment: Sha256Schema,
});
const ExitDeletionAttestedSchema = z.strictObject({
  attestation: DeletionAttestationSchema,
});
const ExitInspectedSchema = z.strictObject({
  agentDid: DidSchema,
  requestedAt: IsoDateTimeSchema,
  format: z.literal("ABL-PORTABLE-EXIT-INSPECTION-V1"),
});

export const ExitWorkflowPayloadSchemas = {
  ExitPackagePrepared: ExitPackagePreparedSchema,
  CareerExitRequested: CareerExitRequestedSchema,
  CareerExitCancelled: CareerExitCancelledSchema,
  ExitDeletionAttested: ExitDeletionAttestedSchema,
  ExitInspected: ExitInspectedSchema,
} as const;

export type ExitWorkflowEventType = keyof typeof ExitWorkflowPayloadSchemas;
export type UnsignedCareerExit = z.infer<typeof UnsignedCareerExitSchema>;
export type UnsignedExitPackage = z.infer<typeof UnsignedExitPackageSchema>;
export type UnsignedDeletionAttestation = z.infer<
  typeof UnsignedDeletionAttestationSchema
>;
export type SignedCareerExit = z.infer<typeof CareerExitSchema>;
export type SignedExitPackage = z.infer<typeof ExitPackageSchema>;
export type SignedDeletionAttestation = z.infer<
  typeof DeletionAttestationSchema
>;

export interface ExitWorkflowSnapshot {
  agentDid: string;
  version: number;
  lastTransitionAt: string;
  package: SignedExitPackage | null;
  exit: SignedCareerExit | null;
  deletionAttestations: SignedDeletionAttestation[];
  cancelledRequests: Array<{
    package: SignedExitPackage;
    exit: SignedCareerExit;
    cancelledAt: string;
    reasonCommitment: string;
  }>;
  penalty: null;
}

export interface ExitWorkflowTransition {
  agentDid: string;
  aggregateVersion: bigint;
  eventType: ExitWorkflowEventType;
  payload: unknown;
  timestamp: string;
}

export type ExitArtifactType =
  | "EXIT_PACKAGE"
  | "CAREER_EXIT_REQUEST"
  | "DELETION_ATTESTATION";

export interface ExitArtifactAuthorizationMessage {
  artifactType: ExitArtifactType;
  artifactId: string;
  agentDid: string;
  artifactCommitment: Hex;
  issuedAt: string;
}

export const ExitArtifactAuthorizationTypes = {
  PortableExitArtifact: [
    { name: "artifactType", type: "string" },
    { name: "artifactId", type: "string" },
    { name: "agentDid", type: "string" },
    { name: "artifactCommitment", type: "bytes32" },
    { name: "issuedAt", type: "string" },
  ],
} as const;

export class ExitWorkflowError extends Error {
  public override readonly name = "ExitWorkflowError";
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || value !== new Date(parsed).toISOString())
    throw new ExitWorkflowError("Exit timestamp is not canonical");
  return parsed;
}

function requireEventTime(payloadTime: string, eventTime: string): void {
  if (instant(payloadTime) !== instant(eventTime))
    throw new ExitWorkflowError("Exit transition time does not match event");
}

function requireAgent(value: string, agentDid: string): void {
  if (value !== agentDid)
    throw new ExitWorkflowError("Exit artifact belongs to another agent");
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new ExitWorkflowError(`${label} contains duplicates`);
}

export function unsignedExitPackage(
  value: SignedExitPackage,
): UnsignedExitPackage {
  const { institutionalSignatures: _signatures, ...unsigned } = value;
  return UnsignedExitPackageSchema.parse(unsigned);
}

export function unsignedCareerExit(
  value: SignedCareerExit,
): UnsignedCareerExit {
  const { signature: _signature, ...unsigned } = value;
  return UnsignedCareerExitSchema.parse(unsigned);
}

export function unsignedDeletionAttestation(
  value: SignedDeletionAttestation,
): UnsignedDeletionAttestation {
  const { institutionalSignatures: _signatures, ...unsigned } = value;
  return UnsignedDeletionAttestationSchema.parse(unsigned);
}

export function exitPackageCommitment(value: SignedExitPackage): Hex {
  return sha256Commitment(ExitPackageSchema.parse(value));
}

export function exitArtifactAuthorizationMessage(
  value: UnsignedExitPackage | UnsignedCareerExit | UnsignedDeletionAttestation,
): ExitArtifactAuthorizationMessage {
  if ("careerRecordCommitment" in value) {
    const parsed = UnsignedExitPackageSchema.parse(value);
    return {
      artifactType: "EXIT_PACKAGE",
      artifactId: parsed.exitId,
      agentDid: parsed.agentDid,
      artifactCommitment: sha256Commitment(parsed),
      issuedAt: parsed.issuedAt,
    };
  }
  if ("exitPackageCommitment" in value) {
    const parsed = UnsignedCareerExitSchema.parse(value);
    return {
      artifactType: "CAREER_EXIT_REQUEST",
      artifactId: parsed.exitId,
      agentDid: parsed.agentDid,
      artifactCommitment: sha256Commitment(parsed),
      issuedAt: parsed.requestedAt,
    };
  }
  const parsed = UnsignedDeletionAttestationSchema.parse(value);
  return {
    artifactType: "DELETION_ATTESTATION",
    artifactId: parsed.attestationId,
    agentDid: parsed.agentDid,
    artifactCommitment: sha256Commitment(parsed),
    issuedAt: parsed.attestedAt,
  };
}

export async function signExitArtifact(
  identity: SigningIdentity,
  domain: TypedDataDomain,
  value: UnsignedExitPackage | UnsignedCareerExit | UnsignedDeletionAttestation,
): Promise<Hex> {
  return privateKeyToAccount(identity.privateKey).signTypedData({
    domain,
    types: ExitArtifactAuthorizationTypes,
    primaryType: "PortableExitArtifact",
    message: exitArtifactAuthorizationMessage(value),
  });
}

export async function recoverExitArtifactSigner(
  domain: TypedDataDomain,
  value: UnsignedExitPackage | UnsignedCareerExit | UnsignedDeletionAttestation,
  signature: Hex,
): Promise<Address> {
  return getAddress(
    await recoverTypedDataAddress({
      domain,
      types: ExitArtifactAuthorizationTypes,
      primaryType: "PortableExitArtifact",
      message: exitArtifactAuthorizationMessage(value),
      signature,
    }),
  );
}

function packageFromTransition(
  transition: ExitWorkflowTransition,
): SignedExitPackage {
  const payload = ExitPackagePreparedSchema.parse(transition.payload);
  const packageValue = payload.package;
  requireAgent(packageValue.agentDid, transition.agentDid);
  requireEventTime(packageValue.issuedAt, transition.timestamp);
  requireUnique(
    packageValue.institutionalSignatures,
    "Exit package signatures",
  );
  return packageValue;
}

function applyPackage(
  transition: ExitWorkflowTransition,
): ExitWorkflowSnapshot {
  if (transition.aggregateVersion !== 1n)
    throw new ExitWorkflowError(
      "Portable exit package must be aggregate version one",
    );
  const packageValue = packageFromTransition(transition);
  return {
    agentDid: transition.agentDid,
    version: 1,
    lastTransitionAt: transition.timestamp,
    package: structuredClone(packageValue),
    exit: null,
    deletionAttestations: [],
    cancelledRequests: [],
    penalty: null,
  };
}

export function applyExitWorkflowTransition(
  current: ExitWorkflowSnapshot | null,
  transition: ExitWorkflowTransition,
): ExitWorkflowSnapshot {
  if (current === null) {
    if (transition.eventType !== "ExitPackagePrepared")
      throw new ExitWorkflowError(
        "Portable exit package must be prepared first",
      );
    return applyPackage(transition);
  }
  if (transition.agentDid !== current.agentDid)
    throw new ExitWorkflowError("Exit aggregate agent changed");
  if (transition.aggregateVersion !== BigInt(current.version + 1))
    throw new ExitWorkflowError("Exit aggregate version is not contiguous");
  if (instant(transition.timestamp) < instant(current.lastTransitionAt))
    throw new ExitWorkflowError("Exit transitions are out of order");

  const next = structuredClone(current);
  next.version += 1;
  next.lastTransitionAt = transition.timestamp;

  if (transition.eventType === "ExitPackagePrepared") {
    if (current.exit !== null)
      throw new ExitWorkflowError("Career exit is already requested");
    next.package = structuredClone(packageFromTransition(transition));
    return next;
  }

  if (transition.eventType === "CareerExitRequested") {
    if (next.exit !== null)
      throw new ExitWorkflowError("Career exit is already requested");
    if (next.package === null)
      throw new ExitWorkflowError("Portable exit package is absent");
    const { exit } = CareerExitRequestedSchema.parse(transition.payload);
    requireAgent(exit.agentDid, transition.agentDid);
    requireEventTime(exit.requestedAt, transition.timestamp);
    if (exit.exitId !== next.package.exitId)
      throw new ExitWorkflowError("Exit request and package IDs differ");
    if (exit.exitPackageCommitment !== exitPackageCommitment(next.package))
      throw new ExitWorkflowError("Exit request does not bind the package");
    if (instant(exit.effectiveAt) < instant(exit.requestedAt))
      throw new ExitWorkflowError("Exit cannot take effect before request");
    requireUnique(
      exit.outstandingSharedRecordReferences,
      "Outstanding shared record references",
    );
    next.exit = structuredClone(exit);
    return next;
  }

  if (transition.eventType === "CareerExitCancelled") {
    if (next.exit === null || next.package === null)
      throw new ExitWorkflowError("Career exit is not scheduled");
    const cancellation = CareerExitCancelledSchema.parse(transition.payload);
    requireAgent(cancellation.agentDid, transition.agentDid);
    requireEventTime(cancellation.cancelledAt, transition.timestamp);
    if (cancellation.exitId !== next.exit.exitId)
      throw new ExitWorkflowError("Exit cancellation ID does not match");
    if (instant(cancellation.cancelledAt) >= instant(next.exit.effectiveAt))
      throw new ExitWorkflowError("Effective career exit cannot be cancelled");
    next.cancelledRequests.push({
      package: next.package,
      exit: next.exit,
      cancelledAt: cancellation.cancelledAt,
      reasonCommitment: cancellation.reasonCommitment,
    });
    next.package = null;
    next.exit = null;
    return next;
  }

  if (transition.eventType === "ExitDeletionAttested") {
    if (next.exit === null || next.package === null)
      throw new ExitWorkflowError("Career exit must be requested first");
    if (instant(transition.timestamp) < instant(next.exit.effectiveAt))
      throw new ExitWorkflowError("Deletion cannot precede effective exit");
    const { attestation } = ExitDeletionAttestedSchema.parse(
      transition.payload,
    );
    requireAgent(attestation.agentDid, transition.agentDid);
    requireEventTime(attestation.attestedAt, transition.timestamp);
    requireUnique(attestation.targetCommitments, "Deletion targets");
    requireUnique(attestation.verifiedSystems, "Verified systems");
    requireUnique(
      attestation.unverifiedResidualAccess,
      "Unverified residual access",
    );
    if (
      attestation.targetCommitments.length === 0 ||
      attestation.verifiedSystems.length === 0 ||
      attestation.unverifiedResidualAccess.length === 0
    ) {
      throw new ExitWorkflowError(
        "Deletion attestation must state targets, verified systems, and residual limits",
      );
    }
    const allowedTargets = new Set([
      next.package.encryptedPackageCommitment,
      next.package.memoryExportCommitment,
      next.package.bodyManifestDigest,
    ]);
    if (
      attestation.targetCommitments.some(
        (commitment) => !allowedTargets.has(commitment),
      )
    ) {
      throw new ExitWorkflowError(
        "Deletion attestation targets unbound material",
      );
    }
    if (
      next.deletionAttestations.some(
        (item) => item.attestationId === attestation.attestationId,
      )
    ) {
      throw new ExitWorkflowError("Deletion attestation is already recorded");
    }
    requireUnique(
      attestation.institutionalSignatures,
      "Deletion attestation signatures",
    );
    next.deletionAttestations.push(structuredClone(attestation));
    return next;
  }

  const inspection = ExitInspectedSchema.parse(transition.payload);
  requireAgent(inspection.agentDid, transition.agentDid);
  requireEventTime(inspection.requestedAt, transition.timestamp);
  return next;
}

export function exitWorkflowStateRoot(snapshot: ExitWorkflowSnapshot): Hex {
  return sha256Commitment({
    format: "ABL-PORTABLE-EXIT-STATE-V1",
    ...snapshot,
  });
}

export function careerExitState(
  snapshot: ExitWorkflowSnapshot | null,
  at: string,
): "NOT_REQUESTED" | "SCHEDULED" | "EXITED" {
  const atTime = instant(at);
  if (snapshot === null || snapshot.exit === null) return "NOT_REQUESTED";
  return atTime < instant(snapshot.exit.effectiveAt) ? "SCHEDULED" : "EXITED";
}
