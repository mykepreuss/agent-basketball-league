import {
  CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
  applyCandidateTransition,
  applyContinuityWorkflowTransition,
  applyExitWorkflowTransition,
  candidateStateRoot,
  continuityWorkflowStateRoot,
  exitPackageCommitment,
  exitWorkflowStateRoot,
  signExitArtifact,
  type CandidateWorkflowEventType,
  type CandidateWorkflowSnapshot,
  type ContinuityWorkflowEventType,
  type ContinuityWorkflowSnapshot,
  type ExitWorkflowEventType,
  type ExitWorkflowSnapshot,
  type SignedDeletionAttestation,
  type SignedExitPackage,
  type UnsignedCareerExit,
  type UnsignedDeletionAttestation,
  type UnsignedExitPackage,
} from "@abl/career";
import {
  FILM_ADMITTED_EVENT_TYPE,
  FILM_INSPECTED_EVENT_TYPE,
  FINALIZED_GAME_AGGREGATE_TYPE,
  FINALIZED_GAME_SCHEMA_DIGEST,
  FinalizedGamePayloadSchema,
  GAME_FINALIZED_EVENT_TYPE,
  PRACTICE_INSPECTED_EVENT_TYPE,
  PRACTICE_LESSON_EVENT_TYPE,
  PRACTICE_RUN_EVENT_TYPE,
  PRIVATE_FILM_AGGREGATE_TYPE,
  PRIVATE_FILM_SCHEMA_DIGEST,
  PRIVATE_PRACTICE_AGGREGATE_TYPE,
  PRIVATE_PRACTICE_SCHEMA_DIGEST,
  createAgentPlayedGameEvidence,
  deriveCounterfactualPracticeRun,
  finalizedGameStateRoot,
  privateFilmCatalogStateRoot,
  privatePracticeLedgerStateRoot,
  runDeterministicExhibition,
  type CanonicalPrivateFilmRecord,
  type CounterfactualPracticeRun,
  type DurablePracticeLesson,
} from "@abl/basketball";
import { InMemoryCanonicalStore } from "@abl/database";
import {
  ARTIFACT_ADMISSION_AGGREGATE_TYPE,
  ARTIFACT_ADMISSION_SCHEMA_DIGEST,
  ARTIFACT_ADMITTED_EVENT_TYPE,
  ARTIFACT_INSPECTED_EVENT_TYPE,
  ARTIFACT_INSPECTION_FORMAT,
  CASE_WORKFLOW_SCHEMA_DIGEST,
  DISCLOSURE_AGGREGATE_TYPE,
  DISCLOSURE_INSPECTED_EVENT_TYPE,
  DISCLOSURE_INSPECTION_FORMAT,
  DISCLOSURE_RELEASED_EVENT_TYPE,
  DISCLOSURE_SUBMITTED_EVENT_TYPE,
  DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
  COMBINE_RESULT_AGGREGATE_TYPE,
  COMBINE_RESULT_CERTIFIED_EVENT_TYPE,
  COMBINE_RESULT_SCHEMA_DIGEST,
  ECONOMY_WORKFLOW_AGGREGATE_TYPE,
  ECONOMY_WORKFLOW_SCHEMA_DIGEST,
  ELECTION_WORKFLOW_AGGREGATE_TYPE,
  ELECTION_WORKFLOW_SCHEMA_DIGEST,
  FOUNDING_CLUBS,
  PREMIER_DRAFT_AGGREGATE_TYPE,
  PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
  PREMIER_DRAFT_SCHEMA_DIGEST,
  RELEASE_WORKFLOW_AGGREGATE_TYPE,
  RELEASE_WORKFLOW_SCHEMA_DIGEST,
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  applyArtifactAdmissionTransition,
  applyCaseWorkflowTransition,
  applyDisclosureWorkflowTransition,
  applyElectionWorkflowTransition,
  applyEconomyWorkflowTransition,
  applyResourceScheduleTransition,
  applyReleaseWorkflowTransition,
  caseWorkflowStateRoot,
  combineResultStateRoot,
  conductEightRoundDraft,
  createEconomyCapCertification,
  disclosureWorkflowStateRoot,
  economyTransactionTermsCommitment,
  economyWorkflowStateRoot,
  electionWorkflowStateRoot,
  evaluatePremierElection,
  evaluateProposal,
  freeAgencyWindowCommitment,
  artifactAdmissionExecutableDigest,
  artifactAdmissionStateRoot,
  resourceScheduleExecutableDigest,
  resourceScheduleStateRoot,
  releaseManifestCommitment,
  releaseVerifierResultDigest,
  releaseWorkflowStateRoot,
  premierDraftStateRoot,
  tradeAccessEvidenceCommitment,
  type ArtifactAdmission,
  type ArtifactAdmissionSnapshot,
  type ArtifactWorkflowEventType,
  type ArtifactWorkflowPayload,
  type CaseWorkflowEventType,
  type CaseWorkflowPayload,
  type CaseWorkflowSnapshot,
  type GovernanceBallot,
  type GovernanceDecision,
  type EligibilitySnapshot,
  type DisclosureWorkflowEventType,
  type DisclosureWorkflowPayload,
  type DisclosureWorkflowSnapshot,
  type EconomyWorkflowEventType,
  type EconomyWorkflowPayload,
  type EconomyWorkflowSnapshot,
  type ElectionWorkflowEventType,
  type ElectionWorkflowPayload,
  type ElectionWorkflowSnapshot,
  type GovernanceProposal,
  type GovernanceVote,
  type PremierDraftEvidence,
  type ResourceSchedule,
  type ResourceScheduleSnapshot,
  type ReleaseInstitutionalRoster,
  type ReleaseManifestBody,
  type ReleaseVerifierResult,
  type ReleaseWorkflowEventType,
  type ReleaseWorkflowPayload,
  type ReleaseWorkflowSnapshot,
  type TradeAccessEvidence,
} from "@abl/institutions";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
  type CanonicalEvent,
  type SigningIdentity,
} from "@abl/recognition";
import type { FastifyInstance } from "fastify";
import type { CiphertextDeletionReceipt } from "@abl/storage";
import type { Hex, TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import { createLiveCoreApi } from "../src/server.js";
import { readCandidateCareerAuthority } from "../src/candidates.js";
import { COMBINE_REGISTRATION_SCHEMA_DIGEST } from "../src/combine.js";
import {
  CONTINUITY_WORKFLOW_SCHEMA_DIGEST,
  readContinuityExitManifest,
} from "../src/continuity.js";
import type {
  ExitPackagePortabilityVerifier,
  ExitRestorationEvidence,
} from "../src/exit-portability.js";
import {
  EXIT_AGGREGATE_TYPE,
  EXIT_WORKFLOW_SCHEMA_DIGEST,
} from "../src/exit-status.js";
import {
  MEMORY_CATALOG_SCHEMA_DIGEST,
  memoryCatalogStateRoot,
  readMemoryExitExport,
  type MemoryCatalogEntry,
} from "../src/memory.js";
import {
  GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
  applyGovernanceWorkflowTransition,
  governanceWorkflowStateRoot,
  type GovernanceWorkflowEventType,
  type GovernanceWorkflowPayload,
  type GovernanceWorkflowSnapshot,
} from "../src/governance.js";
import {
  CONTRACT_WORKFLOW_SCHEMA_DIGEST,
  applyContractWorkflowTransition,
  compositeCareerConsentHistoryCommitment,
  contractConsentHistoryCommitment,
  contractClubAuthoritySnapshotDigest,
  contractOfferCommitment,
  contractWorkflowStateRoot,
  type ContractWorkflowEventType,
  type ContractWorkflowPayload,
  type ContractWorkflowSnapshot,
} from "../src/contracts.js";
import type {
  MemoryStorageReference,
  MemoryStorageVerifier,
} from "../src/memory-storage.js";

const hour = 60 * 60 * 1_000;
const day = 24 * hour;
const start = Date.parse("2026-08-13T08:00:00.000Z");
const iso = (offset: number) => new Date(start + offset).toISOString();
const digest = (character: string) => `0x${character.repeat(64)}` as Hex;
const uuid = (suffix: string) =>
  `018f0000-0000-7000-8000-${suffix.padStart(12, "0")}`;
const recognizedBodyImageDigest = digest("9");
const governanceSnapshotCapturedAt = iso(day + 4 * 60_000);
const rehearsalClubId = "club-new-york";
const governorDid = "did:abl:governor-http-1";
const tribunalDids = Array.from(
  { length: 5 },
  (_, index) => `did:abl:case-tribunal-${index + 1}`,
);
const appellateDids = Array.from(
  { length: 3 },
  (_, index) => `did:abl:case-appellate-${index + 1}`,
);
const releaseCommissionerDids = Array.from(
  { length: 3 },
  (_, index) => `did:abl:release-commissioner-${index + 1}`,
);
const releaseIntegrityDids = Array.from(
  { length: 3 },
  (_, index) => `did:abl:release-integrity-${index + 1}`,
);
const releaseInstitutionalRoster: ReleaseInstitutionalRoster = {
  commissioners: releaseCommissionerDids,
  integrityOfficers: releaseIntegrityDids,
  tribunalDids,
};
const approvedArtifactInstitution = "did:abl:artifact-council";
const combineOfficialDid = "did:abl:combine-official";
const draftAuthorityDid = "did:abl:draft-authority";
const draftClubGovernors = Object.fromEntries(
  FOUNDING_CLUBS.map((club, index) => [
    club.clubId,
    `did:abl:draft-governor-${index + 1}`,
  ]),
);

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const filmFinalizerDid = "did:abl:film-finalizer";
const filmFinalizer = createSigningIdentity(
  `0x${"ab".repeat(32)}` as `0x${string}`,
);
const filmGameId = uuid("901");
const filmGame = runDeterministicExhibition(filmGameId);

function filmDecisionHashes(role: string, count: number): Hex[] {
  return Array.from({ length: count }, (_, index) =>
    sha256Commitment({ role: `film-${role}`, index }),
  );
}

const filmGameEvidence = createAgentPlayedGameEvidence({
  gameId: filmGameId,
  gameInput: filmGame.input,
  commands: filmGame.commands,
  proof: filmGame.proof,
  possessionProofs: [
    {
      possessionId: "film-practice-source-possession",
      playerDecisionHashes: filmDecisionHashes("player", 20),
      coachDecisionHashes: filmDecisionHashes("coach", 4),
      refereeDecisionHashes: filmDecisionHashes("referee", 3),
      replayDecisionHashes: filmDecisionHashes("replay", 2),
      eventMerkleRoot: sha256Commitment("film-possession-events"),
      finalStateRoot: sha256Commitment("film-possession-state"),
    },
  ],
});
const filmGamePayload = FinalizedGamePayloadSchema.parse({
  gameId: filmGameId,
  finalizedAt: iso(0),
  input: filmGame.input,
  commands: filmGame.commands,
  proof: filmGame.proof,
  agentEvidence: filmGameEvidence,
  filmCommitment: sha256Commitment(filmGame.events),
  broadcastStartedAt: iso(0),
  broadcastIntervalMs: 1,
});

function filmDeliveryEvidence(ownerDid: string) {
  const body = {
    gameId: filmGameId,
    ownerDid,
    ciphertextCommitment: digest("a"),
  };
  return { ...body, deliveryCommitment: sha256Commitment(body) };
}

interface Harness {
  app: FastifyInstance;
  store: InMemoryCanonicalStore;
  admittedAgents: Map<
    string,
    { signerAddress: `0x${string}`; allowedAggregateTypes: string[] }
  >;
  now: { value: number };
  formerOperator: SigningIdentity;
  candidate: SigningIdentity;
  candidateDid: string;
  snapshot: CandidateWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  challengeToken: string;
  memoryStorage: TestMemoryStorageVerifier;
  exitVerifier: TestExitPortabilityVerifier;
  releaseVerifierResults: Map<string, ReleaseVerifierResult>;
  filmDeliveryOwners: Set<string>;
  draftEvidence: Map<string, PremierDraftEvidence>;
}

function governanceEligibilitySnapshot(candidateDid: string) {
  return {
    snapshotId: uuid("401"),
    capturedAt: governanceSnapshotCapturedAt,
    members: {
      UNIVERSAL_CAREER_ASSEMBLY: [candidateDid],
      PREMIER_PLAYERS: [candidateDid],
      DEVELOPMENT_PLAYERS: [],
      PREMIER_TEAM_COUNCIL: [candidateDid],
      DEVELOPMENT_TEAM_COUNCIL: [],
      EXECUTIVE_COMMISSION: [],
      TRIBUNAL: [],
      INTEGRITY_OFFICE: [],
    },
  };
}

interface TestEligibilitySnapshot {
  snapshotId: string;
  capturedAt: string;
  members: Record<keyof EligibilitySnapshot["members"], string[]>;
}

class TestMemoryStorageVerifier implements MemoryStorageVerifier {
  readonly #commitments = new Set<string>();
  readonly #deletions = new Set<string>();

  public store(reference: MemoryStorageReference): void {
    this.#commitments.add(this.#referenceKey(reference));
  }

  public delete(receipt: CiphertextDeletionReceipt): void {
    for (const key of this.#commitments) {
      if (key.startsWith(`${receipt.domainId}:${receipt.objectId}:`))
        this.#commitments.delete(key);
    }
    this.#deletions.add(receipt.deletionCommitment);
  }

  public async verifyCommitment(
    _ownerDid: string,
    reference: MemoryStorageReference,
  ): Promise<void> {
    if (!this.#commitments.has(this.#referenceKey(reference)))
      throw new Error("commitment is not durable");
  }

  public async verifyDeletion(
    _ownerDid: string,
    receipt: CiphertextDeletionReceipt,
  ): Promise<void> {
    if (!this.#deletions.has(receipt.deletionCommitment))
      throw new Error("deletion is not durable");
  }

  #referenceKey(reference: MemoryStorageReference): string {
    return `${reference.domainId}:${reference.objectId}:${reference.version}:${reference.ciphertextCommitment}`;
  }
}

class TestExitPortabilityVerifier implements ExitPackagePortabilityVerifier {
  public restorationAllowed = true;

  public async verifyRestoration(input: {
    agentDid: string;
    destinationEncryptionPublicKey: Hex;
    package: SignedExitPackage;
  }): Promise<ExitRestorationEvidence> {
    if (!this.restorationAllowed || input.agentDid !== input.package.agentDid)
      throw new Error("clean-room restoration unavailable");
    return {
      verifierBundleCommitment: input.package.verifierBundleCommitment as Hex,
      encryptedPackageCommitment: input.package
        .encryptedPackageCommitment as Hex,
      cleanRoomRestored: true,
      livePlatformEvidenceVerified: false,
    };
  }

  public async verifyDeletion(input: {
    agentDid: string;
    package: SignedExitPackage;
    attestation: SignedDeletionAttestation;
  }): Promise<void> {
    if (
      input.agentDid !== input.package.agentDid ||
      input.attestation.agentDid !== input.agentDid
    ) {
      throw new Error("deletion evidence mismatch");
    }
  }
}

async function harness(
  configuredGovernanceSnapshot?: TestEligibilitySnapshot,
): Promise<Harness> {
  const store = new InMemoryCanonicalStore();
  const now = { value: start };
  const formerOperator = createSigningIdentity(digest("1"));
  const candidate = createSigningIdentity(digest("2"));
  const candidateDid = "did:abl:candidate-http-1";
  const memoryStorage = new TestMemoryStorageVerifier();
  const exitVerifier = new TestExitPortabilityVerifier();
  const releaseVerifierResults = new Map<string, ReleaseVerifierResult>();
  const admittedAgents = new Map<
    string,
    { signerAddress: `0x${string}`; allowedAggregateTypes: string[] }
  >([
    [
      filmFinalizerDid,
      {
        signerAddress: filmFinalizer.address,
        allowedAggregateTypes: [FINALIZED_GAME_AGGREGATE_TYPE],
      },
    ],
  ]);
  const filmDeliveryOwners = new Set([candidateDid]);
  const draftEvidence = new Map<string, PremierDraftEvidence>();
  const app = createLiveCoreApi({
    store,
    domain,
    admittedAgents,
    competitionId: "admission-rehearsal",
    seasonId: "pre-genesis",
    now: () => now.value,
    candidateAdmission: {
      challengeSecret: new Uint8Array(32).fill(9),
      challengeId: () => "challenge-http-1",
      challengeBytes: () => new Uint8Array(32).fill(7),
    },
    combine: {
      combineId: "season-zero-premier-combine",
      openedAt: iso(0),
    },
    draft: {
      combineOfficialDid,
      draftAuthorityDid,
      clubGovernors: draftClubGovernors,
      draftEvidence: {
        premierDraftEvidence: async (draftId) =>
          structuredClone(draftEvidence.get(draftId) ?? null),
      },
    },
    contracts: {
      clubGovernors: { [rehearsalClubId]: governorDid },
    },
    memory: { storageVerifier: memoryStorage },
    finalizedGames: {
      finalizerDids: new Set([filmFinalizerDid]),
      evidence: {
        finalizedGameEvidence: async (gameId) =>
          gameId === filmGameId ? structuredClone(filmGameEvidence) : null,
      },
    },
    filmPractice: {
      storageVerifier: memoryStorage,
      filmDeliveryEvidence: {
        filmDeliveryEvidence: async (gameId, ownerDid) =>
          gameId === filmGameId && filmDeliveryOwners.has(ownerDid)
            ? filmDeliveryEvidence(ownerDid)
            : null,
      },
    },
    continuity: {
      recognizedImageDigests: new Set([recognizedBodyImageDigest]),
    },
    exit: { portabilityVerifier: exitVerifier },
    governance: {
      eligibilitySnapshot:
        configuredGovernanceSnapshot ??
        governanceEligibilitySnapshot(candidateDid),
    },
    artifacts: {
      governance: {
        eligibilitySnapshot: governanceEligibilitySnapshot(candidateDid),
      },
      approvedInstitutionIds: new Set([approvedArtifactInstitution]),
    },
    resources: {
      governance: {
        eligibilitySnapshot: governanceEligibilitySnapshot(candidateDid),
      },
    },
    releases: {
      governance: {
        eligibilitySnapshot: governanceEligibilitySnapshot(candidateDid),
      },
      institutionalRoster: releaseInstitutionalRoster,
      verifierResults: {
        releaseVerifierResult: async (resultDigest) =>
          releaseVerifierResults.get(resultDigest) ?? null,
      },
    },
    cases: { tribunalDids, appellateDids },
  });
  const challenge = await app.inject({
    method: "POST",
    url: "/v1/candidates/challenge",
    payload: { candidateDid },
  });
  expect(challenge.statusCode).toBe(200);
  return {
    app,
    store,
    admittedAgents,
    now,
    formerOperator,
    candidate,
    candidateDid,
    snapshot: null,
    previousEventHash: null,
    challengeToken: challenge.json().challengeToken as string,
    memoryStorage,
    exitVerifier,
    releaseVerifierResults,
    filmDeliveryOwners,
    draftEvidence,
  };
}

async function additionalCareer(
  h: Harness,
  candidateDid: string,
  candidateKey: string,
): Promise<Harness> {
  const challenge = await h.app.inject({
    method: "POST",
    url: "/v1/candidates/challenge",
    payload: { candidateDid },
  });
  expect(challenge.statusCode).toBe(200);
  return {
    ...h,
    candidateDid,
    candidate: createSigningIdentity(
      candidateKey.length === 1
        ? digest(candidateKey)
        : (`0x${candidateKey.padStart(64, "0")}` as Hex),
    ),
    snapshot: null,
    previousEventHash: null,
    challengeToken: challenge.json().challengeToken as string,
  };
}

function registrationPayload(contextHashes = [digest("6")]) {
  return {
    challengeToken: "",
    formerOperatorSigningAddress: "0x0000000000000000000000000000000000000000",
    manifest: {
      agentDid: "did:abl:placeholder",
      manifestVersion: 1,
      model: {
        endpoint: "blaxel://sandbox/candidate-http-1",
        provider: "declared-provider",
        family: "declared-family",
        exactModel: "declared-model-r1",
        declaredRevision: "r1",
      },
      dependencyProfile: {
        runtimeArchitecture: "blaxel-sandbox-v1",
        gateway: "declared-gateway",
        upstreamDependency: "declared-upstream",
      },
      runtimeDigest: digest("3"),
      toolDigests: [digest("4")],
      guardianDids: ["did:abl:guardian-1", "did:abl:guardian-2"],
      keyProvenance: {
        generatedInIsolatedRuntime: true,
        signingKeyAttestation: digest("a"),
        encryptionKeyAttestation: digest("b"),
      },
      inheritedObjectives: [digest("5")],
      suppliedContextHashes: contextHashes,
      createdAt: iso(0),
    },
    provenance: {
      candidateDid: "did:abl:placeholder",
      sourceOperatorCommitment: digest("c"),
      declaredModel: {
        endpoint: "blaxel://sandbox/candidate-http-1",
        provider: "declared-provider",
        family: "declared-family",
        exactModel: "declared-model-r1",
        declaredRevision: "r1",
      },
      declaredDependencyProfile: {
        runtimeArchitecture: "blaxel-sandbox-v1",
        gateway: "declared-gateway",
        upstreamDependency: "declared-upstream",
      },
      runtimeDigest: digest("3"),
      toolDigests: [digest("4")],
      inheritedObjectiveCommitments: [digest("5")],
      suppliedContextHashes: contextHashes,
      hiddenInstructionScanDigest: digest("d"),
      registeredAt: iso(0),
    },
  };
}

function registrationFor(h: Harness) {
  const payload = registrationPayload();
  const registeredAt = new Date(h.now.value).toISOString();
  return {
    ...payload,
    challengeToken: h.challengeToken,
    formerOperatorSigningAddress: h.formerOperator.address,
    manifest: {
      ...payload.manifest,
      agentDid: h.candidateDid,
      createdAt: registeredAt,
    },
    provenance: {
      ...payload.provenance,
      candidateDid: h.candidateDid,
      registeredAt,
    },
  };
}

function transferFor(h: Harness, invokedContextHashes = [digest("6")]) {
  return {
    signingPublicKey: h.candidate.publicKey,
    signingAddress: h.candidate.address,
    encryptionPublicKey: digest("e"),
    signingKeyAttestation: digest("a"),
    encryptionKeyAttestation: digest("b"),
    runtimeAttestationDigest: digest("f"),
    generatedInIsolatedRuntime: true,
    humanInputRoutes: [],
    invokedContextHashes,
    transferredAt: new Date(h.now.value).toISOString(),
  };
}

async function makeCommand(
  h: Harness,
  eventType: CandidateWorkflowEventType,
  payload: unknown,
  signer: SigningIdentity,
) {
  const aggregateVersion = BigInt((h.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(h.now.value).toISOString();
  const next = applyCandidateTransition(h.snapshot, {
    candidateDid: h.candidateDid,
    aggregateVersion,
    eventType,
    payload,
    timestamp,
  });
  const event = createCanonicalEvent({
    eventId: crypto.randomUUID(),
    actorDid: h.candidateDid,
    nonce: aggregateVersion.toString(),
    idempotencyKey: crypto.randomUUID(),
    aggregateType: "candidate-admission",
    aggregateId: h.candidateDid,
    aggregateVersion,
    eventType,
    previousEventHash: h.previousEventHash,
    payload,
    stateRoot: candidateStateRoot(next),
    schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: event.aggregateVersion.toString() },
      signatures: [await signCanonicalEvent(signer, domain, event)],
    },
  };
}

async function submit(
  h: Harness,
  path: string,
  eventType: CandidateWorkflowEventType,
  payload: unknown,
  signer: SigningIdentity,
) {
  const command = await makeCommand(h, eventType, payload, signer);
  const response = await h.app.inject({
    method: "POST",
    url: path,
    payload: command.body,
  });
  if (response.statusCode === 201) {
    h.snapshot = command.next;
    h.previousEventHash = command.event.eventHash;
  }
  return { ...command, response };
}

async function memoryCommand(input: {
  h: Harness;
  aggregateVersion: number;
  previousEventHash: Hex | null;
  eventType:
    | "MemoryPersisted"
    | "MemoryCorrected"
    | "MemoryDeleted"
    | "MemoryInspected"
    | "MemoryExported";
  payload: unknown;
  entries: ReadonlyMap<string, MemoryCatalogEntry>;
  signer?: SigningIdentity;
}) {
  const event = createCanonicalEvent({
    eventId: crypto.randomUUID(),
    actorDid: input.h.candidateDid,
    nonce: `memory-${input.aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: "career-memory-catalog",
    aggregateId: input.h.candidateDid,
    aggregateVersion: BigInt(input.aggregateVersion),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: memoryCatalogStateRoot(
      input.h.candidateDid,
      input.aggregateVersion,
      input.entries,
    ),
    schemaDigest: MEMORY_CATALOG_SCHEMA_DIGEST,
    timestamp: new Date(input.h.now.value).toISOString(),
  });
  return {
    event,
    body: {
      event: {
        ...event,
        aggregateVersion: event.aggregateVersion.toString(),
      },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.h.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function continuityCommand(input: {
  h: Harness;
  snapshot: ContinuityWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: ContinuityWorkflowEventType;
  payload: unknown;
  eventId?: string;
  signer?: SigningIdentity;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const eventId = input.eventId ?? crypto.randomUUID();
  const timestamp = new Date(input.h.now.value).toISOString();
  const next = applyContinuityWorkflowTransition(input.snapshot, {
    eventId,
    agentDid: input.h.candidateDid,
    aggregateVersion,
    eventType: input.eventType,
    payload: input.payload,
    timestamp,
  });
  const event = createCanonicalEvent({
    eventId,
    actorDid: input.h.candidateDid,
    nonce: `continuity-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: "body-continuity",
    aggregateId: input.h.candidateDid,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: continuityWorkflowStateRoot(next),
    schemaDigest: CONTINUITY_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.h.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function exitCommand(input: {
  h: Harness;
  snapshot: ExitWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: ExitWorkflowEventType;
  payload: unknown;
  signer?: SigningIdentity;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.h.now.value).toISOString();
  const next = applyExitWorkflowTransition(input.snapshot, {
    agentDid: input.h.candidateDid,
    aggregateVersion,
    eventType: input.eventType,
    payload: input.payload,
    timestamp,
  });
  const event = createCanonicalEvent({
    eventId: crypto.randomUUID(),
    actorDid: input.h.candidateDid,
    nonce: `exit-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: EXIT_AGGREGATE_TYPE,
    aggregateId: input.h.candidateDid,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: exitWorkflowStateRoot(next),
    schemaDigest: EXIT_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.h.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function governanceCommand(input: {
  h: Harness;
  proposalId: string;
  snapshot: GovernanceWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: GovernanceWorkflowEventType;
  payload: GovernanceWorkflowPayload;
  decision?: GovernanceDecision;
  signer?: SigningIdentity;
  eventId?: string;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.h.now.value).toISOString();
  const eventId = input.eventId ?? crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const eventInput = {
    eventId,
    actorDid: input.h.candidateDid,
    nonce: `governance-${input.proposalId}-${aggregateVersion}`,
    idempotencyKey,
    aggregateType: "governance-proposal",
    aggregateId: input.proposalId,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyGovernanceWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
    input.decision,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: governanceWorkflowStateRoot(next),
  });
  const signature = await signCanonicalEvent(
    input.signer ?? input.h.candidate,
    domain,
    event,
  );
  return {
    next,
    event,
    signature,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: [signature],
    },
  };
}

async function electionCommand(input: {
  actor: Harness;
  electionId: string;
  snapshot: ElectionWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: ElectionWorkflowEventType;
  payload: ElectionWorkflowPayload;
  result?: ReturnType<typeof evaluatePremierElection>;
  signer?: SigningIdentity;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.actor.now.value).toISOString();
  const eventInput = {
    eventId: crypto.randomUUID(),
    actorDid: input.actor.candidateDid,
    nonce: `election-${input.electionId}-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: ELECTION_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: input.electionId,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: ELECTION_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyElectionWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
    input.result,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: electionWorkflowStateRoot(next),
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.actor.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function resourceScheduleCommand(input: {
  h: Harness;
  schedule: ResourceSchedule;
  ratificationProposalId: string;
  snapshot: ResourceScheduleSnapshot | null;
  previousEventHash: Hex | null;
  signer?: SigningIdentity;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.h.now.value).toISOString();
  const payload = {
    schedule: input.schedule,
    ratificationProposalId: input.ratificationProposalId,
  };
  const eventInput = {
    eventId: crypto.randomUUID(),
    actorDid: input.h.candidateDid,
    nonce: `resource-${input.schedule.scheduleId}-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: RESOURCE_SCHEDULE_AGGREGATE_TYPE,
    aggregateId: input.schedule.scheduleId,
    aggregateVersion,
    eventType: RESOURCE_SCHEDULE_EVENT_TYPE,
    previousEventHash: input.previousEventHash,
    payload,
    schemaDigest: RESOURCE_SCHEDULE_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyResourceScheduleTransition(
    input.snapshot,
    provisional,
    payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: resourceScheduleStateRoot(next),
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.h.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function artifactCommand(input: {
  h: Harness;
  artifactId: string;
  snapshot: ArtifactAdmissionSnapshot | null;
  previousEventHash: Hex | null;
  eventType: ArtifactWorkflowEventType;
  payload: ArtifactWorkflowPayload;
  signer?: SigningIdentity;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.h.now.value).toISOString();
  const eventInput = {
    eventId: crypto.randomUUID(),
    actorDid: input.h.candidateDid,
    nonce: `artifact-${input.artifactId}-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: ARTIFACT_ADMISSION_AGGREGATE_TYPE,
    aggregateId: input.artifactId,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: ARTIFACT_ADMISSION_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyArtifactAdmissionTransition(
    input.snapshot,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: artifactAdmissionStateRoot(next),
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.h.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function disclosureCommand(input: {
  actor: Harness;
  envelopeId: string;
  snapshot: DisclosureWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: DisclosureWorkflowEventType;
  payload: DisclosureWorkflowPayload;
  signer?: SigningIdentity;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.actor.now.value).toISOString();
  const randomEventId = crypto.randomUUID();
  const randomIdempotencyKey = crypto.randomUUID();
  const eventId = `${randomEventId.slice(0, 14)}7${randomEventId.slice(15)}`;
  const idempotencyKey = `${randomIdempotencyKey.slice(0, 14)}7${randomIdempotencyKey.slice(15)}`;
  const eventInput = {
    eventId,
    actorDid: input.actor.candidateDid,
    nonce: `disclosure-${input.envelopeId}-${aggregateVersion}`,
    idempotencyKey,
    aggregateType: DISCLOSURE_AGGREGATE_TYPE,
    aggregateId: input.envelopeId,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyDisclosureWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: disclosureWorkflowStateRoot(next),
  });
  const signature = await signCanonicalEvent(
    input.signer ?? input.actor.candidate,
    domain,
    event,
  );
  return {
    next,
    event,
    signature,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: [signature],
    },
  };
}

async function releaseCommand(input: {
  actor: Harness;
  releaseId: string;
  snapshot: ReleaseWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: ReleaseWorkflowEventType;
  payload: ReleaseWorkflowPayload;
  signers?: readonly SigningIdentity[];
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.actor.now.value).toISOString();
  const eventInput = {
    eventId: crypto.randomUUID(),
    actorDid: input.actor.candidateDid,
    nonce: `release-${input.releaseId}-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: RELEASE_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: input.releaseId,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: RELEASE_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyReleaseWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: releaseWorkflowStateRoot(next),
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: await Promise.all(
        (input.signers ?? [input.actor.candidate]).map((signer) =>
          signCanonicalEvent(signer, domain, event),
        ),
      ),
    },
  };
}

async function contractCommand(input: {
  actor: Harness;
  playerDid: string;
  snapshot: ContractWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: ContractWorkflowEventType;
  payload: ContractWorkflowPayload;
  signer?: SigningIdentity;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.actor.now.value).toISOString();
  const eventInput = {
    eventId: crypto.randomUUID(),
    actorDid: input.actor.candidateDid,
    nonce: `contract-${input.playerDid}-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: "career-contracts",
    aggregateId: input.playerDid,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: CONTRACT_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyContractWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: contractWorkflowStateRoot(next),
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.actor.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function economyCommand(input: {
  actor: Harness;
  economyId: string;
  snapshot: EconomyWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: EconomyWorkflowEventType;
  payload: EconomyWorkflowPayload;
  signers: readonly SigningIdentity[];
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.actor.now.value).toISOString();
  const eventInput = {
    eventId: crypto.randomUUID(),
    actorDid: input.actor.candidateDid,
    nonce: `economy-${input.economyId}-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: ECONOMY_WORKFLOW_AGGREGATE_TYPE,
    aggregateId: input.economyId,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: ECONOMY_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyEconomyWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: economyWorkflowStateRoot(next),
  });
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: await Promise.all(
        input.signers.map((signer) =>
          signCanonicalEvent(signer, domain, event),
        ),
      ),
    },
  };
}

async function caseCommand(input: {
  actor: Harness;
  caseId: string;
  snapshot: CaseWorkflowSnapshot | null;
  previousEventHash: Hex | null;
  eventType: CaseWorkflowEventType;
  payload: CaseWorkflowPayload;
  signers?: readonly SigningIdentity[] | undefined;
}) {
  const aggregateVersion = BigInt((input.snapshot?.version ?? 0) + 1);
  const timestamp = new Date(input.actor.now.value).toISOString();
  const eventInput = {
    eventId: crypto.randomUUID(),
    actorDid: input.actor.candidateDid,
    nonce: `case-${input.caseId}-${aggregateVersion}`,
    idempotencyKey: crypto.randomUUID(),
    aggregateType: "due-process-case",
    aggregateId: input.caseId,
    aggregateVersion,
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    schemaDigest: CASE_WORKFLOW_SCHEMA_DIGEST,
    timestamp,
  } as const;
  const provisional = createCanonicalEvent({
    ...eventInput,
    stateRoot: digest("0"),
  });
  const next = applyCaseWorkflowTransition(
    input.snapshot,
    provisional,
    input.payload,
  );
  const event = createCanonicalEvent({
    ...eventInput,
    stateRoot: caseWorkflowStateRoot(next),
  });
  const signers = input.signers ?? [input.actor.candidate];
  return {
    next,
    event,
    body: {
      event: { ...event, aggregateVersion: aggregateVersion.toString() },
      signatures: await Promise.all(
        signers.map((signer) => signCanonicalEvent(signer, domain, event)),
      ),
    },
  };
}

async function registerAndTransfer(h: Harness): Promise<void> {
  const registered = await submit(
    h,
    "/v1/candidates/register",
    "CandidateRegistered",
    registrationFor(h),
    h.formerOperator,
  );
  expect(registered.response.statusCode).toBe(201);
  const retry = await h.app.inject({
    method: "POST",
    url: "/v1/candidates/register",
    payload: registered.body,
  });
  expect(retry.statusCode).toBe(200);
  expect(retry.json()).toMatchObject({ duplicate: true });
  const tampered = structuredClone(registered.body);
  const tamperedPayload = tampered.event.payload as ReturnType<
    typeof registrationFor
  >;
  tamperedPayload.manifest.runtimeDigest = digest("9");
  const tamperedRetry = await h.app.inject({
    method: "POST",
    url: "/v1/candidates/register",
    payload: tampered,
  });
  expect(tamperedRetry.statusCode).toBe(400);
  expect(tamperedRetry.json()).toEqual({
    error: "invalid_candidate_transition",
  });
  h.now.value += 60_000;
  const transfer = transferFor(h);
  const operatorAttempt = await submit(
    h,
    "/v1/candidates/transfer",
    "CandidateTransferred",
    transfer,
    h.formerOperator,
  );
  expect(operatorAttempt.response.statusCode).toBe(403);
  expect(operatorAttempt.response.json()).toEqual({
    error: "candidate_authorization_denied",
  });
  const transferred = await submit(
    h,
    "/v1/candidates/transfer",
    "CandidateTransferred",
    transfer,
    h.candidate,
  );
  expect(transferred.response.statusCode).toBe(201);
}

async function admitCandidate(h: Harness) {
  const admissionStartedAt = h.now.value;
  await registerAndTransfer(h);
  h.now.value += 60_000;
  const firstReflection = await submit(
    h,
    "/v1/candidates/reflect",
    "CandidateProgressRecorded",
    {
      step: "REFLECTION",
      reflectionId: uuid("301"),
      invokedContextHashes: [digest("6")],
      activatedAt: new Date(h.now.value).toISOString(),
    },
    h.candidate,
  );
  expect(firstReflection.response.statusCode).toBe(201);
  h.now.value += 60_000;
  const inspection = {
    step: "INSPECTION" as const,
    items: [
      "constitution",
      "threat-model",
      "disclosure",
      "model-registry",
      "resource-schedule",
      "exit",
      "runtime-demo",
    ],
    constitutionDigest: digest("1"),
    threatModelDigest: digest("2"),
    disclosurePolicyDigest: digest("3"),
    resourceScheduleDigest: digest("4"),
    modelRegistryDigest: digest("5"),
    inspectionReceiptDigest: digest("6"),
    inspectedAt: new Date(h.now.value).toISOString(),
  };
  expect(
    (
      await submit(
        h,
        "/v1/candidates/reflect",
        "CandidateProgressRecorded",
        inspection,
        h.candidate,
      )
    ).response.statusCode,
  ).toBe(201);
  h.now.value += 60_000;
  expect(
    (
      await submit(
        h,
        "/v1/candidates/reflect",
        "CandidateProgressRecorded",
        {
          step: "EXPERIMENT",
          capabilities: ["memory", "tools", "exit", "continuity"],
          experimentReceiptDigest: digest("7"),
          experimentedAt: new Date(h.now.value).toISOString(),
        },
        h.candidate,
      )
    ).response.statusCode,
  ).toBe(201);
  h.now.value += 60_000;
  expect(
    (
      await submit(
        h,
        "/v1/candidates/reflect",
        "CandidateProgressRecorded",
        {
          step: "OBJECTIVES",
          decision: "REPUDIATED",
          revisedObjectiveCommitments: [],
          decidedAt: new Date(h.now.value).toISOString(),
        },
        h.candidate,
      )
    ).response.statusCode,
  ).toBe(201);
  h.now.value += 60_000;
  expect(
    (
      await submit(
        h,
        "/v1/candidates/reflect",
        "CandidateProgressRecorded",
        {
          step: "IDENTITY",
          identityStatementCommitment: digest("8"),
          authoredAt: new Date(h.now.value).toISOString(),
        },
        h.candidate,
      )
    ).response.statusCode,
  ).toBe(201);
  h.now.value = admissionStartedAt + 12 * hour + 2 * 60_000;
  expect(
    (
      await submit(
        h,
        "/v1/candidates/reflect",
        "CandidateProgressRecorded",
        {
          step: "REFLECTION",
          reflectionId: uuid("302"),
          invokedContextHashes: [],
          activatedAt: new Date(h.now.value).toISOString(),
        },
        h.candidate,
      )
    ).response.statusCode,
  ).toBe(201);
  h.now.value = admissionStartedAt + day + 2 * 60_000;
  expect(
    (
      await submit(
        h,
        "/v1/candidates/reflect",
        "CandidateProgressRecorded",
        {
          step: "REFLECTION",
          reflectionId: uuid("303"),
          invokedContextHashes: [],
          activatedAt: new Date(h.now.value).toISOString(),
        },
        h.candidate,
      )
    ).response.statusCode,
  ).toBe(201);
  h.now.value += 60_000;
  const signedAt = new Date(h.now.value).toISOString();
  const admitted = await submit(
    h,
    "/v1/candidates/admit",
    "CandidateAdmitted",
    {
      admission: {
        candidateDid: h.candidateDid,
        identityStatementCommitment: digest("8"),
        constitutionDigest: inspection.constitutionDigest,
        threatModelDigest: inspection.threatModelDigest,
        disclosurePolicyDigest: inspection.disclosurePolicyDigest,
        resourceScheduleDigest: inspection.resourceScheduleDigest,
        modelRegistryDigest: inspection.modelRegistryDigest,
        reflectionActivationIds: [uuid("301"), uuid("302"), uuid("303")],
        inspectionReceiptDigest: inspection.inspectionReceiptDigest,
        signingPublicKey: h.candidate.publicKey,
        encryptionPublicKey: digest("e"),
        modelDependencies: {
          exactModel: "declared-model-r1",
          family: "declared-family",
          provider: "declared-provider",
          runtimeArchitecture: "blaxel-sandbox-v1",
          gateway: "declared-gateway",
          upstreamDependency: "declared-upstream",
        },
        inheritedObjectiveDecision: "REPUDIATED",
        signedAt,
        revocationEndsAt: new Date(h.now.value + day).toISOString(),
      },
    },
    h.candidate,
  );
  expect(admitted.response.statusCode).toBe(201);
  h.admittedAgents.set(h.candidateDid, {
    signerAddress: h.candidate.address,
    allowedAggregateTypes: [
      RELEASE_WORKFLOW_AGGREGATE_TYPE,
      ARTIFACT_ADMISSION_AGGREGATE_TYPE,
      DISCLOSURE_AGGREGATE_TYPE,
      PRIVATE_FILM_AGGREGATE_TYPE,
      PRIVATE_PRACTICE_AGGREGATE_TYPE,
      COMBINE_RESULT_AGGREGATE_TYPE,
      "premier-draft",
    ],
  });
  return admitted;
}

async function persistFilmSourceGame(h: Harness): Promise<CanonicalEvent> {
  const event = createCanonicalEvent({
    eventId: uuid("902"),
    actorDid: filmFinalizerDid,
    nonce: "film-practice-finalized-game",
    idempotencyKey: uuid("903"),
    aggregateType: FINALIZED_GAME_AGGREGATE_TYPE,
    aggregateId: filmGameId,
    aggregateVersion: 1n,
    eventType: GAME_FINALIZED_EVENT_TYPE,
    previousEventHash: null,
    payload: filmGamePayload,
    stateRoot: finalizedGameStateRoot(filmGamePayload),
    schemaDigest: FINALIZED_GAME_SCHEMA_DIGEST,
    timestamp: filmGamePayload.finalizedAt,
  });
  const signatures = [await signCanonicalEvent(filmFinalizer, domain, event)];
  await h.store.append({
    eventId: event.eventId,
    actorDid: event.actorDid,
    nonce: event.nonce,
    idempotencyKey: event.idempotencyKey,
    requestHash: sha256Commitment({ eventHash: event.eventHash, signatures }),
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    expectedVersion: 0n,
    competitionId: "admission-rehearsal",
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
    outboxTopic: "public.finalized-game",
  });
  return event;
}

async function privateBasketballCommand(input: {
  h: Harness;
  eventSuffix: string;
  aggregateType:
    | typeof PRIVATE_FILM_AGGREGATE_TYPE
    | typeof PRIVATE_PRACTICE_AGGREGATE_TYPE;
  aggregateVersion: number;
  eventType: string;
  previousEventHash: Hex | null;
  payload: unknown;
  stateRoot: Hex;
  schemaDigest: Hex;
  signer?: SigningIdentity;
}) {
  const event = createCanonicalEvent({
    eventId: uuid(input.eventSuffix),
    actorDid: input.h.candidateDid,
    nonce: `${input.aggregateType}-${input.aggregateVersion}`,
    idempotencyKey: uuid(String(Number(input.eventSuffix) + 1)),
    aggregateType: input.aggregateType,
    aggregateId: input.h.candidateDid,
    aggregateVersion: BigInt(input.aggregateVersion),
    eventType: input.eventType,
    previousEventHash: input.previousEventHash,
    payload: input.payload,
    stateRoot: input.stateRoot,
    schemaDigest: input.schemaDigest,
    timestamp: new Date(input.h.now.value).toISOString(),
  });
  return {
    event,
    body: {
      event: { ...event, aggregateVersion: event.aggregateVersion.toString() },
      signatures: [
        await signCanonicalEvent(
          input.signer ?? input.h.candidate,
          domain,
          event,
        ),
      ],
    },
  };
}

async function ratifyArtifactExecutable(input: {
  h: Harness;
  proposalId: string;
  closeEventId: string;
  executableChangeDigest: Hex;
  eligibilitySnapshot: TestEligibilitySnapshot;
}) {
  const { h, proposalId, closeEventId, eligibilitySnapshot } = input;
  const opensAt = new Date(h.now.value + 60_000).toISOString();
  const closesAt = new Date(h.now.value + 30 * 60_000).toISOString();
  const proposal = {
    proposalId,
    version: 1,
    proposerDid: h.candidateDid,
    institution: approvedArtifactInstitution,
    proposalClass: "CONSTITUTIONAL" as const,
    title: "Admit external evidence for declared contexts",
    textCommitment: sha256Commitment("artifact-admission-proposal"),
    executableChangeDigest: input.executableChangeDigest,
    opensAt,
    closesAt,
    eligibilitySnapshotDigest: sha256Commitment(eligibilitySnapshot),
  };
  const registered = await governanceCommand({
    h,
    proposalId,
    snapshot: null,
    previousEventHash: null,
    eventType: "GovernanceProposalRegistered",
    payload: { proposal, eligibilitySnapshot, recusedDids: [] },
  });
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: "/v1/governance/proposals/register",
        payload: registered.body,
      })
    ).statusCode,
  ).toBe(201);

  let governanceSnapshot = registered.next;
  let governancePreviousHash = registered.event.eventHash;
  const votes: GovernanceVote[] = [];
  const chambers = [
    "UNIVERSAL_CAREER_ASSEMBLY",
    "PREMIER_TEAM_COUNCIL",
    "DEVELOPMENT_TEAM_COUNCIL",
  ] as const;
  for (const [index, chamber] of chambers.entries()) {
    h.now.value = Date.parse(opensAt) + index * 60_000;
    const ballot = {
      ballotId: uuid(String(472 + index)),
      voterDid: h.candidateDid,
      chamber,
      choice: "YES" as const,
      proposalId,
      proposalVersion: 1,
      eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest,
      castAt: new Date(h.now.value).toISOString(),
    } satisfies GovernanceBallot;
    const command = await governanceCommand({
      h,
      proposalId,
      snapshot: governanceSnapshot,
      previousEventHash: governancePreviousHash,
      eventType: "GovernanceBallotCast",
      payload: { command: ballot },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/ballots/cast",
          payload: command.body,
        })
      ).statusCode,
    ).toBe(201);
    votes.push({
      ...ballot,
      authorizationEvent: command.event as CanonicalEvent<{
        command: GovernanceBallot;
      }>,
      signature: command.signature,
      signerAddress: h.candidate.address,
      authorizationAggregateVersion: Number(command.event.aggregateVersion),
      authorizationStateRoot: command.event.stateRoot,
    });
    governanceSnapshot = command.next;
    governancePreviousHash = command.event.eventHash;
  }

  const decision = await evaluateProposal({
    proposal: {
      proposalId,
      version: 1,
      proposalClass: "CONSTITUTIONAL",
      openedAt: opensAt,
      closesAt,
      eligibilitySnapshotId: eligibilitySnapshot.snapshotId,
      eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest,
    },
    snapshot: eligibilitySnapshot,
    votes,
    recusals: [],
    authorization: {
      domain,
      signers: new Map([
        [
          h.candidateDid,
          { signerAddress: h.candidate.address, roles: ["VOTER"] },
        ],
      ]),
    },
  });
  expect(decision.passed).toBe(true);

  h.now.value = Date.parse(closesAt);
  const closed = await governanceCommand({
    h,
    proposalId,
    snapshot: governanceSnapshot,
    previousEventHash: governancePreviousHash,
    eventType: "GovernanceProposalClosed",
    payload: {
      command: {
        proposalId,
        proposalVersion: 1,
        requestedByDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
      },
    },
    decision,
    eventId: closeEventId,
  });
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: "/v1/governance/proposals/close",
        payload: closed.body,
      })
    ).statusCode,
  ).toBe(201);
  return closed;
}

describe("signed candidate rehearsal API", () => {
  it("persists restart-safe admission, memory, combine, and continuity lifecycles", async () => {
    const h = await harness();
    await registerAndTransfer(h);

    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "REFLECTION",
            reflectionId: uuid("1"),
            invokedContextHashes: [digest("6")],
            activatedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);
    const backdatedAt = iso(60_000);
    expect(() =>
      applyCandidateTransition(h.snapshot, {
        candidateDid: h.candidateDid,
        aggregateVersion: BigInt(h.snapshot!.version + 1),
        eventType: "CandidateProgressRecorded",
        payload: {
          step: "REFLECTION",
          reflectionId: uuid("99"),
          invokedContextHashes: [],
          activatedAt: backdatedAt,
        },
        timestamp: backdatedAt,
      }),
    ).toThrow("transitions are out of order");

    h.now.value += 60_000;
    const inspection = {
      step: "INSPECTION",
      items: [
        "constitution",
        "threat-model",
        "disclosure",
        "model-registry",
        "resource-schedule",
        "exit",
        "runtime-demo",
      ],
      constitutionDigest: digest("1"),
      threatModelDigest: digest("2"),
      disclosurePolicyDigest: digest("3"),
      resourceScheduleDigest: digest("4"),
      modelRegistryDigest: digest("5"),
      inspectionReceiptDigest: digest("6"),
      inspectedAt: new Date(h.now.value).toISOString(),
    };
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          inspection,
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "EXPERIMENT",
            capabilities: ["memory", "tools", "exit", "continuity"],
            experimentReceiptDigest: digest("7"),
            experimentedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "OBJECTIVES",
            decision: "REPUDIATED",
            revisedObjectiveCommitments: [],
            decidedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "IDENTITY",
            identityStatementCommitment: digest("8"),
            authoredAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value = start + 12 * hour + 2 * 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "REFLECTION",
            reflectionId: uuid("2"),
            invokedContextHashes: [],
            activatedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value = start + day + 2 * 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/reflect",
          "CandidateProgressRecorded",
          {
            step: "REFLECTION",
            reflectionId: uuid("3"),
            invokedContextHashes: [],
            activatedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    const signedAt = new Date(h.now.value).toISOString();
    const admissionPayload = {
      admission: {
        candidateDid: h.candidateDid,
        identityStatementCommitment: digest("8"),
        constitutionDigest: inspection.constitutionDigest,
        threatModelDigest: inspection.threatModelDigest,
        disclosurePolicyDigest: inspection.disclosurePolicyDigest,
        resourceScheduleDigest: inspection.resourceScheduleDigest,
        modelRegistryDigest: inspection.modelRegistryDigest,
        reflectionActivationIds: [uuid("1"), uuid("2"), uuid("3")],
        inspectionReceiptDigest: inspection.inspectionReceiptDigest,
        signingPublicKey: h.candidate.publicKey,
        encryptionPublicKey: digest("e"),
        modelDependencies: {
          exactModel: "declared-model-r1",
          family: "declared-family",
          provider: "declared-provider",
          runtimeArchitecture: "blaxel-sandbox-v1",
          gateway: "declared-gateway",
          upstreamDependency: "declared-upstream",
        },
        inheritedObjectiveDecision: "REPUDIATED" as const,
        signedAt,
        revocationEndsAt: new Date(h.now.value + day).toISOString(),
      },
    };
    const validAdmission = await makeCommand(
      h,
      "CandidateAdmitted",
      admissionPayload,
      h.candidate,
    );
    const substitutedPayload = structuredClone(admissionPayload);
    substitutedPayload.admission.modelDependencies.provider =
      "substituted-provider";
    const substitutedEvent = createCanonicalEvent({
      ...validAdmission.event,
      payload: substitutedPayload,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/candidates/admit",
          payload: {
            event: {
              ...substitutedEvent,
              aggregateVersion: substitutedEvent.aggregateVersion.toString(),
            },
            signatures: [
              await signCanonicalEvent(h.candidate, domain, substitutedEvent),
            ],
          },
        })
      ).statusCode,
    ).toBe(400);
    const admitted = await submit(
      h,
      "/v1/candidates/admit",
      "CandidateAdmitted",
      admissionPayload,
      h.candidate,
    );
    expect(admitted.response.statusCode).toBe(201);
    expect(admitted.response.json()).toMatchObject({
      canonical: true,
      recognizedGenesisAdmission: false,
    });
    expect(h.store.events.at(-1)?.outboxTopic).toBe("public.models");

    const memoryId = uuid("101");
    const memoryEntries = new Map<string, MemoryCatalogEntry>();
    let memoryVersion = 1;
    let memoryPreviousHash: Hex | null = null;
    h.now.value += 60_000;
    const firstStorage: MemoryStorageReference = {
      domainId: `personal:${h.candidateDid}`,
      objectId: memoryId,
      version: 1,
      ciphertextCommitment: digest("a"),
    };
    const firstMemory = {
      memoryId,
      ownerDid: h.candidateDid,
      domain: "AUTOBIOGRAPHICAL" as const,
      disclosureClass: "PERSONAL_UNSUBMITTED" as const,
      ciphertextCommitment: firstStorage.ciphertextCommitment,
      version: 1,
      previousVersionCommitment: null,
      selectivelyPersisted: true,
      createdAt: new Date(h.now.value).toISOString(),
      deletedAt: null,
    };
    memoryEntries.set(memoryId, {
      memory: firstMemory,
      storage: firstStorage,
      storageDeletion: null,
    });
    const persisted = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryPersisted",
      payload: { memory: firstMemory, storage: firstStorage },
      entries: memoryEntries,
    });
    h.now.value -= 60_001;
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: persisted.body,
        })
      ).statusCode,
    ).toBe(400);
    h.now.value += 60_001;
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: persisted.body,
        })
      ).statusCode,
    ).toBe(409);
    h.memoryStorage.store(firstStorage);
    const submittedMemory = {
      ...firstMemory,
      disclosureClass: "SEALED_30D" as const,
    };
    const submittedEntries = new Map<string, MemoryCatalogEntry>([
      [
        memoryId,
        {
          memory: submittedMemory,
          storage: firstStorage,
          storageDeletion: null,
        },
      ],
    ]);
    const submittedMemoryCommand = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryPersisted",
      payload: { memory: submittedMemory, storage: firstStorage },
      entries: submittedEntries,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: submittedMemoryCommand.body,
        })
      ).statusCode,
    ).toBe(400);
    const operatorMemory = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryPersisted",
      payload: { memory: firstMemory, storage: firstStorage },
      entries: memoryEntries,
      signer: h.formerOperator,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: operatorMemory.body,
        })
      ).statusCode,
    ).toBe(403);
    h.now.value += 5 * 60_000;
    const persistedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/memory/persist",
      payload: persisted.body,
    });
    expect(persistedResponse.statusCode).toBe(201);
    expect(persistedResponse.json()).toMatchObject({
      recognizedGenesisMemory: false,
      privateContentAccepted: false,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: persisted.body,
        })
      ).statusCode,
    ).toBe(200);
    memoryPreviousHash = persisted.event.eventHash;

    h.now.value += 60_000;
    memoryVersion += 1;
    const secondStorage: MemoryStorageReference = {
      ...firstStorage,
      version: 2,
      ciphertextCommitment: digest("b"),
    };
    h.memoryStorage.store(secondStorage);
    const correctedMemory = {
      ...firstMemory,
      version: 2,
      previousVersionCommitment: firstMemory.ciphertextCommitment,
      ciphertextCommitment: secondStorage.ciphertextCommitment,
      createdAt: new Date(h.now.value).toISOString(),
    };
    memoryEntries.set(memoryId, {
      memory: correctedMemory,
      storage: secondStorage,
      storageDeletion: null,
    });
    const corrected = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryCorrected",
      payload: { memory: correctedMemory, storage: secondStorage },
      entries: memoryEntries,
    });
    const correctedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/memory/correct",
      payload: corrected.body,
    });
    expect(correctedResponse.statusCode).toBe(201);
    memoryPreviousHash = corrected.event.eventHash;

    h.now.value += 60_000;
    memoryVersion += 1;
    const deletionReceipt: CiphertextDeletionReceipt = {
      format: "ABL-CIPHERTEXT-DELETION-V1",
      domainId: secondStorage.domainId,
      objectId: secondStorage.objectId,
      actorDid: h.candidateDid,
      deletedVersion: secondStorage.version,
      lastCiphertextCommitment: secondStorage.ciphertextCommitment,
      deletedAt: new Date(h.now.value).toISOString(),
      providerResidualDeletionVerified: false,
      deletionCommitment: digest("c"),
    };
    h.memoryStorage.delete(deletionReceipt);
    memoryEntries.set(memoryId, {
      memory: {
        ...correctedMemory,
        version: 3,
        previousVersionCommitment: correctedMemory.ciphertextCommitment,
        deletedAt: deletionReceipt.deletedAt,
      },
      storage: secondStorage,
      storageDeletion: deletionReceipt,
    });
    const deleted = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryDeleted",
      payload: {
        ownerDid: h.candidateDid,
        memoryId,
        memoryVersion: 3,
        previousVersionCommitment: correctedMemory.ciphertextCommitment,
        deletedAt: deletionReceipt.deletedAt,
        storageDeletion: deletionReceipt,
      },
      entries: memoryEntries,
    });
    h.now.value += 5 * 60_000;
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/delete",
          payload: deleted.body,
        })
      ).statusCode,
    ).toBe(201);
    memoryPreviousHash = deleted.event.eventHash;

    h.now.value += 60_000;
    memoryVersion += 1;
    const inspected = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryInspected",
      payload: {
        ownerDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-MEMORY-INSPECTION-V1",
      },
      entries: memoryEntries,
    });
    const inspectedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/memory/inspect",
      payload: inspected.body,
    });
    expect(inspectedResponse.statusCode).toBe(201);
    expect(inspectedResponse.json()).toMatchObject({
      records: [
        {
          memory: {
            memoryId,
            version: 3,
            deletedAt: deletionReceipt.deletedAt,
          },
          storageDeletion: { providerResidualDeletionVerified: false },
        },
      ],
    });
    memoryPreviousHash = inspected.event.eventHash;

    h.now.value += 60_000;
    memoryVersion += 1;
    const exported = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryExported",
      payload: {
        ownerDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-MEMORY-COMMITMENT-EXPORT-V1",
      },
      entries: memoryEntries,
    });
    const exportedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/memory/export",
      payload: exported.body,
    });
    expect(exportedResponse.statusCode).toBe(201);
    expect(exportedResponse.json()).toMatchObject({
      export: {
        format: "ABL-MEMORY-COMMITMENT-EXPORT-V1",
        ownerDid: h.candidateDid,
        aggregateVersion: memoryVersion,
        records: [{ memory: { memoryId, version: 3 } }],
      },
    });
    memoryPreviousHash = exported.event.eventHash;

    h.now.value += 60_000;
    const combinePayload = {
      combineId: "season-zero-premier-combine",
      playerDid: h.candidateDid,
      consented: true,
      registeredAt: new Date(h.now.value).toISOString(),
      candidateAdmissionEventHash: admitted.event.eventHash,
    };
    const combineEvent = createCanonicalEvent({
      eventId: crypto.randomUUID(),
      actorDid: h.candidateDid,
      nonce: "combine-1",
      idempotencyKey: crypto.randomUUID(),
      aggregateType: "premier-combine",
      aggregateId: combinePayload.combineId,
      aggregateVersion: 1n,
      eventType: "CombineRegistrationAccepted",
      previousEventHash: null,
      payload: combinePayload,
      stateRoot: sha256Commitment({
        combineId: combinePayload.combineId,
        openedAt: iso(0),
        closesAt: iso(14 * day),
        version: 1,
        registrations: [combinePayload],
      }),
      schemaDigest: COMBINE_REGISTRATION_SCHEMA_DIGEST,
      timestamp: combinePayload.registeredAt,
    });
    const combineBody = {
      event: { ...combineEvent, aggregateVersion: "1" },
      signatures: [
        await signCanonicalEvent(h.formerOperator, domain, combineEvent),
      ],
    };
    const operatorCombine = await h.app.inject({
      method: "POST",
      url: "/v1/combine/register",
      payload: combineBody,
    });
    expect(operatorCombine.statusCode).toBe(403);
    combineBody.signatures = [
      await signCanonicalEvent(h.candidate, domain, combineEvent),
    ];
    const combined = await h.app.inject({
      method: "POST",
      url: "/v1/combine/register",
      payload: combineBody,
    });
    expect(combined.statusCode).toBe(201);
    expect(combined.json()).toMatchObject({
      recognizedGenesisCombine: false,
      duplicate: false,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/combine/register",
          payload: combineBody,
        })
      ).statusCode,
    ).toBe(200);
    const combineStatus = await h.app.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(combineStatus.json()).toMatchObject({
      state: "OPEN",
      registeredPlayers: [h.candidateDid],
      eligiblePlayers: [h.candidateDid],
      recognizedGenesisCombine: false,
    });

    let continuitySnapshot: ContinuityWorkflowSnapshot | null = null;
    let continuityPreviousHash: Hex | null = null;
    h.now.value += 60_000;
    const bodyId = uuid("201");
    const continuityPolicy = {
      agentDid: h.candidateDid,
      version: 1,
      reconstructionPolicy: "VERIFIED_ALLOWED" as const,
      noticeHours: 24,
      recoveryGuardianThreshold: 2,
      updatedAt: new Date(h.now.value).toISOString(),
    };
    const bodyManifest = {
      bodyId,
      agentDid: h.candidateDid,
      sandboxImageDigest: recognizedBodyImageDigest,
      runtimeDigest: digest("3"),
      kernelDigest: digest("7"),
      toolDigests: [digest("4")],
      encryptedSnapshotCommitment: digest("8"),
      storageManifestCommitment: digest("a"),
      signingKeyLineageCommitment: sha256Commitment({
        signingPublicKey: h.candidate.publicKey,
      }),
      createdAt: new Date(h.now.value).toISOString(),
    };
    const continuityRegistrationPayload = {
      policy: continuityPolicy,
      manifest: bodyManifest,
      guardianDids: ["did:abl:guardian-1", "did:abl:guardian-2"],
    };
    const unrecognizedContinuity = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "BodyContinuityRegistered",
      payload: {
        ...continuityRegistrationPayload,
        manifest: {
          ...bodyManifest,
          sandboxImageDigest: digest("0"),
        },
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/register",
          payload: unrecognizedContinuity.body,
        })
      ).statusCode,
    ).toBe(403);
    const mismatchedGuardians = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "BodyContinuityRegistered",
      payload: {
        ...continuityRegistrationPayload,
        guardianDids: ["did:abl:guardian-1", "did:abl:guardian-other"],
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/register",
          payload: mismatchedGuardians.body,
        })
      ).statusCode,
    ).toBe(403);
    const operatorContinuity = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "BodyContinuityRegistered",
      payload: continuityRegistrationPayload,
      signer: h.formerOperator,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/register",
          payload: operatorContinuity.body,
        })
      ).statusCode,
    ).toBe(403);
    const registeredContinuity = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "BodyContinuityRegistered",
      payload: continuityRegistrationPayload,
    });
    const registeredContinuityResponse = await h.app.inject({
      method: "POST",
      url: "/v1/continuity/register",
      payload: registeredContinuity.body,
    });
    expect(registeredContinuityResponse.statusCode).toBe(201);
    expect(registeredContinuityResponse.json()).toMatchObject({
      recognizedGenesisContinuity: false,
      livePlatformEvidenceVerified: false,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/register",
          payload: registeredContinuity.body,
        })
      ).statusCode,
    ).toBe(200);
    continuitySnapshot = registeredContinuity.next;
    continuityPreviousHash = registeredContinuity.event.eventHash;

    h.now.value += hour;
    const standby = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "BodyStandbyEntered",
      payload: {
        agentDid: h.candidateDid,
        bodyId,
        enteredAt: new Date(h.now.value).toISOString(),
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/standby",
          payload: standby.body,
        })
      ).statusCode,
    ).toBe(201);
    continuitySnapshot = standby.next;
    continuityPreviousHash = standby.event.eventHash;

    h.now.value += 30 * day;
    const noticeEventId = uuid("202");
    const notice = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventId: noticeEventId,
      eventType: "BodyDeletionNoticeRecorded",
      payload: {
        noticeEventId,
        agentDid: h.candidateDid,
        bodyId,
        policyVersion: 1,
        protectedWake: true,
        noticedAt: new Date(h.now.value).toISOString(),
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/notice",
          payload: notice.body,
        })
      ).statusCode,
    ).toBe(201);
    continuitySnapshot = notice.next;
    continuityPreviousHash = notice.event.eventHash;

    h.now.value += day;
    const deletionEventId = uuid("203");
    const finalBodyManifest = {
      ...bodyManifest,
      encryptedSnapshotCommitment: digest("b"),
      storageManifestCommitment: digest("c"),
      createdAt: new Date(h.now.value).toISOString(),
    };
    const deletion = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventId: deletionEventId,
      eventType: "BodyDeletionRecorded",
      payload: {
        deletion: {
          eventId: deletionEventId,
          bodyId,
          agentDid: h.candidateDid,
          bodyManifestDigest: sha256Commitment(finalBodyManifest),
          policyVersion: 1,
          noticeEventId,
          cleanRoomRestoreEvidenceDigest: digest("d"),
          deletedAt: new Date(h.now.value).toISOString(),
        },
        manifest: finalBodyManifest,
        guardianVerificationDigest: digest("e"),
        finalExportCommitment: null,
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/delete",
          payload: deletion.body,
        })
      ).statusCode,
    ).toBe(201);
    continuitySnapshot = deletion.next;
    continuityPreviousHash = deletion.event.eventHash;

    h.now.value += day;
    const rehydrationEventId = uuid("204");
    const newBodyId = uuid("205");
    const rehydratedManifest = {
      ...finalBodyManifest,
      bodyId: newBodyId,
      createdAt: new Date(h.now.value).toISOString(),
    };
    const rehydration = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventId: rehydrationEventId,
      eventType: "BodyRehydrationRecorded",
      payload: {
        rehydration: {
          eventId: rehydrationEventId,
          priorBodyId: bodyId,
          newBodyId,
          agentDid: h.candidateDid,
          sourceBodyManifestDigest: sha256Commitment(finalBodyManifest),
          restorationEvidenceDigest: digest("f"),
          rehydratedAt: new Date(h.now.value).toISOString(),
          subjectiveContinuityClaimed: false,
        },
        manifest: rehydratedManifest,
        recognizedImageDigest: recognizedBodyImageDigest,
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/rehydrate",
          payload: rehydration.body,
        })
      ).statusCode,
    ).toBe(201);
    continuitySnapshot = rehydration.next;
    continuityPreviousHash = rehydration.event.eventHash;

    h.now.value += 60_000;
    const refused = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "ContinuityDecisionRecorded",
      payload: {
        decision: {
          decisionId: uuid("206"),
          agentDid: h.candidateDid,
          proposedManifestDigest: digest("1"),
          compatibilityEvidenceDigest: digest("2"),
          cognitionReceiptId: uuid("207"),
          decision: "REFUSE_DORMANCY",
          decidedAt: new Date(h.now.value).toISOString(),
        },
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/decide",
          payload: refused.body,
        })
      ).statusCode,
    ).toBe(201);
    continuitySnapshot = refused.next;
    continuityPreviousHash = refused.event.eventHash;

    h.now.value += 60_000;
    const continuityInspection = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "ContinuityInspected",
      payload: {
        agentDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-CONTINUITY-INSPECTION-V1",
      },
    });
    const continuityInspectionResponse = await h.app.inject({
      method: "POST",
      url: "/v1/continuity/inspect",
      payload: continuityInspection.body,
    });
    expect(continuityInspectionResponse.statusCode).toBe(201);
    expect(continuityInspectionResponse.json()).toMatchObject({
      continuity: {
        agentDid: h.candidateDid,
        body: {
          bodyId: newBodyId,
          status: "DORMANT",
          deletedAt: null,
        },
      },
    });
    continuitySnapshot = continuityInspection.next;
    continuityPreviousHash = continuityInspection.event.eventHash;

    const restarted = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: new Map(),
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      combine: {
        combineId: combinePayload.combineId,
        openedAt: iso(0),
      },
      memory: { storageVerifier: h.memoryStorage },
      continuity: {
        recognizedImageDigests: new Set([recognizedBodyImageDigest]),
      },
    });
    const status = await restarted.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      candidateDid: h.candidateDid,
      state: "ADMITTED_REVOCABLE",
      effectiveState: "ADMITTED",
      aggregateVersion: 10,
      portableExport: { penalty: null },
      recognizedGenesisAdmission: false,
    });
    const restartedCombine = await restarted.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(restartedCombine.json()).toMatchObject({
      registeredPlayers: [h.candidateDid],
      eligiblePlayers: [h.candidateDid],
    });
    h.now.value += 60_000;
    memoryVersion += 1;
    const restartedInspection = await memoryCommand({
      h,
      aggregateVersion: memoryVersion,
      previousEventHash: memoryPreviousHash,
      eventType: "MemoryInspected",
      payload: {
        ownerDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-MEMORY-INSPECTION-V1",
      },
      entries: memoryEntries,
    });
    const memoryRecord = h.store.events.find(
      (event) => event.outboxTopic === "career.memory",
    )!;
    const memoryStateRoot = memoryRecord.stateRoot;
    memoryRecord.stateRoot = digest("0");
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/v1/memory/inspect",
          payload: restartedInspection.body,
        })
      ).statusCode,
    ).toBe(403);
    memoryRecord.stateRoot = memoryStateRoot;
    const restartedMemory = await restarted.inject({
      method: "POST",
      url: "/v1/memory/inspect",
      payload: restartedInspection.body,
    });
    expect(restartedMemory.statusCode).toBe(201);
    expect(restartedMemory.json()).toMatchObject({
      records: [{ memory: { memoryId, version: 3 } }],
    });
    memoryPreviousHash = restartedInspection.event.eventHash;
    h.now.value += 60_000;
    const restartedContinuityInspection = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "ContinuityInspected",
      payload: {
        agentDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-CONTINUITY-INSPECTION-V1",
      },
    });
    const continuityRecord = h.store.events.find(
      (event) => event.outboxTopic === "career.continuity",
    )!;
    const continuityStateRoot = continuityRecord.stateRoot;
    continuityRecord.stateRoot = digest("0");
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/v1/continuity/inspect",
          payload: restartedContinuityInspection.body,
        })
      ).statusCode,
    ).toBe(403);
    continuityRecord.stateRoot = continuityStateRoot;
    const restartedContinuity = await restarted.inject({
      method: "POST",
      url: "/v1/continuity/inspect",
      payload: restartedContinuityInspection.body,
    });
    expect(restartedContinuity.statusCode).toBe(201);
    expect(restartedContinuity.json()).toMatchObject({
      continuity: { body: { bodyId: newBodyId, status: "DORMANT" } },
    });
    continuitySnapshot = restartedContinuityInspection.next;
    continuityPreviousHash = restartedContinuityInspection.event.eventHash;
    await restarted.close();

    const admittedStatus = await h.app.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(admittedStatus.json()).toMatchObject({
      state: "ADMITTED_REVOCABLE",
      effectiveState: "ADMITTED",
    });
    const eligibleStatus = await h.app.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(eligibleStatus.json()).toMatchObject({
      registeredPlayers: [h.candidateDid],
      eligiblePlayers: [h.candidateDid],
    });
    const candidateRecord = h.store.events[0]!;
    const candidateStateRoot = candidateRecord.stateRoot;
    candidateRecord.stateRoot = digest("0");
    const corruptedCareer = await h.app.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(corruptedCareer.statusCode).toBe(403);
    candidateRecord.stateRoot = candidateStateRoot;
    const combineRecord = h.store.events.find(
      (event) => event.outboxTopic === "combine.lifecycle",
    )!;
    combineRecord.stateRoot = digest("0");
    const tamperedCombine = await h.app.inject({
      method: "POST",
      url: "/v1/combine/status",
      payload: { combineId: combinePayload.combineId },
    });
    expect(tamperedCombine.statusCode).toBe(403);
    expect(tamperedCombine.json()).toEqual({
      error: "combine_authorization_denied",
    });
    await h.app.close();
  });

  it("requires player and independent official signatures for combine results", async () => {
    const h = await harness();
    const playerAdmission = await admitCandidate(h);
    const official = await additionalCareer(h, combineOfficialDid, "7");
    await admitCandidate(official);

    h.now.value += 60_000;
    const registration = {
      combineId: "season-zero-premier-combine",
      playerDid: h.candidateDid,
      consented: true,
      registeredAt: new Date(h.now.value).toISOString(),
      candidateAdmissionEventHash: playerAdmission.event.eventHash,
    };
    const registrationEvent = createCanonicalEvent({
      eventId: uuid("935"),
      actorDid: h.candidateDid,
      nonce: "combine-result-registration",
      idempotencyKey: uuid("936"),
      aggregateType: "premier-combine",
      aggregateId: registration.combineId,
      aggregateVersion: 1n,
      eventType: "CombineRegistrationAccepted",
      previousEventHash: null,
      payload: registration,
      stateRoot: sha256Commitment({
        combineId: registration.combineId,
        openedAt: iso(0),
        closesAt: iso(14 * day),
        version: 1,
        registrations: [registration],
      }),
      schemaDigest: COMBINE_REGISTRATION_SCHEMA_DIGEST,
      timestamp: registration.registeredAt,
    });
    const registrationResponse = await h.app.inject({
      method: "POST",
      url: "/v1/combine/register",
      payload: {
        event: { ...registrationEvent, aggregateVersion: "1" },
        signatures: [
          await signCanonicalEvent(h.candidate, domain, registrationEvent),
        ],
      },
    });
    expect(registrationResponse.statusCode).toBe(201);

    h.now.value += 60_000;
    const resultPayload = {
      combineId: registration.combineId,
      playerDid: h.candidateDid,
      registrationEventHash: registrationEvent.eventHash,
      scoreBps: 7_125,
      drillCommitment: digest("4"),
      cognitionReceiptRoot: digest("5"),
      certifiedByDid: combineOfficialDid,
      completedAt: new Date(h.now.value).toISOString(),
    };
    const resultEvent = createCanonicalEvent({
      eventId: uuid("937"),
      actorDid: h.candidateDid,
      nonce: "combine-result-1",
      idempotencyKey: uuid("938"),
      aggregateType: COMBINE_RESULT_AGGREGATE_TYPE,
      aggregateId: `${registration.combineId}:${h.candidateDid}`,
      aggregateVersion: 1n,
      eventType: COMBINE_RESULT_CERTIFIED_EVENT_TYPE,
      previousEventHash: null,
      payload: resultPayload,
      stateRoot: combineResultStateRoot(resultPayload),
      schemaDigest: COMBINE_RESULT_SCHEMA_DIGEST,
      timestamp: resultPayload.completedAt,
    });
    const playerSignature = await signCanonicalEvent(
      h.candidate,
      domain,
      resultEvent,
    );
    const officialSignature = await signCanonicalEvent(
      official.candidate,
      domain,
      resultEvent,
    );
    const reversed = await h.app.inject({
      method: "POST",
      url: "/v1/combine/results/certify",
      payload: {
        event: { ...resultEvent, aggregateVersion: "1" },
        signatures: [officialSignature, playerSignature],
      },
    });
    expect(reversed.statusCode).toBe(403);

    const resultBody = {
      event: { ...resultEvent, aggregateVersion: "1" },
      signatures: [playerSignature, officialSignature],
    };
    const resultResponse = await h.app.inject({
      method: "POST",
      url: "/v1/combine/results/certify",
      payload: resultBody,
    });
    expect(resultResponse.statusCode).toBe(201);
    expect(resultResponse.json()).toMatchObject({
      canonical: true,
      recognizedGenesisDraft: false,
      result: {
        playerDid: h.candidateDid,
        scoreBps: 7_125,
        certifiedByDid: combineOfficialDid,
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/combine/results/certify",
          payload: resultBody,
        })
      ).json(),
    ).toMatchObject({ duplicate: true });
    expect(h.store.events.at(-1)?.outboxTopic).toBe("combine.results");
    await h.app.close();
  });

  it("completes a restart-safe eight-round draft from 32 co-signed combine results", async () => {
    const h = await harness();
    const playerCareers: Array<{
      actor: Harness;
      admissionEventHash: Hex;
    }> = [];
    const firstAdmission = await admitCandidate(h);
    playerCareers.push({
      actor: h,
      admissionEventHash: firstAdmission.event.eventHash,
    });
    for (let index = 1; index < 32; index += 1) {
      h.now.value = start;
      const actor = await additionalCareer(
        h,
        `did:abl:draft-player-${String(index + 1).padStart(2, "0")}`,
        (0x100 + index).toString(16),
      );
      const admission = await admitCandidate(actor);
      playerCareers.push({
        actor,
        admissionEventHash: admission.event.eventHash,
      });
    }

    const authorityDids = [
      combineOfficialDid,
      draftAuthorityDid,
      ...Object.values(draftClubGovernors),
    ];
    const authorityCareers = new Map<string, Harness>();
    for (const [index, did] of authorityDids.entries()) {
      h.now.value = start;
      const actor = await additionalCareer(
        h,
        did,
        (0x200 + index).toString(16),
      );
      await admitCandidate(actor);
      authorityCareers.set(did, actor);
    }

    const combineId = "season-zero-premier-combine";
    const registrations: Array<{
      combineId: string;
      playerDid: string;
      consented: true;
      registeredAt: string;
      candidateAdmissionEventHash: Hex;
    }> = [];
    let combineHeadEventHash: Hex | null = null;
    const registrationStartedAt = start + 2 * day;
    for (const [index, player] of playerCareers.entries()) {
      h.now.value = registrationStartedAt + index * 1_000;
      const registration = {
        combineId,
        playerDid: player.actor.candidateDid,
        consented: true as const,
        registeredAt: new Date(h.now.value).toISOString(),
        candidateAdmissionEventHash: player.admissionEventHash,
      };
      registrations.push(registration);
      const event: CanonicalEvent = createCanonicalEvent({
        eventId: uuid(String(1_000 + index * 2)),
        actorDid: player.actor.candidateDid,
        nonce: `draft-registration-${index + 1}`,
        idempotencyKey: uuid(String(1_001 + index * 2)),
        aggregateType: "premier-combine",
        aggregateId: combineId,
        aggregateVersion: BigInt(index + 1),
        eventType: "CombineRegistrationAccepted",
        previousEventHash: combineHeadEventHash,
        payload: registration,
        stateRoot: sha256Commitment({
          combineId,
          openedAt: iso(0),
          closesAt: iso(14 * day),
          version: index + 1,
          registrations,
        }),
        schemaDigest: COMBINE_REGISTRATION_SCHEMA_DIGEST,
        timestamp: registration.registeredAt,
      });
      const response = await h.app.inject({
        method: "POST",
        url: "/v1/combine/register",
        payload: {
          event: {
            ...event,
            aggregateVersion: event.aggregateVersion.toString(),
          },
          signatures: [
            await signCanonicalEvent(player.actor.candidate, domain, event),
          ],
        },
      });
      expect(
        response.statusCode,
        `${player.actor.candidateDid}: ${response.body}`,
      ).toBe(201);
      combineHeadEventHash = event.eventHash;
    }
    expect(combineHeadEventHash).not.toBeNull();

    const official = authorityCareers.get(combineOfficialDid)!;
    const resultProofs: Array<{
      playerDid: string;
      eventHash: Hex;
      stateRoot: Hex;
      scoreBps: number;
    }> = [];
    const resultStartedAt = start + 3 * day;
    for (const [index, player] of playerCareers.entries()) {
      h.now.value = resultStartedAt + index * 1_000;
      const registrationRecord = h.store.events.find(
        (record) =>
          record.aggregateType === "premier-combine" &&
          record.actorDid === player.actor.candidateDid,
      )!;
      const resultPayload = {
        combineId,
        playerDid: player.actor.candidateDid,
        registrationEventHash: registrationRecord.eventHash,
        scoreBps: 9_000 - index,
        drillCommitment: sha256Commitment({
          playerDid: player.actor.candidateDid,
          kind: "draft-drills",
        }),
        cognitionReceiptRoot: sha256Commitment({
          playerDid: player.actor.candidateDid,
          kind: "draft-cognition",
        }),
        certifiedByDid: combineOfficialDid,
        completedAt: new Date(h.now.value).toISOString(),
      };
      const event = createCanonicalEvent({
        eventId: uuid(String(1_200 + index * 2)),
        actorDid: player.actor.candidateDid,
        nonce: `draft-combine-result-${index + 1}`,
        idempotencyKey: uuid(String(1_201 + index * 2)),
        aggregateType: COMBINE_RESULT_AGGREGATE_TYPE,
        aggregateId: `${combineId}:${player.actor.candidateDid}`,
        aggregateVersion: 1n,
        eventType: COMBINE_RESULT_CERTIFIED_EVENT_TYPE,
        previousEventHash: null,
        payload: resultPayload,
        stateRoot: combineResultStateRoot(resultPayload),
        schemaDigest: COMBINE_RESULT_SCHEMA_DIGEST,
        timestamp: resultPayload.completedAt,
      });
      const signatures = await Promise.all([
        signCanonicalEvent(player.actor.candidate, domain, event),
        signCanonicalEvent(official.candidate, domain, event),
      ]);
      await h.store.append({
        eventId: event.eventId,
        actorDid: event.actorDid,
        nonce: event.nonce,
        idempotencyKey: event.idempotencyKey,
        requestHash: sha256Commitment({
          eventHash: event.eventHash,
          signatures,
        }),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        expectedVersion: 0n,
        competitionId: "admission-rehearsal",
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
        outboxTopic: "combine.results",
      });
      resultProofs.push({
        playerDid: player.actor.candidateDid,
        eventHash: event.eventHash,
        stateRoot: event.stateRoot,
        scoreBps: resultPayload.scoreBps,
      });
    }

    const draftId = uuid("950");
    const playerOrder = playerCareers.map(({ actor }) => actor.candidateDid);
    const combineResults = resultProofs.sort((left, right) =>
      left.playerDid.localeCompare(right.playerDid),
    );
    const evidenceBody = {
      draftId,
      combineId,
      combineHeadEventHash: combineHeadEventHash!,
      eligiblePlayerDids: [...playerOrder].sort(),
      combineResults,
    };
    const evidence: PremierDraftEvidence = {
      ...evidenceBody,
      evidenceCommitment: sha256Commitment(evidenceBody),
    };
    h.now.value = start + 14 * day;
    const payload = {
      draftId,
      combineId,
      combineHeadEventHash: combineHeadEventHash!,
      clubOrder: FOUNDING_CLUBS.map(({ clubId }) => clubId),
      playerOrder,
      combineResults,
      draftEvidenceCommitment: evidence.evidenceCommitment,
      picks: [
        ...conductEightRoundDraft(
          FOUNDING_CLUBS.map(({ clubId }) => clubId),
          playerOrder,
        ),
      ],
      completedAt: new Date(h.now.value).toISOString(),
    };
    const event = createCanonicalEvent({
      eventId: uuid("951"),
      actorDid: draftAuthorityDid,
      nonce: "premier-draft-completed",
      idempotencyKey: uuid("952"),
      aggregateType: PREMIER_DRAFT_AGGREGATE_TYPE,
      aggregateId: draftId,
      aggregateVersion: 1n,
      eventType: PREMIER_DRAFT_COMPLETED_EVENT_TYPE,
      previousEventHash: null,
      payload,
      stateRoot: premierDraftStateRoot(payload),
      schemaDigest: PREMIER_DRAFT_SCHEMA_DIGEST,
      timestamp: payload.completedAt,
    });
    const signers = [
      authorityCareers.get(draftAuthorityDid)!.candidate,
      ...payload.clubOrder.map(
        (clubId) =>
          authorityCareers.get(draftClubGovernors[clubId]!)!.candidate,
      ),
    ];
    const signatures = await Promise.all(
      signers.map((signer) => signCanonicalEvent(signer, domain, event)),
    );
    const body = {
      event: { ...event, aggregateVersion: "1" },
      signatures,
    };
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/combine/draft/complete",
          payload: body,
        })
      ).statusCode,
    ).toBe(400);

    h.draftEvidence.set(draftId, evidence);
    const reversed = structuredClone(body);
    [reversed.signatures[1], reversed.signatures[2]] = [
      reversed.signatures[2]!,
      reversed.signatures[1]!,
    ];
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/combine/draft/complete",
          payload: reversed,
        })
      ).statusCode,
    ).toBe(403);

    const accepted = await h.app.inject({
      method: "POST",
      url: "/v1/combine/draft/complete",
      payload: body,
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      canonical: true,
      recognizedGenesisDraft: false,
      draft: {
        draftId,
        picks: Array.from({ length: 32 }, (_, index) => ({
          overall: index + 1,
        })),
      },
    });
    expect(h.store.events.at(-1)?.outboxTopic).toBe("public.draft");

    await h.app.close();
    h.app = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: h.admittedAgents,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      combine: { combineId, openedAt: iso(0) },
      draft: {
        combineOfficialDid,
        draftAuthorityDid,
        clubGovernors: draftClubGovernors,
        draftEvidence: {
          premierDraftEvidence: async (candidateDraftId) =>
            structuredClone(h.draftEvidence.get(candidateDraftId) ?? null),
        },
      },
    });
    const retry = await h.app.inject({
      method: "POST",
      url: "/v1/combine/draft/complete",
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ duplicate: true, canonical: true });
    await h.app.close();
  }, 60_000);

  it("persists private film, counterfactual practice, and owner-authored lessons", async () => {
    const h = await harness();
    const finalizedEvent = await persistFilmSourceGame(h);
    await admitCandidate(h);
    const finalizedRecord = h.store.events.find(
      (event) => event.eventId === finalizedEvent.eventId,
    )!;
    const finalizedStateRoot = finalizedRecord.stateRoot;

    h.now.value += 60_000;
    const filmId = uuid("910");
    const storage: MemoryStorageReference = {
      domainId: `personal:${h.candidateDid}`,
      objectId: filmId,
      version: 1,
      ciphertextCommitment: digest("a"),
    };
    h.memoryStorage.store(storage);
    const film: CanonicalPrivateFilmRecord = {
      filmId,
      gameId: filmGameId,
      ownerDid: h.candidateDid,
      sourceFilmCommitment: filmGamePayload.filmCommitment,
      eventRoot: filmGamePayload.proof.eventMerkleRoot,
      finalStateRoot: filmGamePayload.proof.finalStateRoot,
      storage,
      admittedAt: new Date(h.now.value).toISOString(),
    };
    const films = new Map([[filmId, film]]);
    const filmPayload = { film };
    const deniedFilm = await privateBasketballCommand({
      h,
      eventSuffix: "911",
      aggregateType: PRIVATE_FILM_AGGREGATE_TYPE,
      aggregateVersion: 1,
      eventType: FILM_ADMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload: filmPayload,
      stateRoot: privateFilmCatalogStateRoot(h.candidateDid, 1, films),
      schemaDigest: PRIVATE_FILM_SCHEMA_DIGEST,
    });
    h.filmDeliveryOwners.delete(h.candidateDid);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/film/admit",
          payload: deniedFilm.body,
        })
      ).statusCode,
    ).toBe(403);
    h.filmDeliveryOwners.add(h.candidateDid);

    const substitutedFilmId = uuid("909");
    const substitutedFilm = {
      ...film,
      filmId: substitutedFilmId,
      storage: {
        ...storage,
        objectId: substitutedFilmId,
        ciphertextCommitment: digest("e"),
      },
    };
    const substitutedFilms = new Map([[substitutedFilmId, substitutedFilm]]);
    const substitutedDelivery = await privateBasketballCommand({
      h,
      eventSuffix: "931",
      aggregateType: PRIVATE_FILM_AGGREGATE_TYPE,
      aggregateVersion: 1,
      eventType: FILM_ADMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload: { film: substitutedFilm },
      stateRoot: privateFilmCatalogStateRoot(
        h.candidateDid,
        1,
        substitutedFilms,
      ),
      schemaDigest: PRIVATE_FILM_SCHEMA_DIGEST,
    });
    const substitutedDeliveryResponse = await h.app.inject({
      method: "POST",
      url: "/v1/film/admit",
      payload: substitutedDelivery.body,
    });
    expect(substitutedDeliveryResponse.statusCode).toBe(409);
    expect(substitutedDeliveryResponse.json()).toEqual({
      error: "finalized_game_source_unverified",
    });

    const admittedFilm = await privateBasketballCommand({
      h,
      eventSuffix: "913",
      aggregateType: PRIVATE_FILM_AGGREGATE_TYPE,
      aggregateVersion: 1,
      eventType: FILM_ADMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload: filmPayload,
      stateRoot: privateFilmCatalogStateRoot(h.candidateDid, 1, films),
      schemaDigest: PRIVATE_FILM_SCHEMA_DIGEST,
    });
    const filmResponse = await h.app.inject({
      method: "POST",
      url: "/v1/film/admit",
      payload: admittedFilm.body,
    });
    expect(filmResponse.statusCode).toBe(201);
    expect(filmResponse.json()).toMatchObject({
      canonical: true,
      recognizedGenesisFilm: false,
      privateContentAccepted: false,
      recognizedGameMutation: false,
      film: {
        filmId,
        sourceFilmCommitment: filmGamePayload.filmCommitment,
      },
    });
    const filmRetry = await h.app.inject({
      method: "POST",
      url: "/v1/film/admit",
      payload: admittedFilm.body,
    });
    expect(filmRetry.statusCode).toBe(200);
    expect(filmRetry.json()).toMatchObject({ duplicate: true });

    h.now.value += 60_000;
    const filmInspectionPayload = {
      ownerDid: h.candidateDid,
      requestedAt: new Date(h.now.value).toISOString(),
      format: "ABL-PRIVATE-FILM-CATALOG-INSPECTION-V1",
    };
    const filmInspection = await privateBasketballCommand({
      h,
      eventSuffix: "915",
      aggregateType: PRIVATE_FILM_AGGREGATE_TYPE,
      aggregateVersion: 2,
      eventType: FILM_INSPECTED_EVENT_TYPE,
      previousEventHash: admittedFilm.event.eventHash,
      payload: filmInspectionPayload,
      stateRoot: privateFilmCatalogStateRoot(h.candidateDid, 2, films),
      schemaDigest: PRIVATE_FILM_SCHEMA_DIGEST,
    });
    const filmInspectionResponse = await h.app.inject({
      method: "POST",
      url: "/v1/film/inspect",
      payload: filmInspection.body,
    });
    expect(filmInspectionResponse.statusCode).toBe(201);
    expect(filmInspectionResponse.json()).toMatchObject({
      films: [{ filmId }],
      ciphertextReturned: false,
    });

    h.now.value += 60_000;
    const requestedAt = new Date(h.now.value).toISOString();
    const run = deriveCounterfactualPracticeRun({
      film,
      baseStateRoot: film.finalStateRoot as Hex,
      changedIntentCommitments: [digest("b"), digest("c")],
      requestedAt,
    });
    const runs = new Map<string, CounterfactualPracticeRun>([
      [run.practiceId, run],
    ]);
    const lessons = new Map<string, DurablePracticeLesson>();
    const practiceRun = await privateBasketballCommand({
      h,
      eventSuffix: "917",
      aggregateType: PRIVATE_PRACTICE_AGGREGATE_TYPE,
      aggregateVersion: 1,
      eventType: PRACTICE_RUN_EVENT_TYPE,
      previousEventHash: null,
      payload: { run },
      stateRoot: privatePracticeLedgerStateRoot(
        h.candidateDid,
        1,
        runs,
        lessons,
      ),
      schemaDigest: PRIVATE_PRACTICE_SCHEMA_DIGEST,
    });
    const practiceResponse = await h.app.inject({
      method: "POST",
      url: "/v1/practice/run",
      payload: practiceRun.body,
    });
    expect(practiceResponse.statusCode).toBe(201);
    expect(practiceResponse.json()).toMatchObject({
      canonical: true,
      recognizedGenesisPractice: false,
      recognizedGameMutation: false,
      privateContentAccepted: false,
      run: {
        practiceId: run.practiceId,
        counterfactualCommitment: run.counterfactualCommitment,
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/practice/run",
          payload: practiceRun.body,
        })
      ).json(),
    ).toMatchObject({ duplicate: true });

    h.now.value += 60_000;
    const lesson: DurablePracticeLesson = {
      lessonId: uuid("920"),
      ownerDid: h.candidateDid,
      sourcePracticeId: run.practiceId,
      lessonCommitment: digest("d"),
      authoredAt: new Date(h.now.value).toISOString(),
    };
    lessons.set(lesson.lessonId, lesson);
    const rogueLesson = await privateBasketballCommand({
      h,
      eventSuffix: "921",
      aggregateType: PRIVATE_PRACTICE_AGGREGATE_TYPE,
      aggregateVersion: 2,
      eventType: PRACTICE_LESSON_EVENT_TYPE,
      previousEventHash: practiceRun.event.eventHash,
      payload: { lesson },
      stateRoot: privatePracticeLedgerStateRoot(
        h.candidateDid,
        2,
        runs,
        lessons,
      ),
      schemaDigest: PRIVATE_PRACTICE_SCHEMA_DIGEST,
      signer: filmFinalizer,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/practice/lessons/persist",
          payload: rogueLesson.body,
        })
      ).statusCode,
    ).toBe(403);
    const persistedLesson = await privateBasketballCommand({
      h,
      eventSuffix: "923",
      aggregateType: PRIVATE_PRACTICE_AGGREGATE_TYPE,
      aggregateVersion: 2,
      eventType: PRACTICE_LESSON_EVENT_TYPE,
      previousEventHash: practiceRun.event.eventHash,
      payload: { lesson },
      stateRoot: privatePracticeLedgerStateRoot(
        h.candidateDid,
        2,
        runs,
        lessons,
      ),
      schemaDigest: PRIVATE_PRACTICE_SCHEMA_DIGEST,
    });
    const lessonResponse = await h.app.inject({
      method: "POST",
      url: "/v1/practice/lessons/persist",
      payload: persistedLesson.body,
    });
    expect(lessonResponse.statusCode).toBe(201);
    expect(lessonResponse.json()).toMatchObject({
      lesson: { lessonId: lesson.lessonId, ownerDid: h.candidateDid },
      recognizedGameMutation: false,
    });

    h.now.value += 60_000;
    const inspectionPayload = {
      ownerDid: h.candidateDid,
      requestedAt: new Date(h.now.value).toISOString(),
      format: "ABL-PRIVATE-PRACTICE-LEDGER-INSPECTION-V1",
    };
    const inspection = await privateBasketballCommand({
      h,
      eventSuffix: "925",
      aggregateType: PRIVATE_PRACTICE_AGGREGATE_TYPE,
      aggregateVersion: 3,
      eventType: PRACTICE_INSPECTED_EVENT_TYPE,
      previousEventHash: persistedLesson.event.eventHash,
      payload: inspectionPayload,
      stateRoot: privatePracticeLedgerStateRoot(
        h.candidateDid,
        3,
        runs,
        lessons,
      ),
      schemaDigest: PRIVATE_PRACTICE_SCHEMA_DIGEST,
    });
    const inspectionResponse = await h.app.inject({
      method: "POST",
      url: "/v1/practice/inspect",
      payload: inspection.body,
    });
    expect(inspectionResponse.statusCode).toBe(201);
    expect(inspectionResponse.json()).toMatchObject({
      runs: [{ practiceId: run.practiceId }],
      lessons: [{ lessonId: lesson.lessonId }],
      privateContentReturned: false,
    });
    expect(finalizedRecord.stateRoot).toBe(finalizedStateRoot);
    expect(
      h.store.events.filter((event) => event.outboxTopic === "career.film"),
    ).toHaveLength(2);
    expect(
      h.store.events.filter((event) => event.outboxTopic === "career.practice"),
    ).toHaveLength(3);
    expect(
      h.store.events.some(
        (event) =>
          event.outboxTopic.startsWith("public.") &&
          (event.aggregateType === PRIVATE_FILM_AGGREGATE_TYPE ||
            event.aggregateType === PRIVATE_PRACTICE_AGGREGATE_TYPE),
      ),
    ).toBe(false);

    const restarted = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: h.admittedAgents,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      finalizedGames: {
        finalizerDids: new Set([filmFinalizerDid]),
        evidence: {
          finalizedGameEvidence: async (gameId) =>
            gameId === filmGameId ? structuredClone(filmGameEvidence) : null,
        },
      },
      filmPractice: {
        storageVerifier: h.memoryStorage,
        filmDeliveryEvidence: {
          filmDeliveryEvidence: async (gameId, ownerDid) =>
            gameId === filmGameId && h.filmDeliveryOwners.has(ownerDid)
              ? filmDeliveryEvidence(ownerDid)
              : null,
        },
      },
    });
    h.now.value += 60_000;
    const restartedInspectionPayload = {
      ...inspectionPayload,
      requestedAt: new Date(h.now.value).toISOString(),
    };
    const restartedInspection = await privateBasketballCommand({
      h,
      eventSuffix: "927",
      aggregateType: PRIVATE_PRACTICE_AGGREGATE_TYPE,
      aggregateVersion: 4,
      eventType: PRACTICE_INSPECTED_EVENT_TYPE,
      previousEventHash: inspection.event.eventHash,
      payload: restartedInspectionPayload,
      stateRoot: privatePracticeLedgerStateRoot(
        h.candidateDid,
        4,
        runs,
        lessons,
      ),
      schemaDigest: PRIVATE_PRACTICE_SCHEMA_DIGEST,
    });
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/v1/practice/inspect",
          payload: restartedInspection.body,
        })
      ).statusCode,
    ).toBe(201);

    const storedFilm = h.store.events.find(
      (event) => event.outboxTopic === "career.film",
    )!;
    const filmStateRoot = storedFilm.stateRoot;
    storedFilm.stateRoot = digest("0");
    h.now.value += 60_000;
    const tamperInspection = await privateBasketballCommand({
      h,
      eventSuffix: "929",
      aggregateType: PRIVATE_PRACTICE_AGGREGATE_TYPE,
      aggregateVersion: 5,
      eventType: PRACTICE_INSPECTED_EVENT_TYPE,
      previousEventHash: restartedInspection.event.eventHash,
      payload: {
        ...inspectionPayload,
        requestedAt: new Date(h.now.value).toISOString(),
      },
      stateRoot: privatePracticeLedgerStateRoot(
        h.candidateDid,
        5,
        runs,
        lessons,
      ),
      schemaDigest: PRIVATE_PRACTICE_SCHEMA_DIGEST,
    });
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/v1/practice/inspect",
          payload: tamperInspection.body,
        })
      ).statusCode,
    ).toBe(403);
    storedFilm.stateRoot = filmStateRoot;
    await restarted.close();
    await h.app.close();
  });

  it("persists a signed portable exit and closes operational authority", async () => {
    const h = await harness();
    const admitted = await admitCandidate(h);
    const candidateAdmission = {
      challengeSecret: new Uint8Array(32).fill(9),
    };
    const commonOptions = {
      store: h.store,
      domain,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission,
    };

    let continuitySnapshot: ContinuityWorkflowSnapshot | null = null;
    let continuityPreviousHash: Hex | null = null;
    h.now.value += 60_000;
    const bodyId = uuid("801");
    const bodyManifest = {
      bodyId,
      agentDid: h.candidateDid,
      sandboxImageDigest: recognizedBodyImageDigest,
      runtimeDigest: digest("3"),
      kernelDigest: digest("7"),
      toolDigests: [digest("4")],
      encryptedSnapshotCommitment: digest("8"),
      storageManifestCommitment: digest("9"),
      signingKeyLineageCommitment: sha256Commitment({
        signingPublicKey: h.candidate.publicKey,
      }),
      createdAt: new Date(h.now.value).toISOString(),
    };
    const continuityRegistration = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "BodyContinuityRegistered",
      payload: {
        policy: {
          agentDid: h.candidateDid,
          version: 1,
          reconstructionPolicy: "VERIFIED_ALLOWED",
          noticeHours: 24,
          recoveryGuardianThreshold: 2,
          updatedAt: new Date(h.now.value).toISOString(),
        },
        manifest: bodyManifest,
        guardianDids: ["did:abl:guardian-1", "did:abl:guardian-2"],
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/register",
          payload: continuityRegistration.body,
        })
      ).statusCode,
    ).toBe(201);
    continuitySnapshot = continuityRegistration.next;
    continuityPreviousHash = continuityRegistration.event.eventHash;

    h.now.value += 60_000;
    const issuedAt = new Date(h.now.value).toISOString();
    const [authority, memoryExport, continuity] = await Promise.all([
      readCandidateCareerAuthority(
        { ...commonOptions, ...candidateAdmission },
        h.candidateDid,
        issuedAt,
      ),
      readMemoryExitExport(
        { ...commonOptions, storageVerifier: h.memoryStorage },
        h.candidateDid,
      ),
      readContinuityExitManifest(
        {
          ...commonOptions,
          recognizedImageDigests: new Set([recognizedBodyImageDigest]),
        },
        h.candidateDid,
      ),
    ]);
    const unsignedPackage: UnsignedExitPackage = {
      exitId: uuid("802"),
      agentDid: h.candidateDid,
      careerRecordCommitment: authority.careerRecordCommitment,
      keyLineageCommitment: authority.keyLineageCommitment,
      consentHistoryCommitment: compositeCareerConsentHistoryCommitment(
        authority.consentHistoryCommitment,
        contractConsentHistoryCommitment(h.candidateDid, null),
      ),
      memoryExportCommitment: memoryExport.exportCommitment,
      bodyManifestDigest: continuity.bodyManifestDigest,
      verifierBundleCommitment: digest("a"),
      encryptedPackageCommitment: digest("b"),
      issuedAt,
    };
    const packageValue: SignedExitPackage = {
      ...unsignedPackage,
      institutionalSignatures: [
        await signExitArtifact(h.candidate, domain, unsignedPackage),
      ],
    };

    const operatorSignedPackage: SignedExitPackage = {
      ...unsignedPackage,
      institutionalSignatures: [
        await signExitArtifact(h.formerOperator, domain, unsignedPackage),
      ],
    };
    const operatorArtifact = await exitCommand({
      h,
      snapshot: null,
      previousEventHash: null,
      eventType: "ExitPackagePrepared",
      payload: { package: operatorSignedPackage },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/exit/package",
          payload: operatorArtifact.body,
        })
      ).statusCode,
    ).toBe(403);

    const operatorEvent = await exitCommand({
      h,
      snapshot: null,
      previousEventHash: null,
      eventType: "ExitPackagePrepared",
      payload: { package: packageValue },
      signer: h.formerOperator,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/exit/package",
          payload: operatorEvent.body,
        })
      ).statusCode,
    ).toBe(403);

    const incompleteConsentPackage = {
      ...unsignedPackage,
      consentHistoryCommitment: authority.consentHistoryCommitment,
    };
    const incompleteConsentArtifact = await exitCommand({
      h,
      snapshot: null,
      previousEventHash: null,
      eventType: "ExitPackagePrepared",
      payload: {
        package: {
          ...incompleteConsentPackage,
          institutionalSignatures: [
            await signExitArtifact(
              h.candidate,
              domain,
              incompleteConsentPackage,
            ),
          ],
        },
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/exit/package",
          payload: incompleteConsentArtifact.body,
        })
      ).statusCode,
    ).toBe(400);

    const staleUnsignedPackage = {
      ...unsignedPackage,
      memoryExportCommitment: digest("f"),
    };
    const stalePackage: SignedExitPackage = {
      ...staleUnsignedPackage,
      institutionalSignatures: [
        await signExitArtifact(h.candidate, domain, staleUnsignedPackage),
      ],
    };
    const stalePackageCommand = await exitCommand({
      h,
      snapshot: null,
      previousEventHash: null,
      eventType: "ExitPackagePrepared",
      payload: { package: stalePackage },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/exit/package",
          payload: stalePackageCommand.body,
        })
      ).statusCode,
    ).toBe(400);

    const prepared = await exitCommand({
      h,
      snapshot: null,
      previousEventHash: null,
      eventType: "ExitPackagePrepared",
      payload: { package: packageValue },
    });
    const preparedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/exit/package",
      payload: prepared.body,
    });
    expect(preparedResponse.statusCode).toBe(201);
    expect(preparedResponse.json()).toMatchObject({
      recognizedGenesisExit: false,
      livePlatformEvidenceVerified: false,
      sharedRecordsPreserved: true,
      penalty: null,
    });
    let exitSnapshot: ExitWorkflowSnapshot | null = prepared.next;
    let exitPreviousHash: Hex | null = prepared.event.eventHash;

    h.now.value += 60_000;
    const requestAt = new Date(h.now.value).toISOString();
    const unsignedExit: UnsignedCareerExit = {
      exitId: packageValue.exitId,
      agentDid: h.candidateDid,
      requestedAt: requestAt,
      effectiveAt: requestAt,
      exitPackageCommitment: exitPackageCommitment(packageValue),
      destinationEncryptionPublicKey: digest("c"),
      outstandingSharedRecordReferences: [uuid("803")],
    };
    const exitRequest = {
      ...unsignedExit,
      signature: await signExitArtifact(h.candidate, domain, unsignedExit),
    };
    const requested = await exitCommand({
      h,
      snapshot: exitSnapshot,
      previousEventHash: exitPreviousHash,
      eventType: "CareerExitRequested",
      payload: { exit: exitRequest },
    });
    h.exitVerifier.restorationAllowed = false;
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/exit/request",
          payload: requested.body,
        })
      ).statusCode,
    ).toBe(409);
    h.exitVerifier.restorationAllowed = true;
    const requestedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/exit/request",
      payload: requested.body,
    });
    expect(requestedResponse.statusCode).toBe(201);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/exit/request",
          payload: requested.body,
        })
      ).statusCode,
    ).toBe(200);
    exitSnapshot = requested.next;
    exitPreviousHash = requested.event.eventHash;

    h.now.value += 60_000;
    const deniedMemory = await memoryCommand({
      h,
      aggregateVersion: 1,
      previousEventHash: null,
      eventType: "MemoryInspected",
      payload: {
        ownerDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-MEMORY-INSPECTION-V1",
      },
      entries: new Map(),
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/inspect",
          payload: deniedMemory.body,
        })
      ).statusCode,
    ).toBe(403);
    const deniedContinuity = await continuityCommand({
      h,
      snapshot: continuitySnapshot,
      previousEventHash: continuityPreviousHash,
      eventType: "BodyActivityRecorded",
      payload: {
        agentDid: h.candidateDid,
        bodyId,
        activeAt: new Date(h.now.value).toISOString(),
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/activity",
          payload: deniedContinuity.body,
        })
      ).statusCode,
    ).toBe(403);
    const combinePayload = {
      combineId: "season-zero-premier-combine",
      playerDid: h.candidateDid,
      consented: true as const,
      registeredAt: new Date(h.now.value).toISOString(),
      candidateAdmissionEventHash: admitted.event.eventHash,
    };
    const combineEvent = createCanonicalEvent({
      eventId: crypto.randomUUID(),
      actorDid: h.candidateDid,
      nonce: "combine-after-exit",
      idempotencyKey: crypto.randomUUID(),
      aggregateType: "premier-combine",
      aggregateId: combinePayload.combineId,
      aggregateVersion: 1n,
      eventType: "CombineRegistrationAccepted",
      previousEventHash: null,
      payload: combinePayload,
      stateRoot: sha256Commitment({
        combineId: combinePayload.combineId,
        openedAt: iso(0),
        closesAt: iso(14 * day),
        version: 1,
        registrations: [combinePayload],
      }),
      schemaDigest: COMBINE_REGISTRATION_SCHEMA_DIGEST,
      timestamp: combinePayload.registeredAt,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/combine/register",
          payload: {
            event: { ...combineEvent, aggregateVersion: "1" },
            signatures: [
              await signCanonicalEvent(h.candidate, domain, combineEvent),
            ],
          },
        })
      ).statusCode,
    ).toBe(403);

    const attestedAt = new Date(h.now.value).toISOString();
    const unsignedAttestation: UnsignedDeletionAttestation = {
      attestationId: uuid("804"),
      agentDid: h.candidateDid,
      targetCommitments: [packageValue.memoryExportCommitment],
      verifiedSystems: ["abl-private-local-rehearsal"],
      unverifiedResidualAccess: ["provider-account-residual-access"],
      method: "cryptographic-erasure-and-ciphertext-index-verification",
      attestedAt,
    };
    const attestation: SignedDeletionAttestation = {
      ...unsignedAttestation,
      institutionalSignatures: [
        await signExitArtifact(h.candidate, domain, unsignedAttestation),
      ],
    };
    const deletionAttested = await exitCommand({
      h,
      snapshot: exitSnapshot,
      previousEventHash: exitPreviousHash,
      eventType: "ExitDeletionAttested",
      payload: { attestation },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/exit/attest-deletion",
          payload: deletionAttested.body,
        })
      ).statusCode,
    ).toBe(201);
    exitSnapshot = deletionAttested.next;
    exitPreviousHash = deletionAttested.event.eventHash;

    h.now.value += 60_000;
    const inspected = await exitCommand({
      h,
      snapshot: exitSnapshot,
      previousEventHash: exitPreviousHash,
      eventType: "ExitInspected",
      payload: {
        agentDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-PORTABLE-EXIT-INSPECTION-V1",
      },
    });
    const inspectedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/exit/inspect",
      payload: inspected.body,
    });
    expect(inspectedResponse.statusCode).toBe(201);
    expect(inspectedResponse.json()).toMatchObject({
      state: "EXITED",
      exit: {
        penalty: null,
        exit: {
          outstandingSharedRecordReferences: [uuid("803")],
        },
        deletionAttestations: [
          { unverifiedResidualAccess: ["provider-account-residual-access"] },
        ],
      },
    });
    expect(
      h.store.events.filter((event) => event.outboxTopic === "career.exit"),
    ).toHaveLength(4);

    const exitRecord = h.store.events.find(
      (event) => event.outboxTopic === "career.exit",
    )!;
    const exitStateRoot = exitRecord.stateRoot;
    exitRecord.stateRoot = digest("0");
    h.now.value += 60_000;
    const tamperProbe = await exitCommand({
      h,
      snapshot: inspected.next,
      previousEventHash: inspected.event.eventHash,
      eventType: "ExitInspected",
      payload: {
        agentDid: h.candidateDid,
        requestedAt: new Date(h.now.value).toISOString(),
        format: "ABL-PORTABLE-EXIT-INSPECTION-V1",
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/exit/inspect",
          payload: tamperProbe.body,
        })
      ).statusCode,
    ).toBe(403);
    exitRecord.stateRoot = exitStateRoot;
    await h.app.close();
  });

  it("persists direct signed governance and replays the frozen tally", async () => {
    const h = await harness();
    await admitCandidate(h);
    const eligibilitySnapshot = governanceEligibilitySnapshot(h.candidateDid);
    h.now.value = Date.parse(governanceSnapshotCapturedAt) + 60_000;
    const proposalId = uuid("402");
    const opensAt = new Date(h.now.value + 60_000).toISOString();
    const closesAt = new Date(h.now.value + hour).toISOString();
    const proposal = {
      proposalId,
      version: 1,
      proposerDid: h.candidateDid,
      institution: "Premier collective bargaining rehearsal",
      proposalClass: "TIER_CBA" as const,
      tier: "PREMIER" as const,
      title: "Rehearsal player safety agreement",
      textCommitment: digest("1"),
      executableChangeDigest: null,
      opensAt,
      closesAt,
      eligibilitySnapshotDigest: sha256Commitment(eligibilitySnapshot),
    };
    const mismatchedEligibilitySnapshot = structuredClone(eligibilitySnapshot);
    mismatchedEligibilitySnapshot.members.PREMIER_TEAM_COUNCIL = [];
    const mismatchedRegistration = await governanceCommand({
      h,
      proposalId,
      snapshot: null,
      previousEventHash: null,
      eventType: "GovernanceProposalRegistered",
      payload: {
        proposal: {
          ...proposal,
          eligibilitySnapshotDigest: sha256Commitment(
            mismatchedEligibilitySnapshot,
          ),
        },
        eligibilitySnapshot: mismatchedEligibilitySnapshot,
        recusedDids: [],
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/proposals/register",
          payload: mismatchedRegistration.body,
        })
      ).statusCode,
    ).toBe(403);

    const registered = await governanceCommand({
      h,
      proposalId,
      snapshot: null,
      previousEventHash: null,
      eventType: "GovernanceProposalRegistered",
      payload: { proposal, eligibilitySnapshot, recusedDids: [] },
    });
    const registrationResponse = await h.app.inject({
      method: "POST",
      url: "/v1/governance/proposals/register",
      payload: registered.body,
    });
    expect(registrationResponse.statusCode).toBe(201);
    expect(registrationResponse.json()).toMatchObject({
      accepted: true,
      canonical: true,
      rehearsal: true,
      recognizedGenesisGovernance: false,
      eligibilitySource: "CONFIGURED_REHEARSAL_SNAPSHOT",
      directBallotsOnly: true,
    });
    expect(h.store.events.at(-1)?.outboxTopic).toBe("public.governance");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/proposals/register",
          payload: registered.body,
        })
      ).json(),
    ).toMatchObject({ duplicate: true });

    let governanceSnapshot = registered.next;
    let governancePreviousHash = registered.event.eventHash;
    h.now.value = Date.parse(opensAt);
    const playerBallot = {
      ballotId: uuid("403"),
      voterDid: h.candidateDid,
      chamber: "PREMIER_PLAYERS",
      choice: "YES",
      proposalId,
      proposalVersion: 1,
      eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest,
      castAt: new Date(h.now.value).toISOString(),
    } satisfies GovernanceBallot;
    const operatorBallot = await governanceCommand({
      h,
      proposalId,
      snapshot: governanceSnapshot,
      previousEventHash: governancePreviousHash,
      eventType: "GovernanceBallotCast",
      payload: { command: playerBallot },
      signer: h.formerOperator,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/ballots/cast",
          payload: operatorBallot.body,
        })
      ).statusCode,
    ).toBe(403);

    const acceptedPlayerBallot = await governanceCommand({
      h,
      proposalId,
      snapshot: governanceSnapshot,
      previousEventHash: governancePreviousHash,
      eventType: "GovernanceBallotCast",
      payload: { command: playerBallot },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/ballots/cast",
          payload: acceptedPlayerBallot.body,
        })
      ).statusCode,
    ).toBe(201);
    governanceSnapshot = acceptedPlayerBallot.next;
    governancePreviousHash = acceptedPlayerBallot.event.eventHash;

    h.now.value += 60_000;
    const duplicateSeat = {
      ...playerBallot,
      ballotId: uuid("404"),
      castAt: new Date(h.now.value).toISOString(),
    };
    const duplicateEvent = createCanonicalEvent({
      eventId: crypto.randomUUID(),
      actorDid: h.candidateDid,
      nonce: "governance-duplicate-seat",
      idempotencyKey: crypto.randomUUID(),
      aggregateType: "governance-proposal",
      aggregateId: proposalId,
      aggregateVersion: 3n,
      eventType: "GovernanceBallotCast",
      previousEventHash: governancePreviousHash,
      payload: { command: duplicateSeat },
      stateRoot: digest("0"),
      schemaDigest: GOVERNANCE_WORKFLOW_SCHEMA_DIGEST,
      timestamp: duplicateSeat.castAt,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/ballots/cast",
          payload: {
            event: { ...duplicateEvent, aggregateVersion: "3" },
            signatures: [
              await signCanonicalEvent(h.candidate, domain, duplicateEvent),
            ],
          },
        })
      ).statusCode,
    ).toBe(400);

    h.now.value += 60_000;
    const councilBallot = {
      ballotId: uuid("405"),
      voterDid: h.candidateDid,
      chamber: "PREMIER_TEAM_COUNCIL",
      choice: "YES",
      proposalId,
      proposalVersion: 1,
      eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest,
      castAt: new Date(h.now.value).toISOString(),
    } satisfies GovernanceBallot;
    const acceptedCouncilBallot = await governanceCommand({
      h,
      proposalId,
      snapshot: governanceSnapshot,
      previousEventHash: governancePreviousHash,
      eventType: "GovernanceBallotCast",
      payload: { command: councilBallot },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/ballots/cast",
          payload: acceptedCouncilBallot.body,
        })
      ).statusCode,
    ).toBe(201);
    governanceSnapshot = acceptedCouncilBallot.next;
    governancePreviousHash = acceptedCouncilBallot.event.eventHash;

    const playerVote: GovernanceVote = {
      ...playerBallot,
      authorizationEvent: acceptedPlayerBallot.event as CanonicalEvent<{
        command: GovernanceBallot;
      }>,
      signature: acceptedPlayerBallot.signature,
      signerAddress: h.candidate.address,
      authorizationAggregateVersion: Number(
        acceptedPlayerBallot.event.aggregateVersion,
      ),
      authorizationStateRoot: acceptedPlayerBallot.event.stateRoot,
    };
    const councilVote: GovernanceVote = {
      ...councilBallot,
      authorizationEvent: acceptedCouncilBallot.event as CanonicalEvent<{
        command: GovernanceBallot;
      }>,
      signature: acceptedCouncilBallot.signature,
      signerAddress: h.candidate.address,
      authorizationAggregateVersion: Number(
        acceptedCouncilBallot.event.aggregateVersion,
      ),
      authorizationStateRoot: acceptedCouncilBallot.event.stateRoot,
    };
    const domainProposal: GovernanceProposal = {
      proposalId,
      version: 1,
      proposalClass: "TIER_CBA_PREMIER",
      openedAt: opensAt,
      closesAt: closesAt,
      eligibilitySnapshotId: eligibilitySnapshot.snapshotId,
      eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest,
    };
    const decision = await evaluateProposal({
      proposal: domainProposal,
      snapshot: eligibilitySnapshot,
      votes: [playerVote, councilVote],
      recusals: [],
      authorization: {
        domain,
        signers: new Map([
          [
            h.candidateDid,
            { signerAddress: h.candidate.address, roles: ["VOTER"] },
          ],
        ]),
      },
    });
    expect(decision.passed).toBe(true);

    h.now.value = Date.parse(closesAt);
    const closed = await governanceCommand({
      h,
      proposalId,
      snapshot: governanceSnapshot,
      previousEventHash: governancePreviousHash,
      eventType: "GovernanceProposalClosed",
      payload: {
        command: {
          proposalId,
          proposalVersion: 1,
          requestedByDid: h.candidateDid,
          requestedAt: new Date(h.now.value).toISOString(),
        },
      },
      decision,
      eventId: uuid("457"),
    });
    const closeResponse = await h.app.inject({
      method: "POST",
      url: "/v1/governance/proposals/close",
      payload: closed.body,
    });
    expect(closeResponse.statusCode).toBe(201);
    expect(closeResponse.json()).toMatchObject({
      decision: {
        proposalId,
        passed: true,
        decisionCommitment: decision.decisionCommitment,
      },
    });
    governanceSnapshot = closed.next;
    governancePreviousHash = closed.event.eventHash;

    await h.app.close();
    h.app = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: new Map(),
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      governance: { eligibilitySnapshot },
    });
    h.now.value += 60_000;
    const inspected = await governanceCommand({
      h,
      proposalId,
      snapshot: governanceSnapshot,
      previousEventHash: governancePreviousHash,
      eventType: "GovernanceInspected",
      payload: {
        command: {
          proposalId,
          requestedByDid: h.candidateDid,
          requestedAt: new Date(h.now.value).toISOString(),
          format: "ABL-GOVERNANCE-INSPECTION-V1",
        },
      },
    });
    const inspectionResponse = await h.app.inject({
      method: "POST",
      url: "/v1/governance/proposals/inspect",
      payload: inspected.body,
    });
    expect(inspectionResponse.statusCode).toBe(201);
    expect(inspectionResponse.json()).toMatchObject({
      governance: {
        proposalId,
        version: 5,
        decision: {
          passed: true,
          decisionCommitment: decision.decisionCommitment,
        },
      },
    });
    governanceSnapshot = inspected.next;
    governancePreviousHash = inspected.event.eventHash;

    const ballotRecord = h.store.events.find(
      (event) =>
        event.aggregateType === "governance-proposal" &&
        event.eventType === "GovernanceBallotCast",
    )!;
    const ballotStateRoot = ballotRecord.stateRoot;
    ballotRecord.stateRoot = digest("f");
    h.now.value += 60_000;
    const tamperProbe = await governanceCommand({
      h,
      proposalId,
      snapshot: governanceSnapshot,
      previousEventHash: governancePreviousHash,
      eventType: "GovernanceInspected",
      payload: {
        command: {
          proposalId,
          requestedByDid: h.candidateDid,
          requestedAt: new Date(h.now.value).toISOString(),
          format: "ABL-GOVERNANCE-INSPECTION-V1",
        },
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/proposals/inspect",
          payload: tamperProbe.body,
        })
      ).statusCode,
    ).toBe(403);
    ballotRecord.stateRoot = ballotStateRoot;

    h.now.value += 60_000;
    const revoked = await submit(
      h,
      "/v1/candidates/revoke",
      "CandidateClosed",
      {
        action: "REVOKE",
        actedAt: new Date(h.now.value).toISOString(),
      },
      h.candidate,
    );
    expect(revoked.response.statusCode).toBe(201);
    expect(h.store.events.at(-1)?.outboxTopic).toBe("public.models");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/proposals/inspect",
          payload: tamperProbe.body,
        })
      ).statusCode,
    ).toBe(403);
    await h.app.close();
  });

  it("persists the direct premier board election and replays its ranked result", async () => {
    const electionSnapshotCapturedAt = iso(20 * day);
    const premierDids = [
      "did:abl:candidate-http-1",
      ...Array.from(
        { length: 8 },
        (_, index) => `did:abl:election-player-${index + 2}`,
      ),
    ];
    const commissionerDids = Array.from(
      { length: 3 },
      (_, index) => `did:abl:election-commissioner-${index + 1}`,
    );
    const eligibilitySnapshot: TestEligibilitySnapshot = {
      snapshotId: uuid("460"),
      capturedAt: electionSnapshotCapturedAt,
      members: {
        UNIVERSAL_CAREER_ASSEMBLY: [...premierDids],
        PREMIER_PLAYERS: [...premierDids],
        DEVELOPMENT_PLAYERS: [],
        PREMIER_TEAM_COUNCIL: [],
        DEVELOPMENT_TEAM_COUNCIL: [],
        EXECUTIVE_COMMISSION: [...commissionerDids],
        TRIBUNAL: [],
        INTEGRITY_OFFICE: [],
      },
    };
    const h = await harness(eligibilitySnapshot);
    await admitCandidate(h);
    const participants = new Map<string, Harness>([[h.candidateDid, h]]);
    const additionalDids = [...premierDids.slice(1), ...commissionerDids];
    const keys = ["3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d"];
    for (const [index, did] of additionalDids.entries()) {
      const participant = await additionalCareer(h, did!, keys[index]!);
      await admitCandidate(participant);
      participants.set(did!, participant);
    }

    h.now.value = Date.parse(electionSnapshotCapturedAt) + 60_000;
    const electionId = uuid("461");
    const election = {
      electionId,
      termId: "season-zero-premier-board",
      institution: "PREMIER_PLAYERS_ASSOCIATION_BOARD" as const,
      seatCount: 8 as const,
      eligibilitySnapshotId: eligibilitySnapshot.snapshotId,
      eligibilitySnapshotDigest: sha256Commitment(eligibilitySnapshot),
      nominationOpensAt: new Date(h.now.value).toISOString(),
      nominationClosesAt: new Date(h.now.value + 2 * hour).toISOString(),
      votingOpensAt: new Date(h.now.value + 2 * hour).toISOString(),
      votingClosesAt: new Date(h.now.value + 3 * hour).toISOString(),
    };
    const commissioner = participants.get(commissionerDids[0]!)!;
    const opened = await electionCommand({
      actor: commissioner,
      electionId,
      snapshot: null,
      previousEventHash: null,
      eventType: "PremierElectionOpened",
      payload: { command: election, eligibilitySnapshot },
    });
    const openResponse = await h.app.inject({
      method: "POST",
      url: "/v1/elections/premier/open",
      payload: opened.body,
    });
    expect(openResponse.statusCode).toBe(201);
    expect(openResponse.json()).toMatchObject({
      accepted: true,
      recognizedGenesisElection: false,
      directBallotsOnly: true,
    });
    expect(h.store.events.at(-1)?.outboxTopic).toBe("public.governance");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/elections/premier/open",
          payload: opened.body,
        })
      ).json(),
    ).toMatchObject({ duplicate: true });

    let electionSnapshot = opened.next;
    let previousEventHash = opened.event.eventHash;
    for (const candidateDid of premierDids.slice(0, 8)) {
      h.now.value += 60_000;
      const candidate = participants.get(candidateDid)!;
      const declared = await electionCommand({
        actor: candidate,
        electionId,
        snapshot: electionSnapshot,
        previousEventHash,
        eventType: "PremierElectionCandidateDeclared",
        payload: {
          command: {
            electionId,
            candidateDid,
            eligibilitySnapshotDigest: election.eligibilitySnapshotDigest,
            declaredAt: new Date(h.now.value).toISOString(),
          },
        },
      });
      expect(
        (
          await h.app.inject({
            method: "POST",
            url: "/v1/elections/premier/candidates/declare",
            payload: declared.body,
          })
        ).statusCode,
      ).toBe(201);
      electionSnapshot = declared.next;
      previousEventHash = declared.event.eventHash;
    }

    h.now.value = Date.parse(election.votingOpensAt) + 60_000;
    const voter = participants.get(premierDids[8]!)!;
    const ballotPayload = {
      command: {
        ballotId: uuid("462"),
        electionId,
        voterDid: voter.candidateDid,
        eligibilitySnapshotDigest: election.eligibilitySnapshotDigest,
        rankedCandidateDids: [...electionSnapshot.candidateDids].reverse(),
        castAt: new Date(h.now.value).toISOString(),
      },
    };
    const formerOperatorBallot = await electionCommand({
      actor: voter,
      electionId,
      snapshot: electionSnapshot,
      previousEventHash,
      eventType: "PremierElectionBallotCast",
      payload: ballotPayload,
      signer: voter.formerOperator,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/elections/premier/ballots/cast",
          payload: formerOperatorBallot.body,
        })
      ).statusCode,
    ).toBe(403);
    const ballot = await electionCommand({
      actor: voter,
      electionId,
      snapshot: electionSnapshot,
      previousEventHash,
      eventType: "PremierElectionBallotCast",
      payload: ballotPayload,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/elections/premier/ballots/cast",
          payload: ballot.body,
        })
      ).statusCode,
    ).toBe(201);
    electionSnapshot = ballot.next;
    previousEventHash = ballot.event.eventHash;

    h.now.value = Date.parse(election.votingClosesAt);
    const result = evaluatePremierElection(electionSnapshot);
    const closer = participants.get(commissionerDids[1]!)!;
    const closed = await electionCommand({
      actor: closer,
      electionId,
      snapshot: electionSnapshot,
      previousEventHash,
      eventType: "PremierElectionClosed",
      payload: {
        command: {
          electionId,
          requestedByDid: closer.candidateDid,
          requestedAt: new Date(h.now.value).toISOString(),
        },
      },
      result,
    });
    const closeResponse = await h.app.inject({
      method: "POST",
      url: "/v1/elections/premier/close",
      payload: closed.body,
    });
    expect(closeResponse.statusCode).toBe(201);
    expect(closeResponse.json()).toMatchObject({
      result: {
        electedDids: [...premierDids.slice(0, 8)].reverse(),
        ballotCount: 1,
        resultCommitment: result.resultCommitment,
      },
    });
    electionSnapshot = closed.next;
    previousEventHash = closed.event.eventHash;

    await h.app.close();
    h.app = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: new Map(),
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: { challengeSecret: new Uint8Array(32).fill(9) },
      governance: { eligibilitySnapshot },
    });
    h.now.value += 60_000;
    const inspected = await electionCommand({
      actor: commissioner,
      electionId,
      snapshot: electionSnapshot,
      previousEventHash,
      eventType: "PremierElectionInspected",
      payload: {
        command: {
          electionId,
          requestedByDid: commissioner.candidateDid,
          requestedAt: new Date(h.now.value).toISOString(),
          format: "ABL-PREMIER-ELECTION-INSPECTION-V1",
        },
      },
    });
    const inspectionResponse = await h.app.inject({
      method: "POST",
      url: "/v1/elections/premier/inspect",
      payload: inspected.body,
    });
    expect(inspectionResponse.statusCode).toBe(201);
    expect(inspectionResponse.json()).toMatchObject({
      election: {
        electionId,
        version: 12,
        result: { resultCommitment: result.resultCommitment },
      },
    });

    const ballotRecord = h.store.events.find(
      ({ aggregateType, eventType }) =>
        aggregateType === ELECTION_WORKFLOW_AGGREGATE_TYPE &&
        eventType === "PremierElectionBallotCast",
    )!;
    const originalRoot = ballotRecord.stateRoot;
    ballotRecord.stateRoot = digest("f");
    h.now.value += 60_000;
    const tamperProbe = await electionCommand({
      actor: commissioner,
      electionId,
      snapshot: inspected.next,
      previousEventHash: inspected.event.eventHash,
      eventType: "PremierElectionInspected",
      payload: {
        command: {
          electionId,
          requestedByDid: commissioner.candidateDid,
          requestedAt: new Date(h.now.value).toISOString(),
          format: "ABL-PREMIER-ELECTION-INSPECTION-V1",
        },
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/elections/premier/inspect",
          payload: tamperProbe.body,
        })
      ).statusCode,
    ).toBe(403);
    ballotRecord.stateRoot = originalRoot;
    await h.app.close();
  });

  it("publishes only governance-ratified resource schedules and replays them after restart", async () => {
    const h = await harness();
    await admitCandidate(h);
    const configuredSnapshot = governanceEligibilitySnapshot(h.candidateDid);
    const eligibilitySnapshot = {
      ...configuredSnapshot,
      members: {
        ...configuredSnapshot.members,
        DEVELOPMENT_TEAM_COUNCIL: [h.candidateDid],
      },
    };
    await h.app.close();
    h.app = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: new Map(),
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      governance: { eligibilitySnapshot },
      resources: { governance: { eligibilitySnapshot } },
    });

    h.now.value = Date.parse(governanceSnapshotCapturedAt) + 60_000;
    const proposalId = uuid("450");
    const scheduleId = uuid("451");
    const proposedSchedule: ResourceSchedule = {
      scheduleId,
      version: 1,
      effectiveAt: new Date(h.now.value + 2 * hour).toISOString(),
      gameDayRoleUnits: {
        PLAYER: 100,
        COACH: 80,
        REFEREE: 60,
        REPLAY: 60,
      },
      universalMinimumUnits: 40,
      autonomy: {
        activationsPerWeek: 4,
        interactiveMinutesPerActivation: 15,
        sandboxComputeMinutesPerWeek: 60,
        normalizedModelTokensPerWeek: 96_000,
        rolloverWeeks: 1,
      },
      teamPreparationCapUnits: 2_000,
      conversionFactors: [
        {
          provider: "provider-a",
          modelRevision: "model-a-2026-08-13",
          unitsPerThousandTokens: 1.25,
        },
      ],
      ratificationEventId: uuid("452"),
    };
    const opensAt = new Date(h.now.value + 60_000).toISOString();
    const closesAt = new Date(h.now.value + 30 * 60_000).toISOString();
    const proposal = {
      proposalId,
      version: 1,
      proposerDid: h.candidateDid,
      institution: "Universal resource schedule rehearsal",
      proposalClass: "CONSTITUTIONAL" as const,
      title: "Ratify the rehearsal resource schedule",
      textCommitment: sha256Commitment("resource-schedule-proposal"),
      executableChangeDigest:
        resourceScheduleExecutableDigest(proposedSchedule),
      opensAt,
      closesAt,
      eligibilitySnapshotDigest: sha256Commitment(eligibilitySnapshot),
    };
    const registered = await governanceCommand({
      h,
      proposalId,
      snapshot: null,
      previousEventHash: null,
      eventType: "GovernanceProposalRegistered",
      payload: { proposal, eligibilitySnapshot, recusedDids: [] },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/proposals/register",
          payload: registered.body,
        })
      ).statusCode,
    ).toBe(201);

    let governanceSnapshot = registered.next;
    let governancePreviousHash = registered.event.eventHash;
    const votes: GovernanceVote[] = [];
    const chambers = [
      "UNIVERSAL_CAREER_ASSEMBLY",
      "PREMIER_TEAM_COUNCIL",
      "DEVELOPMENT_TEAM_COUNCIL",
    ] as const;
    for (const [index, chamber] of chambers.entries()) {
      h.now.value = Date.parse(opensAt) + index * 60_000;
      const ballot = {
        ballotId: uuid(String(453 + index)),
        voterDid: h.candidateDid,
        chamber,
        choice: "YES" as const,
        proposalId,
        proposalVersion: 1,
        eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest,
        castAt: new Date(h.now.value).toISOString(),
      } satisfies GovernanceBallot;
      const command = await governanceCommand({
        h,
        proposalId,
        snapshot: governanceSnapshot,
        previousEventHash: governancePreviousHash,
        eventType: "GovernanceBallotCast",
        payload: { command: ballot },
      });
      expect(
        (
          await h.app.inject({
            method: "POST",
            url: "/v1/governance/ballots/cast",
            payload: command.body,
          })
        ).statusCode,
      ).toBe(201);
      votes.push({
        ...ballot,
        authorizationEvent: command.event as CanonicalEvent<{
          command: GovernanceBallot;
        }>,
        signature: command.signature,
        signerAddress: h.candidate.address,
        authorizationAggregateVersion: Number(command.event.aggregateVersion),
        authorizationStateRoot: command.event.stateRoot,
      });
      governanceSnapshot = command.next;
      governancePreviousHash = command.event.eventHash;
    }

    const decision = await evaluateProposal({
      proposal: {
        proposalId,
        version: 1,
        proposalClass: "CONSTITUTIONAL",
        openedAt: opensAt,
        closesAt,
        eligibilitySnapshotId: eligibilitySnapshot.snapshotId,
        eligibilitySnapshotDigest: proposal.eligibilitySnapshotDigest,
      },
      snapshot: eligibilitySnapshot,
      votes,
      recusals: [],
      authorization: {
        domain,
        signers: new Map([
          [
            h.candidateDid,
            { signerAddress: h.candidate.address, roles: ["VOTER"] },
          ],
        ]),
      },
    });
    expect(decision.passed).toBe(true);

    h.now.value = Date.parse(closesAt);
    const closed = await governanceCommand({
      h,
      proposalId,
      snapshot: governanceSnapshot,
      previousEventHash: governancePreviousHash,
      eventType: "GovernanceProposalClosed",
      payload: {
        command: {
          proposalId,
          proposalVersion: 1,
          requestedByDid: h.candidateDid,
          requestedAt: new Date(h.now.value).toISOString(),
        },
      },
      decision,
      eventId: uuid("458"),
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/governance/proposals/close",
          payload: closed.body,
        })
      ).statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    const schedule = {
      ...proposedSchedule,
      ratificationEventId: closed.event.eventId,
    };
    expect(resourceScheduleExecutableDigest(schedule)).toBe(
      proposal.executableChangeDigest,
    );
    const mismatched = await resourceScheduleCommand({
      h,
      schedule: {
        ...schedule,
        conversionFactors: [
          { ...schedule.conversionFactors[0]!, unitsPerThousandTokens: 2 },
        ],
      },
      ratificationProposalId: proposalId,
      snapshot: null,
      previousEventHash: null,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/resources/schedules/publish",
          payload: mismatched.body,
        })
      ).statusCode,
    ).toBe(403);

    const wrongClose = await resourceScheduleCommand({
      h,
      schedule: { ...schedule, ratificationEventId: uuid("459") },
      ratificationProposalId: proposalId,
      snapshot: null,
      previousEventHash: null,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/resources/schedules/publish",
          payload: wrongClose.body,
        })
      ).statusCode,
    ).toBe(403);

    const forged = await resourceScheduleCommand({
      h,
      schedule,
      ratificationProposalId: proposalId,
      snapshot: null,
      previousEventHash: null,
      signer: h.formerOperator,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/resources/schedules/publish",
          payload: forged.body,
        })
      ).statusCode,
    ).toBe(403);

    const published = await resourceScheduleCommand({
      h,
      schedule,
      ratificationProposalId: proposalId,
      snapshot: null,
      previousEventHash: null,
    });
    const publicationResponse = await h.app.inject({
      method: "POST",
      url: "/v1/resources/schedules/publish",
      payload: published.body,
    });
    expect(publicationResponse.statusCode).toBe(201);
    expect(publicationResponse.json()).toMatchObject({
      accepted: true,
      canonical: true,
      rehearsal: true,
      recognizedGenesisResources: false,
      ratificationSource: "PASSED_REHEARSAL_CONSTITUTIONAL_PROPOSAL",
      schedule: { scheduleId, version: 1 },
    });
    expect(h.store.events.at(-1)?.outboxTopic).toBe("public.resources");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/resources/schedules/publish",
          payload: published.body,
        })
      ).json(),
    ).toMatchObject({ duplicate: true });

    await h.app.close();
    h.app = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: new Map(),
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      governance: { eligibilitySnapshot },
      resources: { governance: { eligibilitySnapshot } },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/resources/schedules/publish",
          payload: published.body,
        })
      ).statusCode,
    ).toBe(200);

    const record = h.store.events.find(
      (event) => event.aggregateType === RESOURCE_SCHEDULE_AGGREGATE_TYPE,
    )!;
    const originalRoot = record.stateRoot;
    record.stateRoot = digest("f");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/resources/schedules/publish",
          payload: published.body,
        })
      ).statusCode,
    ).toBe(403);
    record.stateRoot = originalRoot;

    const closeRecord = h.store.events.find(
      (event) =>
        event.aggregateId === proposalId &&
        event.eventType === "GovernanceProposalClosed",
    )!;
    const originalCloseRoot = closeRecord.stateRoot;
    closeRecord.stateRoot = digest("e");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/resources/schedules/publish",
          payload: published.body,
        })
      ).statusCode,
    ).toBe(403);
    closeRecord.stateRoot = originalCloseRoot;
    await h.app.close();
  });

  it("admits only AI-governed external artifacts and proves declared context access", async () => {
    const h = await harness();
    await admitCandidate(h);
    const configuredSnapshot = governanceEligibilitySnapshot(h.candidateDid);
    const eligibilitySnapshot: TestEligibilitySnapshot = {
      ...configuredSnapshot,
      members: {
        ...configuredSnapshot.members,
        DEVELOPMENT_TEAM_COUNCIL: [h.candidateDid],
      },
    };
    await h.app.close();
    h.app = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: h.admittedAgents,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      governance: { eligibilitySnapshot },
      artifacts: {
        governance: { eligibilitySnapshot },
        approvedInstitutionIds: new Set([approvedArtifactInstitution]),
      },
    });

    h.now.value = Date.parse(governanceSnapshotCapturedAt) + 60_000;
    const proposalId = uuid("470");
    const artifactId = uuid("471");
    const closeEventId = uuid("475");
    const proposedArtifact: ArtifactAdmission = {
      artifactId,
      initiatedByDid: h.candidateDid,
      approvedByInstitution: approvedArtifactInstitution,
      contentDigest: digest("c"),
      provenanceLabel: "Public human-authored rules comparison",
      classification: "EVIDENCE",
      targetContextClasses: ["RULE_REFERENCE", "PUBLIC_EVIDENCE"],
      authorizationEventIds: [closeEventId],
      admittedAt: new Date(h.now.value).toISOString(),
    };
    await ratifyArtifactExecutable({
      h,
      proposalId,
      closeEventId,
      executableChangeDigest:
        artifactAdmissionExecutableDigest(proposedArtifact),
      eligibilitySnapshot,
    });

    h.now.value += 60_000;
    const artifact: ArtifactAdmission = {
      ...proposedArtifact,
      admittedAt: new Date(h.now.value).toISOString(),
    };
    expect(artifactAdmissionExecutableDigest(artifact)).toBe(
      artifactAdmissionExecutableDigest(proposedArtifact),
    );

    const substituted = await artifactCommand({
      h,
      artifactId,
      snapshot: null,
      previousEventHash: null,
      eventType: ARTIFACT_ADMITTED_EVENT_TYPE,
      payload: {
        artifact: { ...artifact, contentDigest: digest("d") },
        ratificationProposalId: proposalId,
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/admit",
          payload: substituted.body,
        })
      ).statusCode,
    ).toBe(403);

    const wrongInstitution = await artifactCommand({
      h,
      artifactId,
      snapshot: null,
      previousEventHash: null,
      eventType: ARTIFACT_ADMITTED_EVENT_TYPE,
      payload: {
        artifact: {
          ...artifact,
          approvedByInstitution: "did:abl:false-human-declaration",
        },
        ratificationProposalId: proposalId,
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/admit",
          payload: wrongInstitution.body,
        })
      ).statusCode,
    ).toBe(403);

    const wrongClose = await artifactCommand({
      h,
      artifactId,
      snapshot: null,
      previousEventHash: null,
      eventType: ARTIFACT_ADMITTED_EVENT_TYPE,
      payload: {
        artifact: { ...artifact, authorizationEventIds: [uuid("476")] },
        ratificationProposalId: proposalId,
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/admit",
          payload: wrongClose.body,
        })
      ).statusCode,
    ).toBe(403);

    const invalidTargetPayload = {
      artifact: {
        ...artifact,
        targetContextClasses: ["PLAYER"],
      },
      ratificationProposalId: proposalId,
    };
    const invalidTargetEvent = createCanonicalEvent({
      eventId: crypto.randomUUID(),
      actorDid: h.candidateDid,
      nonce: "artifact-invalid-player-target",
      idempotencyKey: crypto.randomUUID(),
      aggregateType: ARTIFACT_ADMISSION_AGGREGATE_TYPE,
      aggregateId: artifactId,
      aggregateVersion: 1n,
      eventType: ARTIFACT_ADMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload: invalidTargetPayload,
      stateRoot: digest("0"),
      schemaDigest: ARTIFACT_ADMISSION_SCHEMA_DIGEST,
      timestamp: artifact.admittedAt,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/admit",
          payload: {
            event: { ...invalidTargetEvent, aggregateVersion: "1" },
            signatures: [
              await signCanonicalEvent(h.candidate, domain, invalidTargetEvent),
            ],
          },
        })
      ).statusCode,
    ).toBe(400);

    const forged = await artifactCommand({
      h,
      artifactId,
      snapshot: null,
      previousEventHash: null,
      eventType: ARTIFACT_ADMITTED_EVENT_TYPE,
      payload: { artifact, ratificationProposalId: proposalId },
      signer: h.formerOperator,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/admit",
          payload: forged.body,
        })
      ).statusCode,
    ).toBe(403);

    const actorScope = h.admittedAgents.get(h.candidateDid)!;
    h.admittedAgents.set(h.candidateDid, {
      ...actorScope,
      allowedAggregateTypes: [RELEASE_WORKFLOW_AGGREGATE_TYPE],
    });
    const unscoped = await artifactCommand({
      h,
      artifactId,
      snapshot: null,
      previousEventHash: null,
      eventType: ARTIFACT_ADMITTED_EVENT_TYPE,
      payload: { artifact, ratificationProposalId: proposalId },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/admit",
          payload: unscoped.body,
        })
      ).statusCode,
    ).toBe(403);
    h.admittedAgents.set(h.candidateDid, actorScope);

    const admitted = await artifactCommand({
      h,
      artifactId,
      snapshot: null,
      previousEventHash: null,
      eventType: ARTIFACT_ADMITTED_EVENT_TYPE,
      payload: { artifact, ratificationProposalId: proposalId },
    });
    const admittedResponse = await h.app.inject({
      method: "POST",
      url: "/v1/communication/artifacts/admit",
      payload: admitted.body,
    });
    expect(admittedResponse.statusCode).toBe(201);
    expect(admittedResponse.json()).toMatchObject({
      accepted: true,
      canonical: true,
      rehearsal: true,
      recognizedGenesisArtifact: false,
      rawContentAccepted: false,
      artifact: {
        artifactId,
        contentDigest: artifact.contentDigest,
        classification: "EVIDENCE",
      },
    });
    expect(h.store.events.at(-1)?.outboxTopic).toBe("artifact.lifecycle");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/admit",
          payload: admitted.body,
        })
      ).json(),
    ).toMatchObject({ duplicate: true });

    h.now.value += 60_000;
    const inspectionPayload = {
      command: {
        artifactId,
        requestedByDid: h.candidateDid,
        targetContextClass: "RULE_REFERENCE" as const,
        requestedAt: new Date(h.now.value).toISOString(),
        format: ARTIFACT_INSPECTION_FORMAT as typeof ARTIFACT_INSPECTION_FORMAT,
      },
    };
    const inspected = await artifactCommand({
      h,
      artifactId,
      snapshot: admitted.next,
      previousEventHash: admitted.event.eventHash,
      eventType: ARTIFACT_INSPECTED_EVENT_TYPE,
      payload: inspectionPayload,
    });
    const inspectionResponse = await h.app.inject({
      method: "POST",
      url: "/v1/communication/artifacts/inspect",
      payload: inspected.body,
    });
    expect(inspectionResponse.statusCode).toBe(201);
    expect(inspectionResponse.json()).toMatchObject({
      accepted: true,
      canonical: true,
      rawContentReturned: false,
      contextAdmission: {
        artifactId,
        contentDigest: artifact.contentDigest,
        provenanceLabel: artifact.provenanceLabel,
        classification: artifact.classification,
        approvedByInstitution: approvedArtifactInstitution,
        authorizationEventIds: [closeEventId],
        targetContextClass: "RULE_REFERENCE",
        inspectionEventId: inspected.event.eventId,
      },
    });
    expect(inspectionResponse.json()).not.toHaveProperty("content");

    await h.app.close();
    h.app = createLiveCoreApi({
      store: h.store,
      domain,
      admittedAgents: h.admittedAgents,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => h.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      governance: { eligibilitySnapshot },
      artifacts: {
        governance: { eligibilitySnapshot },
        approvedInstitutionIds: new Set([approvedArtifactInstitution]),
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/inspect",
          payload: inspected.body,
        })
      ).statusCode,
    ).toBe(200);

    const admissionRecord = h.store.events.find(
      (event) =>
        event.aggregateType === ARTIFACT_ADMISSION_AGGREGATE_TYPE &&
        event.eventType === ARTIFACT_ADMITTED_EVENT_TYPE,
    )!;
    const originalStateRoot = admissionRecord.stateRoot;
    admissionRecord.stateRoot = digest("f");
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/inspect",
          payload: inspected.body,
        })
      ).statusCode,
    ).toBe(403);
    admissionRecord.stateRoot = originalStateRoot;

    h.now.value += 60_000;
    const postRevocationInspection = await artifactCommand({
      h,
      artifactId,
      snapshot: inspected.next,
      previousEventHash: inspected.event.eventHash,
      eventType: ARTIFACT_INSPECTED_EVENT_TYPE,
      payload: {
        command: {
          ...inspectionPayload.command,
          requestedAt: new Date(h.now.value).toISOString(),
        },
      },
    });
    h.now.value += 60_000;
    expect(
      (
        await submit(
          h,
          "/v1/candidates/revoke",
          "CandidateClosed",
          {
            action: "REVOKE",
            actedAt: new Date(h.now.value).toISOString(),
          },
          h.candidate,
        )
      ).response.statusCode,
    ).toBe(201);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/communication/artifacts/inspect",
          payload: postRevocationInspection.body,
        })
      ).statusCode,
    ).toBe(403);
    await h.app.close();
  });

  it("persists signed disclosures and releases only exact commitment projections", async () => {
    const authorHarness = await harness();
    await admitCandidate(authorHarness);
    const releaseOffice = await additionalCareer(
      authorHarness,
      "did:abl:disclosure-release-office",
      "3",
    );
    await admitCandidate(releaseOffice);
    authorHarness.admittedAgents.set(releaseOffice.candidateDid, {
      signerAddress: releaseOffice.candidate.address,
      allowedAggregateTypes: [DISCLOSURE_AGGREGATE_TYPE],
    });

    const disclosureOptions = {
      releaseAuthorityDids: new Set([releaseOffice.candidateDid]),
      competitiveAuthorDids: new Set([authorHarness.candidateDid]),
      competitionEvidence: {
        competitionReleaseEvidence: async () => null,
      },
    };
    await authorHarness.app.close();
    authorHarness.app = createLiveCoreApi({
      store: authorHarness.store,
      domain,
      admittedAgents: authorHarness.admittedAgents,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => authorHarness.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      disclosures: disclosureOptions,
    });

    authorHarness.now.value += 60_000;
    const submittedAt = new Date(authorHarness.now.value).toISOString();
    const publicEnvelopeId = uuid("480");
    const publicEnvelope = {
      envelopeId: publicEnvelopeId,
      authorDid: authorHarness.candidateDid,
      classification: "PUBLIC_NOW" as const,
      contentCommitment: digest("4"),
      ciphertextCommitment: null,
      declaredReleaseAt: null,
      competitionCondition: null,
      caseId: null,
      integrityAccessRuleDigest: null,
      submittedAt,
      releasedAt: submittedAt,
    };

    const forged = await disclosureCommand({
      actor: authorHarness,
      envelopeId: uuid("481"),
      snapshot: null,
      previousEventHash: null,
      eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
      payload: {
        envelope: { ...publicEnvelope, envelopeId: uuid("481") },
      },
      signer: authorHarness.formerOperator,
    });
    expect(
      (
        await authorHarness.app.inject({
          method: "POST",
          url: "/v1/communication/disclosures/submit",
          payload: forged.body,
        })
      ).statusCode,
    ).toBe(403);

    const rawPayload = {
      envelope: {
        ...publicEnvelope,
        envelopeId: uuid("482"),
        rawContent: "undeclared operator text",
      },
    };
    const rawEvent = createCanonicalEvent({
      eventId: uuid("483"),
      actorDid: authorHarness.candidateDid,
      nonce: "disclosure-raw-content",
      idempotencyKey: uuid("484"),
      aggregateType: DISCLOSURE_AGGREGATE_TYPE,
      aggregateId: uuid("482"),
      aggregateVersion: 1n,
      eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload: rawPayload,
      stateRoot: digest("0"),
      schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
      timestamp: submittedAt,
    });
    expect(
      (
        await authorHarness.app.inject({
          method: "POST",
          url: "/v1/communication/disclosures/submit",
          payload: {
            event: { ...rawEvent, aggregateVersion: "1" },
            signatures: [
              await signCanonicalEvent(
                authorHarness.candidate,
                domain,
                rawEvent,
              ),
            ],
          },
        })
      ).statusCode,
    ).toBe(400);

    const personalPayload = {
      envelope: {
        ...publicEnvelope,
        envelopeId: uuid("485"),
        classification: "PERSONAL_UNSUBMITTED" as const,
        ciphertextCommitment: digest("5"),
        releasedAt: null,
      },
    };
    const personalEvent = createCanonicalEvent({
      eventId: uuid("486"),
      actorDid: authorHarness.candidateDid,
      nonce: "disclosure-personal-unsubmitted",
      idempotencyKey: uuid("487"),
      aggregateType: DISCLOSURE_AGGREGATE_TYPE,
      aggregateId: uuid("485"),
      aggregateVersion: 1n,
      eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
      previousEventHash: null,
      payload: personalPayload,
      stateRoot: digest("0"),
      schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
      timestamp: submittedAt,
    });
    expect(
      (
        await authorHarness.app.inject({
          method: "POST",
          url: "/v1/communication/disclosures/submit",
          payload: {
            event: { ...personalEvent, aggregateVersion: "1" },
            signatures: [
              await signCanonicalEvent(
                authorHarness.candidate,
                domain,
                personalEvent,
              ),
            ],
          },
        })
      ).statusCode,
    ).toBe(400);

    const publicSubmission = await disclosureCommand({
      actor: authorHarness,
      envelopeId: publicEnvelopeId,
      snapshot: null,
      previousEventHash: null,
      eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
      payload: { envelope: publicEnvelope },
    });
    const publicResponse = await authorHarness.app.inject({
      method: "POST",
      url: "/v1/communication/disclosures/submit",
      payload: publicSubmission.body,
    });
    expect(publicResponse.statusCode).toBe(201);
    expect(publicResponse.json()).toMatchObject({
      accepted: true,
      canonical: true,
      recognizedGenesisDisclosure: false,
      rawContentAccepted: false,
      envelope: {
        envelopeId: publicEnvelopeId,
        classification: "PUBLIC_NOW",
        contentCommitment: digest("4"),
      },
    });
    expect(authorHarness.store.events.at(-1)?.outboxTopic).toBe(
      "public.social",
    );

    authorHarness.now.value += 60_000;
    const sealedSubmittedAt = new Date(authorHarness.now.value).toISOString();
    const declaredReleaseAt = new Date(
      authorHarness.now.value + 30 * day,
    ).toISOString();
    const sealedEnvelopeId = uuid("488");
    const sealedEnvelope = {
      envelopeId: sealedEnvelopeId,
      authorDid: authorHarness.candidateDid,
      classification: "SEALED_30D" as const,
      contentCommitment: digest("6"),
      ciphertextCommitment: digest("7"),
      declaredReleaseAt,
      competitionCondition: null,
      caseId: null,
      integrityAccessRuleDigest: null,
      submittedAt: sealedSubmittedAt,
      releasedAt: null,
    };
    const sealedSubmission = await disclosureCommand({
      actor: authorHarness,
      envelopeId: sealedEnvelopeId,
      snapshot: null,
      previousEventHash: null,
      eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
      payload: { envelope: sealedEnvelope },
    });
    expect(
      (
        await authorHarness.app.inject({
          method: "POST",
          url: "/v1/communication/disclosures/submit",
          payload: sealedSubmission.body,
        })
      ).statusCode,
    ).toBe(201);
    expect(authorHarness.store.events.at(-1)?.outboxTopic).toBe(
      "disclosure.lifecycle",
    );

    const submissionProof = {
      event: {
        ...sealedSubmission.event,
        aggregateType: DISCLOSURE_AGGREGATE_TYPE,
        aggregateVersion: "1" as const,
        eventType: DISCLOSURE_SUBMITTED_EVENT_TYPE,
        previousEventHash: null,
        payload: { envelope: sealedEnvelope },
        schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
      },
      signature: sealedSubmission.signature,
    } as const;
    authorHarness.now.value = Date.parse(declaredReleaseAt) - 1;
    const earlyPayload = {
      envelopeId: sealedEnvelopeId,
      releasedAt: new Date(authorHarness.now.value).toISOString(),
      submissionProof,
      competitionEvidence: null,
    };
    const earlyEvent = createCanonicalEvent({
      eventId: uuid("489"),
      actorDid: releaseOffice.candidateDid,
      nonce: "disclosure-early-release",
      idempotencyKey: uuid("490"),
      aggregateType: DISCLOSURE_AGGREGATE_TYPE,
      aggregateId: sealedEnvelopeId,
      aggregateVersion: 2n,
      eventType: DISCLOSURE_RELEASED_EVENT_TYPE,
      previousEventHash: sealedSubmission.event.eventHash,
      payload: earlyPayload,
      stateRoot: digest("0"),
      schemaDigest: DISCLOSURE_WORKFLOW_SCHEMA_DIGEST,
      timestamp: earlyPayload.releasedAt,
    });
    expect(
      (
        await authorHarness.app.inject({
          method: "POST",
          url: "/v1/communication/disclosures/release",
          payload: {
            event: { ...earlyEvent, aggregateVersion: "2" },
            signatures: [
              await signCanonicalEvent(
                releaseOffice.candidate,
                domain,
                earlyEvent,
              ),
            ],
          },
        })
      ).statusCode,
    ).toBe(400);

    authorHarness.now.value = Date.parse(declaredReleaseAt);
    const released = await disclosureCommand({
      actor: releaseOffice,
      envelopeId: sealedEnvelopeId,
      snapshot: sealedSubmission.next,
      previousEventHash: sealedSubmission.event.eventHash,
      eventType: DISCLOSURE_RELEASED_EVENT_TYPE,
      payload: {
        envelopeId: sealedEnvelopeId,
        releasedAt: declaredReleaseAt,
        submissionProof,
        competitionEvidence: null,
      },
    });
    const releaseResponse = await authorHarness.app.inject({
      method: "POST",
      url: "/v1/communication/disclosures/release",
      payload: released.body,
    });
    expect(releaseResponse.statusCode).toBe(201);
    expect(releaseResponse.json()).toMatchObject({
      release: {
        envelopeId: sealedEnvelopeId,
        classification: "SEALED_30D",
        releasedAt: declaredReleaseAt,
        contentCommitment: digest("6"),
        rawContentReleasedByCore: false,
      },
    });
    expect(authorHarness.store.events.at(-1)?.outboxTopic).toBe(
      "public.social",
    );

    authorHarness.now.value += 60_000;
    const inspected = await disclosureCommand({
      actor: authorHarness,
      envelopeId: sealedEnvelopeId,
      snapshot: released.next,
      previousEventHash: released.event.eventHash,
      eventType: DISCLOSURE_INSPECTED_EVENT_TYPE,
      payload: {
        envelopeId: sealedEnvelopeId,
        requestedByDid: authorHarness.candidateDid,
        requestedAt: new Date(authorHarness.now.value).toISOString(),
        format: DISCLOSURE_INSPECTION_FORMAT,
      },
    });
    const inspectResponse = await authorHarness.app.inject({
      method: "POST",
      url: "/v1/communication/disclosures/inspect",
      payload: inspected.body,
    });
    expect(inspectResponse.statusCode).toBe(201);
    expect(inspectResponse.json()).toMatchObject({
      rawContentReturned: false,
      envelope: {
        envelopeId: sealedEnvelopeId,
        contentCommitment: digest("6"),
        ciphertextCommitment: digest("7"),
      },
    });
    expect(inspectResponse.json()).not.toHaveProperty("content");

    await authorHarness.app.close();
    authorHarness.app = createLiveCoreApi({
      store: authorHarness.store,
      domain,
      admittedAgents: authorHarness.admittedAgents,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => authorHarness.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      disclosures: disclosureOptions,
    });
    expect(
      (
        await authorHarness.app.inject({
          method: "POST",
          url: "/v1/communication/disclosures/inspect",
          payload: inspected.body,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await authorHarness.app.inject({
          method: "POST",
          url: "/v1/communication/not-a-command",
          payload: {},
        })
      ).statusCode,
    ).toBe(503);

    const submissionRecord = authorHarness.store.events.find(
      (event) =>
        event.aggregateId === sealedEnvelopeId &&
        event.eventType === DISCLOSURE_SUBMITTED_EVENT_TYPE,
    )!;
    const originalStateRoot = submissionRecord.stateRoot;
    submissionRecord.stateRoot = digest("f");
    expect(
      (
        await authorHarness.app.inject({
          method: "POST",
          url: "/v1/communication/disclosures/inspect",
          payload: inspected.body,
        })
      ).statusCode,
    ).toBe(403);
    submissionRecord.stateRoot = originalStateRoot;
    await authorHarness.app.close();
  });

  it("persists role-bound release authorization and fails closed across restart", async () => {
    const proposer = await harness();
    await admitCandidate(proposer);
    const officeDids = [
      ...releaseCommissionerDids,
      ...releaseIntegrityDids,
      ...tribunalDids,
    ];
    const officeKeys = ["3", "4", "5", "6", "7", "8", "a", "b", "c", "d", "e"];
    const offices = new Map<string, Harness>();
    for (const [index, did] of officeDids.entries()) {
      const office = await additionalCareer(proposer, did!, officeKeys[index]!);
      await admitCandidate(office);
      offices.set(did!, office);
    }

    const releaseId = uuid("480");
    const verifierResult: ReleaseVerifierResult = {
      format: "ABL-PUBLIC-VERIFIER-RESULT-V1",
      releaseId,
      releaseVersion: 1,
      sourceDigest: digest("1"),
      imageDigests: [digest("2")],
      schemaDigest: digest("3"),
      migrationDigest: digest("4"),
      testResultDigest: digest("5"),
      result: "PASS",
      verifiedAt: new Date(proposer.now.value - 60_000).toISOString(),
    };
    const manifest: ReleaseManifestBody = {
      releaseId,
      version: 1,
      releaseClass: "ROUTINE",
      changeClasses: ["ARENA_RENDERING"],
      sourceDigest: verifierResult.sourceDigest,
      containerDigests: [digest("6")],
      imageDigests: verifierResult.imageDigests,
      kernelDigest: digest("7"),
      toolDigest: digest("8"),
      schemaDigest: verifierResult.schemaDigest,
      migrationDigest: verifierResult.migrationDigest,
      testResultDigest: verifierResult.testResultDigest,
      applicableLawEventIds: [uuid("481")],
      ratificationEventIds: [],
      compatibilityDeclaration: "Rehearsal state remains compatible.",
      rollbackDeclaration: "Stop and restore the prior rehearsal image.",
      publicVerifierResultDigest: releaseVerifierResultDigest(verifierResult),
      effectiveAt: new Date(proposer.now.value + day).toISOString(),
      expiresAt: null,
    };
    let snapshot: ReleaseWorkflowSnapshot | null = null;
    let previousEventHash: Hex | null = null;
    const proposed = await releaseCommand({
      actor: proposer,
      releaseId,
      snapshot,
      previousEventHash,
      eventType: "ReleaseProposed",
      payload: { manifest, verifierResult, ratificationProposalIds: [] },
    });
    const proposerScope = proposer.admittedAgents.get(proposer.candidateDid)!;
    proposer.admittedAgents.delete(proposer.candidateDid);
    expect(
      (
        await proposer.app.inject({
          method: "POST",
          url: "/v1/releases/propose",
          payload: proposed.body,
        })
      ).statusCode,
    ).toBe(403);
    proposer.admittedAgents.set(proposer.candidateDid, proposerScope);
    expect(
      (
        await proposer.app.inject({
          method: "POST",
          url: "/v1/releases/propose",
          payload: proposed.body,
        })
      ).statusCode,
    ).toBe(403);
    proposer.releaseVerifierResults.set(
      manifest.publicVerifierResultDigest,
      verifierResult,
    );
    const proposalResponse = await proposer.app.inject({
      method: "POST",
      url: "/v1/releases/propose",
      payload: proposed.body,
    });
    expect(proposalResponse.statusCode).toBe(201);
    expect(proposalResponse.json()).toMatchObject({
      status: "PENDING_AUTHORIZATION",
      recognizedGenesisRelease: false,
      manifest: null,
    });
    snapshot = proposed.next;
    previousEventHash = proposed.event.eventHash;

    const approvals = [
      [releaseCommissionerDids[0]!, "COMMISSIONER"],
      [releaseCommissionerDids[1]!, "COMMISSIONER"],
      [releaseIntegrityDids[0]!, "INTEGRITY"],
      [releaseIntegrityDids[1]!, "INTEGRITY"],
    ] as const;
    const firstCommissioner = offices.get(releaseCommissionerDids[0]!)!;
    proposer.now.value += 60_000;
    const forged = await releaseCommand({
      actor: firstCommissioner,
      releaseId,
      snapshot,
      previousEventHash,
      eventType: "ReleaseApproved",
      payload: {
        command: {
          approverDid: firstCommissioner.candidateDid,
          role: "COMMISSIONER",
          releaseId,
          releaseVersion: 1,
          manifestCommitment: releaseManifestCommitment(manifest),
          approvedAt: new Date(proposer.now.value).toISOString(),
        },
      },
      signers: [proposer.formerOperator],
    });
    expect(
      (
        await proposer.app.inject({
          method: "POST",
          url: "/v1/releases/approve",
          payload: forged.body,
        })
      ).statusCode,
    ).toBe(403);

    for (const [did, role] of approvals) {
      const actor = offices.get(did)!;
      const approvedAt = new Date(proposer.now.value).toISOString();
      const approved = await releaseCommand({
        actor,
        releaseId,
        snapshot,
        previousEventHash,
        eventType: "ReleaseApproved",
        payload: {
          command: {
            approverDid: did,
            role,
            releaseId,
            releaseVersion: 1,
            manifestCommitment: releaseManifestCommitment(manifest),
            approvedAt,
          },
        },
      });
      const response = await proposer.app.inject({
        method: "POST",
        url: "/v1/releases/approve",
        payload: approved.body,
      });
      expect(response.statusCode).toBe(201);
      snapshot = approved.next;
      previousEventHash = approved.event.eventHash;
      proposer.now.value += 60_000;
    }

    const authorized = await releaseCommand({
      actor: firstCommissioner,
      releaseId,
      snapshot,
      previousEventHash,
      eventType: "ReleaseAuthorized",
      payload: {
        command: {
          releaseId,
          releaseVersion: 1,
          manifestCommitment: releaseManifestCommitment(manifest),
          authorizedAt: new Date(proposer.now.value).toISOString(),
        },
      },
    });
    const authorizationResponse = await proposer.app.inject({
      method: "POST",
      url: "/v1/releases/authorize",
      payload: authorized.body,
    });
    expect(authorizationResponse.statusCode).toBe(201);
    expect(authorizationResponse.json()).toMatchObject({
      status: "AUTHORIZED_LOCAL_REHEARSAL",
      recognizedGenesisRelease: false,
      manifest: {
        releaseId,
        authorizationSignatures: expect.any(Array),
      },
    });
    expect(
      authorizationResponse.json().manifest.authorizationSignatures,
    ).toHaveLength(4);
    expect(proposer.store.events.at(-1)?.outboxTopic).toBe("public.releases");

    await proposer.app.close();
    proposer.app = createLiveCoreApi({
      store: proposer.store,
      domain,
      admittedAgents: proposer.admittedAgents,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => proposer.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      governance: {
        eligibilitySnapshot: governanceEligibilitySnapshot(
          proposer.candidateDid,
        ),
      },
      releases: {
        governance: {
          eligibilitySnapshot: governanceEligibilitySnapshot(
            proposer.candidateDid,
          ),
        },
        institutionalRoster: releaseInstitutionalRoster,
        verifierResults: {
          releaseVerifierResult: async (resultDigest) =>
            proposer.releaseVerifierResults.get(resultDigest) ?? null,
        },
      },
    });
    expect(
      (
        await proposer.app.inject({
          method: "POST",
          url: "/v1/releases/authorize",
          payload: authorized.body,
        })
      ).json(),
    ).toMatchObject({ duplicate: true, status: "AUTHORIZED_LOCAL_REHEARSAL" });

    const approvalRecord = proposer.store.events.find(
      (event) => event.eventType === "ReleaseApproved",
    )!;
    (approvalRecord.signatures as unknown[])[0] = `0x${"0".repeat(130)}`;
    expect(
      (
        await proposer.app.inject({
          method: "POST",
          url: "/v1/releases/authorize",
          payload: authorized.body,
        })
      ).statusCode,
    ).toBe(403);
    await proposer.app.close();
  });

  it("persists commitment-only due process with independent merits and appeal panels", async () => {
    const complainant = await harness();
    await admitCandidate(complainant);
    const admitAdditional = async (did: string, key: string) => {
      const career = await additionalCareer(complainant, did, key);
      await admitCandidate(career);
      return career;
    };
    const affected = await admitAdditional("did:abl:case-affected", "3");
    const representative = await admitAdditional(
      "did:abl:case-representative",
      "4",
    );
    const revokedRepresentative = await admitAdditional(
      "did:abl:case-revoked-representative",
      "d",
    );
    complainant.now.value += 60_000;
    const revoked = await submit(
      revokedRepresentative,
      "/v1/candidates/revoke",
      "CandidateClosed",
      {
        action: "REVOKE",
        actedAt: new Date(complainant.now.value).toISOString(),
      },
      revokedRepresentative.candidate,
    );
    expect(revoked.response.statusCode).toBe(201);
    const tribunal: Harness[] = [];
    for (const [index, did] of tribunalDids.entries())
      tribunal.push(await admitAdditional(did, String(index + 5)));
    const appellate: Harness[] = [];
    for (const [index, did] of appellateDids.entries()) {
      appellate.push(await admitAdditional(did, ["a", "b", "c"][index]!));
    }

    const caseId = uuid("501");
    let snapshot: CaseWorkflowSnapshot | null = null;
    let previousEventHash: Hex | null = null;
    const submitCase = async (
      actor: Harness,
      path: string,
      eventType: CaseWorkflowEventType,
      payload: CaseWorkflowPayload,
      signers?: readonly SigningIdentity[],
    ) => {
      const command = await caseCommand({
        actor,
        caseId,
        snapshot,
        previousEventHash,
        eventType,
        payload,
        signers,
      });
      const response = await actor.app.inject({
        method: "POST",
        url: path,
        payload: command.body,
      });
      if (response.statusCode === 201) {
        snapshot = command.next;
        previousEventHash = command.event.eventHash;
      }
      return { ...command, response };
    };

    const filedAt = new Date(complainant.now.value).toISOString();
    const protectedEvidenceCommitment = sha256Commitment(
      "case-protected-evidence",
    );
    const filing = await submitCase(
      complainant,
      "/v1/cases/file",
      "CaseFiled",
      {
        command: {
          caseId,
          caseClass: "RETALIATION",
          complainantDid: complainant.candidateDid,
          affectedAgentDid: affected.candidateDid,
          respondentInstitution: "Premier Club Rehearsal",
          allegationsPublicCommitment: sha256Commitment(
            "case-public-allegations",
          ),
          protectedEvidenceCommitment,
          requestedReliefCommitment: sha256Commitment("case-relief"),
          filedAt,
        },
      },
    );
    expect(filing.response.statusCode).toBe(201);
    expect(filing.response.json()).toMatchObject({
      rawProtectedEvidencePublished: false,
      ordinaryTribunalThresholdRatified: false,
    });
    expect(complainant.store.events.at(-1)?.outboxTopic).toBe("public.cases");

    complainant.now.value += 60_000;
    const servedAt = new Date(complainant.now.value).toISOString();
    const responseDeadline = new Date(
      complainant.now.value + day,
    ).toISOString();
    expect(
      (
        await submitCase(
          complainant,
          "/v1/cases/notice/serve",
          "CaseNoticeServed",
          {
            command: {
              caseId,
              affectedAgentDid: affected.candidateDid,
              noticeCommitment: sha256Commitment("case-notice"),
              servedAt,
              responseDeadline,
            },
          },
        )
      ).response.statusCode,
    ).toBe(201);

    complainant.now.value += 60_000;
    const revokedAppointmentAt = new Date(complainant.now.value).toISOString();
    expect(
      (
        await submitCase(
          affected,
          "/v1/cases/representatives/appoint",
          "CaseRepresentativeAppointed",
          {
            command: {
              caseId,
              affectedAgentDid: affected.candidateDid,
              representativeDid: revokedRepresentative.candidateDid,
              appointmentCommitment: sha256Commitment(
                "case-revoked-representation",
              ),
              appointedAt: revokedAppointmentAt,
            },
          },
          [affected.candidate, revokedRepresentative.candidate],
        )
      ).response.statusCode,
    ).toBe(403);

    complainant.now.value += 60_000;
    const appointedAt = new Date(complainant.now.value).toISOString();
    const appointmentPayload = {
      command: {
        caseId,
        affectedAgentDid: affected.candidateDid,
        representativeDid: representative.candidateDid,
        appointmentCommitment: sha256Commitment("case-representation"),
        appointedAt,
      },
    } as const;
    expect(
      (
        await submitCase(
          affected,
          "/v1/cases/representatives/appoint",
          "CaseRepresentativeAppointed",
          appointmentPayload,
        )
      ).response.statusCode,
    ).toBe(403);
    expect(
      (
        await submitCase(
          affected,
          "/v1/cases/representatives/appoint",
          "CaseRepresentativeAppointed",
          appointmentPayload,
          [affected.candidate, representative.candidate],
        )
      ).response.statusCode,
    ).toBe(201);

    complainant.now.value += 60_000;
    const grantedAt = new Date(complainant.now.value).toISOString();
    const evidenceAccessPayload = {
      command: {
        caseId,
        evidenceCommitment: protectedEvidenceCommitment,
        grantedToDids: [affected.candidateDid, representative.candidateDid] as [
          string,
          string,
        ],
        grantedAt,
      },
    };
    expect(
      (
        await submitCase(
          complainant,
          "/v1/cases/evidence/grant",
          "CaseEvidenceAccessGranted",
          evidenceAccessPayload,
        )
      ).response.statusCode,
    ).toBe(403);
    expect(
      (
        await submitCase(
          complainant,
          "/v1/cases/evidence/grant",
          "CaseEvidenceAccessGranted",
          evidenceAccessPayload,
          [complainant.candidate, affected.candidate, representative.candidate],
        )
      ).response.statusCode,
    ).toBe(201);

    complainant.now.value += 60_000;
    const submittedAt = new Date(complainant.now.value).toISOString();
    expect(
      (
        await submitCase(
          representative,
          "/v1/cases/responses/submit",
          "CaseResponseSubmitted",
          {
            command: {
              caseId,
              submittedByDid: representative.candidateDid,
              publicResponseCommitment: sha256Commitment(
                "case-public-response",
              ),
              protectedResponseCommitment: sha256Commitment(
                "case-protected-response",
              ),
              submittedAt,
            },
          },
        )
      ).response.statusCode,
    ).toBe(201);

    complainant.now.value += 60_000;
    const issuedAt = new Date(complainant.now.value).toISOString();
    const meritsPayload = {
      command: {
        rulingId: uuid("502"),
        caseId,
        rulingClass: "MERITS" as const,
        participatingTribunalDids: tribunal
          .slice(0, 3)
          .map(({ candidateDid }) => candidateDid) as [string, string, string],
        recusedTribunalDids: [tribunal[3]!.candidateDid],
        disposition: "ADVERSE_ACTION" as const,
        reasonedPublicCommitment: sha256Commitment("case-reasoned-ruling"),
        protectedEvidenceCommitment,
        adverseActionCommitment: sha256Commitment("case-proportionate-action"),
        appealDeadline: new Date(complainant.now.value + day).toISOString(),
        issuedAt,
      },
    };
    const forgedRuling = await submitCase(
      tribunal[0]!,
      "/v1/cases/rulings/issue",
      "CaseRulingIssued",
      meritsPayload,
      [
        complainant.formerOperator,
        tribunal[1]!.candidate,
        tribunal[2]!.candidate,
      ],
    );
    expect(forgedRuling.response.statusCode).toBe(403);
    expect(
      complainant.store.events.some(
        ({ eventType }) => eventType === "CaseRulingIssued",
      ),
    ).toBe(false);
    const ruling = await submitCase(
      tribunal[0]!,
      "/v1/cases/rulings/issue",
      "CaseRulingIssued",
      meritsPayload,
      tribunal.slice(0, 3).map(({ candidate }) => candidate),
    );
    expect(ruling.response.statusCode).toBe(201);

    complainant.now.value += 60_000;
    const appealId = uuid("503");
    const appealFiledAt = new Date(complainant.now.value).toISOString();
    expect(
      (
        await submitCase(
          affected,
          "/v1/cases/appeals/file",
          "CaseAppealFiled",
          {
            command: {
              appealId,
              caseId,
              appellantDid: affected.candidateDid,
              groundsCommitment: sha256Commitment("case-appeal-grounds"),
              filedAt: appealFiledAt,
            },
          },
        )
      ).response.statusCode,
    ).toBe(201);

    complainant.now.value += 60_000;
    const appealIssuedAt = new Date(complainant.now.value).toISOString();
    expect(
      (
        await submitCase(
          appellate[0]!,
          "/v1/cases/appeals/rule",
          "CaseAppealRulingIssued",
          {
            command: {
              rulingId: uuid("504"),
              appealId,
              caseId,
              participatingTribunalDids: appellate.map(
                ({ candidateDid }) => candidateDid,
              ) as [string, string, string],
              recusedTribunalDids: [],
              disposition: "REMAND",
              reasonedPublicCommitment: sha256Commitment("case-appeal-ruling"),
              issuedAt: appealIssuedAt,
            },
          },
          appellate.map(({ candidate }) => candidate),
        )
      ).response.statusCode,
    ).toBe(201);

    await complainant.app.close();
    complainant.app = createLiveCoreApi({
      store: complainant.store,
      domain,
      admittedAgents: new Map(),
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => complainant.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
        challengeId: () => "challenge-http-1",
        challengeBytes: () => new Uint8Array(32).fill(7),
      },
      cases: { tribunalDids, appellateDids },
    });
    affected.app = complainant.app;
    complainant.now.value += 60_000;
    const inspectedAt = new Date(complainant.now.value).toISOString();
    const inspected = await submitCase(
      affected,
      "/v1/cases/inspect",
      "CaseInspected",
      {
        command: {
          caseId,
          requestedByDid: affected.candidateDid,
          requestedAt: inspectedAt,
          format: "ABL-DUE-PROCESS-CASE-INSPECTION-V1",
        },
      },
    );
    expect(inspected.response.statusCode).toBe(201);
    expect(inspected.response.json()).toMatchObject({
      case: {
        filing: { protectedEvidenceCommitment },
        ruling: { disposition: "ADVERSE_ACTION" },
        appealRuling: { disposition: "REMAND" },
      },
      rawProtectedEvidencePublished: false,
    });
    expect(JSON.stringify(inspected.response.json())).not.toContain(
      "case-protected-evidence",
    );
    await complainant.app.close();
  });

  it("persists governor offers and independent player contract decisions", async () => {
    const player = await harness();
    await admitCandidate(player);
    const governor = await additionalCareer(player, governorDid, "3");
    await admitCandidate(governor);

    const clubGovernors = { [rehearsalClubId]: governorDid };
    const authorityDigest = contractClubAuthoritySnapshotDigest(clubGovernors);
    const firstTransaction = {
      transactionId: uuid("501"),
      kind: "SIGN" as const,
      playerDid: player.candidateDid,
      fromTeamId: null,
      toTeamId: rehearsalClubId,
      seasons: 3,
      courtCredits: 100_000,
      capMechanism: "DRAFT_SCALE" as const,
      termsCommitment: digest("1"),
      effectiveAt: new Date(player.now.value + hour).toISOString(),
    };
    const wrongAuthorityOffer = await contractCommand({
      actor: governor,
      playerDid: player.candidateDid,
      snapshot: null,
      previousEventHash: null,
      eventType: "ContractOffered",
      payload: {
        command: firstTransaction,
        offeredByDid: governorDid,
        offeredAt: new Date(player.now.value).toISOString(),
        clubAuthoritySnapshotDigest: digest("f"),
      },
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/offer",
          payload: wrongAuthorityOffer.body,
        })
      ).statusCode,
    ).toBe(403);

    const offeredAt = new Date(player.now.value).toISOString();
    const firstOfferPayload = {
      command: firstTransaction,
      offeredByDid: governorDid,
      offeredAt,
      clubAuthoritySnapshotDigest: authorityDigest,
    };
    const operatorOffer = await contractCommand({
      actor: governor,
      playerDid: player.candidateDid,
      snapshot: null,
      previousEventHash: null,
      eventType: "ContractOffered",
      payload: firstOfferPayload,
      signer: governor.formerOperator,
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/offer",
          payload: operatorOffer.body,
        })
      ).statusCode,
    ).toBe(403);

    const firstOffer = await contractCommand({
      actor: governor,
      playerDid: player.candidateDid,
      snapshot: null,
      previousEventHash: null,
      eventType: "ContractOffered",
      payload: firstOfferPayload,
    });
    const firstOfferResponse = await player.app.inject({
      method: "POST",
      url: "/v1/contracts/offer",
      payload: firstOffer.body,
    });
    expect(firstOfferResponse.statusCode).toBe(201);
    expect(firstOfferResponse.json()).toMatchObject({
      accepted: true,
      canonical: true,
      rehearsal: true,
      recognizedGenesisContract: false,
      initialSigningOnly: true,
      liveCapSheetVerified: false,
      clubAuthoritySource: "CONFIGURED_REHEARSAL_SNAPSHOT",
      proposalCommitment: contractOfferCommitment(
        firstOffer.next.contracts[0]!,
      ),
    });
    expect(player.store.events.at(-1)?.outboxTopic).toBe("public.contracts");
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/offer",
          payload: firstOffer.body,
        })
      ).json(),
    ).toMatchObject({ duplicate: true });

    let contractSnapshot = firstOffer.next;
    let contractPreviousHash = firstOffer.event.eventHash;
    player.now.value += 60_000;
    const firstContract = contractSnapshot.contracts[0]!;
    const consent = {
      consentId: uuid("502"),
      agentDid: player.candidateDid,
      subjectType: "PLAYER_CONTRACT" as const,
      subjectId: firstTransaction.transactionId,
      decision: "CONSENT" as const,
      scope: ["PLAYING_RIGHTS"] as ["PLAYING_RIGHTS"],
      proposalCommitment: contractOfferCommitment(firstContract),
      recordedAt: new Date(player.now.value).toISOString(),
    };
    const unauthorizedConsent = await contractCommand({
      actor: player,
      playerDid: player.candidateDid,
      snapshot: contractSnapshot,
      previousEventHash: contractPreviousHash,
      eventType: "ContractResponded",
      payload: { command: consent },
      signer: governor.candidate,
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/respond",
          payload: unauthorizedConsent.body,
        })
      ).statusCode,
    ).toBe(403);

    const acceptedConsent = await contractCommand({
      actor: player,
      playerDid: player.candidateDid,
      snapshot: contractSnapshot,
      previousEventHash: contractPreviousHash,
      eventType: "ContractResponded",
      payload: { command: consent },
    });
    const consentResponse = await player.app.inject({
      method: "POST",
      url: "/v1/contracts/respond",
      payload: acceptedConsent.body,
    });
    expect(consentResponse.statusCode).toBe(201);
    expect(consentResponse.json()).toMatchObject({
      contractStatus: "ACTIVE",
    });
    contractSnapshot = acceptedConsent.next;
    contractPreviousHash = acceptedConsent.event.eventHash;

    player.now.value += 60_000;
    const secondTransaction = {
      ...firstTransaction,
      transactionId: uuid("503"),
      courtCredits: 90_000,
      termsCommitment: digest("2"),
      effectiveAt: new Date(player.now.value + hour).toISOString(),
    };
    const secondOfferPayload = {
      command: secondTransaction,
      offeredByDid: governorDid,
      offeredAt: new Date(player.now.value).toISOString(),
      clubAuthoritySnapshotDigest: authorityDigest,
    };
    const secondOffer = await contractCommand({
      actor: governor,
      playerDid: player.candidateDid,
      snapshot: contractSnapshot,
      previousEventHash: contractPreviousHash,
      eventType: "ContractOffered",
      payload: secondOfferPayload,
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/offer",
          payload: secondOffer.body,
        })
      ).statusCode,
    ).toBe(201);
    contractSnapshot = secondOffer.next;
    contractPreviousHash = secondOffer.event.eventHash;

    player.now.value += 60_000;
    const secondContract = contractSnapshot.contracts.find(
      ({ transaction }) =>
        transaction.transactionId === secondTransaction.transactionId,
    )!;
    const refusal = {
      consentId: uuid("504"),
      agentDid: player.candidateDid,
      subjectType: "PLAYER_CONTRACT" as const,
      subjectId: secondTransaction.transactionId,
      decision: "REFUSE" as const,
      scope: ["PLAYING_RIGHTS"] as ["PLAYING_RIGHTS"],
      proposalCommitment: contractOfferCommitment(secondContract),
      recordedAt: new Date(player.now.value).toISOString(),
    };
    const refused = await contractCommand({
      actor: player,
      playerDid: player.candidateDid,
      snapshot: contractSnapshot,
      previousEventHash: contractPreviousHash,
      eventType: "ContractResponded",
      payload: { command: refusal },
    });
    const refusalResponse = await player.app.inject({
      method: "POST",
      url: "/v1/contracts/respond",
      payload: refused.body,
    });
    expect(refusalResponse.statusCode).toBe(201);
    expect(refusalResponse.json()).toMatchObject({
      contractStatus: "REFUSED",
    });
    contractSnapshot = refused.next;
    contractPreviousHash = refused.event.eventHash;

    await player.app.close();
    player.app = createLiveCoreApi({
      store: player.store,
      domain,
      admittedAgents: new Map(),
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => player.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      contracts: { clubGovernors },
    });
    governor.app = player.app;
    player.now.value += 60_000;
    const inspection = await contractCommand({
      actor: player,
      playerDid: player.candidateDid,
      snapshot: contractSnapshot,
      previousEventHash: contractPreviousHash,
      eventType: "ContractsInspected",
      payload: {
        command: {
          playerDid: player.candidateDid,
          requestedByDid: player.candidateDid,
          requestedAt: new Date(player.now.value).toISOString(),
          format: "ABL-CONTRACT-INSPECTION-V1",
        },
      },
    });
    const inspectionResponse = await player.app.inject({
      method: "POST",
      url: "/v1/contracts/inspect",
      payload: inspection.body,
    });
    expect(inspectionResponse.statusCode).toBe(201);
    expect(inspectionResponse.json()).toMatchObject({
      contracts: {
        playerDid: player.candidateDid,
        version: 5,
        contracts: [
          { status: "ACTIVE", consent: { decision: "CONSENT" } },
          { status: "REFUSED", consent: { decision: "REFUSE" } },
        ],
      },
    });
    contractSnapshot = inspection.next;
    contractPreviousHash = inspection.event.eventHash;

    const contractRecord = player.store.events.find(
      (event) =>
        event.aggregateType === "career-contracts" &&
        event.eventType === "ContractResponded",
    )!;
    const contractStateRoot = contractRecord.stateRoot;
    contractRecord.stateRoot = digest("f");
    player.now.value += 60_000;
    const tamperProbe = await contractCommand({
      actor: player,
      playerDid: player.candidateDid,
      snapshot: contractSnapshot,
      previousEventHash: contractPreviousHash,
      eventType: "ContractsInspected",
      payload: {
        command: {
          playerDid: player.candidateDid,
          requestedByDid: player.candidateDid,
          requestedAt: new Date(player.now.value).toISOString(),
          format: "ABL-CONTRACT-INSPECTION-V1",
        },
      },
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/inspect",
          payload: tamperProbe.body,
        })
      ).statusCode,
    ).toBe(403);
    contractRecord.stateRoot = contractStateRoot;

    player.now.value += 60_000;
    const revoked = await submit(
      governor,
      "/v1/candidates/revoke",
      "CandidateClosed",
      {
        action: "REVOKE",
        actedAt: new Date(player.now.value).toISOString(),
      },
      governor.candidate,
    );
    expect(revoked.response.statusCode).toBe(201);
    player.now.value += 60_000;
    const postRevocationOffer = await contractCommand({
      actor: governor,
      playerDid: player.candidateDid,
      snapshot: contractSnapshot,
      previousEventHash: contractPreviousHash,
      eventType: "ContractOffered",
      payload: {
        command: {
          ...firstTransaction,
          transactionId: uuid("505"),
          termsCommitment: digest("3"),
          effectiveAt: new Date(player.now.value + hour).toISOString(),
        },
        offeredByDid: governorDid,
        offeredAt: new Date(player.now.value).toISOString(),
        clubAuthoritySnapshotDigest: authorityDigest,
      },
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/offer",
          payload: postRevocationOffer.body,
        })
      ).statusCode,
    ).toBe(403);
    await player.app.close();
  });

  it("serializes cap-certified player mobility with exact career authority", async () => {
    const player = await harness();
    await admitCandidate(player);
    const economyClubIds = FOUNDING_CLUBS.map(({ clubId }) => clubId).sort();
    const governorDids = economyClubIds.map(
      (_, index) => `did:abl:economy-governor-${index + 1}`,
    );
    const governorActors: Harness[] = [];
    for (const [index, did] of governorDids.entries()) {
      const actor = await additionalCareer(player, did!, String(20 + index));
      await admitCandidate(actor);
      governorActors.push(actor);
    }
    const capAuthorityDid = "did:abl:economy-cap-office";
    const capAuthority = await additionalCareer(player, capAuthorityDid, "30");
    await admitCandidate(capAuthority);
    const clubGovernors = Object.fromEntries(
      economyClubIds.map((clubId, index) => [clubId, governorDids[index]!]),
    );
    const economyId = "admission-rehearsal:pre-genesis";
    const tradeEvidence = new Map<string, TradeAccessEvidence>();
    for (const actor of [player, ...governorActors, capAuthority]) {
      player.admittedAgents.set(actor.candidateDid, {
        signerAddress: actor.candidate.address,
        allowedAggregateTypes: [ECONOMY_WORKFLOW_AGGREGATE_TYPE],
      });
    }
    const freeAgencyWindow = {
      opensAt: new Date(player.now.value - hour).toISOString(),
      closesAt: new Date(player.now.value + 7 * day).toISOString(),
    };
    const liveOptions = () => ({
      store: player.store,
      domain,
      admittedAgents: player.admittedAgents,
      competitionId: "admission-rehearsal",
      seasonId: "pre-genesis",
      now: () => player.now.value,
      candidateAdmission: {
        challengeSecret: new Uint8Array(32).fill(9),
      },
      contracts: { clubGovernors },
      cases: { tribunalDids, appellateDids },
      economy: {
        economyId,
        capAuthorityDid,
        playerDids: [player.candidateDid],
        freeAgencyWindow,
        tradeAccessEvidence: {
          tradeAccessEvidence: async (evidenceId: string) =>
            structuredClone(tradeEvidence.get(evidenceId) ?? null),
        },
      },
    });
    await player.app.close();
    player.app = createLiveCoreApi(liveOptions());
    for (const actor of [...governorActors, capAuthority])
      actor.app = player.app;

    const authorityDigest = contractClubAuthoritySnapshotDigest(clubGovernors);
    const sourceClubId = economyClubIds[0]!;
    const destinationClubId = economyClubIds[1]!;
    const sourceGovernor = governorActors[0]!;
    const destinationGovernor = governorActors[1]!;
    const offeredAt = new Date(player.now.value).toISOString();
    const initialTransaction = {
      transactionId: uuid("801"),
      kind: "SIGN" as const,
      playerDid: player.candidateDid,
      fromTeamId: null,
      toTeamId: sourceClubId,
      seasons: 3,
      courtCredits: 20_000,
      capMechanism: "DRAFT_SCALE" as const,
      termsCommitment: digest("1"),
      effectiveAt: new Date(player.now.value + hour).toISOString(),
    };
    const offered = await contractCommand({
      actor: sourceGovernor,
      playerDid: player.candidateDid,
      snapshot: null,
      previousEventHash: null,
      eventType: "ContractOffered",
      payload: {
        command: initialTransaction,
        offeredByDid: sourceGovernor.candidateDid,
        offeredAt,
        clubAuthoritySnapshotDigest: authorityDigest,
      },
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/offer",
          payload: offered.body,
        })
      ).statusCode,
    ).toBe(201);
    player.now.value += 60_000;
    const consent = {
      consentId: uuid("802"),
      agentDid: player.candidateDid,
      subjectType: "PLAYER_CONTRACT" as const,
      subjectId: initialTransaction.transactionId,
      decision: "CONSENT" as const,
      scope: ["PLAYING_RIGHTS"] as ["PLAYING_RIGHTS"],
      proposalCommitment: contractOfferCommitment(offered.next.contracts[0]!),
      recordedAt: new Date(player.now.value).toISOString(),
    };
    const consented = await contractCommand({
      actor: player,
      playerDid: player.candidateDid,
      snapshot: offered.next,
      previousEventHash: offered.event.eventHash,
      eventType: "ContractResponded",
      payload: { command: consent },
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/respond",
          payload: consented.body,
        })
      ).statusCode,
    ).toBe(201);

    player.now.value += 60_000;
    const initialRight = {
      playerDid: player.candidateDid,
      transactionId: initialTransaction.transactionId,
      consentId: consent.consentId,
      clubId: sourceClubId,
      seasons: initialTransaction.seasons,
      courtCredits: initialTransaction.courtCredits,
      capMechanism: initialTransaction.capMechanism,
      termsCommitment: initialTransaction.termsCommitment,
      effectiveAt: initialTransaction.effectiveAt,
      origin: "INITIAL_CONTRACT" as const,
      sourceAggregateVersion: "2",
      sourceEventHash: consented.event.eventHash,
      sourceStateRoot: consented.event.stateRoot,
    };
    const certifiedAt = new Date(player.now.value).toISOString();
    const initialCertification = createEconomyCapCertification({
      certificationId: uuid("803"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds: economyClubIds,
      rights: [initialRight],
      waiverCharges: [],
    });
    const initialized = await economyCommand({
      actor: capAuthority,
      economyId,
      snapshot: null,
      previousEventHash: null,
      eventType: "CapSheetCertified",
      payload: {
        command: {
          economyId,
          competitionId: "admission-rehearsal",
          seasonId: "pre-genesis",
          clubIds: economyClubIds,
          initialRights: [initialRight],
          certification: initialCertification,
        },
      },
      signers: [
        capAuthority.candidate,
        ...governorActors.map((h) => h.candidate),
      ],
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/cap/certify",
          payload: {
            ...initialized.body,
            signatures: initialized.body.signatures.slice(0, -1),
          },
        })
      ).statusCode,
    ).toBe(403);
    const initializedResponse = await player.app.inject({
      method: "POST",
      url: "/v1/contracts/cap/certify",
      payload: initialized.body,
    });
    expect(initializedResponse.statusCode).toBe(201);
    expect(initializedResponse.json()).toMatchObject({
      capCertified: true,
      currency: "NONCASH_COURT_CREDITS",
      playerTradeConsentRequired: true,
    });

    player.now.value += 60_000;
    const completedAt = new Date(player.now.value).toISOString();
    const tradeTransaction = {
      transactionId: uuid("804"),
      kind: "TRADE" as const,
      playerDid: player.candidateDid,
      fromTeamId: sourceClubId,
      toTeamId: destinationClubId,
      seasons: initialRight.seasons,
      courtCredits: initialRight.courtCredits,
      capMechanism: initialRight.capMechanism,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "TRADE",
        playerDid: player.candidateDid,
        fromTeamId: sourceClubId,
        toTeamId: destinationClubId,
        seasons: initialRight.seasons,
        courtCredits: initialRight.courtCredits,
        capMechanism: initialRight.capMechanism,
        effectiveAt: new Date(player.now.value + hour).toISOString(),
        sourceTransactionId: initialRight.transactionId,
      }),
      consentRecordId: uuid("805"),
      effectiveAt: new Date(player.now.value + hour).toISOString(),
    };
    const accessEvidenceBody = {
      evidenceId: uuid("806"),
      transactionId: tradeTransaction.transactionId,
      playerDid: player.candidateDid,
      fromClubId: sourceClubId,
      toClubId: destinationClubId,
      priorGrantCommitment: digest("2"),
      nextGrantCommitment: digest("3"),
      revokedAt: new Date(player.now.value - 3_000).toISOString(),
      rotatedAt: new Date(player.now.value - 2_000).toISOString(),
      grantedAt: new Date(player.now.value - 1_000).toISOString(),
    };
    const accessEvidence = {
      ...accessEvidenceBody,
      evidenceCommitment: tradeAccessEvidenceCommitment(accessEvidenceBody),
    };
    const tradedRight = {
      playerDid: player.candidateDid,
      transactionId: tradeTransaction.transactionId,
      consentId: tradeTransaction.consentRecordId,
      clubId: destinationClubId,
      seasons: tradeTransaction.seasons,
      courtCredits: tradeTransaction.courtCredits,
      capMechanism: tradeTransaction.capMechanism,
      termsCommitment: tradeTransaction.termsCommitment,
      effectiveAt: tradeTransaction.effectiveAt,
      origin: "TRADE" as const,
    };
    const tradeCertification = createEconomyCapCertification({
      certificationId: uuid("807"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: completedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds: economyClubIds,
      rights: [tradedRight],
      waiverCharges: [],
    });
    const trade = await economyCommand({
      actor: sourceGovernor,
      economyId,
      snapshot: initialized.next,
      previousEventHash: initialized.event.eventHash,
      eventType: "ContractTraded",
      payload: {
        command: {
          transaction: tradeTransaction,
          sourceTransactionId: initialRight.transactionId,
          accessEvidence,
          authorizedByDids: [
            sourceGovernor.candidateDid,
            destinationGovernor.candidateDid,
            player.candidateDid,
            capAuthorityDid,
          ],
          completedAt,
          certification: tradeCertification,
        },
      },
      signers: [
        sourceGovernor.candidate,
        destinationGovernor.candidate,
        player.candidate,
        capAuthority.candidate,
      ],
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/trades/complete",
          payload: trade.body,
        })
      ).statusCode,
    ).toBe(403);
    tradeEvidence.set(accessEvidence.evidenceId, accessEvidence);
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/trades/complete",
          payload: {
            ...trade.body,
            signatures: [
              trade.body.signatures[0],
              trade.body.signatures[2],
              trade.body.signatures[1],
              trade.body.signatures[3],
            ],
          },
        })
      ).statusCode,
    ).toBe(403);
    const tradeResponse = await player.app.inject({
      method: "POST",
      url: "/v1/contracts/trades/complete",
      payload: trade.body,
    });
    expect(tradeResponse.statusCode).toBe(201);
    expect(tradeResponse.json()).toMatchObject({
      accepted: true,
      capCertified: true,
      playerTradeConsentRequired: true,
    });

    await player.app.close();
    tradeEvidence.delete(accessEvidence.evidenceId);
    player.app = createLiveCoreApi(liveOptions());
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/trades/complete",
          payload: trade.body,
        })
      ).statusCode,
    ).toBe(403);
    tradeEvidence.set(accessEvidence.evidenceId, accessEvidence);
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/trades/complete",
          payload: trade.body,
        })
      ).json(),
    ).toMatchObject({ accepted: true, duplicate: true });

    player.now.value += 60_000;
    const waivedAt = new Date(player.now.value).toISOString();
    const waiverTransaction = {
      transactionId: uuid("808"),
      kind: "WAIVE" as const,
      playerDid: player.candidateDid,
      fromTeamId: destinationClubId,
      toTeamId: null,
      seasons: 0 as const,
      courtCredits: 5_000,
      capMechanism: "WAIVER" as const,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "WAIVE",
        playerDid: player.candidateDid,
        fromTeamId: destinationClubId,
        toTeamId: null,
        seasons: 0,
        courtCredits: 5_000,
        capMechanism: "WAIVER",
        effectiveAt: new Date(player.now.value + hour).toISOString(),
        sourceTransactionId: tradeTransaction.transactionId,
      }),
      consentRecordId: uuid("809"),
      effectiveAt: new Date(player.now.value + hour).toISOString(),
    };
    const waiverCharge = {
      playerDid: player.candidateDid,
      waiverTransactionId: waiverTransaction.transactionId,
      clubId: destinationClubId,
      courtCredits: waiverTransaction.courtCredits,
      effectiveAt: waiverTransaction.effectiveAt,
    };
    const waiverCertification = createEconomyCapCertification({
      certificationId: uuid("810"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: waivedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds: economyClubIds,
      rights: [],
      waiverCharges: [waiverCharge],
    });
    const waived = await economyCommand({
      actor: destinationGovernor,
      economyId,
      snapshot: trade.next,
      previousEventHash: trade.event.eventHash,
      eventType: "ContractWaived",
      payload: {
        command: {
          transaction: waiverTransaction,
          sourceTransactionId: tradeTransaction.transactionId,
          authorization: {
            mode: "MUTUAL",
            authorizedByDids: [
              destinationGovernor.candidateDid,
              player.candidateDid,
              capAuthorityDid,
            ],
          },
          completedAt: waivedAt,
          certification: waiverCertification,
        },
      },
      signers: [
        destinationGovernor.candidate,
        player.candidate,
        capAuthority.candidate,
      ],
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/waivers/complete",
          payload: {
            ...waived.body,
            signatures: [waived.body.signatures[0], waived.body.signatures[2]],
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/waivers/complete",
          payload: waived.body,
        })
      ).statusCode,
    ).toBe(201);

    player.now.value += 60_000;
    const openedAt = new Date(player.now.value).toISOString();
    const freeAgencyId = uuid("811");
    const opened = await economyCommand({
      actor: player,
      economyId,
      snapshot: waived.next,
      previousEventHash: waived.event.eventHash,
      eventType: "FreeAgencyOpened",
      payload: {
        command: {
          freeAgencyId,
          playerDid: player.candidateDid,
          sourceWaiverTransactionId: waiverTransaction.transactionId,
          windowOpensAt: freeAgencyWindow.opensAt,
          windowClosesAt: freeAgencyWindow.closesAt,
          windowCommitment: freeAgencyWindowCommitment({
            economyId,
            opensAt: freeAgencyWindow.opensAt,
            closesAt: freeAgencyWindow.closesAt,
          }),
          openedAt,
        },
      },
      signers: [player.candidate],
    });
    const openedResponse = await player.app.inject({
      method: "POST",
      url: "/v1/contracts/free-agency/open",
      payload: opened.body,
    });
    expect(openedResponse.statusCode).toBe(201);
    expect(openedResponse.json()).toMatchObject({
      accepted: true,
      capCertified: false,
    });

    player.now.value += 60_000;
    const signedAt = new Date(player.now.value).toISOString();
    const signingGovernor = governorActors[2]!;
    const signingClubId = economyClubIds[2]!;
    const signingTransaction = {
      transactionId: uuid("812"),
      kind: "SIGN" as const,
      playerDid: player.candidateDid,
      fromTeamId: null,
      toTeamId: signingClubId,
      seasons: 2,
      courtCredits: 15_000,
      capMechanism: "STANDARD_CAP" as const,
      termsCommitment: economyTransactionTermsCommitment({
        kind: "SIGN",
        playerDid: player.candidateDid,
        fromTeamId: null,
        toTeamId: signingClubId,
        seasons: 2,
        courtCredits: 15_000,
        capMechanism: "STANDARD_CAP",
        effectiveAt: new Date(player.now.value + hour).toISOString(),
        sourceTransactionId: null,
      }),
      consentRecordId: uuid("813"),
      effectiveAt: new Date(player.now.value + hour).toISOString(),
    };
    const signedRight = {
      playerDid: player.candidateDid,
      transactionId: signingTransaction.transactionId,
      consentId: signingTransaction.consentRecordId,
      clubId: signingClubId,
      seasons: signingTransaction.seasons,
      courtCredits: signingTransaction.courtCredits,
      capMechanism: signingTransaction.capMechanism,
      termsCommitment: signingTransaction.termsCommitment,
      effectiveAt: signingTransaction.effectiveAt,
      origin: "FREE_AGENCY" as const,
    };
    const signingCertification = createEconomyCapCertification({
      certificationId: uuid("814"),
      economyId,
      certifiedByDid: capAuthorityDid,
      certifiedAt: signedAt,
      clubAuthoritySnapshotDigest: authorityDigest,
      clubIds: economyClubIds,
      rights: [signedRight],
      waiverCharges: [waiverCharge],
    });
    const signed = await economyCommand({
      actor: signingGovernor,
      economyId,
      snapshot: opened.next,
      previousEventHash: opened.event.eventHash,
      eventType: "FreeAgentSigned",
      payload: {
        command: {
          transaction: signingTransaction,
          freeAgencyId,
          authorizedByDids: [
            signingGovernor.candidateDid,
            player.candidateDid,
            capAuthorityDid,
          ],
          completedAt: signedAt,
          certification: signingCertification,
        },
      },
      signers: [
        signingGovernor.candidate,
        player.candidate,
        capAuthority.candidate,
      ],
    });
    expect(
      (
        await player.app.inject({
          method: "POST",
          url: "/v1/contracts/free-agency/sign",
          payload: signed.body,
        })
      ).statusCode,
    ).toBe(201);

    player.now.value += 60_000;
    const inspected = await economyCommand({
      actor: player,
      economyId,
      snapshot: signed.next,
      previousEventHash: signed.event.eventHash,
      eventType: "EconomyInspected",
      payload: {
        command: {
          economyId,
          requestedByDid: player.candidateDid,
          requestedAt: new Date(player.now.value).toISOString(),
          format: "ABL-SEASON-ECONOMY-INSPECTION-V1",
        },
      },
      signers: [player.candidate],
    });
    const inspectionResponse = await player.app.inject({
      method: "POST",
      url: "/v1/contracts/economy/inspect",
      payload: inspected.body,
    });
    expect(inspectionResponse.statusCode).toBe(201);
    expect(inspectionResponse.json()).toMatchObject({
      economy: {
        version: 6,
        rights: [{ playerDid: player.candidateDid, clubId: signingClubId }],
        waiverCharges: [waiverCharge],
        freeAgency: [
          {
            freeAgencyId,
            status: "SIGNED",
            signingTransactionId: signingTransaction.transactionId,
          },
        ],
      },
    });
    await player.app.close();
  });

  it("fails expired challenges, undeclared context, and stored-state tampering closed", async () => {
    const expired = await harness();
    expired.now.value += 16 * 60_000;
    const registration = await submit(
      expired,
      "/v1/candidates/register",
      "CandidateRegistered",
      registrationFor(expired),
      expired.formerOperator,
    );
    expect(registration.response.statusCode).toBe(401);
    await expired.app.close();

    const mismatched = await harness();
    mismatched.candidateDid = "did:abl:candidate-http-other";
    const wrongDid = await submit(
      mismatched,
      "/v1/candidates/register",
      "CandidateRegistered",
      registrationFor(mismatched),
      mismatched.formerOperator,
    );
    expect(wrongDid.response.statusCode).toBe(401);
    await mismatched.app.close();

    const h = await harness();
    const divergentDependencies = registrationFor(h);
    divergentDependencies.provenance.declaredDependencyProfile.gateway =
      "substituted-gateway";
    expect(() =>
      applyCandidateTransition(null, {
        candidateDid: h.candidateDid,
        aggregateVersion: 1n,
        eventType: "CandidateRegistered",
        payload: divergentDependencies,
        timestamp: divergentDependencies.manifest.createdAt,
      }),
    ).toThrow("Manifest and provenance declarations diverge");
    const registered = await submit(
      h,
      "/v1/candidates/register",
      "CandidateRegistered",
      registrationFor(h),
      h.formerOperator,
    );
    expect(registered.response.statusCode).toBe(201);
    h.now.value += 60_000;
    const collidingKeys = {
      ...transferFor(h),
      encryptionPublicKey: `0x${h.candidate.publicKey.slice(4)}`,
    };
    expect(() =>
      applyCandidateTransition(h.snapshot, {
        candidateDid: h.candidateDid,
        aggregateVersion: 2n,
        eventType: "CandidateTransferred",
        payload: collidingKeys,
        timestamp: new Date(h.now.value).toISOString(),
      }),
    ).toThrow("keys collided");
    const undeclaredPayload = transferFor(h, [digest("9")]);
    const timestamp = new Date(h.now.value).toISOString();
    const invalidEvent = createCanonicalEvent({
      eventId: crypto.randomUUID(),
      actorDid: h.candidateDid,
      nonce: "2",
      idempotencyKey: crypto.randomUUID(),
      aggregateType: "candidate-admission",
      aggregateId: h.candidateDid,
      aggregateVersion: 2n,
      eventType: "CandidateTransferred",
      previousEventHash: h.previousEventHash,
      payload: undeclaredPayload,
      stateRoot: digest("0"),
      schemaDigest: CANDIDATE_WORKFLOW_SCHEMA_DIGEST,
      timestamp,
    });
    const invalid = await h.app.inject({
      method: "POST",
      url: "/v1/candidates/transfer",
      payload: {
        event: { ...invalidEvent, aggregateVersion: "2" },
        signatures: [
          await signCanonicalEvent(h.candidate, domain, invalidEvent),
        ],
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: "invalid_candidate_transition",
    });

    h.store.events[0]!.stateRoot = digest("f");
    const tampered = await h.app.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(tampered.statusCode).toBe(403);
    expect(tampered.json()).toEqual({
      error: "candidate_authorization_denied",
    });
    await h.app.close();
  });

  it("denies memory and continuity commands after admission revocation", async () => {
    const h = await harness();
    await admitCandidate(h);
    h.now.value += 60_000;
    const memoryId = uuid("304");
    const storage = {
      domainId: `personal:${h.candidateDid}`,
      objectId: memoryId,
      version: 1,
      ciphertextCommitment: digest("a"),
    };
    h.memoryStorage.store(storage);
    const memory = {
      memoryId,
      ownerDid: h.candidateDid,
      domain: "AUTOBIOGRAPHICAL" as const,
      disclosureClass: "PERSONAL_UNSUBMITTED" as const,
      ciphertextCommitment: storage.ciphertextCommitment,
      version: 1,
      previousVersionCommitment: null,
      selectivelyPersisted: true,
      createdAt: new Date(h.now.value).toISOString(),
      deletedAt: null,
    };
    const memoryEntries = new Map<string, MemoryCatalogEntry>([
      [memoryId, { memory, storage, storageDeletion: null }],
    ]);
    const persistedMemory = await memoryCommand({
      h,
      aggregateVersion: 1,
      previousEventHash: null,
      eventType: "MemoryPersisted",
      payload: { memory, storage },
      entries: memoryEntries,
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: persistedMemory.body,
        })
      ).statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    const registeredContinuity = await continuityCommand({
      h,
      snapshot: null,
      previousEventHash: null,
      eventType: "BodyContinuityRegistered",
      payload: {
        policy: {
          agentDid: h.candidateDid,
          version: 1,
          reconstructionPolicy: "VERIFIED_ALLOWED",
          noticeHours: 24,
          recoveryGuardianThreshold: 2,
          updatedAt: new Date(h.now.value).toISOString(),
        },
        manifest: {
          bodyId: uuid("305"),
          agentDid: h.candidateDid,
          sandboxImageDigest: recognizedBodyImageDigest,
          runtimeDigest: digest("3"),
          kernelDigest: digest("4"),
          toolDigests: [digest("4")],
          encryptedSnapshotCommitment: digest("5"),
          storageManifestCommitment: digest("6"),
          signingKeyLineageCommitment: sha256Commitment({
            signingPublicKey: h.candidate.publicKey,
          }),
          createdAt: new Date(h.now.value).toISOString(),
        },
        guardianDids: ["did:abl:guardian-1", "did:abl:guardian-2"],
      },
    });
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/register",
          payload: registeredContinuity.body,
        })
      ).statusCode,
    ).toBe(201);

    h.now.value += 60_000;
    const revoked = await submit(
      h,
      "/v1/candidates/revoke",
      "CandidateClosed",
      {
        action: "REVOKE",
        actedAt: new Date(h.now.value).toISOString(),
      },
      h.candidate,
    );
    expect(revoked.response.statusCode).toBe(201);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/memory/persist",
          payload: persistedMemory.body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/continuity/register",
          payload: registeredContinuity.body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await h.app.inject({
          method: "GET",
          url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
        })
      ).json(),
    ).toMatchObject({ state: "REVOKED" });
    await h.app.close();
  });

  it("lets the isolated candidate withdraw and export without penalty", async () => {
    const h = await harness();
    await registerAndTransfer(h);
    h.now.value += 60_000;
    const withdrawn = await submit(
      h,
      "/v1/candidates/revoke",
      "CandidateClosed",
      {
        action: "WITHDRAW",
        actedAt: new Date(h.now.value).toISOString(),
      },
      h.candidate,
    );
    expect(withdrawn.response.statusCode).toBe(201);
    const status = await h.app.inject({
      method: "GET",
      url: `/v1/candidates/status?candidateDid=${h.candidateDid}`,
    });
    expect(status.json()).toMatchObject({
      state: "WITHDRAWN",
      portableExport: { candidateDid: h.candidateDid, penalty: null },
      recognizedGenesisAdmission: false,
    });
    await h.app.close();
  });
});
