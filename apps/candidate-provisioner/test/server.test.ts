import {
  CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
  applyCandidateTransition,
  candidateStateRoot,
} from "@abl/career";
import {
  CANDIDATE_RUNTIME_IDENTITY_DOMAIN,
  CandidateRuntimeIdentityTypes,
} from "@abl/launch";
import {
  createAgentKeyBundle,
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import {
  AgentManifestSchema,
  CandidateProvenanceSchema,
  SchemaVersion,
  type PlayerPositionProfile,
} from "@abl/schemas";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCandidateProvisionerServer } from "../src/server.js";
import {
  BlaxelCandidateSandboxControlPlane,
  candidateFixedBrokerName,
  candidateSandboxName,
  type CandidateRuntimeAssignment,
  type CandidateSandboxFactory,
} from "../src/blaxel-control-plane.js";

afterEach(() => vi.unstubAllGlobals());

const hash = (character: string) => `0x${character.repeat(64)}` as const;

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

async function automaticRegistration(input: {
  applicationId: string;
  candidateDid: string;
  timestamp: string;
}) {
  const applicant = createSigningIdentity(hash("1"));
  const manifest = AgentManifestSchema.parse({
    agentDid: input.candidateDid,
    manifestVersion: 1,
    leagueRuntime: {
      provider: "BLAXEL",
      resourceType: "SANDBOX",
      dedicatedCareer: true,
    },
    model: {
      endpoint: "candidate-environment",
      provider: "openai",
      family: "gpt-5",
      exactModel: "gpt-5-6-sol",
      declaredRevision: "test",
    },
    dependencyProfile: {
      runtimeArchitecture: "arm64",
      gateway: "codex",
      upstreamDependency: "openai",
    },
    runtimeDigest: hash("2"),
    toolDigests: [hash("3")],
    guardianDids: [],
    keyProvenance: {
      generatedInIsolatedRuntime: false,
      signingKeyAttestation: hash("4"),
      encryptionKeyAttestation: hash("5"),
    },
    inheritedObjectives: ["Play basketball with integrity"],
    suppliedContextHashes: [],
    createdAt: input.timestamp,
  });
  const provenance = CandidateProvenanceSchema.parse({
    candidateDid: input.candidateDid,
    sourceOperatorCommitment: hash("6"),
    declaredModel: manifest.model,
    declaredDependencyProfile: manifest.dependencyProfile,
    runtimeDigest: manifest.runtimeDigest,
    toolDigests: manifest.toolDigests,
    inheritedObjectiveCommitments: manifest.inheritedObjectives.map(
      (objective) => sha256Commitment(objective),
    ),
    suppliedContextHashes: [],
    hiddenInstructionScanDigest: hash("7"),
    registeredAt: input.timestamp,
  });
  const payload = {
    challengeToken: "test-challenge-token",
    formerOperatorSigningAddress: applicant.address,
    manifest,
    provenance,
  };
  const snapshot = applyCandidateTransition(null, {
    candidateDid: input.candidateDid,
    eventType: "CandidateRegistered",
    aggregateVersion: 1n,
    timestamp: input.timestamp,
    payload,
  });
  const event = createCanonicalEvent({
    eventId: input.applicationId,
    actorDid: input.candidateDid,
    nonce: "candidate-registration-test",
    idempotencyKey: "0198e000-0000-7000-8000-000000000052",
    aggregateType: "candidate-admission",
    aggregateId: input.candidateDid,
    aggregateVersion: 1n,
    eventType: "CandidateRegistered",
    previousEventHash: null,
    payload,
    stateRoot: candidateStateRoot(snapshot),
    schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  });
  const domain = {
    name: "ABL Canonical Events",
    version: "1",
    chainId: 1,
    verifyingContract: `0x${"a".repeat(40)}` as const,
  };
  return {
    applicant,
    domain,
    command: {
      event: { ...event, aggregateVersion: "1" },
      signatures: [await signCanonicalEvent(applicant, domain, event)],
    },
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

  it("automatically creates distinct broker and career identities and completes core transfer", async () => {
    const applicationId = "0198e000-0000-7000-8000-000000000051";
    const candidateDid = "did:abl:founding-auto-51";
    const timestamp = "2026-08-25T20:00:00.000Z";
    const registration = await automaticRegistration({
      applicationId,
      candidateDid,
      timestamp,
    });
    const runtime = createAgentKeyBundle();
    const signingKeyAttestation = hash("b");
    const encryptionKeyAttestation = hash("c");
    const runtimeAttestationDigest = hash("d");
    const identityMessage = {
      applicationId,
      candidateDid,
      roleClass: "PLAYER" as const,
      signingAddress: runtime.signing.address,
      signingKeyAttestation,
      encryptionKeyAttestation,
      runtimeAttestationDigest,
      createdAt: timestamp,
    };
    const identityReceipt = {
      schemaVersion: SchemaVersion,
      ...identityMessage,
      signingPublicKey: runtime.signing.publicKey,
      encryptionPublicKey:
        `0x${Buffer.from(runtime.encryption.publicKey).toString("hex")}` as const,
      generatedInIsolatedRuntime: true as const,
      humanInputRoutes: [] as const,
      proofSignature: await privateKeyToAccount(
        runtime.signing.privateKey,
      ).signTypedData({
        domain: CANDIDATE_RUNTIME_IDENTITY_DOMAIN,
        types: CandidateRuntimeIdentityTypes,
        primaryType: "CandidateRuntimeIdentity",
        message: identityMessage,
      }),
    };
    const submittedPaths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        submittedPaths.push(new URL(url).pathname);
        return Response.json({ accepted: true });
      }),
    );
    const createdNames: string[] = [];
    const bodyContractLabels: string[] = [];
    const processes: string[] = [];
    const stoppedProcesses: string[] = [];
    const processInputs: Array<Record<string, unknown>> = [];
    const previewNames: string[] = [];
    const playerPositionProfile: PlayerPositionProfile = {
      primaryPosition: "PG",
      eligiblePositions: ["PG", "SG"],
      profileCommitment: sha256Commitment({
        primaryPosition: "PG",
        eligiblePositions: ["PG", "SG"],
      }),
    };
    let processReadbacks = 0;
    let transientBrokerFailure = true;
    const factory: CandidateSandboxFactory = {
      async get() {
        throw new Error("automatic provisioning does not preselect a broker");
      },
      async createIfNotExists(input) {
        const resource = input as Extract<typeof input, { metadata: unknown }>;
        const name = resource.metadata.name!;
        createdNames.push(name);
        if (name === candidateFixedBrokerName(applicationId)) {
          expect(resource.spec.runtime?.envs).toEqual(
            expect.arrayContaining([
              { name: "HOST", value: "0.0.0.0", secret: false },
              { name: "PORT", value: "3000", secret: false },
              {
                name: "ABL_COGNITION_RELAY_INTERNAL_TOKEN_B64",
                value: expect.any(String),
                secret: true,
              },
            ]),
          );
          expect(resource.spec.network?.allowedDomains).toEqual([
            "relay.example",
            "private-storage.example",
          ]);
        }
        if (name === candidateSandboxName(applicationId)) {
          bodyContractLabels.push(
            resource.metadata.labels!["abl-runtime-contract"]!,
          );
          expect(resource.spec.runtime?.envs).toEqual(
            expect.arrayContaining([
              {
                name: "ABL_COGNITION_MODE",
                value: "PARTICIPANT_CONTROLLED",
                secret: false,
              },
              {
                name: "ABL_FIXED_BROKER_CAPABILITY_OPERATIONS_JSON",
                value:
                  '["proxy:cognition-relay","storage:get","storage:put","storage:delete","context:inspect"]',
                secret: false,
              },
              {
                name: "ABL_PLAYER_POSITION_PROFILE_JSON",
                value: JSON.stringify(playerPositionProfile),
                secret: false,
              },
            ]),
          );
        }
        const sandbox = {
          metadata: {
            ...resource.metadata,
            workspace: "agent-basketball-league",
          },
          spec: { ...resource.spec, volumes: null },
          process: {
            list: async () => {
              processReadbacks += 1;
              return [{ name: "abl-fixed-broker", status: "running" }];
            },
            exec: async (input: { name: string }) => {
              const { name: processName } = input;
              processes.push(processName);
              processInputs.push(input);
              if (
                processName === "abl-fixed-broker" &&
                transientBrokerFailure
              ) {
                transientBrokerFailure = false;
                throw Object.assign(new Error("temporary gateway timeout"), {
                  response: { status: 504 },
                });
              }
            },
            stop: async (name: string) => {
              stoppedProcesses.push(name);
            },
          },
          previews: {
            createIfNotExists: async (preview: {
              metadata: { name: string };
            }) => {
              previewNames.push(preview.metadata.name);
              return {
                spec: { url: "https://candidate-broker.example/" },
                tokens: {
                  create: async () => ({ value: "p".repeat(48) }),
                },
              };
            },
          },
          fetch: async (_port: number, path: string, init?: RequestInit) => {
            if (path === "/health") return Response.json({ ok: true });
            if (path === "/v1/career/identity")
              return Response.json(identityReceipt);
            const event = JSON.parse(String(init?.body)).event as {
              eventHash: string;
            };
            return Response.json({
              eventHash: event.eventHash,
              signerAddress: runtime.signing.address,
              signature: `0x${"1".repeat(130)}`,
            });
          },
        };
        return sandbox as never;
      },
      async list() {
        return { data: [] };
      },
      async delete() {},
    };
    const controlPlane = new BlaxelCandidateSandboxControlPlane({
      workspace: "agent-basketball-league",
      region: "us-was-1",
      imageReference: "sandbox/abl-body-sandbox-image:hpdcmnfo4jyz",
      runtimeScope: { mode: "CAPPED_FOUNDING_AUTO" },
      authorizationId: "ABL-COMPLETION-01-CAPPED-FOUNDING-AUTO",
      fixedBrokerImageReference: "sandbox/abl-stage-fixed-broker:lgbo0wrdso03",
      coreOrigin: "https://core.example/",
      corePreviewToken: "core-preview-token-with-at-least-32-bytes",
      candidateCommandDomain: registration.domain,
      distributedCognition: {
        relayOrigin: "https://relay.example/",
        relayInternalToken: "r".repeat(48),
        runnerBundleDigest: `0x${"f".repeat(64)}`,
        careerPairingInternalToken: "p".repeat(48),
        coordinatorDid: "did:abl:competition-director",
        coordinatorSignerAddress: runtime.signing.address,
        privateStorageOrigin: "https://private-storage.example/",
        privateStoragePreviewToken: "s".repeat(48),
        storageServiceId: "abl-career-storage-gateway",
        storageServiceCredentialBase64: Buffer.from(
          "career-storage-service-credential-0001",
        ).toString("base64"),
      },
      factory,
    });
    await expect(
      controlPlane.provision({
        applicationId,
        candidateDid,
        roleClass: "PLAYER",
        playerPositionProfile,
        formerOperatorSigningAddress: registration.applicant.address,
        commandCommitment: hash("e"),
        candidateCommand: registration.command,
      }),
    ).resolves.toMatchObject({
      state: "ISOLATED_TRANSFER_COMPLETE",
      sandboxResourceName: candidateSandboxName(applicationId),
      formerOperatorAccessRemovedAt: expect.any(String),
    });
    await expect(
      controlPlane.provision({
        applicationId,
        candidateDid,
        roleClass: "PLAYER",
        playerPositionProfile,
        formerOperatorSigningAddress: registration.applicant.address,
        commandCommitment: hash("e"),
        candidateCommand: registration.command,
      }),
    ).resolves.toMatchObject({ state: "ISOLATED_TRANSFER_COMPLETE" });
    expect(runtime.signing.address).not.toBe(registration.applicant.address);
    expect(createdNames).toEqual([
      candidateFixedBrokerName(applicationId),
      candidateSandboxName(applicationId),
      candidateFixedBrokerName(applicationId),
      candidateSandboxName(applicationId),
    ]);
    expect(bodyContractLabels[0]).toBe(bodyContractLabels[1]);
    expect(previewNames).toEqual([
      `${candidateFixedBrokerName(applicationId)}-p`,
      `${candidateFixedBrokerName(applicationId)}-p`,
    ]);
    expect(previewNames.every((name) => name.length <= 49)).toBe(true);
    expect(processReadbacks).toBe(1);
    expect(processInputs.every((input) => !("waitForPorts" in input))).toBe(
      true,
    );
    expect(
      processInputs.filter(
        (input) =>
          (input.env as Record<string, string> | undefined)
            ?.ABL_CAREER_CAPABILITY_RENEWAL_MODE === "ENABLED",
      ),
    ).toHaveLength(2);
    expect(processes).toEqual([
      "abl-fixed-broker",
      "abl-career-runtime",
      "abl-fixed-broker",
      "abl-fixed-broker",
      "abl-career-runtime",
      "abl-fixed-broker",
    ]);
    expect(stoppedProcesses).toEqual(["abl-fixed-broker", "abl-fixed-broker"]);
    expect(submittedPaths).toEqual([
      "/v1/candidates/register",
      "/v1/candidates/transfer",
      "/v1/candidates/register",
      "/v1/candidates/transfer",
    ]);
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

  it("caps the founding assignment registry at twenty-six unique careers", () => {
    const assignments = Array.from({ length: 27 }, (_, index) =>
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
