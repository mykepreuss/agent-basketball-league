import {
  ServiceRequestVerifier,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import {
  decryptContent,
  generateDomainKey,
  type EncryptedBlob,
} from "@abl/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBodyBroker, type BrokerRoute } from "../src/server.js";

const clock = Date.parse("2026-08-13T08:00:00.000Z");
const serviceIdentity = {
  serviceId: "body-agent-a",
  secret: new TextEncoder().encode("body-agent-a-test-service-secret-0001"),
  capabilities: new Set(["core:command", "model:invoke", "private:ciphertext"]),
};
const routes: BrokerRoute[] = [
  {
    name: "core",
    targetOrigin: "https://core.abl.invalid",
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/commands"],
    capability: "core:command",
  },
  {
    name: "model",
    targetOrigin: "https://model.abl.invalid",
    methods: new Set(["POST"]),
    pathPrefixes: ["/v1/responses"],
    capability: "model:invoke",
    credential: {
      header: "authorization",
      value: "Bearer upstream-only-secret",
    },
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

describe("fixed local body broker", () => {
  it("allows only named method/path routes and prevents URL smuggling", async () => {
    const calls: URL[] = [];
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
      serviceIdentity,
      routes,
      storageDomainKeys: new Map(),
      now: () => clock,
      createNonce: () => "nonce-safe-route-0001",
      fetchImplementation: async (target) => {
        calls.push(new URL(target instanceof Request ? target.url : target));
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
    expect(calls[0]?.origin).toBe("https://core.abl.invalid");
  });

  it("adds a route-scoped credential without accepting or returning arbitrary credentials", async () => {
    let capturedHeaders = new Headers();
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
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

  it("encrypts plaintext inside the fixed kernel boundary before private storage", async () => {
    const key = await generateDomainKey();
    let capturedBlob: EncryptedBlob | undefined;
    const verifier = new ServiceRequestVerifier([serviceIdentity], {
      now: () => clock,
    });
    const app = createBodyBroker({
      agentDid: "did:abl:agent-a",
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
