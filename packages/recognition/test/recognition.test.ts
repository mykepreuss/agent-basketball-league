import { bytesToHex } from "@noble/hashes/utils.js";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  InstitutionalKeyRegistry,
  PublicVerifier,
  canonicalize,
  checkpointManifestDigest,
  checkpointTypes,
  createAgentKeyBundle,
  createCanonicalEvent,
  createCheckpointManifest,
  createSigningIdentity,
  dailyAggregateRoot,
  merkleProof,
  merkleRoot,
  recoverCanonicalEventSigner,
  sha256Commitment,
  signCanonicalEvent,
  signingPublicKeyToAddress,
  thresholdPolicies,
  verifyDeploymentAgainstRelease,
  verifyCheckpointClaim,
  verifyMerkleProof,
  type CanonicalEvent,
  type InstitutionalKeyRecord,
  type SigningIdentity,
} from "../src/index.js";

const at = "2026-08-13T09:00:00.000Z";
const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const digestA = `0x${"a".repeat(64)}` as Hex;
const digestB = `0x${"b".repeat(64)}` as Hex;
const digestC = `0x${"c".repeat(64)}` as Hex;

function event(overrides: Partial<CanonicalEvent<{ decision: string }>> = {}) {
  return createCanonicalEvent({
    eventId: "0198a000-0000-7000-8000-000000000101",
    actorDid: "did:abl:commission",
    nonce: "1",
    idempotencyKey: "0198a000-0000-7000-8000-000000000102",
    aggregateType: "release",
    aggregateId: "season-zero-runtime",
    aggregateVersion: 1n,
    eventType: "ReleaseRecognized",
    previousEventHash: null,
    payload: { decision: "recognize" },
    stateRoot: digestA,
    schemaDigest: digestB,
    timestamp: at,
    ...overrides,
  });
}

function record(
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

function authorityFixture() {
  const commissioners = [createSigningIdentity(), createSigningIdentity()];
  const integrity = [createSigningIdentity(), createSigningIdentity()];
  const identities = [...commissioners, ...integrity];
  const records = [
    ...commissioners.map((identity, index) =>
      record(identity, `did:abl:commissioner-${index}`, "COMMISSIONER"),
    ),
    ...integrity.map((identity, index) =>
      record(identity, `did:abl:integrity-${index}`, "INTEGRITY_OFFICER"),
    ),
  ];
  return {
    identities,
    records,
    registry: new InstitutionalKeyRegistry(records),
  };
}

describe("canonical commitments and key separation", () => {
  it("canonicalizes object keys and rejects values outside strict JSON", () => {
    expect(
      new TextDecoder().decode(canonicalize({ z: 1, a: [true, null, "x"] })),
    ).toBe('{"a":[true,null,"x"],"z":1}');
    expect(sha256Commitment({ b: 2, a: 1 })).toBe(
      sha256Commitment({ a: 1, b: 2 }),
    );
    expect(() => canonicalize({ bad: undefined })).toThrow("undefined");
    expect(() => canonicalize(Number.NaN)).toThrow("non-finite");
  });

  it("creates distinct secp256k1 signing and X25519 encryption identities and recovers EIP-712 signatures", async () => {
    const bundle = createAgentKeyBundle();
    expect(bundle.signing.publicKey).toMatch(/^0x(?:02|03)[0-9a-f]{64}$/);
    expect(bytesToHex(bundle.encryption.publicKey)).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.signing.publicKey.slice(2)).not.toBe(
      bytesToHex(bundle.encryption.publicKey),
    );
    expect(signingPublicKeyToAddress(bundle.signing.publicKey)).toBe(
      bundle.signing.address,
    );
    const canonicalEvent = event();
    const signature = await signCanonicalEvent(
      bundle.signing,
      domain,
      canonicalEvent,
    );
    await expect(
      recoverCanonicalEventSigner(domain, canonicalEvent, signature),
    ).resolves.toBe(bundle.signing.address);
  });
});

describe("Merkle and checkpoint commitments", () => {
  it("proves every leaf and commits category/daily manifests deterministically", () => {
    const leaves = [digestA, digestB, digestC];
    const root = merkleRoot(leaves);
    for (const [index, leaf] of leaves.entries())
      expect(verifyMerkleProof(leaf, merkleProof(leaves, index), root)).toBe(
        true,
      );
    expect(verifyMerkleProof(digestA, merkleProof(leaves, 0), digestB)).toBe(
      false,
    );
    const manifest = createCheckpointManifest({
      manifestId: "0198a000-0000-7000-8000-000000000111",
      checkpointType: "DAILY_ROOT",
      subjectId: "2026-08-13",
      eventHashes: leaves,
      institutionalKeyRegistryDigest: digestA,
      verifierDigest: digestB,
      previousManifestDigest: null,
      createdAt: at,
    });
    expect(manifest.merkleRoot).toBe(root);
    expect(checkpointManifestDigest(manifest)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(dailyAggregateRoot({ z: digestC, a: digestA })).toBe(
      dailyAggregateRoot({ a: digestA, z: digestC }),
    );
    expect(checkpointTypes).toEqual([
      "CONSTITUTION",
      "KEY_REGISTRY",
      "GAME",
      "BALLOT",
      "RELEASE",
      "RULING",
      "DAILY_ROOT",
    ]);
    const manifestDigest = checkpointManifestDigest(manifest);
    expect(
      verifyCheckpointClaim({
        manifest,
        manifestDigest,
        claimedRoot: root,
        transactionHash: digestC,
        blockNumber: 10n,
        confirmations: 2,
        requiredConfirmations: 12,
      }).label,
    ).toBe("PENDING_FINALITY");
    expect(
      verifyCheckpointClaim({
        manifest,
        manifestDigest,
        claimedRoot: root,
        transactionHash: digestC,
        blockNumber: 10n,
        confirmations: 12,
        requiredConfirmations: 12,
      }).label,
    ).toBe("CANONICAL");
  });
});

describe("institutional authorization and public fork labeling", () => {
  it("accepts exact agent thresholds and idempotent replay, then rejects history rewrites", async () => {
    const fixture = authorityFixture();
    const canonicalEvent = event();
    const signatures = await Promise.all(
      fixture.identities.map(async (identity) =>
        signCanonicalEvent(identity, domain, canonicalEvent),
      ),
    );
    const verifier = new PublicVerifier();
    await expect(
      verifier.verifyAndApply({
        event: canonicalEvent,
        signatures,
        domain,
        registry: fixture.registry,
        threshold: thresholdPolicies.ROUTINE_RELEASE,
        now: at,
      }),
    ).resolves.toMatchObject({ label: "CANONICAL" });
    await expect(
      verifier.verifyAndApply({
        event: canonicalEvent,
        signatures,
        domain,
        registry: fixture.registry,
        threshold: thresholdPolicies.ROUTINE_RELEASE,
        now: at,
      }),
    ).resolves.toMatchObject({
      label: "CANONICAL",
      reasons: ["IDEMPOTENT_REPLAY"],
    });

    const rewritten = {
      ...canonicalEvent,
      payload: { decision: "human rewrite" },
    };
    await expect(
      new PublicVerifier().verifyAndApply({
        event: rewritten,
        signatures,
        domain,
        registry: fixture.registry,
        threshold: thresholdPolicies.ROUTINE_RELEASE,
        now: at,
      }),
    ).resolves.toMatchObject({
      label: "NONCANONICAL_FORK",
      reasons: ["Payload commitment mismatch"],
    });
  });

  it("rejects human/unknown signatures, insufficient thresholds, inactive keys, and recusals", async () => {
    const fixture = authorityFixture();
    const canonicalEvent = event();
    const humanAdministrator = createSigningIdentity();
    const humanSignature = await signCanonicalEvent(
      humanAdministrator,
      domain,
      canonicalEvent,
    );
    const verifier = new PublicVerifier();
    await expect(
      verifier.verifyAndApply({
        event: canonicalEvent,
        signatures: [humanSignature],
        domain,
        registry: fixture.registry,
        threshold: thresholdPolicies.ROUTINE_RELEASE,
        now: at,
      }),
    ).resolves.toMatchObject({ label: "NONCANONICAL_FORK" });

    const signatures = await Promise.all(
      fixture.identities.map(async (identity) =>
        signCanonicalEvent(identity, domain, canonicalEvent),
      ),
    );
    await expect(
      new PublicVerifier().verifyAndApply({
        event: canonicalEvent,
        signatures,
        domain,
        registry: fixture.registry,
        threshold: thresholdPolicies.ROUTINE_RELEASE,
        recusedAddresses: new Set([fixture.identities[0]!.address]),
        now: at,
      }),
    ).resolves.toMatchObject({ label: "NONCANONICAL_FORK" });

    const expiredRecord = {
      ...fixture.records[0]!,
      validUntil: "2026-08-10T00:00:00.000Z",
    };
    const expiredRegistry = new InstitutionalKeyRegistry([
      expiredRecord,
      ...fixture.records.slice(1),
    ]);
    await expect(
      new PublicVerifier().verifyAndApply({
        event: canonicalEvent,
        signatures,
        domain,
        registry: expiredRegistry,
        threshold: thresholdPolicies.ROUTINE_RELEASE,
        now: at,
      }),
    ).resolves.toMatchObject({ label: "NONCANONICAL_FORK" });
  });

  it("labels deployed artifacts canonical only when an effective release matches every digest", () => {
    const release = {
      sourceDigest: digestA,
      imageDigests: [digestB],
      schemaDigest: digestC,
      migrationDigest: digestA,
      effectiveAt: "2026-08-13T08:00:00.000Z",
      expiresAt: null,
    };
    expect(
      verifyDeploymentAgainstRelease({
        deployedSourceDigest: digestA,
        deployedImageDigests: [digestB],
        deployedSchemaDigest: digestC,
        deployedMigrationDigest: digestA,
        release,
        at,
      }).label,
    ).toBe("CANONICAL");
    expect(
      verifyDeploymentAgainstRelease({
        deployedSourceDigest: digestB,
        deployedImageDigests: [digestB],
        deployedSchemaDigest: digestC,
        deployedMigrationDigest: digestA,
        release,
        at,
      }).label,
    ).toBe("NONCANONICAL_FORK");
    expect(
      verifyDeploymentAgainstRelease({
        deployedSourceDigest: digestA,
        deployedImageDigests: [digestB],
        deployedSchemaDigest: digestC,
        deployedMigrationDigest: digestA,
        release: null,
        at,
      }).reasons,
    ).toContain("NO_RECOGNIZED_RELEASE");
    for (const invalidRelease of [
      { ...release, effectiveAt: "not-a-date" },
      {
        ...release,
        expiresAt: "2026-08-13T07:59:59.000Z",
      },
    ]) {
      expect(
        verifyDeploymentAgainstRelease({
          deployedSourceDigest: digestA,
          deployedImageDigests: [digestB],
          deployedSchemaDigest: digestC,
          deployedMigrationDigest: digestA,
          release: invalidRelease,
          at,
        }),
      ).toMatchObject({
        label: "NONCANONICAL_FORK",
        reasons: ["RELEASE_TIME_WINDOW_INVALID"],
      });
    }
    expect(
      verifyDeploymentAgainstRelease({
        deployedSourceDigest: digestA,
        deployedImageDigests: [digestB],
        deployedSchemaDigest: digestC,
        deployedMigrationDigest: digestA,
        release,
        at: "not-a-date",
      }),
    ).toMatchObject({
      label: "NONCANONICAL_FORK",
      reasons: ["RELEASE_TIME_WINDOW_INVALID"],
    });
  });
});
