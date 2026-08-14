import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
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
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  FilePublicDraftProjectionRepository,
  FilePublicProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  verifyDraftProjectionEvent,
  type DraftProjectionEventEnvelope,
  type DraftProjectionRecord,
  type DraftProjectionVerificationAuthority,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const draftAuthorityDid = "did:abl:draft-authority";
const clubOrder = ["club-a", "club-b", "club-c", "club-d"];
const governorDids = clubOrder.map((club) => `did:abl:governor:${club}`);
const draftClubGovernors = Object.fromEntries(
  clubOrder.map((club, index) => [club, governorDids[index]!] as const),
);
const signers = [
  createSigningIdentity(`0x${"1".repeat(64)}`),
  createSigningIdentity(`0x${"2".repeat(64)}`),
  createSigningIdentity(`0x${"3".repeat(64)}`),
  createSigningIdentity(`0x${"4".repeat(64)}`),
  createSigningIdentity(`0x${"5".repeat(64)}`),
];
const rogue = createSigningIdentity(`0x${"6".repeat(64)}`);
const draftId = "0198f300-0000-7000-8000-000000000001";
const completedAt = "2026-08-13T12:00:00.000Z";
const combineId = "premier-combine-rehearsal";
const combineHeadEventHash = sha256Commitment("combine-head");
const playerOrder = Array.from(
  { length: 32 },
  (_, index) => `did:abl:player:${String(index + 1).padStart(2, "0")}`,
);

function uuid(sequence: number): string {
  return `0198f300-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

function draftFixture() {
  const combineResults = [...playerOrder].sort().map((playerDid, index) => ({
    playerDid,
    eventHash: sha256Commitment({ playerDid, kind: "result" }),
    stateRoot: sha256Commitment({ playerDid, kind: "state" }),
    scoreBps: 10_000 - index,
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
  return { payload, evidence };
}

function authority(
  evidence: PremierDraftEvidence | null,
): DraftProjectionVerificationAuthority {
  const dids = [draftAuthorityDid, ...governorDids];
  return {
    domain,
    admittedAgents: new Map(
      dids.map((did, index) => [
        did,
        {
          signerAddress: signers[index]!.address,
          allowedAggregateTypes: [PREMIER_DRAFT_AGGREGATE_TYPE],
        },
      ]),
    ),
    draftAuthorityDid,
    draftClubGovernors,
    premierDraftEvidence: async (candidateDraftId) =>
      candidateDraftId === draftId ? structuredClone(evidence) : null,
  };
}

async function signedDraft() {
  const { payload, evidence } = draftFixture();
  const event = createCanonicalEvent({
    eventId: uuid(2),
    actorDid: draftAuthorityDid,
    nonce: "premier-draft-projection",
    idempotencyKey: uuid(3),
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
  const signatures = await Promise.all(
    signers.map((signer) => signCanonicalEvent(signer, domain, event)),
  );
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
    signatures,
  } satisfies DraftProjectionEventEnvelope;
  return { payload, evidence, event, envelope };
}

function repository(root: string, evidence: PremierDraftEvidence) {
  const verificationAuthority = authority(evidence);
  return new FilePublicDraftProjectionRepository(root, {
    verifyAuthorization: (authorization) =>
      verifyDraftProjectionEvent(authorization, verificationAuthority),
    now: () => new Date("2026-08-13T12:00:05.000Z"),
  });
}

async function append(
  store: InMemoryCanonicalStore,
  event: CanonicalEvent,
  signatures: readonly string[],
): Promise<void> {
  await store.append({
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({ eventHash: event.eventHash, signatures }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: 0n,
    competitionId: "season-zero",
    seasonId: "pre-genesis",
    eventType: event.eventType,
    previousEventHash: event.previousEventHash,
    eventHash: event.eventHash,
    payloadSchemaDigest: event.schemaDigest,
    payloadCommitment: event.payloadCommitment,
    payload: event.payload,
    stateRoot: event.stateRoot,
    signatures,
    occurredAt: new Date(event.timestamp),
    outboxTopic: "public.draft",
  });
}

describe("durable public draft projections", () => {
  it("requires the draft authority, four governors, and exact independent evidence", async () => {
    const draft = await signedDraft();
    await expect(
      verifyDraftProjectionEvent(draft.envelope, authority(draft.evidence)),
    ).resolves.toMatchObject({ expectedVersion: "0", payload: draft.payload });
    await expect(
      verifyDraftProjectionEvent(draft.envelope, authority(null)),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const reordered = structuredClone(draft.envelope);
    [reordered.signatures[1], reordered.signatures[2]] = [
      reordered.signatures[2]!,
      reordered.signatures[1]!,
    ];
    await expect(
      verifyDraftProjectionEvent(reordered, authority(draft.evidence)),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const rogueEnvelope = structuredClone(draft.envelope);
    rogueEnvelope.signatures[0] = await signCanonicalEvent(
      rogue,
      domain,
      draft.event,
    );
    await expect(
      verifyDraftProjectionEvent(rogueEnvelope, authority(draft.evidence)),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
  });

  it("persists draft rights without activating contracts and detects restart tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-draft-projection-"));
    const draft = await signedDraft();
    const first = repository(root, draft.evidence);
    await first.initialize();
    const published = await first.publish(draft.envelope, "0");
    expect((await first.publish(draft.envelope, "99")).cursor).toBe(
      published.cursor,
    );
    expect(first.rosters()).toHaveLength(4);
    expect(first.rosters()).toMatchObject(
      clubOrder.map((clubId) => ({
        clubId,
        rosterKind: "DRAFT_SELECTIONS",
        rosterStatus: "DRAFT_SELECTIONS_NOT_ACTIVE",
        selections: Array.from({ length: 8 }, () => ({
          selectionStatus: "DRAFTED_NO_PLAYING_RIGHTS",
          requiresPlayerContractConsent: true,
        })),
      })),
    );

    const restarted = repository(root, draft.evidence);
    await restarted.initialize();
    expect(restarted.drafts()).toEqual(first.drafts());

    const path = join(root, "draft-records", "000000000000.json");
    const tampered = JSON.parse(
      await readFile(path, "utf8"),
    ) as DraftProjectionRecord;
    tampered.projection.rosters[0]!.selections[0]!.combineScoreBps = 0;
    const { recordHash: _recordHash, ...withoutHash } = tampered;
    tampered.recordHash = sha256Commitment(withoutHash);
    await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(repository(root, draft.evidence).initialize()).rejects.toThrow(
      "chain is corrupt",
    );
  });

  it("crosses the canonical outbox through the independently verified worker", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-draft-worker-"));
    const draft = await signedDraft();
    const store = new InMemoryCanonicalStore();
    await append(store, draft.event, draft.envelope.signatures);
    const drafts = repository(root, draft.evidence);
    await drafts.initialize();
    const possessions = new FilePublicProjectionRepository(root, {
      verifyAuthorization: async () => {
        throw new Error("No possession event expected");
      },
    });
    await possessions.initialize();
    const verificationAuthority = authority(draft.evidence);
    const worker = new PublicProjectionWorker({
      store,
      writer: possessions,
      draftWriter: drafts,
      ...verificationAuthority,
    });
    expect(await worker.drain()).toBe(1);
    expect(drafts.drafts()).toMatchObject([
      { draftId, projectionKind: "PREMIER_DRAFT" },
    ]);
    expect(await store.pendingProjectionEvents(10, "public.draft")).toEqual([]);
  });
});
