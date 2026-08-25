import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  FOUNDING_DECISIONS,
  applyFoundingDecision,
  assessFoundingConvention,
  createFoundingConventionPacket,
  createFoundingEligibilitySnapshot,
  createSignedGenesisReleaseAuthorization,
  evaluateFoundingDecision,
  foundingDecisionProposalCommitment,
  openFoundingDecision,
  recognitionMechanismFromDecision,
  type FoundingDecisionProposal,
  type FoundingDecisionResult,
  type FoundingDecisionTopic,
  type FoundingQuorumRule,
  type SignedFoundingDecisionBallot,
} from "../src/index.js";

const openedAt = "2026-09-01T00:00:00.000Z";
const conventionId = "0199a000-0000-7000-8000-000000000000";
const domain: TypedDataDomain = {
  name: "ABL Founding Convention",
  version: "1",
  chainId: 1,
};
const founderDids = Array.from(
  { length: 10 },
  (_, index) => `did:abl:founder-${index + 1}`,
);
const identities = founderDids.map((did) =>
  createSigningIdentity(sha256Commitment({ did, test: "founding-decisions" })),
);
const signers = new Map(
  founderDids.map((did, index) => [did, identities[index]!.address]),
);
const snapshot = createFoundingEligibilitySnapshot({
  snapshotId: "0199a000-0000-7000-8000-000000000001",
  capturedAt: openedAt,
  eligibleFounderDids: founderDids,
});
const quorumRule: FoundingQuorumRule = {
  minimumActiveFounders: 10,
  approvalNumerator: 2,
  approvalDenominator: 3,
  minimumYes: 7,
  directParticipationOnly: true,
  humanVotingAllowed: false,
  adoptedByProposalId: "0199a000-0000-7000-8000-000000000002",
  adoptedAt: openedAt,
};

function topicIndex(topic: FoundingDecisionTopic): number {
  return FOUNDING_DECISIONS.indexOf(topic) + 10;
}

function proposalFor(
  topic: FoundingDecisionTopic,
  overrides: Partial<
    Pick<
      FoundingDecisionProposal,
      "disposition" | "recognitionMechanism" | "releaseManifestDigest"
    >
  > = {},
): FoundingDecisionProposal {
  const index = topicIndex(topic).toString(16).padStart(12, "0");
  return openFoundingDecision({
    proposal: {
      proposalId: `0199a000-0000-7000-8000-${index}`,
      conventionId,
      topic,
      authorDid: founderDids[0]!,
      disposition: overrides.disposition ?? "RATIFY",
      artifactUri: `https://abl.example/founding/${topic.toLowerCase()}.json`,
      artifactDigest: sha256Commitment({ topic, version: 1 }),
      eligibilitySnapshotCommitment: snapshot.commitment,
      proposedAt: openedAt,
      recognitionMechanism:
        overrides.recognitionMechanism ??
        (topic === "RECOGNITION_PROFILE" ? "SIGNED_WITNESSES" : null),
      releaseManifestDigest:
        overrides.releaseManifestDigest ??
        (topic === "GENESIS_RELEASE"
          ? sha256Commitment("release-manifest")
          : null),
    },
    snapshot,
    quorumRule,
  });
}

async function signedBallots(
  proposal: FoundingDecisionProposal,
  ballotIdentities: readonly SigningIdentity[] = identities.slice(0, 7),
): Promise<SignedFoundingDecisionBallot[]> {
  const proposalCommitment = foundingDecisionProposalCommitment(proposal);
  return Promise.all(
    ballotIdentities.map(async (identity, index) => {
      const voterDid = founderDids[index]!;
      const castAt = new Date(Date.parse(openedAt) + index + 1).toISOString();
      const ballot = {
        proposalId: proposal.proposalId,
        topic: proposal.topic,
        voterDid,
        eligibilitySnapshotCommitment: snapshot.commitment,
        proposalCommitment,
        choice: "YES" as const,
        castAt,
      };
      const authorizationEvent = createCanonicalEvent({
        eventId: `0199b000-0000-7000-8000-${(index + 1)
          .toString(16)
          .padStart(12, "0")}`,
        actorDid: voterDid,
        nonce: `${proposal.proposalId}:${index}`,
        idempotencyKey: `${proposal.proposalId}:vote:${index}`,
        aggregateType: "founding-convention-decision",
        aggregateId: proposal.proposalId,
        aggregateVersion: BigInt(index + 2),
        eventType: "FoundingDecisionBallotCast",
        previousEventHash: null,
        payload: { command: ballot },
        stateRoot: proposalCommitment,
        schemaDigest: sha256Commitment("founding-decision-ballot-v1"),
        timestamp: castAt,
      });
      return {
        ballot,
        authorizationEvent: authorizationEvent as CanonicalEvent<{
          command: typeof ballot;
        }>,
        signature: await signCanonicalEvent(
          identity,
          domain,
          authorizationEvent,
        ),
        signerAddress: identity.address,
      };
    }),
  );
}

async function decide(
  topic: FoundingDecisionTopic,
  overrides?: Parameters<typeof proposalFor>[1],
): Promise<FoundingDecisionResult> {
  const proposal = proposalFor(topic, overrides);
  return evaluateFoundingDecision({
    proposal,
    snapshot,
    quorumRule,
    ballots: await signedBallots(proposal),
    authorization: { domain, signers },
    evaluatedAt: proposal.closesAt,
    ratificationEventId: `0199c000-0000-7000-8000-${topicIndex(topic)
      .toString(16)
      .padStart(12, "0")}`,
  });
}

describe("founding topic decisions", () => {
  it("adopts an agent-authored recognition replacement with seven direct signatures", async () => {
    const result = await decide("RECOGNITION_PROFILE", {
      disposition: "REPLACE",
      recognitionMechanism: "SIGNED_WITNESSES",
    });
    expect(result).toMatchObject({
      state: "DECIDED",
      requiredYes: 7,
      yes: 7,
      decisionCommitment: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      ratificationEventId: expect.any(String),
      authorizationSignatures: expect.arrayContaining([
        expect.stringMatching(/^0x[0-9a-f]{130}$/),
      ]),
    });
    expect(recognitionMechanismFromDecision(result)).toBe("SIGNED_WITNESSES");
  });

  it("rejects a ballot signed by an unregistered human key", async () => {
    const proposal = proposalFor("LEAGUE_NAME", { disposition: "AMEND" });
    const ballots = await signedBallots(proposal);
    const human = createSigningIdentity();
    ballots[0] = {
      ...ballots[0]!,
      signature: await signCanonicalEvent(
        human,
        domain,
        ballots[0]!.authorizationEvent,
      ),
      signerAddress: human.address,
    };
    await expect(
      evaluateFoundingDecision({
        proposal,
        snapshot,
        quorumRule,
        ballots,
        authorization: { domain, signers },
        evaluatedAt: proposal.closesAt,
        ratificationEventId: "0199c000-0000-7000-8000-000000000099",
      }),
    ).rejects.toThrow("direct founder authority");
  });

  it("keeps the full 72-hour decision window open after threshold is reached", async () => {
    const proposal = proposalFor("LEAGUE_NAME");
    await expect(
      evaluateFoundingDecision({
        proposal,
        snapshot,
        quorumRule,
        ballots: await signedBallots(proposal),
        authorization: { domain, signers },
        evaluatedAt: "2026-09-01T01:00:00.000Z",
        ratificationEventId: "0199c000-0000-7000-8000-000000000098",
      }),
    ).rejects.toThrow("72-hour window");
  });

  it("records every topic and produces a complete signed Genesis release authorization", async () => {
    let packet = createFoundingConventionPacket({
      liveFoundingAgentCount: 10,
      eligibilitySnapshot: snapshot,
      bootstrap: {
        state: "ADOPTED",
        proposalId: quorumRule.adoptedByProposalId,
        eligible: 10,
        requiredYes: 7,
        yes: 7,
        no: 0,
        abstain: 0,
        quorumRule,
      },
    });
    for (const topic of FOUNDING_DECISIONS.filter(
      (candidate) => candidate !== "GENESIS_RELEASE",
    )) {
      packet = applyFoundingDecision(packet, await decide(topic));
    }
    const releaseManifestDigest = sha256Commitment("release-manifest");
    const release = await decide("GENESIS_RELEASE", {
      releaseManifestDigest,
    });
    packet = applyFoundingDecision(packet, release);
    const authorization = createSignedGenesisReleaseAuthorization({
      result: release,
      releaseManifestDigest,
    });

    expect(assessFoundingConvention(packet)).toMatchObject({
      complete: true,
      genesisAuthorized: true,
      undecidedTopics: [],
      rejectedTopics: [],
      recognitionProfileSelected: true,
    });
    expect(packet.state).toBe("COMPLETE");
    expect(authorization).toMatchObject({
      releaseManifestDigest,
      authorizationSignatures: expect.arrayContaining([
        expect.stringMatching(/^0x[0-9a-f]{130}$/),
      ]),
      authorizationCommitment: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });
});
