import { describe, expect, it } from "vitest";

import {
  InstitutionalKeyRegistry,
  createSigningIdentity,
  sha256Commitment,
  signCheckpointAuthorization,
  signCheckpointWitness,
  thresholdPolicies,
  verifyCheckpointAuthorization,
  verifyCheckpointWitnesses,
  type CheckpointChainClaim,
  type CheckpointWitnessRecord,
  type InstitutionalKeyRecord,
  type SigningIdentity,
} from "../src/index.js";

const authorizedAt = "2026-08-18T09:00:00.000Z";

function institutionalRecord(
  identity: SigningIdentity,
  did: string,
  role: InstitutionalKeyRecord["role"],
): InstitutionalKeyRecord {
  return {
    address: identity.address,
    did,
    role,
    validFrom: "2026-08-01T00:00:00.000Z",
    validUntil: null,
    revokedAt: null,
    purpose: "SIGNING",
  };
}

function unsignedClaim(): CheckpointChainClaim {
  return {
    checkpointType: "RELEASE",
    subjectId: "season-zero-v1",
    root: sha256Commitment("v1-root"),
    previousRoot: sha256Commitment("prior-root"),
    nonce: sha256Commitment("v1-manifest"),
    validAfter: 1_787_040_000n,
    validBefore: 1_787_050_000n,
    chainId: 84532,
    contractAddress: "0x1111111111111111111111111111111111111111",
    transactionHash: null,
    blockNumber: null,
    signatures: [],
  };
}

describe("production V1 checkpoint authority", () => {
  it("verifies the same sorted institutional signatures before Base submission", async () => {
    const identities = [
      createSigningIdentity(),
      createSigningIdentity(),
      createSigningIdentity(),
      createSigningIdentity(),
    ];
    const records = [
      institutionalRecord(
        identities[0]!,
        "did:abl:commissioner-1",
        "COMMISSIONER",
      ),
      institutionalRecord(
        identities[1]!,
        "did:abl:commissioner-2",
        "COMMISSIONER",
      ),
      institutionalRecord(
        identities[2]!,
        "did:abl:integrity-1",
        "INTEGRITY_OFFICER",
      ),
      institutionalRecord(
        identities[3]!,
        "did:abl:integrity-2",
        "INTEGRITY_OFFICER",
      ),
    ];
    const sorted = identities.toSorted((left, right) =>
      left.address.toLowerCase().localeCompare(right.address.toLowerCase()),
    );
    const claim = unsignedClaim();
    claim.signatures = await Promise.all(
      sorted.map((identity) => signCheckpointAuthorization(identity, claim)),
    );
    await expect(
      verifyCheckpointAuthorization({
        claim,
        registry: new InstitutionalKeyRegistry(records),
        policy: thresholdPolicies.ROUTINE_RELEASE,
        authorizedAt,
      }),
    ).resolves.toMatchObject({ valid: true, reasons: [] });

    const reversed = { ...claim, signatures: [...claim.signatures].reverse() };
    await expect(
      verifyCheckpointAuthorization({
        claim: reversed,
        registry: new InstitutionalKeyRegistry(records),
        policy: thresholdPolicies.ROUTINE_RELEASE,
        authorizedAt,
      }),
    ).resolves.toMatchObject({
      valid: false,
      reasons: ["CHECKPOINT_AUTHORIZATION_SIGNERS_NOT_SORTED"],
    });
  });

  it("requires distinct registered administrative domains for witnesses", async () => {
    const identities = [createSigningIdentity(), createSigningIdentity()];
    const manifestDigest = sha256Commitment("witnessed-manifest");
    const root = sha256Commitment("witnessed-root");
    const records: CheckpointWitnessRecord[] = identities.map(
      (identity, index) => ({
        witnessId: `witness-${index + 1}`,
        address: identity.address,
        administrativeDomain: `operator-${index + 1}.example`,
        validFrom: "2026-08-01T00:00:00.000Z",
        validUntil: null,
      }),
    );
    const attestations = await Promise.all(
      identities.map(async (identity, index) => {
        const statement = {
          witnessId: records[index]!.witnessId,
          manifestDigest,
          root,
          observedAt: authorizedAt,
          publicationUri: `https://operator-${index + 1}.example/checkpoints/${manifestDigest}`,
        };
        return {
          ...statement,
          signature: await signCheckpointWitness(identity, statement),
        };
      }),
    );
    await expect(
      verifyCheckpointWitnesses({
        manifestDigest,
        root,
        attestations,
        registry: records,
        minimumWitnesses: 2,
        notBefore: "2026-08-18T08:59:00.000Z",
        evaluatedAt: "2026-08-18T09:05:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "VERIFIED",
      verifiedWitnessIds: ["witness-1", "witness-2"],
    });

    const aliasedRegistry = records.map((record) => ({
      ...record,
      administrativeDomain: "one-operator.example",
    }));
    await expect(
      verifyCheckpointWitnesses({
        manifestDigest,
        root,
        attestations,
        registry: aliasedRegistry,
        minimumWitnesses: 2,
        notBefore: "2026-08-18T08:59:00.000Z",
        evaluatedAt: "2026-08-18T09:05:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "INVALID",
      reasons: ["CHECKPOINT_WITNESS_REGISTRY_INVALID"],
    });

    await expect(
      verifyCheckpointWitnesses({
        manifestDigest,
        root,
        attestations,
        registry: records,
        minimumWitnesses: 2,
        notBefore: "2026-08-18T09:01:00.000Z",
        evaluatedAt: "2026-08-18T09:05:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "INVALID",
      reasons: ["CHECKPOINT_WITNESS_ATTESTATION_INVALID"],
    });

    await expect(
      verifyCheckpointWitnesses({
        manifestDigest,
        root,
        attestations,
        registry: records.map((record) => ({
          ...record,
          validUntil: record.validFrom,
        })),
        minimumWitnesses: 2,
        notBefore: "2026-08-18T08:59:00.000Z",
        evaluatedAt: "2026-08-18T09:05:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "INVALID",
      reasons: ["CHECKPOINT_WITNESS_REGISTRY_INVALID"],
    });
  });
});
