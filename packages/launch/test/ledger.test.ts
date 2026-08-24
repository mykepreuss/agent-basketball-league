import { describe, expect, it } from "vitest";

import { LaunchLedgerInputSchema, deriveLaunchLedger } from "../src/index.js";

const digest = `0x${"1".repeat(64)}`;
const at = "2026-08-19T12:00:00.000Z";

function input() {
  return {
    launchStage: "LOCAL_GATE_1",
    operatingProfile: "PRE_GENESIS_CLOSED",
    requirements: [
      {
        requirementId: "gate-1-local-verification",
        requiredForStage: "LOCAL_GATE_1",
        status: "VERIFIED_COMPLETE",
        evidenceIds: ["exact-runtime-tests"],
      },
    ],
    evidence: [
      {
        evidenceId: "exact-runtime-tests",
        digest,
        verification: "PASSED",
      },
    ],
    signatures: [],
    approvals: [],
    resources: [],
    deployments: [],
    incidents: [],
    recognitionLevel: "NONE",
    intake: {
      mode: "CLOSED",
      capacityState: "CLOSED",
      requirementsUri: "/v1/candidate-intake",
      capacityPolicyUri: "/v1/candidate-intake/capacity-policy",
    },
    updatedAt: at,
  } as const;
}

describe("derived launch ledger", () => {
  it("derives readiness and a deterministic launch-state digest", () => {
    const first = deriveLaunchLedger(input());
    const second = deriveLaunchLedger(input());
    expect(first.gateStatus).toBe("READY");
    expect(first.launchState.genesis).toBe(false);
    expect(first.launchState.lastSuccessfulAcceptance).toBeNull();
    expect(first.ledgerDigest).toBe(second.ledgerDigest);
  });

  it("does not accept manually asserted readiness", () => {
    expect(
      LaunchLedgerInputSchema.safeParse({ ...input(), ready: true }).success,
    ).toBe(false);
  });

  it("blocks on missing proof and cannot promote Genesis without approvals", () => {
    const blocked = deriveLaunchLedger({
      ...input(),
      launchStage: "PRODUCTION_GENESIS",
      operatingProfile: "PRODUCTION_GENESIS",
      recognitionLevel: "ONCHAIN_FINALIZED",
      requirements: [
        {
          requirementId: "live-drive-proof",
          requiredForStage: "PRIVATE_STAGING",
          status: "IMPLEMENTED_LIVE_PROOF_REQUIRED",
          evidenceIds: ["missing"],
        },
      ],
    });
    expect(blocked.gateStatus).toBe("BLOCKED");
    expect(blocked.launchState.genesis).toBe(false);
    expect(blocked.launchState.launchStage).toBe("PRODUCTION_GENESIS");
    expect(blocked.launchState.operatingProfile).toBe(
      "PRODUCTION_V1_PRE_GENESIS",
    );
    expect(blocked.launchState.blockingReasons).toContain(
      "live-drive-proof: IMPLEMENTED_LIVE_PROOF_REQUIRED",
    );
  });

  it("blocks required signatures and binds verified signatures to passed evidence", () => {
    const required = deriveLaunchLedger({
      ...input(),
      launchStage: "GENESIS_READY",
      signatures: [
        {
          signatureId: "founding-release-signature",
          requiredForStage: "GENESIS_READY",
          purpose: "Authorize the founding release",
          signerDid: null,
          state: "REQUIRED",
          evidenceId: null,
        },
      ],
    });
    expect(required.gateStatus).toBe("BLOCKED");
    expect(required.launchState.blockingReasons).toContain(
      "founding-release-signature: REQUIRED",
    );

    const verified = deriveLaunchLedger({
      ...input(),
      signatures: [
        {
          signatureId: "local-release-check",
          requiredForStage: "LOCAL_GATE_1",
          purpose: "Bind the local verification result",
          signerDid: "did:abl:release-verifier",
          state: "VERIFIED",
          evidenceId: "exact-runtime-tests",
        },
      ],
    });
    expect(verified.gateStatus).toBe("READY");
  });

  it("does not let future requirements regress an earlier stage", () => {
    const privateStaging = deriveLaunchLedger({
      ...input(),
      launchStage: "PRIVATE_STAGING",
      requirements: [
        ...input().requirements,
        {
          requirementId: "private-live-proof",
          requiredForStage: "PRIVATE_STAGING",
          status: "IMPLEMENTED_LIVE_PROOF_REQUIRED",
          evidenceIds: ["private-proof"],
        },
        {
          requirementId: "founding-agent-ratification",
          requiredForStage: "GENESIS_READY",
          status: "BLOCKED_EXTERNAL_INPUT_REQUIRED",
          evidenceIds: [],
        },
      ],
      evidence: [
        ...input().evidence,
        {
          evidenceId: "private-proof",
          digest,
          verification: "LIVE_PROOF_REQUIRED",
        },
      ],
    });

    expect(privateStaging.gateStatus).toBe("BLOCKED");
    expect(privateStaging.launchState.launchStage).toBe("PRIVATE_STAGING");
    expect(privateStaging.launchState.blockingReasons).toEqual([
      "private-live-proof: IMPLEMENTED_LIVE_PROOF_REQUIRED",
      "private-live-proof: evidence private-proof not passed",
    ]);
    expect(privateStaging.launchState.nextBlockingRequirement).toBe(
      "private-live-proof: IMPLEMENTED_LIVE_PROOF_REQUIRED",
    );
  });

  it("reports candidate intake instead of collapsing public exposure to read-only", () => {
    const intake = deriveLaunchLedger({
      ...input(),
      launchStage: "CAPPED_FOUNDING_INTAKE",
      intake: {
        ...input().intake,
        mode: "CAPPED_PUBLIC",
        capacityState: "AVAILABLE",
      },
    });

    expect(intake.gateStatus).toBe("READY");
    expect(intake.launchState.publicExposure).toBe("CANDIDATE_INTAKE");
  });

  it("records the last completed stage without asserting the current gate is ready", () => {
    const privateStaging = deriveLaunchLedger({
      ...input(),
      launchStage: "PRIVATE_STAGING",
      requirements: [
        ...input().requirements,
        {
          requirementId: "private-live-proof",
          requiredForStage: "PRIVATE_STAGING",
          status: "IMPLEMENTED_LIVE_PROOF_REQUIRED",
          evidenceIds: ["private-proof"],
        },
      ],
      evidence: [
        ...input().evidence,
        {
          evidenceId: "private-proof",
          digest,
          verification: "LIVE_PROOF_REQUIRED",
        },
      ],
      lastSuccessfulAcceptance: {
        stage: "LOCAL_GATE_1",
        evidenceId: "exact-runtime-tests",
        acceptedAt: at,
      },
    });

    expect(privateStaging.gateStatus).toBe("BLOCKED");
    expect(privateStaging.launchState.lastSuccessfulAcceptance).toEqual({
      stage: "LOCAL_GATE_1",
      evidenceId: "exact-runtime-tests",
      acceptedAt: at,
    });
  });
});
