import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  CAPACITY_TARGETS,
  NETWORK_LOAD_SLO,
  OVERLOAD_PRIORITY,
  allocateOverload,
  analyzeSandboxBoundary,
  exerciseThirtyDayWindDown,
  provePublicCompromiseContainment,
  runLocalCapacityProof,
  runHttpLoadProof,
  runLocalRecoveryProof,
  type WorkspaceTopologyShape,
} from "../src/index.js";

const root = new URL("../../../", import.meta.url);

describe("static sandbox and workspace containment proof", () => {
  it("covers every required escape vector and retains the live Blaxel sandbox gate", async () => {
    const [initSource, launcherSource, dockerfileSource] = await Promise.all([
      readFile(new URL("infra/sandbox/abl-sandbox-init", root), "utf8"),
      readFile(new URL("infra/sandbox/agent-runtime", root), "utf8"),
      readFile(new URL("Dockerfile", root), "utf8"),
    ]);
    const proofs = analyzeSandboxBoundary({
      initSource,
      launcherSource,
      dockerfileSource,
    });
    expect(proofs).toHaveLength(7);
    expect(new Set(proofs.map((proof) => proof.vector)).size).toBe(7);
    expect(proofs.every((proof) => proof.sourceVerified)).toBe(true);
    expect(
      proofs.every(
        (proof) =>
          !proof.liveExecuted &&
          proof.liveStatus === "NOT_EXECUTED_BLAXEL_SANDBOX_GATE",
      ),
    ).toBe(true);
  });

  it("proves the public topology has no command/private/competition path and no secret-like manifest value", async () => {
    const topology = JSON.parse(
      await readFile(new URL("infra/blaxel/topology.json", root), "utf8"),
    ) as WorkspaceTopologyShape;
    expect(provePublicCompromiseContainment(topology)).toMatchObject({
      contained: true,
      onlyCheckpointReadOutbound: true,
      privateWorkspaceCallsForbidden: true,
      commandAuthorityAbsent: true,
      competitionCredentialsAbsent: true,
      privateStorageAbsent: true,
    });
    const publicDirectory = new URL("infra/blaxel/abl-public/", root);
    const manifests = await Promise.all(
      (await readdir(publicDirectory))
        .filter((name) => name.endsWith(".yaml"))
        .map((name) => readFile(new URL(name, publicDirectory), "utf8")),
    );
    expect(manifests.join("\n")).not.toMatch(
      /database_url|drive_token|blfs|provider_api_key|service_credential|domain_key/i,
    );
  });
});

describe("local two-times capacity and SLO harness", () => {
  it("executes every target at 2x with zero event loss/duplication and records remote reservation gates", () => {
    const result = runLocalCapacityProof();
    expect(result).toMatchObject({
      mode: "LOCAL_IN_PROCESS_SYNTHETIC",
      passed: true,
      executed: {
        spectatorCursorPolls: 20_000,
        candidateRegistrations: 2_000,
        gameExecutions: 20,
        activeBodyObjects: 400,
      },
      observed: {
        acceptedCandidates: 2_000,
        exactGames: 20,
        activeBodies: 400,
        eventLoss: 0,
        eventDuplication: 0,
      },
      reservations: {
        state: "NOT_REQUESTED_MATERIAL_SPEND_GATE",
        liveBlaxelConcurrencyVerified: false,
        twoTimesRemoteHeadroomReserved: false,
        cost: null,
      },
    });
    expect(result.observed.publicErrorRate).toBeLessThan(0.01);
    expect(result.observed.cursorSegmentP95Milliseconds).toBeLessThan(750);
    expect(result.observed.broadcastLagMaximumMilliseconds).toBeLessThan(2_000);
  });

  it("measures bounded HTTP concurrency and treats status mismatches as failures", async () => {
    const result = await runHttpLoadProof([
      {
        name: "healthy-loopback",
        requestCount: 12,
        concurrency: 4,
        expectedStatus: 200,
        request: async () => new Response("ok", { status: 200 }),
      },
      {
        name: "status-mismatch",
        requestCount: 2,
        concurrency: 1,
        expectedStatus: 201,
        request: async () => new Response("wrong", { status: 200 }),
      },
    ]);
    expect(result).toMatchObject({
      mode: "LOCAL_LOOPBACK_HTTP",
      passed: false,
      observed: { requested: 14, completed: 14, failures: 2 },
      remoteCapacity: {
        state: "NOT_EXECUTED_BLAXEL_CAPACITY_GATE",
        liveConcurrencyVerified: false,
        headroomReserved: false,
      },
    });
    expect(result.workloads[0]?.responseP95Milliseconds).toBeLessThan(
      NETWORK_LOAD_SLO.responseP95MillisecondsMaximum,
    );
  });

  it("locks the external k6 profile to the approved counts and SLOs", async () => {
    const source = await readFile(
      new URL("tests/load/public-api.k6.js", root),
      "utf8",
    );
    expect(source).toMatch(
      /spectator_cursors: \{[\s\S]*?executor: "per-vu-iterations"[\s\S]*?vus: 10_000[\s\S]*?iterations: 2,/,
    );
    expect(source).toContain("iterations: 2_000");
    expect(source).toContain('http_req_failed: ["rate<0.01"]');
    expect(source).toContain('http_req_duration: ["p(95)<750"]');
  });

  it("locks the capacity/security plan fixture to executable constants", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("fixtures/local-assurance-plan.json", root),
        "utf8",
      ),
    ) as {
      targets: typeof CAPACITY_TARGETS;
      localExecutedAtTwoTimes: Record<string, number>;
      overloadPriority: string[];
      escapeVectors: string[];
    };
    expect(fixture.targets).toEqual(CAPACITY_TARGETS);
    expect(fixture.localExecutedAtTwoTimes).toEqual({
      spectatorCursorPolls: 20_000,
      candidateRegistrations: 2_000,
      gameExecutions: 20,
      activeBodyObjects: 400,
    });
    expect(fixture.overloadPriority).toEqual(OVERLOAD_PRIORITY);
    expect(fixture.escapeVectors).toHaveLength(7);
  });
});

describe("recovery and deliberative wind-down", () => {
  it("round-trips storage/guardian keys, clean-room body/exit, database history/outbox, checkpoint, and signing recovery", async () => {
    const result = await runLocalRecoveryProof();
    expect(result).toMatchObject({
      passed: true,
      storage: {
        encryptedRoundTrip: true,
        guardianRecovery: true,
        ciphertextOnly: true,
        liveDriveStatus: "NOT_EXECUTED_AGENT_DRIVE_GATE",
      },
      cleanRoomExit: {
        bodyRehydrated: true,
        exitPortable: true,
        subjectiveContinuityClaimed: false,
        liveSandboxStatus: "NOT_EXECUTED_BLAXEL_GATE",
      },
      database: {
        exact: true,
        eventCount: 3,
        outboxCount: 3,
        liveNeonPitrStatus: "NOT_EXECUTED_NEON_CREDENTIAL_GATE",
      },
      checkpoint: {
        localVerificationLabel: "UNVERIFIABLE",
        liveBaseStatus: "NOT_EXECUTED_BASE_CREDENTIAL_GATE",
      },
      keys: { recovered: true, guardianThreshold: 2, hardwareBacked: false },
    });
  });

  it("allocates overload strictly to games/rights/government/exit/continuity/autonomy before admissions/spectators", () => {
    const requests = OVERLOAD_PRIORITY.map((capacityClass, index) => ({
      requestId: `request-${index}`,
      capacityClass,
      units: 10,
    }));
    const result = allocateOverload(70, requests);
    expect(
      result.allocations
        .filter((allocation) => allocation.allocated)
        .map((allocation) => allocation.capacityClass),
    ).toEqual(OVERLOAD_PRIORITY.slice(0, 7));
    expect(
      result.allocations
        .filter((allocation) => !allocation.allocated)
        .map((allocation) => allocation.capacityClass),
    ).toEqual(["ADMISSIONS", "SPECTATORS"]);
  });

  it("exercises a funded 30-day essential reserve without sponsor authority", () => {
    const result = exerciseThirtyDayWindDown({
      reserveUnits: 3_000,
      dailyEssentialUnits: 100,
      portableExitCount: 64,
    });
    expect(result).toMatchObject({
      days: 30,
      requiredUnits: 3_000,
      everyDayFunded: true,
      portableExitCount: 64,
      sponsorAuthorityGranted: false,
      shedFirst: ["SPECTATORS", "ADMISSIONS"],
    });
    expect(
      exerciseThirtyDayWindDown({
        reserveUnits: 2_999,
        dailyEssentialUnits: 100,
        portableExitCount: 64,
      }).everyDayFunded,
    ).toBe(false);
  });
});
