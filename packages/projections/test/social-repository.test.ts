import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
import {
  DISCLOSURE_AGGREGATE_TYPE,
  DISCLOSURE_RELEASED_EVENT_TYPE,
  DISCLOSURE_SUBMITTED_EVENT_TYPE,
  DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
  applyDisclosureWorkflowTransition,
  disclosureWorkflowStateRoot,
  type CompetitionReleaseEvidence,
  type DisclosureEnvelope,
  type DisclosureReleasePayload,
  type DisclosureSubmissionProof,
  type DisclosureWorkflowSnapshot,
} from "@abl/institutions";
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
  FilePublicProjectionRepository,
  FilePublicSocialProjectionRepository,
  ProjectionAuthorizationError,
  ProjectionValidationError,
  PublicProjectionWorker,
  verifySocialProjectionEvent,
  type SocialProjectionEventEnvelope,
  type SocialProjectionRecord,
  type SocialProjectionVerificationAuthority,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const day = 24 * 60 * 60 * 1_000;
const start = Date.parse("2026-08-13T10:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (character: string) => `0x${character.repeat(64)}` as Hex;
const uuid = (suffix: string) =>
  `0198f000-0000-7000-8000-${suffix.padStart(12, "0")}`;
const authorDid = "did:abl:social-author";
const releaseDid = "did:abl:disclosure-office";
const author = createSigningIdentity(`0x${"8".repeat(64)}`);
const releaser = createSigningIdentity(`0x${"9".repeat(64)}`);
const rogue = createSigningIdentity(`0x${"a".repeat(64)}`);

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
    caseId: null,
    integrityAccessRuleDigest: null,
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
}): { event: CanonicalEvent; snapshot: DisclosureWorkflowSnapshot } {
  const { current, ...eventInput } = input;
  const provisional = createCanonicalEvent({
    ...eventInput,
    nonce: `social-${input.eventId}`,
    idempotencyKey: uuid(`${100 + Number(input.aggregateVersion)}`),
    aggregateType: DISCLOSURE_AGGREGATE_TYPE,
    stateRoot: digest("f"),
    schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
  });
  const snapshot = applyDisclosureWorkflowTransition(
    current,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    nonce: `social-${input.eventId}`,
    idempotencyKey: uuid(`${100 + Number(input.aggregateVersion)}`),
    aggregateType: DISCLOSURE_AGGREGATE_TYPE,
    stateRoot: disclosureWorkflowStateRoot(snapshot),
    schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
  });
  return {
    event,
    snapshot: applyDisclosureWorkflowTransition(current, event, input.payload),
  };
}

async function submission(
  classification: DisclosureEnvelope["classification"],
  suffix: string,
) {
  const value = envelope(classification, suffix);
  const submitted = materialize({
    eventId: uuid(`${suffix}1`),
    actorDid: authorDid,
    aggregateId: value.envelopeId,
    aggregateVersion: 1n,
    eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
    previousEventHash: null,
    payload: { envelope: value },
    timestamp: value.submittedAt!,
    current: null,
  });
  const signature = await signCanonicalEvent(author, domain, submitted.event);
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
    signature,
  } satisfies DisclosureSubmissionProof;
  const projection = {
    version: "1.0.0",
    topic: "public.social",
    event: proof.event,
    signature,
  } satisfies SocialProjectionEventEnvelope;
  return { ...submitted, proof, projection };
}

async function release(
  submitted: Awaited<ReturnType<typeof submission>>,
  evidence: CompetitionReleaseEvidence | null = null,
  signer = releaser,
) {
  const payload: DisclosureReleasePayload = {
    envelopeId: submitted.snapshot.envelopeId,
    releasedAt: iso(30 * day),
    submissionProof: submitted.proof,
    competitionEvidence: evidence,
  };
  const released = materialize({
    eventId: uuid("91"),
    actorDid: releaseDid,
    aggregateId: submitted.snapshot.envelopeId,
    aggregateVersion: 2n,
    eventType: DISCLOSURE_RELEASED_EVENT_TYPE,
    previousEventHash: submitted.event.eventHash,
    payload,
    timestamp: payload.releasedAt,
    current: submitted.snapshot,
  });
  return {
    ...released,
    projection: {
      version: "1.0.0",
      topic: "public.social",
      event: {
        ...released.event,
        aggregateType: DISCLOSURE_AGGREGATE_TYPE,
        aggregateVersion: "2",
        eventType: DISCLOSURE_RELEASED_EVENT_TYPE,
        schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
      },
      signature: await signCanonicalEvent(signer, domain, released.event),
    } satisfies SocialProjectionEventEnvelope,
  };
}

function authority(
  evidence: CompetitionReleaseEvidence | null = null,
): SocialProjectionVerificationAuthority {
  return {
    domain,
    admittedAgents: new Map([
      [
        authorDid,
        {
          signerAddress: author.address,
          allowedAggregateTypes: [DISCLOSURE_AGGREGATE_TYPE],
        },
      ],
      [
        releaseDid,
        {
          signerAddress: releaser.address,
          allowedAggregateTypes: [DISCLOSURE_AGGREGATE_TYPE],
        },
      ],
    ]),
    releaseAuthorityDids: new Set([releaseDid]),
    competitiveAuthorDids: new Set([authorDid]),
    competitionReleaseEvidence: async () => evidence,
  };
}

function repository(root: string) {
  const verificationAuthority = authority();
  return new FilePublicSocialProjectionRepository(root, {
    verifyAuthorization: (authorization) =>
      verifySocialProjectionEvent(authorization, verificationAuthority),
    now: () => new Date(iso(30 * day)),
  });
}

async function append(
  store: InMemoryCanonicalStore,
  event: CanonicalEvent,
  signature: string,
  outboxTopic: string,
): Promise<void> {
  await store.append({
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({ eventHash: event.eventHash, signature }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: event.aggregateVersion - 1n,
    competitionId: "season-zero",
    seasonId: "pre-genesis",
    eventType: event.eventType,
    previousEventHash: event.previousEventHash,
    eventHash: event.eventHash,
    payloadSchemaDigest: event.schemaDigest,
    payloadCommitment: event.payloadCommitment,
    payload: event.payload,
    stateRoot: event.stateRoot,
    signatures: [signature],
    occurredAt: new Date(event.timestamp),
    outboxTopic,
  });
}

describe("public social projection repository", () => {
  it("accepts only intentional public metadata and configured signed releases", async () => {
    const publicNow = await submission("PUBLIC_NOW", "1");
    await expect(
      verifySocialProjectionEvent(publicNow.projection, authority()),
    ).resolves.toMatchObject({ expectedVersion: "0", priorSnapshot: null });
    await expect(
      verifySocialProjectionEvent(
        {
          ...publicNow.projection,
          event: {
            ...publicNow.projection.event,
            eventId: "0198f000-0000-4000-8000-000000000001",
          },
        },
        authority(),
      ),
    ).rejects.toBeInstanceOf(ProjectionValidationError);

    const privateSubmission = await submission("SEALED_30D", "2");
    await expect(
      verifySocialProjectionEvent(privateSubmission.projection, authority()),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const competitiveSubmission = await submission("COMPETITIVE_SEALED", "5");
    await expect(
      verifySocialProjectionEvent(competitiveSubmission.projection, {
        ...authority(),
        competitiveAuthorDids: new Set(),
      }),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const released = await release(privateSubmission, null, rogue);
    await expect(
      verifySocialProjectionEvent(released.projection, authority()),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
  });

  it("rejects a signed public submission that claims prior history", async () => {
    const submitted = await submission("PUBLIC_NOW", "6");
    const forgedSubmission = createCanonicalEvent({
      ...submitted.event,
      previousEventHash: digest("e"),
    });
    const projection = {
      version: "1.0.0",
      topic: "public.social",
      event: {
        ...forgedSubmission,
        aggregateType: DISCLOSURE_AGGREGATE_TYPE,
        aggregateVersion: "1",
        eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
        schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
      },
      signature: await signCanonicalEvent(author, domain, forgedSubmission),
    } satisfies SocialProjectionEventEnvelope;

    await expect(
      verifySocialProjectionEvent(projection, authority()),
    ).rejects.toBeInstanceOf(ProjectionValidationError);
  });

  it("persists a sealed release from its proof, restores it, and rejects tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-social-projection-"));
    const submitted = await submission("SEALED_30D", "3");
    const released = await release(submitted);
    const first = repository(root);
    await first.initialize();
    const record = await first.publish(released.projection, "1");
    expect(record.projection).toMatchObject({
      recognizedGenesisSocial: false,
      envelopeId: submitted.snapshot.envelopeId,
      aggregateVersion: "2",
      classification: "SEALED_30D",
      visibility: "RELEASED_COMMITMENT",
      rawContentIncluded: false,
      ciphertextIncluded: false,
    });
    expect(first.social()).toHaveLength(1);

    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.social()).toEqual(first.social());

    const path = join(root, "social-records", "000000000000.json");
    const tampered = JSON.parse(
      await readFile(path, "utf8"),
    ) as SocialProjectionRecord;
    tampered.projection.contentCommitment = digest("7");
    const { recordHash: _recordHash, ...withoutHash } = tampered;
    tampered.recordHash = sha256Commitment(withoutHash);
    await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
    await expect(repository(root).initialize()).rejects.toThrow(
      "does not match its authorization",
    );
  });

  it("crosses the canonical outbox without publishing the sealed submission", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-social-worker-"));
    const submitted = await submission("SEALED_30D", "4");
    const released = await release(submitted);
    const store = new InMemoryCanonicalStore();
    await append(
      store,
      submitted.event,
      submitted.proof.signature,
      "disclosure.lifecycle",
    );
    await append(
      store,
      released.event,
      released.projection.signature,
      "public.social",
    );

    const social = repository(root);
    await social.initialize();
    const games = new FilePublicProjectionRepository(root, {
      verifyAuthorization: async () => {
        throw new Error("No game event expected");
      },
    });
    await games.initialize();
    const verificationAuthority = authority();
    const worker = new PublicProjectionWorker({
      store,
      writer: games,
      socialWriter: social,
      domain: verificationAuthority.domain,
      admittedAgents: verificationAuthority.admittedAgents,
      disclosureReleaseAuthorityDids:
        verificationAuthority.releaseAuthorityDids,
      competitiveDisclosureAuthorDids:
        verificationAuthority.competitiveAuthorDids,
      competitionReleaseEvidence:
        verificationAuthority.competitionReleaseEvidence,
    });
    expect(await worker.drain()).toBe(1);
    expect(social.social()).toHaveLength(1);
    expect(
      await store.pendingProjectionEvents(10, "disclosure.lifecycle"),
    ).toHaveLength(1);
    expect(await store.pendingProjectionEvents(10, "public.social")).toEqual(
      [],
    );
  });
});
