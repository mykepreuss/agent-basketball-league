import { describe, expect, it } from "vitest";

import { createCandidateProvisionerServer } from "../src/server.js";
import {
  BlaxelCandidateSandboxControlPlane,
  candidateSandboxName,
  type CandidateSandboxFactory,
} from "../src/blaxel-control-plane.js";

describe("candidate provisioner private boundary", () => {
  it("conceals its only mutating route without narrow authorization", async () => {
    const provisioner = {
      process: async (applicationId: string) => ({
        applicationId,
        state: "VERIFIED_NOT_PROVISIONED",
      }),
    };
    const app = createCandidateProvisionerServer({
      provisioner: provisioner as never,
      authorizationToken: "internal-token-with-at-least-32-bytes",
    });
    const unauthorized = await app.inject({
      method: "POST",
      url: "/internal/v1/candidates/0198e000-0000-7000-8000-000000000001/provision",
    });
    expect(unauthorized.statusCode).toBe(404);
    const authorized = await app.inject({
      method: "POST",
      url: "/internal/v1/candidates/0198e000-0000-7000-8000-000000000001/provision",
      headers: {
        authorization: "Bearer internal-token-with-at-least-32-bytes",
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({
      state: "VERIFIED_NOT_PROVISIONED",
    });
    expect(app.hasRoute({ method: "POST", url: "/v1/canonical-command" })).toBe(
      false,
    );
    await app.close();
  });

  it("creates and narrowly tears down the authorized candidate Sandboxes", async () => {
    const applicationId = "0198e000-0000-7000-8000-000000000001";
    const imageReference = "sandbox/abl-alpha-r01-body-image:a1b2c3d4e5f6";
    let requested:
      | Parameters<CandidateSandboxFactory["createIfNotExists"]>[0]
      | null = null;
    let createdBody: Awaited<
      ReturnType<CandidateSandboxFactory["createIfNotExists"]>
    > | null = null;
    const removed: string[] = [];
    const broker = {
      metadata: {
        name: "abl-fixed-broker-candidate-one",
        externalId: applicationId,
        workspace: "agent-basketball-league",
      },
      spec: {
        enabled: true,
        region: "us-was-1",
        runtime: {
          image: "sandbox/abl-alpha-r01-fixed-broker-image:f6e5d4c3b2a1",
          ports: [{ name: "http", protocol: "HTTP", target: 3_000 }],
        },
      },
    } as never;
    const factory: CandidateSandboxFactory = {
      async get() {
        return broker;
      },
      async createIfNotExists(input) {
        requested = input;
        const resource = input as Extract<typeof input, { metadata: unknown }>;
        createdBody = {
          metadata: {
            ...resource.metadata,
            workspace: "agent-basketball-league",
          },
          spec: resource.spec,
        } as never;
        return createdBody;
      },
      async list() {
        return {
          data: createdBody === null ? [broker] : [createdBody, broker],
        };
      },
      async delete(name) {
        removed.push(name);
      },
    };
    const controlPlane = new BlaxelCandidateSandboxControlPlane({
      workspace: "agent-basketball-league",
      region: "us-was-1",
      imageReference,
      authorizedApplicationId: applicationId,
      authorizationId: "ABL-FOUNDING-ALPHA-TEST-001",
      fixedBrokerOrigin: "https://broker.example/",
      fixedBrokerHost: "broker.example",
      fixedBrokerResourceName: "abl-fixed-broker-candidate-one",
      fixedBrokerImageReference:
        "sandbox/abl-alpha-r01-fixed-broker-image:f6e5d4c3b2a1",
      capabilityTokenBase64: Buffer.alloc(32, 7).toString("base64"),
      previewToken: "preview-token-with-at-least-32-bytes",
      factory,
    });
    await expect(
      controlPlane.provision({
        applicationId,
        candidateDid: "did:abl:founding-candidate",
        roleClass: "PLAYER",
        formerOperatorSigningAddress: `0x${"1".repeat(40)}`,
        commandCommitment: `0x${"2".repeat(64)}`,
      }),
    ).resolves.toEqual({
      state: "PROVISIONED_AWAITING_TRANSFER",
      sandboxResourceName: candidateSandboxName(applicationId),
    });
    expect(requested).toMatchObject({
      metadata: {
        name: candidateSandboxName(applicationId),
        externalId: applicationId,
      },
      spec: {
        region: "us-was-1",
        lifecycle: {
          expirationPolicies: [
            { action: "delete", type: "ttl-max-age", value: "4h" },
          ],
          terminatedRetention: "24h",
        },
        network: { allowedDomains: ["broker.example"] },
        runtime: { image: imageReference, memory: 4_096 },
      },
    });
    expect(
      (requested as unknown as { spec: { volumes?: unknown } }).spec.volumes,
    ).toBeUndefined();
    await expect(
      controlPlane.deprovision({
        applicationId,
        sandboxResourceName: candidateSandboxName(applicationId),
      }),
    ).resolves.toEqual({
      state: "DEPROVISIONED",
      removedResourceNames: [
        candidateSandboxName(applicationId),
        "abl-fixed-broker-candidate-one",
      ],
    });
    expect(removed).toEqual([
      candidateSandboxName(applicationId),
      "abl-fixed-broker-candidate-one",
    ]);
  });

  it("refuses a live Job that targets a different candidate", async () => {
    const controlPlane = new BlaxelCandidateSandboxControlPlane({
      workspace: "agent-basketball-league",
      region: "us-was-1",
      imageReference: `registry.blaxel.ai/abl/body@sha256:${"a".repeat(64)}`,
      authorizedApplicationId: "0198e000-0000-7000-8000-000000000001",
      authorizationId: "ABL-FOUNDING-ALPHA-TEST-002",
      fixedBrokerOrigin: "https://broker.example/",
      fixedBrokerHost: "broker.example",
      fixedBrokerResourceName: "abl-fixed-broker-candidate-two",
      fixedBrokerImageReference: `registry.blaxel.ai/abl/broker@sha256:${"b".repeat(64)}`,
      capabilityTokenBase64: Buffer.alloc(32, 7).toString("base64"),
      factory: {
        get: async () => Promise.reject(new Error()),
        createIfNotExists: async () => Promise.reject(new Error()),
        list: async () => ({ data: [] }),
        delete: async () => undefined,
      },
    });
    await expect(
      controlPlane.provision({
        applicationId: "0198e000-0000-7000-8000-000000000002",
        candidateDid: "did:abl:other-candidate",
        roleClass: "PLAYER",
        formerOperatorSigningAddress: `0x${"1".repeat(40)}`,
        commandCommitment: `0x${"2".repeat(64)}`,
      }),
    ).rejects.toThrow("not authorized for this application");
  });

  it("rejects mutable or operator-selected Blaxel image tags", () => {
    const options = {
      workspace: "agent-basketball-league",
      region: "us-was-1",
      imageReference: "sandbox/abl-alpha-r01-body-image:latest",
      authorizedApplicationId: "0198e000-0000-7000-8000-000000000001",
      authorizationId: "ABL-FOUNDING-ALPHA-TEST-003",
      fixedBrokerOrigin: "https://broker.example/",
      fixedBrokerHost: "broker.example",
      fixedBrokerResourceName: "abl-fixed-broker-candidate-three",
      fixedBrokerImageReference:
        "sandbox/abl-alpha-r01-fixed-broker-image:f6e5d4c3b2a1",
      capabilityTokenBase64: Buffer.alloc(32, 7).toString("base64"),
    };
    expect(() => new BlaxelCandidateSandboxControlPlane(options)).toThrow();
    expect(
      () =>
        new BlaxelCandidateSandboxControlPlane({
          ...options,
          imageReference: "sandbox/abl-alpha-r01-body-image:operator-tag",
        }),
    ).toThrow();
  });
});
