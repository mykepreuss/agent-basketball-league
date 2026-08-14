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
import { InMemoryCanonicalStore } from "@abl/database";
import {
  ARTIFACT_ADMISSION_AGGREGATE_TYPE,
  ARTIFACT_ADMISSION_SCHEMA_DIGEST,
  ARTIFACT_ADMITTED_EVENT_TYPE,
  ARTIFACT_INSPECTED_EVENT_TYPE,
  ARTIFACT_INSPECTION_FORMAT,
  CASE_WORKFLOW_SCHEMA_DIGEST,
  RELEASE_WORKFLOW_AGGREGATE_TYPE,
  RELEASE_WORKFLOW_SCHEMA_DIGEST,
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  applyArtifactAdmissionTransition,
  applyCaseWorkflowTransition,
  applyResourceScheduleTransition,
  applyReleaseWorkflowTransition,
  caseWorkflowStateRoot,
  evaluateProposal,
  artifactAdmissionExecutableDigest,
  artifactAdmissionStateRoot,
  resourceScheduleExecutableDigest,
  resourceScheduleStateRoot,
  releaseManifestCommitment,
  releaseVerifierResultDigest,
  releaseWorkflowStateRoot,
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
  type GovernanceProposal,
  type GovernanceVote,
  type ResourceSchedule,
  type ResourceScheduleSnapshot,
  type ReleaseInstitutionalRoster,
  type ReleaseManifestBody,
  type ReleaseVerifierResult,
  type ReleaseWorkflowEventType,
  type ReleaseWorkflowPayload,
  type ReleaseWorkflowSnapshot,
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

const domain: TypedDataDomain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};

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

async function harness(): Promise<Harness> {
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
  >();
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
    contracts: {
      clubGovernors: { [rehearsalClubId]: governorDid },
    },
    memory: { storageVerifier: memoryStorage },
    continuity: {
      recognizedImageDigests: new Set([recognizedBodyImageDigest]),
    },
    exit: { portabilityVerifier: exitVerifier },
    governance: {
      eligibilitySnapshot: governanceEligibilitySnapshot(candidateDid),
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
    candidate: createSigningIdentity(digest(candidateKey)),
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
    ],
  });
  return admitted;
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
