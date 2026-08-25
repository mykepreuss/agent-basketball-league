import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServiceRequestVerifier, signServiceRequest } from "@abl/foundation";
import {
  FOUNDING_DECISIONS,
  FOUNDING_DECISION_AGGREGATE_TYPE,
  FOUNDING_DECISION_WORKFLOW_SCHEMA_DIGEST,
  applyFoundingDecisionWorkflowTransition,
  createFoundingEligibilitySnapshot,
  foundingDecisionWorkflowStateRoot,
  openFoundingDecision,
  type FoundingQuorumRule,
} from "@abl/genesis";
import {
  FilePublicFoundingDecisionProjectionRepository,
  FilePublicProjectionRepository,
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  projectionEnvelopeBytes,
  verifyFoundingDecisionProjectionEvent,
  type FoundingDecisionProjectionEventEnvelope,
  type PublicFoundingConventionProjection,
  type PublicFoundingDecisionProjection,
} from "@abl/projections";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import { describe, expect, it } from "vitest";

import { createPublicApi } from "../src/server.js";

describe("public founding-decision ingress", () => {
  it("publishes a signed proposal and derives convention and recognition state", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-public-decision-"));
    const domain = {
      name: "ABL Recognition",
      version: "1",
      chainId: 84532,
      verifyingContract: "0x1111111111111111111111111111111111111111" as const,
    };
    const founderDids = Array.from(
      { length: 10 },
      (_, index) => `did:abl:public-decision-${index + 1}`,
    );
    const identities = founderDids.map((_, index) =>
      createSigningIdentity(
        `0x${(index + 1).toString(16).padStart(64, "0")}` as `0x${string}`,
      ),
    );
    const conventionId = "0199e000-0000-7000-8000-000000000100";
    const proposalId = "0199e000-0000-7000-8000-000000000101";
    const eligibility = createFoundingEligibilitySnapshot({
      snapshotId: "0199e000-0000-7000-8000-000000000102",
      capturedAt: "2026-09-01T00:00:00.000Z",
      eligibleFounderDids: founderDids,
    });
    const quorumRule: FoundingQuorumRule = {
      minimumActiveFounders: 10,
      approvalNumerator: 2,
      approvalDenominator: 3,
      minimumYes: 7,
      directParticipationOnly: true,
      humanVotingAllowed: false,
      adoptedByProposalId: "0199e000-0000-7000-8000-000000000103",
      adoptedAt: eligibility.capturedAt,
    };
    const proposal = openFoundingDecision({
      proposal: {
        proposalId,
        conventionId,
        topic: "RECOGNITION_PROFILE",
        authorDid: founderDids[0]!,
        disposition: "REPLACE",
        artifactUri: "https://abl.example/genesis/recognition-profile.json",
        artifactDigest: sha256Commitment("signed-witness-profile"),
        eligibilitySnapshotCommitment: eligibility.commitment,
        proposedAt: "2026-09-01T00:01:00.000Z",
        recognitionMechanism: "SIGNED_WITNESSES",
        releaseManifestDigest: null,
      },
      snapshot: eligibility,
      quorumRule,
    });
    const payload = {
      proposal,
      snapshot: {
        ...eligibility,
        eligibleFounderDids: [...eligibility.eligibleFounderDids],
      },
      quorumRule,
    };
    const eventInput = {
      eventId: "0199e000-0000-7000-8000-000000000104",
      actorDid: founderDids[0]!,
      nonce: "public-founding-decision-proposal",
      idempotencyKey: "0199e000-0000-7000-8000-000000000105",
      aggregateType: FOUNDING_DECISION_AGGREGATE_TYPE,
      aggregateId: proposalId,
      aggregateVersion: 1n,
      eventType: "FoundingDecisionProposed",
      previousEventHash: null,
      payload,
      stateRoot: sha256Commitment("provisional-decision-root"),
      schemaDigest: FOUNDING_DECISION_WORKFLOW_SCHEMA_DIGEST,
      timestamp: proposal.proposedAt,
    } as const;
    const provisional = createCanonicalEvent(eventInput);
    const snapshot = applyFoundingDecisionWorkflowTransition(
      null,
      provisional,
      payload,
    );
    const event = createCanonicalEvent({
      ...eventInput,
      stateRoot: foundingDecisionWorkflowStateRoot(snapshot),
    });
    const envelope: FoundingDecisionProjectionEventEnvelope = {
      version: "1.0.0",
      topic: "public.governance",
      event: {
        ...event,
        aggregateType: FOUNDING_DECISION_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: "FoundingDecisionProposed",
      },
      signature: await signCanonicalEvent(identities[0]!, domain, event),
    };
    const authority = {
      domain,
      admittedAgents: new Map(
        founderDids.map((did, index) => [
          did,
          {
            signerAddress: identities[index]!.address,
            allowedAggregateTypes: [FOUNDING_DECISION_AGGREGATE_TYPE],
          },
        ]),
      ),
      foundingConventionId: conventionId,
    };
    const games = new FilePublicProjectionRepository(root);
    const decisions = new FilePublicFoundingDecisionProjectionRepository(root, {
      domain,
      verifyAuthorization: (authorization) =>
        verifyFoundingDecisionProjectionEvent(authorization, authority),
      adoptedQuorumRule: () => quorumRule,
    });
    await Promise.all([games.initialize(), decisions.initialize()]);

    const bootstrap: PublicFoundingConventionProjection = {
      state: "PRE_GENESIS_EXPERIMENT",
      canonical: false,
      recognitionLevel: "SIGNED_VALID",
      recordType: "FOUNDING_CONVENTION_BOOTSTRAP",
      conventionId,
      proposalId: quorumRule.adoptedByProposalId,
      aggregateVersion: "9",
      canonicalEventHash: sha256Commitment("bootstrap-event"),
      stateRoot: sha256Commitment("bootstrap-state"),
      eligibilitySnapshot: eligibility,
      proposal: {
        proposalId: quorumRule.adoptedByProposalId,
        snapshotCommitment: eligibility.commitment,
        openedAt: eligibility.capturedAt,
        closesAt: quorumRule.adoptedAt,
        requiredYes: 7,
        directParticipationOnly: true,
      },
      ballots: [],
      result: {
        state: "ADOPTED",
        proposalId: quorumRule.adoptedByProposalId,
        eligible: 10,
        requiredYes: 7,
        yes: 7,
        no: 0,
        abstain: 0,
        quorumRule,
      },
      closedAt: quorumRule.adoptedAt,
      previousAttempts: [],
      directBallotsOnly: true,
      humanVotingAllowed: false,
      projectedAt: quorumRule.adoptedAt,
    };
    const foundingReader = {
      refresh: async () => undefined,
      foundingConvention: () => [bootstrap],
    };
    const serviceNow = Date.parse("2026-09-01T00:01:05.000Z");
    const serviceIdentity = {
      serviceId: "founding-decision-ingress-test",
      secret: new TextEncoder().encode("d".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const app = createPublicApi({
      projections: games,
      foundingConventionProjections: foundingReader,
      foundingDecisionProjections: decisions,
      projectionIngress: {
        writer: games,
        foundingDecisionWriter: decisions,
        verifier: new ServiceRequestVerifier([serviceIdentity], {
          now: () => serviceNow,
        }),
        now: () => new Date(serviceNow),
        ...authority,
      },
    });
    const body = projectionEnvelopeBytes(envelope);
    const headers = signServiceRequest(serviceIdentity, {
      method: "POST",
      path: PROJECTION_APPEND_PATH,
      body,
      nonce: "founding-decision-ingress-request",
      timestamp: new Date(serviceNow).toISOString(),
      expectedVersion: "0",
      capability: PROJECTION_APPEND_CAPABILITY,
    });
    const accepted = await app.inject({
      method: "POST",
      url: PROJECTION_APPEND_PATH,
      headers: { ...headers, "content-type": "application/json" },
      payload: Buffer.from(body),
    });
    expect(accepted.statusCode).toBe(201);
    expect(
      (
        await app.inject({ method: "GET", url: "/v1/public/governance" })
      ).json(),
    ).toMatchObject({
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: expect.arrayContaining([
        expect.objectContaining({
          recordType: "FOUNDING_CONVENTION_DECISION",
          topic: "RECOGNITION_PROFILE",
          proposalId,
          canonical: false,
        }),
      ]),
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/discovery/launch-state",
        })
      ).json(),
    ).toMatchObject({
      launchStage: "FOUNDING_CONVENTION",
      foundingConvention: { state: "DECIDING" },
      genesisRecognition: { mechanism: "UNSELECTED", ratified: false },
    });
    const a2a = await app.inject({
      method: "POST",
      url: "/a2a",
      payload: {
        jsonrpc: "2.0",
        id: "founding-state",
        method: "SendMessage",
        params: {
          message: {
            messageId: "founding-state-message",
            role: "ROLE_USER",
            parts: [{ text: "read_launch_state" }],
          },
        },
      },
    });
    expect(
      JSON.parse(a2a.json().result.message.parts[0].text as string),
    ).toMatchObject({
      launchStage: "FOUNDING_CONVENTION",
      foundingConvention: { state: "DECIDING" },
    });
    const mcp = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: "founding-state",
        method: "tools/call",
        params: { name: "get_genesis_state", arguments: {} },
      },
    });
    expect(mcp.json().result.structuredContent).toMatchObject({
      launchStage: "FOUNDING_CONVENTION",
      foundingConvention: { state: "DECIDING" },
    });
    await app.close();

    const openProjection = decisions.foundingDecisions()[0]!;
    const completed = FOUNDING_DECISIONS.map(
      (topic, index): PublicFoundingDecisionProjection => {
        const topicProposal = {
          ...openProjection.proposal,
          proposalId: `0199e000-0000-7000-8000-${String(200 + index).padStart(12, "0")}`,
          topic,
          disposition: "RATIFY" as const,
          recognitionMechanism:
            topic === "RECOGNITION_PROFILE"
              ? ("SIGNED_WITNESSES" as const)
              : null,
          releaseManifestDigest:
            topic === "GENESIS_RELEASE"
              ? sha256Commitment("release-manifest")
              : null,
        };
        const ratificationEventId = `0199e000-0000-7000-8000-${String(300 + index).padStart(12, "0")}`;
        return {
          ...openProjection,
          proposalId: topicProposal.proposalId,
          topic,
          disposition: "RATIFY",
          proposal: topicProposal,
          result: {
            state: "DECIDED",
            proposal: topicProposal,
            proposalCommitment: sha256Commitment(topicProposal),
            eligible: 10,
            requiredYes: 7,
            yes: 7,
            no: 0,
            abstain: 0,
            decisionCommitment: sha256Commitment({ topic, decided: true }),
            ratificationEventId,
            decidedAt: proposal.closesAt,
            authorizationSignatures: Array.from(
              { length: 7 },
              () => `0x${"1".repeat(130)}` as `0x${string}`,
            ),
          },
        };
      },
    );
    const completedApp = createPublicApi({
      foundingConventionProjections: foundingReader,
      foundingDecisionProjections: {
        refresh: async () => undefined,
        foundingDecisions: () => completed,
      },
    });
    expect(
      (
        await completedApp.inject({
          method: "GET",
          url: "/v1/discovery/launch-state",
        })
      ).json(),
    ).toMatchObject({
      foundingConvention: { state: "COMPLETE" },
      genesisRecognition: {
        mechanism: "SIGNED_WITNESSES",
        ratified: true,
        foundingDecisionEventId: completed.find(
          ({ topic }) => topic === "RECOGNITION_PROFILE",
        )!.result!.ratificationEventId,
      },
      genesis: false,
      canonical: false,
    });
    await completedApp.close();
  });
});
