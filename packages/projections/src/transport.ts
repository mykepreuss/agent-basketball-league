import { randomUUID } from "node:crypto";

import {
  signServiceRequest,
  type ServiceRequestIdentity,
} from "@abl/foundation";

import {
  projectionEnvelopeBytes,
  type ProjectionEventEnvelope,
} from "./envelope.js";
import type { ContractProjectionEventEnvelope } from "./contract-envelope.js";
import type { GovernanceProjectionEventEnvelope } from "./governance-envelope.js";
import type { CaseProjectionEventEnvelope } from "./case-envelope.js";
import type { ResourceProjectionEventEnvelope } from "./resource-envelope.js";

export const PROJECTION_APPEND_CAPABILITY = "projection:append";
export const PROJECTION_APPEND_PATH = "/v1/internal/projections";

export type PublicProjectionEnvelope =
  | ProjectionEventEnvelope
  | ContractProjectionEventEnvelope
  | GovernanceProjectionEventEnvelope
  | CaseProjectionEventEnvelope
  | ResourceProjectionEventEnvelope;

export interface ProjectionEventSink {
  publish(envelope: PublicProjectionEnvelope): Promise<void>;
}

export class ProjectionTransportError extends Error {
  public override readonly name = "ProjectionTransportError";

  public constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
  }
}

export class HttpProjectionEventSink implements ProjectionEventSink {
  readonly #endpoint: URL;
  readonly #identity: ServiceRequestIdentity;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #createNonce: () => string;

  public constructor(input: {
    origin: string;
    identity: ServiceRequestIdentity;
    fetchImplementation?: typeof fetch;
    now?: () => number;
    createNonce?: () => string;
    allowHttpForTest?: boolean;
  }) {
    const origin = new URL(input.origin);
    if (
      (origin.protocol !== "https:" &&
        !(input.allowHttpForTest === true && origin.protocol === "http:")) ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.search !== "" ||
      origin.hash !== ""
    ) {
      throw new ProjectionTransportError("Projection origin is not allowed");
    }
    this.#endpoint = new URL(origin);
    const basePath = origin.pathname.replace(/\/$/, "");
    this.#endpoint.pathname = `${basePath}${PROJECTION_APPEND_PATH}`;
    this.#identity = input.identity;
    this.#fetch = input.fetchImplementation ?? fetch;
    this.#now = input.now ?? Date.now;
    this.#createNonce = input.createNonce ?? randomUUID;
  }

  public async publish(envelope: PublicProjectionEnvelope): Promise<void> {
    const body = projectionEnvelopeBytes(envelope);
    const expectedVersion = (
      BigInt(envelope.event.aggregateVersion) - 1n
    ).toString();
    const headers = signServiceRequest(this.#identity, {
      method: "POST",
      path: PROJECTION_APPEND_PATH,
      body,
      nonce: this.#createNonce(),
      timestamp: new Date(this.#now()).toISOString(),
      expectedVersion,
      capability: PROJECTION_APPEND_CAPABILITY,
    });
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: Buffer.from(body),
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ProjectionTransportError("Projection delivery failed");
    }
    const responseBody = await response.text();
    if (Buffer.byteLength(responseBody) > 64_000)
      throw new ProjectionTransportError(
        "Projection response exceeds the permitted size",
        response.status,
      );
    if (!response.ok)
      throw new ProjectionTransportError(
        `Projection endpoint rejected delivery with status ${response.status}`,
        response.status,
      );
  }
}
