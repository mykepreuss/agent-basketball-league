import { describe, expect, it } from "vitest";

import {
  ServiceAuthenticationError,
  ServiceReplayError,
  ServiceRequestVerifier,
  signServiceRequest,
  type ServiceRequestIdentity,
} from "../src/index.js";

const now = Date.parse("2026-08-13T07:00:00.000Z");
const identity: ServiceRequestIdentity = {
  serviceId: "competition-body-agent-a",
  secret: new TextEncoder().encode("local-test-secret-with-32-byte-minimum"),
  capabilities: new Set(["core:command", "private:ciphertext"]),
};
const input = {
  method: "POST",
  path: "/v1/commands",
  body: new TextEncoder().encode('{"command":"test"}'),
  nonce: "0198a000-0000-7000-8000-000000000001",
  timestamp: "2026-08-13T07:00:00.000Z",
  expectedVersion: "7",
  capability: "core:command",
};

describe("cross-domain service authentication", () => {
  it("binds identity, capability, route, body, nonce, time, and expected version", () => {
    const headers = signServiceRequest(identity, input);
    const verifier = new ServiceRequestVerifier([identity], { now: () => now });
    expect(() => verifier.verify(headers, input)).not.toThrow();
  });

  it("rejects tampering, ungranted capabilities, stale requests, and replay", () => {
    const headers = signServiceRequest(identity, input);
    const verifier = new ServiceRequestVerifier([identity], { now: () => now });
    expect(() =>
      verifier.verify(headers, {
        ...input,
        body: new TextEncoder().encode("tampered"),
      }),
    ).toThrow(ServiceAuthenticationError);
    expect(() =>
      signServiceRequest(identity, {
        ...input,
        capability: "database:connect",
      }),
    ).toThrow(ServiceAuthenticationError);

    const stale = signServiceRequest(identity, {
      ...input,
      timestamp: "2026-08-13T06:00:00.000Z",
    });
    expect(() => verifier.verify(stale, input)).toThrow(
      ServiceAuthenticationError,
    );

    const freshVerifier = new ServiceRequestVerifier([identity], {
      now: () => now,
    });
    freshVerifier.verify(headers, input);
    expect(() => freshVerifier.verify(headers, input)).toThrow(
      ServiceReplayError,
    );
  });
});
