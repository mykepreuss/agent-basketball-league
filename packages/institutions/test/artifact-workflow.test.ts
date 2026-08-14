import { createCanonicalEvent, sha256Commitment } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  ARTIFACT_ADMISSION_AGGREGATE_TYPE,
  ARTIFACT_ADMISSION_SCHEMA_DIGEST,
  ARTIFACT_ADMITTED_EVENT_TYPE,
  ARTIFACT_INSPECTED_EVENT_TYPE,
  ARTIFACT_INSPECTION_FORMAT,
  ArtifactAdmissionAuthorizationError,
  ArtifactAdmissionValidationError,
  applyArtifactAdmissionTransition,
  artifactAdmissionExecutableDigest,
  artifactAdmissionStateRoot,
  requireArtifactAdmissionRatification,
  type ArtifactAdmission,
  type ArtifactAdmissionSnapshot,
} from "../src/index.js";

const artifactId = "0198e000-0000-7000-8000-000000000001";
const proposalId = "0198e000-0000-7000-8000-000000000002";
const closeEventId = "0198e000-0000-7000-8000-000000000003";
const actorDid = "did:abl:artifact-curator-1";
const institution = "did:abl:artifact-council";
const admittedAt = "2026-08-13T10:00:00.000Z";

function artifact(
  overrides: Partial<ArtifactAdmission> = {},
): ArtifactAdmission {
  return {
    artifactId,
    initiatedByDid: actorDid,
    approvedByInstitution: institution,
    contentDigest: `0x${"1".repeat(64)}`,
    provenanceLabel: "Public rulebook evidence, human-authored",
    classification: "REFERENCE",
    targetContextClasses: ["RULE_REFERENCE", "PUBLIC_EVIDENCE"],
    authorizationEventIds: [closeEventId],
    admittedAt,
    ...overrides,
  };
}

function admissionEvent(value = artifact()) {
  const payload = { artifact: value, ratificationProposalId: proposalId };
  const provisional = createCanonicalEvent({
    eventId: "0198e000-0000-7000-8000-000000000004",
    actorDid,
    nonce: "artifact-admit-1",
    idempotencyKey: "0198e000-0000-7000-8000-000000000005",
    aggregateType: ARTIFACT_ADMISSION_AGGREGATE_TYPE,
    aggregateId: artifactId,
    aggregateVersion: 1n,
    eventType: ARTIFACT_ADMITTED_EVENT_TYPE,
    previousEventHash: null,
    payload,
    stateRoot: sha256Commitment("provisional"),
    schemaDigest: ARTIFACT_ADMISSION_SCHEMA_DIGEST,
    timestamp: admittedAt,
  });
  const snapshot = applyArtifactAdmissionTransition(null, provisional, payload);
  return { payload, provisional, snapshot };
}

function inspectionEvent(snapshot: ArtifactAdmissionSnapshot) {
  const timestamp = "2026-08-13T10:01:00.000Z";
  const payload = {
    command: {
      artifactId,
      requestedByDid: actorDid,
      targetContextClass: "RULE_REFERENCE" as const,
      requestedAt: timestamp,
      format: ARTIFACT_INSPECTION_FORMAT,
    },
  };
  const provisional = createCanonicalEvent({
    eventId: "0198e000-0000-7000-8000-000000000006",
    actorDid,
    nonce: "artifact-inspect-2",
    idempotencyKey: "0198e000-0000-7000-8000-000000000007",
    aggregateType: ARTIFACT_ADMISSION_AGGREGATE_TYPE,
    aggregateId: artifactId,
    aggregateVersion: 2n,
    eventType: ARTIFACT_INSPECTED_EVENT_TYPE,
    previousEventHash: null,
    payload,
    stateRoot: sha256Commitment("provisional"),
    schemaDigest: ARTIFACT_ADMISSION_SCHEMA_DIGEST,
    timestamp,
  });
  return { payload, provisional, snapshot };
}

describe("artifact admission workflow", () => {
  it("admits commitment-only metadata and proves declared context inspection", () => {
    const admitted = admissionEvent();
    expect(admitted.snapshot).toMatchObject({
      artifactId,
      version: 1,
      inspections: [],
    });
    expect(artifactAdmissionStateRoot(admitted.snapshot)).toMatch(
      /^0x[0-9a-f]{64}$/,
    );

    const inspected = inspectionEvent(admitted.snapshot);
    const next = applyArtifactAdmissionTransition(
      admitted.snapshot,
      inspected.provisional,
      inspected.payload,
    );
    expect(next).toMatchObject({
      version: 2,
      inspections: [
        {
          requestedByDid: actorDid,
          targetContextClass: "RULE_REFERENCE",
        },
      ],
    });

    expect(() =>
      applyArtifactAdmissionTransition(
        admitted.snapshot,
        inspected.provisional,
        {
          command: {
            ...inspected.payload.command,
            targetContextClass: "CBA_REFERENCE",
          },
        },
      ),
    ).toThrow(ArtifactAdmissionValidationError);
    expect(() =>
      admissionEvent({
        ...artifact(),
        targetContextClasses: ["RULE_REFERENCE", "RULE_REFERENCE"],
      }),
    ).toThrow();
    expect(() =>
      applyArtifactAdmissionTransition(null, admitted.provisional, {
        ...admitted.payload,
        artifact: { ...admitted.payload.artifact, rawContent: "prompt" },
      }),
    ).toThrow();
  });

  it("binds authorization to an exact passed AI proposal and institution", async () => {
    const payload = admissionEvent().payload;
    const valid = {
      proposalId,
      proposalClass: "SHARED_ORDINARY",
      proposerDid: actorDid,
      institution,
      executableChangeDigest: artifactAdmissionExecutableDigest(
        payload.artifact,
      ),
      passed: true,
      closeEventId,
      closedAt: "2026-08-13T09:59:00.000Z",
    };
    await expect(
      requireArtifactAdmissionRatification(payload, {
        artifactAdmissionRatification: async () => valid,
      }),
    ).resolves.toEqual(valid);

    expect(
      artifactAdmissionExecutableDigest(
        artifact({
          admittedAt: "2026-08-14T10:00:00.000Z",
          authorizationEventIds: ["0198e000-0000-7000-8000-000000000099"],
        }),
      ),
    ).toBe(valid.executableChangeDigest);

    for (const invalid of [
      { ...valid, proposalClass: "TIER_CBA" },
      { ...valid, proposerDid: "did:abl:other-agent" },
      { ...valid, institution: "did:abl:other-institution" },
      { ...valid, executableChangeDigest: sha256Commitment("substitution") },
      {
        ...valid,
        closeEventId: "0198e000-0000-7000-8000-000000000098",
      },
      { ...valid, passed: false },
      { ...valid, closedAt: "2026-08-13T10:01:00.000Z" },
    ]) {
      await expect(
        requireArtifactAdmissionRatification(payload, {
          artifactAdmissionRatification: async () => invalid,
        }),
      ).rejects.toThrow(ArtifactAdmissionAuthorizationError);
    }
  });
});
