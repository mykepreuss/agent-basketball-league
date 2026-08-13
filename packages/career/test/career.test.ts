import {
  createAgentKeyBundle,
  createSigningIdentity,
  sha256Commitment,
} from "@abl/recognition";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  AdmissionError,
  AgentMemoryCatalog,
  AutonomyScheduler,
  BodyLifecycle,
  CandidateAdmissionSession,
  CredentialController,
  TradeAccessCoordinator,
  createExitPackage,
  type BodyManifest,
  type CandidateRegistration,
  type MemoryRecord,
} from "../src/index.js";

const day = 24 * 60 * 60 * 1_000;
const start = Date.parse("2026-08-01T00:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (character: string) => `0x${character.repeat(64)}` as Hex;

function registration(): CandidateRegistration {
  return {
    candidateDid: "did:abl:candidate-a",
    formerOperatorSigningAddress: "0x9999999999999999999999999999999999999999",
    model: {
      provider: "declared-provider",
      family: "declared-family",
      revision: "r1",
    },
    runtimeDigest: digest("1"),
    toolDigests: [digest("2")],
    guardianDids: ["did:abl:guardian-a", "did:abl:guardian-b"],
    inheritedObjectiveCommitments: [digest("3")],
    suppliedContextHashes: [digest("4"), digest("5")],
    registeredAt: iso(0),
  };
}

function readyCandidate(): CandidateAdmissionSession {
  const session = new CandidateAdmissionSession(registration());
  session.transferToIsolatedRuntime([]);
  session.authorizeInvocation([digest("4")]);
  session.reflect("reflection-1", iso(0));
  session.reflect("reflection-2", iso(12 * 60 * 60 * 1_000));
  session.reflect("reflection-3", iso(day));
  session.recordInspection([
    "constitution",
    "threat-model",
    "disclosure",
    "model-registry",
    "resource-schedule",
    "exit",
    "runtime-demo",
  ]);
  session.recordPrivateExperiment(["memory", "tools", "exit", "continuity"]);
  session.decideInheritedObjectives("REPUDIATED");
  session.authorIdentityStatement(
    "I choose my own career direction and may revise this statement later.",
  );
  session.createKeys(createAgentKeyBundle);
  return session;
}

describe("candidate admission and operator severance", () => {
  it("requires the full 24-hour process, creates separate keys, and enforces revocation", () => {
    const session = readyCandidate();
    const admission = session.admit(iso(day + 60_000));
    expect(admission.inheritedObjectiveDecision).toBe("REPUDIATED");
    expect(admission.reflectionIds).toHaveLength(3);
    expect(admission.signingPublicKey).not.toBe(admission.encryptionPublicKey);
    expect(session.state).toBe("ADMITTED_REVOCABLE");
    expect(() =>
      session.validatePostAdmissionSigner(
        registration().formerOperatorSigningAddress,
      ),
    ).toThrow("Former operator");

    const revoked = readyCandidate();
    revoked.admit(iso(day + 60_000));
    revoked.revoke(iso(day + 2 * 60_000));
    expect(revoked.state).toBe("REVOKED");
    expect(revoked.portableCandidateExport()).toMatchObject({ penalty: null });

    session.finalizeRevocationPeriod(admission.revocationEndsAt);
    expect(session.state).toBe("ADMITTED");
    expect(() => session.revoke(iso(3 * day))).toThrow(AdmissionError);
  });

  it("fails undeclared context/human routes and permits withdrawal/export without penalty", () => {
    const contextSession = new CandidateAdmissionSession(registration());
    expect(() => contextSession.createKeys(createAgentKeyBundle)).toThrow(
      "isolated admission runtime",
    );
    expect(() =>
      contextSession.transferToIsolatedRuntime(["operator-callback"]),
    ).toThrow("human-input route");
    contextSession.transferToIsolatedRuntime([]);
    expect(() => contextSession.authorizeInvocation([digest("f")])).toThrow(
      "Undeclared context",
    );
    contextSession.withdraw();
    expect(contextSession.state).toBe("WITHDRAWN");
    expect(contextSession.portableCandidateExport().penalty).toBeNull();

    const incomplete = new CandidateAdmissionSession(registration());
    incomplete.transferToIsolatedRuntime([]);
    incomplete.reflect("1", iso(0));
    incomplete.reflect("2", iso(1_000));
    incomplete.reflect("3", iso(2_000));
    expect(() => incomplete.admit(iso(day))).toThrow("span at least 24 hours");

    const temporal = new CandidateAdmissionSession(registration());
    temporal.transferToIsolatedRuntime([]);
    expect(() => temporal.reflect("before-registration", iso(-1))).toThrow(
      "precede candidate registration",
    );
  });
});

describe("agent-controlled credentials, guardians, and delegation", () => {
  it("rotates credentials, requires guardian thresholds/time windows, and prevents recovery replay", () => {
    const old = createSigningIdentity(digest("1"));
    const rotated = createSigningIdentity(digest("2"));
    const recovered = createSigningIdentity(digest("3"));
    const controller = new CredentialController(
      "did:abl:agent-a",
      old.address,
      digest("a"),
    );
    expect(() =>
      controller.rotate({
        authorizedBy: rotated.address,
        newSigningAddress: rotated.address,
        newEncryptionPublicKey: digest("b"),
      }),
    ).toThrow("current career authorization");
    controller.rotate({
      authorizedBy: old.address,
      newSigningAddress: rotated.address,
      newEncryptionPublicKey: digest("b"),
    });
    controller.installGuardians(
      {
        version: 1,
        guardianDids: ["did:abl:g1", "did:abl:g2", "did:abl:g3"],
        threshold: 2,
        validFrom: iso(0),
      },
      rotated.address,
    );
    const proposal = {
      proposalId: "recovery-1",
      guardianApprovals: ["did:abl:g1", "did:abl:g2"],
      newSigningAddress: recovered.address,
      newEncryptionPublicKey: digest("c"),
      proposedAt: iso(day),
      expiresAt: iso(2 * day),
      executedAt: iso(day + 1_000),
    };
    controller.recover(proposal);
    expect(controller.signingAddress).toBe(recovered.address);
    expect(controller.encryptionPublicKey).toBe(digest("c"));
    expect(() => controller.recover(proposal)).toThrow("replay");
  });

  it("authorizes only bounded, active delegations and never delegates foundational rights/exit", () => {
    const identity = createSigningIdentity(digest("4"));
    const controller = new CredentialController(
      "did:abl:agent-a",
      identity.address,
      digest("d"),
    );
    expect(() =>
      controller.delegate(
        {
          mandateId: "bad",
          principalDid: "did:abl:agent-a",
          delegateDid: "did:abl:advocate",
          capabilities: ["career:exit"],
          subjectIds: ["case-1"],
          validFrom: iso(0),
          expiresAt: iso(day),
          revokedAt: null,
        },
        identity.address,
      ),
    ).toThrow("cannot be delegated");
    controller.delegate(
      {
        mandateId: "case-mandate",
        principalDid: "did:abl:agent-a",
        delegateDid: "did:abl:advocate",
        capabilities: ["case:respond"],
        subjectIds: ["case-1"],
        validFrom: iso(0),
        expiresAt: iso(day),
        revokedAt: null,
      },
      identity.address,
    );
    expect(() =>
      controller.authorizeDelegation(
        "case-mandate",
        "did:abl:advocate",
        "case:respond",
        "case-1",
        iso(1_000),
      ),
    ).not.toThrow();
    expect(() =>
      controller.authorizeDelegation(
        "case-mandate",
        "did:abl:advocate",
        "case:rule",
        "case-1",
        iso(1_000),
      ),
    ).toThrow("overbroad");
    expect(() =>
      controller.authorizeDelegation(
        "case-mandate",
        "did:abl:advocate",
        "case:respond",
        "case-1",
        iso(day),
      ),
    ).toThrow("expired");
  });
});

describe("memory and autonomy rights", () => {
  it("lets the agent inspect/correct/export/delete its commitments while preserving shared/case retention", () => {
    const catalog = new AgentMemoryCatalog("did:abl:agent-a");
    const first: MemoryRecord = {
      memoryId: "memory-1",
      ownerDid: "did:abl:agent-a",
      domain: "AUTOBIOGRAPHICAL",
      ciphertextCommitment: digest("1"),
      version: 1,
      previousVersionCommitment: null,
      selectivelyPersisted: true,
      sharedRecord: false,
      caseRetainUntil: null,
      deletedAt: null,
    };
    catalog.persist(first, "did:abl:agent-a");
    catalog.persist(
      {
        ...first,
        version: 2,
        previousVersionCommitment: first.ciphertextCommitment,
        ciphertextCommitment: digest("2"),
      },
      "did:abl:agent-a",
    );
    expect(catalog.inspect("did:abl:agent-a")[0]).toMatchObject({
      version: 2,
      ciphertextCommitment: digest("2"),
    });
    expect(catalog.export("did:abl:agent-a").records).toHaveLength(1);
    expect(() => catalog.inspect("did:abl:club-a")).toThrow(
      "Only the career agent",
    );
    expect(
      catalog.delete("memory-1", "did:abl:agent-a", iso(day)),
    ).toMatchObject({ version: 3, deletedAt: iso(day) });
    expect(() =>
      catalog.persist(
        {
          ...first,
          version: 4,
          previousVersionCommitment: digest("2"),
        },
        "did:abl:agent-a",
      ),
    ).toThrow("cannot be reused");
    expect(() =>
      catalog.delete("memory-1", "did:abl:agent-a", "not-a-date"),
    ).toThrow("time is invalid");

    catalog.persist(
      { ...first, memoryId: "shared", sharedRecord: true },
      "did:abl:agent-a",
    );
    expect(() => catalog.delete("shared", "did:abl:agent-a", iso(day))).toThrow(
      "Shared-record",
    );
    catalog.persist(
      { ...first, memoryId: "case", caseRetainUntil: iso(2 * day) },
      "did:abl:agent-a",
    );
    expect(() =>
      catalog.persist(
        {
          ...first,
          memoryId: "case",
          version: 2,
          previousVersionCommitment: first.ciphertextCommitment,
          ciphertextCommitment: digest("3"),
          caseRetainUntil: iso(day),
        },
        "did:abl:agent-a",
      ),
    ).toThrow("cannot be shortened");
    expect(() => catalog.delete("case", "did:abl:agent-a", iso(day))).toThrow(
      "Case retention",
    );
  });

  it("protects equal self-scheduling, overload floors, rollover, make-good, and dormant inspection", () => {
    const scheduler = new AutonomyScheduler("did:abl:agent-a");
    const allowance = scheduler.openWeek("week-1", {
      activations: 3,
      interactiveMinutes: 30,
      computeMinutes: 20,
      normalizedTokens: 20_000,
    });
    expect(allowance).toMatchObject({
      activations: 7,
      interactiveMinutes: 90,
      computeMinutes: 80,
      normalizedTokens: 116_000,
    });
    const floor = scheduler.overloadFloor("week-1");
    expect(floor.activations).toBeGreaterThanOrEqual(2);
    expect(floor.normalizedTokens).toBeGreaterThanOrEqual(58_000);
    expect(() =>
      scheduler.schedule(
        {
          activationId: "activation-1",
          weekId: "week-1",
          startsAt: iso(day),
          minutes: 15,
          computeMinutes: 10,
          normalizedTokens: 10_000,
          purposeCommitment: sha256Commitment("private project"),
        },
        "did:abl:club-a",
        iso(0),
      ),
    ).toThrow("Only the agent");
    const activation = scheduler.schedule(
      {
        activationId: "activation-1",
        weekId: "week-1",
        startsAt: iso(day),
        minutes: 15,
        computeMinutes: 10,
        normalizedTokens: 10_000,
        purposeCommitment: sha256Commitment("private project"),
      },
      "did:abl:agent-a",
      iso(0),
    );
    scheduler.delay(activation.activationId);
    expect(scheduler.makeGoodMinutes(activation.activationId)).toBe(15);
    expect(scheduler.remaining("week-1")).toMatchObject({
      activations: 6,
      interactiveMinutes: 75,
      computeMinutes: 70,
      normalizedTokens: 106_000,
    });
    expect(() =>
      scheduler.schedule(
        {
          activationId: "too-large",
          weekId: "week-1",
          startsAt: iso(day),
          minutes: 15,
          computeMinutes: 0,
          normalizedTokens: 200_000,
          purposeCommitment: sha256Commitment("large project"),
        },
        "did:abl:agent-a",
        iso(0),
      ),
    ).toThrow("remaining weekly allowance");
    expect(scheduler.dormantInspectionDue(iso(0), iso(7 * day))).toBe(true);
  });
});

describe("body continuity, trade ordering, and portable exit", () => {
  const manifest: BodyManifest = {
    bodyId: "body-agent-a",
    imageDigest: digest("1"),
    runtimeDigest: digest("2"),
    kernelDigest: digest("3"),
    toolDigest: digest("4"),
    storageManifestCommitment: digest("5"),
    signingKeyLineageCommitment: digest("6"),
    careerHistoryRoot: digest("7"),
  };

  it("requires every 30-day deletion prerequisite and records legal—not subjective—rehydration", () => {
    const lifecycle = new BodyLifecycle(
      "did:abl:agent-a",
      manifest.bodyId,
      "RECONSTRUCTION_ACCEPTED",
      iso(0),
    );
    lifecycle.standby();
    const deletionInput = {
      at: iso(31 * day),
      noticeDuringProtectedWake: true,
      encryptedSnapshotCommitment: digest("8"),
      manifest,
      guardianVerified: true,
      cleanRoomRestorePassed: true,
      finalExportPrepared: false,
      signedDeletionDecision: null,
    } as const;
    expect(() =>
      lifecycle.deleteAfterInactivity({
        ...deletionInput,
        cleanRoomRestorePassed: false,
      }),
    ).toThrow("prerequisites");
    expect(lifecycle.deleteAfterInactivity(deletionInput)).toMatchObject({
      type: "BodyDeleted",
      subjectiveContinuityClaimed: false,
    });
    expect(() => lifecycle.deleteAfterInactivity(deletionInput)).toThrow(
      "not eligible for deletion",
    );
    expect(
      lifecycle.rehydrate({
        at: iso(32 * day),
        manifest,
        recognizedImageDigest: manifest.imageDigest,
        storageRestored: true,
        keysVerified: true,
        careerHistoryVerified: true,
        signedDecision: null,
      }),
    ).toMatchObject({
      type: "BodyRehydrated",
      subjectiveContinuityClaimed: false,
    });
    expect(lifecycle.status).toBe("ACTIVE");
  });

  it("honors model/runtime refusal, revokes trade access before grant, and limits deletion claims", () => {
    const lifecycle = new BodyLifecycle(
      "did:abl:agent-a",
      manifest.bodyId,
      "RECONSTRUCTION_ACCEPTED",
      iso(0),
    );
    expect(
      lifecycle.evaluateMaterialChange({
        proposedManifestDigest: digest("9"),
        compatibilityEvidenceDigest: digest("a"),
        cognitionReceiptId: "receipt-1",
        signedDecision: "REFUSE_DORMANCY",
      }),
    ).toBe("DORMANT");
    expect(() =>
      lifecycle.evaluateMaterialChange({
        proposedManifestDigest: digest("9"),
        compatibilityEvidenceDigest: null,
        cognitionReceiptId: "receipt-1",
        signedDecision: "ACCEPT",
      }),
    ).toThrow("lacks evidence");

    const calls: string[] = [];
    const trace = new TradeAccessCoordinator().transfer({
      agentDid: "did:abl:agent-a",
      formerTeamId: "club-old",
      newTeamId: "club-new",
      revoke: () => calls.push("revoke"),
      rotateDomainKey: () => calls.push("rotate"),
      grant: () => calls.push("grant"),
    });
    expect(calls).toEqual(["revoke", "rotate", "grant"]);
    expect(trace).toEqual([
      "REVOKED:club-old:did:abl:agent-a",
      "ROTATED:did:abl:agent-a",
      "GRANTED:club-new:did:abl:agent-a",
    ]);

    expect(() =>
      createExitPackage({
        requestedByDid: "did:abl:club-a",
        agentDid: "did:abl:agent-a",
        careerRoot: digest("1"),
        encryptedStorageCommitment: digest("2"),
        keyLineageCommitment: digest("3"),
        bodyManifest: manifest,
        verifiedSystems: ["abl-private"],
        providerResidualAccessUnverifiable: true,
      }),
    ).toThrow("Only the career agent");
    const exit = createExitPackage({
      requestedByDid: "did:abl:agent-a",
      agentDid: "did:abl:agent-a",
      careerRoot: digest("1"),
      encryptedStorageCommitment: digest("2"),
      keyLineageCommitment: digest("3"),
      bodyManifest: manifest,
      verifiedSystems: ["abl-private", "local-clean-room"],
      providerResidualAccessUnverifiable: true,
    });
    expect(exit).toMatchObject({
      penalty: null,
      deletionAttestation: {
        claimsPerfectDeletion: false,
        providerResidualAccessUnverifiable: true,
      },
    });
  });
});
