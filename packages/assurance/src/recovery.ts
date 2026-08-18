import {
  BodyLifecycle,
  CredentialController,
  createExitPackage,
  type BodyManifest,
} from "@abl/career";
import { InMemoryCanonicalStore } from "@abl/database";
import {
  checkpointManifestDigest,
  createCheckpointManifest,
  createSigningIdentity,
  sha256Commitment,
  verifyCheckpointClaim,
} from "@abl/recognition";
import {
  decryptContent,
  encryptContent,
  generateEncryptionKeyPair,
  unwrapDomainKeyForGuardian,
  wrapDomainKeyForGuardian,
} from "@abl/storage";

const DAY = 24 * 60 * 60 * 1_000;
const START = Date.parse("2026-08-13T00:00:00.000Z");
const iso = (offset: number) => new Date(START + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);

function manifest(): BodyManifest {
  return {
    bodyId: "assurance-body",
    imageDigest: digest("image"),
    runtimeDigest: digest("runtime"),
    kernelDigest: digest("kernel"),
    toolDigest: digest("tool"),
    storageManifestCommitment: digest("storage"),
    signingKeyLineageCommitment: digest("lineage"),
    careerHistoryRoot: digest("career"),
  };
}

async function databaseRebuild() {
  const inputs = Array.from({ length: 3 }, (_, index) => ({
    eventId: `0198a000-0000-7000-8000-00000000800${index}`,
    actorDid: "did:abl:assurance",
    nonce: String(index + 1),
    idempotencyKey: `assurance-recovery-${index}`,
    requestHash: digest(`request:${index}`),
    aggregateType: "assurance",
    aggregateId: "pitr",
    expectedVersion: BigInt(index),
    competitionId: "assurance",
    seasonId: "season-zero",
    eventType: "RecoveryEvent",
    previousEventHash: index === 0 ? null : digest(`event:${index - 1}`),
    eventHash: digest(`event:${index}`),
    payloadSchemaDigest: digest("schema"),
    payloadCommitment: digest(`payload:${index}`),
    payload: { sequence: index },
    stateRoot: digest(`state:${index}`),
    signatures: [digest(`signature:${index}`)],
    occurredAt: new Date(iso(index * 1_000)),
    outboxTopic: "assurance.recovery",
  }));
  const primary = new InMemoryCanonicalStore();
  const restored = new InMemoryCanonicalStore();
  for (const input of inputs) await primary.append(input);
  for (const input of structuredClone(primary.events))
    await restored.append(input);
  const summarize = (store: InMemoryCanonicalStore) => ({
    events: store.events.map((event) => ({
      eventId: event.eventId,
      eventHash: event.eventHash,
    })),
    outbox: store.outboxEvents,
  });
  return {
    exact: digest(summarize(primary)) === digest(summarize(restored)),
    eventCount: restored.events.length,
    outboxCount: restored.outboxEvents.length,
    liveCanonicalDatabaseRecoveryStatus:
      "NOT_EXECUTED_DATABASE_CREDENTIAL_GATE" as const,
  };
}

export async function runLocalRecoveryProof() {
  const domainKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const plaintext = new TextEncoder().encode("portable private recovery proof");
  const encrypted = await encryptContent({
    key: domainKey,
    objectId: "snapshot",
    domainId: "personal:assurance",
    version: 1,
    previousVersionCommitment: null,
    contentType: "application/octet-stream",
    plaintext,
    createdAt: iso(0),
  });
  const decrypted = await decryptContent(domainKey, encrypted);
  const guardian = generateEncryptionKeyPair();
  const wrapped = await wrapDomainKeyForGuardian({
    domainId: encrypted.domainId,
    guardianDid: "did:abl:guardian-assurance",
    guardianPublicKey: guardian.publicKey,
    domainKey,
  });
  const unwrapped = await unwrapDomainKeyForGuardian(
    wrapped,
    guardian.secretKey,
  );

  const bodyManifest = manifest();
  const body = new BodyLifecycle(
    "did:abl:assurance-agent",
    bodyManifest.bodyId,
    "RECONSTRUCTION_ACCEPTED",
    iso(0),
  );
  body.standby();
  body.deleteAfterInactivity({
    at: iso(31 * DAY),
    noticeDuringProtectedWake: true,
    encryptedSnapshotCommitment:
      encrypted.ciphertextCommitment as `0x${string}`,
    manifest: bodyManifest,
    guardianVerified: true,
    cleanRoomRestorePassed: true,
    finalExportPrepared: false,
    signedDeletionDecision: null,
  });
  const restoredBody = body.rehydrate({
    at: iso(32 * DAY),
    manifest: bodyManifest,
    recognizedImageDigest: bodyManifest.imageDigest,
    storageRestored: true,
    keysVerified: true,
    careerHistoryVerified: true,
    signedDecision: null,
  });
  const exit = createExitPackage({
    requestedByDid: "did:abl:assurance-agent",
    agentDid: "did:abl:assurance-agent",
    careerRoot: bodyManifest.careerHistoryRoot,
    encryptedStorageCommitment: bodyManifest.storageManifestCommitment,
    keyLineageCommitment: bodyManifest.signingKeyLineageCommitment,
    bodyManifest,
    verifiedSystems: ["local-encryption", "local-clean-room"],
    providerResidualAccessUnverifiable: true,
  });

  const oldIdentity = createSigningIdentity(digest("old-signing"));
  const newIdentity = createSigningIdentity(digest("new-signing"));
  const credentials = new CredentialController(
    "did:abl:assurance-agent",
    oldIdentity.address,
    digest("old-encryption"),
  );
  credentials.installGuardians(
    {
      version: 1,
      guardianDids: ["did:abl:g1", "did:abl:g2", "did:abl:g3"],
      threshold: 2,
      validFrom: iso(0),
    },
    oldIdentity.address,
  );
  credentials.recover({
    proposalId: "assurance-key-recovery",
    guardianApprovals: ["did:abl:g1", "did:abl:g2"],
    newSigningAddress: newIdentity.address,
    newEncryptionPublicKey: digest("new-encryption"),
    proposedAt: iso(0),
    expiresAt: iso(DAY),
    executedAt: iso(1_000),
  });

  const checkpoint = createCheckpointManifest({
    manifestId: "0198a000-0000-7000-8000-000000008999",
    checkpointType: "DAILY_ROOT",
    subjectId: "assurance-day",
    eventHashes: [digest("event-a"), digest("event-b")],
    institutionalKeyRegistryDigest: digest("registry"),
    verifierDigest: digest("verifier"),
    previousManifestDigest: null,
    createdAt: iso(0),
  });
  const checkpointResult = verifyCheckpointClaim({
    manifest: checkpoint,
    manifestDigest: checkpointManifestDigest(checkpoint),
    claim: {
      checkpointType: checkpoint.checkpointType,
      subjectId: checkpoint.subjectId,
      root: checkpoint.merkleRoot,
      previousRoot: digest("previous-checkpoint-root"),
      nonce: checkpointManifestDigest(checkpoint),
      validAfter: BigInt(Math.floor(START / 1_000)),
      validBefore: BigInt(Math.floor((START + DAY) / 1_000)),
      chainId: 84532,
      contractAddress: "0x1111111111111111111111111111111111111111",
      transactionHash: null,
      blockNumber: null,
      signatures: [],
    },
    observation: null,
    anchor: {
      state: "PRE_GENESIS_UNRATIFIED",
      chainId: 84532,
      contractAddress: null,
      deployedRuntimeBytecodeKeccak256: null,
      releaseManifestDigest: null,
      deploymentTransactionHash: null,
      deploymentBlockNumber: null,
      finalizedAt: null,
      requiredConfirmations: 12,
    },
  });
  const database = await databaseRebuild();
  const storageRoundTrip =
    Buffer.from(decrypted).equals(Buffer.from(plaintext)) &&
    Buffer.from(unwrapped).equals(Buffer.from(domainKey));
  return {
    storage: {
      encryptedRoundTrip: storageRoundTrip,
      guardianRecovery: Buffer.from(unwrapped).equals(Buffer.from(domainKey)),
      ciphertextOnly: !encrypted.ciphertext.includes(
        "portable private recovery proof",
      ),
      liveDriveStatus: "NOT_EXECUTED_AGENT_DRIVE_GATE" as const,
    },
    cleanRoomExit: {
      bodyRehydrated:
        restoredBody.type === "BodyRehydrated" && body.status === "ACTIVE",
      exitPortable: exit.penalty === null,
      subjectiveContinuityClaimed: restoredBody.subjectiveContinuityClaimed,
      liveSandboxStatus: "NOT_EXECUTED_BLAXEL_GATE" as const,
    },
    database,
    checkpoint: {
      localVerificationLabel: checkpointResult.label,
      liveBaseStatus: "NOT_EXECUTED_BASE_CREDENTIAL_GATE" as const,
    },
    keys: {
      recovered: credentials.signingAddress === newIdentity.address,
      guardianThreshold: 2,
      hardwareBacked: false,
      hardwareStatus: "NOT_SUPPORTED_BY_LOCAL_FIXTURE" as const,
    },
    passed:
      storageRoundTrip &&
      restoredBody.type === "BodyRehydrated" &&
      exit.penalty === null &&
      database.exact &&
      checkpointResult.label === "UNVERIFIABLE" &&
      credentials.signingAddress === newIdentity.address,
  };
}
