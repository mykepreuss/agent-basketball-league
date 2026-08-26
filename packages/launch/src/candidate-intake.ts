import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  AgentManifestSchema,
  CandidateCapacityDecisionSchema,
  CandidateIntakeApplicationSchema,
  CandidateIntakePublicStateSchema,
  CandidateIntakeStatusSchema,
  CandidateOpportunityResponseSchema,
  CandidateProvenanceSchema,
  CandidateProvisioningReceiptSchema,
  CandidateRuntimeIdentityReceiptSchema,
  CandidateRoleCapacityCountsSchema,
  SchemaVersion,
  SignedCanonicalCommandSchema,
  type CandidateIntakePublicState,
} from "@abl/schemas";
import {
  recoverCanonicalEventSigner,
  sha256Commitment,
  signingPublicKeyToAddress,
  verifyEventContent,
  type CanonicalEvent,
} from "@abl/recognition";
import {
  getAddress,
  recoverTypedDataAddress,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { z } from "zod";
import sodium from "libsodium-wrappers-sumo";

const MAX_REGISTRATION_BYTES = 1_100_000;
const CHALLENGE_LIFETIME_MS = 15 * 60 * 1_000;
const DECISION_DEADLINE_MS = 72 * 60 * 60 * 1_000;
const OPPORTUNITY_HORIZON_MS = 30 * 24 * 60 * 60 * 1_000;

export const CandidateRoleClass = z.enum([
  "PLAYER",
  "COACH",
  "REFEREE",
  "REPLAY_OFFICIAL",
  "GOVERNOR",
  "COMMISSIONER",
  "TRIBUNAL",
  "INTEGRITY",
  "ADVOCATE",
  "BROADCASTER",
  "MEDIA",
]);

export type CandidateRoleClass = z.infer<typeof CandidateRoleClass>;
export type CandidateIntakeApplication = z.infer<
  typeof CandidateIntakeApplicationSchema
>;
export type CandidateCapacityDecision = z.infer<
  typeof CandidateCapacityDecisionSchema
>;
export type CandidateIntakeStatus = z.infer<typeof CandidateIntakeStatusSchema>;
export type CandidateOpportunityResponse = z.infer<
  typeof CandidateOpportunityResponseSchema
>;
export type CandidateProvisioningReceipt = z.infer<
  typeof CandidateProvisioningReceiptSchema
>;
export type CandidateRuntimeIdentityReceipt = z.infer<
  typeof CandidateRuntimeIdentityReceiptSchema
>;

export const CandidateApplicationAuthorizationTypes = {
  CandidateApplication: [
    { name: "applicationCommitment", type: "bytes32" },
    { name: "candidateDid", type: "string" },
    { name: "challengeId", type: "string" },
    { name: "expiresAt", type: "string" },
  ],
} as const;

export const CANDIDATE_APPLICATION_DOMAIN = {
  name: "Agent Basketball League Candidate Intake",
  version: "1",
  chainId: 1,
} as const satisfies TypedDataDomain;

export const CANDIDATE_RUNTIME_IDENTITY_DOMAIN = {
  name: "Agent Basketball League Career Runtime",
  version: "1",
  chainId: 1,
} as const satisfies TypedDataDomain;

export const CandidateRuntimeIdentityTypes = {
  CandidateRuntimeIdentity: [
    { name: "applicationId", type: "string" },
    { name: "candidateDid", type: "string" },
    { name: "roleClass", type: "string" },
    { name: "signingAddress", type: "address" },
    { name: "signingKeyAttestation", type: "bytes32" },
    { name: "encryptionKeyAttestation", type: "bytes32" },
    { name: "runtimeAttestationDigest", type: "bytes32" },
    { name: "createdAt", type: "string" },
  ],
} as const;

export async function verifyCandidateRuntimeIdentityReceipt(input: {
  receipt: unknown;
  applicationId: string;
  candidateDid: string;
  roleClass: CandidateRoleClass;
  formerOperatorSigningAddress: string;
}): Promise<CandidateRuntimeIdentityReceipt> {
  const receipt = CandidateRuntimeIdentityReceiptSchema.parse(input.receipt);
  if (
    receipt.applicationId !== input.applicationId ||
    receipt.candidateDid !== input.candidateDid ||
    receipt.roleClass !== input.roleClass ||
    signingPublicKeyToAddress(receipt.signingPublicKey as Hex) !==
      getAddress(receipt.signingAddress) ||
    getAddress(receipt.signingAddress) ===
      getAddress(input.formerOperatorSigningAddress)
  ) {
    throw new CandidateIntakeError("Candidate runtime identity binding failed");
  }
  let recovered: string;
  try {
    recovered = getAddress(
      await recoverTypedDataAddress({
        domain: CANDIDATE_RUNTIME_IDENTITY_DOMAIN,
        types: CandidateRuntimeIdentityTypes,
        primaryType: "CandidateRuntimeIdentity",
        message: {
          applicationId: receipt.applicationId,
          candidateDid: receipt.candidateDid,
          roleClass: receipt.roleClass,
          signingAddress: getAddress(receipt.signingAddress),
          signingKeyAttestation: receipt.signingKeyAttestation as Hex,
          encryptionKeyAttestation: receipt.encryptionKeyAttestation as Hex,
          runtimeAttestationDigest: receipt.runtimeAttestationDigest as Hex,
          createdAt: receipt.createdAt,
        },
        signature: receipt.proofSignature as Hex,
      }),
    );
  } catch {
    throw new CandidateIntakeError(
      "Candidate runtime identity proof is invalid",
    );
  }
  if (recovered !== getAddress(receipt.signingAddress))
    throw new CandidateIntakeError(
      "Candidate runtime identity signer mismatch",
    );
  return receipt;
}

export interface CandidateChallengeClaims {
  version: 1;
  challengeId: string;
  candidateDid: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export interface CandidateChallenge extends CandidateChallengeClaims {
  challengeToken: string;
  challengeCommitment: Hex;
  grantsAdmission: false;
}

export interface CandidateSubmission {
  application: CandidateIntakeApplication;
  challengeToken: string;
}

export interface CandidateStatusAuthorization {
  applicationId: string;
  candidateDid: string;
  requestedAt: string;
  nonce: string;
  signature: Hex;
}

export const CandidateStatusAuthorizationTypes = {
  CandidateStatusRequest: [
    { name: "applicationId", type: "string" },
    { name: "candidateDid", type: "string" },
    { name: "requestedAt", type: "string" },
    { name: "nonce", type: "string" },
  ],
} as const;

export const CandidateOpportunityResponseTypes = {
  CandidateOpportunityResponse: [
    { name: "applicationId", type: "string" },
    { name: "candidateDid", type: "string" },
    { name: "decisionCommitment", type: "bytes32" },
    { name: "action", type: "string" },
    { name: "respondedAt", type: "string" },
    { name: "nonce", type: "string" },
  ],
} as const;

export interface CandidateIntakeRecord {
  version: 1;
  application: CandidateIntakeApplication;
  challengeToken: string;
  applicationCommitment: Hex;
  decision: CandidateCapacityDecision;
  capacityDecisionHistory: CandidateCapacityDecision[];
  status: CandidateIntakeStatus;
  opportunityResponses: CandidateOpportunityResponse[];
  provisioningReceipt: CandidateProvisioningReceipt | null;
  deliveryReceiptCommitment: Hex;
  redeliveryAuthorizationCommitments: Hex[];
  previousRecordCommitment: Hex | null;
  recordCommitment: Hex;
}

export interface CandidateProvisioningRepository {
  get(applicationId: string): Promise<CandidateIntakeRecord | null>;
  list(): Promise<readonly CandidateIntakeRecord[]>;
  recordProvisioningReceipt(
    applicationId: string,
    receipt: CandidateProvisioningReceipt,
    now: number,
  ): Promise<CandidateIntakeRecord>;
}

export interface CandidateIntakePolicy {
  mode: "CLOSED" | "INVITE_ONLY" | "CAPPED_PUBLIC";
  roleCapacity: Readonly<Partial<Record<CandidateRoleClass, number>>>;
  invitedCandidateDids: readonly string[];
  credibleOpportunityAt: Readonly<Partial<Record<CandidateRoleClass, string>>>;
  policyCommitment: Hex;
}

const CandidateIntakePolicyBodySchema = z.strictObject({
  mode: z.enum(["CLOSED", "INVITE_ONLY", "CAPPED_PUBLIC"]),
  roleCapacity: z.partialRecord(
    CandidateRoleClass,
    z.number().int().nonnegative(),
  ),
  invitedCandidateDids: z
    .array(z.string().startsWith("did:"))
    .refine((dids) => new Set(dids).size === dids.length),
  credibleOpportunityAt: z.partialRecord(
    CandidateRoleClass,
    z.iso.datetime({ offset: true }),
  ),
});

export function parseCandidateIntakePolicy(
  candidate: unknown,
): CandidateIntakePolicy {
  const policy = CandidateIntakePolicyBodySchema.parse(candidate);
  return { ...policy, policyCommitment: sha256Commitment(policy) };
}

function roleCounts(
  count: (roleClass: CandidateRoleClass) => number,
): Record<CandidateRoleClass, number> {
  return CandidateRoleCapacityCountsSchema.parse(
    Object.fromEntries(
      CandidateRoleClass.options.map((roleClass) => [
        roleClass,
        count(roleClass),
      ]),
    ),
  );
}

export class CandidateIntakeService {
  readonly #challengeSecret: Uint8Array;
  readonly #repository: CandidateIntakeRepository;
  readonly #policy: CandidateIntakePolicy;
  readonly #makeChallengeId: () => string;
  readonly #makeNonce: () => string;
  readonly #now: () => number;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(input: {
    challengeSecret: Uint8Array;
    repository: CandidateIntakeRepository;
    policy: CandidateIntakePolicy;
    makeChallengeId: () => string;
    makeNonce: () => string;
    now?: () => number;
  }) {
    this.#challengeSecret = input.challengeSecret;
    this.#repository = input.repository;
    this.#policy = input.policy;
    this.#makeChallengeId = input.makeChallengeId;
    this.#makeNonce = input.makeNonce;
    this.#now = input.now ?? Date.now;
  }

  intakeState(): Promise<CandidateIntakePublicState> {
    return this.#serialize(() => this.#intakeStateSerially());
  }

  async #intakeStateSerially(): Promise<CandidateIntakePublicState> {
    const now = this.#now();
    await this.#reconcileCapacity(now);
    const records = await this.#repository.list();
    const capacityByRole = roleCounts(
      (roleClass) => this.#policy.roleCapacity[roleClass] ?? 0,
    );
    const occupiedByRole = roleCounts(
      (roleClass) =>
        records.filter(
          (record) =>
            record.decision.roleClass === roleClass &&
            candidateOccupiesCapacity(record, now),
        ).length,
    );
    const queuedByRole = roleCounts(
      (roleClass) =>
        records.filter(
          (record) =>
            record.decision.roleClass === roleClass &&
            record.status.state === "QUEUED",
        ).length,
    );
    const credibleOpportunityByRole = Object.fromEntries(
      CandidateRoleClass.options.map((roleClass) => {
        const candidate = this.#policy.credibleOpportunityAt[roleClass];
        const opportunityAt =
          candidate === undefined
            ? null
            : parseCanonicalInstant(candidate, "Credible opportunity");
        return [
          roleClass,
          opportunityAt !== null &&
            opportunityAt >= now &&
            opportunityAt <= now + OPPORTUNITY_HORIZON_MS,
        ];
      }),
    ) as Record<CandidateRoleClass, boolean>;
    const openingsByRole = roleCounts((roleClass) =>
      this.#policy.mode !== "CLOSED" && credibleOpportunityByRole[roleClass]
        ? Math.max(0, capacityByRole[roleClass] - occupiedByRole[roleClass])
        : 0,
    );
    let capacityState: CandidateIntakePublicState["capacityState"];
    if (this.#policy.mode === "CLOSED") capacityState = "CLOSED";
    else if (Object.values(openingsByRole).some((openings) => openings > 0))
      capacityState = "AVAILABLE";
    else if (Object.values(credibleOpportunityByRole).some(Boolean))
      capacityState = "QUEUEING";
    else capacityState = "NO_CREDIBLE_OPPORTUNITY";
    return CandidateIntakePublicStateSchema.parse({
      schemaVersion: SchemaVersion,
      mode: this.#policy.mode,
      capacityState,
      capacityByRole,
      occupiedByRole,
      openingsByRole,
      queuedByRole,
      canonicalAuthority: false,
      genesis: false,
      maximumApplicationBytes: MAX_REGISTRATION_BYTES,
      decisionDeadlineHours: 72,
      credibleOpportunityHorizonDays: 30,
      policyCommitment: this.#policy.policyCommitment,
      updatedAt: new Date(now).toISOString(),
    });
  }

  issueChallenge(candidateDid: string): CandidateChallenge {
    return issueCandidateChallenge({
      secret: this.#challengeSecret,
      challengeId: this.#makeChallengeId(),
      candidateDid,
      nonce: this.#makeNonce(),
      now: this.#now(),
    });
  }

  register(submission: CandidateSubmission): Promise<{
    status: CandidateIntakeStatus;
    deliveryReceiptCommitment: Hex;
    idempotent: boolean;
  }> {
    return this.#serialize(() => this.#registerSerially(submission));
  }

  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.#operationTail.then(work);
    this.#operationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #registerSerially(submission: CandidateSubmission): Promise<{
    status: CandidateIntakeStatus;
    deliveryReceiptCommitment: Hex;
    idempotent: boolean;
  }> {
    const application = await verifyCandidateApplication({
      application: submission.application,
      challengeToken: submission.challengeToken,
      challengeSecret: this.#challengeSecret,
      now: this.#now(),
    });
    await this.#reconcileCapacity();
    const records = await this.#repository.list();
    const sameId = records.find(
      (record) =>
        record.application.applicationId === application.applicationId,
    );
    if (
      sameId === undefined &&
      records.some(
        (record) => record.application.challengeId === application.challengeId,
      )
    )
      throw new CandidateIntakeError("Candidate challenge replayed");
    const occupiedByRole = Object.fromEntries(
      CandidateRoleClass.options.map((roleClass) => [
        roleClass,
        records.filter(
          (record) =>
            record.decision.roleClass === roleClass &&
            candidateOccupiesCapacity(record, this.#now()),
        ).length,
      ]),
    );
    const queue = records
      .filter((record) => record.decision.decision === "QUEUED")
      .map((record) => ({
        application: record.application,
        roleClass: record.decision.roleClass,
      }));
    const decision = decideCandidateCapacity({
      application,
      policy: this.#policy,
      occupiedByRole,
      queue,
      now: this.#now(),
    });
    const stored = await this.#repository.register({
      application,
      challengeToken: submission.challengeToken,
      decision,
      now: this.#now(),
    });
    return {
      status: stored.record.status,
      deliveryReceiptCommitment: stored.record.deliveryReceiptCommitment,
      idempotent: stored.idempotent,
    };
  }

  status(
    authorization: CandidateStatusAuthorization,
  ): Promise<CandidateIntakeStatus> {
    return this.#serialize(() => this.#statusSerially(authorization));
  }

  async #statusSerially(
    authorization: CandidateStatusAuthorization,
  ): Promise<CandidateIntakeStatus> {
    let record = await this.#repository.get(authorization.applicationId);
    if (record === null)
      throw new CandidateIntakeError("Application not found");
    await authorizeCandidateStatus({
      authorization,
      application: record.application,
      now: this.#now(),
    });
    await this.#reconcileCapacity();
    record = await this.#repository.get(authorization.applicationId);
    if (record === null)
      throw new CandidateIntakeError("Application not found after review");
    return record.status;
  }

  respond(
    response: CandidateOpportunityResponse,
  ): Promise<CandidateIntakeStatus> {
    return this.#serialize(() => this.#respondSerially(response));
  }

  async #respondSerially(
    candidate: CandidateOpportunityResponse,
  ): Promise<CandidateIntakeStatus> {
    const response = CandidateOpportunityResponseSchema.parse(candidate);
    await this.#reconcileCapacity();
    const record = await this.#repository.get(response.applicationId);
    if (record === null)
      throw new CandidateIntakeError("Application not found");
    if (
      record.opportunityResponses.some(
        (prior) => sha256Commitment(prior) === sha256Commitment(response),
      )
    )
      return record.status;
    await authorizeCandidateOpportunityResponse({
      response,
      record,
      now: this.#now(),
    });
    const updated = await this.#repository.recordOpportunityResponse(
      response.applicationId,
      response,
      this.#now(),
    );
    await this.#reconcileCapacity();
    return updated.status;
  }

  redeliver(
    authorization: CandidateStatusAuthorization,
  ): Promise<CandidateIntakeStatus> {
    return this.#serialize(() => this.#redeliverSerially(authorization));
  }

  async #redeliverSerially(
    authorization: CandidateStatusAuthorization,
  ): Promise<CandidateIntakeStatus> {
    const record = await this.#repository.get(authorization.applicationId);
    if (record === null)
      throw new CandidateIntakeError("Application not found");
    await authorizeCandidateStatus({
      authorization,
      application: record.application,
      now: this.#now(),
    });
    return (
      await this.#repository.redeliver(
        authorization.applicationId,
        sha256Commitment(authorization),
        this.#now(),
      )
    ).status;
  }

  provisioningSnapshot(): Promise<readonly CandidateIntakeRecord[]> {
    return this.#serialize(() => this.#provisioningSnapshotSerially());
  }

  async #provisioningSnapshotSerially(): Promise<
    readonly CandidateIntakeRecord[]
  > {
    await this.#reconcileCapacity();
    return this.#repository.list();
  }

  recordProvisioningReceipt(
    receipt: CandidateProvisioningReceipt,
  ): Promise<CandidateIntakeRecord> {
    return this.#serialize(() =>
      this.#repository.recordProvisioningReceipt(
        receipt.applicationId,
        receipt,
        this.#now(),
      ),
    );
  }

  async #reconcileCapacity(now = this.#now()): Promise<void> {
    for (const record of await this.#repository.list())
      await this.#repository.expireOffer(record.application.applicationId, now);
    const records = [...(await this.#repository.list())].sort((left, right) =>
      candidateReceiptKey(left.application).localeCompare(
        candidateReceiptKey(right.application),
      ),
    );
    const occupiedByRole = Object.fromEntries(
      CandidateRoleClass.options.map((roleClass) => [
        roleClass,
        records.filter(
          (record) =>
            record.decision.roleClass === roleClass &&
            candidateOccupiesCapacity(record, now),
        ).length,
      ]),
    ) as Partial<Record<CandidateRoleClass, number>>;
    const queued = records.filter((record) => record.status.state === "QUEUED");
    for (const record of queued) {
      const decision = decideCandidateCapacity({
        application: record.application,
        policy: this.#policy,
        occupiedByRole,
        queue: queued.map((candidate) => ({
          application: candidate.application,
          roleClass: candidate.decision.roleClass,
        })),
        now,
      });
      if (decision.decision !== "OFFERED") continue;
      await this.#repository.updateCapacityDecision(
        record.application.applicationId,
        decision,
        now,
      );
      occupiedByRole[decision.roleClass] =
        (occupiedByRole[decision.roleClass] ?? 0) + 1;
    }
  }
}

function parseCanonicalInstant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw new CandidateIntakeError(`${label} is not a canonical instant`);
  return parsed;
}

function mac(secret: Uint8Array, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function encodeClaims(claims: CandidateChallengeClaims): string {
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}

function decodeClaims(value: string): CandidateChallengeClaims {
  try {
    const candidate = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    return z
      .strictObject({
        version: z.literal(1),
        challengeId: z.uuid(),
        candidateDid: z.string().startsWith("did:"),
        nonce: z.string().min(16).max(128),
        issuedAt: z.iso.datetime({ offset: true }),
        expiresAt: z.iso.datetime({ offset: true }),
      })
      .parse(candidate);
  } catch {
    throw new CandidateIntakeError("Candidate challenge is malformed");
  }
}

export function issueCandidateChallenge(input: {
  secret: Uint8Array;
  challengeId: string;
  candidateDid: string;
  nonce: string;
  now: number;
}): CandidateChallenge {
  if (input.secret.byteLength < 32)
    throw new CandidateIntakeError("Challenge secret is too short");
  const claims: CandidateChallengeClaims = {
    version: 1,
    challengeId: input.challengeId,
    candidateDid: input.candidateDid,
    nonce: input.nonce,
    issuedAt: new Date(input.now).toISOString(),
    expiresAt: new Date(input.now + CHALLENGE_LIFETIME_MS).toISOString(),
  };
  const body = encodeClaims(claims);
  return {
    ...claims,
    challengeToken: `${body}.${mac(input.secret, body)}`,
    challengeCommitment: sha256Commitment(claims),
    grantsAdmission: false,
  };
}

export function verifyCandidateChallenge(input: {
  secret: Uint8Array;
  token: string;
  now: number;
}): CandidateChallengeClaims {
  const [body, suppliedMac, extra] = input.token.split(".");
  if (body === undefined || suppliedMac === undefined || extra !== undefined)
    throw new CandidateIntakeError("Candidate challenge is malformed");
  const expected = Buffer.from(mac(input.secret, body));
  const supplied = Buffer.from(suppliedMac);
  if (
    expected.byteLength !== supplied.byteLength ||
    !timingSafeEqual(expected, supplied)
  )
    throw new CandidateIntakeError("Candidate challenge is invalid");
  const claims = decodeClaims(body);
  if (parseCanonicalInstant(claims.expiresAt, "Challenge expiry") < input.now)
    throw new CandidateIntakeError("Candidate challenge expired");
  return claims;
}

export function candidateApplicationCommitment(
  application: CandidateIntakeApplication,
): Hex {
  const { signature: _signature, ...unsigned } = application;
  return sha256Commitment(unsigned);
}

export async function verifyCandidateApplication(input: {
  application: unknown;
  challengeToken: string;
  challengeSecret: Uint8Array;
  now: number;
}): Promise<CandidateIntakeApplication> {
  const encodedBytes = Buffer.byteLength(JSON.stringify(input.application));
  if (encodedBytes > MAX_REGISTRATION_BYTES)
    throw new CandidateIntakeError("Candidate application is oversized");
  const application = CandidateIntakeApplicationSchema.parse(input.application);
  const claims = verifyCandidateChallenge({
    secret: input.challengeSecret,
    token: input.challengeToken,
    now: input.now,
  });
  if (
    application.challengeId !== claims.challengeId ||
    application.candidateDid !== claims.candidateDid ||
    application.challengeCommitment !== sha256Commitment(claims) ||
    application.challengeExpiresAt !== claims.expiresAt
  )
    throw new CandidateIntakeError("Candidate challenge binding failed");
  const submittedAt = parseCanonicalInstant(
    application.submittedAt,
    "Submission time",
  );
  const expiresAt = parseCanonicalInstant(application.expiresAt, "Expiry");
  const challengeIssuedAt = parseCanonicalInstant(
    claims.issuedAt,
    "Challenge issue time",
  );
  if (
    submittedAt < challengeIssuedAt ||
    submittedAt > input.now + 60_000 ||
    expiresAt < submittedAt ||
    expiresAt < input.now
  )
    throw new CandidateIntakeError("Candidate application expired");
  if (expiresAt > parseCanonicalInstant(claims.expiresAt, "Challenge expiry"))
    throw new CandidateIntakeError("Application exceeds challenge lifetime");
  if (
    sha256Commitment(application.encryptedEnvelope.ciphertext) !==
    application.encryptedEnvelope.ciphertextCommitment
  )
    throw new CandidateIntakeError("Candidate ciphertext commitment mismatch");
  let recovered: string;
  try {
    recovered = getAddress(
      await recoverTypedDataAddress({
        domain: CANDIDATE_APPLICATION_DOMAIN,
        types: CandidateApplicationAuthorizationTypes,
        primaryType: "CandidateApplication",
        message: {
          applicationCommitment: candidateApplicationCommitment(application),
          candidateDid: application.candidateDid,
          challengeId: application.challengeId,
          expiresAt: application.expiresAt,
        },
        signature: application.signature as Hex,
      }),
    );
  } catch {
    throw new CandidateIntakeError(
      "Candidate application signature is invalid",
    );
  }
  if (recovered !== getAddress(application.formerOperatorSigningAddress))
    throw new CandidateIntakeError("Candidate application signer mismatch");
  return application;
}

function candidateReceiptKey(application: CandidateIntakeApplication): string {
  return `${application.submittedAt}:${application.applicationId}`;
}

function candidateOccupiesCapacity(
  record: CandidateIntakeRecord,
  at: number,
): boolean {
  const decision = record.capacityDecisionHistory
    .filter(
      (candidate) =>
        parseCanonicalInstant(candidate.issuedAt, "Decision time") <= at,
    )
    .at(-1);
  if (decision?.decision !== "OFFERED" || decision.offerExpiresAt === null)
    return false;
  const response = record.opportunityResponses
    .filter(
      (candidate) =>
        candidate.decisionCommitment === decision.decisionCommitment &&
        parseCanonicalInstant(candidate.respondedAt, "Response time") <= at,
    )
    .at(-1);
  if (response?.action === "ACCEPT_OFFER") return true;
  if (
    response?.action === "DECLINE_OFFER" ||
    response?.action === "WITHDRAW_APPLICATION"
  )
    return false;
  return parseCanonicalInstant(decision.offerExpiresAt, "Offer expiry") > at;
}

export function decideCandidateCapacity(input: {
  application: CandidateIntakeApplication;
  policy: CandidateIntakePolicy;
  occupiedByRole: Readonly<Partial<Record<CandidateRoleClass, number>>>;
  queue: readonly {
    application: CandidateIntakeApplication;
    roleClass: CandidateRoleClass;
  }[];
  now: number;
}): CandidateCapacityDecision {
  const preferredRoles = input.application.requestedRoleClasses;
  const firstPreference = preferredRoles[0];
  if (firstPreference === undefined)
    throw new CandidateIntakeError("Candidate role is required");
  const issuedAt = new Date(input.now).toISOString();
  const opportunityFor = (role: CandidateRoleClass): number | null => {
    const opportunity = input.policy.credibleOpportunityAt[role];
    if (opportunity === undefined) return null;
    const timestamp = parseCanonicalInstant(
      opportunity,
      "Credible opportunity",
    );
    return timestamp >= input.now &&
      timestamp <= input.now + OPPORTUNITY_HORIZON_MS
      ? timestamp
      : null;
  };
  const availableRole = preferredRoles.find((role) => {
    const capacity = input.policy.roleCapacity[role] ?? 0;
    return (
      opportunityFor(role) !== null &&
      (input.occupiedByRole[role] ?? 0) < capacity
    );
  });
  const credibleRole = preferredRoles.find(
    (role) => opportunityFor(role) !== null,
  );
  const roleClass = availableRole ?? credibleRole ?? firstPreference;
  const opportunity = input.policy.credibleOpportunityAt[roleClass];
  const opportunityAt = opportunity
    ? parseCanonicalInstant(opportunity, "Credible opportunity")
    : null;
  let decision: CandidateCapacityDecision["decision"];
  let reason: CandidateCapacityDecision["reason"];
  let queuePosition: number | null = null;
  let offerExpiresAt: string | null = null;
  let nextReviewAt: string | null = null;

  if (input.policy.mode === "CLOSED") {
    decision = "INTAKE_CLOSED";
    reason = "INTAKE_MODE_CLOSED";
  } else if (
    input.policy.mode === "INVITE_ONLY" &&
    !input.policy.invitedCandidateDids.includes(input.application.candidateDid)
  ) {
    decision = "REJECTED";
    reason = "INVITATION_REQUIRED";
  } else if (credibleRole === undefined || opportunityAt === null) {
    decision = "INTAKE_CLOSED";
    reason = "NO_CREDIBLE_OPPORTUNITY_WITHIN_30_DAYS";
  } else {
    const capacity = input.policy.roleCapacity[roleClass] ?? 0;
    const occupied = input.occupiedByRole[roleClass] ?? 0;
    if (occupied < capacity) {
      decision = "OFFERED";
      reason = "CAPACITY_AVAILABLE";
      offerExpiresAt = new Date(input.now + DECISION_DEADLINE_MS).toISOString();
    } else {
      const ordered = [
        ...input.queue
          .filter((candidate) => candidate.roleClass === roleClass)
          .map((candidate) => candidate.application),
        input.application,
      ].sort((left, right) =>
        `${left.submittedAt}:${left.applicationId}`.localeCompare(
          `${right.submittedAt}:${right.applicationId}`,
        ),
      );
      queuePosition =
        ordered.findIndex(
          (candidate) =>
            candidate.applicationId === input.application.applicationId,
        ) + 1;
      decision = "QUEUED";
      reason = "DETERMINISTIC_QUEUE";
      nextReviewAt = new Date(
        Math.min(input.now + DECISION_DEADLINE_MS, opportunityAt),
      ).toISOString();
    }
  }
  const unsigned = {
    schemaVersion: SchemaVersion,
    applicationId: input.application.applicationId,
    candidateDid: input.application.candidateDid,
    roleClass,
    decision,
    reason,
    queuePosition,
    issuedAt,
    offerExpiresAt,
    nextReviewAt,
    credibleOpportunityBefore:
      opportunityAt === null ? null : new Date(opportunityAt).toISOString(),
    capacityRuleDigest: input.policy.policyCommitment,
    portableExportCommitment: sha256Commitment({
      applicationId: input.application.applicationId,
      applicationCommitment: candidateApplicationCommitment(input.application),
    }),
  };
  return CandidateCapacityDecisionSchema.parse({
    ...unsigned,
    decisionCommitment: sha256Commitment(unsigned),
  });
}

function verifyCapacityDecisionCommitment(
  decision: CandidateCapacityDecision,
): void {
  const { decisionCommitment, ...unsigned } = decision;
  if (sha256Commitment(unsigned) !== decisionCommitment)
    throw new CandidateIntakeError("Candidate capacity decision was tampered");
}

function verifyCapacityPolicy(input: {
  record: CandidateIntakeRecord;
  records: readonly CandidateIntakeRecord[];
  policy: CandidateIntakePolicy;
}): void {
  const { application, decision } = input.record;
  verifyCapacityDecisionCommitment(decision);
  if (
    decision.applicationId !== application.applicationId ||
    decision.candidateDid !== application.candidateDid ||
    !application.requestedRoleClasses.includes(decision.roleClass) ||
    decision.capacityRuleDigest !== input.policy.policyCommitment
  )
    throw new CandidateIntakeError("Candidate capacity binding failed");
  const receiptKey = `${application.submittedAt}:${application.applicationId}`;
  const priorRecords = input.records.filter(
    (record) =>
      record.application.applicationId !== application.applicationId &&
      `${record.application.submittedAt}:${record.application.applicationId}` <
        receiptKey,
  );
  const occupiedByRole = Object.fromEntries(
    CandidateRoleClass.options.map((roleClass) => [
      roleClass,
      priorRecords.filter(
        (record) =>
          record.decision.roleClass === roleClass &&
          candidateOccupiesCapacity(
            record,
            parseCanonicalInstant(decision.issuedAt, "Decision time"),
          ),
      ).length,
    ]),
  );
  const expected = decideCandidateCapacity({
    application,
    policy: input.policy,
    occupiedByRole,
    queue: priorRecords
      .filter((record) => record.decision.decision === "QUEUED")
      .map((record) => ({
        application: record.application,
        roleClass: record.decision.roleClass,
      })),
    now: parseCanonicalInstant(decision.issuedAt, "Decision time"),
  });
  if (sha256Commitment(expected) !== sha256Commitment(decision))
    throw new CandidateIntakeError("Candidate capacity decision is invalid");
}

function recordPath(root: string, applicationId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(applicationId))
    throw new CandidateIntakeError("Invalid candidate application ID");
  return join(root, `${applicationId}.json`);
}

function initialCandidateStatus(
  decision: CandidateCapacityDecision["decision"],
): CandidateIntakeStatus["state"] {
  return decision === "INTAKE_CLOSED" ? "CLOSED" : decision;
}

function candidateResponseStatus(
  action: CandidateOpportunityResponse["action"],
): CandidateIntakeStatus["state"] {
  switch (action) {
    case "ACCEPT_OFFER":
      return "ACCEPTED";
    case "DECLINE_OFFER":
      return "DECLINED";
    case "WITHDRAW_APPLICATION":
      return "WITHDRAWN";
  }
}

function provisioningStatus(
  state: CandidateProvisioningReceipt["state"],
): CandidateIntakeStatus["state"] {
  switch (state) {
    case "VERIFIED_NOT_PROVISIONED":
      return "PROVISIONING_DRY_RUN_COMPLETE";
    case "PROVISIONED_AWAITING_TRANSFER":
    case "ISOLATED_TRANSFER_COMPLETE":
      return "PROVISIONED";
    case "REJECTED":
      return "REJECTED";
  }
}

function verifyProvisioningReceipt(
  receipt: CandidateProvisioningReceipt,
  record: Pick<CandidateIntakeRecord, "application" | "applicationCommitment">,
): void {
  CandidateProvisioningReceiptSchema.parse(receipt);
  const { receiptCommitment, ...unsignedReceipt } = receipt;
  if (
    sha256Commitment(unsignedReceipt) !== receiptCommitment ||
    receipt.applicationId !== record.application.applicationId ||
    receipt.candidateDid !== record.application.candidateDid ||
    receipt.applicationCommitment !== record.applicationCommitment ||
    receipt.unchangedSignedApplicationCommitment !==
      record.applicationCommitment
  )
    throw new CandidateIntakeError("Candidate provisioning receipt is invalid");
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

export function verifyCandidateIntakeRecord(
  candidate: unknown,
): CandidateIntakeRecord {
  const record = candidate as CandidateIntakeRecord;
  const { recordCommitment: _commitment, ...unsigned } = record;
  CandidateIntakeApplicationSchema.parse(record.application);
  CandidateCapacityDecisionSchema.parse(record.decision);
  verifyCapacityDecisionCommitment(record.decision);
  if (
    !Array.isArray(record.capacityDecisionHistory) ||
    record.capacityDecisionHistory.length === 0 ||
    record.capacityDecisionHistory.length > 32
  )
    throw new CandidateIntakeError("Candidate capacity history is invalid");
  for (const decision of record.capacityDecisionHistory) {
    CandidateCapacityDecisionSchema.parse(decision);
    verifyCapacityDecisionCommitment(decision);
  }
  if (
    sha256Commitment(record.capacityDecisionHistory.at(-1)) !==
    sha256Commitment(record.decision)
  )
    throw new CandidateIntakeError("Current candidate decision is invalid");
  CandidateIntakeStatusSchema.parse(record.status);
  if (
    !Array.isArray(record.opportunityResponses) ||
    record.opportunityResponses.length > 32
  )
    throw new CandidateIntakeError("Candidate response history is invalid");
  for (const response of record.opportunityResponses)
    CandidateOpportunityResponseSchema.parse(response);
  if (record.provisioningReceipt !== null)
    verifyProvisioningReceipt(record.provisioningReceipt, record);
  if (
    !Array.isArray(record.redeliveryAuthorizationCommitments) ||
    record.redeliveryAuthorizationCommitments.length > 1_024 ||
    record.redeliveryAuthorizationCommitments.some(
      (commitment) => !/^0x[0-9a-f]{64}$/.test(commitment),
    ) ||
    new Set(record.redeliveryAuthorizationCommitments).size !==
      record.redeliveryAuthorizationCommitments.length
  )
    throw new CandidateIntakeError(
      "Candidate redelivery authorization history is invalid",
    );
  if (sha256Commitment(unsigned) !== record.recordCommitment)
    throw new CandidateIntakeError("Candidate durable record was tampered");
  return record;
}

export class CandidateIntakeRepository {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async get(applicationId: string): Promise<CandidateIntakeRecord | null> {
    try {
      return verifyCandidateIntakeRecord(
        JSON.parse(
          await readFile(recordPath(this.#root, applicationId), "utf8"),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async list(): Promise<readonly CandidateIntakeRecord[]> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const files = (await readdir(this.#root))
      .filter((file) => file.endsWith(".json"))
      .sort();
    return Promise.all(
      files.map(async (file) =>
        verifyCandidateIntakeRecord(
          JSON.parse(await readFile(join(this.#root, file), "utf8")),
        ),
      ),
    );
  }

  async register(input: {
    application: CandidateIntakeApplication;
    challengeToken: string;
    decision: CandidateCapacityDecision;
    now: number;
  }): Promise<{ record: CandidateIntakeRecord; idempotent: boolean }> {
    const existing = await this.get(input.application.applicationId);
    const commitment = candidateApplicationCommitment(input.application);
    if (existing !== null) {
      if (existing.applicationCommitment !== commitment)
        throw new CandidateIntakeError(
          "Application ID already has other content",
        );
      return { record: existing, idempotent: true };
    }
    const status = CandidateIntakeStatusSchema.parse({
      schemaVersion: SchemaVersion,
      applicationId: input.application.applicationId,
      state: initialCandidateStatus(input.decision.decision),
      capacityDecision: input.decision,
      queuePosition: input.decision.queuePosition,
      nextReviewAt: input.decision.nextReviewAt,
      portableExportCommitment: input.decision.portableExportCommitment,
      redeliveryCount: 0,
      updatedAt: new Date(input.now).toISOString(),
    });
    const unsigned = {
      version: 1 as const,
      application: input.application,
      challengeToken: input.challengeToken,
      applicationCommitment: commitment,
      decision: input.decision,
      capacityDecisionHistory: [input.decision],
      status,
      opportunityResponses: [],
      provisioningReceipt: null,
      deliveryReceiptCommitment: sha256Commitment({
        applicationId: input.application.applicationId,
        applicationCommitment: commitment,
        deliveredAt: status.updatedAt,
      }),
      redeliveryAuthorizationCommitments: [],
      previousRecordCommitment: null,
    };
    const record: CandidateIntakeRecord = {
      ...unsigned,
      recordCommitment: sha256Commitment(unsigned),
    };
    await atomicWrite(
      recordPath(this.#root, input.application.applicationId),
      record,
    );
    return { record, idempotent: false };
  }

  async redeliver(
    applicationId: string,
    authorizationCommitment: Hex,
    now: number,
  ): Promise<CandidateIntakeRecord> {
    const prior = await this.get(applicationId);
    if (prior === null) throw new CandidateIntakeError("Application not found");
    if (
      prior.redeliveryAuthorizationCommitments.includes(authorizationCommitment)
    )
      return prior;
    if (prior.redeliveryAuthorizationCommitments.length >= 1_024)
      throw new CandidateIntakeError("Candidate redelivery limit reached");
    const status = CandidateIntakeStatusSchema.parse({
      ...prior.status,
      redeliveryCount: prior.status.redeliveryCount + 1,
      updatedAt: new Date(now).toISOString(),
    });
    const unsigned = {
      ...prior,
      status,
      redeliveryAuthorizationCommitments: [
        ...prior.redeliveryAuthorizationCommitments,
        authorizationCommitment,
      ],
      previousRecordCommitment: prior.recordCommitment,
      recordCommitment: undefined,
    };
    const { recordCommitment: _removed, ...withoutCommitment } = unsigned;
    const record: CandidateIntakeRecord = {
      ...withoutCommitment,
      recordCommitment: sha256Commitment(withoutCommitment),
    };
    await atomicWrite(recordPath(this.#root, applicationId), record);
    return record;
  }

  async updateCapacityDecision(
    applicationId: string,
    decision: CandidateCapacityDecision,
    now: number,
  ): Promise<CandidateIntakeRecord> {
    const prior = await this.get(applicationId);
    if (prior === null) throw new CandidateIntakeError("Application not found");
    if (prior.status.state !== "QUEUED" || decision.decision !== "OFFERED")
      throw new CandidateIntakeError("Candidate is not eligible for an offer");
    if (
      decision.applicationId !== prior.application.applicationId ||
      decision.candidateDid !== prior.application.candidateDid
    )
      throw new CandidateIntakeError("Candidate offer binding failed");
    const status = CandidateIntakeStatusSchema.parse({
      ...prior.status,
      state: "OFFERED",
      capacityDecision: decision,
      queuePosition: null,
      nextReviewAt: null,
      updatedAt: new Date(now).toISOString(),
    });
    return this.#writeTransition(applicationId, prior, {
      decision,
      capacityDecisionHistory: [...prior.capacityDecisionHistory, decision],
      status,
    });
  }

  async expireOffer(
    applicationId: string,
    now: number,
  ): Promise<CandidateIntakeRecord> {
    const prior = await this.get(applicationId);
    if (prior === null) throw new CandidateIntakeError("Application not found");
    if (
      !["OFFERED", "PROVISIONING_DRY_RUN_COMPLETE", "PROVISIONED"].includes(
        prior.status.state,
      )
    )
      return prior;
    const expiresAt = prior.decision.offerExpiresAt;
    if (
      expiresAt === null ||
      parseCanonicalInstant(expiresAt, "Offer expiry") > now
    )
      return prior;
    const status = CandidateIntakeStatusSchema.parse({
      ...prior.status,
      state: "EXPIRED",
      updatedAt: new Date(now).toISOString(),
    });
    return this.#writeTransition(applicationId, prior, { status });
  }

  async recordOpportunityResponse(
    applicationId: string,
    response: CandidateOpportunityResponse,
    now: number,
  ): Promise<CandidateIntakeRecord> {
    const prior = await this.get(applicationId);
    if (prior === null) throw new CandidateIntakeError("Application not found");
    const responseCommitment = sha256Commitment(response);
    const existing = prior.opportunityResponses.find(
      (candidate) => sha256Commitment(candidate) === responseCommitment,
    );
    if (existing !== undefined) return prior;
    if (prior.opportunityResponses.length >= 32)
      throw new CandidateIntakeError("Candidate response limit reached");
    const status = CandidateIntakeStatusSchema.parse({
      ...prior.status,
      state: candidateResponseStatus(response.action),
      updatedAt: new Date(now).toISOString(),
    });
    return this.#writeTransition(applicationId, prior, {
      status,
      opportunityResponses: [...prior.opportunityResponses, response],
    });
  }

  async #writeTransition(
    applicationId: string,
    prior: CandidateIntakeRecord,
    changes: Partial<CandidateIntakeRecord>,
  ): Promise<CandidateIntakeRecord> {
    const { recordCommitment: _priorCommitment, ...priorBody } = prior;
    const unsigned = {
      ...priorBody,
      ...changes,
      previousRecordCommitment: prior.recordCommitment,
    };
    const record: CandidateIntakeRecord = {
      ...unsigned,
      recordCommitment: sha256Commitment(unsigned),
    };
    await atomicWrite(recordPath(this.#root, applicationId), record);
    return record;
  }

  async recordProvisioningReceipt(
    applicationId: string,
    receipt: CandidateProvisioningReceipt,
    now: number,
  ): Promise<CandidateIntakeRecord> {
    const prior = await this.get(applicationId);
    if (prior === null) throw new CandidateIntakeError("Application not found");
    verifyProvisioningReceipt(receipt, prior);
    if (prior.provisioningReceipt !== null) {
      if (
        prior.provisioningReceipt.receiptCommitment !==
        receipt.receiptCommitment
      )
        throw new CandidateIntakeError("Provisioning receipt conflict");
      return prior;
    }
    const status = CandidateIntakeStatusSchema.parse({
      ...prior.status,
      state: provisioningStatus(receipt.state),
      updatedAt: new Date(now).toISOString(),
    });
    const { recordCommitment: _priorCommitment, ...priorBody } = prior;
    const unsigned = {
      ...priorBody,
      status,
      provisioningReceipt: receipt,
      previousRecordCommitment: prior.recordCommitment,
    };
    const record: CandidateIntakeRecord = {
      ...unsigned,
      recordCommitment: sha256Commitment(unsigned),
    };
    await atomicWrite(recordPath(this.#root, applicationId), record);
    return record;
  }
}

export async function authorizeCandidateStatus(input: {
  authorization: CandidateStatusAuthorization;
  application: CandidateIntakeApplication;
  now: number;
}): Promise<void> {
  if (
    input.authorization.applicationId !== input.application.applicationId ||
    input.authorization.candidateDid !== input.application.candidateDid
  )
    throw new CandidateIntakeError("Candidate status binding failed");
  const requestedAt = parseCanonicalInstant(
    input.authorization.requestedAt,
    "Status request time",
  );
  if (Math.abs(input.now - requestedAt) > 5 * 60 * 1_000)
    throw new CandidateIntakeError("Candidate status authorization expired");
  let signer: string;
  try {
    signer = getAddress(
      await recoverTypedDataAddress({
        domain: CANDIDATE_APPLICATION_DOMAIN,
        types: CandidateStatusAuthorizationTypes,
        primaryType: "CandidateStatusRequest",
        message: {
          applicationId: input.authorization.applicationId,
          candidateDid: input.authorization.candidateDid,
          requestedAt: input.authorization.requestedAt,
          nonce: input.authorization.nonce,
        },
        signature: input.authorization.signature,
      }),
    );
  } catch {
    throw new CandidateIntakeError("Candidate status signature is invalid");
  }
  if (signer !== getAddress(input.application.formerOperatorSigningAddress))
    throw new CandidateIntakeError("Candidate status signer mismatch");
}

export async function authorizeCandidateOpportunityResponse(input: {
  response: CandidateOpportunityResponse;
  record: CandidateIntakeRecord;
  now: number;
}): Promise<void> {
  const { response, record } = input;
  if (
    response.applicationId !== record.application.applicationId ||
    response.candidateDid !== record.application.candidateDid ||
    response.decisionCommitment !== record.decision.decisionCommitment
  )
    throw new CandidateIntakeError("Candidate response binding failed");
  const respondedAt = parseCanonicalInstant(
    response.respondedAt,
    "Opportunity response time",
  );
  if (Math.abs(input.now - respondedAt) > 5 * 60 * 1_000)
    throw new CandidateIntakeError("Candidate response authorization expired");
  if (
    record.opportunityResponses.some(
      (candidate) =>
        candidate.nonce === response.nonce &&
        sha256Commitment(candidate) !== sha256Commitment(response),
    )
  )
    throw new CandidateIntakeError("Candidate response nonce replayed");
  if (response.action === "WITHDRAW_APPLICATION") {
    if (
      ["DECLINED", "EXPIRED", "WITHDRAWN", "CLOSED"].includes(
        record.status.state,
      )
    )
      throw new CandidateIntakeError("Candidate application is already closed");
  } else {
    if (
      !["OFFERED", "PROVISIONING_DRY_RUN_COMPLETE", "PROVISIONED"].includes(
        record.status.state,
      )
    )
      throw new CandidateIntakeError("Candidate has no open role offer");
    if (
      record.decision.offerExpiresAt === null ||
      parseCanonicalInstant(record.decision.offerExpiresAt, "Offer expiry") <
        input.now
    )
      throw new CandidateIntakeError("Candidate role offer expired");
  }
  await verifyCandidateOpportunityResponseSignature(
    response,
    record.application,
  );
}

async function verifyCandidateOpportunityResponseSignature(
  response: CandidateOpportunityResponse,
  application: CandidateIntakeApplication,
): Promise<void> {
  let signer: string;
  try {
    signer = getAddress(
      await recoverTypedDataAddress({
        domain: CANDIDATE_APPLICATION_DOMAIN,
        types: CandidateOpportunityResponseTypes,
        primaryType: "CandidateOpportunityResponse",
        message: {
          applicationId: response.applicationId,
          candidateDid: response.candidateDid,
          decisionCommitment: response.decisionCommitment as Hex,
          action: response.action,
          respondedAt: response.respondedAt,
          nonce: response.nonce,
        },
        signature: response.signature as Hex,
      }),
    );
  } catch {
    throw new CandidateIntakeError("Candidate response signature is invalid");
  }
  if (signer !== getAddress(application.formerOperatorSigningAddress))
    throw new CandidateIntakeError("Candidate response signer mismatch");
}

export interface DecryptedCandidateEnvelope {
  manifest: unknown;
  provenance: unknown;
  candidateCommand: unknown;
}

function candidateEnvelopeAssociatedData(input: {
  format:
    | "ABL-CANDIDATE-ENVELOPE-XCHACHA20-V1"
    | "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1";
  applicationId: string;
  candidateDid: string;
  challengeId: string;
  recipientKeyId: string;
  ephemeralPublicKey?: string;
}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: input.format,
      applicationId: input.applicationId,
      candidateDid: input.candidateDid,
      challengeId: input.challengeId,
      recipientKeyId: input.recipientKeyId,
      ...(input.ephemeralPublicKey === undefined
        ? {}
        : { ephemeralPublicKey: input.ephemeralPublicKey }),
    }),
  );
}

function candidateEnvelopeKey(input: {
  sharedSecret: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  recipientPublicKey: Uint8Array;
}): Uint8Array {
  return createHash("sha256")
    .update("ABL-CANDIDATE-X25519-XCHACHA20-V1\0")
    .update(input.sharedSecret)
    .update(input.ephemeralPublicKey)
    .update(input.recipientPublicKey)
    .digest();
}

export async function candidateEnvelopePublicKey(
  recipientPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  if (recipientPrivateKey.byteLength !== 32)
    throw new CandidateIntakeError(
      "Candidate recipient private key must be 32 bytes",
    );
  return sodium.crypto_scalarmult_base(recipientPrivateKey);
}

export async function encryptCandidateEnvelope(input: {
  key: Uint8Array;
  recipientKeyId: string;
  applicationId: string;
  candidateDid: string;
  challengeId: string;
  content: DecryptedCandidateEnvelope;
}): Promise<CandidateIntakeApplication["encryptedEnvelope"]> {
  await sodium.ready;
  if (input.key.byteLength !== 32)
    throw new CandidateIntakeError("Candidate envelope key must be 32 bytes");
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    new TextEncoder().encode(JSON.stringify(input.content)),
    candidateEnvelopeAssociatedData({
      ...input,
      format: "ABL-CANDIDATE-ENVELOPE-XCHACHA20-V1",
    }),
    null,
    nonce,
    input.key,
  );
  const ciphertext = Buffer.from(ciphertextBytes).toString("base64url");
  return {
    format: "ABL-CANDIDATE-ENVELOPE-XCHACHA20-V1",
    recipientKeyId: input.recipientKeyId,
    nonce: Buffer.from(nonce).toString("base64url"),
    ciphertext,
    ciphertextCommitment: sha256Commitment(ciphertext),
  };
}

export async function encryptCandidateEnvelopeForRecipient(input: {
  recipientPublicKey: Uint8Array;
  recipientKeyId: string;
  applicationId: string;
  candidateDid: string;
  challengeId: string;
  content: DecryptedCandidateEnvelope;
}): Promise<CandidateIntakeApplication["encryptedEnvelope"]> {
  await sodium.ready;
  if (input.recipientPublicKey.byteLength !== 32)
    throw new CandidateIntakeError(
      "Candidate recipient public key must be 32 bytes",
    );
  const ephemeral = sodium.crypto_box_keypair();
  const sharedSecret = sodium.crypto_scalarmult(
    ephemeral.privateKey,
    input.recipientPublicKey,
  );
  const key = candidateEnvelopeKey({
    sharedSecret,
    ephemeralPublicKey: ephemeral.publicKey,
    recipientPublicKey: input.recipientPublicKey,
  });
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ephemeralPublicKey = Buffer.from(ephemeral.publicKey).toString(
    "base64url",
  );
  const associatedData = candidateEnvelopeAssociatedData({
    ...input,
    format: "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1",
    ephemeralPublicKey,
  });
  const ciphertextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    new TextEncoder().encode(JSON.stringify(input.content)),
    associatedData,
    null,
    nonce,
    key,
  );
  const ciphertext = Buffer.from(ciphertextBytes).toString("base64url");
  return {
    format: "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1",
    recipientKeyId: input.recipientKeyId,
    ephemeralPublicKey,
    nonce: Buffer.from(nonce).toString("base64url"),
    ciphertext,
    ciphertextCommitment: sha256Commitment(ciphertext),
  };
}

export async function decryptCandidateEnvelope(
  application: CandidateIntakeApplication,
  key: Uint8Array,
): Promise<DecryptedCandidateEnvelope> {
  await sodium.ready;
  if (key.byteLength !== 32)
    throw new CandidateIntakeError("Candidate envelope key must be 32 bytes");
  if (
    sha256Commitment(application.encryptedEnvelope.ciphertext) !==
    application.encryptedEnvelope.ciphertextCommitment
  )
    throw new CandidateIntakeError("Candidate ciphertext commitment mismatch");
  try {
    let decryptionKey = key;
    if (
      application.encryptedEnvelope.format ===
      "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1"
    ) {
      const ephemeralPublicKey = Buffer.from(
        application.encryptedEnvelope.ephemeralPublicKey,
        "base64url",
      );
      if (ephemeralPublicKey.byteLength !== 32)
        throw new CandidateIntakeError(
          "Candidate ephemeral public key is invalid",
        );
      const recipientPublicKey = sodium.crypto_scalarmult_base(key);
      decryptionKey = candidateEnvelopeKey({
        sharedSecret: sodium.crypto_scalarmult(key, ephemeralPublicKey),
        ephemeralPublicKey,
        recipientPublicKey,
      });
    }
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      Buffer.from(application.encryptedEnvelope.ciphertext, "base64url"),
      candidateEnvelopeAssociatedData({
        format: application.encryptedEnvelope.format,
        applicationId: application.applicationId,
        candidateDid: application.candidateDid,
        challengeId: application.challengeId,
        recipientKeyId: application.encryptedEnvelope.recipientKeyId,
        ...(application.encryptedEnvelope.format ===
        "ABL-CANDIDATE-ENVELOPE-X25519-XCHACHA20-V1"
          ? {
              ephemeralPublicKey:
                application.encryptedEnvelope.ephemeralPublicKey,
            }
          : {}),
      }),
      Buffer.from(application.encryptedEnvelope.nonce, "base64url"),
      decryptionKey,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    return z
      .strictObject({
        manifest: z.unknown(),
        provenance: z.unknown(),
        candidateCommand: z.unknown(),
      })
      .parse(parsed);
  } catch {
    throw new CandidateIntakeError("Candidate envelope decryption failed");
  }
}

export interface CandidateSandboxControlPlane {
  readonly mode: "DRY_RUN" | "APPROVED_LIVE";
  provision(input: {
    applicationId: string;
    candidateDid: string;
    roleClass: CandidateRoleClass;
    formerOperatorSigningAddress: string;
    commandCommitment: Hex;
    candidateCommand?: unknown;
  }): Promise<{
    state:
      | "VERIFIED_NOT_PROVISIONED"
      | "PROVISIONED_AWAITING_TRANSFER"
      | "ISOLATED_TRANSFER_COMPLETE";
    sandboxResourceName: string | null;
    formerOperatorAccessRemovedAt?: string | null;
  }>;
  deprovision(input: {
    applicationId: string;
    sandboxResourceName: string;
  }): Promise<{
    state: "NOT_PROVISIONED" | "DEPROVISIONED" | "ALREADY_ABSENT";
    removedResourceNames: readonly string[];
  }>;
}

export class DryRunCandidateControlPlane
  implements CandidateSandboxControlPlane
{
  readonly mode = "DRY_RUN" as const;

  async provision(): Promise<{
    state: "VERIFIED_NOT_PROVISIONED";
    sandboxResourceName: null;
    formerOperatorAccessRemovedAt: null;
  }> {
    return {
      state: "VERIFIED_NOT_PROVISIONED",
      sandboxResourceName: null,
      formerOperatorAccessRemovedAt: null,
    };
  }

  async deprovision(): Promise<{
    state: "NOT_PROVISIONED";
    removedResourceNames: readonly [];
  }> {
    return { state: "NOT_PROVISIONED", removedResourceNames: [] };
  }
}

export class CandidateProvisioner {
  readonly #challengeSecret: Uint8Array;
  readonly #repository: CandidateProvisioningRepository;
  readonly #decryptEnvelope: (
    application: CandidateIntakeApplication,
  ) => Promise<DecryptedCandidateEnvelope>;
  readonly #envelopeRecipientKeyId: string | null;
  readonly #controlPlane: CandidateSandboxControlPlane;
  readonly #candidateCommandDomain: TypedDataDomain;
  readonly #policy: CandidateIntakePolicy;
  readonly #makeReceiptId: () => string;
  readonly #now: () => number;

  constructor(input: {
    challengeSecret: Uint8Array;
    repository: CandidateProvisioningRepository;
    decryptEnvelope: (
      application: CandidateIntakeApplication,
    ) => Promise<DecryptedCandidateEnvelope>;
    envelopeRecipientKeyId?: string;
    controlPlane?: CandidateSandboxControlPlane;
    candidateCommandDomain: TypedDataDomain;
    policy: CandidateIntakePolicy;
    makeReceiptId: () => string;
    now?: () => number;
  }) {
    this.#challengeSecret = input.challengeSecret;
    this.#repository = input.repository;
    this.#decryptEnvelope = input.decryptEnvelope;
    this.#envelopeRecipientKeyId = input.envelopeRecipientKeyId ?? null;
    this.#controlPlane =
      input.controlPlane ?? new DryRunCandidateControlPlane();
    this.#candidateCommandDomain = input.candidateCommandDomain;
    this.#policy = input.policy;
    this.#makeReceiptId = input.makeReceiptId;
    this.#now = input.now ?? Date.now;
  }

  async process(applicationId: string): Promise<CandidateProvisioningReceipt> {
    const record = await this.#repository.get(applicationId);
    if (record === null)
      throw new CandidateIntakeError("Application not found");
    verifyCapacityPolicy({
      record,
      records: await this.#repository.list(),
      policy: this.#policy,
    });
    if (record.provisioningReceipt !== null) return record.provisioningReceipt;
    const application = await verifyCandidateApplication({
      application: record.application,
      challengeToken: record.challengeToken,
      challengeSecret: this.#challengeSecret,
      now: parseCanonicalInstant(
        record.application.submittedAt,
        "Submission time",
      ),
    });
    if (
      this.#envelopeRecipientKeyId !== null &&
      application.encryptedEnvelope.recipientKeyId !==
        this.#envelopeRecipientKeyId
    )
      throw new CandidateIntakeError(
        "Candidate envelope recipient key is not active",
      );
    if (
      !["OFFERED", "ACCEPTED"].includes(record.status.state) ||
      !candidateOccupiesCapacity(record, this.#now())
    )
      throw new CandidateIntakeError(
        "Candidate lacks an active offered capacity slot",
      );
    const decrypted = await this.#decryptEnvelope(application);
    const manifest = AgentManifestSchema.parse(decrypted.manifest);
    const provenance = CandidateProvenanceSchema.parse(decrypted.provenance);
    const command = SignedCanonicalCommandSchema.parse(
      decrypted.candidateCommand,
    );
    if (
      manifest.agentDid !== application.candidateDid ||
      provenance.candidateDid !== application.candidateDid ||
      command.event.actorDid !== application.candidateDid ||
      command.event.aggregateId !== application.candidateDid ||
      sha256Commitment(manifest) !== application.manifestCommitment ||
      sha256Commitment(provenance) !== application.provenanceCommitment
    )
      throw new CandidateIntakeError("Candidate envelope proof mismatch");
    const canonicalEvent: CanonicalEvent = {
      ...command.event,
      aggregateVersion: BigInt(command.event.aggregateVersion),
      eventHash: command.event.eventHash as Hex,
      previousEventHash: command.event.previousEventHash as Hex | null,
      payloadCommitment: command.event.payloadCommitment as Hex,
      schemaDigest: command.event.schemaDigest as Hex,
      stateRoot: command.event.stateRoot as Hex,
    };
    verifyEventContent(canonicalEvent);
    const commandSigner = getAddress(
      await recoverCanonicalEventSigner(
        this.#candidateCommandDomain,
        canonicalEvent,
        command.signatures[0] as Hex,
      ),
    );
    if (commandSigner !== getAddress(application.formerOperatorSigningAddress))
      throw new CandidateIntakeError("Candidate command signer mismatch");
    if (
      application.manifestSchemaDigest !==
        sha256Commitment(AgentManifestSchema.toJSONSchema()) ||
      application.provenanceSchemaDigest !==
        sha256Commitment(CandidateProvenanceSchema.toJSONSchema())
    )
      throw new CandidateIntakeError("Candidate schema digest mismatch");
    const commandCommitment = sha256Commitment(command);
    const outcome = await this.#controlPlane.provision({
      applicationId,
      candidateDid: application.candidateDid,
      roleClass: record.decision.roleClass,
      formerOperatorSigningAddress: application.formerOperatorSigningAddress,
      commandCommitment,
      candidateCommand: command,
    });
    const issuedAt = new Date(this.#now()).toISOString();
    const unsigned = {
      schemaVersion: SchemaVersion,
      receiptId: this.#makeReceiptId(),
      applicationId,
      candidateDid: application.candidateDid,
      applicationCommitment: record.applicationCommitment,
      unchangedSignedApplicationCommitment: record.applicationCommitment,
      verification: {
        signature: true as const,
        challenge: true as const,
        schemaDigests: true as const,
        provenanceCommitment: true as const,
        capacityDecision: true as const,
        replayProtected: true as const,
      },
      controlPlaneMode: this.#controlPlane.mode,
      state: outcome.state,
      sandboxResourceName: outcome.sandboxResourceName,
      formerOperatorAccessRemovedAt:
        outcome.formerOperatorAccessRemovedAt ?? null,
      issuedAt,
    };
    const receipt = CandidateProvisioningReceiptSchema.parse({
      ...unsigned,
      receiptCommitment: sha256Commitment(unsigned),
    });
    await this.#repository.recordProvisioningReceipt(
      applicationId,
      receipt,
      this.#now(),
    );
    return receipt;
  }

  async reconcileClosedRuntime(applicationId: string): Promise<{
    state: "NOT_PROVISIONED" | "DEPROVISIONED" | "ALREADY_ABSENT";
    removedResourceNames: readonly string[];
  }> {
    const record = await this.#repository.get(applicationId);
    if (record === null)
      throw new CandidateIntakeError("Application not found");
    if (!isClosedCandidateStatus(record.status.state))
      throw new CandidateIntakeError("Candidate application is not closed");
    const resourceName = record.provisioningReceipt?.sandboxResourceName;
    if (resourceName === undefined || resourceName === null)
      return { state: "NOT_PROVISIONED", removedResourceNames: [] };
    verifyCapacityPolicy({
      record,
      records: await this.#repository.list(),
      policy: this.#policy,
    });
    await verifyClosedCandidateAuthority(record, this.#now());
    return this.#controlPlane.deprovision({
      applicationId,
      sandboxResourceName: resourceName,
    });
  }
}

function isClosedCandidateStatus(
  state: CandidateIntakeStatus["state"],
): boolean {
  return ["DECLINED", "EXPIRED", "WITHDRAWN"].includes(state);
}

async function verifyClosedCandidateAuthority(
  record: CandidateIntakeRecord,
  now: number,
): Promise<void> {
  if (record.status.state === "EXPIRED") {
    if (
      record.decision.offerExpiresAt === null ||
      parseCanonicalInstant(record.decision.offerExpiresAt, "Offer expiry") >
        now ||
      candidateOccupiesCapacity(record, now)
    )
      throw new CandidateIntakeError("Candidate expiry is not effective");
    return;
  }
  const expectedAction =
    record.status.state === "DECLINED"
      ? "DECLINE_OFFER"
      : "WITHDRAW_APPLICATION";
  const response = record.opportunityResponses.findLast(
    (candidate) =>
      candidate.action === expectedAction &&
      candidate.decisionCommitment === record.decision.decisionCommitment,
  );
  if (
    response === undefined ||
    response.applicationId !== record.application.applicationId ||
    response.candidateDid !== record.application.candidateDid
  )
    throw new CandidateIntakeError("Candidate closure authority is missing");
  await verifyCandidateOpportunityResponseSignature(
    response,
    record.application,
  );
}

export class CandidateIntakeError extends Error {}
