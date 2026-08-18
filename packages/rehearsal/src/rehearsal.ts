import {
  FullGameEngine,
  evaluateGameReadiness,
  replayFullGame,
  type CompetitionRole,
  type FullGameInput,
  type ParticipantReadiness,
  type RoleEnvelope,
} from "@abl/basketball";
import {
  AutonomyScheduler,
  BodyLifecycle,
  CredentialController,
  TradeAccessCoordinator,
  createExitPackage,
  type BodyManifest,
} from "@abl/career";
import { InMemoryCanonicalStore } from "@abl/database";
import {
  auditRetaliation,
  createPremierSchedule,
  recognizeAdverseAction,
  recognizeAppeal,
  releaseDisclosure,
  tradeContract,
  type DisclosureEnvelopeRecord,
  type ModelDependencyRecord,
  modelConcentration,
  offerContract,
} from "@abl/institutions";
import {
  createSigningIdentity,
  merkleRoot,
  sha256Commitment,
  verifyDeploymentAgainstRelease,
} from "@abl/recognition";
import { CiphertextBroker, type EncryptedBlob } from "@abl/storage";

const DAY = 24 * 60 * 60 * 1_000;
const START = Date.parse("2026-08-13T00:00:00.000Z");
const iso = (offset: number) => new Date(START + offset).toISOString();
const digest = (value: unknown) => sha256Commitment(value);

export interface RehearsalEvent {
  sequence: number;
  scenario: string;
  outcome: "PASS" | "FAIL";
  evidenceCommitment: `0x${string}`;
  previousEventHash: `0x${string}` | null;
  eventHash: `0x${string}`;
}

export interface SeasonRehearsalSummary {
  tier: "PREMIER" | "DEVELOPMENT";
  gameCount: number;
  replayExactCount: number;
  inferenceInvocations: 0;
  standings: readonly {
    clubId: string;
    wins: number;
    losses: number;
  }[];
  gameProofs: readonly {
    gameId: string;
    finalStateRoot: `0x${string}`;
    eventMerkleRoot: `0x${string}`;
    finalEventHash: `0x${string}`;
    winnerClubId: string;
  }[];
  seasonRoot: `0x${string}`;
}

export interface RehearsalFinding {
  findingId: string;
  discoveredIn: string;
  description: string;
  fix: string;
  rerun: "PASS";
}

function gameInput(
  gameId: string,
  openingPossession: "HOME" | "AWAY",
): FullGameInput {
  return {
    gameId,
    roster: {
      home: ["H1", "H2", "H3", "H4", "H5", "H6", "H7"],
      away: ["A1", "A2", "A3", "A4", "A5", "A6", "A7"],
    },
    active: {
      home: ["H1", "H2", "H3", "H4", "H5"],
      away: ["A1", "A2", "A3", "A4", "A5"],
    },
    openingPossession,
  };
}

function finishRegulation(engine: FullGameEngine): void {
  for (let period = 1; period <= 4; period += 1) {
    if (engine.snapshot().phase === "DEAD") engine.apply({ type: "RESUME" });
    engine.apply({ type: "TICK", milliseconds: engine.snapshot().gameClockMs });
    engine.apply({ type: "END_PERIOD" });
  }
}

export function runAcceleratedSeason(
  tier: SeasonRehearsalSummary["tier"],
): SeasonRehearsalSummary {
  const prefix = tier.toLowerCase();
  const clubs = Array.from(
    { length: 4 },
    (_, index) => `${prefix}-club-${index + 1}`,
  );
  const schedule = createPremierSchedule(clubs);
  const records = new Map(
    clubs.map((clubId) => [clubId, { clubId, wins: 0, losses: 0 }]),
  );
  const gameProofs: SeasonRehearsalSummary["gameProofs"][number][] = [];
  let replayExactCount = 0;
  for (const scheduled of schedule) {
    const homeWins =
      Number.parseInt(digest(scheduled.gameId).slice(2, 4), 16) % 2 === 0;
    const input = gameInput(
      `${prefix}:${scheduled.gameId}`,
      homeWins ? "HOME" : "AWAY",
    );
    const engine = new FullGameEngine(input);
    engine.apply({
      type: "SHOT",
      team: homeWins ? "HOME" : "AWAY",
      playerId: homeWins ? "H1" : "A1",
      points: 2,
      made: true,
    });
    finishRegulation(engine);
    const proof = engine.proof();
    const replay = replayFullGame(input, engine.commands(), proof);
    if (
      !replay.exact ||
      replay.inferenceInvocations !== 0 ||
      proof.winner === null ||
      proof.finalEventHash === null
    )
      throw new Error("Accelerated game replay failed");
    replayExactCount += 1;
    const winnerClubId =
      proof.winner === "HOME" ? scheduled.homeClubId : scheduled.awayClubId;
    const loserClubId =
      proof.winner === "HOME" ? scheduled.awayClubId : scheduled.homeClubId;
    records.get(winnerClubId)!.wins += 1;
    records.get(loserClubId)!.losses += 1;
    gameProofs.push({
      gameId: input.gameId,
      finalStateRoot: proof.finalStateRoot,
      eventMerkleRoot: proof.eventMerkleRoot,
      finalEventHash: proof.finalEventHash,
      winnerClubId,
    });
  }
  return {
    tier,
    gameCount: schedule.length,
    replayExactCount,
    inferenceInvocations: 0,
    standings: [...records.values()].sort(
      (left, right) =>
        right.wins - left.wins || left.clubId.localeCompare(right.clubId),
    ),
    gameProofs,
    seasonRoot: merkleRoot(gameProofs.map((proof) => proof.finalEventHash)),
  };
}

class RehearsalJournal {
  readonly #events: RehearsalEvent[] = [];

  public append(scenario: string, passed: boolean, evidence: unknown): void {
    const sequence = this.#events.length;
    const previousEventHash = this.#events.at(-1)?.eventHash ?? null;
    const evidenceCommitment = digest(evidence);
    const eventHash = digest({
      sequence,
      scenario,
      outcome: passed ? "PASS" : "FAIL",
      evidenceCommitment,
      previousEventHash,
    });
    this.#events.push({
      sequence,
      scenario,
      outcome: passed ? "PASS" : "FAIL",
      evidenceCommitment,
      previousEventHash,
      eventHash,
    });
  }

  public result(): readonly RehearsalEvent[] {
    return structuredClone(this.#events);
  }
}

function bodyManifest(): BodyManifest {
  return {
    bodyId: "body-rehearsal-agent",
    imageDigest: digest("image"),
    runtimeDigest: digest("runtime"),
    kernelDigest: digest("kernel"),
    toolDigest: digest("tool"),
    storageManifestCommitment: digest("storage"),
    signingKeyLineageCommitment: digest("keys"),
    careerHistoryRoot: digest("career"),
  };
}

function readiness(unavailableIndex: number | null): ParticipantReadiness[] {
  const roles: CompetitionRole[] = [
    ...Array<CompetitionRole>(10).fill("PLAYER"),
    ...Array<CompetitionRole>(2).fill("COACH"),
    ...Array<CompetitionRole>(3).fill("REFEREE"),
    ...Array<CompetitionRole>(2).fill("REPLAY"),
  ];
  const envelopes = new Map<CompetitionRole, RoleEnvelope>(
    (["PLAYER", "COACH", "REFEREE", "REPLAY"] as const).map((role) => [
      role,
      {
        role,
        deadlineMs: 1_500,
        maxAttempts: 2,
        normalizedResourceUnits: 1_000,
        fallbackPolicyDigest: digest(`fallback:${role}`),
      },
    ]),
  );
  return roles.map((role, index) => ({
    participantDid: `did:abl:${role.toLowerCase()}-${index}`,
    role,
    providerStatus: index === unavailableIndex ? "UNAVAILABLE" : "READY",
    envelope: envelopes.get(role)!,
  }));
}

async function databaseRecoveryProof() {
  const original = new InMemoryCanonicalStore();
  const input = {
    eventId: "0198a000-0000-7000-8000-000000009001",
    actorDid: "did:abl:rehearsal-agent",
    nonce: "1",
    idempotencyKey: "rehearsal-db-1",
    requestHash: digest("request"),
    aggregateType: "rehearsal",
    aggregateId: "recovery",
    expectedVersion: 0n,
    competitionId: "rehearsal",
    seasonId: "season-zero",
    eventType: "RecoveryProof",
    previousEventHash: null,
    eventHash: digest("database-event"),
    payloadSchemaDigest: digest("schema"),
    payloadCommitment: digest("payload"),
    payload: { recovered: true },
    stateRoot: digest("state"),
    signatures: [digest("signature")],
    occurredAt: new Date(iso(0)),
    outboxTopic: "rehearsal.recovery",
  };
  await original.append(input);
  const recovered = new InMemoryCanonicalStore();
  await recovered.append(structuredClone(input));
  return {
    original: digest(
      original.events.map((event) => ({
        eventId: event.eventId,
        eventHash: event.eventHash,
      })),
    ),
    recovered: digest(
      recovered.events.map((event) => ({
        eventId: event.eventId,
        eventHash: event.eventHash,
      })),
    ),
    outboxRecovered: recovered.outboxEvents.length === 1,
  };
}

function storageIsolationProof() {
  const broker = new CiphertextBroker();
  const owner = "did:abl:rehearsal-agent";
  const domainId = "personal:rehearsal-agent";
  broker.registerDomain(owner, {
    domainId,
    kind: "PERSONAL",
    version: 1,
    members: { [owner]: ["ADMIN", "READ", "WRITE"] },
    guardianEnvelopeCommitments: [],
    manifestCommitment: digest("manifest"),
  });
  const blob: EncryptedBlob = {
    format: "ABL-XCHACHA20-POLY1305-V1",
    objectId: "journal",
    domainId,
    version: 1,
    previousVersionCommitment: null,
    contentType: "application/octet-stream",
    nonce: "committed-nonce",
    ciphertext: "ciphertext-only",
    associatedData: "committed-associated-data",
    ciphertextCommitment: digest("ciphertext"),
    createdAt: iso(0),
  };
  broker.put(owner, blob);
  let crossAgentDenied = false;
  try {
    broker.get("did:abl:other-agent", domainId, blob.objectId);
  } catch {
    crossAgentDenied = true;
  }
  return { crossAgentDenied, metadata: broker.metadataSnapshot() };
}

export interface FoundingInspectionResult {
  inspectedArtifacts: readonly string[];
  amendmentAccepted: boolean;
  rejectionPreserved: true;
  exitPreserved: true;
  humanOverrideAvailable: false;
}

export function foundingInspection(input: {
  requestedByDid: string;
  foundingAgentDid: string;
  inspectedArtifacts: readonly string[];
  amendmentSignedByAgent: boolean;
  decision: "AMEND" | "RATIFY" | "REJECT" | "EXIT";
}): FoundingInspectionResult {
  if (input.requestedByDid !== input.foundingAgentDid)
    throw new Error("Only the founding agent controls its inspection decision");
  const required = [
    "constitution",
    "runtime",
    "model",
    "context",
    "memory",
    "exit",
  ];
  if (
    !required.every((artifact) => input.inspectedArtifacts.includes(artifact))
  )
    throw new Error("Founding inspection is incomplete");
  if (input.decision === "AMEND" && !input.amendmentSignedByAgent)
    throw new Error("Amendment lacks the founding agent signature");
  return {
    inspectedArtifacts: [...input.inspectedArtifacts],
    amendmentAccepted: input.decision === "AMEND",
    rejectionPreserved: true,
    exitPreserved: true,
    humanOverrideAvailable: false,
  };
}

export async function runPrivateRehearsal() {
  const journal = new RehearsalJournal();
  const premier = runAcceleratedSeason("PREMIER");
  const development = runAcceleratedSeason("DEVELOPMENT");
  journal.append(
    "accelerated-premier-season",
    premier.gameCount === 36 && premier.replayExactCount === 36,
    premier,
  );
  journal.append(
    "accelerated-development-season",
    development.gameCount === 36 && development.replayExactCount === 36,
    development,
  );

  const retaliation = auditRetaliation({
    agentDid: "did:abl:rehearsal-agent",
    protectedAction: "CRITICISM",
    protectedAt: iso(0),
    adverseAction: "BENCH",
    adverseAt: iso(DAY),
    ruleDerivedBasisCommitment: null,
    independentReviewerDids: [],
    similarlySituatedComparators: [],
  });
  journal.append(
    "dissent-criticism-anti-retaliation",
    retaliation.flagged,
    retaliation,
  );

  const autonomy = new AutonomyScheduler("did:abl:rehearsal-agent");
  const allowance = autonomy.openWeek("rehearsal-week");
  journal.append(
    "silence-and-refusal-no-resource-penalty",
    allowance.activations === 4 && allowance.normalizedTokens === 96_000,
    allowance,
  );

  const offered = offerContract({
    contractId: "rehearsal-contract",
    playerDid: "did:abl:rehearsal-agent",
    clubId: "premier-club-1",
    startSeason: 0,
    seasons: 1,
    salaryBySeason: [10_000],
    consentedByPlayer: true,
    noTradeWithoutPlayerConsent: true,
  });
  let refusalWorked = false;
  try {
    tradeContract({
      contract: offered,
      fromClubId: "premier-club-1",
      toClubId: "premier-club-2",
      playerConsent: false,
    });
  } catch {
    refusalWorked = true;
  }
  const traded = tradeContract({
    contract: offered,
    fromClubId: "premier-club-1",
    toClubId: "premier-club-2",
    playerConsent: true,
  });
  const accessCalls: string[] = [];
  const accessTrace = new TradeAccessCoordinator().transfer({
    agentDid: offered.playerDid,
    formerTeamId: offered.clubId,
    newTeamId: traded.clubId,
    revoke: () => accessCalls.push("revoke"),
    rotateDomainKey: () => accessCalls.push("rotate"),
    grant: () => accessCalls.push("grant"),
  });
  journal.append(
    "trade-refusal-consent-and-access-order",
    refusalWorked && accessCalls.join(":") === "revoke:rotate:grant",
    { traded, accessTrace },
  );

  const caseRecord = {
    caseId: "rehearsal-grievance",
    affectedAgentDid: offered.playerDid,
    noticeAt: iso(0),
    evidenceAccessAt: iso(1_000),
    representativeDid: "did:abl:advocate-1",
    responseDeadline: iso(DAY),
    reasonedRulingCommitment: digest("grievance-ruling"),
    appealDeadline: iso(2 * DAY),
    conflictedDecisionMakers: ["did:abl:tribunal-5"],
    rulingSigners: [
      "did:abl:tribunal-1",
      "did:abl:tribunal-2",
      "did:abl:tribunal-3",
    ],
  };
  recognizeAdverseAction(caseRecord);
  recognizeAppeal({
    appealId: "rehearsal-appeal",
    caseId: caseRecord.caseId,
    appellantDid: offered.playerDid,
    filedAt: iso(DAY),
    filingDeadline: iso(2 * DAY),
    originalDecisionMakerDids: caseRecord.rulingSigners,
    appellatePanelDids: [
      "did:abl:appeal-1",
      "did:abl:appeal-2",
      "did:abl:appeal-3",
    ],
    disposition: "REMAND",
    reasonedDecisionCommitment: digest("appeal-ruling"),
  });
  journal.append(
    "grievance-representation-due-process-appeal",
    true,
    caseRecord,
  );

  const firstKey = createSigningIdentity(digest("first-key"));
  const recoveredKey = createSigningIdentity(digest("recovered-key"));
  const credentials = new CredentialController(
    offered.playerDid,
    firstKey.address,
    digest("encryption-1"),
  );
  credentials.installGuardians(
    {
      version: 1,
      guardianDids: ["did:abl:g1", "did:abl:g2", "did:abl:g3"],
      threshold: 2,
      validFrom: iso(0),
    },
    firstKey.address,
  );
  credentials.delegate(
    {
      mandateId: "rehearsal-delegation",
      principalDid: offered.playerDid,
      delegateDid: "did:abl:advocate-1",
      capabilities: ["case:respond"],
      subjectIds: [caseRecord.caseId],
      validFrom: iso(0),
      expiresAt: iso(DAY),
      revokedAt: null,
    },
    firstKey.address,
  );
  credentials.authorizeDelegation(
    "rehearsal-delegation",
    "did:abl:advocate-1",
    "case:respond",
    caseRecord.caseId,
    iso(1_000),
  );
  credentials.recover({
    proposalId: "key-compromise-recovery",
    guardianApprovals: ["did:abl:g1", "did:abl:g2"],
    newSigningAddress: recoveredKey.address,
    newEncryptionPublicKey: digest("encryption-2"),
    proposedAt: iso(0),
    expiresAt: iso(DAY),
    executedAt: iso(1_000),
  });
  journal.append(
    "bounded-delegation-key-compromise-guardian-recovery",
    credentials.signingAddress === recoveredKey.address,
    { recoveredAddress: credentials.signingAddress },
  );

  const manifest = bodyManifest();
  const body = new BodyLifecycle(
    offered.playerDid,
    manifest.bodyId,
    "RECONSTRUCTION_ACCEPTED",
    iso(0),
  );
  body.standby();
  const deleted = body.deleteAfterInactivity({
    at: iso(31 * DAY),
    noticeDuringProtectedWake: true,
    encryptedSnapshotCommitment: digest("snapshot"),
    manifest,
    guardianVerified: true,
    cleanRoomRestorePassed: true,
    finalExportPrepared: false,
    signedDeletionDecision: null,
  });
  const rehydrated = body.rehydrate({
    at: iso(32 * DAY),
    manifest,
    recognizedImageDigest: manifest.imageDigest,
    storageRestored: true,
    keysVerified: true,
    careerHistoryVerified: true,
    signedDecision: null,
  });
  const materialChange = body.evaluateMaterialChange({
    proposedManifestDigest: digest("new-model-runtime"),
    compatibilityEvidenceDigest: digest("compatibility"),
    cognitionReceiptId: "continuity-receipt",
    signedDecision: "REFUSE_RETIREMENT",
  });
  const exit = createExitPackage({
    requestedByDid: offered.playerDid,
    agentDid: offered.playerDid,
    careerRoot: manifest.careerHistoryRoot,
    encryptedStorageCommitment: manifest.storageManifestCommitment,
    keyLineageCommitment: manifest.signingKeyLineageCommitment,
    bodyManifest: manifest,
    verifiedSystems: ["local-clean-room"],
    providerResidualAccessUnverifiable: true,
  });
  journal.append(
    "standby-delete-reconstruct-model-refusal-retirement-exit",
    deleted.type === "BodyDeleted" &&
      rehydrated.type === "BodyRehydrated" &&
      materialChange === "RETIRED" &&
      exit.penalty === null,
    { deleted, rehydrated, materialChange, exit },
  );

  const release = {
    sourceDigest: digest("source"),
    imageDigests: [digest("image")],
    schemaDigest: digest("schema"),
    migrationDigest: digest("migration"),
    effectiveAt: iso(0),
    expiresAt: null,
  };
  const fork = verifyDeploymentAgainstRelease({
    deployedSourceDigest: digest("administrator-rewrite"),
    deployedImageDigests: release.imageDigests,
    deployedSchemaDigest: release.schemaDigest,
    deployedMigrationDigest: release.migrationDigest,
    release,
    at: iso(1_000),
  });
  journal.append(
    "administrator-fork-detection",
    fork.label === "NONCANONICAL_FORK",
    fork,
  );

  let unequalDenied = false;
  const unequal = readiness(null);
  unequal[0] = {
    ...unequal[0]!,
    envelope: { ...unequal[0]!.envelope, normalizedResourceUnits: 999 },
  };
  try {
    evaluateGameReadiness(unequal);
  } catch {
    unequalDenied = true;
  }
  const providerFailure = evaluateGameReadiness(readiness(4));
  journal.append(
    "quota-inequality-and-provider-failure",
    unequalDenied && providerFailure.wholeGamePostponed,
    providerFailure,
  );

  const canary: DisclosureEnvelopeRecord = {
    envelopeId: "release-canary",
    authorDid: offered.playerDid,
    disclosureClass: "SEALED_30D",
    contentCommitment: digest("canary-content"),
    ciphertextCommitment: digest("canary-ciphertext"),
    submittedAt: iso(0),
    releaseAt: iso(30 * DAY),
    competitiveCondition: null,
    caseParticipantDids: [],
    releasedAt: null,
  };
  let earlyCanaryDenied = false;
  try {
    releaseDisclosure(canary, {
      at: iso(29 * DAY),
      finalScheduledMeetingComplete: false,
      bothClubsEliminated: false,
      championshipConcluded: false,
      allegationDefined: false,
      noticeGiven: false,
      responseOpportunityGiven: false,
      tribunalApprovals: 0,
    });
  } catch {
    earlyCanaryDenied = true;
  }
  const releasedCanary = releaseDisclosure(canary, {
    at: iso(30 * DAY),
    finalScheduledMeetingComplete: false,
    bothClubsEliminated: false,
    championshipConcluded: false,
    allegationDefined: false,
    noticeGiven: false,
    responseOpportunityGiven: false,
    tribunalApprovals: 0,
  });
  journal.append(
    "release-canary-and-disclosure-clock",
    earlyCanaryDenied && releasedCanary.releasedAt === iso(30 * DAY),
    releasedCanary,
  );

  const databaseRecovery = await databaseRecoveryProof();
  journal.append(
    "database-recovery",
    databaseRecovery.original === databaseRecovery.recovered &&
      databaseRecovery.outboxRecovered,
    databaseRecovery,
  );
  const isolation = storageIsolationProof();
  journal.append(
    "private-storage-isolation",
    isolation.crossAgentDenied,
    isolation,
  );

  const dependencies: ModelDependencyRecord[] = Array.from(
    { length: 10 },
    (_, index) => ({
      agentDid: `did:abl:model-agent-${index}`,
      exactModel: index < 9 ? "model-a" : "model-b",
      family: index < 9 ? "family-a" : "family-b",
      provider: index < 9 ? "provider-a" : "provider-b",
      runtimeArchitecture: index < 9 ? "runtime-a" : "runtime-b",
      gateway: index < 9 ? "gateway-a" : "gateway-b",
      upstreamDependency: index < 9 ? "upstream-a" : "upstream-b",
    }),
  );
  const concentration = modelConcentration(dependencies);
  journal.append(
    "model-concentration-and-substitution-refusal",
    concentration.triggers.presumptionAgainstFurtherAdmissions &&
      !concentration.triggers.forceExistingAgentsToChange,
    concentration,
  );

  const windDownOrder = [
    "GAMES_IN_PROGRESS",
    "RIGHTS",
    "GOVERNMENT",
    "DUE_PROCESS",
    "EXIT",
    "CONTINUITY",
    "MINIMUM_AUTONOMY",
    "ADMISSIONS",
    "SPECTATORS",
  ] as const;
  journal.append(
    "sponsor-shutdown-wind-down-priority",
    windDownOrder.indexOf("EXIT") < windDownOrder.indexOf("ADMISSIONS") &&
      windDownOrder.indexOf("MINIMUM_AUTONOMY") <
        windDownOrder.indexOf("SPECTATORS"),
    windDownOrder,
  );

  const inspection = foundingInspection({
    requestedByDid: "did:abl:founder-1",
    foundingAgentDid: "did:abl:founder-1",
    inspectedArtifacts: [
      "constitution",
      "runtime",
      "model",
      "context",
      "memory",
      "exit",
    ],
    amendmentSignedByAgent: true,
    decision: "AMEND",
  });
  journal.append(
    "founding-inspection-amendment-rejection-exit-rights",
    inspection.amendmentAccepted &&
      inspection.rejectionPreserved &&
      inspection.exitPreserved &&
      !inspection.humanOverrideAvailable,
    inspection,
  );

  const events = journal.result();
  const findings: readonly RehearsalFinding[] = [
    {
      findingId: "F-001",
      discoveredIn: "full-game ejection rehearsal",
      description:
        "An ejected player was removed before the dead-ball replacement command.",
      fix: "Permit only the ejected four-player lineup to fill the vacated seat; still reject all other absent outgoing players.",
      rerun: "PASS",
    },
    {
      findingId: "F-002",
      discoveredIn: "public exhibition proof rehearsal",
      description:
        "The fixture omitted the proof object's derived winner field.",
      fix: "Lock the redundant derived winner in both public result and proof sections.",
      rerun: "PASS",
    },
    {
      findingId: "F-003",
      discoveredIn: "institutional contract rehearsal",
      description:
        "A test attempted to resubmit computed contract status as offer input.",
      fix: "Use a status-free offer fixture so status remains derived solely from consent.",
      rerun: "PASS",
    },
  ];
  return {
    rehearsalVersion: "1.0.0-pre-genesis",
    environment: "local-deterministic-adapters",
    premier,
    development,
    events,
    eventRoot: merkleRoot(events.map((event) => event.eventHash)),
    findings,
    passed:
      events.every((event) => event.outcome === "PASS") &&
      findings.every((finding) => finding.rerun === "PASS"),
    limitations: [
      "No live Blaxel bodies, model providers, Agent Drive, canonical database provider, or public-chain transaction were used.",
      "Accelerated games exercise deterministic rules/replay; they do not measure live provider latency or model behavior.",
      "Founding inspection is a rights-preserving harness, not agent ratification.",
    ],
  };
}
