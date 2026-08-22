import {
  REHEARSAL_RECOGNITION_DOMAIN,
  createRehearsalPlayerBodies,
  runFirstPossessionRehearsal,
  type CognitionReceipt,
  type PlayerObservation,
  type RehearsalPlayerBody,
  type SignedPlayerDecision,
} from "@abl/basketball";
import {
  createCanonicalEvent,
  sha256Commitment,
  type CanonicalEvent,
} from "@abl/recognition";
import type { Address, Hex, TypedDataDomain } from "viem";

const eventTimestamp = "2026-08-19T12:00:00.000Z";

export interface CanonicalEventSigner {
  readonly address: Address;
  sign(event: CanonicalEvent, domain: TypedDataDomain): Promise<Hex>;
}

class StagingPlayerBody implements RehearsalPlayerBody {
  readonly signerAddress: Address;
  readonly #actorDid: string;
  readonly #signer: CanonicalEventSigner;
  #version = 0n;
  #lastEventHash: Hex | null = null;

  public constructor(input: {
    actorDid: string;
    signer: CanonicalEventSigner;
  }) {
    this.#actorDid = input.actorDid;
    this.#signer = input.signer;
    this.signerAddress = input.signer.address;
  }

  public async decide(
    observation: PlayerObservation,
    domain: TypedDataDomain,
  ): Promise<SignedPlayerDecision> {
    const windowId = observation.observationId.split(":").slice(0, 2).join(":");
    const intent =
      observation.window < 2
        ? ({ windowId, playerId: "H1", action: "HOLD" } as const)
        : ({
            windowId,
            playerId: "H1",
            action: "SHOOT",
            shot: "LAYUP",
          } as const);
    const receipt: CognitionReceipt = {
      receiptId: `${observation.observationId}:receipt`,
      agentDid: this.#actorDid,
      role: "PLAYER",
      endpoint: "fixed-local-broker",
      provider: "deterministic-stage",
      modelFamily: "structured-policy",
      modelRevision: "1",
      observationHash: sha256Commitment(observation),
      contextManifestHash: sha256Commitment({
        supplied: [observation.observationId],
      }),
      kernelHash: sha256Commitment("basketball-kernel-v1"),
      toolHash: sha256Commitment("fixed-local-broker"),
      deadlineMs: 1_500,
      retryCount: 0,
      fallbackUsed: false,
      normalizedResourceUnits: 1_000,
      telemetryContentPolicy: "CONTENT_DISABLED",
      personalMaterialSupplied: [],
    };
    const version = this.#version + 1n;
    const event = createCanonicalEvent({
      eventId: `${observation.observationId}:decision`,
      actorDid: this.#actorDid,
      nonce: version.toString(),
      idempotencyKey: `${observation.observationId}:idempotency`,
      aggregateType: "player-decision",
      aggregateId: "H1",
      aggregateVersion: version,
      eventType: "ActionIntentSubmitted",
      previousEventHash: this.#lastEventHash,
      payload: { intent, receiptCommitment: sha256Commitment(receipt) },
      stateRoot: observation.stateCommitment as Hex,
      schemaDigest: sha256Commitment("ActionIntentSchema:1.0.0"),
      timestamp: eventTimestamp,
    });
    const signature = await this.#signer.sign(event, domain);
    this.#version = version;
    this.#lastEventHash = event.eventHash;
    return {
      intent,
      receipt,
      authorizationEvent: event,
      eventHash: event.eventHash,
      signature,
      signerAddress: this.signerAddress,
    };
  }

  public decisionVersion(): bigint {
    return this.#version;
  }
}

export function wireCanonicalEvent(event: CanonicalEvent) {
  return { ...event, aggregateVersion: event.aggregateVersion.toString() };
}

export async function createStagingPossessionCommand(input: {
  actorDid: string;
  signer: CanonicalEventSigner;
}) {
  const bodies = createRehearsalPlayerBodies({ terminalWindow: 2 });
  bodies.set(
    "H1",
    new StagingPlayerBody({
      actorDid: input.actorDid,
      signer: input.signer,
    }),
  );
  const rehearsal = await runFirstPossessionRehearsal({
    bodies,
    playerDidOverrides: { H1: input.actorDid },
  });
  const { result } = rehearsal;
  const finalSegmentHash = result.segments.at(-1)?.segmentHash;
  if (finalSegmentHash === undefined)
    throw new Error("Staging possession produced no public segment");
  const source = {
    gameId: result.finalState.gameId,
    possessionId: result.finalState.possessionId,
    score: result.finalState.score,
    gameClockMs: result.finalState.gameClockMs,
    shotClockMs: result.finalState.shotClockMs,
    players: result.finalState.players.map(
      ({ playerId, team, position, xCm, yCm }) => ({
        playerId,
        team,
        position,
        xCm,
        yCm,
      }),
    ),
    events: result.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      label: `${event.type.toLowerCase().replaceAll("_", " ")} resolved`,
      stateRoot: event.stateRoot,
      eventHash: event.eventHash,
    })),
    segments: result.segments,
    finalStateRoot: result.finalStateRoot,
    eventMerkleRoot: result.eventMerkleRoot,
    filmCommitment: result.filmCommitment,
    finalSegmentHash,
  };
  const event = createCanonicalEvent({
    eventId: "0198a000-0000-7000-8000-000000000301",
    actorDid: input.actorDid,
    nonce: "abl-stage-possession-resolution-1",
    idempotencyKey: "0198a000-0000-7000-8000-000000000302",
    aggregateType: "game-possession",
    aggregateId: result.finalState.gameId,
    aggregateVersion: 1n,
    eventType: "PossessionResolved",
    previousEventHash: null,
    payload: { source, decisionProof: rehearsal.decisionProof },
    stateRoot: result.finalStateRoot,
    schemaDigest: sha256Commitment("PossessionResolved:1.0.0"),
    timestamp: eventTimestamp,
  });
  return {
    signerAddress: input.signer.address,
    eventHash: event.eventHash,
    command: {
      event: wireCanonicalEvent(event),
      signatures: [
        await input.signer.sign(event, REHEARSAL_RECOGNITION_DOMAIN),
      ],
    },
  };
}
