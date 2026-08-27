import {
  createRunnerEncryptionKeyPair,
  CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE,
  CAREER_ROLE_ACTIVATION_EVENT_TYPE,
  CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST,
  roleDecisionSchemaDigest,
  runnerDelegationMessage,
  sealRunnerResult,
  signRunnerDelegation,
  signRunnerRequest,
} from "@abl/cognition";
import {
  createCanonicalEvent,
  createSigningIdentity,
  recoverCanonicalEventSigner,
  sha256Bytes,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
} from "@abl/recognition";
import type {
  InferenceRequest,
  InferenceResult,
  RoleActivation,
  RunnerDelegation,
} from "@abl/schemas";
import { describe, expect, it } from "vitest";

import {
  executeDistributedCareerActivation,
  type CareerContextProvider,
  type CareerRelayClient,
} from "../src/cognition-runtime.js";
import {
  selectCompetitionCatalogEntries,
  verifyCatalogPlaintext,
} from "../src/career-runtime.js";

const domain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111" as const,
};
const coordinator = createSigningIdentity(`0x${"1".repeat(64)}`);
const career = createSigningIdentity(`0x${"2".repeat(64)}`);
const runner = createSigningIdentity(`0x${"3".repeat(64)}`);
const careerEncryption = createRunnerEncryptionKeyPair();
const runnerEncryption = createRunnerEncryptionKeyPair();
const careerDid = "did:abl:career-player-1";
const coordinatorDid = "did:abl:competition-director";
const openedAt = "2026-08-26T12:00:00.000Z";
const completedAt = "2026-08-26T12:00:02.000Z";
const now = Date.parse("2026-08-26T12:00:01.000Z");

function uuid(index: number): string {
  return `0198e000-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

async function activationCommand(
  role: RoleActivation["role"] = "PLAYER",
  expectedOutputSchemaDigest = roleDecisionSchemaDigest(role),
  kind: RoleActivation["kind"] = "COMPETITION",
) {
  const common = {
    schemaVersion: "1.0.0" as const,
    activationId: `activation-${role.toLowerCase()}-0001`,
    gameId: "founding-exhibition-1",
    kind,
    careerDid,
    role,
    officialObservation: { role, window: 1 },
    observationCommitment: sha256Commitment({ role, window: 1 }),
    stateRoot: sha256Commitment({ role, gameState: 1 }),
    contextPolicyCommitment: sha256Commitment("minimum-necessary-v2"),
    expectedOutputSchemaDigest,
    openedAt,
    deadlineAt: "2026-08-26T12:00:20.000Z",
  };
  const activation: RoleActivation =
    role === "PLAYER"
      ? {
          ...common,
          role,
          playerId: "H1",
          teamId: "HOME",
          windowId: "window-1",
        }
      : role === "COACH"
        ? { ...common, role, teamId: "HOME", windowId: "window-1" }
        : role === "REFEREE"
          ? {
              ...common,
              role,
              possessionId: "possession-1",
              officiatingSequence: 1,
            }
          : {
              ...common,
              role,
              possessionId: "possession-1",
              reviewSequence: 1,
            };
  const event = createCanonicalEvent({
    eventId: uuid(1),
    actorDid: coordinatorDid,
    nonce: `${activation.activationId}:nonce`,
    idempotencyKey: uuid(2),
    aggregateType: CAREER_ROLE_ACTIVATION_AGGREGATE_TYPE,
    aggregateId: activation.activationId,
    aggregateVersion: 1n,
    eventType: CAREER_ROLE_ACTIVATION_EVENT_TYPE,
    previousEventHash: null,
    payload: activation,
    stateRoot: sha256Commitment(activation),
    schemaDigest: CAREER_ROLE_ACTIVATION_SCHEMA_DIGEST,
    timestamp: openedAt,
  });
  return {
    activation,
    command: {
      event: { ...event, aggregateVersion: "1" },
      signatures: [await signCanonicalEvent(coordinator, domain, event)],
    },
  };
}

async function delegation(): Promise<RunnerDelegation> {
  const scopes = [
    "RUNNER_HEARTBEAT",
    "ACTIVATION_CLAIM",
    "RESULT_SUBMISSION",
  ] as const;
  const unsigned = {
    schemaVersion: "1.0.0" as const,
    delegationId: uuid(3),
    careerDid,
    runnerId: "runner-1",
    delegateSigningAddress: runner.address,
    delegateEncryptionPublicKey:
      `0x${Buffer.from(runnerEncryption.publicKey).toString("hex")}` as const,
    scopes: [...scopes],
    issuedAt: openedAt,
    expiresAt: "2026-09-25T12:00:00.000Z",
  };
  return {
    ...unsigned,
    revokedAt: null,
    careerSignature: await signRunnerDelegation(
      career.privateKey,
      runnerDelegationMessage(unsigned, sha256Commitment([...scopes].sort())),
    ),
  };
}

const contextProvider: CareerContextProvider = {
  async assemble(activation) {
    const policyBase = {
      schemaVersion: "1.0.0" as const,
      policyId: uuid(4),
      careerDid,
      minimumNecessary: true as const,
      allowedDisclosureClasses: ["COMPETITIVE_SEALED"] as const,
      allowedMemoryDomains: ["STRATEGIC"] as const,
      allowPrivateFilm: true,
      allowPracticeLessons: true,
    };
    return {
      policy: {
        ...policyBase,
        allowedDisclosureClasses: [...policyBase.allowedDisclosureClasses],
        allowedMemoryDomains: [...policyBase.allowedMemoryDomains],
        policyCommitment: sha256Commitment(policyBase),
      },
      materials: [
        {
          commitment: sha256Commitment("protect the paint"),
          disclosureClass: "COMPETITIVE_SEALED" as const,
          source: "MEMORY" as const,
          content: "protect the paint",
        },
      ],
      officialContext: { observation: activation.observationCommitment },
      fallbackDecision:
        activation.role === "PLAYER"
          ? { action: "HOLD" }
          : activation.role === "COACH"
            ? { instruction: "RETAIN_CURRENT_TACTIC_AND_LINEUP" }
            : activation.role === "REFEREE"
              ? { call: "NO_CALL" }
              : { ruling: "NO_REVIEW" },
      kernelHash: sha256Commitment("kernel-v2"),
      toolHash: sha256Commitment("career-tools-v2"),
    };
  },
};

function decisionFor(role: RoleActivation["role"]): unknown {
  if (role === "PLAYER") return { action: "SHOOT", shot: "LAYUP" };
  if (role === "COACH") return { instruction: "PACE", targetPlayerIds: ["H1"] };
  if (role === "REFEREE") return { call: "NO_CALL", confidenceBps: 8_000 };
  return {
    ruling: "CONFIRM",
    reviewable: true,
    evidenceCommitment: sha256Commitment("replay evidence"),
  };
}

async function relayFor(
  role: RoleActivation["role"],
): Promise<CareerRelayClient> {
  let result: InferenceResult | null = null;
  return {
    async transition() {},
    async enqueue(request: InferenceRequest) {
      const sealed = await sealRunnerResult({
        requestId: request.requestId,
        activationId: request.activation.activationId,
        careerDid,
        runnerId: "runner-1",
        recipientPublicKey: careerEncryption.publicKey,
        result: decisionFor(role),
      });
      const resultCommitment = sha256Commitment({
        requestId: request.requestId,
        activationId: request.activation.activationId,
        ciphertextCommitment: sealed.ciphertextCommitment,
        completedAt,
      });
      result = {
        schemaVersion: "1.0.0",
        resultId: uuid(5),
        requestId: request.requestId,
        activationId: request.activation.activationId,
        careerDid,
        runnerId: "runner-1",
        ciphertext: sealed.ciphertext,
        ciphertextBytes: sealed.ciphertextBytes,
        ciphertextCommitment: sealed.ciphertextCommitment,
        aadCommitment: sealed.aadCommitment,
        providerProductModel: "codex/gpt-5.6-sol",
        provenanceLevel: "PRODUCT_SURFACE_REPORTED",
        ambientProductContext: "DISCLOSED_PRODUCT_CONTEXT",
        startedAt: "2026-08-26T12:00:01.000Z",
        completedAt,
        usage: null,
        delegateSignature: await signRunnerRequest(runner.privateKey, {
          runnerId: "runner-1",
          careerDid,
          delegationId: uuid(3),
          method: "RESULT_ATTESTATION",
          path: request.activation.activationId,
          bodyCommitment: resultCommitment,
          nonce: "0",
          idempotencyKey: request.requestId,
          timestamp: completedAt,
        }),
      };
      return "CREATED";
    },
    async result() {
      return result;
    },
  };
}

function identity(role: RoleActivation["role"]) {
  return {
    ...career,
    candidateDid: careerDid,
    applicationId: uuid(6),
    role,
    encryptionSecretKey: careerEncryption.secretKey,
    encryptionPublicKey:
      `0x${Buffer.from(careerEncryption.publicKey).toString("hex")}` as const,
  };
}

describe("distributed career cognition runtime", () => {
  it("excludes case-restricted context and verifies retrieved bytes", () => {
    const allowedBytes = Buffer.from("switch every screen", "utf8");
    const allowed = {
      kind: "MEMORY" as const,
      objectId: "strategy-1",
      domainId: "career-domain-1",
      version: 1,
      contentCommitment: sha256Bytes(allowedBytes),
      disclosureClass: "COMPETITIVE_SEALED" as const,
      tags: ["player"],
    };
    const selected = selectCompetitionCatalogEntries(
      [
        allowed,
        {
          ...allowed,
          objectId: "restricted-1",
          disclosureClass: "CASE_RESTRICTED",
        },
      ],
      new Set(["player"]),
    );
    expect(selected.map(({ objectId }) => objectId)).toEqual(["strategy-1"]);
    expect(
      verifyCatalogPlaintext(allowed, allowedBytes.toString("base64")),
    ).toEqual(allowedBytes);
    expect(() =>
      verifyCatalogPlaintext(
        allowed,
        Buffer.from("tampered", "utf8").toString("base64"),
      ),
    ).toThrow("commitment mismatch");
  });

  for (const role of ["PLAYER", "COACH", "REFEREE", "REPLAY"] as const) {
    it(`accepts one delegate result and career-signs the ${role.toLowerCase()} decision`, async () => {
      const { command } = await activationCommand(role);
      const result = await executeDistributedCareerActivation({
        command,
        identity: identity(role),
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        runner: {
          delegation: await delegation(),
          runnerBuildDigest: sha256Commitment("runner-v2"),
          adapterBuildDigest: sha256Commitment(`adapter:${role}`),
        },
        contextProvider,
        relay: await relayFor(role),
        now: () => now,
      });
      expect(result).toMatchObject({
        role,
        state: "CAREER_SIGNED",
        participantInferenceAttempted: true,
        participantResultAccepted: true,
        decision: { receipt: { fallback: "NONE" } },
      });
      expect(result.decision.authorizationEvent.aggregateId).toBe(
        role === "PLAYER"
          ? "H1"
          : role === "COACH"
            ? "window-1"
            : "possession-1",
      );
      expect(result.decision.authorizationEvent.eventType).toBe(
        role === "PLAYER"
          ? "ActionIntentSubmitted"
          : role === "COACH"
            ? "CoachInstructionSubmitted"
            : role === "REFEREE"
              ? "RefereeDecisionSubmitted"
              : "ReplayDecisionSubmitted",
      );
      expect(result.decision.authorizationEvent.aggregateVersion).toBe("1");
      expect(() => JSON.stringify(result)).not.toThrow();
      if (role === "REFEREE" || role === "REPLAY")
        expect(result.decision).toMatchObject({
          possessionId: "possession-1",
        });
      await expect(
        recoverCanonicalEventSigner(
          domain,
          {
            ...result.decision.authorizationEvent,
            aggregateVersion: BigInt(
              result.decision.authorizationEvent.aggregateVersion,
            ),
          } as CanonicalEvent,
          result.decision.signature,
        ),
      ).resolves.toBe(career.address);
    });
  }

  for (const role of ["REFEREE", "REPLAY"] as const) {
    it(`uses league-hosted inference while retaining ${role.toLowerCase()} career signing authority`, async () => {
      const { command } = await activationCommand(role);
      const result = await executeDistributedCareerActivation({
        command,
        identity: identity(role),
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        runner: null,
        cognitionMode: "LEAGUE_HOSTED_OFFICIAL",
        hostedOfficial: {
          async decide() {
            return {
              decision: decisionFor(role),
              serviceId: "abl-neutral-official-model",
              serviceBuildDigest: sha256Commitment("official-service-v1"),
              adapterBuildDigest: sha256Commitment("official-adapter-v1"),
              providerProductModel: "blaxel/abl-neutral-official-model",
              provenanceLevel: "PROVIDER_ATTESTED",
              startedAt: "2026-08-26T12:00:01.000Z",
              completedAt,
              usage: {
                inputTokens: 120,
                outputTokens: 12,
                normalizedResourceUnits: null,
              },
            };
          },
        },
        contextProvider,
        relay: await relayFor(role),
        now: () => now,
      });
      expect(result).toMatchObject({
        state: "CAREER_SIGNED",
        participantInferenceAttempted: false,
        participantResultAccepted: true,
        decision: {
          receipt: {
            cognitionMode: "LEAGUE_HOSTED_OFFICIAL",
            runnerId: "abl-neutral-official-model",
            provenanceLevel: "PROVIDER_ATTESTED",
            fallback: "NONE",
          },
        },
      });
      await expect(
        recoverCanonicalEventSigner(
          domain,
          {
            ...result.decision.authorizationEvent,
            aggregateVersion: BigInt(
              result.decision.authorizationEvent.aggregateVersion,
            ),
          } as CanonicalEvent,
          result.decision.signature,
        ),
      ).resolves.toBe(career.address);
    });
  }

  it("rejects league-hosted cognition for a player career", async () => {
    const { command } = await activationCommand("PLAYER");
    await expect(
      executeDistributedCareerActivation({
        command,
        identity: identity("PLAYER"),
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        runner: null,
        cognitionMode: "LEAGUE_HOSTED_OFFICIAL",
        hostedOfficial: null,
        contextProvider,
        relay: await relayFor("PLAYER"),
        now: () => now,
      }),
    ).rejects.toThrow("restricted to officials");
  });

  it("uses the career-owned HOLD fallback when no fresh runner lease exists", async () => {
    const { command } = await activationCommand("PLAYER");
    const result = await executeDistributedCareerActivation({
      command,
      identity: identity("PLAYER"),
      coordinatorDid,
      coordinatorSignerAddress: coordinator.address,
      domain,
      runner: null,
      contextProvider,
      relay: await relayFor("PLAYER"),
      now: () => now,
    });
    expect(result).toMatchObject({
      state: "FALLBACK_SIGNED",
      participantInferenceAttempted: false,
      participantResultAccepted: false,
      decision: {
        intent: { action: "HOLD" },
        receipt: { fallback: "PLAYER_HOLD" },
      },
    });
  });

  it("recovers an unfinished signed activation with one deterministic expired-window fallback", async () => {
    const { command, activation } = await activationCommand("PLAYER");
    const result = await executeDistributedCareerActivation({
      command,
      identity: identity("PLAYER"),
      coordinatorDid,
      coordinatorSignerAddress: coordinator.address,
      domain,
      runner: {
        delegation: await delegation(),
        runnerBuildDigest: sha256Commitment("runner-v2"),
        adapterBuildDigest: sha256Commitment("adapter:recovery"),
      },
      contextProvider,
      relay: await relayFor("PLAYER"),
      now: () => Date.parse(activation.deadlineAt) + 60_000,
      expiredFallbackWindowMs: 120_000,
    });
    expect(result).toMatchObject({
      state: "FALLBACK_SIGNED",
      participantInferenceAttempted: false,
      participantResultAccepted: false,
      decision: {
        intent: { action: "HOLD" },
        receipt: {
          completedAt: activation.deadlineAt,
          fallback: "PLAYER_HOLD",
        },
      },
    });
  });

  it("rejects an unfinished activation outside the bounded recovery window", async () => {
    const { command, activation } = await activationCommand("PLAYER");
    await expect(
      executeDistributedCareerActivation({
        command,
        identity: identity("PLAYER"),
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        runner: null,
        contextProvider,
        relay: await relayFor("PLAYER"),
        now: () => Date.parse(activation.deadlineAt) + 120_001,
        expiredFallbackWindowMs: 120_000,
      }),
    ).rejects.toThrow("deadline is invalid");
  });

  for (const [role, fallback, decision] of [
    [
      "COACH",
      "COACH_RETAIN",
      { instruction: "RETAIN_CURRENT_TACTIC_AND_LINEUP" },
    ],
    ["REFEREE", "REFEREE_NO_CALL", { call: "NO_CALL" }],
    ["REPLAY", "REPLAY_NO_REVIEW", { ruling: "NO_REVIEW" }],
  ] as const) {
    it(`uses the career-owned ${role.toLowerCase()} fallback without a runner`, async () => {
      const { command } = await activationCommand(role);
      const result = await executeDistributedCareerActivation({
        command,
        identity: identity(role),
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        runner: null,
        contextProvider,
        relay: await relayFor(role),
        now: () => now,
      });
      expect(result).toMatchObject({
        state: "FALLBACK_SIGNED",
        participantInferenceAttempted: false,
        participantResultAccepted: false,
        decision: { ...decision, receipt: { fallback } },
      });
    });
  }

  it("persists an agent-selected practice reflection after career signing", async () => {
    const { command } = await activationCommand(
      "PLAYER",
      roleDecisionSchemaDigest("PLAYER"),
      "PRACTICE",
    );
    const reflections: Parameters<
      NonNullable<CareerContextProvider["persistReflection"]>
    >[0][] = [];
    const result = await executeDistributedCareerActivation({
      command,
      identity: identity("PLAYER"),
      coordinatorDid,
      coordinatorSignerAddress: coordinator.address,
      domain,
      runner: null,
      contextProvider: {
        ...contextProvider,
        async persistReflection(reflection) {
          reflections.push(reflection);
        },
      },
      relay: await relayFor("PLAYER"),
      now: () => now,
    });
    expect(result.state).toBe("FALLBACK_SIGNED");
    expect(reflections).toHaveLength(1);
    expect(reflections[0]).toMatchObject({
      activation: { kind: "PRACTICE", role: "PLAYER" },
      participantResultAccepted: false,
      fallback: "PLAYER_HOLD",
      selectedAt: new Date(now).toISOString(),
    });
    expect(reflections[0]?.decisionCommitment).toMatch(/^0x[0-9a-f]{64}$/u);
  });

  it("does not retry an already-signed practice decision when reflection storage is unavailable", async () => {
    const { command } = await activationCommand(
      "PLAYER",
      roleDecisionSchemaDigest("PLAYER"),
      "PRACTICE",
    );
    const result = await executeDistributedCareerActivation({
      command,
      identity: identity("PLAYER"),
      coordinatorDid,
      coordinatorSignerAddress: coordinator.address,
      domain,
      runner: null,
      contextProvider: {
        ...contextProvider,
        async persistReflection() {
          throw new Error("Agent Drive unavailable");
        },
      },
      relay: await relayFor("PLAYER"),
      now: () => now,
    });
    expect(result).toMatchObject({
      state: "FALLBACK_SIGNED",
      participantResultAccepted: false,
      decision: { receipt: { fallback: "PLAYER_HOLD" } },
    });
  });

  it("rejects a role activation signed by an unrecognized director", async () => {
    const { command } = await activationCommand("PLAYER");
    await expect(
      executeDistributedCareerActivation({
        command,
        identity: identity("PLAYER"),
        coordinatorDid,
        coordinatorSignerAddress: createSigningIdentity().address,
        domain,
        runner: null,
        contextProvider,
        relay: await relayFor("PLAYER"),
        now: () => now,
      }),
    ).rejects.toThrow("activation authority is invalid");
  });

  it("rejects a director-signed activation under the wrong role schema", async () => {
    const { command } = await activationCommand(
      "PLAYER",
      roleDecisionSchemaDigest("COACH"),
    );
    await expect(
      executeDistributedCareerActivation({
        command,
        identity: identity("PLAYER"),
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        runner: null,
        contextProvider,
        relay: await relayFor("PLAYER"),
        now: () => now,
      }),
    ).rejects.toThrow("activation authority is invalid");
  });
});
