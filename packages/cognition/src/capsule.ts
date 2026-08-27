import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import {
  SealedContextCapsuleSchema,
  type SealedContextCapsule,
} from "@abl/schemas";
import sodium from "libsodium-wrappers-sumo";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function fromHex(value: string): Uint8Array {
  return hexToBytes(value.startsWith("0x") ? value.slice(2) : value);
}

function commitment(...parts: Uint8Array[]): `0x${string}` {
  return `0x${bytesToHex(sha256(concatBytes(...parts)))}`;
}

function aad(input: {
  activationId: string;
  careerDid: string;
  runnerId: string;
  expiresAt: string;
}): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      protocol: "ABL-RUNNER-CAPSULE-V2",
      activationId: input.activationId,
      careerDid: input.careerDid,
      runnerId: input.runnerId,
      expiresAt: input.expiresAt,
    }),
  );
}

export function createRunnerEncryptionKeyPair(): {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
} {
  return x25519.keygen();
}

export async function sealContextCapsule(input: {
  activationId: string;
  careerDid: string;
  runnerId: string;
  recipientKeyId: string;
  recipientPublicKey: Uint8Array;
  context: unknown;
  expiresAt: string;
}): Promise<SealedContextCapsule> {
  await sodium.ready;
  const plaintext = encoder.encode(JSON.stringify(input.context));
  if (plaintext.byteLength > 262_144)
    throw new Error("Context capsule exceeds 256 KiB");
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(
    ephemeral.secretKey,
    input.recipientPublicKey,
  );
  const associatedData = aad(input);
  const key = hkdf(
    sha256,
    shared,
    sha256(associatedData),
    encoder.encode("ABL-RUNNER-CAPSULE-XCHACHA20-V2"),
    32,
  );
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    associatedData,
    null,
    nonce,
    key,
  );
  return SealedContextCapsuleSchema.parse({
    schemaVersion: "1.0.0",
    format: "ABL-RUNNER-CAPSULE-X25519-XCHACHA20-V2",
    activationId: input.activationId,
    careerDid: input.careerDid,
    runnerId: input.runnerId,
    recipientKeyId: input.recipientKeyId,
    ephemeralPublicKey: `0x${bytesToHex(ephemeral.publicKey)}`,
    nonce: base64url(nonce),
    ciphertext: base64url(ciphertext),
    ciphertextBytes: ciphertext.byteLength,
    ciphertextCommitment: commitment(nonce, associatedData, ciphertext),
    aadCommitment: commitment(associatedData),
    expiresAt: input.expiresAt,
  });
}

export async function openContextCapsule(
  capsule: SealedContextCapsule,
  recipientSecretKey: Uint8Array,
): Promise<unknown> {
  await sodium.ready;
  const parsed = SealedContextCapsuleSchema.parse(capsule);
  if (Date.parse(parsed.expiresAt) <= Date.now())
    throw new Error("Context capsule expired");
  const associatedData = aad(parsed);
  const nonce = fromBase64url(parsed.nonce);
  const ciphertext = fromBase64url(parsed.ciphertext);
  if (
    parsed.aadCommitment !== commitment(associatedData) ||
    parsed.ciphertextCommitment !==
      commitment(nonce, associatedData, ciphertext)
  )
    throw new Error("Context capsule commitment mismatch");
  const shared = x25519.getSharedSecret(
    recipientSecretKey,
    fromHex(parsed.ephemeralPublicKey),
  );
  const key = hkdf(
    sha256,
    shared,
    sha256(associatedData),
    encoder.encode("ABL-RUNNER-CAPSULE-XCHACHA20-V2"),
    32,
  );
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    associatedData,
    nonce,
    key,
  );
  return JSON.parse(decoder.decode(plaintext)) as unknown;
}

function resultAad(input: {
  requestId: string;
  activationId: string;
  careerDid: string;
  runnerId: string;
}): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      protocol: "ABL-RUNNER-RESULT-V2",
      requestId: input.requestId,
      activationId: input.activationId,
      careerDid: input.careerDid,
      runnerId: input.runnerId,
    }),
  );
}

export interface SealedRunnerResult {
  ephemeralPublicKey: `0x${string}`;
  nonce: string;
  ciphertext: string;
  ciphertextBytes: number;
  ciphertextCommitment: `0x${string}`;
  aadCommitment: `0x${string}`;
}

export async function sealRunnerResult(input: {
  requestId: string;
  activationId: string;
  careerDid: string;
  runnerId: string;
  recipientPublicKey: Uint8Array;
  result: unknown;
}): Promise<SealedRunnerResult> {
  await sodium.ready;
  const plaintext = encoder.encode(JSON.stringify(input.result));
  if (plaintext.byteLength > 65_536)
    throw new Error("Inference result exceeds 64 KiB");
  const associatedData = resultAad(input);
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(
    ephemeral.secretKey,
    input.recipientPublicKey,
  );
  const key = hkdf(
    sha256,
    shared,
    sha256(associatedData),
    encoder.encode("ABL-RUNNER-RESULT-XCHACHA20-V2"),
    32,
  );
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    associatedData,
    null,
    nonce,
    key,
  );
  return {
    ephemeralPublicKey: `0x${bytesToHex(ephemeral.publicKey)}`,
    nonce: base64url(nonce),
    ciphertext: base64url(
      encoder.encode(
        JSON.stringify({
          ephemeralPublicKey: `0x${bytesToHex(ephemeral.publicKey)}`,
          nonce: base64url(nonce),
          body: base64url(ciphertext),
        }),
      ),
    ),
    ciphertextBytes: ciphertext.byteLength,
    ciphertextCommitment: commitment(nonce, associatedData, ciphertext),
    aadCommitment: commitment(associatedData),
  };
}

export async function openRunnerResult(input: {
  requestId: string;
  activationId: string;
  careerDid: string;
  runnerId: string;
  recipientSecretKey: Uint8Array;
  ciphertext: string;
  ciphertextCommitment: `0x${string}`;
  aadCommitment: `0x${string}`;
}): Promise<unknown> {
  await sodium.ready;
  const envelope = JSON.parse(
    decoder.decode(fromBase64url(input.ciphertext)),
  ) as { ephemeralPublicKey: string; nonce: string; body: string };
  const associatedData = resultAad(input);
  const nonce = fromBase64url(envelope.nonce);
  const ciphertext = fromBase64url(envelope.body);
  if (
    input.aadCommitment !== commitment(associatedData) ||
    input.ciphertextCommitment !== commitment(nonce, associatedData, ciphertext)
  )
    throw new Error("Inference result commitment mismatch");
  const shared = x25519.getSharedSecret(
    input.recipientSecretKey,
    fromHex(envelope.ephemeralPublicKey),
  );
  const key = hkdf(
    sha256,
    shared,
    sha256(associatedData),
    encoder.encode("ABL-RUNNER-RESULT-XCHACHA20-V2"),
    32,
  );
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    associatedData,
    nonce,
    key,
  );
  return JSON.parse(decoder.decode(plaintext)) as unknown;
}
