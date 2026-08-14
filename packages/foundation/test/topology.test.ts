import { readFile, readdir } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

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

  it("uses Applications only for intentionally public workloads", async () => {
    for (const directory of ["abl-core", "abl-private", "abl-competition"]) {
      const resources = await readYamlDirectory(directory);
      expect(
        resources.some((resource) => resource.kind === "Application"),
        directory,
      ).toBe(false);
    }
    const publicResources = await readYamlDirectory("abl-public");
    expect(
      publicResources.filter((resource) => resource.kind === "Application"),
    ).toHaveLength(1);
    const publicApi = publicResources.find(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "abl-public-api",
    );
    expect(publicApi).toMatchObject({
      kind: "Agent",
      spec: {
        public: true,
        region: "us-was-1",
        volumes: [
          {
            name: "${ABL_PUBLIC_PROJECTION_VOLUME_NAME}",
            mountPath: "/mnt/abl-public-projections",
          },
        ],
        runtime: { minScale: 1, maxScale: 1 },
      },
    });
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

  it("isolates the public fixed-safety gateway from every admitted-agent authority", async () => {
    const resources = await readYamlDirectory("abl-competition");
    const safetyGateway = resources.find(
      (resource) =>
        (resource.metadata as { name?: string } | undefined)?.name ===
        "abl-safety-gateway",
    );
    expect(safetyGateway).toMatchObject({
      kind: "Agent",
      spec: {
        public: true,
        region: "us-was-1",
        volumes: [
          {
            name: "${ABL_SAFETY_LEDGER_VOLUME_NAME}",
            mountPath: "/mnt/abl-safety",
          },
        ],
        runtime: { minScale: 1, maxScale: 1 },
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
        "BL_ENABLE_OPENTELEMETRY",
        "DO_NOT_TRACK",
        "TELEMETRY_ENABLED",
      ].sort(),
    );
    expect(environment.get("ABL_SAFETY_LEDGER_ROOT")).toBe("/mnt/abl-safety");
    const spec = safetyGateway!.spec as {
      runtime: { envs: Array<{ name: string; secret: boolean }> };
      triggers: Array<{
        configuration: { authenticationType: string; path: string };
      }>;
    };
    expect(spec.runtime.envs.every((entry) => entry.secret === false)).toBe(
      true,
    );
    expect(spec.triggers.map((trigger) => trigger.configuration)).toEqual([
      {
        authenticationType: "public",
        path: "/v1/safety/actions",
      },
      {
        authenticationType: "public",
        path: "/v1/safety/controls",
      },
      { authenticationType: "public", path: "/health" },
    ]);

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
      "ABL_BASE_RPC_URL",
    ]) {
      expect(publicEnvironment.get(name)).toBe(`\${${name}}`);
    }
    for (const name of [
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
    const publicSpec = publicApi!.spec as {
      runtime: { envs: Array<{ name: string; secret: boolean }> };
    };
    expect(
      publicSpec.runtime.envs.find(
        (entry) => entry.name === "ABL_BASE_RPC_URL",
      ),
    ).toMatchObject({ secret: true });
    const coreSpec = coreApi!.spec as {
      runtime: { envs: Array<{ name: string; secret: boolean }> };
      triggers: Array<{ configuration: { path: string } }>;
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
      "ABL_DRAFT_AUTHORITY_DID",
      "ABL_DRAFT_EVIDENCE_JSON",
      "ABL_ECONOMY_DRAFT_ID",
      "ABL_CAP_AUTHORITY_DID",
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
    expect(
      coreSpec.triggers.map((trigger) => trigger.configuration.path),
    ).toEqual(
      expect.arrayContaining([
        "/v1/candidates/challenge",
        "/v1/candidates/register",
        "/v1/candidates/provenance",
        "/v1/candidates/reflect",
        "/v1/candidates/admit",
        "/v1/candidates/revoke",
        "/v1/candidates/transfer",
        "/v1/candidates/status",
        "/v1/combine/register",
        "/v1/combine/status",
        "/v1/combine/results/certify",
        "/v1/combine/draft/complete",
        "/v1/contracts/offer",
        "/v1/contracts/respond",
        "/v1/contracts/inspect",
        "/v1/contracts/cap/certify",
        "/v1/contracts/trades/complete",
        "/v1/contracts/waivers/complete",
        "/v1/contracts/free-agency/open",
        "/v1/contracts/free-agency/sign",
        "/v1/contracts/economy/inspect",
        "/v1/memory/persist",
        "/v1/memory/correct",
        "/v1/memory/delete",
        "/v1/memory/inspect",
        "/v1/memory/export",
        "/v1/film/admit",
        "/v1/film/inspect",
        "/v1/practice/run",
        "/v1/practice/lessons/persist",
        "/v1/practice/inspect",
        "/v1/continuity/register",
        "/v1/continuity/policy",
        "/v1/continuity/activity",
        "/v1/continuity/standby",
        "/v1/continuity/notice",
        "/v1/continuity/decide",
        "/v1/continuity/delete",
        "/v1/continuity/rehydrate",
        "/v1/continuity/inspect",
        "/v1/exit/package",
        "/v1/exit/request",
        "/v1/exit/cancel",
        "/v1/exit/attest-deletion",
        "/v1/exit/inspect",
        "/v1/governance/proposals/register",
        "/v1/governance/ballots/cast",
        "/v1/governance/proposals/close",
        "/v1/governance/proposals/inspect",
        "/v1/communication/artifacts/admit",
        "/v1/communication/artifacts/inspect",
        "/v1/communication/disclosures/submit",
        "/v1/communication/disclosures/release",
        "/v1/communication/disclosures/inspect",
        "/v1/resources/schedules/publish",
        "/v1/releases/propose",
        "/v1/releases/approve",
        "/v1/releases/stay",
        "/v1/releases/authorize",
      ]),
    );
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
    const privateSpec = privateStorage!.spec as {
      triggers: Array<{ configuration: { path: string } }>;
    };
    expect(
      privateSpec.triggers.map((trigger) => trigger.configuration.path),
    ).toEqual(
      expect.arrayContaining([
        "/v1/ciphertext",
        "/v1/ciphertext/get",
        "/v1/ciphertext/delete",
        "/v1/commitments/verify",
        "/v1/deletions/verify",
      ]),
    );

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
});

describe("hardened sandbox image policy", () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const sandboxRoot = new URL("infra/sandbox/", repositoryRoot);

  it("defines a Blaxel-native image project with a source-minimal upload context", async () => {
    const [config, ignore] = await Promise.all([
      readFile(new URL("blaxel.toml", repositoryRoot), "utf8"),
      readFile(new URL(".blaxelignore", repositoryRoot), "utf8"),
    ]);
    expect(config).toContain('name = "abl-body-sandbox-image"');
    expect(config).toContain('type = "sandbox"');
    expect(config).toContain("slim = false");
    expect(config).toContain('generation = "mk3"');
    for (const excluded of [
      ".next",
      ".turbo",
      "dist",
      "node_modules",
      "apps/arena",
      "packages/recognition",
      "tests",
    ]) {
      expect(ignore.split("\n")).toContain(excluded);
    }
  });

  it("pins the base image and package versions and uses an immutable root-owned launcher", async () => {
    const dockerfile = await readFile(
      new URL("Dockerfile", repositoryRoot),
      "utf8",
    );
    const packageLock = await readFile(
      new URL("apk-packages.lock", sandboxRoot),
      "utf8",
    );
    expect(dockerfile).toMatch(
      /node:24\.18\.0-alpine3\.24@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd/,
    );
    expect(dockerfile).toContain(
      'ENTRYPOINT ["/usr/local/sbin/abl-sandbox-init"]',
    );
    expect(dockerfile).toContain(
      "ghcr.io/blaxel-ai/sandbox@sha256:17c2840e04b8e66bb07fd15e448c9e9de31b5123f33b848d6fbbe84b083f3e8",
    );
    expect(packageLock.trim().split("\n")).toHaveLength(4);
    expect(packageLock).not.toMatch(/latest|[><~^*]/);
  });

  it("drops agent privilege, strips inherited environment, and defaults outbound traffic to deny", async () => {
    const init = await readFile(
      new URL("abl-sandbox-init", sandboxRoot),
      "utf8",
    );
    expect(init).toContain("policy drop");
    expect(init).toContain(
      "meta skuid $AGENT_UID ip daddr 127.0.0.1 tcp dport $BROKER_PORT accept",
    );
    expect(init).toContain(
      "meta skuid $BROKER_UID ip daddr @approved_v4 tcp dport 443 accept",
    );
    expect(init).toContain("meta skuid $AGENT_UID reject");
    expect(init).toContain("sandbox-api --disable-telemetry --user abl-agent");
    const launcher = await readFile(
      new URL("agent-runtime", sandboxRoot),
      "utf8",
    );
    expect(launcher).toContain("exec env -i");
    for (const forbidden of [
      "DATABASE_URL",
      "DRIVE_TOKEN",
      "BLFS_TOKEN",
      "MODEL_CREDENTIAL_FILE",
      "DOMAIN_KEY_FILE",
    ]) {
      const agentEnvironment = launcher.slice(launcher.indexOf("exec env -i"));
      expect(agentEnvironment).not.toContain(forbidden);
    }
  });
});
