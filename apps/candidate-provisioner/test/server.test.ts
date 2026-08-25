import { describe, expect, it } from "vitest";

import { createCandidateProvisionerServer } from "../src/server.js";
import {
  BlaxelCandidateSandboxControlPlane,
  candidateFixedBrokerName,
  candidateSandboxName,
  type CandidateRuntimeAssignment,
  type CandidateSandboxFactory,
} from "../src/blaxel-control-plane.js";

function assignment(
  applicationId: string,
  suffix: string,
): CandidateRuntimeAssignment {
  return {
    applicationId,
    fixedBrokerOrigin: `https://broker-${suffix}.example/`,
    fixedBrokerResourceName: candidateFixedBrokerName(applicationId),
    capabilityTokenBase64: Buffer.alloc(32, 7).toString("base64"),
    previewToken: `preview-token-${suffix}-with-at-least-32-bytes`,
  };
}

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
      controlPlaneMode: "DRY_RUN",
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
    const imageReference =
      "sandbox/abl-alpha-r01-body-image:b05103ad9158991c22153";
    let requested:
      | Parameters<CandidateSandboxFactory["createIfNotExists"]>[0]
      | null = null;
    let createdBody: Awaited<
      ReturnType<CandidateSandboxFactory["createIfNotExists"]>
    > | null = null;
    const removed: string[] = [];
    const broker = {
      metadata: {
        name: candidateFixedBrokerName(applicationId),
        externalId: applicationId,
        workspace: "agent-basketball-league",
      },
      spec: {
        enabled: true,
        region: "us-was-1",
        volumes: null,
        runtime: {
          image:
            "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
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
          spec: { ...resource.spec, volumes: null },
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
      runtimeScope: {
        mode: "BOUNDED_SINGLE",
        assignment: assignment(applicationId, "candidate-one"),
      },
      authorizationId: "ABL-FOUNDING-ALPHA-TEST-001",
      fixedBrokerImageReference:
        "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
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
        network: { allowedDomains: ["broker-candidate-one.example"] },
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
        candidateFixedBrokerName(applicationId),
      ],
    });
    expect(removed).toEqual([
      candidateSandboxName(applicationId),
      candidateFixedBrokerName(applicationId),
    ]);
  });

  it("provisions persistent founding careers from a capped assignment registry", async () => {
    const applicationIds = [
      "0198e000-0000-7000-8000-000000000011",
      "0198e000-0000-7000-8000-000000000012",
    ];
    const assignments = applicationIds.map((applicationId, index) =>
      assignment(applicationId, `founder-${index + 1}`),
    );
    const requested: Array<
      Parameters<CandidateSandboxFactory["createIfNotExists"]>[0]
    > = [];
    const factory: CandidateSandboxFactory = {
      async get(name) {
        const runtime = assignments.find(
          ({ fixedBrokerResourceName }) => fixedBrokerResourceName === name,
        );
        if (runtime === undefined) throw new Error("unknown broker");
        return {
          metadata: {
            name,
            externalId: runtime.applicationId,
            workspace: "agent-basketball-league",
          },
          spec: {
            enabled: true,
            region: "us-was-1",
            volumes: null,
            runtime: {
              image:
                "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
              ports: [{ name: "http", protocol: "HTTP", target: 3_000 }],
            },
          },
        } as never;
      },
      async createIfNotExists(input) {
        requested.push(input);
        const resource = input as Extract<typeof input, { metadata: unknown }>;
        return {
          metadata: {
            ...resource.metadata,
            workspace: "agent-basketball-league",
          },
          spec: { ...resource.spec, volumes: null },
        } as never;
      },
      async list() {
        return { data: [] };
      },
      async delete() {},
    };
    const controlPlane = new BlaxelCandidateSandboxControlPlane({
      workspace: "agent-basketball-league",
      region: "us-was-1",
      imageReference: "sandbox/abl-alpha-r01-body-image:b05103ad9158991c22153",
      runtimeScope: { mode: "CAPPED_FOUNDING", assignments },
      authorizationId: "ABL-COMPLETION-01-CAPPED-FOUNDING",
      fixedBrokerImageReference:
        "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
      factory,
    });

    for (const [index, applicationId] of applicationIds.entries())
      await controlPlane.provision({
        applicationId,
        candidateDid: `did:abl:founder-${index + 1}`,
        roleClass: index === 0 ? "PLAYER" : "REFEREE",
        formerOperatorSigningAddress: `0x${String(index + 1).repeat(40)}`,
        commandCommitment: `0x${String(index + 3).repeat(64)}`,
      });

    expect(requested).toHaveLength(2);
    for (const [index, request] of requested.entries()) {
      const resource = request as Extract<
        typeof request,
        { metadata: unknown }
      >;
      expect(resource.metadata.name).toBe(
        candidateSandboxName(applicationIds[index]!),
      );
      expect(resource.spec.lifecycle).toBeUndefined();
      expect(resource.spec.volumes).toBeUndefined();
    }
  });

  it("provisions one persistent post-Genesis career without reopening the founding cap", async () => {
    const applicationId = "0198e000-0000-7000-8000-000000000021";
    const runtime = assignment(applicationId, "post-genesis-21");
    let requested:
      | Parameters<CandidateSandboxFactory["createIfNotExists"]>[0]
      | undefined;
    const factory: CandidateSandboxFactory = {
      async get() {
        return {
          metadata: {
            name: runtime.fixedBrokerResourceName,
            externalId: applicationId,
            workspace: "agent-basketball-league",
          },
          spec: {
            enabled: true,
            region: "us-was-1",
            volumes: null,
            runtime: {
              image:
                "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
              ports: [{ name: "http", protocol: "HTTP", target: 3_000 }],
            },
          },
        } as never;
      },
      async createIfNotExists(input) {
        requested = input;
        const resource = input as Extract<typeof input, { metadata: unknown }>;
        return {
          metadata: {
            ...resource.metadata,
            workspace: "agent-basketball-league",
          },
          spec: { ...resource.spec, volumes: null },
        } as never;
      },
      async list() {
        return { data: [] };
      },
      async delete() {},
    };
    const options = {
      workspace: "agent-basketball-league",
      region: "us-was-1",
      imageReference: "sandbox/abl-alpha-r01-body-image:b05103ad9158991c22153",
      runtimeScope: { mode: "POST_GENESIS_SINGLE", assignment: runtime },
      authorizationId: "ABL-COMPLETION-01-POST-GENESIS-ADMISSION",
      genesisEvidenceDigest: `0x${"a".repeat(64)}`,
      fixedBrokerImageReference:
        "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
    } as const;
    const controlPlane = new BlaxelCandidateSandboxControlPlane({
      ...options,
      factory,
    });

    await expect(
      controlPlane.provision({
        applicationId,
        candidateDid: "did:abl:post-genesis-media-21",
        roleClass: "MEDIA",
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
        labels: { "abl-runtime-contract": expect.any(String) },
      },
      spec: {
        region: "us-was-1",
        network: { allowedDomains: ["broker-post-genesis-21.example"] },
      },
    });
    expect(
      (requested as unknown as { spec: { lifecycle?: unknown } }).spec
        .lifecycle,
    ).toBeUndefined();

    expect(
      () =>
        new BlaxelCandidateSandboxControlPlane({
          ...options,
          runtimeScope: {
            mode: "POST_GENESIS_SINGLE",
            assignment: {
              ...runtime,
              fixedBrokerResourceName: "operator-selected-broker",
            },
          },
        }),
    ).toThrow("not application-derived");

    const { genesisEvidenceDigest: _genesisEvidenceDigest, ...withoutGenesis } =
      options;
    expect(
      () => new BlaxelCandidateSandboxControlPlane(withoutGenesis),
    ).toThrow();
  });

  it("reports the configured live control-plane mode without claiming canonical authority", async () => {
    const app = createCandidateProvisionerServer({
      provisioner: {} as never,
      authorizationToken: "internal-token-with-at-least-32-bytes",
      controlPlaneMode: "APPROVED_LIVE",
    });
    expect(
      (await app.inject({ method: "GET", url: "/healthz" })).json(),
    ).toEqual({
      ok: true,
      controlPlaneMode: "APPROVED_LIVE",
      canonicalAuthority: false,
    });
    await app.close();
  });

  it("caps the founding assignment registry at twenty unique careers", () => {
    const assignments = Array.from({ length: 21 }, (_, index) =>
      assignment(
        `0198e000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
        `capacity-${index + 1}`,
      ),
    );
    expect(
      () =>
        new BlaxelCandidateSandboxControlPlane({
          workspace: "agent-basketball-league",
          region: "us-was-1",
          imageReference:
            "sandbox/abl-alpha-r01-body-image:b05103ad9158991c22153",
          runtimeScope: { mode: "CAPPED_FOUNDING", assignments },
          authorizationId: "ABL-COMPLETION-01-CAPPED-FOUNDING",
          fixedBrokerImageReference:
            "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
        }),
    ).toThrow();
  });

  it("rejects unassigned applications, non-founding roles, and non-derived broker names", async () => {
    const applicationId = "0198e000-0000-7000-8000-000000000031";
    const runtime = assignment(applicationId, "founder-31");
    const options = {
      workspace: "agent-basketball-league",
      region: "us-was-1",
      imageReference: "sandbox/abl-alpha-r01-body-image:b05103ad9158991c22153",
      authorizationId: "ABL-COMPLETION-01-CAPPED-FOUNDING",
      fixedBrokerImageReference:
        "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
      factory: {
        get: async () => Promise.reject(new Error("must not read broker")),
        createIfNotExists: async () =>
          Promise.reject(new Error("must not create body")),
        list: async () => ({ data: [] }),
        delete: async () => undefined,
      },
    } as const;
    expect(
      () =>
        new BlaxelCandidateSandboxControlPlane({
          ...options,
          runtimeScope: {
            mode: "CAPPED_FOUNDING",
            assignments: [
              { ...runtime, fixedBrokerResourceName: "operator-chosen-broker" },
            ],
          },
        }),
    ).toThrow("not application-derived");

    const controlPlane = new BlaxelCandidateSandboxControlPlane({
      ...options,
      runtimeScope: { mode: "CAPPED_FOUNDING", assignments: [runtime] },
    });
    const request = {
      candidateDid: "did:abl:founder-31",
      formerOperatorSigningAddress: `0x${"1".repeat(40)}` as const,
      commandCommitment: `0x${"2".repeat(64)}` as const,
    };
    await expect(
      controlPlane.provision({
        ...request,
        applicationId: "0198e000-0000-7000-8000-000000000032",
        roleClass: "PLAYER",
      }),
    ).rejects.toThrow("not authorized for this application");
    await expect(
      controlPlane.provision({
        ...request,
        applicationId,
        roleClass: "MEDIA",
      }),
    ).rejects.toThrow("rejects a non-founding role");
  });

  it("refuses a live Job that targets a different candidate", async () => {
    const controlPlane = new BlaxelCandidateSandboxControlPlane({
      workspace: "agent-basketball-league",
      region: "us-was-1",
      imageReference: `registry.blaxel.ai/abl/body@sha256:${"a".repeat(64)}`,
      runtimeScope: {
        mode: "BOUNDED_SINGLE",
        assignment: assignment(
          "0198e000-0000-7000-8000-000000000001",
          "candidate-two",
        ),
      },
      authorizationId: "ABL-FOUNDING-ALPHA-TEST-002",
      fixedBrokerImageReference: `registry.blaxel.ai/abl/broker@sha256:${"b".repeat(64)}`,
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
      runtimeScope: {
        mode: "BOUNDED_SINGLE" as const,
        assignment: assignment(
          "0198e000-0000-7000-8000-000000000001",
          "candidate-three",
        ),
      },
      authorizationId: "ABL-FOUNDING-ALPHA-TEST-003",
      fixedBrokerImageReference:
        "sandbox/abl-alpha-r01-fixed-broker-image:11f8e87713b02c9446370",
    };
    expect(() => new BlaxelCandidateSandboxControlPlane(options)).toThrow();
    expect(
      () =>
        new BlaxelCandidateSandboxControlPlane({
          ...options,
          imageReference: "sandbox/abl-alpha-r01-body-image:operator-tag",
        }),
    ).toThrow();
    expect(
      () =>
        new BlaxelCandidateSandboxControlPlane({
          ...options,
          imageReference:
            "sandbox/abl-alpha-r01-body-image:b05103ad9158991c2215g",
        }),
    ).toThrow();
  });
});
