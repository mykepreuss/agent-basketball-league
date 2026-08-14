import type {
  ProjectionOutboxEvent,
  ProjectionOutboxStore,
} from "@abl/database";
import type { ResourceScheduleRatificationReader } from "@abl/institutions";

import {
  caseProjectionEnvelopeFromOutbox,
  verifyCaseProjectionEvent,
} from "./case-envelope.js";
import type { PublicCaseProjectionWriter } from "./case-repository.js";
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
import {
  governanceProjectionEnvelopeFromOutbox,
  verifyGovernanceProjectionEvent,
} from "./governance-envelope.js";
import type { PublicGovernanceProjectionWriter } from "./governance-repository.js";
import {
  modelProjectionEnvelopeFromOutbox,
  verifyModelProjectionEvent,
} from "./model-envelope.js";
import type { PublicModelProjectionWriter } from "./model-repository.js";
import type { PublicProjectionWriter } from "./repository.js";
import {
  resourceProjectionEnvelopeFromOutbox,
  verifyResourceProjectionEvent,
} from "./resource-envelope.js";
import type { PublicResourceProjectionWriter } from "./resource-repository.js";
import type { ProjectionEventSink } from "./transport.js";

type WorkerDestination =
  | {
      writer: PublicProjectionWriter;
      contractWriter?: PublicContractProjectionWriter;
      governanceWriter?: PublicGovernanceProjectionWriter;
      caseWriter?: PublicCaseProjectionWriter;
      resourceWriter?: PublicResourceProjectionWriter;
      modelWriter?: PublicModelProjectionWriter;
      sink?: never;
    }
  | {
      sink: ProjectionEventSink;
      writer?: never;
      contractWriter?: never;
      governanceWriter?: never;
      caseWriter?: never;
      resourceWriter?: never;
      modelWriter?: never;
    };

const projectionTopics = [
  "public.game",
  "public.contracts",
  "public.governance",
  "public.cases",
  "public.resources",
  "public.models",
] as const;
type ProjectionTopic = (typeof projectionTopics)[number];
const governanceTopicIndex = projectionTopics.indexOf("public.governance");
const resourceTopicIndex = projectionTopics.indexOf("public.resources");

export class PublicProjectionWorker {
  readonly #store: ProjectionOutboxStore;
  readonly #destination: WorkerDestination;
  readonly #authority: ProjectionVerificationAuthority;
  readonly #contractClubGovernors: Readonly<Record<string, string>> | undefined;
  readonly #governanceEligibilitySnapshotDigest: string | undefined;
  readonly #caseTribunalDids: readonly string[] | undefined;
  readonly #caseAppellateDids: readonly string[] | undefined;
  readonly #resourceScheduleRatification:
    | ResourceScheduleRatificationReader["resourceScheduleRatification"]
    | undefined;
  readonly #now: () => Date;
  #nextTopic = 0;

  public constructor(
    input: {
      store: ProjectionOutboxStore;
      now?: () => Date;
      contractClubGovernors?: Readonly<Record<string, string>>;
      governanceEligibilitySnapshotDigest?: string;
      caseTribunalDids?: readonly string[];
      caseAppellateDids?: readonly string[];
      resourceScheduleRatification?: ResourceScheduleRatificationReader["resourceScheduleRatification"];
    } & ProjectionVerificationAuthority &
      WorkerDestination,
  ) {
    this.#store = input.store;
    if (input.sink !== undefined) {
      this.#destination = { sink: input.sink };
    } else if (
      input.contractWriter === undefined &&
      input.governanceWriter === undefined &&
      input.caseWriter === undefined &&
      input.resourceWriter === undefined &&
      input.modelWriter === undefined
    ) {
      this.#destination = { writer: input.writer };
    } else {
      const destination: {
        writer: PublicProjectionWriter;
        contractWriter?: PublicContractProjectionWriter;
        governanceWriter?: PublicGovernanceProjectionWriter;
        caseWriter?: PublicCaseProjectionWriter;
        resourceWriter?: PublicResourceProjectionWriter;
        modelWriter?: PublicModelProjectionWriter;
      } = {
        writer: input.writer,
      };
      if (input.contractWriter !== undefined)
        destination.contractWriter = input.contractWriter;
      if (input.governanceWriter !== undefined)
        destination.governanceWriter = input.governanceWriter;
      if (input.caseWriter !== undefined)
        destination.caseWriter = input.caseWriter;
      if (input.resourceWriter !== undefined)
        destination.resourceWriter = input.resourceWriter;
      if (input.modelWriter !== undefined)
        destination.modelWriter = input.modelWriter;
      this.#destination = destination;
    }
    this.#authority = {
      domain: input.domain,
      admittedAgents: input.admittedAgents,
    };
    this.#contractClubGovernors = input.contractClubGovernors;
    this.#governanceEligibilitySnapshotDigest =
      input.governanceEligibilitySnapshotDigest;
    this.#caseTribunalDids = input.caseTribunalDids;
    this.#caseAppellateDids = input.caseAppellateDids;
    this.#resourceScheduleRatification = input.resourceScheduleRatification;
    this.#now = input.now ?? (() => new Date());
  }

  async #publishGame(event: ProjectionOutboxEvent): Promise<void> {
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
  }

  async #publishContract(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = contractProjectionEnvelopeFromOutbox(event);
    if (this.#contractClubGovernors === undefined)
      throw new Error("Contract projection authority is not configured");
    const verified = await verifyContractProjectionEvent(envelope, {
      ...this.#authority,
      contractClubGovernors: this.#contractClubGovernors,
    });
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
  }

  async #publishGovernance(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = governanceProjectionEnvelopeFromOutbox(event);
    if (this.#governanceEligibilitySnapshotDigest === undefined)
      throw new Error("Governance projection authority is not configured");
    const verified = await verifyGovernanceProjectionEvent(envelope, {
      ...this.#authority,
      governanceEligibilitySnapshotDigest:
        this.#governanceEligibilitySnapshotDigest,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.governanceWriter === undefined)
        throw new Error("Governance projection writer is not configured");
      await this.#destination.governanceWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishCase(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = caseProjectionEnvelopeFromOutbox(event);
    if (
      this.#caseTribunalDids === undefined ||
      this.#caseAppellateDids === undefined
    ) {
      throw new Error("Case projection authority is not configured");
    }
    const verified = await verifyCaseProjectionEvent(envelope, {
      ...this.#authority,
      caseTribunalDids: this.#caseTribunalDids,
      caseAppellateDids: this.#caseAppellateDids,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.caseWriter === undefined)
        throw new Error("Case projection writer is not configured");
      await this.#destination.caseWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishResource(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = resourceProjectionEnvelopeFromOutbox(event);
    if (this.#resourceScheduleRatification === undefined)
      throw new Error("Resource schedule ratification is not configured");
    const verified = await verifyResourceProjectionEvent(envelope, {
      ...this.#authority,
      resourceScheduleRatification: this.#resourceScheduleRatification,
    });
    if (this.#destination.sink === undefined) {
      if (this.#destination.resourceWriter === undefined)
        throw new Error(
          "Resource schedule projection writer is not configured",
        );
      await this.#destination.resourceWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publishModel(event: ProjectionOutboxEvent): Promise<void> {
    const envelope = modelProjectionEnvelopeFromOutbox(event);
    const verified = await verifyModelProjectionEvent(
      envelope,
      this.#authority,
    );
    if (this.#destination.sink === undefined) {
      if (this.#destination.modelWriter === undefined)
        throw new Error("Model projection writer is not configured");
      await this.#destination.modelWriter.publish(
        envelope,
        verified.expectedVersion,
        this.#now().toISOString(),
      );
    } else {
      await this.#destination.sink.publish(envelope);
    }
    await this.#store.markProjected(event.outboxId, this.#now());
  }

  async #publish(
    topic: ProjectionTopic,
    event: ProjectionOutboxEvent,
  ): Promise<void> {
    switch (topic) {
      case "public.game":
        return this.#publishGame(event);
      case "public.contracts":
        return this.#publishContract(event);
      case "public.governance":
        return this.#publishGovernance(event);
      case "public.cases":
        return this.#publishCase(event);
      case "public.resources":
        return this.#publishResource(event);
      case "public.models":
        return this.#publishModel(event);
    }
  }

  public async drain(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new Error("Projection drain limit is invalid");
    const queues = await Promise.all(
      projectionTopics.map((topic) =>
        this.#store.pendingProjectionEvents(limit, topic),
      ),
    );
    const positions = projectionTopics.map(() => 0);
    let published = 0;
    while (published < limit) {
      let selected = -1;
      if (
        positions[resourceTopicIndex]! < queues[resourceTopicIndex]!.length &&
        positions[governanceTopicIndex]! < queues[governanceTopicIndex]!.length
      ) {
        selected = governanceTopicIndex;
      } else {
        for (let offset = 0; offset < projectionTopics.length; offset += 1) {
          const candidate =
            (this.#nextTopic + offset) % projectionTopics.length;
          if (positions[candidate]! < queues[candidate]!.length) {
            selected = candidate;
            break;
          }
        }
      }
      if (selected === -1) break;
      const topic = projectionTopics[selected]!;
      const event = queues[selected]![positions[selected]!]!;
      positions[selected]! += 1;
      await this.#publish(topic, event);
      published += 1;
      this.#nextTopic = (selected + 1) % projectionTopics.length;
    }
    return published;
  }
}
