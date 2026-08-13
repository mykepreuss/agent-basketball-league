import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CiphertextBroker,
  DriveCiphertextRepository,
  StorageAuthorizationError,
  StorageVersionConflictError,
  decryptContent,
  encryptContent,
  generateDomainKey,
  generateEncryptionKeyPair,
  unwrapDomainKeyForGuardian,
  wrapDomainKeyForGuardian,
  type StorageDomainPolicy,
} from "../src/index.js";

const createdAt = "2026-08-12T23:50:00-07:00";

function policy(
  overrides: Partial<StorageDomainPolicy> = {},
): StorageDomainPolicy {
  return {
    domainId: "personal:agent-a",
    kind: "PERSONAL",
    version: 1,
    members: { "did:abl:agent-a": ["READ", "WRITE", "ADMIN"] },
    guardianEnvelopeCommitments: [],
    manifestCommitment: `0x${"a".repeat(64)}`,
    ...overrides,
  };
}

describe("fixed-client encryption and ciphertext-only broker", () => {
  it("round-trips XChaCha20-Poly1305 content and rejects a wrong key", async () => {
    const key = await generateDomainKey();
    const plaintext = new TextEncoder().encode(
      "agent-a private durable lesson",
    );
    const blob = await encryptContent({
      key,
      objectId: "lesson-1",
      domainId: "personal:agent-a",
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext,
      createdAt,
    });
    expect(blob.format).toBe("ABL-XCHACHA20-POLY1305-V1");
    expect(Buffer.from(blob.nonce, "base64url")).toHaveLength(24);
    await expect(decryptContent(key, blob)).resolves.toEqual(plaintext);
    await expect(
      decryptContent(await generateDomainKey(), blob),
    ).rejects.toThrow();
  });

  it("stores only ciphertext and denies cross-agent/public/core access", async () => {
    const broker = new CiphertextBroker();
    broker.registerDomain("did:abl:agent-a", policy());
    const key = await generateDomainKey();
    const privateText = "journal: I refuse the proposed model substitution";
    const blob = await encryptContent({
      key,
      objectId: "journal-1",
      domainId: "personal:agent-a",
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext: new TextEncoder().encode(privateText),
      createdAt,
    });
    broker.put("did:abl:agent-a", blob);
    expect(() =>
      broker.get("did:abl:agent-b", blob.domainId, blob.objectId),
    ).toThrow(StorageAuthorizationError);
    expect(() =>
      broker.get("did:abl:public-service", blob.domainId, blob.objectId),
    ).toThrow(StorageAuthorizationError);
    expect(() =>
      broker.get("did:abl:core-service", blob.domainId, blob.objectId),
    ).toThrow(StorageAuthorizationError);
    expect(JSON.stringify(broker.metadataSnapshot())).not.toContain(
      privateText,
    );
    expect(JSON.stringify(broker.metadataSnapshot())).not.toContain(
      Buffer.from(key).toString("base64url"),
    );
  });

  it("enforces contiguous immutable ciphertext version chains", async () => {
    const broker = new CiphertextBroker();
    broker.registerDomain("did:abl:agent-a", policy());
    const key = await generateDomainKey();
    const first = await encryptContent({
      key,
      objectId: "memory-1",
      domainId: "personal:agent-a",
      version: 1,
      previousVersionCommitment: null,
      contentType: "application/json",
      plaintext: new TextEncoder().encode("{}"),
      createdAt,
    });
    broker.put("did:abl:agent-a", first);
    const invalid = await encryptContent({
      key,
      objectId: "memory-1",
      domainId: "personal:agent-a",
      version: 3,
      previousVersionCommitment: first.ciphertextCommitment,
      contentType: "application/json",
      plaintext: new TextEncoder().encode('{"bad":"gap"}'),
      createdAt,
    });
    expect(() => broker.put("did:abl:agent-a", invalid)).toThrow(
      StorageVersionConflictError,
    );
  });

  it("wraps a domain key to a distinct X25519 guardian key", async () => {
    const guardian = generateEncryptionKeyPair();
    const domainKey = await generateDomainKey();
    const envelope = await wrapDomainKeyForGuardian({
      domainId: "personal:agent-a",
      guardianDid: "did:abl:guardian-a",
      guardianPublicKey: guardian.publicKey,
      domainKey,
    });
    expect(envelope.ephemeralPublicKey).not.toBe(
      `0x${Buffer.from(guardian.publicKey).toString("hex")}`,
    );
    await expect(
      unwrapDomainKeyForGuardian(envelope, guardian.secretKey),
    ).resolves.toEqual(domainKey);
  });
});

describe("ciphertext-only Agent Drive layout", () => {
  it("uses hashed paths, immutable versions, and persists no plaintext or domain key", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-drive-emulator-"));
    const repository = new DriveCiphertextRepository(root);
    await repository.initialize();
    const domainPolicy = policy();
    await repository.putPolicy(domainPolicy);
    const key = await generateDomainKey();
    const plaintext = "private case strategy";
    const blob = await encryptContent({
      key,
      objectId: "../../attempted-path-escape",
      domainId: "personal:agent-a",
      version: 1,
      previousVersionCommitment: null,
      contentType: "text/plain",
      plaintext: new TextEncoder().encode(plaintext),
      createdAt,
    });
    await repository.putCiphertext(blob);
    await expect(repository.putCiphertext(blob)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await expect(
      repository.getCiphertext(blob.domainId, blob.objectId, 1),
    ).resolves.toEqual(blob);

    const domainDirectories = await readdir(join(root, "domains"));
    expect(domainDirectories).toHaveLength(1);
    expect(domainDirectories[0]).toMatch(/^[0-9a-f]{64}$/);
    const stored = await readFile(
      join(
        root,
        "domains",
        domainDirectories[0]!,
        "objects",
        createObjectSegment(blob.objectId),
        "1.json",
      ),
      "utf8",
    );
    expect(stored).not.toContain(plaintext);
    expect(stored).not.toContain(Buffer.from(key).toString("base64url"));
    expect(stored).toContain(blob.ciphertextCommitment);
  });
});

function createObjectSegment(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
