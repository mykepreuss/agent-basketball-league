import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();

export interface ServiceRequestIdentity {
  serviceId: string;
  secret: Uint8Array;
  capabilities: ReadonlySet<string>;
}

export interface ServiceRequestInput {
  method: string;
  path: string;
  body: Uint8Array;
  nonce: string;
  timestamp: string;
  expectedVersion: string;
  capability: string;
}

export interface SignedServiceRequestHeaders {
  "x-abl-service-id": string;
  "x-abl-capability": string;
  "x-abl-nonce": string;
  "x-abl-timestamp": string;
  "x-abl-expected-version": string;
  "x-abl-content-sha256": string;
  "x-abl-signature": string;
}

export class ServiceAuthenticationError extends Error {
  public override readonly name = "ServiceAuthenticationError";
}

export class ServiceReplayError extends Error {
  public override readonly name = "ServiceReplayError";
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalServiceRequest(
  serviceId: string,
  input: ServiceRequestInput,
): string {
  if (
    !input.path.startsWith("/") ||
    input.path.startsWith("//") ||
    input.path.includes("\\")
  ) {
    throw new ServiceAuthenticationError(
      "Service request path is not canonical",
    );
  }
  return [
    "ABL-SERVICE-REQUEST-V1",
    serviceId,
    input.capability,
    input.method.toUpperCase(),
    input.path,
    input.nonce,
    input.timestamp,
    input.expectedVersion,
    sha256(input.body),
  ].join("\n");
}

export function signServiceRequest(
  identity: ServiceRequestIdentity,
  input: ServiceRequestInput,
): SignedServiceRequestHeaders {
  if (!identity.capabilities.has(input.capability)) {
    throw new ServiceAuthenticationError(
      "Service identity lacks requested capability",
    );
  }
  const contentSha256 = sha256(input.body);
  const signature = createHmac("sha256", identity.secret)
    .update(canonicalServiceRequest(identity.serviceId, input))
    .digest("base64url");
  return {
    "x-abl-service-id": identity.serviceId,
    "x-abl-capability": input.capability,
    "x-abl-nonce": input.nonce,
    "x-abl-timestamp": input.timestamp,
    "x-abl-expected-version": input.expectedVersion,
    "x-abl-content-sha256": contentSha256,
    "x-abl-signature": signature,
  };
}

export class ServiceRequestVerifier {
  readonly #identities: ReadonlyMap<string, ServiceRequestIdentity>;
  readonly #usedNonces = new Set<string>();
  readonly #maximumClockSkewMs: number;
  readonly #now: () => number;

  public constructor(
    identities: readonly ServiceRequestIdentity[],
    options: { maximumClockSkewMs?: number; now?: () => number } = {},
  ) {
    this.#identities = new Map(
      identities.map((identity) => [identity.serviceId, identity]),
    );
    this.#maximumClockSkewMs = options.maximumClockSkewMs ?? 60_000;
    this.#now = options.now ?? Date.now;
  }

  public verify(
    headers: SignedServiceRequestHeaders,
    input: Omit<
      ServiceRequestInput,
      "nonce" | "timestamp" | "expectedVersion" | "capability"
    >,
  ): void {
    const identity = this.#identities.get(headers["x-abl-service-id"]);
    if (identity === undefined)
      throw new ServiceAuthenticationError("Unknown service identity");
    const capability = headers["x-abl-capability"];
    if (!identity.capabilities.has(capability)) {
      throw new ServiceAuthenticationError(
        "Service identity lacks requested capability",
      );
    }
    const timestampMs = Date.parse(headers["x-abl-timestamp"]);
    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(this.#now() - timestampMs) > this.#maximumClockSkewMs
    ) {
      throw new ServiceAuthenticationError(
        "Service request timestamp is outside the permitted window",
      );
    }
    if (headers["x-abl-content-sha256"] !== sha256(input.body)) {
      throw new ServiceAuthenticationError(
        "Service request body commitment mismatch",
      );
    }
    const replayKey = `${identity.serviceId}:${headers["x-abl-nonce"]}`;
    if (this.#usedNonces.has(replayKey))
      throw new ServiceReplayError("Service request nonce was already used");
    const expected = signServiceRequest(identity, {
      ...input,
      capability,
      nonce: headers["x-abl-nonce"],
      timestamp: headers["x-abl-timestamp"],
      expectedVersion: headers["x-abl-expected-version"],
    });
    const actualBytes = encoder.encode(headers["x-abl-signature"]);
    const expectedBytes = encoder.encode(expected["x-abl-signature"]);
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw new ServiceAuthenticationError("Invalid service request signature");
    }
    this.#usedNonces.add(replayKey);
  }
}
