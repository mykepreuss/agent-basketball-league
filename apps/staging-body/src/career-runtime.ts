import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  CandidateRoleClassSchema,
  CandidateRuntimeIdentityReceiptSchema,
  SchemaVersion,
} from "@abl/schemas";
import { CANDIDATE_WORKFLOW_AGGREGATE_TYPE } from "@abl/career";
import {
  CANDIDATE_RUNTIME_IDENTITY_DOMAIN,
  CandidateRuntimeIdentityTypes,
} from "@abl/launch";
import {
  createAgentKeyBundle,
  sha256Commitment,
  signCanonicalEvent,
  verifyEventContent,
  type CanonicalEvent,
} from "@abl/recognition";
import Fastify from "fastify";
import type { Hex, TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const identityPath = "/workspace/state/career-identity.json";
const privateKeySchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const DomainSchema = z
  .strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
    chainId: z.number().int().positive(),
    verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .transform((domain) => ({
    ...domain,
    verifyingContract: domain.verifyingContract as Hex,
  }));
const PersistentIdentitySchema = z.strictObject({
  signingPrivateKey: privateKeySchema,
  encryptionSecretKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  receipt: CandidateRuntimeIdentityReceiptSchema,
});
const TransferSigningRequestSchema = z.strictObject({
  event: z.strictObject({
    eventId: z.string().min(1).max(200),
    actorDid: z.string().startsWith("did:").max(500),
    nonce: z.string().min(1).max(200),
    idempotencyKey: z.string().min(16).max(200),
    aggregateType: z.literal(CANDIDATE_WORKFLOW_AGGREGATE_TYPE),
    aggregateId: z.string().startsWith("did:").max(500),
    aggregateVersion: z.literal("2"),
    eventType: z.literal("CandidateTransferred"),
    previousEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    payloadCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
    payload: z.unknown(),
    stateRoot: z.string().regex(/^0x[0-9a-f]{64}$/),
    schemaDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    timestamp: z.iso.datetime({ offset: true }),
    eventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  }),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

async function createIdentity(input: {
  applicationId: string;
  candidateDid: string;
  roleClass: z.infer<typeof CandidateRoleClassSchema>;
  runtimeImageReference: string;
}) {
  const bundle = createAgentKeyBundle();
  const createdAt = new Date().toISOString();
  const signingKeyAttestation = sha256Commitment({
    ceremony: "ABL-ISOLATED-CAREER-SIGNING-KEY-V1",
    applicationId: input.applicationId,
    publicKey: bundle.signing.publicKey,
    createdAt,
  });
  const encryptionPublicKey = `0x${Buffer.from(bundle.encryption.publicKey).toString("hex")}`;
  const encryptionKeyAttestation = sha256Commitment({
    ceremony: "ABL-ISOLATED-CAREER-ENCRYPTION-KEY-V1",
    applicationId: input.applicationId,
    publicKey: encryptionPublicKey,
    createdAt,
  });
  const runtimeAttestationDigest = sha256Commitment({
    provider: "BLAXEL",
    resourceType: "SANDBOX",
    applicationId: input.applicationId,
    candidateDid: input.candidateDid,
    runtimeImageReference: input.runtimeImageReference,
    humanInputRoutes: [],
  });
  const message = {
    applicationId: input.applicationId,
    candidateDid: input.candidateDid,
    roleClass: input.roleClass,
    signingAddress: bundle.signing.address,
    signingKeyAttestation,
    encryptionKeyAttestation,
    runtimeAttestationDigest,
    createdAt,
  };
  const proofSignature = await privateKeyToAccount(
    bundle.signing.privateKey,
  ).signTypedData({
    domain: CANDIDATE_RUNTIME_IDENTITY_DOMAIN,
    types: CandidateRuntimeIdentityTypes,
    primaryType: "CandidateRuntimeIdentity",
    message,
  });
  const receipt = CandidateRuntimeIdentityReceiptSchema.parse({
    schemaVersion: SchemaVersion,
    ...message,
    signingPublicKey: bundle.signing.publicKey,
    encryptionPublicKey,
    generatedInIsolatedRuntime: true,
    humanInputRoutes: [],
    proofSignature,
  });
  return PersistentIdentitySchema.parse({
    signingPrivateKey: bundle.signing.privateKey,
    encryptionSecretKey: Buffer.from(bundle.encryption.secretKey).toString(
      "base64url",
    ),
    receipt,
  });
}

async function loadOrCreateIdentity(input: {
  applicationId: string;
  candidateDid: string;
  roleClass: z.infer<typeof CandidateRoleClassSchema>;
  runtimeImageReference: string;
}) {
  try {
    const stored = PersistentIdentitySchema.parse(
      JSON.parse(await readFile(identityPath, "utf8")),
    );
    if (
      stored.receipt.applicationId !== input.applicationId ||
      stored.receipt.candidateDid !== input.candidateDid ||
      stored.receipt.roleClass !== input.roleClass
    )
      throw new Error("Career identity is bound to another application");
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const identity = await createIdentity(input);
  await mkdir(dirname(identityPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${identityPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(identity)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, identityPath);
  return identity;
}

export async function runCareerRuntime(): Promise<void> {
  if (required("ABL_RUNTIME_RESOURCE_TYPE") !== "SANDBOX")
    throw new Error("ABL career bodies require a Blaxel Sandbox runtime");
  const applicationId = z.uuid().parse(required("ABL_APPLICATION_ID"));
  const candidateDid = z
    .string()
    .startsWith("did:")
    .parse(required("ABL_AGENT_DID"));
  const roleClass = CandidateRoleClassSchema.parse(required("ABL_ROLE_CLASS"));
  const identity = await loadOrCreateIdentity({
    applicationId,
    candidateDid,
    roleClass,
    runtimeImageReference: required("ABL_RUNTIME_IMAGE_REFERENCE"),
  });
  const commandDomain = DomainSchema.parse(
    JSON.parse(required("ABL_CANDIDATE_COMMAND_DOMAIN_JSON")),
  ) satisfies TypedDataDomain;
  const app = Fastify({ logger: false, bodyLimit: 256_000 });
  app.get("/health", async () => ({
    status: "ok",
    runtime: "ABL_FOUNDING_CAREER",
    keyReady: true,
    candidateDid,
    applicationId,
    identityCommitment: sha256Commitment(identity.receipt),
  }));
  app.get("/v1/career/identity", async () => identity.receipt);
  app.post("/v1/career/sign-transfer", async (request, reply) => {
    const parsed = TransferSigningRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_transfer_request" });
    const wire = parsed.data.event;
    const payload = z
      .strictObject({
        signingPublicKey: z.literal(identity.receipt.signingPublicKey),
        signingAddress: z.literal(identity.receipt.signingAddress),
        encryptionPublicKey: z.literal(identity.receipt.encryptionPublicKey),
        signingKeyAttestation: z.literal(
          identity.receipt.signingKeyAttestation,
        ),
        encryptionKeyAttestation: z.literal(
          identity.receipt.encryptionKeyAttestation,
        ),
        runtimeAttestationDigest: z.literal(
          identity.receipt.runtimeAttestationDigest,
        ),
        generatedInIsolatedRuntime: z.literal(true),
        humanInputRoutes: z.tuple([]),
        invokedContextHashes: z.array(z.string().regex(/^0x[0-9a-f]{64}$/)),
        transferredAt: z.literal(wire.timestamp),
      })
      .safeParse(wire.payload);
    if (
      !payload.success ||
      wire.actorDid !== candidateDid ||
      wire.aggregateId !== candidateDid
    )
      return reply.code(403).send({ error: "transfer_authority_denied" });
    const event = { ...wire, aggregateVersion: 2n } as CanonicalEvent;
    try {
      verifyEventContent(event);
      return {
        eventHash: event.eventHash,
        signerAddress: identity.receipt.signingAddress,
        signature: await signCanonicalEvent(
          {
            privateKey: identity.signingPrivateKey as Hex,
            publicKey: identity.receipt.signingPublicKey as Hex,
            address: identity.receipt.signingAddress as `0x${string}`,
          },
          commandDomain,
          event,
        ),
      };
    } catch {
      return reply.code(403).send({ error: "transfer_authority_denied" });
    }
  });
  await app.listen({
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
  });
}
