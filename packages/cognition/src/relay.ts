import { sha256Commitment } from "@abl/recognition";
import {
  InferenceRequestSchema,
  InferenceResultSchema,
  RunnerDelegationSchema,
  RunnerHeartbeatSchema,
  RunnerPairingOfferSchema,
  ActivationStateSchema,
  type ActivationState,
  type InferenceRequest,
  type InferenceResult,
  type RunnerDelegation,
  type RunnerHeartbeat,
  type RunnerPairingOffer,
} from "@abl/schemas";
import type { Address, Hex } from "viem";

import {
  recoverRunnerRequestSigner,
  type RunnerRequestMessage,
} from "./runner-auth.js";

export interface PairingSubmission {
  offerId: string;
  pairingToken: string;
  runnerId: string;
  delegateSigningAddress: Address;
  delegateEncryptionPublicKey: `0x${string}`;
}

export interface RunnerAuthenticatedRequest {
  message: RunnerRequestMessage;
  signature: Hex;
}

export interface RelayStoreSnapshot {
  offers: number;
  delegations: number;
  pendingActivations: number;
  retainedCiphertextBytes: number;
  activationStates: number;
}

export interface PairingRecord {
  offer: Omit<RunnerPairingOffer, "pairingToken">;
  tokenHash: `0x${string}` | null;
  consumedAt: string | null;
}

export interface DeliveryRecord {
  request: InferenceRequest;
  result: InferenceResult | null;
  acknowledgedAt: string | null;
}

export interface ActivationStateRecord {
  activationId: string;
  careerDid: string;
  gameId: string;
  role: "PLAYER" | "COACH" | "REFEREE" | "REPLAY";
  state: ActivationState;
  activationCommitment: `0x${string}`;
  contextManifestCommitment: `0x${string}` | null;
  finalDecisionCommitment: `0x${string}` | null;
  deadlineAt: string;
  updatedAt: string;
}

export interface RelayDurableState {
  version: 1;
  offers: Array<[string, PairingRecord]>;
  delegations: Array<[string, RunnerDelegation]>;
  delegationByRunner: Array<[string, string]>;
  heartbeats: Array<[string, RunnerHeartbeat]>;
  deliveries: Array<[string, DeliveryRecord]>;
  activationStates: Array<[string, ActivationStateRecord]>;
  usedNonces: string[];
  idempotentResults: Array<[string, unknown]>;
}

export class CognitionRelay {
  readonly #offers = new Map<string, PairingRecord>();
  readonly #delegations = new Map<string, RunnerDelegation>();
  readonly #delegationByRunner = new Map<string, string>();
  readonly #heartbeats = new Map<string, RunnerHeartbeat>();
  readonly #deliveries = new Map<string, DeliveryRecord>();
  readonly #activationStates = new Map<string, ActivationStateRecord>();
  readonly #usedNonces = new Set<string>();
  readonly #idempotentResults = new Map<string, unknown>();

  public static fromState(state: RelayDurableState): CognitionRelay {
    if (state.version !== 1) throw new Error("Unsupported relay state version");
    const relay = new CognitionRelay();
    for (const [key, value] of state.offers) relay.#offers.set(key, value);
    for (const [key, value] of state.delegations)
      relay.#delegations.set(key, RunnerDelegationSchema.parse(value));
    for (const [key, value] of state.delegationByRunner)
      relay.#delegationByRunner.set(key, value);
    for (const [key, value] of state.heartbeats)
      relay.#heartbeats.set(key, RunnerHeartbeatSchema.parse(value));
    for (const [key, value] of state.deliveries)
      relay.#deliveries.set(key, {
        request: InferenceRequestSchema.parse(value.request),
        result:
          value.result === null
            ? null
            : InferenceResultSchema.parse(value.result),
        acknowledgedAt: value.acknowledgedAt,
      });
    for (const [key, value] of state.activationStates ?? [])
      relay.#activationStates.set(key, {
        ...value,
        state: ActivationStateSchema.parse(value.state),
      });
    for (const value of state.usedNonces) relay.#usedNonces.add(value);
    for (const [key, value] of state.idempotentResults)
      relay.#idempotentResults.set(key, value);
    return relay;
  }

  public exportState(): RelayDurableState {
    return {
      version: 1,
      offers: [...this.#offers],
      delegations: [...this.#delegations],
      delegationByRunner: [...this.#delegationByRunner],
      heartbeats: [...this.#heartbeats],
      deliveries: [...this.#deliveries],
      activationStates: [...this.#activationStates],
      usedNonces: [...this.#usedNonces],
      idempotentResults: [...this.#idempotentResults],
    };
  }

  public transitionActivation(
    raw: ActivationStateRecord,
  ): ActivationStateRecord {
    const next = {
      ...raw,
      state: ActivationStateSchema.parse(raw.state),
    };
    const current = this.#activationStates.get(next.activationId);
    if (current !== undefined) {
      if (
        current.careerDid !== next.careerDid ||
        current.gameId !== next.gameId ||
        current.role !== next.role ||
        current.activationCommitment !== next.activationCommitment ||
        current.deadlineAt !== next.deadlineAt
      )
        throw new Error("Activation state identity conflict");
      const terminal = new Set<ActivationState>([
        "CAREER_SIGNED",
        "FALLBACK_SIGNED",
        "EXPIRED",
        "REJECTED",
      ]);
      if (terminal.has(current.state) && current.state !== next.state)
        throw new Error("Terminal activation state cannot change");
      const allowed: Record<ActivationState, readonly ActivationState[]> = {
        RECEIVED: ["RECEIVED", "CONTEXT_ASSEMBLED", "REJECTED"],
        CONTEXT_ASSEMBLED: [
          "CONTEXT_ASSEMBLED",
          "SEALED_FOR_RUNNER",
          ...(next.role === "REFEREE" || next.role === "REPLAY"
            ? (["DELIVERED"] as const)
            : []),
          "FALLBACK_SIGNED",
          "EXPIRED",
          "REJECTED",
        ],
        SEALED_FOR_RUNNER: [
          "SEALED_FOR_RUNNER",
          "DELIVERED",
          "FALLBACK_SIGNED",
          "EXPIRED",
          "REJECTED",
        ],
        DELIVERED: [
          "DELIVERED",
          "RESULT_RECEIVED",
          "FALLBACK_SIGNED",
          "EXPIRED",
          "REJECTED",
        ],
        RESULT_RECEIVED: [
          "RESULT_RECEIVED",
          "VALIDATED",
          "FALLBACK_SIGNED",
          "REJECTED",
        ],
        VALIDATED: [
          "VALIDATED",
          "CAREER_SIGNED",
          "FALLBACK_SIGNED",
          "REJECTED",
        ],
        CAREER_SIGNED: ["CAREER_SIGNED"],
        FALLBACK_SIGNED: ["FALLBACK_SIGNED"],
        EXPIRED: ["EXPIRED"],
        REJECTED: ["REJECTED"],
      };
      if (!allowed[current.state].includes(next.state))
        throw new Error(
          `Invalid activation transition ${current.state} -> ${next.state}`,
        );
      if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt))
        throw new Error("Activation state cannot move backward in time");
    }
    this.#activationStates.set(next.activationId, next);
    return next;
  }

  public activationState(activationId: string): ActivationStateRecord | null {
    return this.#activationStates.get(activationId) ?? null;
  }

  public registerPairingOffer(rawOffer: RunnerPairingOffer): void {
    const offer = RunnerPairingOfferSchema.parse(rawOffer);
    if (this.#offers.has(offer.offerId))
      throw new Error("Pairing offer already exists");
    const { pairingToken: _token, ...safeOffer } = offer;
    this.#offers.set(offer.offerId, {
      offer: safeOffer,
      tokenHash: sha256Commitment(offer.pairingToken),
      consumedAt: null,
    });
  }

  public async pair(
    submission: PairingSubmission,
    authorize: (input: {
      offer: Omit<RunnerPairingOffer, "pairingToken">;
      runnerId: string;
      delegateSigningAddress: Address;
      delegateEncryptionPublicKey: `0x${string}`;
    }) => Promise<RunnerDelegation>,
    now = new Date().toISOString(),
  ): Promise<RunnerDelegation> {
    const record = this.#offers.get(submission.offerId);
    if (
      record === undefined ||
      record.consumedAt !== null ||
      record.tokenHash === null ||
      record.tokenHash !== sha256Commitment(submission.pairingToken) ||
      Date.parse(record.offer.expiresAt) <= Date.parse(now)
    )
      throw new Error("Pairing offer is invalid, expired, or consumed");
    if (this.#delegationByRunner.has(submission.runnerId))
      throw new Error("Runner is already paired");
    const delegation = RunnerDelegationSchema.parse(
      await authorize({
        offer: record.offer,
        runnerId: submission.runnerId,
        delegateSigningAddress: submission.delegateSigningAddress,
        delegateEncryptionPublicKey: submission.delegateEncryptionPublicKey,
      }),
    );
    if (
      delegation.careerDid !== record.offer.careerDid ||
      delegation.runnerId !== submission.runnerId ||
      delegation.delegateSigningAddress.toLowerCase() !==
        submission.delegateSigningAddress.toLowerCase() ||
      delegation.delegateEncryptionPublicKey !==
        submission.delegateEncryptionPublicKey
    )
      throw new Error("Career returned a delegation for another runner");
    record.consumedAt = now;
    record.tokenHash = null;
    this.#delegations.set(delegation.delegationId, delegation);
    this.#delegationByRunner.set(delegation.runnerId, delegation.delegationId);
    return delegation;
  }

  public async renew(
    request: RunnerAuthenticatedRequest,
    authorize: (input: {
      current: RunnerDelegation;
      careerResourceName: string;
    }) => Promise<RunnerDelegation>,
    now = new Date().toISOString(),
  ): Promise<RunnerDelegation> {
    const current = await this.authenticate(request, now, "RUNNER_HEARTBEAT");
    const offer = [...this.#offers.values()]
      .filter(
        ({ consumedAt, offer }) =>
          consumedAt !== null && offer.careerDid === current.careerDid,
      )
      .sort((left, right) =>
        right.offer.issuedAt.localeCompare(left.offer.issuedAt),
      )[0];
    if (offer === undefined)
      throw new Error("Runner delegation has no attributable pairing offer");
    const renewed = RunnerDelegationSchema.parse(
      await authorize({
        current,
        careerResourceName: offer.offer.careerResourceName,
      }),
    );
    if (
      renewed.delegationId === current.delegationId ||
      renewed.careerDid !== current.careerDid ||
      renewed.runnerId !== current.runnerId ||
      renewed.delegateSigningAddress.toLowerCase() !==
        current.delegateSigningAddress.toLowerCase() ||
      renewed.delegateEncryptionPublicKey !==
        current.delegateEncryptionPublicKey ||
      sha256Commitment([...renewed.scopes].sort()) !==
        sha256Commitment([...current.scopes].sort()) ||
      renewed.revokedAt !== null ||
      Date.parse(renewed.issuedAt) < Date.parse(now) ||
      Date.parse(renewed.expiresAt) <= Date.parse(renewed.issuedAt)
    )
      throw new Error("Career returned an invalid delegation renewal");
    // Keep the previous certificate valid until its original expiry. Participant-
    // owned runners may restart from a durable bootstrap copy while atomically
    // persisting the renewed certificate. Deliveries still target only the newest
    // certificate via delegationByRunner, and unpair revokes the complete chain.
    this.#delegations.set(renewed.delegationId, renewed);
    this.#delegationByRunner.set(renewed.runnerId, renewed.delegationId);
    return renewed;
  }

  public async authenticate(
    request: RunnerAuthenticatedRequest,
    now = new Date().toISOString(),
    requiredScope?: RunnerDelegation["scopes"][number],
  ): Promise<RunnerDelegation> {
    const delegation = this.#delegations.get(request.message.delegationId);
    if (
      delegation === undefined ||
      delegation.runnerId !== request.message.runnerId ||
      delegation.careerDid !== request.message.careerDid ||
      delegation.revokedAt !== null ||
      Date.parse(delegation.expiresAt) <= Date.parse(now)
    )
      throw new Error("Runner delegation is unavailable");
    if (
      requiredScope !== undefined &&
      !delegation.scopes.includes(requiredScope)
    )
      throw new Error(`Runner delegation lacks ${requiredScope}`);
    const timestamp = Date.parse(request.message.timestamp);
    const current = Date.parse(now);
    if (!Number.isFinite(timestamp) || Math.abs(current - timestamp) > 120_000)
      throw new Error("Runner request timestamp is stale");
    const nonceKey = `${delegation.delegationId}:${request.message.nonce}`;
    if (this.#usedNonces.has(nonceKey))
      throw new Error("Runner nonce replayed");
    const signer = await recoverRunnerRequestSigner(
      request.message,
      request.signature,
    );
    if (
      signer.toLowerCase() !== delegation.delegateSigningAddress.toLowerCase()
    )
      throw new Error("Runner request signer is not delegated");
    this.#usedNonces.add(nonceKey);
    return delegation;
  }

  public async heartbeat(
    auth: RunnerAuthenticatedRequest,
    rawHeartbeat: RunnerHeartbeat,
    now = new Date().toISOString(),
  ): Promise<RunnerHeartbeat> {
    const existing = this.#idempotentResults.get(auth.message.idempotencyKey);
    if (existing !== undefined) return RunnerHeartbeatSchema.parse(existing);
    const delegation = await this.authenticate(auth, now, "RUNNER_HEARTBEAT");
    const heartbeat = RunnerHeartbeatSchema.parse(rawHeartbeat);
    if (
      heartbeat.runnerId !== delegation.runnerId ||
      heartbeat.careerDid !== delegation.careerDid ||
      heartbeat.delegationId !== delegation.delegationId
    )
      throw new Error("Heartbeat is bound to another delegation");
    const heartbeatSigner = await recoverRunnerRequestSigner(
      {
        runnerId: heartbeat.runnerId,
        careerDid: heartbeat.careerDid,
        delegationId: heartbeat.delegationId,
        method: "HEARTBEAT_ATTESTATION",
        path: "/v1/runners/heartbeat",
        bodyCommitment: sha256Commitment({
          schemaVersion: heartbeat.schemaVersion,
          runnerId: heartbeat.runnerId,
          careerDid: heartbeat.careerDid,
          delegationId: heartbeat.delegationId,
          runnerBuildDigest: heartbeat.runnerBuildDigest,
          adapterBuildDigest: heartbeat.adapterBuildDigest,
          availability: heartbeat.availability,
          observedAt: heartbeat.observedAt,
          nonce: heartbeat.nonce,
          idempotencyKey: heartbeat.idempotencyKey,
        }),
        nonce: heartbeat.nonce,
        idempotencyKey: heartbeat.idempotencyKey,
        timestamp: heartbeat.observedAt,
      },
      heartbeat.signature as Hex,
    );
    if (
      heartbeatSigner.toLowerCase() !==
      delegation.delegateSigningAddress.toLowerCase()
    )
      throw new Error("Heartbeat attestation signer is not delegated");
    this.#heartbeats.set(heartbeat.runnerId, heartbeat);
    this.#idempotentResults.set(auth.message.idempotencyKey, heartbeat);
    return heartbeat;
  }

  public enqueue(rawRequest: InferenceRequest): "CREATED" | "EXISTS" {
    const request = InferenceRequestSchema.parse(rawRequest);
    const existing = this.#deliveries.get(request.activation.activationId);
    if (existing !== undefined) {
      if (sha256Commitment(existing.request) !== sha256Commitment(request))
        throw new Error("Activation idempotency conflict");
      return "EXISTS";
    }
    const delegationId = this.#delegationByRunner.get(request.capsule.runnerId);
    const delegation =
      delegationId === undefined
        ? undefined
        : this.#delegations.get(delegationId);
    if (
      delegation === undefined ||
      delegation.careerDid !== request.activation.careerDid ||
      delegation.revokedAt !== null
    )
      throw new Error("Activation has no active career runner delegation");
    this.#deliveries.set(request.activation.activationId, {
      request,
      result: null,
      acknowledgedAt: null,
    });
    return "CREATED";
  }

  public nextActivation(
    runnerId: string,
    now = new Date().toISOString(),
  ): InferenceRequest | null {
    return (
      [...this.#deliveries.values()]
        .filter(
          ({ request, result }) =>
            request.capsule.runnerId === runnerId &&
            result === null &&
            Date.parse(request.activation.deadlineAt) > Date.parse(now),
        )
        .sort((left, right) =>
          left.request.activation.deadlineAt.localeCompare(
            right.request.activation.deadlineAt,
          ),
        )[0]?.request ?? null
    );
  }

  public async submitResult(
    rawResult: InferenceResult,
    authenticatedDelegation: RunnerDelegation,
    now = new Date().toISOString(),
  ): Promise<"ACCEPTED" | "EXISTS"> {
    const result = InferenceResultSchema.parse(rawResult);
    const delegation = RunnerDelegationSchema.parse(authenticatedDelegation);
    const currentDelegation = this.#delegations.get(delegation.delegationId);
    const delivery = this.#deliveries.get(result.activationId);
    if (
      currentDelegation === undefined ||
      currentDelegation.runnerId !== delegation.runnerId ||
      currentDelegation.careerDid !== delegation.careerDid ||
      currentDelegation.revokedAt !== null ||
      Date.parse(currentDelegation.expiresAt) <= Date.parse(now) ||
      delivery === undefined ||
      delivery.request.requestId !== result.requestId ||
      delivery.request.activation.careerDid !== result.careerDid ||
      delivery.request.capsule.runnerId !== result.runnerId ||
      result.runnerId !== delegation.runnerId ||
      result.careerDid !== delegation.careerDid
    )
      throw new Error("Inference result is bound to another activation");
    if (
      Date.parse(result.completedAt) >
      Date.parse(delivery.request.activation.deadlineAt)
    )
      throw new Error("Inference result missed its decision deadline");
    const signer = await recoverRunnerRequestSigner(
      {
        runnerId: result.runnerId,
        careerDid: result.careerDid,
        delegationId: delegation.delegationId,
        method: "RESULT_ATTESTATION",
        path: result.activationId,
        bodyCommitment: sha256Commitment({
          requestId: result.requestId,
          activationId: result.activationId,
          ciphertextCommitment: result.ciphertextCommitment,
          completedAt: result.completedAt,
        }),
        nonce: "0",
        idempotencyKey: result.requestId,
        timestamp: result.completedAt,
      },
      result.delegateSignature as Hex,
    );
    if (
      signer.toLowerCase() !== delegation.delegateSigningAddress.toLowerCase()
    )
      throw new Error("Inference result signer is not the delegated runner");
    if (delivery.result !== null) {
      if (sha256Commitment(delivery.result) !== sha256Commitment(result))
        throw new Error("Only one result may be accepted per activation");
      return "EXISTS";
    }
    delivery.result = result;
    return "ACCEPTED";
  }

  public result(
    activationId: string,
    acknowledgeAt?: string,
  ): InferenceResult | null {
    const delivery = this.#deliveries.get(activationId);
    if (delivery === undefined) return null;
    if (acknowledgeAt !== undefined) delivery.acknowledgedAt = acknowledgeAt;
    return delivery.result;
  }

  public revoke(delegationId: string, revokedAt: string): RunnerDelegation {
    const delegation = this.#delegations.get(delegationId);
    if (delegation === undefined)
      throw new Error("Runner delegation not found");
    const revoked = RunnerDelegationSchema.parse({ ...delegation, revokedAt });
    this.#delegations.set(delegationId, revoked);
    return revoked;
  }

  public runnerStatus(runnerId: string): {
    delegation: RunnerDelegation | null;
    heartbeat: RunnerHeartbeat | null;
  } {
    const delegationId = this.#delegationByRunner.get(runnerId);
    return {
      delegation:
        delegationId === undefined
          ? null
          : (this.#delegations.get(delegationId) ?? null),
      heartbeat: this.#heartbeats.get(runnerId) ?? null,
    };
  }

  public careerRunnerStatus(careerDid: string): {
    delegation: RunnerDelegation | null;
    heartbeat: RunnerHeartbeat | null;
  } {
    const delegation = [...this.#delegations.values()]
      .filter(
        ({ careerDid: candidateCareerDid }) => candidateCareerDid === careerDid,
      )
      .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))[0];
    return delegation === undefined
      ? { delegation: null, heartbeat: null }
      : {
          delegation,
          heartbeat: this.#heartbeats.get(delegation.runnerId) ?? null,
        };
  }

  public unpair(runnerId: string, revokedAt: string): RunnerDelegation {
    const delegationId = this.#delegationByRunner.get(runnerId);
    if (delegationId === undefined) throw new Error("Runner is not paired");
    const latest = this.#delegations.get(delegationId);
    if (latest === undefined) throw new Error("Runner delegation not found");
    for (const [candidateId, delegation] of this.#delegations)
      if (delegation.runnerId === runnerId && delegation.revokedAt === null)
        this.#delegations.set(
          candidateId,
          RunnerDelegationSchema.parse({ ...delegation, revokedAt }),
        );
    return RunnerDelegationSchema.parse({ ...latest, revokedAt });
  }

  public purgeCiphertext(now = new Date().toISOString()): number {
    let purged = 0;
    const cutoff = Date.parse(now) - 24 * 60 * 60 * 1_000;
    for (const [activationId, delivery] of this.#deliveries) {
      const retentionStart = Math.max(
        Date.parse(delivery.request.activation.deadlineAt),
        Date.parse(
          delivery.acknowledgedAt ?? delivery.request.activation.deadlineAt,
        ),
      );
      if (retentionStart <= cutoff) {
        this.#deliveries.delete(activationId);
        purged += 1;
      }
    }
    for (const [offerId, offer] of this.#offers) {
      if (
        offer.tokenHash !== null &&
        Date.parse(offer.offer.expiresAt) <= Date.parse(now)
      )
        this.#offers.set(offerId, { ...offer, tokenHash: null });
    }
    return purged;
  }

  public snapshot(): RelayStoreSnapshot {
    return {
      offers: this.#offers.size,
      delegations: this.#delegations.size,
      pendingActivations: [...this.#deliveries.values()].filter(
        ({ result }) => result === null,
      ).length,
      retainedCiphertextBytes: [...this.#deliveries.values()].reduce(
        (total, { request, result }) =>
          total +
          request.capsule.ciphertextBytes +
          (result?.ciphertextBytes ?? 0),
        0,
      ),
      activationStates: this.#activationStates.size,
    };
  }
}
