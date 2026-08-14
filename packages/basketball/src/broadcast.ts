import { sha256Commitment } from "@abl/recognition";

import type { FullGameEvent } from "./full-game.js";

export interface BroadcastSegmentRecord {
  cursor: number;
  sourceSequence: number;
  previousSegmentHash: `0x${string}` | null;
  payloadCommitment: `0x${string}`;
  stateRoot: `0x${string}`;
  releaseAt: string;
  segmentHash: `0x${string}`;
}

export class PacedBroadcast {
  readonly #segments: BroadcastSegmentRecord[] = [];

  public publish(
    event: FullGameEvent,
    releaseAt: string,
  ): BroadcastSegmentRecord {
    if (event.sequence !== this.#segments.length)
      throw new Error(
        "Broadcast source sequence is lost, duplicated, or out of order",
      );
    if (!Number.isFinite(Date.parse(releaseAt)))
      throw new Error("Broadcast release time is invalid");
    const previousSegmentHash = this.#segments.at(-1)?.segmentHash ?? null;
    const segment: BroadcastSegmentRecord = {
      cursor: event.sequence,
      sourceSequence: event.sequence,
      previousSegmentHash,
      payloadCommitment: sha256Commitment({
        type: event.type,
        data: event.data,
      }),
      stateRoot: event.stateRoot,
      releaseAt,
      segmentHash: sha256Commitment({
        cursor: event.sequence,
        previousSegmentHash,
        eventHash: event.eventHash,
        releaseAt,
      }),
    };
    this.#segments.push(segment);
    return structuredClone(segment);
  }

  public cursor(now: string) {
    const released = this.#released(now);
    return {
      nextCursor: released.length,
      headSegmentHash: released.at(-1)?.segmentHash ?? null,
      authoritativeMode: "CURSOR" as const,
      manifestCommitment: sha256Commitment(released),
    };
  }

  public poll(
    afterCursor: number,
    now: string,
  ): readonly BroadcastSegmentRecord[] {
    return structuredClone(
      this.#released(now).filter((segment) => segment.cursor > afterCursor),
    );
  }

  public sseResume(lastEventId: number, now: string) {
    return {
      events: this.poll(lastEventId, now).map((segment) => ({
        id: segment.cursor,
        event: "segment" as const,
        data: segment,
      })),
      heartbeat: {
        event: "heartbeat" as const,
        data: { cursor: this.cursor(now).nextCursor, content: null },
      },
      recoveryMode: "CURSOR_AUTHORITATIVE" as const,
    };
  }

  #released(now: string): BroadcastSegmentRecord[] {
    const at = Date.parse(now);
    if (!Number.isFinite(at))
      throw new Error("Broadcast query time is invalid");
    return this.#segments.filter(
      (segment) => Date.parse(segment.releaseAt) <= at,
    );
  }
}
