import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCanonicalStore } from "@abl/database";
import {
  CASE_WORKFLOW_AGGREGATE_TYPE,
  CASE_WORKFLOW_SCHEMA_DIGEST,
  applyCaseWorkflowTransition,
  caseWorkflowStateRoot,
  type CaseWorkflowEventType,
  type CaseWorkflowPayload,
  type CaseWorkflowSnapshot,
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
  FilePublicCaseProjectionRepository,
  ProjectionAuthorizationError,
  PublicProjectionWorker,
  verifyCaseProjectionEvent,
  type CaseProjectionEventEnvelope,
  type CaseProjectionVerificationAuthority,
  type PublicProjectionEnvelope,
} from "../src/index.js";

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const caseId = "0198c000-0000-7000-8000-000000000001";
const complainantDid = "did:abl:case-projection-complainant";
const affectedDid = "did:abl:case-projection-affected";
const representativeDid = "did:abl:case-projection-representative";
const caseTribunalDids = Array.from(
  { length: 5 },
  (_, index) => `did:abl:case-projection-tribunal-${index + 1}`,
);
const caseAppellateDids = Array.from(
  { length: 3 },
  (_, index) => `did:abl:case-projection-appellate-${index + 1}`,
);
const identities = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b"].map(
  (key) => createSigningIdentity(`0x${key.repeat(64)}`),
);
const dids = [
  complainantDid,
  affectedDid,
  representativeDid,
  ...caseTribunalDids,
  ...caseAppellateDids,
];
const identityByDid = new Map(
  dids.map((did, index) => [did, identities[index]!] as const),
);
const authority: CaseProjectionVerificationAuthority = {
  domain,
  admittedAgents: new Map(
    dids.map((did) => [
      did,
      {
        signerAddress: identityByDid.get(did)!.address,
        allowedAggregateTypes: [CASE_WORKFLOW_AGGREGATE_TYPE],
      },
    ]),
  ),
  caseTribunalDids,
  caseAppellateDids,
};

function uuid(sequence: number): string {
  return `0198c000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

async function caseEvent(input: {
  sequence: number;
  actorDid: string;
  signerDids?: readonly string[];
  eventType: CaseWorkflowEventType;
  timestamp: string;
  payload: CaseWorkflowPayload;
  current: CaseWorkflowSnapshot | null;
  previousEventHash: `0x${string}` | null;
  stateRoot?: `0x${string}`;
}): Promise<{
  envelope: CaseProjectionEventEnvelope;
  event: CanonicalEvent;
  next: CaseWorkflowSnapshot;
}> {
  const eventInput = {
    eventId: uuid(input.sequence * 2),
    actorDid: input.actorDid,
    nonce: `case-projection-${input.sequence}`,
    idempotencyKey: uuid(input.sequence * 2 + 1),
    aggregateType: CASE_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: caseId,
    aggregateVersion: BigInt(input.sequence),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: sha256Commitment("provisional-case-state"),
    schemaDigest: CASE_WORKFLOW_SCHEMA_DIGEST,
    timestamp: input.timestamp,
  };
  const provisional = createCanonicalEvent(eventInput);
  const next = applyCaseWorkflowTransition(
    input.current,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: input.stateRoot ?? caseWorkflowStateRoot(next),
  });
  const signerDids = input.signerDids ?? [input.actorDid];
  const signatures = await Promise.all(
    signerDids.map((did) =>
      signCanonicalEvent(identityByDid.get(did)!, domain, event),
    ),
  );
  return {
    event,
    next,
    envelope: {
      version: "1.0.0",
      topic: "public.cases",
      event: {
        ...event,
        aggregateType: CASE_WORKFLOW_AGGREGATE_TYPE,
        aggregateVersion: event.aggregateVersion.toString(),
        eventType: input.eventType,
      },
      signatures,
    },
  };
}

async function history() {
  const protectedEvidenceCommitment = sha256Commitment(
    "case-projection-protected-evidence",
  );
  const filed = await caseEvent({
    sequence: 1,
    actorDid: complainantDid,
    eventType: "CaseFiled",
    timestamp: "2026-08-13T08:00:00.000Z",
    current: null,
    previousEventHash: null,
    payload: {
      command: {
        caseId,
        caseClass: "DISCIPLINE",
        complainantDid,
        affectedAgentDid: affectedDid,
        respondentInstitution: "Projection Club",
        allegationsPublicCommitment: sha256Commitment("public-allegation"),
        protectedEvidenceCommitment,
        requestedReliefCommitment: null,
        filedAt: "2026-08-13T08:00:00.000Z",
      },
    },
  });
  const notice = await caseEvent({
    sequence: 2,
    actorDid: complainantDid,
    eventType: "CaseNoticeServed",
    timestamp: "2026-08-13T08:01:00.000Z",
    current: filed.next,
    previousEventHash: filed.event.eventHash,
    payload: {
      command: {
        caseId,
        affectedAgentDid: affectedDid,
        noticeCommitment: sha256Commitment("notice"),
        servedAt: "2026-08-13T08:01:00.000Z",
        responseDeadline: "2026-08-14T08:01:00.000Z",
      },
    },
  });
  const represented = await caseEvent({
    sequence: 3,
    actorDid: affectedDid,
    signerDids: [affectedDid, representativeDid],
    eventType: "CaseRepresentativeAppointed",
    timestamp: "2026-08-13T08:02:00.000Z",
    current: notice.next,
    previousEventHash: notice.event.eventHash,
    payload: {
      command: {
        caseId,
        affectedAgentDid: affectedDid,
        representativeDid,
        appointmentCommitment: sha256Commitment("appointment"),
        appointedAt: "2026-08-13T08:02:00.000Z",
      },
    },
  });
  const evidence = await caseEvent({
    sequence: 4,
    actorDid: complainantDid,
    signerDids: [complainantDid, affectedDid, representativeDid],
    eventType: "CaseEvidenceAccessGranted",
    timestamp: "2026-08-13T08:03:00.000Z",
    current: represented.next,
    previousEventHash: represented.event.eventHash,
    payload: {
      command: {
        caseId,
        evidenceCommitment: protectedEvidenceCommitment,
        grantedToDids: [affectedDid, representativeDid],
        grantedAt: "2026-08-13T08:03:00.000Z",
      },
    },
  });
  const responded = await caseEvent({
    sequence: 5,
    actorDid: representativeDid,
    eventType: "CaseResponseSubmitted",
    timestamp: "2026-08-13T08:04:00.000Z",
    current: evidence.next,
    previousEventHash: evidence.event.eventHash,
    payload: {
      command: {
        caseId,
        submittedByDid: representativeDid,
        publicResponseCommitment: sha256Commitment("response"),
        protectedResponseCommitment: null,
        submittedAt: "2026-08-13T08:04:00.000Z",
      },
    },
  });
  const panel = caseTribunalDids.slice(0, 3);
  const ruled = await caseEvent({
    sequence: 6,
    actorDid: panel[0]!,
    signerDids: panel,
    eventType: "CaseRulingIssued",
    timestamp: "2026-08-13T09:00:00.000Z",
    current: responded.next,
    previousEventHash: responded.event.eventHash,
    payload: {
      command: {
        rulingId: uuid(20),
        caseId,
        rulingClass: "MERITS",
        participatingTribunalDids: panel as [string, string, string],
        recusedTribunalDids: [caseTribunalDids[3]!],
        disposition: "NO_ADVERSE_ACTION",
        reasonedPublicCommitment: sha256Commitment("reasoned-ruling"),
        protectedEvidenceCommitment: null,
        adverseActionCommitment: null,
        appealDeadline: "2026-08-14T09:00:00.000Z",
        issuedAt: "2026-08-13T09:00:00.000Z",
      },
    },
  });
  return { filed, notice, represented, evidence, responded, ruled };
}

function repository(root: string) {
  return new FilePublicCaseProjectionRepository(root, {
    verifyAuthorization: async (envelope) =>
      verifyCaseProjectionEvent(envelope, authority),
    now: () => new Date("2026-08-13T09:01:00.000Z"),
  });
}

describe("durable public case projections", () => {
  it("replays a threshold-signed reasoned ruling after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-case-projection-"));
    const store = repository(root);
    await store.initialize();
    const events = await history();
    for (const [index, event] of Object.values(events).entries())
      await store.publish(event.envelope, String(index));
    expect(store.cases()).toMatchObject([
      {
        recordType: "DUE_PROCESS_CASE",
        caseId,
        processStatus: "MERITS_RULING",
        aggregateVersion: "6",
        ruling: {
          disposition: "NO_ADVERSE_ACTION",
          participatingTribunalDids: caseTribunalDids.slice(0, 3),
        },
      },
    ]);
    const restarted = repository(root);
    await restarted.initialize();
    expect(restarted.cases()).toEqual(store.cases());
  });

  it("rejects a forged panel and durable projection tampering", async () => {
    const events = await history();
    const forged = structuredClone(events.ruled.envelope);
    forged.signatures[0] = await signCanonicalEvent(
      identityByDid.get(complainantDid)!,
      domain,
      events.ruled.event,
    );
    await expect(
      verifyCaseProjectionEvent(forged, authority),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);
    const missingEvidenceAcknowledgement = structuredClone(
      events.evidence.envelope,
    );
    missingEvidenceAcknowledgement.signatures.pop();
    await expect(
      verifyCaseProjectionEvent(missingEvidenceAcknowledgement, authority),
    ).rejects.toBeInstanceOf(ProjectionAuthorizationError);

    const root = await mkdtemp(join(tmpdir(), "abl-case-tamper-"));
    const store = repository(root);
    await store.initialize();
    await store.publish(events.filed.envelope, "0");
    const recordPath = join(root, "case-records", "000000000000.json");
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      projection: { filing: { respondentInstitution: string } };
    };
    record.projection.filing.respondentInstitution = "Forged institution";
    await writeFile(recordPath, `${JSON.stringify(record)}\n`, "utf8");
    await expect(repository(root).initialize()).rejects.toThrow("corrupt");
  });

  it("drains case events through the fair projection worker", async () => {
    const { filed } = await history();
    const store = new InMemoryCanonicalStore();
    await store.append({
      eventId: filed.event.eventId,
      actorDid: filed.event.actorDid,
      nonce: filed.event.nonce,
      idempotencyKey: filed.event.idempotencyKey,
      requestHash: sha256Commitment("case-worker-request"),
      aggregateType: filed.event.aggregateType,
      aggregateId: filed.event.aggregateId,
      expectedVersion: 0n,
      competitionId: "case-rehearsal",
      seasonId: "pre-genesis",
      eventType: filed.event.eventType,
      previousEventHash: filed.event.previousEventHash,
      eventHash: filed.event.eventHash,
      payloadSchemaDigest: filed.event.schemaDigest,
      payloadCommitment: filed.event.payloadCommitment,
      payload: filed.event.payload,
      stateRoot: filed.event.stateRoot,
      signatures: filed.envelope.signatures,
      occurredAt: new Date(filed.event.timestamp),
      outboxTopic: "public.cases",
    });
    const delivered: PublicProjectionEnvelope[] = [];
    const worker = new PublicProjectionWorker({
      store,
      sink: { publish: async (envelope) => void delivered.push(envelope) },
      now: () => new Date("2026-08-13T09:01:00.000Z"),
      ...authority,
    });
    expect(await worker.drain()).toBe(1);
    expect(delivered).toMatchObject([
      { topic: "public.cases", event: { eventHash: filed.event.eventHash } },
    ]);
  });
});
