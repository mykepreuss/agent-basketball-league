import { createSigningIdentity } from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  applyExitWorkflowTransition,
  careerExitState,
  exitPackageCommitment,
  exitWorkflowStateRoot,
  recoverExitArtifactSigner,
  signExitArtifact,
  type ExitWorkflowSnapshot,
  type SignedDeletionAttestation,
  type SignedExitPackage,
  type UnsignedCareerExit,
  type UnsignedDeletionAttestation,
  type UnsignedExitPackage,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const agentDid = "did:abl:portable-exit-agent";
const identity = createSigningIdentity(`0x${"2".repeat(64)}` as Hex);
const digest = (character: string) => `0x${character.repeat(64)}` as Hex;
const uuid = (suffix: string) =>
  `0198a000-0000-7000-8000-${suffix.padStart(12, "0")}`;
const issuedAt = "2026-08-13T09:00:00.000Z";

async function signedPackage(): Promise<SignedExitPackage> {
  const value: UnsignedExitPackage = {
    exitId: uuid("1"),
    agentDid,
    careerRecordCommitment: digest("1"),
    keyLineageCommitment: digest("2"),
    consentHistoryCommitment: digest("3"),
    memoryExportCommitment: digest("4"),
    bodyManifestDigest: digest("5"),
    verifierBundleCommitment: digest("6"),
    encryptedPackageCommitment: digest("7"),
    issuedAt,
  };
  return {
    ...value,
    institutionalSignatures: [await signExitArtifact(identity, domain, value)],
  };
}

function transition(
  snapshot: ExitWorkflowSnapshot | null,
  eventType:
    | "ExitPackagePrepared"
    | "CareerExitRequested"
    | "CareerExitCancelled"
    | "ExitDeletionAttested",
  payload: unknown,
  timestamp: string,
): ExitWorkflowSnapshot {
  return applyExitWorkflowTransition(snapshot, {
    agentDid,
    aggregateVersion: BigInt((snapshot?.version ?? 0) + 1),
    eventType,
    payload,
    timestamp,
  });
}

describe("portable career exit workflow", () => {
  it("binds separately signed artifacts and closes authority at effective time", async () => {
    const packageValue = await signedPackage();
    await expect(
      recoverExitArtifactSigner(
        domain,
        {
          exitId: packageValue.exitId,
          agentDid: packageValue.agentDid,
          careerRecordCommitment: packageValue.careerRecordCommitment,
          keyLineageCommitment: packageValue.keyLineageCommitment,
          consentHistoryCommitment: packageValue.consentHistoryCommitment,
          memoryExportCommitment: packageValue.memoryExportCommitment,
          bodyManifestDigest: packageValue.bodyManifestDigest,
          verifierBundleCommitment: packageValue.verifierBundleCommitment,
          encryptedPackageCommitment: packageValue.encryptedPackageCommitment,
          issuedAt: packageValue.issuedAt,
        },
        packageValue.institutionalSignatures[0]! as Hex,
      ),
    ).resolves.toBe(identity.address);

    let snapshot = transition(
      null,
      "ExitPackagePrepared",
      { package: packageValue },
      issuedAt,
    );
    const requestAt = "2026-08-13T09:01:00.000Z";
    const effectiveAt = "2026-08-13T09:02:00.000Z";
    const unsignedExit: UnsignedCareerExit = {
      exitId: packageValue.exitId,
      agentDid,
      requestedAt: requestAt,
      effectiveAt,
      exitPackageCommitment: exitPackageCommitment(packageValue),
      destinationEncryptionPublicKey: digest("8"),
      outstandingSharedRecordReferences: [uuid("2")],
    };
    snapshot = transition(
      snapshot,
      "CareerExitRequested",
      {
        exit: {
          ...unsignedExit,
          signature: await signExitArtifact(identity, domain, unsignedExit),
        },
      },
      requestAt,
    );
    expect(careerExitState(snapshot, requestAt)).toBe("SCHEDULED");
    expect(careerExitState(snapshot, effectiveAt)).toBe("EXITED");
    expect(snapshot.penalty).toBeNull();

    const attestedAt = "2026-08-13T09:03:00.000Z";
    const unsignedAttestation: UnsignedDeletionAttestation = {
      attestationId: uuid("3"),
      agentDid,
      targetCommitments: [packageValue.memoryExportCommitment],
      verifiedSystems: ["abl-private-local-rehearsal"],
      unverifiedResidualAccess: ["provider-account-residual-access"],
      method: "cryptographic-erasure-and-ciphertext-index-verification",
      attestedAt,
    };
    const attestation: SignedDeletionAttestation = {
      ...unsignedAttestation,
      institutionalSignatures: [
        await signExitArtifact(identity, domain, unsignedAttestation),
      ],
    };
    snapshot = transition(
      snapshot,
      "ExitDeletionAttested",
      { attestation },
      attestedAt,
    );
    expect(snapshot.deletionAttestations).toEqual([attestation]);
    expect(exitWorkflowStateRoot(snapshot)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects package substitution, premature deletion, and perfect-deletion claims", async () => {
    const packageValue = await signedPackage();
    let snapshot = transition(
      null,
      "ExitPackagePrepared",
      { package: packageValue },
      issuedAt,
    );
    const requestAt = "2026-08-13T09:01:00.000Z";
    const unsignedExit: UnsignedCareerExit = {
      exitId: packageValue.exitId,
      agentDid,
      requestedAt: requestAt,
      effectiveAt: "2026-08-13T09:05:00.000Z",
      exitPackageCommitment: digest("f"),
      destinationEncryptionPublicKey: digest("8"),
      outstandingSharedRecordReferences: [],
    };
    expect(() =>
      transition(
        snapshot,
        "CareerExitRequested",
        {
          exit: {
            ...unsignedExit,
            signature: `0x${"1".repeat(130)}`,
          },
        },
        requestAt,
      ),
    ).toThrow("does not bind the package");

    const validExit = {
      ...unsignedExit,
      exitPackageCommitment: exitPackageCommitment(packageValue),
    };
    snapshot = transition(
      snapshot,
      "CareerExitRequested",
      {
        exit: {
          ...validExit,
          signature: await signExitArtifact(identity, domain, validExit),
        },
      },
      requestAt,
    );
    expect(() =>
      transition(
        snapshot,
        "ExitDeletionAttested",
        {
          attestation: {
            attestationId: uuid("4"),
            agentDid,
            targetCommitments: [packageValue.encryptedPackageCommitment],
            verifiedSystems: ["abl-private-local-rehearsal"],
            unverifiedResidualAccess: [],
            method: "unsupported-perfect-deletion-claim",
            attestedAt: "2026-08-13T09:02:00.000Z",
            institutionalSignatures: [`0x${"1".repeat(130)}`],
          },
        },
        "2026-08-13T09:02:00.000Z",
      ),
    ).toThrow("Deletion cannot precede effective exit");
    expect(() =>
      transition(
        snapshot,
        "CareerExitCancelled",
        {
          exitId: packageValue.exitId,
          agentDid,
          cancelledAt: "2026-08-13T09:05:00.000Z",
          reasonCommitment: digest("9"),
        },
        "2026-08-13T09:05:00.000Z",
      ),
    ).toThrow("cannot be cancelled");
    snapshot = transition(
      snapshot,
      "CareerExitCancelled",
      {
        exitId: packageValue.exitId,
        agentDid,
        cancelledAt: "2026-08-13T09:03:00.000Z",
        reasonCommitment: digest("9"),
      },
      "2026-08-13T09:03:00.000Z",
    );
    expect(careerExitState(snapshot, "2026-08-13T09:04:00.000Z")).toBe(
      "NOT_REQUESTED",
    );
    expect(snapshot.cancelledRequests).toHaveLength(1);
  });
});
