import {
  CAREER_PLAYER_ACTIVATION_AGGREGATE_TYPE,
  CAREER_PLAYER_ACTIVATION_EVENT_TYPE,
  CAREER_PLAYER_ACTIVATION_SCHEMA_DIGEST,
  CareerPlayerActivationPayloadSchema,
  publicPracticeScenario,
} from "@abl/basketball";
import {
  createCanonicalEvent,
  createSigningIdentity,
  recoverCanonicalEventSigner,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  BrokerCareerModelClient,
  executeCareerPlayerActivation,
  type CareerModelClient,
} from "../src/cognition-runtime.js";

const domain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111" as const,
};
const coordinator = createSigningIdentity(`0x${"1".repeat(64)}`);
const career = createSigningIdentity(`0x${"2".repeat(64)}`);
const applicationId = "0198e000-0000-7000-8000-000000000001";
const coordinatorDid = "did:abl:competition-director";
const openedAt = "2026-08-26T12:00:00.000Z";
const now = Date.parse("2026-08-26T12:00:01.000Z");

async function activationCommand(
  signer = coordinator,
  deadlineAt = "2026-08-26T12:00:20.000Z",
) {
  const scenario = publicPracticeScenario();
  const activation = CareerPlayerActivationPayloadSchema.parse({
    schemaVersion: "1.0.0" as const,
    activationId: "founding-practice-window-0001",
    kind: "PRACTICE" as const,
    applicationId,
    candidateDid: scenario.observation.self.did,
    roleClass: "PLAYER" as const,
    windowId: scenario.decisionRequirements.windowId,
    observation: scenario.observation,
    openedAt,
    deadlineAt,
    model: {
      name: "approved-player-model",
      provider: "blaxel",
      family: "structured-player",
      revision: "1",
      maxOutputTokens: 256,
    },
    context: {
      manifestHash: sha256Commitment("manifest"),
      kernelHash: sha256Commitment("kernel"),
      toolHash: sha256Commitment("tools"),
      personalMaterialSupplied: [],
    },
  });
  const event = createCanonicalEvent({
    eventId: "0198e001-0000-7000-8000-000000000001",
    actorDid: coordinatorDid,
    nonce: `${activation.activationId}:nonce`,
    idempotencyKey: "0198e001-0000-7000-8000-000000000002",
    aggregateType: CAREER_PLAYER_ACTIVATION_AGGREGATE_TYPE,
    aggregateId: activation.activationId,
    aggregateVersion: 1n,
    eventType: CAREER_PLAYER_ACTIVATION_EVENT_TYPE,
    previousEventHash: null,
    payload: activation,
    stateRoot: sha256Commitment(activation),
    schemaDigest: CAREER_PLAYER_ACTIVATION_SCHEMA_DIGEST,
    timestamp: openedAt,
  });
  return {
    activation,
    command: {
      event: { ...event, aggregateVersion: event.aggregateVersion.toString() },
      signatures: [await signCanonicalEvent(signer, domain, event)],
    },
  };
}

function identity(candidateDid: string) {
  return {
    ...career,
    candidateDid,
    applicationId,
    roleClass: "PLAYER" as const,
  };
}

describe("career cognition runtime", () => {
  it("renews a denied short-lived broker capability and retries once", async () => {
    const { activation } = await activationCommand();
    const authorizations: string[] = [];
    const modelClient = new BrokerCareerModelClient({
      origin: "https://broker.example/",
      capabilityToken: "expired-capability-token-000000000001",
      modelPath:
        "/agent-basketball-league/models/founding-player/v1/chat/completions",
      renewCapability: async () => "renewed-capability-token-000000000001",
      fetchImplementation: async (_url, init) => {
        const authorization = new Headers(init?.headers).get("authorization")!;
        authorizations.push(authorization);
        if (authorizations.length === 1)
          return Response.json(
            { error: "broker_policy_denied" },
            { status: 403 },
          );
        return Response.json({
          model: "founding-player-1",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  windowId: activation.windowId,
                  playerId: activation.observation.playerId,
                  action: "HOLD",
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        });
      },
    });

    await expect(modelClient.decide(activation, 1_000)).resolves.toMatchObject({
      intent: { action: "HOLD" },
      modelRevision: "founding-player-1",
      inputTokens: 100,
      outputTokens: 10,
    });
    expect(authorizations).toEqual([
      "Bearer expired-capability-token-000000000001",
      "Bearer renewed-capability-token-000000000001",
    ]);
  });

  it("turns a model decision into a career-signed player command", async () => {
    const { activation, command } = await activationCommand();
    const modelClient: CareerModelClient = {
      async decide() {
        return {
          intent: {
            windowId: activation.windowId,
            playerId: activation.observation.playerId,
            action: "SHOOT",
            shot: "LAYUP",
          },
          modelRevision: "structured-player-2026-08-26",
          inputTokens: 400,
          outputTokens: 32,
        };
      },
    };
    const result = await executeCareerPlayerActivation({
      command,
      identity: identity(activation.candidateDid),
      coordinatorDid,
      coordinatorSignerAddress: coordinator.address,
      domain,
      modelClient,
      now: () => now,
    });

    expect(result).toMatchObject({
      activationId: activation.activationId,
      state: "COMPLETED",
      canonical: false,
      genesis: false,
      modelAttempted: true,
      modelDecisionAccepted: true,
      decision: {
        intent: { action: "SHOOT", shot: "LAYUP" },
        receipt: {
          fallbackUsed: false,
          normalizedResourceUnits: 432,
          telemetryContentPolicy: "CONTENT_DISABLED",
        },
      },
    });
    await expect(
      recoverCanonicalEventSigner(
        domain,
        result.decision.authorizationEvent,
        result.decision.signature,
      ),
    ).resolves.toBe(career.address);
  });

  it("signs a deterministic HOLD when inference fails", async () => {
    const { activation, command } = await activationCommand();
    const result = await executeCareerPlayerActivation({
      command,
      identity: identity(activation.candidateDid),
      coordinatorDid,
      coordinatorSignerAddress: coordinator.address,
      domain,
      modelClient: {
        async decide() {
          throw new Error("provider unavailable");
        },
      },
      now: () => now,
    });

    expect(result.modelAttempted).toBe(true);
    expect(result.modelDecisionAccepted).toBe(false);
    expect(result.decision.intent).toEqual({
      windowId: activation.windowId,
      playerId: activation.observation.playerId,
      action: "HOLD",
    });
    expect(result.decision.receipt.fallbackUsed).toBe(true);
    expect(result.decision.receipt.normalizedResourceUnits).toBe(0);
  });

  it("rejects the wrong coordinator and expired windows", async () => {
    const wrongSigner = createSigningIdentity(`0x${"3".repeat(64)}`);
    const wrong = await activationCommand(wrongSigner);
    const expired = await activationCommand(
      coordinator,
      "2026-08-26T12:00:00.500Z",
    );
    const modelClient: CareerModelClient = {
      async decide() {
        throw new Error("must not be invoked");
      },
    };

    await expect(
      executeCareerPlayerActivation({
        command: wrong.command,
        identity: identity(wrong.activation.candidateDid),
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        modelClient,
        now: () => now,
      }),
    ).rejects.toThrow("authority is invalid");
    await expect(
      executeCareerPlayerActivation({
        command: expired.command,
        identity: identity(expired.activation.candidateDid),
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        modelClient,
        now: () => now,
      }),
    ).rejects.toThrow("after its deadline");
  });
});
