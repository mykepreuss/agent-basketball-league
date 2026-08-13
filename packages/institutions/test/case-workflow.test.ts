import { sha256Commitment } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  applyCaseWorkflowTransition,
  caseParticipants,
  caseWorkflowStateRoot,
  type CaseWorkflowEventType,
  type CaseWorkflowPayload,
  type CaseWorkflowSnapshot,
} from "../src/index.js";

const caseId = "0198b000-0000-7000-8000-000000000001";
const complainantDid = "did:abl:case-complainant";
const affectedDid = "did:abl:case-affected";
const representativeDid = "did:abl:case-representative";
const meritsPanel = [
  "did:abl:tribunal-1",
  "did:abl:tribunal-2",
  "did:abl:tribunal-3",
] as const;
const appealPanel = [
  "did:abl:appeals-1",
  "did:abl:appeals-2",
  "did:abl:appeals-3",
] as const;

function uuid(sequence: number): string {
  return `0198b000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
}

function transition(input: {
  snapshot: CaseWorkflowSnapshot | null;
  eventType: CaseWorkflowEventType;
  actorDid: string;
  timestamp: string;
  payload: CaseWorkflowPayload;
}): CaseWorkflowSnapshot {
  return applyCaseWorkflowTransition(
    input.snapshot,
    {
      actorDid: input.actorDid,
      aggregateId: caseId,
      aggregateVersion: BigInt((input.snapshot?.version ?? 0) + 1),
      eventType: input.eventType,
      timestamp: input.timestamp,
    },
    input.payload,
  );
}

function filed(): CaseWorkflowSnapshot {
  return transition({
    snapshot: null,
    eventType: "CaseFiled",
    actorDid: complainantDid,
    timestamp: "2026-08-13T08:00:00.000Z",
    payload: {
      command: {
        caseId,
        caseClass: "RETALIATION",
        complainantDid,
        affectedAgentDid: affectedDid,
        respondentInstitution: "Premier Club One",
        allegationsPublicCommitment: sha256Commitment("public-allegations"),
        protectedEvidenceCommitment: sha256Commitment("protected-evidence"),
        requestedReliefCommitment: sha256Commitment("requested-relief"),
        filedAt: "2026-08-13T08:00:00.000Z",
      },
    },
  });
}

function throughResponse(): CaseWorkflowSnapshot {
  let snapshot = filed();
  snapshot = transition({
    snapshot,
    eventType: "CaseNoticeServed",
    actorDid: complainantDid,
    timestamp: "2026-08-13T08:01:00.000Z",
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
  snapshot = transition({
    snapshot,
    eventType: "CaseRepresentativeAppointed",
    actorDid: affectedDid,
    timestamp: "2026-08-13T08:02:00.000Z",
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
  snapshot = transition({
    snapshot,
    eventType: "CaseEvidenceAccessGranted",
    actorDid: complainantDid,
    timestamp: "2026-08-13T08:03:00.000Z",
    payload: {
      command: {
        caseId,
        evidenceCommitment: sha256Commitment("protected-evidence"),
        grantedToDids: [affectedDid, representativeDid],
        grantedAt: "2026-08-13T08:03:00.000Z",
      },
    },
  });
  return transition({
    snapshot,
    eventType: "CaseResponseSubmitted",
    actorDid: representativeDid,
    timestamp: "2026-08-13T08:04:00.000Z",
    payload: {
      command: {
        caseId,
        submittedByDid: representativeDid,
        publicResponseCommitment: sha256Commitment("public-response"),
        protectedResponseCommitment: sha256Commitment("protected-response"),
        submittedAt: "2026-08-13T08:04:00.000Z",
      },
    },
  });
}

describe("due-process case workflow", () => {
  it("enforces notice, evidence, representation, response, ruling, and appeal", () => {
    let snapshot = throughResponse();
    snapshot = transition({
      snapshot,
      eventType: "CaseRulingIssued",
      actorDid: meritsPanel[0],
      timestamp: "2026-08-13T09:00:00.000Z",
      payload: {
        command: {
          rulingId: uuid(2),
          caseId,
          rulingClass: "MERITS",
          participatingTribunalDids: [...meritsPanel],
          recusedTribunalDids: ["did:abl:tribunal-4"],
          disposition: "ADVERSE_ACTION",
          reasonedPublicCommitment: sha256Commitment("reasoned-ruling"),
          protectedEvidenceCommitment: sha256Commitment("protected-evidence"),
          adverseActionCommitment: sha256Commitment("proportionate-action"),
          appealDeadline: "2026-08-14T09:00:00.000Z",
          issuedAt: "2026-08-13T09:00:00.000Z",
        },
      },
    });
    snapshot = transition({
      snapshot,
      eventType: "CaseAppealFiled",
      actorDid: affectedDid,
      timestamp: "2026-08-13T10:00:00.000Z",
      payload: {
        command: {
          appealId: uuid(3),
          caseId,
          appellantDid: affectedDid,
          groundsCommitment: sha256Commitment("appeal-grounds"),
          filedAt: "2026-08-13T10:00:00.000Z",
        },
      },
    });
    snapshot = transition({
      snapshot,
      eventType: "CaseAppealRulingIssued",
      actorDid: appealPanel[0],
      timestamp: "2026-08-13T11:00:00.000Z",
      payload: {
        command: {
          rulingId: uuid(4),
          appealId: uuid(3),
          caseId,
          participatingTribunalDids: [...appealPanel],
          recusedTribunalDids: [],
          disposition: "REMAND",
          reasonedPublicCommitment: sha256Commitment("appeal-ruling"),
          issuedAt: "2026-08-13T11:00:00.000Z",
        },
      },
    });
    expect(snapshot.appealRuling?.disposition).toBe("REMAND");
    expect(caseParticipants(snapshot)).toContain(affectedDid);
    expect(caseWorkflowStateRoot(snapshot)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("fails closed on premature/conflicted rulings and honors a completed response opportunity", () => {
    const filing = filed();
    expect(() =>
      transition({
        snapshot: filing,
        eventType: "CaseRulingIssued",
        actorDid: meritsPanel[0],
        timestamp: "2026-08-13T08:01:00.000Z",
        payload: {
          command: {
            rulingId: uuid(5),
            caseId,
            rulingClass: "MERITS",
            participatingTribunalDids: [...meritsPanel],
            recusedTribunalDids: [],
            disposition: "DISMISSED",
            reasonedPublicCommitment: sha256Commitment("premature"),
            protectedEvidenceCommitment: null,
            adverseActionCommitment: null,
            appealDeadline: "2026-08-14T08:01:00.000Z",
            issuedAt: "2026-08-13T08:01:00.000Z",
          },
        },
      }),
    ).toThrow("ruling");

    const responded = throughResponse();
    expect(() =>
      transition({
        snapshot: responded,
        eventType: "CaseRulingIssued",
        actorDid: meritsPanel[0],
        timestamp: "2026-08-13T09:00:00.000Z",
        payload: {
          command: {
            rulingId: uuid(6),
            caseId,
            rulingClass: "MERITS",
            participatingTribunalDids: [...meritsPanel],
            recusedTribunalDids: [],
            disposition: "ADVERSE_ACTION",
            reasonedPublicCommitment: sha256Commitment("substituted-evidence"),
            protectedEvidenceCommitment: sha256Commitment(
              "undisclosed-evidence",
            ),
            adverseActionCommitment: sha256Commitment("adverse-action"),
            appealDeadline: "2026-08-14T09:00:00.000Z",
            issuedAt: "2026-08-13T09:00:00.000Z",
          },
        },
      }),
    ).toThrow("ruling");

    expect(() =>
      transition({
        snapshot: responded,
        eventType: "CaseRulingIssued",
        actorDid: meritsPanel[0],
        timestamp: "2026-08-13T09:00:00.000Z",
        payload: {
          command: {
            rulingId: uuid(7),
            caseId,
            rulingClass: "MERITS",
            participatingTribunalDids: [...meritsPanel],
            recusedTribunalDids: [meritsPanel[0]],
            disposition: "DISMISSED",
            reasonedPublicCommitment: sha256Commitment("conflicted"),
            protectedEvidenceCommitment: null,
            adverseActionCommitment: null,
            appealDeadline: "2026-08-14T09:00:00.000Z",
            issuedAt: "2026-08-13T09:00:00.000Z",
          },
        },
      }),
    ).toThrow("panel");

    const evidenceOnly = throughResponse();
    evidenceOnly.version = 4;
    evidenceOnly.lastTransitionAt = "2026-08-13T08:03:00.000Z";
    evidenceOnly.response = null;
    const afterResponseOpportunity = transition({
      snapshot: evidenceOnly,
      eventType: "CaseRulingIssued",
      actorDid: meritsPanel[0],
      timestamp: "2026-08-14T08:01:00.000Z",
      payload: {
        command: {
          rulingId: uuid(8),
          caseId,
          rulingClass: "MERITS",
          participatingTribunalDids: [...meritsPanel],
          recusedTribunalDids: [],
          disposition: "DISMISSED",
          reasonedPublicCommitment: sha256Commitment("silence-ruling"),
          protectedEvidenceCommitment: null,
          adverseActionCommitment: null,
          appealDeadline: "2026-08-15T08:01:00.000Z",
          issuedAt: "2026-08-14T08:01:00.000Z",
        },
      },
    });
    expect(afterResponseOpportunity.ruling?.disposition).toBe("DISMISSED");
  });
});
