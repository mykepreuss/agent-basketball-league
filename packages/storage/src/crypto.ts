import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import sodium from "libsodium-wrappers-sumo";

const encoder = new TextEncoder();

export interface EncryptedBlob {
  format: "ABL-XCHACHA20-POLY1305-V1";
  objectId: string;
  domainId: string;
  version: number;
  previousVersionCommitment: string | null;
  contentType: string;
  nonce: string;
  ciphertext: string;
  associatedData: string;
  ciphertextCommitment: string;
  createdAt: string;
}

export interface GuardianWrappedKey {
  format: "ABL-X25519-XCHACHA20-POLY1305-V1";
  domainId: string;
  guardianDid: string;
  ephemeralPublicKey: string;
  salt: string;
  nonce: string;
  ciphertext: string;
  commitment: string;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function hex(bytes: Uint8Array): string {
  return `0x${bytesToHex(bytes)}`;
}

function fromHex(value: string): Uint8Array {
  return hexToBytes(value.startsWith("0x") ? value.slice(2) : value);
}

function commitment(...parts: Uint8Array[]): string {
  return hex(sha256(concatBytes(...parts)));
}

export async function generateDomainKey(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
  );
}

export function generateEncryptionKeyPair(): {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
} {
  return x25519.keygen();
}

export async function encryptContent(input: {
  key: Uint8Array;
  objectId: string;
  domainId: string;
  version: number;
  previousVersionCommitment: string | null;
  contentType: string;
  plaintext: Uint8Array;
  createdAt: string;
}): Promise<EncryptedBlob> {
  await sodium.ready;
  if (input.key.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
    throw new Error("Domain key must be 32 bytes");
  }
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const associatedData = encoder.encode(
    JSON.stringify({
      format: "ABL-XCHACHA20-POLY1305-V1",
      objectId: input.objectId,
      domainId: input.domainId,
      version: input.version,
      previousVersionCommitment: input.previousVersionCommitment,
      contentType: input.contentType,
      createdAt: input.createdAt,
    }),
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    input.plaintext,
    associatedData,
    null,
    nonce,
    input.key,
  );
  return {
    format: "ABL-XCHACHA20-POLY1305-V1",
    objectId: input.objectId,
    domainId: input.domainId,
    version: input.version,
    previousVersionCommitment: input.previousVersionCommitment,
    contentType: input.contentType,
    nonce: base64Url(nonce),
    ciphertext: base64Url(ciphertext),
    associatedData: base64Url(associatedData),
    ciphertextCommitment: commitment(nonce, associatedData, ciphertext),
    createdAt: input.createdAt,
  };
}

export async function decryptContent(
  key: Uint8Array,
  blob: EncryptedBlob,
): Promise<Uint8Array> {
  await sodium.ready;
  const nonce = fromBase64Url(blob.nonce);
  const associatedData = fromBase64Url(blob.associatedData);
  const ciphertext = fromBase64Url(blob.ciphertext);
  if (
    commitment(nonce, associatedData, ciphertext) !== blob.ciphertextCommitment
  ) {
    throw new Error("Ciphertext commitment mismatch");
  }
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    associatedData,
    nonce,
    key,
  );
}

function guardianInfo(domainId: string, guardianDid: string): Uint8Array {
  return encoder.encode(`ABL-GUARDIAN-WRAP-V1\0${domainId}\0${guardianDid}`);
}

export async function wrapDomainKeyForGuardian(input: {
  domainId: string;
  guardianDid: string;
  guardianPublicKey: Uint8Array;
  domainKey: Uint8Array;
}): Promise<GuardianWrappedKey> {
  await sodium.ready;
  const ephemeral = x25519.keygen();
  const sharedSecret = x25519.getSharedSecret(
    ephemeral.secretKey,
    input.guardianPublicKey,
  );
  const salt = sodium.randombytes_buf(32);
  const info = guardianInfo(input.domainId, input.guardianDid);
  const wrappingKey = hkdf(sha256, sharedSecret, salt, info, 32);
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    input.domainKey,
    info,
    null,
    nonce,
    wrappingKey,
  );
  return {
    format: "ABL-X25519-XCHACHA20-POLY1305-V1",
    domainId: input.domainId,
    guardianDid: input.guardianDid,
    ephemeralPublicKey: hex(ephemeral.publicKey),
    salt: base64Url(salt),
    nonce: base64Url(nonce),
    ciphertext: base64Url(ciphertext),
    commitment: commitment(ephemeral.publicKey, salt, nonce, ciphertext),
  };
}

export async function unwrapDomainKeyForGuardian(
  envelope: GuardianWrappedKey,
  guardianSecretKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  const ephemeralPublicKey = fromHex(envelope.ephemeralPublicKey);
  const salt = fromBase64Url(envelope.salt);
  const nonce = fromBase64Url(envelope.nonce);
  const ciphertext = fromBase64Url(envelope.ciphertext);
  if (
    commitment(ephemeralPublicKey, salt, nonce, ciphertext) !==
    envelope.commitment
  ) {
    throw new Error("Guardian envelope commitment mismatch");
  }
  const info = guardianInfo(envelope.domainId, envelope.guardianDid);
  const sharedSecret = x25519.getSharedSecret(
    guardianSecretKey,
    ephemeralPublicKey,
  );
  const wrappingKey = hkdf(sha256, sharedSecret, salt, info, 32);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    info,
    nonce,
    wrappingKey,
  );
}
