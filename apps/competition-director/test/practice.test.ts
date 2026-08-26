import {
  executeCareerPlayerActivation,
  type CareerModelClient,
} from "../../staging-body/src/cognition-runtime.js";
import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import { SchemaVersion } from "@abl/schemas";
import { describe, expect, it } from "vitest";

import { runFoundingCareerSession } from "../src/practice.js";

const domain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111" as const,
};
const coordinator = createSigningIdentity(`0x${"1".repeat(64)}`);
const career = createSigningIdentity(`0x${"2".repeat(64)}`);
const applicationId = "0198e000-0000-7000-8000-000000000001";
const candidateDid = "did:abl:founding-player";
const coordinatorDid = "did:abl:competition-director";
const fixedNow = Date.parse("2026-08-26T12:00:00.000Z");

const identityReceipt = {
  schemaVersion: SchemaVersion,
  applicationId,
  candidateDid,
  roleClass: "PLAYER" as const,
  signingPublicKey: career.publicKey,
  signingAddress: career.address,
  encryptionPublicKey: `0x${"ab".repeat(32)}`,
  signingKeyAttestation: sha256Commitment("career-signing-key"),
  encryptionKeyAttestation: sha256Commitment("career-encryption-key"),
  runtimeAttestationDigest: sha256Commitment("career-runtime"),
  generatedInIsolatedRuntime: true as const,
  humanInputRoutes: [] as const,
  createdAt: new Date(fixedNow).toISOString(),
  proofSignature: `0x${"11".repeat(65)}`,
};

function careerInvoker(modelClient: CareerModelClient) {
  return {
    async identity() {
      return identityReceipt;
    },
    async activate(command: unknown) {
      return executeCareerPlayerActivation({
        command,
        identity: {
          ...career,
          candidateDid,
          applicationId,
          roleClass: "PLAYER",
        },
        coordinatorDid,
        coordinatorSignerAddress: coordinator.address,
        domain,
        modelClient,
        now: () => fixedNow + 1_000,
      });
    },
  };
}

describe("founding career practice", () => {
  it("resolves two model-authored, career-signed windows through the engine", async () => {
    const result = await runFoundingCareerSession({
      sessionId: "founding-practice-integration-0001",
      coordinatorDid,
      coordinatorIdentity: coordinator,
      domain,
      career: careerInvoker({
        async decide(activation) {
          const intent =
            activation.observation.window === 0
              ? {
                  windowId: activation.windowId,
                  playerId: activation.observation.playerId,
                  action: "HOLD" as const,
                }
              : {
                  windowId: activation.windowId,
                  playerId: activation.observation.playerId,
                  action: "SHOOT" as const,
                  shot: "LAYUP" as const,
                };
          return {
            intent,
            modelRevision: "founding-player-model-1",
            inputTokens: 200,
            outputTokens: 20,
          };
        },
      }),
      model: {
        name: "founding-player",
        provider: "blaxel",
        family: "structured-player",
        revision: "1",
        maxOutputTokens: 256,
      },
      now: () => fixedNow,
    });

    expect(result).toMatchObject({
      state: "COMPLETED",
      canonical: false,
      genesis: false,
      activationCount: 2,
      modelInvocationCount: 2,
      modelDecisionCount: 2,
      fallbackCount: 0,
      result: {
        recognition: "SIGNED_VALID",
        canonical: false,
        genesis: false,
      },
    });
    expect(result.result.outcome.snapshots.length).toBeGreaterThan(0);
    expect(result.result.decisionHashes).toHaveLength(2);
    expect(result.result.eventMerkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.result.finalStateRoot).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("keeps practice live with career-signed deterministic fallbacks", async () => {
    const result = await runFoundingCareerSession({
      sessionId: "founding-practice-fallback-0001",
      coordinatorDid,
      coordinatorIdentity: coordinator,
      domain,
      career: careerInvoker({
        async decide() {
          throw new Error("model unavailable");
        },
      }),
      model: {
        name: "founding-player",
        provider: "blaxel",
        family: "structured-player",
        revision: "1",
        maxOutputTokens: 256,
      },
      now: () => fixedNow,
    });

    expect(result.activationCount).toBe(2);
    expect(result.modelInvocationCount).toBe(2);
    expect(result.modelDecisionCount).toBe(0);
    expect(result.fallbackCount).toBe(2);
    expect(result.result.recognition).toBe("SIGNED_VALID");
  });
});
