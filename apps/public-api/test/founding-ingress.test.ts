import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServiceRequestVerifier, signServiceRequest } from "@abl/foundation";
import {
  FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
  FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST,
  applyFoundingBootstrapWorkflowTransition,
  createFoundingEligibilitySnapshot,
  foundingBootstrapWorkflowStateRoot,
  openFoundingBootstrap,
  type FoundingBootstrapWorkflowPayload,
} from "@abl/genesis";
import {
  FilePublicFoundingConventionProjectionRepository,
  FilePublicProjectionRepository,
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  projectionEnvelopeBytes,
  verifyFoundingProjectionEvent,
  type FoundingProjectionEventEnvelope,
} from "@abl/projections";
import {
  createCanonicalEvent,
  createSigningIdentity,
  signCanonicalEvent,
} from "@abl/recognition";
import { describe, expect, it } from "vitest";

import { createPublicApi } from "../src/server.js";

describe("public founding-convention ingress", () => {
  it("authenticates an agent-signed opening and exposes it as pre-Genesis", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-public-founding-"));
    const domain = {
      name: "ABL Recognition",
      version: "1",
      chainId: 84532,
      verifyingContract: "0x1111111111111111111111111111111111111111" as const,
    };
    const founderDids = Array.from(
      { length: 10 },
      (_, index) => `did:abl:public-founding-${index + 1}`,
    );
    const identities = founderDids.map((_, index) =>
      createSigningIdentity(
        `0x${(index + 1).toString(16).padStart(64, "0")}` as `0x${string}`,
      ),
    );
    const proposalId = "0198a000-0000-7000-8000-000000000901";
    const eligibility = createFoundingEligibilitySnapshot({
      snapshotId: "0198a000-0000-7000-8000-000000000902",
      capturedAt: "2026-08-13T08:00:00.000Z",
      eligibleFounderDids: founderDids,
    });
    const proposal = openFoundingBootstrap({
      proposalId,
      snapshot: eligibility,
      openedAt: "2026-08-13T08:01:00.000Z",
    });
    const payload: FoundingBootstrapWorkflowPayload = {
      snapshot: {
        ...eligibility,
        eligibleFounderDids: [...eligibility.eligibleFounderDids],
      },
      proposal,
    };
    const input = {
      eventId: "0198a000-0000-7000-8000-000000000903",
      actorDid: founderDids[0]!,
      nonce: "public-founding-opening",
      idempotencyKey: "0198a000-0000-7000-8000-000000000904",
      aggregateType: FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
      aggregateId: proposalId,
      aggregateVersion: 1n,
      eventType: "FoundingBootstrapOpened",
      previousEventHash: null,
      payload,
      stateRoot: `0x${"0".repeat(64)}` as `0x${string}`,
      schemaDigest: FOUNDING_BOOTSTRAP_WORKFLOW_SCHEMA_DIGEST,
      timestamp: proposal.openedAt,
    } as const;
    const provisional = createCanonicalEvent(input);
    const snapshot = applyFoundingBootstrapWorkflowTransition(
      null,
      provisional,
      payload,
    );
    const event = createCanonicalEvent({
      ...input,
      stateRoot: foundingBootstrapWorkflowStateRoot(snapshot),
    });
    const envelope: FoundingProjectionEventEnvelope = {
      version: "1.0.0",
      topic: "public.governance",
      event: {
        ...event,
        aggregateType: FOUNDING_BOOTSTRAP_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: "FoundingBootstrapOpened",
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
            allowedAggregateTypes: [FOUNDING_BOOTSTRAP_AGGREGATE_TYPE],
          },
        ]),
      ),
      foundingBootstrapProposalId: proposalId,
    };
    const games = new FilePublicProjectionRepository(root);
    const founding = new FilePublicFoundingConventionProjectionRepository(
      root,
      {
        domain,
        verifyAuthorization: (authorization) =>
          verifyFoundingProjectionEvent(authorization, authority),
      },
    );
    await Promise.all([games.initialize(), founding.initialize()]);
    const serviceNow = Date.parse("2026-08-13T08:01:05.000Z");
    const serviceIdentity = {
      serviceId: "founding-ingress-test",
      secret: new TextEncoder().encode("f".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const app = createPublicApi({
      projections: games,
      foundingConventionProjections: founding,
      projectionIngress: {
        writer: games,
        foundingWriter: founding,
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
      nonce: "founding-ingress-service-request",
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
        await app.inject({
          method: "GET",
          url: "/v1/public/governance",
        })
      ).json(),
    ).toMatchObject({
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          recordType: "FOUNDING_CONVENTION_BOOTSTRAP",
          proposalId,
          aggregateVersion: "1",
          canonical: false,
          recognitionLevel: "NONE",
          humanVotingAllowed: false,
        },
      ],
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/discovery/launch-state",
        })
      ).json(),
    ).toMatchObject({
      foundingConvention: {
        state: "BOOTSTRAP_OPEN",
        minimumFounders: 10,
        liveFounders: 10,
        eligibilitySnapshotCommitment: eligibility.commitment,
        bootstrap: {
          state: "OPEN",
          closesAt: proposal.closesAt,
          requiredYes: 7,
          yesVotes: 0,
        },
      },
    });
    await app.close();
  });
});
