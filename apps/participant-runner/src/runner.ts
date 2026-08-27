import {
  createRunnerEncryptionKeyPair,
  openContextCapsule,
  recoverRunnerDelegationSigner,
  runnerDelegationMessage,
  sealRunnerResult,
  signRunnerRequest,
} from "@abl/cognition";
import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import {
  ContextManifestV2Schema,
  InferenceRequestSchema,
  InferenceResultSchema,
  RunnerDelegationSchema,
  RunnerPairingOfferSchema,
  type InferenceRequest,
  type RunnerHeartbeat,
  type RunnerPairingOffer,
} from "@abl/schemas";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { v7 as uuidv7 } from "uuid";
import { recoverMessageAddress, type Hex } from "viem";
import { z } from "zod";

import type { InferenceAdapter } from "./adapters.js";
import { RelayClient } from "./client.js";
import { loadRunnerStore, saveRunnerStore, type RunnerStore } from "./store.js";

export const RUNNER_BUILD_DIGEST = sha256Commitment({
  package: "@abl/participant-runner",
  protocol: 2,
  adapters: ["COMMAND", "OPENAI_COMPATIBLE", "DETERMINISTIC_TEST"],
});

const CareerContextEnvelopeSchema = z.strictObject({
  manifest: ContextManifestV2Schema,
  officialContext: z.unknown(),
  materials: z.array(z.unknown()).max(256),
});

async function recoverDelegatingCareer(
  delegation: z.infer<typeof RunnerDelegationSchema>,
): Promise<`0x${string}`> {
  const {
    careerSignature: _signature,
    revokedAt: _revokedAt,
    ...unsigned
  } = delegation;
  return recoverRunnerDelegationSigner(
    runnerDelegationMessage(
      unsigned,
      sha256Commitment([...delegation.scopes].sort()),
    ),
    delegation.careerSignature as Hex,
  );
}

export async function openVerifiedCareerContext(input: {
  request: InferenceRequest;
  store: RunnerStore;
}): Promise<z.infer<typeof CareerContextEnvelopeSchema>> {
  const request = InferenceRequestSchema.parse(input.request);
  const delegation = RunnerDelegationSchema.parse(input.store.delegation);
  const delegatingCareer = await recoverDelegatingCareer(delegation);
  if (
    delegatingCareer.toLowerCase() !==
      input.store.careerSignerAddress.toLowerCase() ||
    delegation.careerDid !== request.activation.careerDid ||
    delegation.runnerId !== input.store.runnerId ||
    delegation.delegateSigningAddress.toLowerCase() !==
      input.store.signingAddress.toLowerCase() ||
    delegation.delegateEncryptionPublicKey !==
      input.store.encryptionPublicKey ||
    delegation.revokedAt !== null ||
    Date.parse(delegation.expiresAt) <= Date.now()
  )
    throw new Error("Runner delegation is not authentic for this career");
  const { requestCommitment: _requestCommitment, ...unsignedRequest } = request;
  if (request.requestCommitment !== sha256Commitment(unsignedRequest))
    throw new Error("Inference request commitment mismatch");
  if (
    request.cognitionMode !== "PARTICIPANT_CONTROLLED" ||
    request.capsule.activationId !== request.activation.activationId ||
    request.capsule.careerDid !== request.activation.careerDid ||
    request.capsule.runnerId !== input.store.runnerId ||
    request.capsule.recipientKeyId !== delegation.delegationId ||
    request.capsule.expiresAt !== request.activation.deadlineAt ||
    request.createdAt < request.activation.openedAt ||
    request.createdAt > request.activation.deadlineAt
  )
    throw new Error("Inference request is bound to another career activation");
  const context = CareerContextEnvelopeSchema.parse(
    await openContextCapsule(
      request.capsule,
      hexToBytes(input.store.encryptionSecretKey.slice(2)),
    ),
  );
  const manifest = context.manifest;
  const {
    manifestCommitment: _manifestCommitment,
    careerSignature: _careerSignature,
    ...unsignedManifest
  } = manifest;
  const manifestSigner = await recoverMessageAddress({
    message: { raw: manifest.manifestCommitment as Hex },
    signature: manifest.careerSignature as Hex,
  });
  if (
    manifest.manifestCommitment !== sha256Commitment(unsignedManifest) ||
    request.contextManifestCommitment !== sha256Commitment(manifest) ||
    manifestSigner.toLowerCase() !== delegatingCareer.toLowerCase() ||
    manifest.activationId !== request.activation.activationId ||
    manifest.careerDid !== request.activation.careerDid ||
    manifest.role !== request.activation.role ||
    manifest.observationCommitment !==
      request.activation.observationCommitment ||
    manifest.stateRoot !== request.activation.stateRoot ||
    manifest.policyCommitment !== request.activation.contextPolicyCommitment
  )
    throw new Error("Official context manifest authentication failed");
  return context;
}

export async function pairRunner(input: {
  offer: RunnerPairingOffer;
  storePath: string;
  verifiedBundleDigest: `0x${string}`;
  fetchImplementation?: typeof fetch;
}): Promise<RunnerStore> {
  const offer = RunnerPairingOfferSchema.parse(input.offer);
  if (offer.runnerBundleDigest !== input.verifiedBundleDigest)
    throw new Error("Runner bundle digest differs from the league offer");
  const signing = createSigningIdentity();
  const encryption = createRunnerEncryptionKeyPair();
  const runnerId = `runner-${signing.address.toLowerCase().slice(2)}`;
  const response = await (input.fetchImplementation ?? fetch)(
    new URL("/v1/runners/pair", offer.relayOrigin),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        offerId: offer.offerId,
        pairingToken: offer.pairingToken,
        runnerId,
        delegateSigningAddress: signing.address,
        delegateEncryptionPublicKey: `0x${bytesToHex(encryption.publicKey)}`,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new Error(`Runner pairing failed: ${response.status}`);
  const delegation = RunnerDelegationSchema.parse(
    ((await response.json()) as { delegation: unknown }).delegation,
  );
  const delegatingCareer = await recoverDelegatingCareer(delegation);
  if (
    delegatingCareer.toLowerCase() !==
      offer.careerSignerAddress.toLowerCase() ||
    delegation.careerDid !== offer.careerDid ||
    delegation.runnerId !== runnerId ||
    delegation.delegateSigningAddress.toLowerCase() !==
      signing.address.toLowerCase() ||
    delegation.delegateEncryptionPublicKey !==
      `0x${bytesToHex(encryption.publicKey)}`
  )
    throw new Error("Runner delegation was not signed by the offered career");
  const store: RunnerStore = {
    version: 1,
    runnerId,
    relayOrigin: offer.relayOrigin,
    careerSignerAddress: offer.careerSignerAddress,
    runnerBuildDigest: input.verifiedBundleDigest,
    signingPrivateKey: signing.privateKey,
    signingAddress: signing.address,
    encryptionSecretKey: `0x${bytesToHex(encryption.secretKey)}`,
    encryptionPublicKey: `0x${bytesToHex(encryption.publicKey)}`,
    delegation,
    pairedAt: new Date().toISOString(),
  };
  await saveRunnerStore(input.storePath, store);
  return store;
}

export async function runnerDoctor(input: {
  storePath: string;
  adapter: InferenceAdapter;
  verifiedBundleDigest?: `0x${string}`;
}): Promise<{
  ready: boolean;
  bundleIntegrity: boolean;
  keySeparation: boolean;
  delegationValid: boolean;
  adapter: { ready: boolean; detail: string };
}> {
  const store = await loadRunnerStore(input.storePath);
  const delegation = RunnerDelegationSchema.parse(store.delegation);
  const adapter = await input.adapter.doctor();
  const bundleIntegrity =
    input.verifiedBundleDigest === undefined ||
    store.runnerBuildDigest === input.verifiedBundleDigest;
  const keySeparation =
    store.signingPrivateKey.slice(2) !== store.encryptionSecretKey.slice(2);
  const delegationValid =
    delegation.revokedAt === null &&
    Date.parse(delegation.expiresAt) > Date.now();
  return {
    ready: adapter.ready && bundleIntegrity && keySeparation && delegationValid,
    bundleIntegrity,
    keySeparation,
    delegationValid,
    adapter,
  };
}

async function processActivation(input: {
  request: InferenceRequest;
  store: RunnerStore;
  adapter: InferenceAdapter;
  client: RelayClient;
}): Promise<void> {
  const startedAt = new Date().toISOString();
  const context = await openVerifiedCareerContext({
    request: input.request,
    store: input.store,
  });
  const remainingMs =
    Date.parse(input.request.activation.deadlineAt) - Date.now();
  if (remainingMs <= 0) throw new Error("Activation expired before invocation");
  const adapterResult = await input.adapter.invoke(
    {
      role: input.request.activation.role,
      activation: input.request.activation,
      context,
    },
    AbortSignal.timeout(remainingMs),
  );
  const completedAt = new Date().toISOString();
  const sealed = await sealRunnerResult({
    requestId: input.request.requestId,
    activationId: input.request.activation.activationId,
    careerDid: input.request.activation.careerDid,
    runnerId: input.store.runnerId,
    recipientPublicKey: hexToBytes(
      input.request.resultRecipient.publicKey.slice(2),
    ),
    result: adapterResult.decision,
  });
  const resultCommitment = sha256Commitment({
    requestId: input.request.requestId,
    activationId: input.request.activation.activationId,
    ciphertextCommitment: sealed.ciphertextCommitment,
    completedAt,
  });
  const delegateSignature = await signRunnerRequest(
    input.store.signingPrivateKey as Hex,
    {
      runnerId: input.store.runnerId,
      careerDid: input.request.activation.careerDid,
      delegationId: RunnerDelegationSchema.parse(input.store.delegation)
        .delegationId,
      method: "RESULT_ATTESTATION",
      path: input.request.activation.activationId,
      bodyCommitment: resultCommitment,
      nonce: "0",
      idempotencyKey: input.request.requestId,
      timestamp: completedAt,
    },
  );
  const result = InferenceResultSchema.parse({
    schemaVersion: "1.0.0",
    resultId: uuidv7(),
    requestId: input.request.requestId,
    activationId: input.request.activation.activationId,
    careerDid: input.request.activation.careerDid,
    runnerId: input.store.runnerId,
    ciphertext: sealed.ciphertext,
    ciphertextBytes: sealed.ciphertextBytes,
    ciphertextCommitment: sealed.ciphertextCommitment,
    aadCommitment: sealed.aadCommitment,
    providerProductModel: adapterResult.providerProductModel,
    provenanceLevel: adapterResult.provenanceLevel,
    ambientProductContext: adapterResult.ambientProductContext,
    usage: adapterResult.usage,
    startedAt,
    completedAt,
    delegateSignature,
  });
  await input.client.submitResult(result.activationId, result);
}

export async function runParticipantRunner(input: {
  storePath: string;
  adapter: InferenceAdapter;
  verifiedBundleDigest?: `0x${string}`;
  stopSignal?: AbortSignal;
  once?: boolean;
}): Promise<void> {
  let store = await loadRunnerStore(input.storePath);
  if (
    input.verifiedBundleDigest !== undefined &&
    store.runnerBuildDigest !== input.verifiedBundleDigest
  )
    throw new Error("Runner bundle integrity check failed");
  let delegation = RunnerDelegationSchema.parse(store.delegation);
  let client = new RelayClient({
    origin: store.relayOrigin,
    privateKey: store.signingPrivateKey as Hex,
    delegation,
  });
  let heartbeatAt = 0;
  while (!(input.stopSignal?.aborted ?? false)) {
    if (Date.parse(delegation.expiresAt) - Date.now() <= 7 * 24 * 60 * 60_000) {
      delegation = await client.renew();
      store = { ...store, delegation };
      await saveRunnerStore(input.storePath, store);
      client = new RelayClient({
        origin: store.relayOrigin,
        privateKey: store.signingPrivateKey as Hex,
        delegation,
      });
    }
    if (Date.now() - heartbeatAt >= 60_000 || heartbeatAt === 0) {
      const observedAt = new Date().toISOString();
      const heartbeatBase = {
        schemaVersion: "1.0.0" as const,
        runnerId: store.runnerId,
        careerDid: delegation.careerDid,
        delegationId: delegation.delegationId,
        runnerBuildDigest: store.runnerBuildDigest,
        adapterBuildDigest: input.adapter.buildDigest,
        availability: "ONLINE" as const,
        observedAt,
        nonce: String(Date.now()),
        idempotencyKey: uuidv7(),
      };
      const heartbeat: RunnerHeartbeat = {
        ...heartbeatBase,
        signature: await signRunnerRequest(store.signingPrivateKey as Hex, {
          runnerId: store.runnerId,
          careerDid: delegation.careerDid,
          delegationId: delegation.delegationId,
          method: "HEARTBEAT_ATTESTATION",
          path: "/v1/runners/heartbeat",
          bodyCommitment: sha256Commitment(heartbeatBase),
          nonce: heartbeatBase.nonce,
          idempotencyKey: heartbeatBase.idempotencyKey,
          timestamp: observedAt,
        }),
      };
      await client.heartbeat(heartbeat);
      heartbeatAt = Date.now();
    }
    const request = await client.nextActivation();
    if (request !== null) {
      try {
        await processActivation({
          request,
          store,
          adapter: input.adapter,
          client,
        });
      } catch (error) {
        // The career owns the deterministic deadline fallback. One unavailable
        // model invocation must not terminate the persistent participant runner
        // or prevent later scheduled activations from being received.
        process.stderr.write(
          `${JSON.stringify({
            event: "activation_not_completed",
            activationId: request.activation.activationId,
            error:
              error instanceof Error ? error.name : "UnknownActivationFailure",
          })}\n`,
        );
      }
    }
    if (input.once) return;
  }
}
