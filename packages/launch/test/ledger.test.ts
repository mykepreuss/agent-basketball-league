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
          status: "IMPLEMENTED_LIVE_PROOF_REQUIRED",
          evidenceIds: ["missing"],
        },
      ],
    });
    expect(blocked.gateStatus).toBe("BLOCKED");
    expect(blocked.launchState.genesis).toBe(false);
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
      signatures: [
        {
          signatureId: "founding-release-signature",
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
          purpose: "Bind the local verification result",
          signerDid: "did:abl:release-verifier",
          state: "VERIFIED",
          evidenceId: "exact-runtime-tests",
        },
      ],
    });
    expect(verified.gateStatus).toBe("READY");
  });
});
