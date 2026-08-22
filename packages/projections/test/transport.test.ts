import { ServiceRequestVerifier } from "@abl/foundation";
import { describe, expect, it } from "vitest";

import {
  HttpProjectionEventSink,
  PROJECTION_APPEND_PATH,
  projectionEnvelopeBytes,
  type ProjectionEventEnvelope,
} from "../src/index.js";

const hash = `0x${"a".repeat(64)}` as const;
const signature = `0x${"b".repeat(130)}` as const;

function envelope(): ProjectionEventEnvelope {
  return {
    version: "1.0.0",
    topic: "public.game",
    event: {
      eventId: "event-1",
      actorDid: "did:abl:player-1",
      nonce: "event-nonce",
      idempotencyKey: "event-idempotency",
      aggregateType: "game-possession",
      aggregateId: "game-1",
      aggregateVersion: "1",
      eventType: "PossessionResolved",
      previousEventHash: null,
      payloadCommitment: hash,
      payload: {},
      stateRoot: hash,
      schemaDigest: hash,
      timestamp: "2026-08-13T10:00:00.000Z",
      eventHash: hash,
    },
    signature,
  };
}

describe("projection transport", () => {
  it("preserves a Blaxel agent base path and signs the canonical request", async () => {
    const now = Date.parse("2026-08-13T10:00:01.000Z");
    const identity = {
      serviceId: "core-projection-publisher",
      secret: new TextEncoder().encode("p".repeat(32)),
      capabilities: new Set(["projection:append"]),
    };
    const verifier = new ServiceRequestVerifier([identity], {
      now: () => now,
    });
    let deliveredUrl: string | undefined;
    const sink = new HttpProjectionEventSink({
      origin: "https://run.blaxel.ai/abl-public/agents/abl-public-api/",
      identity,
      previewToken: "projection-preview-token",
      now: () => now,
      createNonce: () => "projection-request-1",
      fetchImplementation: async (input, init) => {
        deliveredUrl = String(input);
        const headers = new Headers(init?.headers);
        expect(headers.get("x-blaxel-preview-token")).toBe(
          "projection-preview-token",
        );
        verifier.verify(
          {
            "x-abl-service-id": headers.get("x-abl-service-id")!,
            "x-abl-capability": headers.get("x-abl-capability")!,
            "x-abl-nonce": headers.get("x-abl-nonce")!,
            "x-abl-timestamp": headers.get("x-abl-timestamp")!,
            "x-abl-expected-version": headers.get("x-abl-expected-version")!,
            "x-abl-content-sha256": headers.get("x-abl-content-sha256")!,
            "x-abl-signature": headers.get("x-abl-signature")!,
          },
          {
            method: String(init?.method),
            path: PROJECTION_APPEND_PATH,
            body: new Uint8Array(init?.body as Uint8Array),
          },
        );
        return new Response('{"accepted":true}', { status: 201 });
      },
    });

    await sink.publish(envelope());
    expect(deliveredUrl).toBe(
      `https://run.blaxel.ai/abl-public/agents/abl-public-api${PROJECTION_APPEND_PATH}`,
    );
    expect(projectionEnvelopeBytes(envelope())).toBeInstanceOf(Uint8Array);
  });
});
