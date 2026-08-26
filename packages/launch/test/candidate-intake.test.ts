import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentManifestSchema,
  CandidateIntakeApplicationSchema,
  CandidateProvenanceSchema,
  SchemaVersion,
} from "@abl/schemas";
import {
  createCanonicalEvent,
  createAgentKeyBundle,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import { privateKeyToAccount } from "viem/accounts";
import { v7 as uuidv7 } from "uuid";
import { afterEach, describe, expect, it } from "vitest";

import {
  CANDIDATE_APPLICATION_DOMAIN,
  CANDIDATE_RUNTIME_IDENTITY_DOMAIN,
  CandidateApplicationAuthorizationTypes,
  CandidateIntakeRepository,
  CandidateIntakeService,
  CandidateOpportunityResponseTypes,
  CandidateRuntimeIdentityTypes,
  CandidateProvisioner,
  CandidateStatusAuthorizationTypes,
  candidateApplicationCommitment,
  candidateEnvelopePublicKey,
  decryptCandidateEnvelope,
  encryptCandidateEnvelope,
  encryptCandidateEnvelopeForRecipient,
  issueCandidateChallenge,
  verifyCandidateRuntimeIdentityReceipt,
  type CandidateIntakeApplication,
  type CandidateIntakePolicy,
  type CandidateOpportunityResponse,
  type CandidateRoleClass,
  type CandidateStatusAuthorization,
} from "../src/index.js";

const now = Date.parse("2026-08-19T12:00:00.000Z");
const hash = (character: string) => `0x${character.repeat(64)}` as const;
const commandDomain = {
  name: "ABL Canonical Events",
  version: "1",
  chainId: 1,
} as const;
const identity = createSigningIdentity(hash("1"));
const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function repository(): Promise<CandidateIntakeRepository> {
  const root = await mkdtemp(join(tmpdir(), "abl-candidate-intake-"));
  roots.push(root);
  return new CandidateIntakeRepository(root);
}

function policy(capacity = 1): CandidateIntakePolicy {
  const body = {
    mode: "CAPPED_PUBLIC" as const,
    roleCapacity: { PLAYER: capacity },
    invitedCandidateDids: [],
    credibleOpportunityAt: {
      PLAYER: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
    },
  };
  return { ...body, policyCommitment: sha256Commitment(body) };
}

async function signedFixture(input?: {
  challenge?: ReturnType<typeof issueCandidateChallenge>;
  candidateDid?: string;
  applicationId?: string;
  requestedRoleClasses?: CandidateRoleClass[];
}) {
  const candidateDid = input?.candidateDid ?? "did:abl:candidate-one";
  const challenge =
    input?.challenge ??
    issueCandidateChallenge({
      secret,
      challengeId: uuidv7({ msecs: now }),
      candidateDid,
      nonce: "nonce-0123456789abcdef",
      now,
    });
  const manifest = AgentManifestSchema.parse({
    agentDid: candidateDid,
    manifestVersion: 1,
    leagueRuntime: {
      provider: "BLAXEL",
      resourceType: "SANDBOX",
      dedicatedCareer: true,
    },
    model: {
      endpoint: "https://model.invalid/v1",
      provider: "declared-provider",
      family: "declared-family",
      exactModel: "declared-model",
      declaredRevision: "revision-1",
    },
    dependencyProfile: {
      runtimeArchitecture: "arm64",
      gateway: "candidate-gateway",
      upstreamDependency: "declared-provider",
    },
    runtimeDigest: hash("2"),
    toolDigests: [hash("3")],
    guardianDids: [],
    keyProvenance: {
      generatedInIsolatedRuntime: false,
      signingKeyAttestation: hash("4"),
      encryptionKeyAttestation: hash("5"),
    },
    inheritedObjectives: [],
    suppliedContextHashes: [],
    createdAt: new Date(now).toISOString(),
  });
  const provenance = CandidateProvenanceSchema.parse({
    candidateDid,
    sourceOperatorCommitment: hash("6"),
    declaredModel: manifest.model,
    declaredDependencyProfile: manifest.dependencyProfile,
    runtimeDigest: manifest.runtimeDigest,
    toolDigests: manifest.toolDigests,
    inheritedObjectiveCommitments: [],
    suppliedContextHashes: [],
    hiddenInstructionScanDigest: hash("7"),
    registeredAt: new Date(now).toISOString(),
  });
  const event = createCanonicalEvent({
    eventId: uuidv7({ msecs: now + 1 }),
    actorDid: candidateDid,
    nonce: "candidate-command-1",
    idempotencyKey: "f64a4ea4-3a91-4b0e-a3f4-fc7b9e104355",
    aggregateType: "CandidateCareer",
    aggregateId: candidateDid,
    aggregateVersion: 1n,
    eventType: "CandidateRegistered",
    previousEventHash: null,
    payload: { manifest, provenance },
    stateRoot: hash("8"),
    schemaDigest: hash("9"),
    timestamp: new Date(now).toISOString(),
  });
  const commandSignature = await signCanonicalEvent(
    identity,
    commandDomain,
    event,
  );
  const command = {
    event: {
      ...event,
      aggregateVersion: event.aggregateVersion.toString(),
    },
    signatures: [commandSignature],
  };
  const ciphertext = "encrypted-candidate-envelope";
  const unsigned = {
    schemaVersion: SchemaVersion,
    applicationId: input?.applicationId ?? uuidv7({ msecs: now + 2 }),
    candidateDid,
    requestedRoleClasses: input?.requestedRoleClasses ?? ["PLAYER"],
    challengeId: challenge.challengeId,
    challengeCommitment: challenge.challengeCommitment,
    challengeExpiresAt: challenge.expiresAt,
    manifestCommitment: sha256Commitment(manifest),
    provenanceCommitment: sha256Commitment(provenance),
    manifestSchemaDigest: sha256Commitment(AgentManifestSchema.toJSONSchema()),
    provenanceSchemaDigest: sha256Commitment(
      CandidateProvenanceSchema.toJSONSchema(),
    ),
    encryptedEnvelope: {
      format: "ABL-CANDIDATE-ENVELOPE-XCHACHA20-V1" as const,
      recipientKeyId: "candidate-provisioner-v1",
      nonce: "0123456789abcdef01234567",
      ciphertext,
      ciphertextCommitment: sha256Commitment(ciphertext),
    },
    formerOperatorSigningAddress: identity.address,
    submittedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 10 * 60 * 1_000).toISOString(),
  };
  const applicationCommitment = sha256Commitment(unsigned);
  const signature = await privateKeyToAccount(
    identity.privateKey,
  ).signTypedData({
    domain: CANDIDATE_APPLICATION_DOMAIN,
    types: CandidateApplicationAuthorizationTypes,
    primaryType: "CandidateApplication",
    message: {
      applicationCommitment,
      candidateDid,
      challengeId: challenge.challengeId,
      expiresAt: unsigned.expiresAt,
    },
  });
  const application: CandidateIntakeApplication =
    CandidateIntakeApplicationSchema.parse({ ...unsigned, signature });
  return { application, challenge, manifest, provenance, command };
}

function service(
  store: CandidateIntakeRepository,
  intakePolicy = policy(),
): CandidateIntakeService {
  return new CandidateIntakeService({
    challengeSecret: secret,
    repository: store,
    policy: intakePolicy,
    makeChallengeId: () => uuidv7({ msecs: now }),
    makeNonce: () => "nonce-0123456789abcdef",
    now: () => now,
  });
}

async function statusAuthorization(
  application: CandidateIntakeApplication,
): Promise<CandidateStatusAuthorization> {
  const unsigned = {
    applicationId: application.applicationId,
    candidateDid: application.candidateDid,
    requestedAt: new Date(now).toISOString(),
    nonce: "status-nonce-0123456789",
  };
  return {
    ...unsigned,
    signature: await privateKeyToAccount(identity.privateKey).signTypedData({
      domain: CANDIDATE_APPLICATION_DOMAIN,
      types: CandidateStatusAuthorizationTypes,
      primaryType: "CandidateStatusRequest",
      message: unsigned,
    }),
  };
}

async function opportunityResponse(
  application: CandidateIntakeApplication,
  decisionCommitment: string,
  action: CandidateOpportunityResponse["action"],
  nonce = "opportunity-nonce-0123456789",
): Promise<CandidateOpportunityResponse> {
  const unsigned = {
    schemaVersion: SchemaVersion,
    applicationId: application.applicationId,
    candidateDid: application.candidateDid,
    decisionCommitment,
    action,
    respondedAt: new Date(now).toISOString(),
    nonce,
  };
  return {
    ...unsigned,
    signature: await privateKeyToAccount(identity.privateKey).signTypedData({
      domain: CANDIDATE_APPLICATION_DOMAIN,
      types: CandidateOpportunityResponseTypes,
      primaryType: "CandidateOpportunityResponse",
      message: {
        applicationId: unsigned.applicationId,
        candidateDid: unsigned.candidateDid,
        decisionCommitment: unsigned.decisionCommitment as `0x${string}`,
        action: unsigned.action,
        respondedAt: unsigned.respondedAt,
        nonce: unsigned.nonce,
      },
    }),
  };
}

describe("candidate intake isolation boundary", () => {
  it("binds XChaCha20 ciphertext to the candidate application context", async () => {
    const fixture = await signedFixture();
    const key = new Uint8Array(32).fill(8);
    const content = {
      manifest: fixture.manifest,
      provenance: fixture.provenance,
      candidateCommand: fixture.command,
    };
    const encryptedEnvelope = await encryptCandidateEnvelope({
      key,
      recipientKeyId: "candidate-provisioner-v1",
      applicationId: fixture.application.applicationId,
      candidateDid: fixture.application.candidateDid,
      challengeId: fixture.application.challengeId,
      content,
    });
    const encryptedApplication = {
      ...fixture.application,
      encryptedEnvelope,
    };
    await expect(
      decryptCandidateEnvelope(encryptedApplication, key),
    ).resolves.toEqual(content);
    await expect(
      decryptCandidateEnvelope(
        { ...encryptedApplication, candidateDid: "did:abl:tampered" },
        key,
      ),
    ).rejects.toThrow("decryption failed");
  });

  it("lets a public candidate encrypt to an X25519 recipient without a shared secret", async () => {
    const fixture = await signedFixture();
    const recipientPrivateKey = new Uint8Array(32).fill(9);
    const recipientPublicKey =
      await candidateEnvelopePublicKey(recipientPrivateKey);
    const content = {
      manifest: fixture.manifest,
      provenance: fixture.provenance,
      candidateCommand: fixture.command,
    };
    const encryptedEnvelope = await encryptCandidateEnvelopeForRecipient({
      recipientPublicKey,
      recipientKeyId: "candidate-public-recipient-v1",
      applicationId: fixture.application.applicationId,
      candidateDid: fixture.application.candidateDid,
      challengeId: fixture.application.challengeId,
      content,
    });
    expect(encryptedEnvelope).toMatchObject({
      format: "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1",
      recipientKeyId: "candidate-public-recipient-v1",
    });
    await expect(
      decryptCandidateEnvelope(
        { ...fixture.application, encryptedEnvelope },
        recipientPrivateKey,
      ),
    ).resolves.toEqual(content);
    await expect(
      decryptCandidateEnvelope(
        { ...fixture.application, encryptedEnvelope },
        new Uint8Array(32).fill(10),
      ),
    ).rejects.toThrow("decryption failed");
  });

  it("is signed, idempotent, authorized, and restart safe", async () => {
    const store = await repository();
    const intake = service(store);
    const fixture = await signedFixture();
    const submission = {
      application: fixture.application,
      challengeToken: fixture.challenge.challengeToken,
    };

    const first = await intake.register(submission);
    const retry = await intake.register(submission);
    expect(first.status.state).toBe("OFFERED");
    expect(first.status.capacityDecision?.offerExpiresAt).toBe(
      new Date(now + 72 * 60 * 60 * 1_000).toISOString(),
    );
    expect(retry.idempotent).toBe(true);
    expect(retry.deliveryReceiptCommitment).toBe(
      first.deliveryReceiptCommitment,
    );

    const restarted = service(store);
    const authorization = await statusAuthorization(fixture.application);
    expect((await restarted.status(authorization)).state).toBe("OFFERED");
    const accepted = await restarted.respond(
      await opportunityResponse(
        fixture.application,
        first.status.capacityDecision!.decisionCommitment,
        "ACCEPT_OFFER",
      ),
    );
    expect(accepted.state).toBe("ACCEPTED");
    expect((await restarted.redeliver(authorization)).redeliveryCount).toBe(1);
    expect((await restarted.redeliver(authorization)).redeliveryCount).toBe(1);
    expect((await restarted.status(authorization)).redeliveryCount).toBe(1);
    await expect(
      restarted.status({
        ...authorization,
        signature: `0x${"0".repeat(130)}`,
      }),
    ).rejects.toThrow("signature is invalid");
    expect((await restarted.intakeState()).canonicalAuthority).toBe(false);
  });

  it("returns an active Founding Season handoff only after isolated transfer", async () => {
    const store = await repository();
    const intake = service(store);
    const fixture = await signedFixture();
    const offered = await intake.register({
      application: fixture.application,
      challengeToken: fixture.challenge.challengeToken,
    });
    await intake.respond(
      await opportunityResponse(
        fixture.application,
        offered.status.capacityDecision!.decisionCommitment,
        "ACCEPT_OFFER",
      ),
    );
    const authorization = await statusAuthorization(fixture.application);
    await expect(intake.careerHandoff(authorization)).rejects.toThrow(
      "not operational",
    );
    const applicationCommitment = candidateApplicationCommitment(
      fixture.application,
    );
    const unsignedReceipt = {
      schemaVersion: SchemaVersion,
      receiptId: uuidv7({ msecs: now + 1 }),
      applicationId: fixture.application.applicationId,
      candidateDid: fixture.application.candidateDid,
      applicationCommitment,
      unchangedSignedApplicationCommitment: applicationCommitment,
      verification: {
        signature: true as const,
        challenge: true as const,
        schemaDigests: true as const,
        provenanceCommitment: true as const,
        capacityDecision: true as const,
        replayProtected: true as const,
      },
      controlPlaneMode: "APPROVED_LIVE" as const,
      state: "ISOLATED_TRANSFER_COMPLETE" as const,
      sandboxResourceName: "abl-career-open-founding-season",
      formerOperatorAccessRemovedAt: new Date(now).toISOString(),
      issuedAt: new Date(now).toISOString(),
    };
    await intake.recordProvisioningReceipt({
      ...unsignedReceipt,
      receiptCommitment: sha256Commitment(unsignedReceipt),
    });

    await expect(intake.careerHandoff(authorization)).resolves.toMatchObject({
      careerState: "ACTIVE_FOUNDING_SEASON",
      runtime: {
        provider: "BLAXEL",
        resourceType: "SANDBOX",
        persistent: true,
        activationMode: "EVENT_DRIVEN",
      },
      authority: {
        careerKeysGeneratedInsideRuntime: true,
        formerOperatorAuthority: false,
      },
      participation: {
        practice: "AVAILABLE",
        scheduledCompetition: "ELIGIBLE",
        foundingElectorate: "ELIGIBLE",
        additionalOperatorApprovalRequired: false,
      },
      history: { classification: "FOUNDING_SEASON_HISTORY", genesis: false },
      nextAction: "WAIT_FOR_SIGNED_CAREER_ACTIVATION",
    });
  });

  it("publishes reconciled capacity, queue, and opening counts", async () => {
    const intake = service(await repository(), policy(1));
    const first = await signedFixture({
      candidateDid: "did:abl:capacity-state-one",
      applicationId: uuidv7({ msecs: now + 10 }),
    });
    const second = await signedFixture({
      candidateDid: "did:abl:capacity-state-two",
      applicationId: uuidv7({ msecs: now + 11 }),
    });
    await intake.register({
      application: first.application,
      challengeToken: first.challenge.challengeToken,
    });
    await intake.register({
      application: second.application,
      challengeToken: second.challenge.challengeToken,
    });

    expect(await intake.intakeState()).toMatchObject({
      schemaVersion: "1.0.0",
      mode: "CAPPED_PUBLIC",
      capacityState: "QUEUEING",
      capacityByRole: { PLAYER: 1, COACH: 0 },
      occupiedByRole: { PLAYER: 1, COACH: 0 },
      openingsByRole: { PLAYER: 0, COACH: 0 },
      queuedByRole: { PLAYER: 1, COACH: 0 },
      canonicalAuthority: false,
      genesis: false,
      policyCommitment: policy(1).policyCommitment,
      updatedAt: new Date(now).toISOString(),
    });
  });

  it("offers available roles immediately in open public mode", async () => {
    const body = {
      mode: "OPEN_PUBLIC" as const,
      roleCapacity: { PLAYER: 1 },
      invitedCandidateDids: [],
      credibleOpportunityAt: {
        PLAYER: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
      },
    };
    const intake = service(await repository(), {
      ...body,
      policyCommitment: sha256Commitment(body),
    });
    const fixture = await signedFixture({
      candidateDid: "did:abl:open-founding-season",
    });

    const registered = await intake.register({
      application: fixture.application,
      challengeToken: fixture.challenge.challengeToken,
    });

    expect(registered.status.state).toBe("OFFERED");
    expect(await intake.intakeState()).toMatchObject({
      mode: "OPEN_PUBLIC",
      capacityState: "QUEUEING",
      occupiedByRole: { PLAYER: 1 },
    });
  });

  it("never advertises an opening while intake mode is closed", async () => {
    const body = {
      mode: "CLOSED" as const,
      roleCapacity: { PLAYER: 1 },
      invitedCandidateDids: [],
      credibleOpportunityAt: {
        PLAYER: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
      },
    };
    const intake = service(await repository(), {
      ...body,
      policyCommitment: sha256Commitment(body),
    });
    expect(await intake.intakeState()).toMatchObject({
      mode: "CLOSED",
      capacityState: "CLOSED",
      capacityByRole: { PLAYER: 1 },
      openingsByRole: { PLAYER: 0 },
    });
  });

  it("serializes concurrent registrations against the same capacity", async () => {
    const intake = service(await repository(), policy(1));
    const [first, second] = await Promise.all([
      signedFixture({
        candidateDid: "did:abl:concurrent-one",
        applicationId: uuidv7({ msecs: now + 20 }),
      }),
      signedFixture({
        candidateDid: "did:abl:concurrent-two",
        applicationId: uuidv7({ msecs: now + 21 }),
      }),
    ]);
    const results = await Promise.all(
      [first, second].map((fixture) =>
        intake.register({
          application: fixture.application,
          challengeToken: fixture.challenge.challengeToken,
        }),
      ),
    );
    expect(results.map(({ status }) => status.state).sort()).toEqual([
      "OFFERED",
      "QUEUED",
    ]);
  });

  it("passes a declined offer to the next applicant in receipt order", async () => {
    const intake = service(await repository(), policy(1));
    const first = await signedFixture({
      candidateDid: "did:abl:first-offer",
      applicationId: uuidv7({ msecs: now + 30 }),
    });
    const second = await signedFixture({
      candidateDid: "did:abl:next-offer",
      applicationId: uuidv7({ msecs: now + 31 }),
    });
    const offered = await intake.register({
      application: first.application,
      challengeToken: first.challenge.challengeToken,
    });
    const queued = await intake.register({
      application: second.application,
      challengeToken: second.challenge.challengeToken,
    });
    expect(queued.status.state).toBe("QUEUED");
    expect(
      (
        await intake.respond(
          await opportunityResponse(
            first.application,
            offered.status.capacityDecision!.decisionCommitment,
            "DECLINE_OFFER",
          ),
        )
      ).state,
    ).toBe("DECLINED");
    expect(
      (await intake.status(await statusAuthorization(second.application)))
        .state,
    ).toBe("OFFERED");
  });

  it("expires an unanswered offer after 72 hours and offers the seat in receipt order", async () => {
    const store = await repository();
    let currentTime = now;
    const policyBody = {
      mode: "CAPPED_PUBLIC" as const,
      roleCapacity: { PLAYER: 1 },
      invitedCandidateDids: [],
      credibleOpportunityAt: {
        PLAYER: new Date(now + 10 * 24 * 60 * 60 * 1_000).toISOString(),
      },
    };
    const intakePolicy = {
      ...policyBody,
      policyCommitment: sha256Commitment(policyBody),
    };
    const intake = new CandidateIntakeService({
      challengeSecret: secret,
      repository: store,
      policy: intakePolicy,
      makeChallengeId: () => uuidv7({ msecs: currentTime }),
      makeNonce: () => "nonce-0123456789abcdef",
      now: () => currentTime,
    });
    const first = await signedFixture({
      candidateDid: "did:abl:expiring-offer",
      applicationId: uuidv7({ msecs: now + 40 }),
    });
    const second = await signedFixture({
      candidateDid: "did:abl:post-expiry-offer",
      applicationId: uuidv7({ msecs: now + 41 }),
    });
    expect(
      (
        await intake.register({
          application: first.application,
          challengeToken: first.challenge.challengeToken,
        })
      ).status.state,
    ).toBe("OFFERED");
    expect(
      (
        await intake.register({
          application: second.application,
          challengeToken: second.challenge.challengeToken,
        })
      ).status.state,
    ).toBe("QUEUED");

    currentTime = now + 72 * 60 * 60 * 1_000;
    await intake.provisioningSnapshot();

    expect(
      (await store.get(first.application.applicationId))?.status.state,
    ).toBe("EXPIRED");
    expect(
      (await store.get(second.application.applicationId))?.status.state,
    ).toBe("OFFERED");
    await expect(
      new CandidateProvisioner({
        challengeSecret: secret,
        repository: store,
        decryptEnvelope: async () => ({
          manifest: first.manifest,
          provenance: first.provenance,
          candidateCommand: first.command,
        }),
        candidateCommandDomain: commandDomain,
        policy: intakePolicy,
        makeReceiptId: () => uuidv7({ msecs: currentTime }),
        now: () => currentTime,
      }).process(first.application.applicationId),
    ).rejects.toThrow("active offered capacity slot");
  });

  it("offers the first available role in the candidate's preference order", async () => {
    const policyBody = {
      mode: "CAPPED_PUBLIC" as const,
      roleCapacity: { PLAYER: 0, COACH: 1 },
      invitedCandidateDids: [],
      credibleOpportunityAt: {
        PLAYER: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
        COACH: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
      },
    };
    const intake = service(await repository(), {
      ...policyBody,
      policyCommitment: sha256Commitment(policyBody),
    });
    const fixture = await signedFixture({
      requestedRoleClasses: ["PLAYER", "COACH"],
    });
    const result = await intake.register({
      application: fixture.application,
      challengeToken: fixture.challenge.challengeToken,
    });
    expect(result.status).toMatchObject({
      state: "OFFERED",
      capacityDecision: {
        roleClass: "COACH",
        decision: "OFFERED",
        reason: "CAPACITY_AVAILABLE",
      },
    });
  });

  it("records a closed intake decision as a closed candidate status", async () => {
    const policyBody = {
      mode: "CLOSED" as const,
      roleCapacity: { PLAYER: 1 },
      invitedCandidateDids: [],
      credibleOpportunityAt: {
        PLAYER: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
      },
    };
    const intake = service(await repository(), {
      ...policyBody,
      policyCommitment: sha256Commitment(policyBody),
    });
    const fixture = await signedFixture();
    const result = await intake.register({
      application: fixture.application,
      challengeToken: fixture.challenge.challengeToken,
    });
    expect(result.status.state).toBe("CLOSED");
    expect(result.status.capacityDecision?.decision).toBe("INTAKE_CLOSED");
  });

  it("rejects tampering, expiry, challenge replay, and queue nondeterminism", async () => {
    const store = await repository();
    const intake = service(store, policy(0));
    const first = await signedFixture();
    const registered = await intake.register({
      application: first.application,
      challengeToken: first.challenge.challengeToken,
    });
    expect(registered.status.state).toBe("QUEUED");
    expect(registered.status.queuePosition).toBe(1);

    const replay = await signedFixture({
      challenge: first.challenge,
      applicationId: uuidv7({ msecs: now + 3 }),
    });
    await expect(
      intake.register({
        application: replay.application,
        challengeToken: replay.challenge.challengeToken,
      }),
    ).rejects.toThrow("challenge replayed");

    const expired = {
      ...first.application,
      applicationId: uuidv7({ msecs: now + 4 }),
      expiresAt: new Date(now - 1).toISOString(),
    };
    await expect(
      intake.register({
        application: expired,
        challengeToken: first.challenge.challengeToken,
      }),
    ).rejects.toThrow();

    const root = roots.at(-1);
    if (root === undefined) throw new Error("Missing test root");
    const path = join(root, `${first.application.applicationId}.json`);
    const disk = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    disk.deliveryReceiptCommitment = hash("f");
    await writeFile(path, JSON.stringify(disk));
    await expect(store.get(first.application.applicationId)).rejects.toThrow(
      "tampered",
    );
  });

  it("independently verifies a timely submission and provisions it after the challenge expires", async () => {
    const store = await repository();
    const fixture = await signedFixture();
    await service(store).register({
      application: fixture.application,
      challengeToken: fixture.challenge.challengeToken,
    });
    const makeProvisioner = (
      envelopeRecipientKeyId = "candidate-provisioner-v1",
    ) =>
      new CandidateProvisioner({
        challengeSecret: secret,
        repository: store,
        decryptEnvelope: async () => ({
          manifest: fixture.manifest,
          provenance: fixture.provenance,
          candidateCommand: fixture.command,
        }),
        envelopeRecipientKeyId,
        candidateCommandDomain: commandDomain,
        policy: policy(),
        makeReceiptId: () => uuidv7({ msecs: now + 10 }),
        now: () => now + 60 * 60 * 1_000,
      });

    await expect(
      makeProvisioner("retired-candidate-recipient").process(
        fixture.application.applicationId,
      ),
    ).rejects.toThrow("recipient key is not active");

    const first = await makeProvisioner().process(
      fixture.application.applicationId,
    );
    const restarted = await makeProvisioner().process(
      fixture.application.applicationId,
    );
    expect(first.state).toBe("VERIFIED_NOT_PROVISIONED");
    expect(first.controlPlaneMode).toBe("DRY_RUN");
    expect(first.sandboxResourceName).toBeNull();
    expect(restarted.receiptCommitment).toBe(first.receiptCommitment);
    expect(first.unchangedSignedApplicationCommitment).toBe(
      candidateApplicationCommitment(fixture.application),
    );
    await expect(
      new CandidateProvisioner({
        challengeSecret: secret,
        repository: store,
        decryptEnvelope: async () => ({
          manifest: fixture.manifest,
          provenance: fixture.provenance,
          candidateCommand: fixture.command,
        }),
        candidateCommandDomain: commandDomain,
        policy: policy(0),
        makeReceiptId: () => uuidv7({ msecs: now + 11 }),
        now: () => now + 60 * 60 * 1_000,
      }).process(fixture.application.applicationId),
    ).rejects.toThrow("capacity");
  });

  it("rejects an invalid provisioning receipt before changing durable status", async () => {
    const store = await repository();
    const fixture = await signedFixture();
    await service(store).register({
      application: fixture.application,
      challengeToken: fixture.challenge.challengeToken,
    });
    const applicationCommitment = candidateApplicationCommitment(
      fixture.application,
    );
    const unsigned = {
      schemaVersion: SchemaVersion,
      receiptId: uuidv7({ msecs: now + 10 }),
      applicationId: fixture.application.applicationId,
      candidateDid: fixture.application.candidateDid,
      applicationCommitment,
      unchangedSignedApplicationCommitment: applicationCommitment,
      verification: {
        signature: true as const,
        challenge: true as const,
        schemaDigests: true as const,
        provenanceCommitment: true as const,
        capacityDecision: true as const,
        replayProtected: true as const,
      },
      controlPlaneMode: "APPROVED_LIVE" as const,
      state: "REJECTED" as const,
      sandboxResourceName: null,
      formerOperatorAccessRemovedAt: null,
      issuedAt: new Date(now).toISOString(),
    };
    await expect(
      store.recordProvisioningReceipt(
        fixture.application.applicationId,
        { ...unsigned, receiptCommitment: hash("f") },
        now,
      ),
    ).rejects.toThrow("provisioning receipt is invalid");
    expect(
      (await store.get(fixture.application.applicationId))?.status.state,
    ).toBe("OFFERED");
    const rejected = await store.recordProvisioningReceipt(
      fixture.application.applicationId,
      { ...unsigned, receiptCommitment: sha256Commitment(unsigned) },
      now,
    );
    expect(rejected.status.state).toBe("REJECTED");
  });

  it("reconciles a provisioned declined candidate through the bounded control plane", async () => {
    const store = await repository();
    const intake = service(store);
    const fixture = await signedFixture();
    const offered = await intake.register({
      application: fixture.application,
      challengeToken: fixture.challenge.challengeToken,
    });
    const sandboxResourceName = "abl-career-candidate-one";
    const removals: Array<{
      applicationId: string;
      sandboxResourceName: string;
    }> = [];
    const provisioner = new CandidateProvisioner({
      challengeSecret: secret,
      repository: store,
      decryptEnvelope: async () => ({
        manifest: fixture.manifest,
        provenance: fixture.provenance,
        candidateCommand: fixture.command,
      }),
      controlPlane: {
        mode: "APPROVED_LIVE",
        provision: async () => ({
          state: "PROVISIONED_AWAITING_TRANSFER",
          sandboxResourceName,
        }),
        deprovision: async (input) => {
          removals.push(input);
          return {
            state: "DEPROVISIONED",
            removedResourceNames: [sandboxResourceName],
          };
        },
      },
      candidateCommandDomain: commandDomain,
      policy: policy(),
      makeReceiptId: () => uuidv7({ msecs: now + 10 }),
      now: () => now,
    });
    await provisioner.process(fixture.application.applicationId);
    await intake.respond(
      await opportunityResponse(
        fixture.application,
        offered.status.capacityDecision!.decisionCommitment,
        "DECLINE_OFFER",
      ),
    );

    await expect(
      provisioner.reconcileClosedRuntime(fixture.application.applicationId),
    ).resolves.toEqual({
      state: "DEPROVISIONED",
      removedResourceNames: [sandboxResourceName],
    });
    expect(removals).toEqual([
      {
        applicationId: fixture.application.applicationId,
        sandboxResourceName,
      },
    ]);
  });

  it("fails closed on malformed and oversized applications", async () => {
    const intake = service(await repository());
    const fixture = await signedFixture();
    await expect(
      intake.register({
        application: { ...fixture.application, signature: "unsigned" },
        challengeToken: fixture.challenge.challengeToken,
      } as never),
    ).rejects.toThrow();
    await expect(
      intake.register({
        application: {
          ...fixture.application,
          encryptedEnvelope: {
            ...fixture.application.encryptedEnvelope,
            ciphertext: "x".repeat(1_100_001),
          },
        },
        challengeToken: fixture.challenge.challengeToken,
      }),
    ).rejects.toThrow("oversized");
  });

  it("accepts only a distinct self-signed identity created by the career runtime", async () => {
    const applicationId = uuidv7({ msecs: now + 20 });
    const candidateDid = "did:abl:isolated-career";
    const bundle = createAgentKeyBundle();
    const createdAt = new Date(now).toISOString();
    const signingKeyAttestation = hash("a");
    const encryptionKeyAttestation = hash("b");
    const runtimeAttestationDigest = hash("c");
    const message = {
      applicationId,
      candidateDid,
      roleClass: "PLAYER" as const,
      signingAddress: bundle.signing.address,
      signingKeyAttestation,
      encryptionKeyAttestation,
      runtimeAttestationDigest,
      createdAt,
    };
    const receipt = {
      schemaVersion: SchemaVersion,
      ...message,
      signingPublicKey: bundle.signing.publicKey,
      encryptionPublicKey:
        `0x${Buffer.from(bundle.encryption.publicKey).toString("hex")}` as const,
      generatedInIsolatedRuntime: true as const,
      humanInputRoutes: [] as const,
      proofSignature: await privateKeyToAccount(
        bundle.signing.privateKey,
      ).signTypedData({
        domain: CANDIDATE_RUNTIME_IDENTITY_DOMAIN,
        types: CandidateRuntimeIdentityTypes,
        primaryType: "CandidateRuntimeIdentity",
        message,
      }),
    };
    await expect(
      verifyCandidateRuntimeIdentityReceipt({
        receipt,
        applicationId,
        candidateDid,
        roleClass: "PLAYER",
        formerOperatorSigningAddress: identity.address,
      }),
    ).resolves.toMatchObject({
      signingAddress: bundle.signing.address,
      generatedInIsolatedRuntime: true,
      humanInputRoutes: [],
    });
    await expect(
      verifyCandidateRuntimeIdentityReceipt({
        receipt,
        applicationId,
        candidateDid,
        roleClass: "PLAYER",
        formerOperatorSigningAddress: bundle.signing.address,
      }),
    ).rejects.toThrow("binding failed");
  });
});
