import {
  createCanonicalEvent,
  sha256Commitment,
  signCanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";

import {
  ActionIntentSchema,
  createDeterministicFixtureReceipt,
  type ActionIntent,
  type PlayerObservation,
  type SignedPlayerDecision,
} from "./types.js";

export type PlayerDecisionPolicy = (
  observation: PlayerObservation,
) => ActionIntent;

export class PersistentPlayerBody {
  readonly did: string;
  readonly playerId: string;
  readonly signingIdentity: SigningIdentity;
  readonly #policy: PlayerDecisionPolicy;
  readonly #lessons: string[] = [];
  #version = 0n;
  #lastEventHash: `0x${string}` | null = null;

  public constructor(input: {
    did: string;
    playerId: string;
    signingIdentity: SigningIdentity;
    policy: PlayerDecisionPolicy;
  }) {
    this.did = input.did;
    this.playerId = input.playerId;
    this.signingIdentity = input.signingIdentity;
    this.#policy = input.policy;
  }

  public async decide(
    observation: PlayerObservation,
    domain: TypedDataDomain,
  ): Promise<SignedPlayerDecision> {
    const intent = ActionIntentSchema.parse(
      this.#policy(structuredClone(observation)),
    );
    if (
      intent.playerId !== this.playerId ||
      intent.windowId !==
        observation.observationId.split(":").slice(0, 2).join(":")
    ) {
      throw new Error("Player decision does not match body/window");
    }
    const receipt = createDeterministicFixtureReceipt({
      careerDid: this.did,
      role: "PLAYER",
      activationId: observation.observationId,
      observationCommitment: sha256Commitment(observation),
      contextManifestCommitment: sha256Commitment({
        supplied: [observation.observationId],
      }),
      deadlineMs: 1_500,
      normalizedResourceUnits: 1_000,
    });
    const version = this.#version + 1n;
    const event = createCanonicalEvent({
      eventId: `${observation.observationId}:decision`,
      actorDid: this.did,
      nonce: version.toString(),
      idempotencyKey: `${observation.observationId}:idempotency`,
      aggregateType: "player-decision",
      aggregateId: this.playerId,
      aggregateVersion: version,
      eventType: "ActionIntentSubmitted",
      previousEventHash: this.#lastEventHash,
      payload: { intent, receiptCommitment: sha256Commitment(receipt) },
      stateRoot: observation.stateCommitment as `0x${string}`,
      schemaDigest: sha256Commitment("ActionIntentSchema:1.0.0"),
      timestamp: "2026-08-13T10:00:00.000Z",
    });
    const signature = await signCanonicalEvent(
      this.signingIdentity,
      domain,
      event,
    );
    this.#version = version;
    this.#lastEventHash = event.eventHash;
    return {
      intent,
      receipt,
      authorizationEvent: event,
      eventHash: event.eventHash,
      signature,
      signerAddress: this.signingIdentity.address,
    };
  }

  public persistAgentAuthoredLesson(lesson: string): void {
    if (lesson.trim() === "") throw new Error("Lesson must not be empty");
    this.#lessons.push(lesson);
  }

  public exportLessons(): readonly string[] {
    return [...this.#lessons];
  }

  public decisionVersion(): bigint {
    return this.#version;
  }

  public get signerAddress(): `0x${string}` {
    return this.signingIdentity.address;
  }
}
