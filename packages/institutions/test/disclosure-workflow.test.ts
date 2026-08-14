import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
} from "@abl/recognition";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  DISCLOSURE_AGGREGATE_TYPE,
  DISCLOSURE_INSPECTED_EVENT_TYPE,
  DISCLOSURE_INSPECTION_FORMAT,
  DISCLOSURE_RELEASED_EVENT_TYPE,
  DISCLOSURE_SUBMITTED_EVENT_TYPE,
  DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
  applyDisclosureWorkflowTransition,
  assertDisclosureAuthorityConfiguration,
  createCompetitionReleaseEvidenceReader,
  disclosureWorkflowStateRoot,
  requireCompetitionReleaseEvidence,
  validateCanonicalDisclosureEnvelope,
  type CompetitionReleaseEvidence,
  type DisclosureEnvelope,
  type DisclosureReleasePayload,
  type DisclosureSubmissionProof,
  type DisclosureWorkflowSnapshot,
} from "../src/index.js";

const day = 24 * 60 * 60 * 1_000;
const start = Date.parse("2026-08-13T10:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (character: string) => `0x${character.repeat(64)}` as Hex;
const uuid = (suffix: string) =>
  `0198e000-0000-7000-8000-${suffix.padStart(12, "0")}`;
const authorDid = "did:abl:player-disclosure";
const author = createSigningIdentity(`0x${"8".repeat(64)}`);
const releaser = createSigningIdentity(`0x${"9".repeat(64)}`);
const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};

function envelope(
  classification: DisclosureEnvelope["classification"],
  suffix: string,
): DisclosureEnvelope {
  const envelopeId = uuid(suffix);
  return {
    envelopeId,
    authorDid,
    classification,
    contentCommitment: digest("1"),
    ciphertextCommitment: classification === "PUBLIC_NOW" ? null : digest("2"),
    declaredReleaseAt:
      classification === "SEALED_30D" || classification === "COMPETITIVE_SEALED"
        ? iso(30 * day)
        : null,
    competitionCondition:
      classification === "COMPETITIVE_SEALED"
        ? {
            competitionId: "season-zero",
            stage: "regular-season",
            releaseCondition: "FINAL_SCHEDULED_MEETING",
          }
        : null,
    caseId: classification === "CASE_RESTRICTED" ? uuid("91") : null,
    integrityAccessRuleDigest:
      classification === "INTEGRITY_ESCROW" ? digest("3") : null,
    submittedAt: iso(0),
    releasedAt: classification === "PUBLIC_NOW" ? iso(0) : null,
  };
}

function materialize(input: {
  eventId: string;
  actorDid: string;
  aggregateId: string;
  aggregateVersion: bigint;
  eventType: string;
  previousEventHash: Hex | null;
  payload: unknown;
  timestamp: string;
  current: DisclosureWorkflowSnapshot | null;
}): { event: CanonicalEvent; next: DisclosureWorkflowSnapshot } {
  const seed = {
    ...input,
    eventHash: digest("f"),
  };
  const next = applyDisclosureWorkflowTransition(
    input.current,
    seed,
    input.payload,
  );
  const event = createCanonicalEvent({
    eventId: input.eventId,
    actorDid: input.actorDid,
    nonce: `disclosure-${input.eventId}`,
    idempotencyKey: uuid(`${Number(input.aggregateVersion) + 100}`),
    aggregateType: DISCLOSURE_AGGREGATE_TYPE,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: disclosureWorkflowStateRoot(next),
    schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  });
  return {
    event,
    next: applyDisclosureWorkflowTransition(
      input.current,
      event,
      input.payload,
    ),
  };
}

async function submission(value: DisclosureEnvelope) {
  const submitted = materialize({
    eventId: uuid("1"),
    actorDid: value.authorDid,
    aggregateId: value.envelopeId,
    aggregateVersion: 1n,
    eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
    previousEventHash: null,
    payload: { envelope: value },
    timestamp: value.submittedAt!,
    current: null,
  });
  const proof = {
    event: {
      ...submitted.event,
      aggregateType: DISCLOSURE_AGGREGATE_TYPE,
      aggregateVersion: "1",
      eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload: { envelope: value },
      schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
    },
    signature: await signCanonicalEvent(author, domain, submitted.event),
  } satisfies DisclosureSubmissionProof;
  return {
    ...submitted,
    proof,
  };
}

describe("canonical disclosure workflow", () => {
  it("requires every configured disclosure role to have aggregate scope", () => {
    const admitted = new Map([
      [authorDid, { allowedAggregateTypes: [DISCLOSURE_AGGREGATE_TYPE] }],
    ]);
    expect(() =>
      assertDisclosureAuthorityConfiguration(admitted, {
        releaseAuthorityDids: new Set([authorDid]),
        competitiveAuthorDids: new Set([authorDid]),
      }),
    ).not.toThrow();
    expect(() =>
      assertDisclosureAuthorityConfiguration(admitted, {
        releaseAuthorityDids: new Set(["did:abl:unscoped"]),
        competitiveAuthorDids: new Set(),
      }),
    ).toThrow(/disclosure authority/);
  });

  it("publishes intentional public commitments and rejects raw or personal submissions", () => {
    const publicEnvelope = envelope("PUBLIC_NOW", "1");
    expect(validateCanonicalDisclosureEnvelope(publicEnvelope)).toEqual(
      publicEnvelope,
    );
    expect(() =>
      validateCanonicalDisclosureEnvelope({
        ...publicEnvelope,
        rawContent: "hidden operator prompt",
      }),
    ).toThrow();
    expect(() =>
      validateCanonicalDisclosureEnvelope(
        envelope("PERSONAL_UNSUBMITTED", "2"),
      ),
    ).toThrow(/cannot enter league communication/);
  });

  it("never releases sealed material before its declared time", async () => {
    const submitted = await submission(envelope("SEALED_30D", "3"));
    expect(() =>
      materialize({
        eventId: uuid("35"),
        actorDid: authorDid,
        aggregateId: submitted.next.envelopeId,
        aggregateVersion: 2n,
        eventType: DISCLOSURE_INSPECTED_EVENT_TYPE,
        previousEventHash: submitted.event.eventHash,
        payload: {
          envelopeId: submitted.next.envelopeId,
          requestedByDid: authorDid,
          requestedAt: iso(day),
          format: DISCLOSURE_INSPECTION_FORMAT,
        },
        timestamp: iso(day),
        current: submitted.next,
      }),
    ).toThrow(/after release/);
    const payload: DisclosureReleasePayload = {
      envelopeId: submitted.next.envelopeId,
      releasedAt: iso(30 * day),
      submissionProof: submitted.proof,
      competitionEvidence: null,
    };
    expect(() =>
      materialize({
        eventId: uuid("4"),
        actorDid: "did:abl:disclosure-office",
        aggregateId: submitted.next.envelopeId,
        aggregateVersion: 2n,
        eventType: DISCLOSURE_RELEASED_EVENT_TYPE,
        previousEventHash: submitted.event.eventHash,
        payload: { ...payload, releasedAt: iso(30 * day - 1) },
        timestamp: iso(30 * day - 1),
        current: submitted.next,
      }),
    ).toThrow(/early/);
    expect(() =>
      materialize({
        eventId: uuid("45"),
        actorDid: "did:abl:disclosure-office",
        aggregateId: submitted.next.envelopeId,
        aggregateVersion: 2n,
        eventType: DISCLOSURE_RELEASED_EVENT_TYPE,
        previousEventHash: submitted.event.eventHash,
        payload: {
          ...payload,
          releasedAt: iso(30 * day + 1),
        },
        timestamp: iso(30 * day + 1),
        current: submitted.next,
      }),
    ).toThrow(/exact declared time/);
    const released = materialize({
      eventId: uuid("5"),
      actorDid: "did:abl:disclosure-office",
      aggregateId: submitted.next.envelopeId,
      aggregateVersion: 2n,
      eventType: DISCLOSURE_RELEASED_EVENT_TYPE,
      previousEventHash: submitted.event.eventHash,
      payload,
      timestamp: payload.releasedAt,
      current: submitted.next,
    });
    expect(released.next.envelope.releasedAt).toBe(iso(30 * day));
    expect(disclosureWorkflowStateRoot(released.next)).toBe(
      released.event.stateRoot,
    );
    expect(await signCanonicalEvent(releaser, domain, released.event)).toMatch(
      /^0x[0-9a-f]{130}$/,
    );
  });

  it("requires exact independently registered competition evidence", async () => {
    const submitted = await submission(envelope("COMPETITIVE_SEALED", "6"));
    const evidence: CompetitionReleaseEvidence = {
      competitionId: "season-zero",
      stage: "regular-season",
      releaseCondition: "FINAL_SCHEDULED_MEETING",
      achievedAt: iso(29 * day),
      evidenceCommitment: digest("4"),
    };
    const payload: DisclosureReleasePayload = {
      envelopeId: submitted.next.envelopeId,
      releasedAt: iso(30 * day),
      submissionProof: submitted.proof,
      competitionEvidence: evidence,
    };
    await expect(
      requireCompetitionReleaseEvidence(payload, {
        competitionReleaseEvidence: async () => ({
          ...evidence,
          evidenceCommitment: digest("5"),
        }),
      }),
    ).rejects.toThrow(/independently registered/);
    await expect(
      requireCompetitionReleaseEvidence(payload, {
        competitionReleaseEvidence: async () => evidence,
      }),
    ).resolves.toEqual(evidence);
    expect(() =>
      createCompetitionReleaseEvidenceReader([evidence, evidence]),
    ).toThrow(/conditions must be unique/);
    await expect(
      createCompetitionReleaseEvidenceReader([
        evidence,
      ]).competitionReleaseEvidence(
        submitted.next.envelope.competitionCondition!,
      ),
    ).resolves.toEqual(evidence);
    expect(sha256Commitment(evidence)).not.toBe(digest("0"));
  });

  it("rejects unbounded or empty competitive condition identifiers", () => {
    const competitive = envelope("COMPETITIVE_SEALED", "7");
    expect(() =>
      validateCanonicalDisclosureEnvelope({
        ...competitive,
        competitionCondition: {
          ...competitive.competitionCondition!,
          stage: "",
        },
      }),
    ).toThrow(/fixed competition condition/);
  });
});
