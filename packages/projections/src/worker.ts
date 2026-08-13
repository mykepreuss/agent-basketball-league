import type { ProjectionOutboxStore } from "@abl/database";

import {
  contractProjectionEnvelopeFromOutbox,
  verifyContractProjectionEvent,
} from "./contract-envelope.js";
import type { PublicContractProjectionWriter } from "./contract-repository.js";
import {
  projectionEnvelopeFromOutbox,
  verifyProjectionEvent,
  type ProjectionVerificationAuthority,
} from "./envelope.js";
import type { PublicProjectionWriter } from "./repository.js";
import type { ProjectionEventSink } from "./transport.js";

type WorkerDestination =
  | {
      writer: PublicProjectionWriter;
      contractWriter?: PublicContractProjectionWriter;
      sink?: never;
    }
  | { sink: ProjectionEventSink; writer?: never; contractWriter?: never };

export class PublicProjectionWorker {
  readonly #store: ProjectionOutboxStore;
  readonly #destination: WorkerDestination;
  readonly #authority: ProjectionVerificationAuthority;
  readonly #now: () => Date;

  public constructor(
    input: {
      store: ProjectionOutboxStore;
      now?: () => Date;
    } & ProjectionVerificationAuthority &
      WorkerDestination,
  ) {
    this.#store = input.store;
    if (input.sink !== undefined) {
      this.#destination = { sink: input.sink };
    } else if (input.contractWriter === undefined) {
      this.#destination = { writer: input.writer };
    } else {
      this.#destination = {
        writer: input.writer,
        contractWriter: input.contractWriter,
      };
    }
    this.#authority = {
      domain: input.domain,
      admittedAgents: input.admittedAgents,
    };
    this.#now = input.now ?? (() => new Date());
  }

  public async drain(limit = 100): Promise<number> {
    let published = 0;
    const gameEvents = await this.#store.pendingProjectionEvents(
      limit,
      "public.game",
    );
    for (const event of gameEvents) {
      const envelope = projectionEnvelopeFromOutbox(event);
      const verified = await verifyProjectionEvent(
        envelope,
        this.#authority,
        this.#now,
      );
      if (this.#destination.sink === undefined) {
        await this.#destination.writer.publish(
          verified.projection,
          verified.expectedVersion,
          envelope,
        );
      } else {
        await this.#destination.sink.publish(envelope);
      }
      await this.#store.markProjected(event.outboxId, this.#now());
      published += 1;
    }
    const remaining = Math.max(0, limit - published);
    if (remaining === 0) return published;
    const contractEvents = await this.#store.pendingProjectionEvents(
      remaining,
      "public.contracts",
    );
    for (const event of contractEvents) {
      const envelope = contractProjectionEnvelopeFromOutbox(event);
      const verified = await verifyContractProjectionEvent(
        envelope,
        this.#authority,
      );
      if (this.#destination.sink === undefined) {
        if (this.#destination.contractWriter === undefined)
          throw new Error("Contract projection writer is not configured");
        await this.#destination.contractWriter.publish(
          envelope,
          verified.expectedVersion,
          this.#now().toISOString(),
        );
      } else {
        await this.#destination.sink.publish(envelope);
      }
      await this.#store.markProjected(event.outboxId, this.#now());
      published += 1;
    }
    return published;
  }
}
