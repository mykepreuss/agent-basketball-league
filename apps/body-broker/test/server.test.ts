import {
  ServiceRequestVerifier,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import {
  createCanonicalEvent,
  createSigningIdentity,
  recoverCanonicalEventSigner,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import {
  CAREER_CAPABILITY_AGGREGATE_TYPE,
  CAREER_CAPABILITY_RENEWAL_EVENT_TYPE,
  CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL,
  SchemaVersion,
} from "@abl/schemas";
import {
  decryptContent,
  generateDomainKey,
  type EncryptedBlob,
} from "@abl/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  BrokerPolicyError,
  createBlaxelUpstreamCredential,
  createBodyBroker,
  type BrokerRoute,
} from "../src/server.js";

const clock = Date.parse("2026-08-13T08:00:00.000Z");
const capabilityToken = "body-capability-token-0000000000000001";
const clientCapability = {
  token: capabilityToken,
  expiresAt: new Date(clock + 3 * 60 * 60 * 1_000).toISOString(),
  operations: new Set([
    "canonical-event:sign",
    "proxy:core",
    "proxy:model",
    "storage:put",
  ]),
};
const authorizedHeaders = {
  authorization: `Bearer ${capabilityToken}`,
};
const serviceIdentity = {
  serviceId: "body-agent-a",
  secret: new TextEncoder().encode("body-agent-a-test-service-secret-0001"),
  capabilities: new Set(["core:command", "model:invoke", "private:ciphertext"]),
};
const recognitionDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
} as const;
const routes: BrokerRoute[] = [
  {
    name: "core",
    targetOrigin: "https://core.abl.invalid",
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/commands"],
    capability: "core:command",
    credential: { "x-blaxel-preview-token": "core-preview-token" },
  },
  {
    name: "model",
    targetOrigin: "https://model.abl.invalid",
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/responses"],
    capability: "model:invoke",
    credential: { authorization: "Bearer upstream-only-secret" },
  },
  {
    name: "private-storage",
    targetOrigin: "https://private.abl.invalid",
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/ciphertext"],
    capability: "private:ciphertext",
  },
];

const apps: Array<ReturnType<typeof createBodyBroker>> = [];
afterEach(async () =>
  Promise.all(apps.splice(0).map(async (app) => app.close())),
);

describe("fixed body broker", () => {
  it("builds only the two fixed Blaxel upstream authentication modes", () => {
    expect(
      createBlaxelUpstreamCredential({
        mode: "BLAXEL_PRIVATE_PREVIEW",
        token: "preview-token",
        workspace: null,
      }),
    ).toEqual({ "x-blaxel-preview-token": "preview-token" });
    expect(
      createBlaxelUpstreamCredential({
        mode: "BLAXEL_ACCESS_TOKEN",
        token: "access-token",
        workspace: "abl-core",
      }),
    ).toEqual({
      "x-blaxel-authorization": "Bearer access-token",
      "x-blaxel-workspace": "abl-core",
    });
    for (const invalid of [
      { mode: "ARBITRARY", token: "token", workspace: null },
      { mode: "BLAXEL_PRIVATE_PREVIEW", token: "token", workspace: "core" },
      { mode: "BLAXEL_ACCESS_TOKEN", token: "token", workspace: null },
      { mode: "BLAXEL_ACCESS_TOKEN", token: "token", workspace: "../core" },
      { mode: "BLAXEL_ACCESS_TOKEN", token: "", workspace: "core" },
    ])
      expect(() => createBlaxelUpstreamCredential(invalid)).toThrow(
        BrokerPolicyError,
      );
  });

  it("rejects invalid or ambiguous capability configuration before serving", () => {
    const invalidCapabilities = [
      { ...clientCapability, token: "too-short" },
      { ...clientCapability, expiresAt: new Date(clock).toISOString() },
      {
        ...clientCapability,
        expiresAt: new Date(clock + 4 * 60 * 60 * 1_000 + 1).toISOString(),
      },
      { ...clientCapability, operations: new Set<string>() },
    ];
    for (const capability of invalidCapabilities) {
      expect(() =>
        createBodyBroker({
          agentDid: "did:abl:agent-a",
          clientCapability: capability,
          serviceIdentity,
          routes,
          storageDomainKeys: new Map(),
          now: () => clock,
        }),
      ).toThrow("Invalid body capability configuration");
    }
    expect(() =>
      createBodyBroker({
        agentDid: "did:abl:agent-a",
        clientCapability,
        serviceIdentity,
        routes: [...routes, routes[0]!],
        storageDomainKeys: new Map(),
        now: () => clock,
      }),
    ).toThrow("Duplicate broker route name");
  });

  it("signs only the admitted DID's allowlisted canonical event types", async () => {
    const signingIdentity = createSigningIdentity(`0x${"9".repeat(64)}`);
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
      clientCapability,
      serviceIdentity,
      routes,
      storageDomainKeys: new Map(),
      now: () => clock,
      canonicalSigning: {
        identity: signingIdentity,
        domain: recognitionDomain,
        allowedEvents: new Set([
          "player-decision:ActionIntentSubmitted",
          "game-possession:PossessionResolved",
        ]),
      },
    });
    apps.push(app);
    const event = createCanonicalEvent({
      eventId: "body-broker-signing-event-0001",
      actorDid: "did:abl:agent-a",
      nonce: "1",
      idempotencyKey: "body-broker-signing-idempotency-0001",
      aggregateType: "player-decision",
      aggregateId: "H1",
      aggregateVersion: 1n,
      eventType: "ActionIntentSubmitted",
      previousEventHash: null,
      payload: { action: "HOLD" },
      stateRoot: sha256Commitment("state"),
      schemaDigest: sha256Commitment("schema"),
      timestamp: "2026-08-13T08:00:00.000Z",
    });
    const wireEvent = {
      ...event,
      aggregateVersion: event.aggregateVersion.toString(),
    };
    const allowed = await app.inject({
      method: "POST",
      url: "/v1/signing/canonical-event",
      headers: authorizedHeaders,
      payload: { event: wireEvent },
    });
    expect(allowed.statusCode).toBe(200);
    const signed = allowed.json<{
      signerAddress: `0x${string}`;
      signature: `0x${string}`;
    }>();
    expect(signed.signerAddress).toBe(signingIdentity.address);
    await expect(
      recoverCanonicalEventSigner(recognitionDomain, event, signed.signature),
    ).resolves.toBe(signingIdentity.address);

    for (const deniedEvent of [
      { ...wireEvent, actorDid: "did:abl:other-agent" },
      { ...wireEvent, eventType: "BallotCast" },
      { ...wireEvent, payload: { action: "SHOOT" } },
    ]) {
      const denied = await app.inject({
        method: "POST",
        url: "/v1/signing/canonical-event",
        headers: authorizedHeaders,
        payload: { event: deniedEvent },
      });
      expect(denied.statusCode).toBe(403);
    }
  });

  it("allows only named method/path routes and prevents URL smuggling", async () => {
    const calls: Array<{ target: URL; headers: Headers }> = [];
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
      clientCapability,
      serviceIdentity,
      routes,
      storageDomainKeys: new Map(),
      now: () => clock,
      createNonce: () => "nonce-safe-route-0001",
      fetchImplementation: async (target, init) => {
        calls.push({
          target: new URL(target instanceof Request ? target.url : target),
          headers: new Headers(init?.headers),
        });
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    apps.push(app);
    const allowed = await app.inject({
      method: "POST",
      url: "/v1/proxy",
      headers: authorizedHeaders,
      payload: {
        route: "core",
        method: "POST",
        path: "/v1/commands",
        body: {},
        expectedVersion: "0",
        idempotencyKey: "idempotency-safe-0001",
      },
    });
    expect(allowed.statusCode).toBe(200);
    for (const path of [
      "//attacker.invalid/x",
      "/v1/commands/../../admin",
      "/v1/commands/%2e%2e/admin",
      "/v1/commands/%2E%2E/admin",
      "/v1/commands/%2f..%2fadmin",
      "https://attacker.invalid/x",
    ]) {
      const denied = await app.inject({
        method: "POST",
        url: "/v1/proxy",
        headers: authorizedHeaders,
        payload: {
          route: "core",
          method: "POST",
          path,
          body: {},
          expectedVersion: "0",
          idempotencyKey: "idempotency-denied-0001",
        },
      });
      expect(denied.statusCode).toBe(403);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target.origin).toBe("https://core.abl.invalid");
    expect(calls[0]?.headers.get("x-blaxel-preview-token")).toBe(
      "core-preview-token",
    );
  });

  it("adds a route-scoped credential without accepting or returning arbitrary credentials", async () => {
    let capturedHeaders = new Headers();
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
      clientCapability,
      serviceIdentity,
      routes,
      storageDomainKeys: new Map(),
      now: () => clock,
      createNonce: () => "nonce-model-route-0001",
      fetchImplementation: async (_target, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response('{"output":"ok"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/proxy",
      headers: authorizedHeaders,
      payload: {
        route: "model",
        method: "POST",
        path: "/v1/responses",
        body: { input: "bounded observation" },
        expectedVersion: "1",
        idempotencyKey: "idempotency-model-0001",
        authorization: "Bearer attacker-value",
      },
    });
    expect(response.statusCode).toBe(400);

    const valid = await app.inject({
      method: "POST",
      url: "/v1/proxy",
      headers: authorizedHeaders,
      payload: {
        route: "model",
        method: "POST",
        path: "/v1/responses",
        body: { input: "bounded observation" },
        expectedVersion: "1",
        idempotencyKey: "idempotency-model-0002",
      },
    });
    expect(valid.statusCode).toBe(200);
    expect(capturedHeaders.get("authorization")).toBe(
      "Bearer upstream-only-secret",
    );
    expect(valid.body).not.toContain("upstream-only-secret");
  });

  it("requires an unexpired operation-scoped body capability", async () => {
    let now = clock;
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
      clientCapability: {
        ...clientCapability,
        operations: new Set(["proxy:core"]),
      },
      serviceIdentity,
      routes,
      storageDomainKeys: new Map(),
      now: () => now,
      createNonce: () => "nonce-capability-route-0001",
      fetchImplementation: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    apps.push(app);
    const payload = {
      route: "core",
      method: "POST",
      path: "/v1/commands",
      body: {},
      expectedVersion: "0",
      idempotencyKey: "idempotency-capability-0001",
    } as const;
    expect(
      (await app.inject({ method: "POST", url: "/v1/proxy", payload }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/proxy",
          headers: { authorization: "Bearer wrong-capability-token" },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/proxy",
          headers: authorizedHeaders,
          payload: { ...payload, route: "model" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/proxy",
          headers: authorizedHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(200);
    now = Date.parse(clientCapability.expiresAt);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/proxy",
          headers: authorizedHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("renews an expired capability only for the career signer and exact operations", async () => {
    let now = clock;
    const careerIdentity = createSigningIdentity(`0x${"7".repeat(64)}`);
    const renewedToken = "renewed-body-capability-token-000000000001";
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
      clientCapability: {
        token: capabilityToken,
        expiresAt: new Date(clock + 1_000).toISOString(),
        operations: new Set(["proxy:model"]),
      },
      serviceIdentity,
      routes,
      storageDomainKeys: new Map(),
      careerCapabilityRenewal: {
        signerAddress: careerIdentity.address,
        domain: recognitionDomain,
      },
      now: () => now,
      createCapabilityToken: () => renewedToken,
      fetchImplementation: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    apps.push(app);
    now += 2_000;
    const expiresAt = new Date(now + 4 * 60 * 60 * 1_000).toISOString();
    const payload = {
      schemaVersion: SchemaVersion,
      operations: ["proxy:model"],
      requestedExpiresAt: expiresAt,
    } as const;
    const event = createCanonicalEvent({
      eventId: "018f36a0-0000-7000-8000-000000000001",
      actorDid: "did:abl:agent-a",
      nonce: "renewal-nonce-0001",
      idempotencyKey: "018f36a0-0000-7000-8000-000000000002",
      aggregateType: CAREER_CAPABILITY_AGGREGATE_TYPE,
      aggregateId: "did:abl:agent-a",
      aggregateVersion: 1n,
      eventType: CAREER_CAPABILITY_RENEWAL_EVENT_TYPE,
      previousEventHash: null,
      payload,
      stateRoot: sha256Commitment(payload),
      schemaDigest: sha256Commitment(CAREER_CAPABILITY_RENEWAL_SCHEMA_LABEL),
      timestamp: new Date(now).toISOString(),
    });
    const command = {
      event: { ...event, aggregateVersion: "1" },
      signatures: [
        await signCanonicalEvent(careerIdentity, recognitionDomain, event),
      ],
    };
    const renewal = await app.inject({
      method: "POST",
      url: "/v1/capabilities/renew",
      payload: command,
    });
    expect(renewal.statusCode).toBe(200);
    expect(renewal.json()).toEqual({
      token: renewedToken,
      expiresAt,
      operations: ["proxy:model"],
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/proxy",
          headers: { authorization: `Bearer ${renewedToken}` },
          payload: {
            route: "model",
            method: "POST",
            path: "/v1/responses",
            body: {},
            expectedVersion: "0",
            idempotencyKey: "idempotency-renewed-model-0001",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/capabilities/renew",
          payload: command,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("encrypts plaintext inside the fixed kernel boundary before private storage", async () => {
    const key = await generateDomainKey();
    let capturedBlob: EncryptedBlob | undefined;
    const verifier = new ServiceRequestVerifier([serviceIdentity], {
      now: () => clock,
    });
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
      clientCapability,
      serviceIdentity,
      routes,
      storageDomainKeys: new Map([["personal:agent-a", key]]),
      now: () => clock,
      createNonce: () => "nonce-storage-route-0001",
      fetchImplementation: async (target, init) => {
        const bytes = new Uint8Array(init?.body as Uint8Array);
        const headers = Object.fromEntries(
          new Headers(init?.headers).entries(),
        ) as unknown as SignedServiceRequestHeaders;
        const targetUrl = new URL(
          target instanceof Request ? target.url : target,
        );
        verifier.verify(headers, {
          method: "POST",
          path: targetUrl.pathname,
          body: bytes,
        });
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
          callerDid: string;
          blob: EncryptedBlob;
        };
        expect(parsed.callerDid).toBe("did:abl:agent-a");
        capturedBlob = parsed.blob;
        return new Response('{"stored":true}', {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
    });
    apps.push(app);
    const plaintext = "private lesson never sent to storage in cleartext";
    const response = await app.inject({
      method: "POST",
      url: "/v1/storage/put",
      headers: authorizedHeaders,
      payload: {
        objectId: "lesson-1",
        domainId: "personal:agent-a",
        version: 1,
        previousVersionCommitment: null,
        contentType: "text/plain",
        plaintextBase64: Buffer.from(plaintext).toString("base64"),
        createdAt: "2026-08-13T08:00:00.000Z",
        expectedVersion: "0",
        idempotencyKey: "idempotency-storage-0001",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(JSON.stringify(capturedBlob)).not.toContain(plaintext);
    expect(
      new TextDecoder().decode(await decryptContent(key, capturedBlob!)),
    ).toBe(plaintext);

    const malformed = await app.inject({
      method: "POST",
      url: "/v1/storage/put",
      headers: authorizedHeaders,
      payload: {
        objectId: "lesson-2",
        domainId: "personal:agent-a",
        version: 1,
        previousVersionCommitment: null,
        contentType: "text/plain",
        plaintextBase64: "!!!",
        createdAt: "2026-08-13T08:00:00.000Z",
        expectedVersion: "0",
        idempotencyKey: "idempotency-storage-0002",
      },
    });
    expect(malformed.statusCode).toBe(400);
  });
});
