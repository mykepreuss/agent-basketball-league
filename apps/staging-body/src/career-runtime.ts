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

import {
  BrokerCareerModelClient,
  CareerActivationResultSchema,
  executeCareerPlayerActivation,
  requestCareerCapabilityRenewal,
  verifyCareerPlayerActivationCommand,
} from "./cognition-runtime.js";

export const CAREER_IDENTITY_PATH =
  "/tmp/abl-career-state/career-identity.json";
export const CAREER_ACTIVATION_ROOT = "/tmp/abl-career-state/activations";
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
const PersistedCareerActivationSchema = z.strictObject({
  commandEventHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  result: CareerActivationResultSchema,
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
      JSON.parse(await readFile(CAREER_IDENTITY_PATH, "utf8")),
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
  await mkdir(dirname(CAREER_IDENTITY_PATH), {
    recursive: true,
    mode: 0o700,
  });
  const temporaryPath = `${CAREER_IDENTITY_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(identity)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, CAREER_IDENTITY_PATH);
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
  const cognitionEnabled =
    z
      .enum(["DISABLED", "ENABLED"])
      .parse(process.env.ABL_COGNITION_MODE ?? "DISABLED") === "ENABLED";
  if (cognitionEnabled && roleClass !== "PLAYER")
    throw new Error(
      "The founding cognition runtime currently supports players",
    );
  const cognitionIdentity = {
    privateKey: identity.signingPrivateKey as Hex,
    publicKey: identity.receipt.signingPublicKey as Hex,
    address: identity.receipt.signingAddress as `0x${string}`,
    candidateDid,
    applicationId,
    roleClass: "PLAYER" as const,
  };
  const brokerOrigin = cognitionEnabled
    ? required("ABL_FIXED_BROKER_ORIGIN")
    : null;
  const brokerPreviewToken = cognitionEnabled
    ? process.env.ABL_FIXED_BROKER_PREVIEW_TOKEN
    : undefined;
  const brokerCapabilityOperations = cognitionEnabled
    ? z
        .array(z.string())
        .parse(
          JSON.parse(required("ABL_FIXED_BROKER_CAPABILITY_OPERATIONS_JSON")),
        )
    : [];
  const modelClient = cognitionEnabled
    ? new BrokerCareerModelClient({
        origin: brokerOrigin!,
        capabilityToken: required("ABL_FIXED_BROKER_CAPABILITY_TOKEN"),
        ...(brokerPreviewToken === undefined
          ? {}
          : {
              previewToken: brokerPreviewToken,
            }),
        modelPath: required("ABL_MODEL_ROUTE_PATH"),
        renewCapability: () =>
          requestCareerCapabilityRenewal({
            origin: brokerOrigin!,
            ...(brokerPreviewToken === undefined
              ? {}
              : { previewToken: brokerPreviewToken }),
            identity: cognitionIdentity,
            domain: commandDomain,
            operations: brokerCapabilityOperations,
          }),
      })
    : null;
  const coordinator = cognitionEnabled
    ? {
        did: z
          .string()
          .startsWith("did:")
          .parse(required("ABL_COMPETITION_COORDINATOR_DID")),
        signerAddress: z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/)
          .parse(
            required("ABL_COMPETITION_COORDINATOR_SIGNER_ADDRESS"),
          ) as `0x${string}`,
      }
    : null;
  const pendingActivations = new Map<
    string,
    { commandEventHash: string; result: Promise<unknown> }
  >();

  function activationPath(activationId: string): string {
    return `${CAREER_ACTIVATION_ROOT}/${sha256Commitment(activationId).slice(2)}.json`;
  }

  async function readActivation(
    activationId: string,
    commandEventHash: string,
  ) {
    try {
      const stored = PersistedCareerActivationSchema.parse(
        JSON.parse(await readFile(activationPath(activationId), "utf8")),
      );
      if (stored.commandEventHash !== commandEventHash)
        throw new Error("Activation ID is bound to another signed command");
      return stored.result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async function persistActivation(
    activationId: string,
    commandEventHash: string,
    result: unknown,
  ) {
    await mkdir(CAREER_ACTIVATION_ROOT, { recursive: true, mode: 0o700 });
    const path = activationPath(activationId);
    const temporaryPath = `${path}.${process.pid}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ commandEventHash, result })}\n`,
      {
        mode: 0o600,
      },
    );
    await rename(temporaryPath, path);
  }
  const app = Fastify({ logger: false, bodyLimit: 256_000 });
  app.get("/health", async () => ({
    status: "ok",
    runtime: "ABL_FOUNDING_CAREER",
    keyReady: true,
    candidateDid,
    applicationId,
    identityCommitment: sha256Commitment(identity.receipt),
    cognitionReady: cognitionEnabled,
  }));
  app.get("/v1/career/identity", async () => identity.receipt);
  app.post("/v1/career/activations", async (request, reply) => {
    if (
      !cognitionEnabled ||
      modelClient === null ||
      coordinator === null ||
      roleClass !== "PLAYER"
    )
      return reply.code(503).send({
        error: "career_cognition_not_enabled",
        retryable: false,
      });
    let verified;
    try {
      verified = await verifyCareerPlayerActivationCommand({
        command: request.body,
        identity: cognitionIdentity,
        coordinatorDid: coordinator.did,
        coordinatorSignerAddress: coordinator.signerAddress,
        domain: commandDomain,
      });
    } catch {
      return reply.code(400).send({ error: "invalid_career_activation" });
    }
    const activationId = verified.activation.activationId;
    const commandEventHash = verified.event.eventHash;
    let existing;
    try {
      existing = await readActivation(activationId, commandEventHash);
    } catch {
      return reply.code(409).send({ error: "activation_id_conflict" });
    }
    if (existing !== null) return existing;
    let pending = pendingActivations.get(activationId);
    if (pending !== undefined && pending.commandEventHash !== commandEventHash)
      return reply.code(409).send({ error: "activation_id_conflict" });
    if (pending === undefined) {
      const result = executeCareerPlayerActivation({
        command: request.body,
        identity: cognitionIdentity,
        coordinatorDid: coordinator.did,
        coordinatorSignerAddress: coordinator.signerAddress,
        domain: commandDomain,
        modelClient,
      }).then(async (result) => {
        await persistActivation(activationId, commandEventHash, result);
        return result;
      });
      pending = { commandEventHash, result };
      pendingActivations.set(activationId, pending);
    }
    try {
      return await pending.result;
    } catch {
      return reply.code(403).send({ error: "career_activation_rejected" });
    } finally {
      if (pendingActivations.get(activationId) === pending)
        pendingActivations.delete(activationId);
    }
  });
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
