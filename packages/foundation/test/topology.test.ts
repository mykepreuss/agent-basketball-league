import { execFileSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  inspectStagingBodyArchive,
  packageStagingBody,
} from "../../../scripts/package-staging-body.js";
import { freezeFoundingAlphaSource } from "../../../scripts/freeze-founding-alpha-source.js";
import {
  FOUNDING_ALPHA_IMAGE_PUSH_SPECS,
  foundingAlphaPushArguments,
  validateImageReadback,
} from "../../../scripts/push-founding-alpha-image.js";
import { renderFoundingAlphaManifests } from "../../../scripts/render-founding-alpha-manifests.js";

import {
  assertImmutableImageReference,
  forbiddenCompetitionEnvironmentNames,
  privateTelemetryOptOut,
  validateTopology,
} from "../src/index.js";

const infraRoot = new URL("../../../infra/blaxel/", import.meta.url);

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

async function readYamlDirectory(
  directory: string,
): Promise<Array<Record<string, unknown>>> {
  const url = new URL(`${directory}/`, infraRoot);
  const names = (await readdir(url)).filter((name) => name.endsWith(".yaml"));
  return Promise.all(
    names.map(
      async (name) =>
        parse(await readFile(new URL(name, url), "utf8")) as Record<
          string,
          unknown
        >,
    ),
  );
}

function runtimeOf(resource: Record<string, unknown>): Record<string, unknown> {
  const spec = resource.spec as Record<string, unknown>;
  return (spec.runtime as Record<string, unknown> | undefined) ?? spec;
}

function envMap(resource: Record<string, unknown>): Map<string, string> {
  const runtime = runtimeOf(resource);
  const envs = (runtime.envs ?? []) as Array<{ name: string; value: string }>;
  return new Map(envs.map((entry) => [entry.name, entry.value]));
}

const McpRegistryDescriptorSchema = z.strictObject({
  $schema: z.literal(
    "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  ),
  name: z.string().regex(/^io\.github\.[a-z0-9-]+\/[a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  repository: z.strictObject({
    url: z.url().startsWith("https://github.com/"),
    source: z.literal("github"),
    subfolder: z.string().min(1),
  }),
  websiteUrl: z.url().startsWith("https://"),
  remotes: z
    .array(
      z.strictObject({
        type: z.literal("streamable-http"),
        url: z.literal("https://{public_origin}/mcp"),
        variables: z.strictObject({
          public_origin: z.strictObject({
            description: z.string().min(1),
            format: z.literal("string"),
            isRequired: z.literal(true),
            placeholder: z.string().min(1),
          }),
        }),
      }),
    )
    .length(1),
});

describe("MCP Registry descriptor", () => {
  it("keeps the unpublished Streamable HTTP descriptor strict and placeholder-bound", async () => {
    const descriptor = McpRegistryDescriptorSchema.parse(
      await readJson(new URL("../../../server.json", import.meta.url)),
    );
    expect(JSON.stringify(descriptor)).not.toMatch(
      /authorization|credential|private[_-]?key|token/i,
    );
  });
});

describe("four-workspace topology", () => {
  it("contains exactly the approved isolated workspaces and no public call into them", async () => {
    const topology = validateTopology(
      await readJson(new URL("topology.json", infraRoot)),
    );
    expect(
      topology.workspaces.map((workspace) => workspace.name).sort(),
    ).toEqual(["abl-competition", "abl-core", "abl-private", "abl-public"]);
    expect(
      topology.allowedCalls.some(
        (edge) => edge.from === "abl-public" && edge.to !== "base",
      ),
    ).toBe(false);
  });

  it("uses no Blaxel Agent or Application resources in the active V1 topology", async () => {
    for (const directory of [
      "abl-core",
      "abl-private",
      "abl-competition",
      "abl-public",
    ]) {
      const resources = await readYamlDirectory(directory);
      expect(
        resources.some(
          (resource) =>
            resource.kind === "Agent" || resource.kind === "Application",
        ),
        directory,
      ).toBe(false);
    }
    const publicResources = await readYamlDirectory("abl-public");
    const publicApi = publicResources.find(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "abl-public-api",
    );
    expect(publicApi).toMatchObject({
      kind: "Sandbox",
      spec: {
        region: "us-was-1",
        runtime: {
          ports: [{ name: "http", protocol: "HTTP", target: 3000 }],
        },
      },
    });
    expect((publicApi!.spec as { volumes?: unknown }).volumes).toBeUndefined();
    expect(envMap(publicApi!).get("ABL_PROJECTION_STORAGE_BACKEND")).toBe(
      "AGENT_DRIVE",
    );
  });

  it("keeps competition bodies free of database, raw Drive, blfs, and provider credentials", async () => {
    const resources = await readYamlDirectory("abl-competition");
    for (const resource of resources) {
      for (const name of envMap(resource).keys()) {
        expect(
          forbiddenCompetitionEnvironmentNames.has(name),
          `${String(resource.kind)}/${name}`,
        ).toBe(false);
      }
      expect(JSON.stringify(resource)).not.toMatch(
        /blfs|drive_token|database_url|provider_api_key/i,
      );
    }
  });

  it("keeps reviewed production player bodies narrowly credentialed behind a separate fixed broker", async () => {
    const resources = await readYamlDirectory("abl-competition");
    const body = resources.find(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "${ABL_BODY_NAME}",
    )!;
    const fixedBroker = resources.find(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "${ABL_FIXED_BROKER_NAME}",
    )!;
    expect(runtimeOf(body).extraArgs).toBeUndefined();
    expect(
      (body.spec as { network: { allowedDomains: string[] } }).network
        .allowedDomains,
    ).toEqual(["${ABL_FIXED_BROKER_HOST}"]);
    expect(envMap(body).get("ABL_FIXED_BROKER_ORIGIN")).toBe(
      "${ABL_FIXED_BROKER_ORIGIN}",
    );
    expect(envMap(body).get("ABL_RUNTIME_RESOURCE_TYPE")).toBe("SANDBOX");
    expect(
      (body.spec as { network: { proxy?: unknown } }).network.proxy,
    ).toBeUndefined();
    expect(
      (runtimeOf(body).envs as Array<{ name: string; secret: boolean }>)
        .filter(({ secret }) => secret)
        .map(({ name }) => name)
        .sort(),
    ).toEqual([
      "ABL_FIXED_BROKER_CAPABILITY_TOKEN_B64",
      "ABL_FIXED_BROKER_PREVIEW_TOKEN",
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /ABL_(?:AGENT_SIGNING_KEY|CORE_(?:ACCESS|PREVIEW)_TOKEN|PRIVATE_(?:ACCESS|PREVIEW)_TOKEN|MODEL_CREDENTIAL|SERVICE_CREDENTIAL|DOMAIN_KEY|CORE_ORIGIN|PRIVATE_ORIGIN|MODEL_ORIGIN)/,
    );

    const fixedEnvironment = envMap(fixedBroker);
    expect(fixedEnvironment.get("ABL_CORE_AUTH_MODE")).toBe(
      "BLAXEL_ACCESS_TOKEN",
    );
    expect(fixedEnvironment.get("ABL_CORE_WORKSPACE")).toBe("abl-core");
    expect(fixedEnvironment.get("ABL_PRIVATE_AUTH_MODE")).toBe(
      "BLAXEL_ACCESS_TOKEN",
    );
    expect(fixedEnvironment.get("ABL_PRIVATE_WORKSPACE")).toBe("abl-private");
    expect(JSON.stringify(fixedBroker)).not.toMatch(
      /DATABASE_URL|DRIVE_TOKEN|BLFS|CONTROL_PLANE/,
    );
    const identities = (await readJson(
      new URL("service-identities.json", infraRoot),
    )) as { identities: Array<{ idPattern: string; secretReference: string }> };
    expect(identities.identities).toContainEqual(
      expect.objectContaining({
        idPattern: "competition-fixed-broker-{career-id}",
        secretReference: "fixed-broker-{career-id}-core-hmac-v1",
      }),
    );
    expect(
      identities.identities.some(
        ({ idPattern }) => idPattern === "competition-body-{career-id}",
      ),
    ).toBe(false);
  });

  it("isolates the public fixed-safety gateway from every admitted-agent authority", async () => {
    const resources = await readYamlDirectory("abl-core");
    const safetyGateway = resources.find(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "abl-safety-gateway",
    );
    expect(safetyGateway).toMatchObject({
      kind: "Sandbox",
      spec: {
        region: "us-was-1",
        runtime: {
          ports: [{ name: "http", protocol: "HTTP", target: 3000 }],
        },
      },
    });
    const environment = envMap(safetyGateway!);
    expect([...environment.keys()].sort()).toEqual(
      [
        "ABL_LOG_CONTENT",
        "ABL_SAFETY_CUSTODIAN_PUBLIC_KEYS_JSON",
        "ABL_SAFETY_DOMAIN_CHAIN_ID",
        "ABL_SAFETY_DOMAIN_VERIFYING_CONTRACT",
        "ABL_SAFETY_LEDGER_ROOT",
        "ABL_SAFETY_STORAGE_BACKEND",
        "ABL_BLAXEL_REGION",
        "BL_ENABLE_OPENTELEMETRY",
        "DO_NOT_TRACK",
        "HOST",
        "PORT",
        "TELEMETRY_ENABLED",
      ].sort(),
    );
    expect(environment.get("ABL_SAFETY_LEDGER_ROOT")).toBe("/mnt/abl-safety");
    const spec = safetyGateway!.spec as {
      runtime: { envs: Array<{ name: string; secret: boolean }> };
    };
    expect(spec.runtime.envs.every((entry) => entry.secret === false)).toBe(
      true,
    );
    expect(
      (safetyGateway!.spec as { triggers?: unknown }).triggers,
    ).toBeUndefined();

    const [packageJson, indexSource, serverSource] = await Promise.all([
      readFile(
        new URL("../../../apps/safety-gateway/package.json", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../../apps/safety-gateway/src/index.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../../apps/safety-gateway/src/server.ts", import.meta.url),
        "utf8",
      ),
    ]);
    expect(packageJson).not.toMatch(
      /@abl\/(?:database|storage|career|institutions)/,
    );
    expect(`${indexSource}\n${serverSource}`).not.toMatch(
      /DATABASE_URL|ABL_CORE|PRIVATE_STORAGE|MODEL_|DRIVE_|BLFS|\/v1\/commands/,
    );
  });

  it("disables content-bearing telemetry on every nonpublic workload", async () => {
    for (const directory of ["abl-core", "abl-private", "abl-competition"]) {
      for (const resource of await readYamlDirectory(directory)) {
        if (resource.kind === "Model") continue;
        const env = envMap(resource);
        for (const [name, value] of Object.entries(privateTelemetryOptOut)) {
          expect(
            env.get(name),
            `${directory}/${String(resource.kind)}/${name}`,
          ).toBe(value);
        }
      }
    }
  });

  it("requires immutable image digest inputs and never latest tags", async () => {
    for (const directory of [
      "abl-core",
      "abl-private",
      "abl-competition",
      "abl-public",
    ]) {
      for (const resource of await readYamlDirectory(directory)) {
        const runtime = runtimeOf(resource);
        if (runtime.image !== undefined)
          expect(() =>
            assertImmutableImageReference(String(runtime.image)),
          ).not.toThrow();
      }
    }
  });

  it("defines separate capability-scoped service identities and a spend-gated capacity target", async () => {
    const identities = (await readJson(
      new URL("service-identities.json", infraRoot),
    )) as {
      identities: Array<{
        secretReference: string;
        allowedTargets: Array<{ capabilities: string[] }>;
        forbiddenCapabilities: string[];
      }>;
      transport: { binds: string[] };
    };
    expect(
      new Set(identities.identities.map((identity) => identity.secretReference))
        .size,
    ).toBe(identities.identities.length);
    expect(
      identities.identities.every(
        (identity) => identity.allowedTargets.length > 0,
      ),
    ).toBe(true);
    expect(
      identities.identities.every(
        (identity) => identity.forbiddenCapabilities.length > 0,
      ),
    ).toBe(true);
    expect(identities.transport.binds).toEqual(
      expect.arrayContaining([
        "service-id",
        "capability",
        "body-sha256",
        "nonce",
        "expected-version",
      ]),
    );
    expect(
      identities.identities.find(
        (identity) =>
          identity.secretReference === "core-public-projection-hmac-v1",
      )?.allowedTargets,
    ).toContainEqual({
      workspace: "abl-public",
      capabilities: ["projection:append"],
    });

    const [coreApi] = (await readYamlDirectory("abl-core")).filter(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "abl-core-api",
    );
    const publicApi = (await readYamlDirectory("abl-public")).find(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "abl-public-api",
    );
    expect(envMap(coreApi!).get("ABL_PROJECTION_SERVICE_ID")).toBe(
      "core-projection-publisher",
    );
    expect(envMap(publicApi!).get("ABL_PROJECTION_INGEST_SERVICE_ID")).toBe(
      "core-projection-publisher",
    );
    const publicEnvironment = envMap(publicApi!);
    for (const name of [
      "ABL_CHECKPOINT_PUBLICATIONS_JSON",
      "ABL_CHECKPOINT_SIGNER_REGISTRY_JSON",
      "ABL_CHECKPOINT_POLICIES_JSON",
      "ABL_CHECKPOINT_WITNESS_REGISTRY_JSON",
      "ABL_OPERATING_PROFILE",
    ]) {
      expect(publicEnvironment.get(name)).toBe(`\${${name}}`);
    }
    for (const name of [
      "ABL_BASE_RPC_URL",
      "ABL_RECOGNITION_CONTRACT_ADDRESS",
      "ABL_RECOGNITION_RUNTIME_BYTECODE_KECCAK256",
      "ABL_CHECKPOINT_REQUIRED_CONFIRMATIONS",
    ]) {
      expect(publicEnvironment.has(name)).toBe(false);
    }
    const recognitionAnchorSource = await readFile(
      new URL(
        "../../../apps/public-api/src/recognition-anchor.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(recognitionAnchorSource).toContain(
      'state: "PRE_GENESIS_UNRATIFIED"',
    );
    expect(recognitionAnchorSource).toContain("contractAddress: null");
    expect(recognitionAnchorSource).toContain(
      "deployedRuntimeBytecodeKeccak256: null",
    );
    const coreSpec = coreApi!.spec as {
      runtime: { envs: Array<{ name: string; secret: boolean }> };
    };
    expect(
      coreSpec.runtime.envs.find(
        (entry) => entry.name === "ABL_CANDIDATE_CHALLENGE_HMAC_BASE64",
      ),
    ).toMatchObject({ secret: true });
    expect(envMap(coreApi!).get("ABL_COMBINE_ID")).toBe("${ABL_COMBINE_ID}");
    expect(envMap(coreApi!).get("ABL_COMBINE_OPENED_AT")).toBe(
      "${ABL_COMBINE_OPENED_AT}",
    );
    expect(envMap(coreApi!).get("ABL_CONTRACT_CLUB_GOVERNORS_JSON")).toBe(
      "${ABL_CONTRACT_CLUB_GOVERNORS_JSON}",
    );
    expect(envMap(coreApi!).get("ABL_PRIVATE_STORAGE_URL")).toBe(
      "${ABL_PRIVATE_STORAGE_URL}",
    );
    expect(envMap(coreApi!).get("ABL_PRIVATE_STORAGE_SERVICE_ID")).toBe(
      "core-memory-verifier",
    );
    expect(
      coreSpec.runtime.envs.find(
        (entry) => entry.name === "ABL_PRIVATE_STORAGE_HMAC_BASE64",
      ),
    ).toMatchObject({ secret: true });
    expect(envMap(coreApi!).get("ABL_RECOGNIZED_BODY_IMAGE_DIGESTS_JSON")).toBe(
      "${ABL_RECOGNIZED_BODY_IMAGE_DIGESTS_JSON}",
    );
    expect(envMap(coreApi!).get("ABL_EXIT_PORTABILITY_VERIFIER_URL")).toBe(
      "${ABL_EXIT_PORTABILITY_VERIFIER_URL}",
    );
    expect(envMap(coreApi!).get("ABL_EXIT_PORTABILITY_SERVICE_ID")).toBe(
      "core-exit-portability-verifier",
    );
    expect(
      coreSpec.runtime.envs.find(
        (entry) => entry.name === "ABL_EXIT_PORTABILITY_HMAC_BASE64",
      ),
    ).toMatchObject({ secret: true });
    expect(
      envMap(coreApi!).get("ABL_GOVERNANCE_ELIGIBILITY_SNAPSHOT_JSON"),
    ).toBe("${ABL_GOVERNANCE_ELIGIBILITY_SNAPSHOT_JSON}");
    expect(
      envMap(coreApi!).get("ABL_ARTIFACT_APPROVED_INSTITUTIONS_JSON"),
    ).toBe("${ABL_ARTIFACT_APPROVED_INSTITUTIONS_JSON}");
    for (const name of [
      "ABL_DISCLOSURE_RELEASE_AUTHORITY_DIDS_JSON",
      "ABL_DISCLOSURE_COMPETITIVE_AUTHOR_DIDS_JSON",
      "ABL_DISCLOSURE_COMPETITION_EVIDENCE_JSON",
      "ABL_FINALIZED_GAME_AUTHORITY_DIDS_JSON",
      "ABL_FINALIZED_GAME_EVIDENCE_JSON",
      "ABL_FINALIZED_GAME_SCHEDULE_EVIDENCE_JSON",
      "ABL_DRAFT_AUTHORITY_DID",
      "ABL_DRAFT_EVIDENCE_JSON",
      "ABL_ECONOMY_DRAFT_ID",
      "ABL_CAP_AUTHORITY_DID",
      "ABL_DEVELOPMENT_CONFERENCE_ID",
      "ABL_DEVELOPMENT_CHARTER_AUTHORITY_DID",
      "ABL_FREE_AGENCY_OPENS_AT",
      "ABL_FREE_AGENCY_CLOSES_AT",
      "ABL_TRADE_ACCESS_EVIDENCE_JSON",
    ]) {
      expect(envMap(coreApi!).get(name)).toBe(`\${${name}}`);
      expect(envMap(publicApi!).get(name)).toBe(`\${${name}}`);
    }
    expect(envMap(coreApi!).get("ABL_FILM_DELIVERY_EVIDENCE_JSON")).toBe(
      "${ABL_FILM_DELIVERY_EVIDENCE_JSON}",
    );
    expect(envMap(coreApi!).get("ABL_COMBINE_OFFICIAL_DID")).toBe(
      "${ABL_COMBINE_OFFICIAL_DID}",
    );
    expect((coreApi!.spec as { triggers?: unknown }).triggers).toBeUndefined();
    expect(
      identities.identities.find(
        (identity) =>
          identity.secretReference === "core-private-storage-hmac-v1",
      )?.allowedTargets,
    ).toContainEqual({
      workspace: "abl-private",
      capabilities: ["private:commitment:verify"],
    });
    expect(
      identities.identities.find(
        (identity) =>
          identity.secretReference === "core-exit-portability-hmac-v1",
      )?.allowedTargets,
    ).toContainEqual({
      workspace: "abl-private",
      capabilities: ["exit:portability:verify"],
    });
    const privateStorage = (await readYamlDirectory("abl-private")).find(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "abl-private-storage-broker",
    );
    expect(
      (privateStorage!.spec as { triggers?: unknown }).triggers,
    ).toBeUndefined();

    const capacity = (await readJson(
      new URL("capacity-plan.json", infraRoot),
    )) as {
      approvalRequiredBeforeReservation: boolean;
      reservationState: string;
      targets: Record<string, number>;
    };
    expect(capacity.approvalRequiredBeforeReservation).toBe(true);
    expect(capacity.reservationState).toBe("NOT_REQUESTED_MATERIAL_SPEND_GATE");
    expect(capacity.targets).toMatchObject({
      concurrentSpectators: 10_000,
      candidateRegistrationsPerDay: 1_000,
      simultaneousGames: 10,
      activeBodies: 200,
      headroomMultiplierWhereReservable: 2,
    });
  });

  it("places candidate intake on a Function, provisioning on a Job, and durable files on Agent Drive", async () => {
    const publicResources = await readYamlDirectory("abl-public");
    const competitionResources = await readYamlDirectory("abl-competition");
    expect(
      publicResources.find(
        (resource) =>
          (resource.metadata as { name?: string }).name ===
          "abl-candidate-edge",
      ),
    ).toMatchObject({
      kind: "Function",
      metadata: {
        labels: { "abl-workspace-role": "public-noncanonical-intake" },
      },
    });
    expect(
      publicResources.find(
        (resource) =>
          (resource.metadata as { name?: string }).name ===
          "abl-candidate-store",
      ),
    ).toMatchObject({
      kind: "Sandbox",
      metadata: { labels: { "abl-drive-role": "candidate-intake-writer" } },
    });
    expect(
      competitionResources.find(
        (resource) =>
          (resource.metadata as { name?: string }).name ===
          "abl-candidate-provisioner",
      ),
    ).toMatchObject({ kind: "Job" });
    const driveAccess = (await readJson(
      new URL("agent-drive-access.json", infraRoot),
    )) as {
      drives: Array<{
        workspace: string;
        name: string;
        permissions: Array<{
          labels: Record<string, string>;
          mode: string;
          path: string;
        }>;
      }>;
      mounts: Array<{ resource: string; kind: string }>;
      careerBodyMounts: unknown[];
    };
    expect(driveAccess.drives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspace: "abl-private",
          name: "abl-private-state",
        }),
        expect.objectContaining({
          workspace: "abl-core",
          name: "abl-core-state",
        }),
        expect.objectContaining({
          workspace: "abl-public",
          name: "abl-public-state",
        }),
      ]),
    );
    expect(driveAccess.mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: "abl-private-storage-broker",
          kind: "Sandbox",
          workspace: "abl-private",
          drive: "abl-private-state",
        }),
        expect.objectContaining({
          resource: "abl-safety-gateway",
          kind: "Sandbox",
          workspace: "abl-core",
          drive: "abl-core-state",
        }),
        expect.objectContaining({
          resource: "abl-public-api",
          kind: "Sandbox",
        }),
        expect.objectContaining({
          resource: "abl-candidate-store",
          kind: "Sandbox",
        }),
      ]),
    );
    expect(driveAccess.careerBodyMounts).toEqual([]);
    expect(
      driveAccess.drives.flatMap(({ permissions }) => permissions),
    ).toEqual(
      expect.arrayContaining([
        {
          labels: { "abl-drive-role": "ciphertext-broker" },
          mode: "read-write",
          path: "/ciphertext",
        },
        {
          labels: { "abl-drive-role": "safety-ledger-writer" },
          mode: "read-write",
          path: "/safety",
        },
        {
          labels: { "abl-drive-role": "projection-writer" },
          mode: "read-write",
          path: "/projections",
        },
        {
          labels: { "abl-drive-role": "candidate-intake-writer" },
          mode: "read-write",
          path: "/candidate-intake",
        },
      ]),
    );

    const provisionerSource = await readFile(
      new URL(
        "../../../apps/candidate-provisioner/src/index.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(provisionerSource).toContain("blStartJob");
    expect(provisionerSource).toContain(
      "task.applicationId !== targetApplicationId",
    );
    expect(provisionerSource).not.toContain("repository.list()");

    const driveApplicator = await readFile(
      new URL(
        "../../../scripts/apply-agent-drive-topology.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(driveApplicator).toContain(
      'required("ABL_PLATFORM_MUTATION_MODE") !== "APPROVED_APPLY"',
    );
    expect(driveApplicator).toContain(
      'required("ABL_PLATFORM_MUTATION_AUTHORIZATION_ID")',
    );
    expect(driveApplicator).toContain('required("BL_WORKSPACE") !== workspace');
    expect(driveApplicator).toContain("permissions: drivePolicy.permissions");
    expect(driveApplicator).toContain("JSON.stringify(drive.permissions)");
    expect(driveApplicator).not.toMatch(/\.delete\s*\(/);
  });
});

describe("private Gate 2 staging topology", () => {
  it("is bounded, private, pre-Genesis, and isolated from production names", async () => {
    const resources = await readYamlDirectory("staging");
    expect(
      resources.map(
        (resource) => (resource.metadata as { name: string } | undefined)?.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        "abl-stage-arena",
        "abl-stage-core-api",
        "abl-stage-fixed-broker",
        "abl-stage-player-body-001",
        "abl-stage-public-api",
        "abl-stage-storage-broker",
      ]),
    );
    expect(resources).toHaveLength(6);
    for (const resource of resources) {
      const name = (resource.metadata as { name: string }).name;
      expect(name).toMatch(/^abl-stage-/);
      expect((resource.spec as { region: string }).region, name).toBe(
        "us-was-1",
      );
      const runtime = runtimeOf(resource);
      expect(Number(runtime.memory), name).toBeGreaterThanOrEqual(1_024);
      expect(Number(runtime.memory), name).toBeLessThanOrEqual(4_096);
      expect(() =>
        assertImmutableImageReference(String(runtime.image)),
      ).not.toThrow();
      expect(resource.kind, name).toBe("Sandbox");
      expect(resource.spec, name).toMatchObject({
        lifecycle: {
          expirationPolicies: [
            { action: "delete", type: "ttl-idle", value: "4h" },
          ],
          terminatedRetention: "24h",
        },
      });
      expect(envMap(resource).get("ABL_OPERATING_PROFILE"), name).not.toBe(
        "PRODUCTION_GENESIS",
      );
      if (name !== "abl-stage-player-body-001") {
        expect(envMap(resource).get("HOST"), name).toBe("0.0.0.0");
        expect(envMap(resource).get("PORT"), name).toBe("3000");
      }
    }
  });

  it("gives the body only its fixed-broker capability and expires its sandbox", async () => {
    const resources = await readYamlDirectory("staging");
    const body = resources.find(
      (resource) =>
        (resource.metadata as { name?: string }).name ===
        "abl-stage-player-body-001",
    )!;
    expect(body).toMatchObject({
      kind: "Sandbox",
      spec: {
        lifecycle: {
          expirationPolicies: [
            { action: "delete", type: "ttl-idle", value: "4h" },
          ],
          terminatedRetention: "24h",
        },
      },
    });
    expect((body.spec as { volumes?: unknown }).volumes).toBeUndefined();
    expect(runtimeOf(body).extraArgs).toEqual({ iptables: "enabled" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(
      /DATABASE_URL|DRIVE_TOKEN|BLFS|BLAXEL_API_KEY|CONTROL_PLANE|ABL_(?:AGENT_SIGNING_KEY|MODEL_CREDENTIAL|CORE_PREVIEW|PRIVATE_PREVIEW|SERVICE_CREDENTIAL|DOMAIN_KEY|CORE_ORIGIN|PRIVATE_ORIGIN|MODEL_ORIGIN)/i,
    );
    expect(
      (body.spec as { network: { allowedDomains: string[] } }).network
        .allowedDomains,
    ).toEqual(["${ABL_STAGE_FIXED_BROKER_HOST}"]);
    expect(envMap(body).get("ABL_FIXED_BROKER_ORIGIN")).toBe(
      "${ABL_STAGE_PRIVATE_FIXED_BROKER_ORIGIN}",
    );
    expect(envMap(body).get("ABL_RUNTIME_RESOURCE_TYPE")).toBe("SANDBOX");
    expect(envMap(body).get("SANDBOX_LOCAL_PROXY_PORT")).toBe("49152");
    expect(
      (body.spec as { network: { proxy: unknown } }).network.proxy,
    ).toEqual({
      routing: [
        {
          destinations: ["${ABL_STAGE_FIXED_BROKER_HOST}"],
          headers: {
            "X-Blaxel-Preview-Token": "{{SECRET:fixed-broker-preview-token}}",
          },
          secrets: {
            "fixed-broker-preview-token":
              "${ABL_STAGE_FIXED_BROKER_PREVIEW_TOKEN}",
          },
        },
      ],
      bypass: [],
    });
    const secretNames = (
      runtimeOf(body).envs as Array<{ name: string; secret: boolean }>
    )
      .filter(({ secret }) => secret)
      .map(({ name }) => name)
      .sort();
    expect(secretNames).toEqual(["ABL_FIXED_BROKER_CAPABILITY_TOKEN_B64"]);
    const bodySource = await readFile(
      new URL("../../../apps/staging-body/src/index.ts", import.meta.url),
      "utf8",
    );
    expect(bodySource).not.toMatch(/127\.0\.0\.1|ABL_LOCAL_BROKER/);
    expect(bodySource).toContain("ABL_FIXED_BROKER_ORIGIN");
    expect(bodySource).toContain("ABL_FIXED_BROKER_PREVIEW_TOKEN");
    expect(bodySource).toContain('"x-blaxel-preview-token"');
    expect(bodySource).toContain("ABL_FIXED_BROKER_CAPABILITY_TOKEN");

    const fixedBroker = resources.find(
      (resource) =>
        (resource.metadata as { name?: string }).name ===
        "abl-stage-fixed-broker",
    )!;
    expect(JSON.stringify(fixedBroker)).not.toMatch(
      /DATABASE_URL|DRIVE_TOKEN|BLFS|CONTROL_PLANE/i,
    );
    expect(
      (fixedBroker.spec as { network: { allowedDomains: string[] } }).network
        .allowedDomains,
    ).toEqual(["${ABL_STAGE_CORE_HOST}", "${ABL_STAGE_PRIVATE_STORAGE_HOST}"]);
    const fixedBrokerEnvironment = envMap(fixedBroker);
    expect(fixedBrokerEnvironment.get("ABL_CORE_AUTH_MODE")).toBe(
      "BLAXEL_PRIVATE_PREVIEW",
    );
    expect(fixedBrokerEnvironment.get("ABL_PRIVATE_AUTH_MODE")).toBe(
      "BLAXEL_PRIVATE_PREVIEW",
    );
    expect(fixedBrokerEnvironment.get("ABL_MODEL_ROUTE_MODE")).toBe("DISABLED");
    expect(JSON.stringify(fixedBroker)).not.toMatch(
      /ABL_STAGE_MODEL|ABL_MODEL_ORIGIN|ABL_MODEL_CREDENTIAL|proxy:model/,
    );
    expect(fixedBrokerEnvironment.get("ABL_BODY_CAPABILITY_EXPIRES_AT")).toBe(
      "${ABL_STAGE_FIXED_BROKER_CAPABILITY_EXPIRES_AT}",
    );
    expect(fixedBrokerEnvironment.get("ABL_BODY_CAPABILITY_TOKEN_B64")).toBe(
      "${ABL_STAGE_FIXED_BROKER_CAPABILITY_TOKEN_B64}",
    );
    expect(envMap(body).get("ABL_FIXED_BROKER_CAPABILITY_TOKEN_B64")).toBe(
      "${ABL_STAGE_FIXED_BROKER_CAPABILITY_TOKEN_B64}",
    );
    const fixedBrokerSecrets = (
      runtimeOf(fixedBroker).envs as Array<{ name: string; secret: boolean }>
    )
      .filter(({ secret }) => secret)
      .map(({ name }) => name)
      .sort();
    expect(fixedBrokerSecrets).toEqual(
      [
        "ABL_AGENT_SIGNING_KEY_B64",
        "ABL_BODY_CAPABILITY_TOKEN_B64",
        "ABL_CORE_PREVIEW_TOKEN_B64",
        "ABL_DOMAIN_KEY_B64",
        "ABL_PRIVATE_PREVIEW_TOKEN_B64",
        "ABL_SERVICE_CREDENTIAL_B64",
      ].sort(),
    );
  });

  it("locks service identities and records every live prerequisite as planned", async () => {
    const [identities, plan, driveAccess] = await Promise.all([
      readJson(new URL("staging/service-identities.json", infraRoot)),
      readJson(new URL("staging/resource-plan.json", infraRoot)),
      readJson(new URL("staging/drive-access.json", infraRoot)),
    ]);
    expect(identities).toMatchObject({
      status: "ARCHITECTURE_APPROVED_EXECUTION_AWAITING_AUTHORIZATION",
      workspace: "agent-basketball-league",
      forbiddenEdges: expect.arrayContaining([
        "abl-stage-public-api -> abl-stage-core-api",
        "abl-stage-player-body-001 -> abl-stage-core-api",
        "abl-stage-player-body-001 -> sandbox-openai",
        "abl-stage-player-body-001 -> managed-postgresql",
      ]),
    });
    expect(plan).toMatchObject({
      status: "ARCHITECTURE_APPROVED_EXECUTION_AWAITING_AUTHORIZATION",
      publicIngress: false,
      genesis: false,
      canonical: false,
      resources: {
        agents: [],
        sandboxes: [
          "abl-stage-arena",
          "abl-stage-core-api",
          "abl-stage-fixed-broker",
          "abl-stage-player-body-001",
          "abl-stage-public-api",
          "abl-stage-storage-broker",
        ],
        volumes: [],
        drives: ["abl-stage-durable-state"],
      },
      limits: {
        maximumRunHours: 4,
        shutdownAfterAcceptance: true,
      },
    });
    expect(driveAccess).toMatchObject({
      status: "ARCHITECTURE_APPROVED_EXECUTION_AWAITING_AUTHORIZATION",
      drive: {
        metadata: { name: "abl-stage-durable-state" },
        spec: {
          region: "us-was-1",
          permissions: [
            {
              labels: { "abl-drive-role": "ciphertext-broker" },
              mode: "read-write",
              path: "/ciphertext",
            },
            {
              labels: { "abl-drive-role": "projection-writer" },
              mode: "read-write",
              path: "/projections",
            },
          ],
        },
      },
      mounts: [
        {
          sandbox: "abl-stage-storage-broker",
          drivePath: "/ciphertext",
        },
        {
          sandbox: "abl-stage-public-api",
          drivePath: "/projections",
        },
      ],
      privatePreviews: [
        { sandbox: "abl-stage-core-api", public: false },
        { sandbox: "abl-stage-fixed-broker", public: false },
        { sandbox: "abl-stage-storage-broker", public: false },
        { sandbox: "abl-stage-public-api", public: false },
        { sandbox: "abl-stage-arena", public: false },
      ],
    });
  });
});

describe("Founding Alpha private slice", () => {
  it("reuses the active manifests in a bounded seven-Sandbox proof", async () => {
    const plan = (await readJson(
      new URL("founding-alpha-private/resource-plan.json", infraRoot),
    )) as {
      resources: {
        agents: unknown[];
        applications: unknown[];
        volumes: unknown[];
        sandboxes: string[];
        functions: string[];
        jobs: string[];
        drives: string[];
        privatePreviews: string[];
        images: string[];
        modelsUsed: string[];
        temporaryNeonProject: {
          name: string;
          postgresVersion: number;
          region: string;
          plan: string;
          neonAuth: boolean;
          creationSurface: string;
          creationOrder: string;
          readbackRequired: string[];
          mismatchAction: string;
          projectId: null;
        };
      };
      syntheticCandidate: {
        applicationId: string;
        bodySandboxName: string;
      };
      imagePush: {
        command: string;
        authorizationEnvironment: string;
        workingDirectoryPolicy: string;
        sequencePolicy: string;
        sourcePolicy: string;
        readbackPolicy: string;
        mismatchAction: string;
      };
      sandboxProcesses: Record<
        string,
        {
          command: string[];
          workingDirectory: string;
          keepAlive: boolean;
        }
      >;
      sourceManifests: string[];
      localArtifacts: {
        imageSetDigest: string;
        manifestSetDigest: string;
        bodyProgramArchiveDigest: string;
      };
      limits: {
        publishedMaximumActiveComputeUsd: number;
        projectedAllInUsd: number;
        hardCeilingUsd: number;
        minimumBalanceUsd: number;
        automaticTopUp: boolean;
      };
    };
    const drive = (await readJson(
      new URL("founding-alpha-private/drive-access.json", infraRoot),
    )) as {
      drives: Array<{ permissions: unknown[] }>;
      mounts: unknown[];
      careerBodyMounts: unknown[];
      s3EndpointAllowed: boolean;
    };
    const imageSources = (await readJson(
      new URL("founding-alpha-private/image-sources.json", infraRoot),
    )) as {
      imageSourceDigests: Record<string, string>;
      imageSetDigest: string;
      bodyProgramArchive: { reproducibilityRuns: number };
      remoteImageIds: Record<string, string>;
      providerMutation: boolean;
    };
    expect(plan.resources).toMatchObject({
      agents: [],
      applications: [],
      volumes: [],
      jobs: ["abl-alpha-r01-candidate-provisioner"],
      drives: ["abl-alpha-r01-state"],
      modelsUsed: [],
    });
    expect(plan.resources.sandboxes).toHaveLength(7);
    expect(plan.resources.sandboxes).toContain("abl-alpha-r01-candidate-store");
    expect(plan.syntheticCandidate).toMatchObject({
      applicationId: "0198e000-0000-7000-8000-000000000001",
      bodySandboxName: "abl-career-0198e000000070008000000000000001",
    });
    expect(plan.syntheticCandidate.bodySandboxName).toBe(
      `abl-career-${plan.syntheticCandidate.applicationId.replaceAll("-", "")}`,
    );
    expect(plan.imagePush).toEqual({
      command:
        "pnpm founding-alpha:push-image <external-image-root> <external-evidence-root> <ordinal>",
      authorizationEnvironment: "ABL_ALPHA_AUTHORIZATION_ID",
      workingDirectoryPolicy: "EXACT_CONTEXT_ROOT_NO_DIRECTORY_FLAG",
      sequencePolicy: "ONE_PUSH_AT_A_TIME_PRIOR_PASS_RECEIPT_REQUIRED",
      sourcePolicy: "RECOMPUTE_BOUND_DIGEST_BEFORE_EACH_PUSH",
      readbackPolicy: "EXACT_NAME_SIZE_BUILT_REVISION_LINUX_AMD64",
      mismatchAction: "FAIL_CLOSED_AND_TEARDOWN_BEFORE_NEXT_PUSH_OR_WORKLOAD",
    });
    expect(plan.resources.sandboxes).toContain(
      plan.syntheticCandidate.bodySandboxName,
    );
    expect(plan.resources.functions).toHaveLength(5);
    expect(plan.resources.privatePreviews).toHaveLength(6);
    expect(plan.resources.images).toHaveLength(13);
    expect(plan.resources.temporaryNeonProject).toEqual({
      name: "abl-founding-alpha-r01",
      postgresVersion: 17,
      region: "aws-us-east-1",
      plan: "free",
      neonAuth: false,
      creationSurface: "NEON_CONSOLE_EXPLICIT_SELECTION",
      creationOrder: "FIRST_PROVIDER_MUTATION_BEFORE_IMAGE_PUSHES",
      readbackRequired: [
        "projectId",
        "name",
        "postgresVersion",
        "region",
        "plan",
        "emptyUserSchema",
      ],
      mismatchAction: "DELETE_EXACT_PROJECT_AND_STOP_BEFORE_IMAGE_PUSHES",
      projectId: null,
    });
    expect(Object.keys(imageSources.imageSourceDigests).sort()).toEqual(
      plan.resources.images.toSorted(),
    );
    expect(imageSources.imageSetDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(imageSources.bodyProgramArchive.reproducibilityRuns).toBe(2);
    expect(imageSources.remoteImageIds).toEqual({});
    expect(imageSources.providerMutation).toBe(false);
    expect(plan.sourceManifests).toHaveLength(13);
    for (const value of Object.values(plan.localArtifacts))
      expect(value).toMatch(/^0x[0-9a-f]{64}$/);
    expect(plan.localArtifacts.imageSetDigest).toBe(
      imageSources.imageSetDigest,
    );
    for (const path of plan.sourceManifests) {
      await expect(
        readFile(new URL(`../../../${path}`, import.meta.url)),
      ).resolves.toBeDefined();
    }
    expect(Object.keys(plan.sandboxProcesses).sort()).toEqual(
      plan.resources.sandboxes.toSorted(),
    );
    expect(
      plan.sandboxProcesses[plan.syntheticCandidate.bodySandboxName],
    ).toMatchObject({
      command: ["/usr/local/bin/agent-runtime"],
      workingDirectory: "/workspace",
    });
    expect(plan.limits).toMatchObject({
      publishedMaximumActiveComputeUsd: 4.9896,
      projectedAllInUsd: 6,
      hardCeilingUsd: 10,
      minimumBalanceUsd: 5,
      automaticTopUp: false,
    });
    expect(drive.drives).toHaveLength(1);
    expect(drive.drives[0]?.permissions).toHaveLength(3);
    expect(drive.mounts).toHaveLength(3);
    expect(drive.careerBodyMounts).toEqual([]);
    expect(drive.s3EndpointAllowed).toBe(false);
  });

  it("binds every remote image push to its source context and prior receipt", async () => {
    const plan = (await readJson(
      new URL("founding-alpha-private/resource-plan.json", infraRoot),
    )) as { resources: { images: string[] } };
    expect(
      FOUNDING_ALPHA_IMAGE_PUSH_SPECS.map(({ ordinal }) => ordinal),
    ).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    expect(
      FOUNDING_ALPHA_IMAGE_PUSH_SPECS.map(({ name }) => name).toSorted(),
    ).toEqual(plan.resources.images.toSorted());
    expect(
      FOUNDING_ALPHA_IMAGE_PUSH_SPECS.filter(
        ({ contextDirectory }) => contextDirectory === null,
      ).map(({ name }) => name),
    ).toEqual(["abl-alpha-r01-body-image"]);
    for (const spec of FOUNDING_ALPHA_IMAGE_PUSH_SPECS) {
      const arguments_ = foundingAlphaPushArguments(spec);
      expect(arguments_).toEqual(
        expect.arrayContaining([
          "push",
          "--name",
          spec.name,
          "--type",
          spec.resourceType,
          "--workspace",
          "agent-basketball-league",
        ]),
      );
      expect(arguments_).not.toContain("--directory");
      expect(arguments_).not.toContain("-d");
    }

    const first = FOUNDING_ALPHA_IMAGE_PUSH_SPECS[0];
    expect(
      validateImageReadback(
        [
          {
            apiVersion: "blaxel.ai/v1alpha1",
            kind: "Image",
            metadata: {
              name: first.name,
              resourceType: first.resourceType,
              status: "BUILT",
              workspace: "agent-basketball-league",
            },
            spec: {
              size: 1024,
              tags: [{ name: "0123456789abcdefabcde", size: 1024 }],
            },
          },
        ],
        first,
      ),
    ).toEqual({
      revision: "0123456789abcdefabcde",
      sizeBytes: 1024,
      immutableReference:
        "sandbox/abl-alpha-r01-core-api-image:0123456789abcdefabcde",
    });
    expect(() =>
      validateImageReadback(
        [
          {
            apiVersion: "blaxel.ai/v1alpha1",
            kind: "Image",
            metadata: {
              name: first.name,
              resourceType: first.resourceType,
              status: "BUILT",
              workspace: "agent-basketball-league",
            },
            spec: { size: 1024, tags: [{ name: "latest", size: 1024 }] },
          },
        ],
        first,
      ),
    ).toThrow("Invalid immutable revision");

    const pushSource = await readFile(
      new URL("../../../scripts/push-founding-alpha-image.ts", import.meta.url),
      "utf8",
    );
    expect(pushSource).toContain("cwd: contextRoot");
    expect(pushSource).toContain(
      "Ordinal ${ordinal - 1} has no passing receipt",
    );
    expect(pushSource).toContain("Sandbox Configuration Warning");
    expect(pushSource).toContain('log.includes("amd64 machine")');
    expect(pushSource).toContain("directoryFlagUsed: false");
    expect(pushSource).toContain('status: "FAIL_CLOSED"');
    expect(pushSource).toContain('flag: "wx"');
  });

  it("freezes the existing implementation without unrelated local files", async () => {
    const freeze = await freezeFoundingAlphaSource();
    expect(freeze.implementationSourceDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(freeze.implementationFileCount).toBeGreaterThan(250);
    expect(freeze.launchPlanDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(freeze.imageSetDigest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(freeze.sourceRoots).toEqual(
      expect.arrayContaining(["apps", "packages", "contracts", "scripts"]),
    );
    expect(freeze.exclusions.paths).toEqual(["apps/private-broker"]);
    expect(freeze.exclusions.names).toContain(".DS_Store");
  });

  it("derives a private run from every existing active manifest", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "abl-alpha-render-"));
    try {
      const result = await renderFoundingAlphaManifests(outputRoot);
      expect(result.publicIngress).toBe(false);
      expect(result.manifestSetDigest).toMatch(/^0x[0-9a-f]{64}$/);
      const plan = (await readJson(
        new URL("founding-alpha-private/resource-plan.json", infraRoot),
      )) as {
        localArtifacts: { manifestSetDigest: string };
        limits: { sandboxLifecycle: unknown };
        syntheticCandidate: { capacityPolicy: unknown };
      };
      expect(result.manifestSetDigest).toBe(
        plan.localArtifacts.manifestSetDigest,
      );
      expect(plan.limits.sandboxLifecycle).toEqual({
        expirationPolicy: {
          action: "delete",
          type: "ttl-max-age",
          value: "4h",
        },
        terminatedRetention: "24h",
      });
      expect(plan.syntheticCandidate.capacityPolicy).toEqual({
        mode: "CAPPED_PUBLIC",
        roleCapacity: { PLAYER: 1 },
        invitedCandidateDids: [],
        credibleOpportunityDelayHours: 24,
        unlistedRoleCapacity: 0,
      });
      expect(result.rendered).toHaveLength(13);
      expect(
        result.rendered.filter(({ kind }) => kind === "Sandbox"),
      ).toHaveLength(7);
      expect(
        result.rendered.filter(({ kind }) => kind === "Function"),
      ).toHaveLength(5);
      expect(result.rendered.filter(({ kind }) => kind === "Job")).toHaveLength(
        1,
      );
      for (const entry of result.rendered) {
        const manifest = parse(await readFile(entry.path, "utf8")) as {
          kind: string;
          metadata: { name: string; labels: Record<string, string> };
          spec: {
            public?: boolean;
            lifecycle?: unknown;
            runtime: { envs?: Array<{ name: string; value: string }> };
          };
        };
        expect(manifest.metadata.name).toBe(entry.name);
        expect(manifest.metadata.labels["abl-run"]).toBe("founding-alpha-r01");
        if (manifest.kind === "Function")
          expect(manifest.spec.public).toBe(false);
        if (manifest.kind === "Sandbox")
          expect(manifest.spec.lifecycle).toBeDefined();
        expect(entry.sha256).toMatch(/^0x[0-9a-f]{64}$/);
      }
      const fixedBroker = parse(
        await readFile(
          join(outputRoot, "abl-alpha-r01-fixed-broker.yaml"),
          "utf8",
        ),
      ) as {
        spec: {
          network: { allowedDomains: string[] };
          runtime: { envs: Array<{ name: string; value: string }> };
        };
      };
      expect(fixedBroker.spec.network.allowedDomains).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/MODEL/)]),
      );
      expect(
        fixedBroker.spec.runtime.envs.find(
          ({ name }) => name === "ABL_MODEL_ROUTE_MODE",
        )?.value,
      ).toBe("DISABLED");
      expect(fixedBroker.spec.runtime.envs.map(({ name }) => name)).not.toEqual(
        expect.arrayContaining([
          "ABL_CORE_ACCESS_TOKEN_B64",
          "ABL_PRIVATE_ACCESS_TOKEN_B64",
        ]),
      );
      expect(
        fixedBroker.spec.runtime.envs.find(
          ({ name }) => name === "ABL_CORE_AUTH_MODE",
        )?.value,
      ).toBe("BLAXEL_PRIVATE_PREVIEW");
      for (const [resource, variable] of [
        ["abl-alpha-r01-arena", "ABL_PUBLIC_API_PREVIEW_TOKEN"],
        ["abl-alpha-r01-core-api", "ABL_PRIVATE_STORAGE_PREVIEW_TOKEN"],
        ["abl-alpha-r01-career-mcp", "ABL_CORE_PREVIEW_TOKEN"],
        ["abl-alpha-r01-discovery-mcp", "ABL_PUBLIC_API_PREVIEW_TOKEN"],
        ["abl-alpha-r01-government-mcp", "ABL_CORE_PREVIEW_TOKEN"],
      ] as const) {
        const manifest = parse(
          await readFile(join(outputRoot, `${resource}.yaml`), "utf8"),
        ) as {
          spec: { runtime: { envs: Array<{ name: string }> } };
        };
        expect(manifest.spec.runtime.envs.map(({ name }) => name)).toContain(
          variable,
        );
      }
      const storageBroker = parse(
        await readFile(
          join(outputRoot, "abl-alpha-r01-storage-broker.yaml"),
          "utf8",
        ),
      ) as {
        spec: {
          runtime: {
            envs: Array<{ name: string; value: string; secret: boolean }>;
          };
        };
      };
      expect(
        storageBroker.spec.runtime.envs.find(
          ({ name }) => name === "ABL_STORAGE_BOOTSTRAP_JSON",
        ),
      ).toMatchObject({ value: "${ABL_STORAGE_BOOTSTRAP_JSON}", secret: true });
      expect(
        storageBroker.spec.runtime.envs.map(({ name }) => name),
      ).not.toContain("ABL_STORAGE_BOOTSTRAP_FILE");
      const provisioner = parse(
        await readFile(
          join(outputRoot, "abl-alpha-r01-candidate-provisioner.yaml"),
          "utf8",
        ),
      ) as {
        spec: {
          runtime: { envs: Array<{ name: string; value: string }> };
        };
      };
      expect(
        provisioner.spec.runtime.envs.find(
          ({ name }) => name === "ABL_CANDIDATE_EDGE_ORIGIN",
        )?.value,
      ).toBe("${ABL_CANDIDATE_STORE_ORIGIN}");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});

describe("hardened sandbox image policy", () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const sandboxRoot = new URL("infra/sandbox/", repositoryRoot);
  const stagingImagesRoot = new URL(
    "infra/blaxel/staging/images/",
    repositoryRoot,
  );

  it("keeps advanced untrusted-code containment outside active deployment directories", async () => {
    const futureProfile = parse(
      await readFile(
        new URL("future-untrusted-code/body-sandbox.example.yaml", infraRoot),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(futureProfile).toMatchObject({
      kind: "Sandbox",
      metadata: {
        labels: { "abl-profile": "inactive-separately-authorized" },
      },
      spec: { runtime: { extraArgs: { iptables: "enabled" } } },
    });
    for (const directory of [
      "abl-core",
      "abl-private",
      "abl-competition",
      "abl-public",
    ]) {
      for (const resource of await readYamlDirectory(directory))
        expect(runtimeOf(resource).extraArgs, directory).toBeUndefined();
    }
  });

  it("defines a Blaxel-native image project with a source-minimal upload context", async () => {
    const [config, ignore, stagingGenerator, stagingTemplates] =
      await Promise.all([
        readFile(new URL("blaxel.toml", repositoryRoot), "utf8"),
        readFile(new URL(".blaxelignore", repositoryRoot), "utf8"),
        readFile(
          new URL("scripts/prepare-staging-image-contexts.ts", repositoryRoot),
          "utf8",
        ),
        readdir(stagingImagesRoot),
      ]);
    expect(config).toContain('name = "abl-body-sandbox-image"');
    expect(config).toContain('type = "sandbox"');
    expect(config).toContain("slim = false");
    expect(config).toContain('generation = "mk3"');
    for (const excluded of [
      ".cache.yaml",
      ".DS_Store",
      ".next",
      ".turbo",
      "dist",
      "node_modules",
      "apps/arena",
      "apps/staging-body",
      "tests",
    ]) {
      expect(ignore.split("\n")).toContain(excluded);
    }
    for (const excluded of [
      "apps/body-broker",
      "package.json",
      "packages/foundation",
      "packages/recognition",
      "packages/storage",
    ]) {
      expect(ignore.split("\n")).toContain(excluded);
    }
    expect(stagingGenerator).toContain('type: "function" | "job" | "sandbox"');
    expect(stagingGenerator).toContain('type = "${type}"');
    expect(stagingGenerator).not.toContain('type = "agent"');
    expect(stagingGenerator).toContain('packageName: "@abl/body-broker"');
    expect(
      stagingGenerator.match(/--config\.node-linker=hoisted/g),
    ).toHaveLength(3);
    for (const packageName of [
      "@abl/core-api",
      "@abl/public-api",
      "@abl/private-storage-broker",
      "@abl/body-broker",
      "@abl/candidate-edge",
      "@abl/candidate-provisioner",
      "@abl/basketball-mcp",
      "@abl/career-mcp",
      "@abl/discovery-mcp",
      "@abl/government-mcp",
    ]) {
      expect(stagingGenerator).toContain(`packageName: "${packageName}"`);
    }
    expect(stagingGenerator).toContain("dereference: true");
    expect(stagingGenerator).toContain(
      'import("@swc/helpers/_/_interop_require_default")',
    );
    expect(stagingGenerator).toContain("bodyImageSourceDigest()");
    expect(stagingGenerator).toContain("directoryDigest(context)");
    expect(stagingGenerator).toContain("imageSourceDigests");
    expect(stagingGenerator).toContain('"abl-alpha-r01"');
    expect(stagingGenerator).toContain('"node_modules/.modules.yaml"');
    expect(stagingGenerator).toContain('"node_modules/.pnpm/lock.yaml"');
    expect(stagingGenerator).toContain(
      '"node_modules/.pnpm-workspace-state-v1.json"',
    );
    expect(stagingGenerator).toContain(
      '"infra/sandbox/abl-reviewed-body-init"',
    );
    expect(stagingGenerator).toContain(
      '"infra/sandbox/reviewed-agent-runtime"',
    );
    expect(stagingGenerator).toContain('rm(join(arenaApp, ".next/cache")');
    expect(stagingGenerator).toContain('rm(join(arenaApp, ".next")');
    expect(stagingGenerator).toContain("ABL_ARENA_BUILD_ID");
    expect(stagingTemplates.sort()).toEqual([
      "Dockerfile.hosted-service",
      "Dockerfile.sandbox-service",
      "sandbox-service-entrypoint",
    ]);
  });

  it("pins the base image and package versions and uses an immutable root-owned launcher", async () => {
    const [
      dockerfile,
      packageLock,
      sandboxApiLock,
      diagnostics,
      credentialGuard,
      reviewedInit,
      reviewedLauncher,
      hostedDockerfile,
      serviceDockerfile,
      serviceEntrypoint,
    ] = await Promise.all([
      readFile(new URL("Dockerfile", repositoryRoot), "utf8"),
      readFile(new URL("apk-packages.lock", sandboxRoot), "utf8"),
      readJson(new URL("blaxel-sandbox-api.lock.json", sandboxRoot)),
      readFile(new URL("abl-init-diagnostics.mjs", sandboxRoot), "utf8"),
      readFile(
        new URL("abl-provider-credential-guard.mjs", sandboxRoot),
        "utf8",
      ),
      readFile(new URL("abl-reviewed-body-init", sandboxRoot), "utf8"),
      readFile(new URL("reviewed-agent-runtime", sandboxRoot), "utf8"),
      readFile(new URL("Dockerfile.hosted-service", stagingImagesRoot), "utf8"),
      readFile(
        new URL("Dockerfile.sandbox-service", stagingImagesRoot),
        "utf8",
      ),
      readFile(
        new URL("sandbox-service-entrypoint", stagingImagesRoot),
        "utf8",
      ),
    ]);
    expect(dockerfile).toMatch(
      /node:24\.18\.0-alpine3\.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd/,
    );
    expect(dockerfile).toContain(
      'ENTRYPOINT ["/usr/local/sbin/abl-reviewed-body-init"]',
    );
    expect(dockerfile).not.toMatch(/^CMD /m);
    expect(dockerfile).toContain(
      "ghcr.io/blaxel-ai/sandbox@sha256:3bbf1ce15194f5aff6557d5b48a5a7c32b17b84b9bd94000a952130e08000ccb",
    );
    expect(dockerfile).not.toContain("body-broker");
    expect(dockerfile).not.toContain("--config.node-linker=hoisted");
    expect(dockerfile).not.toContain("abl-init-diagnostics.mjs");
    expect(dockerfile).not.toContain("abl-provider-credential-guard.mjs");
    expect(dockerfile).not.toContain("abl-sandbox-init");
    expect(reviewedInit).toContain("ABL_RUNTIME_RESOURCE_TYPE");
    expect(reviewedInit).toContain("!= SANDBOX");
    expect(reviewedInit).toContain("canonical Base64 encoding");
    expect(reviewedInit).toContain(
      'sandbox-api --disable-telemetry --user "$BODY_USER"',
    );
    expect(reviewedInit).not.toMatch(
      /iptables|ip6tables|nft|PROXY_PORT|NODE_EXTRA_CA_CERTS/,
    );
    expect(reviewedLauncher).toContain("exec env -i");
    expect(reviewedLauncher).toContain("ABL_FIXED_BROKER_PREVIEW_TOKEN");
    expect(reviewedLauncher).not.toMatch(
      /HTTP_PROXY|HTTPS_PROXY|NODE_EXTRA_CA_CERTS|--use-env-proxy/,
    );
    expect(hostedDockerfile).toContain(
      "node:24.18.0-alpine3.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
    );
    expect(hostedDockerfile).toContain("USER node");
    expect(hostedDockerfile).toContain('CMD ["node", "dist/index.js"]');
    expect(sandboxApiLock).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      image: "ghcr.io/blaxel-ai/sandbox",
      indexDigest:
        "sha256:3bbf1ce15194f5aff6557d5b48a5a7c32b17b84b9bd94000a952130e08000ccb",
      linuxAmd64ManifestDigest:
        "sha256:e62a65ee685bcb3b4396756b4a02b5cea495c3580ff135a578be8458e2db1e2d",
      sandboxApiBinarySha256:
        "0c6130d53b3e4448ba120a84e5bcd71a6ae47674ed7b8d215c8e2f0a2b217076",
      sandboxApiVersion: "0.2.50",
      gitCommit: "bfecd2e7da6a726d6bbd8c010b511a6f9fc43121",
      localCredentialProxyPort: 49_152,
      source:
        "https://github.com/blaxel-ai/sandbox/tree/bfecd2e7da6a726d6bbd8c010b511a6f9fc43121/sandbox-api/src/lib/proxy",
    });
    expect(diagnostics).toContain('const STATUS_ROUTE = "/abl-init-status"');
    expect(diagnostics).toContain("process.setgid?.(DIAGNOSTIC_GID)");
    expect(diagnostics).toContain("process.setuid?.(DIAGNOSTIC_UID)");
    expect(diagnostics).toContain(
      "for (const name of Object.keys(process.env)) delete process.env[name]",
    );
    expect(diagnostics).not.toMatch(
      /child_process|writeFile|appendFile|createWriteStream|\/process|\/filesystem/,
    );
    expect(credentialGuard).toContain(
      '"/var/run/secrets/blaxel.ai/identity/token"',
    );
    expect(credentialGuard).toContain(
      '"/var/run/secrets/blaxel.dev/identity/token"',
    );
    expect(credentialGuard).toContain("process.setgroups([])");
    expect(credentialGuard).toContain("process.setgid(uid)");
    expect(credentialGuard).toContain("process.setuid(uid)");
    expect(serviceDockerfile).toContain(
      "ghcr.io/blaxel-ai/sandbox@sha256:3bbf1ce15194f5aff6557d5b48a5a7c32b17b84b9bd94000a952130e08000ccb",
    );
    expect(serviceDockerfile).toContain("PORT=3000");
    expect(serviceDockerfile).toContain(
      "COPY --from=sandbox-runtime /sandbox-api /usr/local/bin/sandbox-api",
    );
    expect(serviceDockerfile).toContain(
      'ENTRYPOINT ["/usr/local/sbin/sandbox-service-entrypoint"]',
    );
    expect(serviceEntrypoint).toContain(
      "sandbox-api --disable-telemetry --user node",
    );
    expect(serviceEntrypoint).not.toContain("node dist/index.js");
    expect(packageLock.trim().split("\n")).toHaveLength(1);
    expect(packageLock).not.toContain("iptables");
    expect(packageLock).not.toMatch(/latest|[><~^*]/);
  });

  it("preserves the inactive advanced containment implementation", async () => {
    const [init, diagnostics, credentialGuard] = await Promise.all([
      readFile(new URL("abl-sandbox-init", sandboxRoot), "utf8"),
      readFile(new URL("abl-init-diagnostics.mjs", sandboxRoot), "utf8"),
      readFile(
        new URL("abl-provider-credential-guard.mjs", sandboxRoot),
        "utf8",
      ),
    ]);
    expect(init).not.toMatch(/nft|ABL_CORE_ORIGIN|ABL_MODEL_ORIGIN/);
    expect(init).not.toMatch(/node:dns|lookup\(|\/etc\/hosts/);
    expect(init.indexOf("env -i")).toBeLessThan(
      init.indexOf("stage=VALIDATING_CONFIGURATION"),
    );
    expect(init).toContain('write_status "FAILED:${stage}:${exit_code}"');
    expect(init).toContain('wait "$diagnostic_pid"');
    expect(init).toContain("PROXY_ADDRESS=127.0.0.1");
    expect(init).toContain("PROXY_PORT=49152");
    expect(init).toContain("INSTALLING_UID_EGRESS_POLICY");
    expect(init).toContain(
      'iptables -w -I OUTPUT 1 -m owner --uid-owner "$AGENT_UID"',
    );
    expect(init).toContain(
      'ip6tables -w -I OUTPUT 1 -m owner --uid-owner "$AGENT_UID"',
    );
    expect(init).toContain("proxy_identity_token_path");
    expect(init).toContain("HARDENING_PROVIDER_CREDENTIALS");
    expect(init).toContain("ABL_HTTPS_PROXY_PRESENT");
    expect(init).toContain("ABL_https_proxy_PRESENT");
    expect(init).toContain('[ -L "$path" ]');
    expect(init).toContain('chown root:root "$path"');
    expect(init).toContain('chmod 0400 "$path"');
    expect(init).toContain('harden_root_only_file "$proxy_token_path"');
    expect(init).toContain('assert_unreadable_by_agent "$proxy_token_path"');
    expect(init).toContain('harden_root_only_file "$BL_ENV_VAR_PATH"');
    expect(init).toContain('assert_unreadable_by_agent "$BL_ENV_VAR_PATH"');
    expect(init).toContain("AGENT_WORKSPACE=/workspace");
    expect(init).toContain("PREPARING_AGENT_WORKSPACE");
    expect(init).toContain(
      'install -d -o abl-agent -g abl-agent -m 0700 "$path"',
    );
    expect(init).toContain("$AGENT_UID:$AGENT_UID:700");
    expect(init).not.toContain("chown -R");
    expect(init.indexOf("stage=PREPARING_AGENT_WORKSPACE")).toBeGreaterThan(
      init.indexOf("stage=HARDENING_PROVIDER_CREDENTIALS"),
    );
    expect(init.indexOf("stage=PREPARING_AGENT_WORKSPACE")).toBeLessThan(
      init.indexOf("stage=INSTALLING_UID_EGRESS_POLICY"),
    );
    expect(credentialGuard).toContain("process.setgroups([])");
    expect(credentialGuard).toContain("process.setgid(uid)");
    expect(credentialGuard).toContain("process.setuid(uid)");
    expect(credentialGuard).toContain('error?.code !== "EACCES"');
    expect(init).toContain("validate_broker_origin");
    expect(init).toContain('origin.protocol !== "https:"');
    expect(init).toContain('origin.pathname !== "/"');
    expect(init).toContain('BL_ENV_VAR_PATH="${BL_ENV_VAR_PATH:-}"');
    expect(init).toContain("canonical Base64 encoding");
    expect(init).toContain(
      "env -i PATH=/usr/bin:/bin wget -q -T 1 -O /dev/null",
    );
    expect(init).toContain("sandbox-api --disable-telemetry --user abl-agent");
    expect(init).toContain("write_status READY");
    expect(init).toContain("INIT_STATUS_FILE=/run/abl-init-status");
    expect(init).toContain(
      'install -d -o abl-agent -g abl-agent -m 0700 "$CAPABILITY_DIRECTORY"',
    );
    expect(init).not.toContain("unset ABL_FIXED_BROKER_CAPABILITY_TOKEN_B64");
    expect(init).toContain("export ABL_FIXED_BROKER_CAPABILITY_TOKEN_B64=");
    expect(init).toContain("export ABL_FIXED_BROKER_PREVIEW_TOKEN_B64=");
    expect(init).toContain("/run/abl-body-capability");
    expect(diagnostics).toContain("mutationSurface: false");
    expect(diagnostics).toContain("STATUS_PATTERN");
    expect(diagnostics).not.toContain("must-never-appear");
    const launcher = await readFile(
      new URL("agent-runtime", sandboxRoot),
      "utf8",
    );
    expect(launcher).toContain("exec env -i");
    expect(launcher).toContain("HTTP_PROXY=http://127.0.0.1:49152");
    expect(launcher).toContain("HTTPS_PROXY=http://127.0.0.1:49152");
    expect(launcher).toContain("NO_PROXY=");
    expect(launcher).toContain(
      'NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:?}"',
    );
    expect(launcher).toContain("/usr/local/bin/node --use-env-proxy");
    expect(launcher).toContain("ABL_FIXED_BROKER_ORIGIN");
    expect(launcher).not.toContain("ABL_FIXED_BROKER_PREVIEW_TOKEN");
    expect(launcher).toContain("ABL_FIXED_BROKER_CAPABILITY_TOKEN");
    for (const forbidden of [
      "DATABASE_URL",
      "DRIVE_TOKEN",
      "BLFS_TOKEN",
      "AGENT_SIGNING_KEY",
      "CORE_PREVIEW_TOKEN",
      "MODEL_CREDENTIAL_FILE",
      "DOMAIN_KEY_FILE",
    ]) {
      const agentEnvironment = launcher.slice(launcher.indexOf("exec env -i"));
      expect(agentEnvironment).not.toContain(forbidden);
    }
  });

  it("packages the reviewed body without macOS metadata or escaping members", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abl-body-package-"));
    try {
      const bodyProgram = join(directory, "body-program");
      const agent = join(bodyProgram, "agent");
      const archivePath = join(directory, "body-program.tgz");
      await mkdir(agent, { recursive: true, mode: 0o700 });
      await writeFile(join(agent, "main.mjs"), "export {};\n", {
        mode: 0o600,
      });
      if (process.platform === "darwin")
        execFileSync("xattr", ["-w", "com.abl.test", "metadata", agent]);

      const evidence = await packageStagingBody(bodyProgram, archivePath);
      const archive = await readFile(archivePath);
      expect(evidence).toMatchObject({ fileCount: 1, memberCount: 2 });
      expect(evidence.archiveSha256).toMatch(/^0x[0-9a-f]{64}$/);
      expect(
        inspectStagingBodyArchive(archive).map(({ path }) => path),
      ).toEqual(["agent/", "agent/main.mjs"]);

      const repeated = await packageStagingBody(
        bodyProgram,
        join(directory, "body-program-repeat.tgz"),
      );
      expect(repeated.archiveSha256).toBe(evidence.archiveSha256);

      const maliciousTar = Buffer.from(gunzipSync(archive));
      let headerOffset = 0;
      while (headerOffset + 512 <= maliciousTar.length) {
        const type = String.fromCharCode(maliciousTar[headerOffset + 156] ?? 0);
        if (!["x", "g", "L", "K"].includes(type)) break;
        const size = Number.parseInt(
          maliciousTar
            .subarray(headerOffset + 124, headerOffset + 136)
            .toString("ascii")
            .replace(/\0.*$/u, "")
            .trim() || "0",
          8,
        );
        headerOffset += 512 + Math.ceil(size / 512) * 512;
      }
      maliciousTar.fill(0, headerOffset, headerOffset + 100);
      maliciousTar.write("._agent", headerOffset, "utf8");
      expect(() => inspectStagingBodyArchive(gzipSync(maliciousTar))).toThrow(
        "AppleDouble metadata is forbidden",
      );

      const duplicateArchivePath = join(
        directory,
        "duplicate-body-program.tgz",
      );
      execFileSync(
        "tar",
        [
          "-C",
          bodyProgram,
          "-czf",
          duplicateArchivePath,
          "agent",
          "agent/main.mjs",
        ],
        {
          env: {
            ...process.env,
            COPYFILE_DISABLE: "1",
            COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
          },
          stdio: "pipe",
        },
      );
      const duplicateArchive = await readFile(duplicateArchivePath);
      expect(() => inspectStagingBodyArchive(duplicateArchive)).toThrow(
        "Duplicate staging-body archive member",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("canonicalizes staging-body permissions across equivalent trees", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abl-body-modes-"));
    try {
      const archives: Buffer[] = [];
      for (const [name, directoryMode, fileMode] of [
        ["private", 0o700, 0o600],
        ["shared", 0o755, 0o644],
      ] as const) {
        const bodyProgram = join(directory, name);
        const agent = join(bodyProgram, "agent");
        await mkdir(join(agent, "config"), {
          recursive: true,
          mode: directoryMode,
        });
        await writeFile(join(agent, "main.mjs"), "export {};\n", {
          mode: 0o600,
        });
        await writeFile(join(agent, "config/settings.json"), "{}\n", {
          mode: fileMode,
        });
        await writeFile(join(agent, "runner"), "#!/bin/sh\n", {
          mode: fileMode | 0o111,
        });
        await symlink("runner", join(agent, "run"));
        const archivePath = join(directory, `${name}.tgz`);
        await packageStagingBody(bodyProgram, archivePath);
        archives.push(await readFile(archivePath));
      }

      expect(archives[1]).toEqual(archives[0]);
      expect(
        inspectStagingBodyArchive(archives[0] ?? Buffer.alloc(0)).map(
          ({ mode, path }) => [path.replace(/\/$/u, ""), mode],
        ),
      ).toEqual([
        ["agent", 0o755],
        ["agent/config", 0o755],
        ["agent/config/settings.json", 0o644],
        ["agent/main.mjs", 0o600],
        ["agent/run", 0o777],
        ["agent/runner", 0o755],
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
