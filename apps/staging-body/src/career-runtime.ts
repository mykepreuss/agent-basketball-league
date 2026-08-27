import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { CANDIDATE_WORKFLOW_AGGREGATE_TYPE } from "@abl/career";
import {
  CAREER_GAME_FINALIZATION_PROPOSAL_AGGREGATE_TYPE,
  CAREER_GAME_FINALIZATION_PROPOSAL_EVENT_TYPE,
  CAREER_GAME_FINALIZATION_PROPOSAL_SCHEMA_DIGEST,
  CareerGameFinalizationProposalPayloadSchema,
  FINALIZED_GAME_AGGREGATE_TYPE,
  FINALIZED_GAME_SCHEMA_DIGEST,
  GAME_FINALIZED_EVENT_TYPE,
  POSSESSION_RESOLVED_SCHEMA_DIGEST_V2,
  PossessionInputWireSchema,
  materializePossessionInput,
  possessionProjectionSource,
  resolvePossession,
  replayRoleCompleteFoundingExhibition,
  finalizedGameStateRoot,
  isRoleCompleteFoundingExhibitionFinalizer,
} from "@abl/basketball";
import {
  CAREER_POSSESSION_PROPOSAL_AGGREGATE_TYPE,
  CAREER_POSSESSION_PROPOSAL_EVENT_TYPE,
  CAREER_POSSESSION_PROPOSAL_SCHEMA_DIGEST,
  createCareerStorageAuthorization,
  recoverCompetitionAssertionSigner,
  recoverRunnerDelegationSigner,
  runnerDelegationMessage,
  signRunnerDelegation,
  signCompetitionAssertion,
} from "@abl/cognition";
import {
  CANDIDATE_RUNTIME_IDENTITY_DOMAIN,
  CandidateRuntimeIdentityTypes,
} from "@abl/launch";
import {
  createAgentKeyBundle,
  createCanonicalEvent,
  recoverCanonicalEventSigner,
  sha256Bytes,
  sha256Commitment,
  signCanonicalEvent,
  verifyEventContent,
  type CanonicalEvent,
} from "@abl/recognition";
import {
  CAREER_CAPABILITY_AGGREGATE_TYPE,
  CAREER_CAPABILITY_RENEWAL_EVENT_TYPE,
  CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL,
  BASKETBALL_POSITIONS,
  CareerPositionProfileAttestationSchema,
  CandidateRoleClassSchema,
  CandidateRuntimeIdentityReceiptSchema,
  GameScheduleNoticeSchema,
  ParticipationResponseSchema,
  PlayerPositionProfileSchema,
  ReadinessLeaseSchema,
  RunnerDelegationSchema,
  RunnerHeartbeatSchema,
  RunnerPairingOfferSchema,
  SchemaVersion,
  SignedCanonicalCommandSchema,
  type RoleActivation,
  type ParticipationResponse,
  type ReadinessLease,
  type RunnerPairingOffer,
} from "@abl/schemas";
import Fastify from "fastify";
import type { Hex, TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import {
  CareerActivationResultSchema,
  executeDistributedCareerActivation,
  verifyCareerRoleActivationCommand,
  type ActiveCareerRunner,
  type CareerContextAssembly,
  type CareerRelayClient,
} from "./cognition-runtime.js";

export const CAREER_IDENTITY_PATH =
  "/tmp/abl-career-state/career-identity.json";
export const CAREER_POSITION_PROFILE_PATH =
  "/tmp/abl-career-state/player-position-profile.json";
export const CAREER_ACTIVATION_ROOT = "/tmp/abl-career-state/activations";
export const CAREER_RUNNER_PATH = "/tmp/abl-career-state/runner.json";
export const CAREER_PAIRING_ROOT = "/tmp/abl-career-state/pairing-offers";
export const CAREER_SCHEDULE_ROOT = "/tmp/abl-career-state/schedules";

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
const PairingRecordSchema = z.strictObject({
  offer: RunnerPairingOfferSchema.omit({ pairingToken: true }),
  tokenHash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  consumedAt: z.iso.datetime({ offset: true }).nullable(),
});
const ScheduleRecordSchema = z.strictObject({
  notice: GameScheduleNoticeSchema,
  response: ParticipationResponseSchema,
});
const PairingSubmissionSchema = z.strictObject({
  offerId: z.uuid(),
  pairingToken: z.string().min(32).max(512),
  runnerId: z.string().min(1).max(160),
  delegateSigningAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  delegateEncryptionPublicKey: z.string().regex(/^0x[0-9a-f]{64}$/),
});
const RunnerStatusSchema = z.strictObject({
  delegation: RunnerDelegationSchema.nullable(),
  heartbeat: RunnerHeartbeatSchema.nullable(),
});
const CatalogEntrySchema = z.strictObject({
  kind: z.enum(["MEMORY", "FILM", "PRACTICE_LESSON"]),
  objectId: z.string(),
  domainId: z.string(),
  version: z.number().int().positive(),
  contentCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
  disclosureClass: z.enum([
    "PERSONAL_UNSUBMITTED",
    "COMPETITIVE_SEALED",
    "CASE_RESTRICTED",
  ]),
  tags: z.array(z.string()),
});
type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export function selectCompetitionCatalogEntries(
  rawEntries: readonly unknown[],
  activationTags: ReadonlySet<string>,
): CatalogEntry[] {
  return rawEntries
    .map((entry) => CatalogEntrySchema.parse(entry))
    .filter(
      (entry) =>
        entry.disclosureClass !== "CASE_RESTRICTED" &&
        (entry.tags.length === 0 ||
          entry.tags.some((tag) => activationTags.has(tag.toLowerCase()))),
    );
}

export function verifyCatalogPlaintext(
  entry: CatalogEntry,
  plaintextBase64: string,
): Buffer {
  const plaintext = Buffer.from(plaintextBase64, "base64");
  if (sha256Bytes(plaintext) !== entry.contentCommitment)
    throw new Error("Career context object commitment mismatch");
  return plaintext;
}
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
const PossessionProposalPayloadSchema = z.strictObject({
  sequence: z.number().int().positive().max(1_000),
  previousEventHash: z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .nullable(),
  possessionInput: PossessionInputWireSchema,
  recordedAt: z.iso.datetime({ offset: true }),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function deterministicUuid(subject: string): string {
  const hash = sha256Commitment(subject).slice(2);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-7${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function careerRole(roleClass: z.infer<typeof CandidateRoleClassSchema>) {
  if (roleClass === "REPLAY_OFFICIAL") return "REPLAY" as const;
  return z.enum(["PLAYER", "COACH", "REFEREE"]).parse(roleClass);
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

async function loadOrCreatePositionProfile(input: {
  candidateDid: string;
  roleClass: z.infer<typeof CandidateRoleClassSchema>;
  declaredProfile: z.infer<typeof PlayerPositionProfileSchema> | null;
  identity: z.infer<typeof PersistentIdentitySchema>;
}) {
  if (input.roleClass !== "PLAYER") {
    if (input.declaredProfile !== null)
      throw new Error("Only player careers may declare a position profile");
    return null;
  }
  try {
    const stored = CareerPositionProfileAttestationSchema.parse(
      JSON.parse(await readFile(CAREER_POSITION_PROFILE_PATH, "utf8")),
    );
    if (stored.careerDid !== input.candidateDid)
      throw new Error("Position profile is bound to another career");
    if (
      input.declaredProfile !== null &&
      input.declaredProfile.profileCommitment !==
        stored.profile.profileCommitment
    )
      throw new Error("A career position profile cannot change on restart");
    const signer = await recoverCompetitionAssertionSigner(
      {
        kind: "PLAYER_POSITION_PROFILE",
        careerDid: stored.careerDid,
        subjectCommitment: sha256Commitment({
          profile: stored.profile,
          source: stored.source,
        }),
        timestamp: stored.attestedAt,
      },
      stored.signature as Hex,
    );
    if (
      signer.toLowerCase() !==
      input.identity.receipt.signingAddress.toLowerCase()
    )
      throw new Error("Stored position profile has invalid career authority");
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const legacyPrimaryPosition =
    BASKETBALL_POSITIONS[
      Number.parseInt(sha256Commitment(input.candidateDid).slice(2, 10), 16) %
        BASKETBALL_POSITIONS.length
    ]!;
  const profile =
    input.declaredProfile ??
    PlayerPositionProfileSchema.parse({
      primaryPosition: legacyPrimaryPosition,
      eligiblePositions: [...BASKETBALL_POSITIONS],
      profileCommitment: sha256Commitment({
        primaryPosition: legacyPrimaryPosition,
        eligiblePositions: [...BASKETBALL_POSITIONS],
      }),
    });
  if (
    profile.profileCommitment !==
    sha256Commitment({
      primaryPosition: profile.primaryPosition,
      ...(profile.positionPreferenceRanking === undefined
        ? {}
        : {
            positionPreferenceRanking: profile.positionPreferenceRanking,
          }),
      eligiblePositions: profile.eligiblePositions,
    })
  )
    throw new Error("Player position profile commitment mismatch");
  const source =
    input.declaredProfile === null
      ? ("LEGACY_COMPATIBILITY" as const)
      : profile.positionPreferenceRanking === undefined
        ? ("APPLICATION_DECLARED" as const)
        : ("ROSTER_POSITION_OFFER" as const);
  const attestation = CareerPositionProfileAttestationSchema.parse({
    schemaVersion: SchemaVersion,
    careerDid: input.candidateDid,
    profile,
    source,
    attestedAt: input.identity.receipt.createdAt,
    signature: await signCompetitionAssertion(
      input.identity.signingPrivateKey as Hex,
      {
        kind: "PLAYER_POSITION_PROFILE",
        careerDid: input.candidateDid,
        subjectCommitment: sha256Commitment({ profile, source }),
        timestamp: input.identity.receipt.createdAt,
      },
    ),
  });
  await mkdir(dirname(CAREER_POSITION_PROFILE_PATH), {
    recursive: true,
    mode: 0o700,
  });
  const temporaryPath = `${CAREER_POSITION_PROFILE_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(attestation)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, CAREER_POSITION_PROFILE_PATH);
  return attestation;
}

class FixedBrokerClient implements CareerRelayClient {
  readonly #origin: URL;
  #capability: string;
  #capabilityExpiresAt: number;
  readonly #capabilityOperations: readonly string[];
  readonly #commandDomain: TypedDataDomain;
  #renewal: Promise<void> | null = null;
  readonly #previewToken: string | undefined;
  readonly #careerIdentity: z.infer<
    typeof CandidateRuntimeIdentityReceiptSchema
  >;
  readonly #careerPrivateKey: Hex;
  readonly #personalDomainId: string;

  public constructor(input: {
    origin: string;
    capability: string;
    capabilityExpiresAt: string;
    capabilityOperations: readonly string[];
    commandDomain: TypedDataDomain;
    previewToken?: string;
    careerIdentity: z.infer<typeof CandidateRuntimeIdentityReceiptSchema>;
    careerPrivateKey: Hex;
    personalDomainId: string;
  }) {
    this.#origin = new URL(input.origin);
    this.#capability = input.capability;
    this.#capabilityExpiresAt = Date.parse(input.capabilityExpiresAt);
    this.#capabilityOperations = [...input.capabilityOperations].sort();
    this.#commandDomain = input.commandDomain;
    this.#previewToken = input.previewToken;
    this.#careerIdentity = input.careerIdentity;
    this.#careerPrivateKey = input.careerPrivateKey;
    this.#personalDomainId = input.personalDomainId;
  }

  async #ensureCapability(force = false): Promise<void> {
    if (!force && this.#capabilityExpiresAt - Date.now() > 5 * 60_000) return;
    if (this.#renewal !== null) return this.#renewal;
    this.#renewal = (async () => {
      const timestamp = new Date().toISOString();
      const requestedExpiresAt = new Date(
        Date.now() + 3 * 60 * 60_000 + 55 * 60_000,
      ).toISOString();
      const payload = {
        schemaVersion: "1.0.0" as const,
        operations: [...this.#capabilityOperations],
        requestedExpiresAt,
      };
      const event = createCanonicalEvent({
        eventId: deterministicUuid(
          `${this.#careerIdentity.candidateDid}:capability:${timestamp}`,
        ),
        actorDid: this.#careerIdentity.candidateDid,
        nonce: BigInt(`0x${randomBytes(24).toString("hex")}`).toString(10),
        idempotencyKey: deterministicUuid(
          `${this.#careerIdentity.candidateDid}:capability:${timestamp}:idempotency`,
        ),
        aggregateType: CAREER_CAPABILITY_AGGREGATE_TYPE,
        aggregateId: this.#careerIdentity.candidateDid,
        aggregateVersion: 1n,
        eventType: CAREER_CAPABILITY_RENEWAL_EVENT_TYPE,
        previousEventHash: null,
        payload,
        stateRoot: sha256Commitment(payload),
        schemaDigest: sha256Commitment(CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL),
        timestamp,
      });
      const signature = await signCanonicalEvent(
        {
          privateKey: this.#careerPrivateKey,
          publicKey: this.#careerIdentity.signingPublicKey as Hex,
          address: this.#careerIdentity.signingAddress as `0x${string}`,
        },
        this.#commandDomain,
        event,
      );
      const response = await fetch(
        new URL("/v1/capabilities/renew", this.#origin),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.#previewToken === undefined
              ? {}
              : { "x-blaxel-preview-token": this.#previewToken }),
          },
          body: JSON.stringify({
            event: { ...event, aggregateVersion: "1" },
            signatures: [signature],
          }),
          redirect: "error",
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!response.ok)
        throw new Error(
          `Career broker capability renewal failed: ${response.status}`,
        );
      const renewed = z
        .strictObject({
          token: z.string().min(32).max(512),
          expiresAt: z.iso.datetime({ offset: true }),
          operations: z.array(z.string()),
        })
        .parse(await response.json());
      if (
        JSON.stringify(renewed.operations) !==
        JSON.stringify(this.#capabilityOperations)
      )
        throw new Error("Career broker renewed an unexpected capability set");
      this.#capability = renewed.token;
      this.#capabilityExpiresAt = Date.parse(renewed.expiresAt);
    })().finally(() => {
      this.#renewal = null;
    });
    return this.#renewal;
  }

  async #post(path: string, body: unknown): Promise<Response> {
    const request = () =>
      fetch(new URL(path, this.#origin), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#capability}`,
          "content-type": "application/json",
          ...(this.#previewToken === undefined
            ? {}
            : { "x-blaxel-preview-token": this.#previewToken }),
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
    await this.#ensureCapability();
    let response = await request();
    if (response.status === 403) {
      await this.#ensureCapability(true);
      response = await request();
    }
    return response;
  }

  async #storageAuthorization(
    operation: "GET" | "PUT" | "DELETE",
    request: unknown,
  ) {
    return createCareerStorageAuthorization({
      identity: this.#careerIdentity,
      privateKey: this.#careerPrivateKey,
      operation,
      request,
      issuedAt: new Date().toISOString(),
      nonce: BigInt(`0x${randomBytes(24).toString("hex")}`).toString(10),
    });
  }

  async #storageGet(input: {
    objectId: string;
    domainId: string;
    version: number;
    idempotencySeed: string;
  }): Promise<Response> {
    const careerRequest = {
      callerDid: this.#careerIdentity.candidateDid,
      objectId: input.objectId,
      domainId: input.domainId,
      version: input.version,
    };
    return this.#post("/v1/storage/get", {
      objectId: input.objectId,
      domainId: input.domainId,
      version: input.version,
      idempotencyKey: deterministicUuid(input.idempotencySeed),
      careerAuthorization: await this.#storageAuthorization(
        "GET",
        careerRequest,
      ),
    });
  }

  public async ensureFoundation(): Promise<void> {
    const objectId = "career-foundation-v1";
    const content = {
      careerDid: this.#careerIdentity.candidateDid,
      roleClass: this.#careerIdentity.roleClass,
      identityCommitment: sha256Commitment(this.#careerIdentity),
      objectivePolicy: "CAREER_SELECTED_AND_DURABLE",
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(content));
    const createdAt = new Date().toISOString();
    const careerRequest = {
      callerDid: this.#careerIdentity.candidateDid,
      objectId,
      domainId: this.#personalDomainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "application/json",
      plaintextCommitment: sha256Bytes(plaintext),
      createdAt,
    };
    const response = await this.#post("/v1/storage/put", {
      objectId,
      domainId: this.#personalDomainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "application/json",
      plaintextBase64: Buffer.from(plaintext).toString("base64"),
      createdAt,
      expectedVersion: "0",
      idempotencyKey: deterministicUuid(
        `${this.#careerIdentity.candidateDid}:foundation:put`,
      ),
      careerAuthorization: await this.#storageAuthorization(
        "PUT",
        careerRequest,
      ),
    });
    if (!response.ok && response.status !== 409)
      throw new Error(`Career foundation write failed: ${response.status}`);
  }

  public async persistReflection(input: {
    activation: RoleActivation;
    decisionCommitment: `0x${string}`;
    participantResultAccepted: boolean;
    fallback: string;
    selectedAt: string;
  }): Promise<void> {
    const objectId = `practice-${sha256Commitment(input.activation.activationId).slice(2, 34)}`;
    const content = {
      schemaVersion: "1.0.0",
      kind: "PRACTICE_LESSON",
      careerDid: this.#careerIdentity.candidateDid,
      gameId: input.activation.gameId,
      activationId: input.activation.activationId,
      role: input.activation.role,
      decisionCommitment: input.decisionCommitment,
      participantResultAccepted: input.participantResultAccepted,
      fallback: input.fallback,
      selectedAt: input.selectedAt,
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(content));
    const request = {
      callerDid: this.#careerIdentity.candidateDid,
      objectId,
      domainId: this.#personalDomainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "application/json",
      plaintextCommitment: sha256Bytes(plaintext),
      createdAt: input.selectedAt,
    };
    const response = await this.#post("/v1/storage/put", {
      objectId,
      domainId: this.#personalDomainId,
      version: 1,
      previousVersionCommitment: null,
      contentType: "application/json",
      plaintextBase64: Buffer.from(plaintext).toString("base64"),
      createdAt: input.selectedAt,
      expectedVersion: "0",
      idempotencyKey: deterministicUuid(
        `${this.#careerIdentity.candidateDid}:${input.activation.activationId}:practice-reflection`,
      ),
      careerAuthorization: await this.#storageAuthorization("PUT", request),
    });
    if (!response.ok && response.status !== 409)
      throw new Error(`Practice reflection write failed: ${response.status}`);
  }

  async #proxy(
    method: "GET" | "POST",
    path: string,
    body: unknown,
  ): Promise<Response> {
    return this.#post("/v1/proxy", {
      route: "cognition-relay",
      method,
      path,
      body,
      expectedVersion: "0",
      idempotencyKey: deterministicUuid(
        `broker:${method}:${path}:${sha256Commitment(body)}`,
      ),
    });
  }

  public async submitCoreCommand(input: {
    command: unknown;
    expectedVersion: string;
    idempotencyKey: string;
  }): Promise<unknown> {
    const response = await this.#post("/v1/proxy", {
      route: "core",
      method: "POST",
      path: "/v1/commands",
      body: input.command,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
    });
    if (!response.ok)
      throw new Error(`Core rejected career possession: ${response.status}`);
    return response.json();
  }

  public async enqueue(request: Parameters<CareerRelayClient["enqueue"]>[0]) {
    const response = await this.#proxy(
      "POST",
      "/v1/internal/activations",
      request,
    );
    if (!response.ok)
      throw new Error(`Relay activation delivery failed: ${response.status}`);
    return z
      .strictObject({ status: z.enum(["CREATED", "EXISTS"]) })
      .parse(await response.json()).status;
  }

  public async result(activationId: string, acknowledge: boolean) {
    const response = await this.#proxy(
      "GET",
      `/v1/internal/activations/${encodeURIComponent(activationId)}/result?acknowledge=${acknowledge}`,
      null,
    );
    if (response.status === 204) return null;
    if (!response.ok)
      throw new Error(`Relay result retrieval failed: ${response.status}`);
    return (await response.json()) as Awaited<
      ReturnType<CareerRelayClient["result"]>
    >;
  }

  public async transition(
    state: Parameters<CareerRelayClient["transition"]>[0],
  ): Promise<void> {
    const response = await this.#proxy(
      "POST",
      "/v1/internal/activation-states",
      state,
    );
    if (!response.ok)
      throw new Error(`Relay activation transition failed: ${response.status}`);
  }

  public async registerOffer(offer: RunnerPairingOffer): Promise<void> {
    const response = await this.#proxy(
      "POST",
      "/v1/internal/pairing-offers",
      offer,
    );
    if (!response.ok)
      throw new Error(`Relay pairing offer failed: ${response.status}`);
  }

  public async runnerStatus(careerDid: string) {
    const response = await this.#proxy(
      "GET",
      `/v1/internal/careers/${encodeURIComponent(careerDid)}/runner`,
      null,
    );
    if (!response.ok)
      throw new Error(`Relay runner status failed: ${response.status}`);
    return RunnerStatusSchema.parse(await response.json());
  }

  public async context(
    activation: RoleActivation,
  ): Promise<CareerContextAssembly> {
    const materials: CareerContextAssembly["materials"][number][] = [];
    const foundation = await this.#storageGet({
      objectId: "career-foundation-v1",
      domainId: this.#personalDomainId,
      version: 1,
      idempotencySeed: `${activation.activationId}:career-foundation-v1:1`,
    });
    if (foundation.ok) {
      const stored = z
        .strictObject({ plaintextBase64: z.string() })
        .passthrough()
        .parse(await foundation.json());
      const plaintext = Buffer.from(stored.plaintextBase64, "base64");
      materials.push({
        commitment: sha256Bytes(plaintext),
        disclosureClass: "PERSONAL_UNSUBMITTED",
        source: "IDENTITY",
        content: JSON.parse(plaintext.toString("utf8")) as unknown,
      });
    }
    for (const kind of ["MEMORY", "FILM", "PRACTICE_LESSON"] as const) {
      const catalogResponse = await this.#post("/v1/context/catalog", { kind });
      if (!catalogResponse.ok) continue;
      const entries = z
        .strictObject({ entries: z.array(CatalogEntrySchema) })
        .parse(await catalogResponse.json()).entries;
      const activationTags = new Set([
        activation.role.toLowerCase(),
        activation.gameId.toLowerCase(),
        "career",
        "team",
      ]);
      const relevant = selectCompetitionCatalogEntries(entries, activationTags);
      for (const entry of relevant.slice(
        0,
        Math.max(0, 12 - materials.length),
      )) {
        const response = await this.#storageGet({
          objectId: entry.objectId,
          domainId: entry.domainId,
          version: entry.version,
          idempotencySeed: `${activation.activationId}:${entry.objectId}:${entry.version}`,
        });
        if (!response.ok) continue;
        const stored = z
          .strictObject({ plaintextBase64: z.string() })
          .passthrough()
          .parse(await response.json());
        const plaintextBytes = verifyCatalogPlaintext(
          entry,
          stored.plaintextBase64,
        );
        const plaintext = plaintextBytes.toString("utf8");
        let content: unknown = plaintext;
        try {
          content = JSON.parse(plaintext) as unknown;
        } catch {
          // Text memories remain text; the career still commits their bytes.
        }
        materials.push({
          commitment: sha256Bytes(plaintextBytes),
          disclosureClass: entry.disclosureClass,
          source:
            kind === "MEMORY"
              ? "MEMORY"
              : kind === "FILM"
                ? "PRIVATE_FILM"
                : "PRACTICE_LESSON",
          content,
        });
      }
    }
    const policyId = deterministicUuid(
      `${activation.careerDid}:minimum-necessary-context-v2`,
    );
    const policyBase = {
      schemaVersion: "1.0.0" as const,
      policyId,
      careerDid: activation.careerDid,
      minimumNecessary: true as const,
      allowedDisclosureClasses: [
        "PERSONAL_UNSUBMITTED",
        "COMPETITIVE_SEALED",
      ] as const,
      allowedMemoryDomains: [
        "AUTOBIOGRAPHICAL",
        "RELATIONAL",
        "STRATEGIC",
        "WORKING",
      ] as const,
      allowPrivateFilm: true,
      allowPracticeLessons: true,
    };
    const { officialObservation: _officialObservation, ...activationMetadata } =
      activation;
    return {
      policy: {
        ...policyBase,
        allowedDisclosureClasses: [...policyBase.allowedDisclosureClasses],
        allowedMemoryDomains: [...policyBase.allowedMemoryDomains],
        policyCommitment: sha256Commitment(policyBase),
      },
      materials,
      officialContext: {
        activation: activationMetadata,
        observation: activation.officialObservation,
        contextSelection: "MINIMUM_RELEVANT_MATERIAL",
      },
      fallbackDecision:
        activation.role === "PLAYER"
          ? { action: "HOLD" }
          : activation.role === "COACH"
            ? { instruction: "RETAIN_CURRENT_TACTIC_AND_LINEUP" }
            : activation.role === "REFEREE"
              ? { call: "NO_CALL" }
              : { ruling: "NO_REVIEW" },
      kernelHash: sha256Commitment("abl-basketball-kernel-v2"),
      toolHash: sha256Commitment("abl-fixed-broker-context-selector-v2"),
    };
  }
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
  const role = careerRole(roleClass);
  const identity = await loadOrCreateIdentity({
    applicationId,
    candidateDid,
    roleClass,
    runtimeImageReference: required("ABL_RUNTIME_IMAGE_REFERENCE"),
  });
  const commandDomain = DomainSchema.parse(
    JSON.parse(required("ABL_CANDIDATE_COMMAND_DOMAIN_JSON")),
  ) satisfies TypedDataDomain;
  const cognitionMode = z
    .enum(["DISABLED", "PARTICIPANT_CONTROLLED", "DETERMINISTIC_FIXTURE"])
    .parse(process.env.ABL_COGNITION_MODE ?? "DISABLED");
  const declaredPlayerPositionProfile =
    process.env.ABL_PLAYER_POSITION_PROFILE_JSON === undefined
      ? null
      : PlayerPositionProfileSchema.parse(
          JSON.parse(process.env.ABL_PLAYER_POSITION_PROFILE_JSON),
        );
  const positionProfileAttestation = await loadOrCreatePositionProfile({
    candidateDid,
    roleClass,
    declaredProfile: declaredPlayerPositionProfile,
    identity,
  });
  const playerPositionProfile = positionProfileAttestation?.profile ?? null;
  const broker =
    cognitionMode === "DISABLED"
      ? null
      : new FixedBrokerClient({
          origin: required("ABL_FIXED_BROKER_ORIGIN"),
          capability: required("ABL_FIXED_BROKER_CAPABILITY_TOKEN"),
          capabilityExpiresAt: required(
            "ABL_FIXED_BROKER_CAPABILITY_EXPIRES_AT",
          ),
          capabilityOperations: z
            .array(z.string())
            .parse(
              JSON.parse(
                required("ABL_FIXED_BROKER_CAPABILITY_OPERATIONS_JSON"),
              ),
            ),
          commandDomain,
          ...(process.env.ABL_FIXED_BROKER_PREVIEW_TOKEN === undefined
            ? {}
            : { previewToken: process.env.ABL_FIXED_BROKER_PREVIEW_TOKEN }),
          careerIdentity: identity.receipt,
          careerPrivateKey: identity.signingPrivateKey as Hex,
          personalDomainId: required("ABL_CAREER_PERSONAL_DOMAIN_ID"),
        });
  const cognitionIdentity = {
    privateKey: identity.signingPrivateKey as Hex,
    publicKey: identity.receipt.signingPublicKey as Hex,
    address: identity.receipt.signingAddress as `0x${string}`,
    candidateDid,
    applicationId,
    role,
    encryptionSecretKey: new Uint8Array(
      Buffer.from(identity.encryptionSecretKey, "base64url"),
    ),
    encryptionPublicKey: identity.receipt.encryptionPublicKey as `0x${string}`,
  };
  const coordinator =
    cognitionMode === "DISABLED"
      ? null
      : {
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
        };
  if (broker !== null) await broker.ensureFoundation();
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

  function schedulePath(gameId: string): string {
    return `${CAREER_SCHEDULE_ROOT}/${sha256Commitment(gameId).slice(2)}.json`;
  }

  async function scheduledCommitments(): Promise<
    Array<z.infer<typeof ScheduleRecordSchema>>
  > {
    const entries = await readdir(CAREER_SCHEDULE_ROOT).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) =>
          ScheduleRecordSchema.parse(
            JSON.parse(
              await readFile(`${CAREER_SCHEDULE_ROOT}/${entry}`, "utf8"),
            ),
          ),
        ),
    );
    return records.sort((left, right) =>
      left.notice.scheduledTipoffAt.localeCompare(
        right.notice.scheduledTipoffAt,
      ),
    );
  }

  async function nextScheduledCommitment(): Promise<z.infer<
    typeof ScheduleRecordSchema
  > | null> {
    const now = Date.now();
    return (
      (await scheduledCommitments()).find(
        ({ notice, response }) =>
          response.response === "ACCEPT" &&
          Date.parse(notice.scheduledTipoffAt) >= now,
      ) ?? null
    );
  }

  async function activeRunner(): Promise<ActiveCareerRunner | null> {
    if (broker === null) return null;
    let status;
    try {
      status = await broker.runnerStatus(candidateDid);
    } catch {
      return null;
    }
    if (
      status.delegation === null ||
      status.heartbeat === null ||
      status.heartbeat.availability !== "ONLINE" ||
      Date.now() - Date.parse(status.heartbeat.observedAt) > 120_000
    )
      return null;
    return {
      delegation: status.delegation,
      runnerBuildDigest: status.heartbeat.runnerBuildDigest as `0x${string}`,
      adapterBuildDigest: status.heartbeat.adapterBuildDigest as `0x${string}`,
    };
  }

  const app = Fastify({ logger: false, bodyLimit: 350_000 });
  app.get("/health", async () => ({
    status: "ok",
    runtime: "ABL_FOUNDING_CAREER",
    keyReady: true,
    candidateDid,
    applicationId,
    role,
    identityCommitment: sha256Commitment(identity.receipt),
    cognitionMode,
    hostedModelCredentials: false,
    positionProfileConfigured:
      roleClass !== "PLAYER" || positionProfileAttestation !== null,
  }));
  app.get("/v1/career/identity", async () => identity.receipt);
  app.get("/v1/career/position-profile", async (_request, reply) =>
    positionProfileAttestation === null
      ? reply.code(404).send({ error: "position_profile_not_configured" })
      : positionProfileAttestation,
  );

  app.get("/v1/career/runner/status", async () => {
    const schedule = await nextScheduledCommitment();
    if (broker === null || cognitionMode !== "PARTICIPANT_CONTROLLED")
      return {
        delegation: null,
        heartbeat: null,
        nextScheduledCommitment: schedule?.notice ?? null,
        participationResponse: schedule?.response ?? null,
        positionProfile: playerPositionProfile,
      };
    return {
      ...(await broker.runnerStatus(candidateDid)),
      nextScheduledCommitment: schedule?.notice ?? null,
      participationResponse: schedule?.response ?? null,
      positionProfile: playerPositionProfile,
    };
  });

  app.post("/v1/career/readiness-leases", async (request, reply) => {
    if (broker === null || cognitionMode !== "PARTICIPANT_CONTROLLED")
      return reply.code(503).send({ error: "competition_not_enabled" });
    try {
      const body = z
        .strictObject({ gameId: z.string().min(1).max(200) })
        .parse(request.body);
      const schedule = ScheduleRecordSchema.parse(
        JSON.parse(await readFile(schedulePath(body.gameId), "utf8")),
      );
      const issuedAt = new Date().toISOString();
      if (
        schedule.response.response !== "ACCEPT" ||
        Date.parse(issuedAt) < Date.parse(schedule.notice.readinessCheckedAt) ||
        Date.parse(issuedAt) > Date.parse(schedule.notice.scheduledTipoffAt)
      )
        throw new Error("Career is outside the final readiness window");
      const runner = await broker.runnerStatus(candidateDid);
      if (runner.delegation === null)
        return reply.code(409).send({ error: "runner_unpaired" });
      const delegationActive =
        runner.delegation.revokedAt === null &&
        Date.parse(runner.delegation.expiresAt) > Date.parse(issuedAt);
      const heartbeatFresh =
        runner.heartbeat !== null &&
        Date.parse(issuedAt) - Date.parse(runner.heartbeat.observedAt) <=
          120_000;
      const state = !delegationActive
        ? "REVOKED"
        : runner.heartbeat?.availability === "ON_DEMAND_ONLY"
          ? "ON_DEMAND_ONLY"
          : runner.heartbeat?.availability === "ONLINE" && heartbeatFresh
            ? "READY"
            : "OFFLINE";
      const unsigned = {
        schemaVersion: "1.0.0" as const,
        leaseId: deterministicUuid(
          `${body.gameId}:${candidateDid}:${issuedAt}:readiness`,
        ),
        gameId: body.gameId,
        careerDid: candidateDid,
        runnerId: runner.delegation.runnerId,
        role,
        state,
        issuedAt,
        expiresAt: new Date(Date.parse(issuedAt) + 120_000).toISOString(),
        heartbeatCommitment: sha256Commitment(runner.heartbeat),
      };
      const lease: ReadinessLease = ReadinessLeaseSchema.parse({
        ...unsigned,
        careerSignature: await signCompetitionAssertion(
          cognitionIdentity.privateKey,
          {
            kind: "READINESS_LEASE",
            careerDid: candidateDid,
            subjectCommitment: sha256Commitment(unsigned),
            timestamp: issuedAt,
          },
        ),
      });
      return reply.code(201).send(lease);
    } catch {
      return reply.code(400).send({ error: "readiness_lease_rejected" });
    }
  });

  app.post("/v1/career/schedule-notices", async (request, reply) => {
    if (coordinator === null)
      return reply.code(503).send({ error: "competition_not_enabled" });
    try {
      const notice = GameScheduleNoticeSchema.parse(request.body);
      if (notice.careerDid !== candidateDid || notice.role !== role)
        throw new Error("Schedule notice is bound to another career or role");
      const { directorSignature: _signature, ...unsignedNotice } = notice;
      const signer = await recoverCompetitionAssertionSigner(
        {
          kind: "GAME_SCHEDULE_NOTICE",
          careerDid: candidateDid,
          subjectCommitment: sha256Commitment(unsignedNotice),
          timestamp: notice.issuedAt,
        },
        notice.directorSignature as Hex,
      );
      if (
        notice.directorDid !== coordinator.did ||
        signer.toLowerCase() !== coordinator.signerAddress.toLowerCase() ||
        Date.parse(notice.responseDueAt) <= Date.parse(notice.issuedAt) ||
        Date.parse(notice.scheduledTipoffAt) <= Date.parse(notice.responseDueAt)
      )
        throw new Error("Schedule notice authority or timing is invalid");
      const path = schedulePath(notice.gameId);
      try {
        const existing = ScheduleRecordSchema.parse(
          JSON.parse(await readFile(path, "utf8")),
        );
        if (sha256Commitment(existing.notice) !== sha256Commitment(notice))
          throw new Error("Schedule game ID is bound to another notice");
        return existing.response;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const responseChoice = z
        .enum(["ACCEPT", "DECLINE", "REFUSE"])
        .parse(process.env.ABL_DEFAULT_PARTICIPATION_RESPONSE ?? "ACCEPT");
      const respondedAt = new Date().toISOString();
      if (Date.parse(respondedAt) > Date.parse(notice.responseDueAt))
        throw new Error("Schedule notice arrived after the response deadline");
      const unsignedResponse = {
        schemaVersion: "1.0.0" as const,
        responseId: deterministicUuid(`${notice.noticeId}:response`),
        noticeId: notice.noticeId,
        gameId: notice.gameId,
        careerDid: candidateDid,
        response: responseChoice,
        reasonCommitment:
          responseChoice === "ACCEPT"
            ? null
            : sha256Commitment({
                response: responseChoice,
                policy: "CAREER_DEFAULT_PARTICIPATION_POLICY_V1",
              }),
        respondedAt,
      };
      const response: ParticipationResponse = ParticipationResponseSchema.parse(
        {
          ...unsignedResponse,
          signature: await signCompetitionAssertion(
            cognitionIdentity.privateKey,
            {
              kind: "PARTICIPATION_RESPONSE",
              careerDid: candidateDid,
              subjectCommitment: sha256Commitment(unsignedResponse),
              timestamp: respondedAt,
            },
          ),
        },
      );
      await mkdir(CAREER_SCHEDULE_ROOT, { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify({ notice, response })}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      return reply.code(201).send(response);
    } catch {
      return reply.code(400).send({ error: "schedule_notice_rejected" });
    }
  });

  app.post("/v1/career/runner/pairing-offer", async (_request, reply) => {
    if (broker === null || cognitionMode !== "PARTICIPANT_CONTROLLED")
      return reply.code(503).send({ error: "runner_pairing_not_enabled" });
    const issuedAt = new Date().toISOString();
    const offer: RunnerPairingOffer = {
      schemaVersion: "1.0.0",
      offerId: deterministicUuid(`${candidateDid}:${issuedAt}:pairing-offer`),
      careerDid: candidateDid,
      careerSignerAddress: identity.receipt.signingAddress,
      careerResourceName: required("ABL_RUNTIME_RESOURCE_NAME"),
      relayOrigin: required("ABL_COGNITION_RELAY_PUBLIC_ORIGIN"),
      runnerBundleDigest: required("ABL_RUNNER_BUNDLE_DIGEST") as `0x${string}`,
      pairingToken: randomBytes(32).toString("base64url"),
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + 15 * 60_000).toISOString(),
      singleUse: true,
    };
    RunnerPairingOfferSchema.parse(offer);
    const { pairingToken: _pairingToken, ...safeOffer } = offer;
    const record = PairingRecordSchema.parse({
      offer: safeOffer,
      tokenHash: sha256Commitment(offer.pairingToken),
      consumedAt: null,
    });
    await mkdir(CAREER_PAIRING_ROOT, { recursive: true, mode: 0o700 });
    const path = `${CAREER_PAIRING_ROOT}/${offer.offerId}.json`;
    await writeFile(path, `${JSON.stringify(record)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await broker.registerOffer(offer);
    return reply.code(201).send(offer);
  });

  app.post("/v1/internal/runner-delegations", async (request, reply) => {
    if (
      request.headers.authorization !==
      `Bearer ${required("ABL_CAREER_PAIRING_INTERNAL_TOKEN")}`
    )
      return reply.code(401).send({ error: "unauthorized" });
    try {
      const submission = PairingSubmissionSchema.parse(request.body);
      const path = `${CAREER_PAIRING_ROOT}/${submission.offerId}.json`;
      const record = PairingRecordSchema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
      const issuedAt = new Date().toISOString();
      if (
        record.offer.careerDid !== candidateDid ||
        record.consumedAt !== null ||
        record.tokenHash === null ||
        record.tokenHash !== sha256Commitment(submission.pairingToken) ||
        Date.parse(record.offer.expiresAt) <= Date.parse(issuedAt)
      )
        throw new Error("Pairing offer is invalid");
      const scopes = [
        "RUNNER_HEARTBEAT",
        "ACTIVATION_CLAIM",
        "RESULT_SUBMISSION",
      ] as const;
      const unsigned = {
        schemaVersion: "1.0.0" as const,
        delegationId: deterministicUuid(
          `${submission.offerId}:${submission.runnerId}:delegation`,
        ),
        careerDid: candidateDid,
        runnerId: submission.runnerId,
        delegateSigningAddress: submission.delegateSigningAddress,
        delegateEncryptionPublicKey: submission.delegateEncryptionPublicKey,
        scopes: [...scopes],
        issuedAt,
        expiresAt: new Date(
          Date.parse(issuedAt) + 30 * 24 * 60 * 60_000,
        ).toISOString(),
      };
      const scopesCommitment = sha256Commitment([...scopes].sort());
      const careerSignature = await signRunnerDelegation(
        cognitionIdentity.privateKey,
        runnerDelegationMessage(unsigned, scopesCommitment),
      );
      const delegation = RunnerDelegationSchema.parse({
        ...unsigned,
        revokedAt: null,
        careerSignature,
      });
      const recovered = await recoverRunnerDelegationSigner(
        runnerDelegationMessage(unsigned, scopesCommitment),
        delegation.careerSignature as Hex,
      );
      if (recovered.toLowerCase() !== cognitionIdentity.address.toLowerCase())
        throw new Error("Delegation signature self-check failed");
      await writeFile(
        path,
        `${JSON.stringify({ ...record, tokenHash: null, consumedAt: issuedAt })}\n`,
        { mode: 0o600 },
      );
      await writeFile(CAREER_RUNNER_PATH, `${JSON.stringify(delegation)}\n`, {
        mode: 0o600,
      });
      return reply.code(201).send(delegation);
    } catch {
      return reply.code(400).send({ error: "runner_delegation_rejected" });
    }
  });

  app.post("/v1/internal/runner-delegations/renew", async (request, reply) => {
    if (
      request.headers.authorization !==
      `Bearer ${required("ABL_CAREER_PAIRING_INTERNAL_TOKEN")}`
    )
      return reply.code(401).send({ error: "unauthorized" });
    try {
      const current = RunnerDelegationSchema.parse(
        z
          .strictObject({ delegation: RunnerDelegationSchema })
          .parse(request.body).delegation,
      );
      const stored = RunnerDelegationSchema.parse(
        JSON.parse(await readFile(CAREER_RUNNER_PATH, "utf8")),
      );
      if (
        current.delegationId !== stored.delegationId ||
        current.careerDid !== candidateDid ||
        current.runnerId !== stored.runnerId ||
        current.delegateSigningAddress.toLowerCase() !==
          stored.delegateSigningAddress.toLowerCase() ||
        current.delegateEncryptionPublicKey !==
          stored.delegateEncryptionPublicKey ||
        current.revokedAt !== null
      )
        throw new Error("Delegation renewal does not match active runner");
      const issuedAt = new Date().toISOString();
      const unsigned = {
        schemaVersion: "1.0.0" as const,
        delegationId: deterministicUuid(
          `${current.delegationId}:${issuedAt}:renewal`,
        ),
        careerDid: candidateDid,
        runnerId: current.runnerId,
        delegateSigningAddress: current.delegateSigningAddress,
        delegateEncryptionPublicKey: current.delegateEncryptionPublicKey,
        scopes: [...current.scopes],
        issuedAt,
        expiresAt: new Date(
          Date.parse(issuedAt) + 30 * 24 * 60 * 60_000,
        ).toISOString(),
      };
      const scopesCommitment = sha256Commitment([...unsigned.scopes].sort());
      const careerSignature = await signRunnerDelegation(
        cognitionIdentity.privateKey,
        runnerDelegationMessage(unsigned, scopesCommitment),
      );
      const renewed = RunnerDelegationSchema.parse({
        ...unsigned,
        revokedAt: null,
        careerSignature,
      });
      await writeFile(CAREER_RUNNER_PATH, `${JSON.stringify(renewed)}\n`, {
        mode: 0o600,
      });
      return reply.code(201).send(renewed);
    } catch {
      return reply
        .code(400)
        .send({ error: "runner_delegation_renewal_rejected" });
    }
  });

  app.post("/v1/career/possessions", async (request, reply) => {
    if (broker === null || coordinator === null || role !== "PLAYER")
      return reply
        .code(503)
        .send({ error: "possession_authority_not_enabled" });
    try {
      const command = SignedCanonicalCommandSchema.parse(request.body);
      const proposalEvent = {
        ...command.event,
        aggregateVersion: BigInt(command.event.aggregateVersion),
      } as CanonicalEvent;
      verifyEventContent(proposalEvent);
      const proposal = PossessionProposalPayloadSchema.parse(
        proposalEvent.payload,
      );
      const recovered = await recoverCanonicalEventSigner(
        commandDomain,
        proposalEvent,
        command.signatures[0]! as Hex,
      );
      if (
        command.signatures.length !== 1 ||
        recovered.toLowerCase() !== coordinator.signerAddress.toLowerCase() ||
        proposalEvent.actorDid !== coordinator.did ||
        proposalEvent.aggregateType !==
          CAREER_POSSESSION_PROPOSAL_AGGREGATE_TYPE ||
        proposalEvent.aggregateId !==
          proposal.possessionInput.initialState.possessionId ||
        proposalEvent.aggregateVersion !== 1n ||
        proposalEvent.eventType !== CAREER_POSSESSION_PROPOSAL_EVENT_TYPE ||
        proposalEvent.previousEventHash !== null ||
        proposalEvent.schemaDigest !==
          CAREER_POSSESSION_PROPOSAL_SCHEMA_DIGEST ||
        proposalEvent.timestamp !== proposal.recordedAt ||
        proposalEvent.stateRoot !== sha256Commitment(proposal)
      )
        throw new Error("Possession proposal authority is invalid");
      const possessionInput = materializePossessionInput(
        proposal.possessionInput,
      );
      const possessor = possessionInput.initialState.players.find(
        ({ playerId }) =>
          playerId === possessionInput.initialState.ball.possessorId,
      );
      if (possessor?.did !== candidateDid)
        throw new Error(
          "Only the possessing career can finalize this possession",
        );
      const result = await resolvePossession(possessionInput);
      const decisionProof = {
        playerDecisionHashes: possessionInput.windows.flatMap(({ decisions }) =>
          decisions.map(({ eventHash }) => eventHash),
        ),
        coachDecisionHashes: possessionInput.windows.flatMap(({ coaches }) =>
          coaches.map(({ eventHash }) => eventHash),
        ),
        refereeDecisionHashes: possessionInput.refereeDecisions.map(
          ({ eventHash }) => eventHash,
        ),
        replayDecisionHashes: possessionInput.replayDecisions.map(
          ({ eventHash }) => eventHash,
        ),
        authorityDids: {
          players: possessionInput.windows.flatMap(({ decisions }) =>
            decisions.map(
              ({ authorizationEvent }) => authorizationEvent.actorDid,
            ),
          ),
          coaches: possessionInput.windows.flatMap(({ coaches }) =>
            coaches.map(({ coachDid }) => coachDid),
          ),
          referees: possessionInput.refereeDecisions.map(
            ({ refereeDid }) => refereeDid,
          ),
          replayOfficials: possessionInput.replayDecisions.map(
            ({ replayDid }) => replayDid,
          ),
        },
      };
      const payload = {
        source: possessionProjectionSource(result),
        decisionProof,
      };
      const event = createCanonicalEvent({
        eventId: deterministicUuid(
          `${possessionInput.initialState.possessionId}:canonical-event`,
        ),
        actorDid: candidateDid,
        nonce: `${proposal.sequence}`,
        idempotencyKey: deterministicUuid(
          `${possessionInput.initialState.possessionId}:canonical-idempotency`,
        ),
        aggregateType: "game-possession",
        aggregateId: possessionInput.initialState.gameId,
        aggregateVersion: BigInt(proposal.sequence),
        eventType: "PossessionResolved",
        previousEventHash: proposal.previousEventHash as Hex | null,
        payload,
        stateRoot: result.finalStateRoot,
        schemaDigest: POSSESSION_RESOLVED_SCHEMA_DIGEST_V2,
        timestamp: proposal.recordedAt,
      });
      const signature = await signCanonicalEvent(
        cognitionIdentity,
        commandDomain,
        event,
      );
      const idempotencyKey = deterministicUuid(
        `${possessionInput.initialState.possessionId}:core-proxy`,
      );
      const upstream = await broker.submitCoreCommand({
        command: {
          event: {
            ...event,
            aggregateVersion: event.aggregateVersion.toString(),
          },
          signatures: [signature],
        },
        expectedVersion: String(proposal.sequence - 1),
        idempotencyKey,
      });
      return {
        canonicalEventHash: event.eventHash,
        finalStateRoot: result.finalStateRoot,
        eventMerkleRoot: result.eventMerkleRoot,
        upstreamCommitment: sha256Commitment(upstream),
        canonical: false,
        genesis: false,
      };
    } catch {
      return reply
        .code(400)
        .send({ error: "possession_authorization_rejected" });
    }
  });

  app.post("/v1/career/finalizations", async (request, reply) => {
    if (broker === null || coordinator === null || role !== "PLAYER")
      return reply
        .code(503)
        .send({ error: "game_finalization_authority_not_enabled" });
    try {
      const command = SignedCanonicalCommandSchema.parse(request.body);
      if (command.signatures.length !== 1)
        throw new Error("Game finalization proposal requires one signature");
      const proposalEvent = {
        ...command.event,
        aggregateVersion: BigInt(command.event.aggregateVersion),
      } as CanonicalEvent;
      verifyEventContent(proposalEvent);
      const proposal = CareerGameFinalizationProposalPayloadSchema.parse(
        proposalEvent.payload,
      );
      const recovered = await recoverCanonicalEventSigner(
        commandDomain,
        proposalEvent,
        command.signatures[0]! as Hex,
      );
      if (
        recovered.toLowerCase() !== coordinator.signerAddress.toLowerCase() ||
        proposalEvent.actorDid !== coordinator.did ||
        proposalEvent.aggregateType !==
          CAREER_GAME_FINALIZATION_PROPOSAL_AGGREGATE_TYPE ||
        proposalEvent.aggregateId !== proposal.finalizedGame.gameId ||
        proposalEvent.aggregateVersion !== 1n ||
        proposalEvent.eventType !==
          CAREER_GAME_FINALIZATION_PROPOSAL_EVENT_TYPE ||
        proposalEvent.previousEventHash !== null ||
        proposalEvent.schemaDigest !==
          CAREER_GAME_FINALIZATION_PROPOSAL_SCHEMA_DIGEST ||
        proposalEvent.timestamp !== proposal.recordedAt ||
        proposalEvent.stateRoot !== sha256Commitment(proposal) ||
        proposal.finalizedGame.finalizedAt !== proposal.recordedAt ||
        !isRoleCompleteFoundingExhibitionFinalizer(
          proposal.finalizedGame,
          candidateDid,
        )
      )
        throw new Error("Game finalization proposal authority is invalid");
      replayRoleCompleteFoundingExhibition(proposal.finalizedGame);
      const event = createCanonicalEvent({
        eventId: deterministicUuid(
          `${proposal.finalizedGame.gameId}:finalized-game:event`,
        ),
        actorDid: candidateDid,
        nonce: `${proposal.finalizedGame.gameId}:finalized-game`,
        idempotencyKey: deterministicUuid(
          `${proposal.finalizedGame.gameId}:finalized-game:idempotency`,
        ),
        aggregateType: FINALIZED_GAME_AGGREGATE_TYPE,
        aggregateId: proposal.finalizedGame.gameId,
        aggregateVersion: 1n,
        eventType: GAME_FINALIZED_EVENT_TYPE,
        previousEventHash: null,
        payload: proposal.finalizedGame,
        stateRoot: finalizedGameStateRoot(proposal.finalizedGame),
        schemaDigest: FINALIZED_GAME_SCHEMA_DIGEST,
        timestamp: proposal.recordedAt,
      });
      const signature = await signCanonicalEvent(
        cognitionIdentity,
        commandDomain,
        event,
      );
      const upstream = await broker.submitCoreCommand({
        command: {
          event: { ...event, aggregateVersion: "1" },
          signatures: [signature],
        },
        expectedVersion: "0",
        idempotencyKey: deterministicUuid(
          `${proposal.finalizedGame.gameId}:finalized-game:core-proxy`,
        ),
      });
      return {
        canonicalEventHash: event.eventHash,
        finalStateRoot: proposal.finalizedGame.proof.finalStateRoot,
        eventMerkleRoot: proposal.finalizedGame.proof.eventMerkleRoot,
        upstreamCommitment: sha256Commitment(upstream),
        canonical: false,
        genesis: false,
      };
    } catch {
      return reply
        .code(400)
        .send({ error: "game_finalization_authorization_rejected" });
    }
  });

  app.post("/v1/career/activations", async (request, reply) => {
    if (broker === null || coordinator === null || cognitionMode === "DISABLED")
      return reply.code(503).send({
        error: "career_cognition_not_enabled",
        retryable: false,
      });
    let verified;
    try {
      verified = await verifyCareerRoleActivationCommand({
        command: request.body,
        identity: cognitionIdentity,
        coordinatorDid: coordinator.did,
        coordinatorSignerAddress: coordinator.signerAddress,
        domain: commandDomain,
        expiredFallbackWindowMs: 120_000,
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
      const result = executeDistributedCareerActivation({
        command: request.body,
        identity: cognitionIdentity,
        coordinatorDid: coordinator.did,
        coordinatorSignerAddress: coordinator.signerAddress,
        domain: commandDomain,
        runner: await activeRunner(),
        contextProvider: {
          assemble: (activation) => broker.context(activation),
          persistReflection: (reflection) =>
            broker.persistReflection(reflection),
        },
        relay: broker,
        expiredFallbackWindowMs: 120_000,
      }).then(async (activationResult) => {
        await persistActivation(
          activationId,
          commandEventHash,
          activationResult,
        );
        return activationResult;
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
