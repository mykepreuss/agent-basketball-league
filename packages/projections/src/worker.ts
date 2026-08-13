import type { ProjectionOutboxStore } from "@abl/database";

import {
  projectionEnvelopeFromOutbox,
  verifyProjectionEvent,
  type ProjectionVerificationAuthority,
} from "./envelope.js";
import type { PublicProjectionWriter } from "./repository.js";
import type { ProjectionEventSink } from "./transport.js";

type WorkerDestination =
  | { writer: PublicProjectionWriter; sink?: never }
  | { sink: ProjectionEventSink; writer?: never };

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
    this.#destination =
      input.sink === undefined
        ? { writer: input.writer }
        : { sink: input.sink };
    this.#authority = {
      domain: input.domain,
      admittedAgents: input.admittedAgents,
    };
    this.#now = input.now ?? (() => new Date());
  }

  public async drain(limit = 100): Promise<number> {
    const pending = await this.#store.pendingProjectionEvents(limit);
    let published = 0;
    for (const event of pending) {
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
    return published;
  }
}
