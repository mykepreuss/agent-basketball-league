import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServiceRequestVerifier, signServiceRequest } from "@abl/foundation";
import {
  PREMIER_DRAFT_AGGREGATE_TYPE,
  PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
  PREMIER_DRAFT_SCHEMA_DIGEST,
  conductEightRoundDraft,
  premierDraftStateRoot,
  type PremierDraftCompletedPayload,
  type PremierDraftEvidence,
} from "@abl/institutions";
import {
  FilePublicDraftProjectionRepository,
  FilePublicProjectionRepository,
  PROJECTION_APPEND_CAPABILITY,
  PROJECTION_APPEND_PATH,
  projectionEnvelopeBytes,
  verifyDraftProjectionEvent,
  type DraftProjectionEventEnvelope,
} from "@abl/projections";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import { describe, expect, it } from "vitest";

import { createPublicApi } from "../src/server.js";

describe("public premier draft ingress", () => {
  it("authenticates five ordered agent signatures and exposes non-active draft rights", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-public-draft-"));
    const domain = {
      name: "ABL Recognition",
      version: "1",
      chainId: 84532,
      verifyingContract: "0x1111111111111111111111111111111111111111" as const,
    };
    const draftAuthorityDid = "did:abl:public-draft-authority";
    const clubOrder = ["club-a", "club-b", "club-c", "club-d"];
    const governorDids = clubOrder.map(
      (clubId) => `did:abl:public-governor:${clubId}`,
    );
    const draftClubGovernors = Object.fromEntries(
      clubOrder.map((clubId, index) => [clubId, governorDids[index]!] as const),
    );
    const signerKeys = ["1", "2", "3", "4", "5"].map((key) =>
      createSigningIdentity(`0x${key.repeat(64)}`),
    );
    const draftId = "0198f500-0000-7000-8000-000000000001";
    const completedAt = "2026-08-13T13:00:00.000Z";
    const combineId = "public-premier-combine";
    const combineHeadEventHash = sha256Commitment("public-combine-head");
    const playerOrder = Array.from(
      { length: 32 },
      (_, index) =>
        `did:abl:public-player:${String(index + 1).padStart(2, "0")}`,
    );
    const combineResults = [...playerOrder].sort().map((playerDid, index) => ({
      playerDid,
      eventHash: sha256Commitment({ playerDid, kind: "result" }),
      stateRoot: sha256Commitment({ playerDid, kind: "state" }),
      scoreBps: 9_000 - index,
    }));
    const evidenceBody = {
      draftId,
      combineId,
      combineHeadEventHash,
      eligiblePlayerDids: [...playerOrder].sort(),
      combineResults,
    };
    const evidence: PremierDraftEvidence = {
      ...evidenceBody,
      evidenceCommitment: sha256Commitment(evidenceBody),
    };
    const payload: PremierDraftCompletedPayload = {
      draftId,
      combineId,
      combineHeadEventHash,
      clubOrder,
      playerOrder,
      combineResults,
      draftEvidenceCommitment: evidence.evidenceCommitment,
      picks: [...conductEightRoundDraft(clubOrder, playerOrder)],
      completedAt,
    };
    const event = createCanonicalEvent({
      eventId: "0198f500-0000-7000-8000-000000000002",
      actorDid: draftAuthorityDid,
      nonce: "public-draft-ingress",
      idempotencyKey: "0198f500-0000-7000-8000-000000000003",
      aggregateType: PREMIER_DRAFT_AGGREGATE_TYPE,
      aggregateId: draftId,
      aggregateVersion: 1n,
      eventType: PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
      previousEventHash: null,
      payload,
      stateRoot: premierDraftStateRoot(payload),
      schemaDigest: PREMIER_DRAFT_SCHEMA_DIGEST,
      timestamp: completedAt,
    });
    const envelope = {
      version: "1.0.0",
      topic: "public.draft",
      event: {
        ...event,
        aggregateType: PREMIER_DRAFT_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
        previousEventHash: null,
        schemaDigest: PREMIER_DRAFT_SCHEMA_DIGEST,
      },
      signatures: await Promise.all(
        signerKeys.map((signer) => signCanonicalEvent(signer, domain, event)),
      ),
    } satisfies DraftProjectionEventEnvelope;
    const authority = {
      domain,
      admittedAgents: new Map(
        [draftAuthorityDid, ...governorDids].map((did, index) => [
          did,
          {
            signerAddress: signerKeys[index]!.address,
            allowedAggregateTypes: [PREMIER_DRAFT_AGGREGATE_TYPE],
          },
        ]),
      ),
      draftAuthorityDid,
      draftClubGovernors,
      premierDraftEvidence: async (candidateDraftId: string) =>
        candidateDraftId === draftId ? structuredClone(evidence) : null,
    };
    const games = new FilePublicProjectionRepository(root);
    const drafts = new FilePublicDraftProjectionRepository(root, {
      verifyAuthorization: (authorization) =>
        verifyDraftProjectionEvent(authorization, authority),
    });
    await Promise.all([games.initialize(), drafts.initialize()]);
    const serviceNow = Date.parse("2026-08-13T13:00:05.000Z");
    const serviceIdentity = {
      serviceId: "draft-ingress-test",
      secret: new TextEncoder().encode("d".repeat(32)),
      capabilities: new Set([PROJECTION_APPEND_CAPABILITY]),
    };
    const app = createPublicApi({
      projections: games,
      draftProjections: drafts,
      projectionIngress: {
        writer: games,
        draftWriter: drafts,
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
      nonce: "draft-ingress-service-request",
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
      (await app.inject({ method: "GET", url: "/v1/public/drafts" })).json(),
    ).toMatchObject({
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: [
        {
          draftId,
          projectionKind: "PREMIER_DRAFT",
          recognizedGenesisDraft: false,
        },
      ],
    });
    const rosters = (
      await app.inject({ method: "GET", url: "/v1/public/rosters" })
    ).json();
    expect(rosters).toMatchObject({
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      items: clubOrder.map((clubId) => ({
        clubId,
        rosterKind: "DRAFT_SELECTIONS",
        rosterStatus: "DRAFT_SELECTIONS_NOT_ACTIVE",
        selections: Array.from({ length: 8 }, () => ({
          selectionStatus: "DRAFTED_NO_PLAYING_RIGHTS",
          requiresPlayerContractConsent: true,
        })),
      })),
    });
    expect(JSON.stringify(rosters)).not.toContain('"status":"ACTIVE"');
    await app.close();
  });
});
