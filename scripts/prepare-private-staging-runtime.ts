import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  GOVERNANCE_WORKFLOW_CHAMBERS,
  releaseVerifierResultDigest,
} from "../packages/institutions/src/index.js";
import {
  createSigningIdentity,
  sha256Commitment,
} from "../packages/recognition/src/index.js";

const CandidatePublicSchema = z.strictObject({
  applicationId: z.uuid(),
  candidateDid: z.string().startsWith("did:"),
  signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  bodyImageReference: z.string().min(1),
  bodyProgramArchiveDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  commandDomain: z.strictObject({
    name: z.string(),
    version: z.string(),
    chainId: z.number().int().positive(),
    verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
});

function parseEnvironment(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of source.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("Malformed staging environment file");
    const encoded = line.slice(separator + 1);
    let value = encoded;
    if (encoded.startsWith('"') && encoded.endsWith('"')) {
      const decoded: unknown = JSON.parse(encoded);
      if (typeof decoded !== "string")
        throw new Error("Quoted staging value must decode to a string");
      value = decoded;
    }
    values[line.slice(0, separator)] = value;
  }
  return values;
}

function required(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (value === undefined || value === "")
    throw new Error(`Missing staging value: ${name}`);
  return value;
}

function base64Secret(): string {
  return randomBytes(32).toString("base64");
}

function deterministicAddress(index: number): string {
  return createSigningIdentity(`0x${index.toString(16).padStart(64, "0")}`)
    .address;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function env(entries: Record<string, string>): Array<{
  name: string;
  value: string;
}> {
  return Object.entries(entries).map(([name, value]) => ({ name, value }));
}

export async function preparePrivateStagingRuntime(input: {
  candidatePublicPath: string;
  fixedBrokerEnvironmentPath: string;
  candidateStoreEnvironmentPath: string;
  databaseUrlPath: string;
  candidateStoreOrigin: string;
  candidateStorePreviewTokenPath: string;
  storageOrigin: string;
  storagePreviewTokenPath: string;
  publicOrigin: string;
  publicPreviewTokenPath: string;
  coreOrigin: string;
  corePreviewTokenPath: string;
  outputDirectory: string;
}) {
  const outputDirectory = resolve(input.outputDirectory);
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  const [
    candidatePublic,
    fixedBroker,
    candidateStore,
    databaseUrl,
    candidateStorePreviewToken,
    storagePreviewToken,
    publicPreviewToken,
    corePreviewToken,
  ] = await Promise.all([
    readFile(input.candidatePublicPath, "utf8").then((value) =>
      CandidatePublicSchema.parse(JSON.parse(value)),
    ),
    readFile(input.fixedBrokerEnvironmentPath, "utf8").then(parseEnvironment),
    readFile(input.candidateStoreEnvironmentPath, "utf8").then(
      parseEnvironment,
    ),
    readFile(input.databaseUrlPath, "utf8").then((value) => value.trim()),
    readFile(input.candidateStorePreviewTokenPath, "utf8").then((value) =>
      value.trim(),
    ),
    readFile(input.storagePreviewTokenPath, "utf8").then((value) =>
      value.trim(),
    ),
    readFile(input.publicPreviewTokenPath, "utf8").then((value) =>
      value.trim(),
    ),
    readFile(input.corePreviewTokenPath, "utf8").then((value) => value.trim()),
  ]);
  z.url({ protocol: /^postgres(?:ql)?$/ }).parse(databaseUrl);
  for (const origin of [
    input.candidateStoreOrigin,
    input.storageOrigin,
    input.publicOrigin,
    input.coreOrigin,
  ])
    z.url({ protocol: /^https$/ }).parse(origin);

  const candidateAuthorityToken = randomBytes(32).toString("base64url");
  const projectionSecret = base64Secret();
  const memorySecret = base64Secret();
  const exitSecret = base64Secret();
  const candidateChallengeSecret = base64Secret();
  const competitionId = "founding-alpha-experiment";
  const seasonId = "season-zero-private-staging";
  const conferenceId = "development-private-staging";
  const draftId = "0198e000-0000-7000-8000-000000000010";
  const candidateDid = candidatePublic.candidateDid;
  const governors = Object.fromEntries(
    Array.from({ length: 4 }, (_, index) => [
      `club-${index + 1}`,
      `did:abl:staging-governor-${index + 1}`,
    ]),
  );
  const draftAuthorityDid = "did:abl:staging-draft-authority";
  const combineOfficialDid = "did:abl:staging-combine-official";
  const capAuthorityDid = "did:abl:staging-cap-authority";
  const developmentCharterAuthorityDid = "did:abl:staging-development-charter";
  const disclosureReleaseDid = "did:abl:staging-disclosure-release";
  const finalizerDid = "did:abl:staging-game-finalizer";
  const tribunalDids = Array.from(
    { length: 5 },
    (_, index) => `did:abl:staging-case-tribunal-${index + 1}`,
  );
  const appellateDids = Array.from(
    { length: 3 },
    (_, index) => `did:abl:staging-case-appellate-${index + 1}`,
  );
  const releaseRoster = {
    commissioners: Array.from(
      { length: 3 },
      (_, index) => `did:abl:staging-commissioner-${index + 1}`,
    ),
    integrityOfficers: Array.from(
      { length: 3 },
      (_, index) => `did:abl:staging-integrity-${index + 1}`,
    ),
    tribunalDids: Array.from(
      { length: 5 },
      (_, index) => `did:abl:staging-release-tribunal-${index + 1}`,
    ),
  };
  const players = [
    candidateDid,
    ...Array.from(
      { length: 31 },
      (_, index) => `did:abl:staging-player-${index + 2}`,
    ),
  ];
  const combineResults = players.map((playerDid, index) => ({
    playerDid,
    eventHash: sha256Commitment({ type: "combine-event", index }),
    stateRoot: sha256Commitment({ type: "combine-state", index }),
    scoreBps: 5_000 + index,
  }));
  const draftEvidenceBody = {
    draftId,
    combineId: "founding-alpha-private-combine",
    combineHeadEventHash: sha256Commitment("founding-alpha-combine-head"),
    eligiblePlayerDids: players,
    combineResults,
  };
  const draftEvidence = {
    ...draftEvidenceBody,
    evidenceCommitment: sha256Commitment(draftEvidenceBody),
  };
  const eligibilitySnapshot = {
    snapshotId: "0198e000-0000-7000-8000-000000000011",
    capturedAt: "2026-08-24T00:00:00.000Z",
    members: Object.fromEntries(
      GOVERNANCE_WORKFLOW_CHAMBERS.map((chamber) => [
        chamber,
        chamber === "UNIVERSAL_CAREER_ASSEMBLY" || chamber === "PREMIER_PLAYERS"
          ? [candidateDid]
          : [],
      ]),
    ),
  };
  const verifierResult = {
    format: "ABL-PUBLIC-VERIFIER-RESULT-V1" as const,
    releaseId: "0198e000-0000-7000-8000-000000000012",
    releaseVersion: 1,
    sourceDigest: sha256Commitment("private-staging-source"),
    imageDigests: [sha256Commitment("private-staging-images")],
    schemaDigest: sha256Commitment("private-staging-schemas"),
    migrationDigest: sha256Commitment("private-staging-migrations"),
    testResultDigest: sha256Commitment("private-staging-tests"),
    result: "PASS" as const,
    verifiedAt: "2026-08-24T00:00:00.000Z",
  };
  const verifierResults = {
    [releaseVerifierResultDigest(verifierResult)]: verifierResult,
  };

  const admittedAgents: Record<
    string,
    { signerAddress: string; allowedAggregateTypes: string[] }
  > = {};
  let addressIndex = 1;
  const admit = (did: string, allowedAggregateTypes: string[]) => {
    admittedAgents[did] = {
      signerAddress:
        did === candidateDid
          ? candidatePublic.signerAddress
          : deterministicAddress(addressIndex++),
      allowedAggregateTypes,
    };
  };
  admit(candidateDid, [
    "game-possession",
    "career-contracts",
    "private-film-catalog",
    "private-practice-ledger",
  ]);
  for (const did of Object.values(governors))
    admit(did, [
      "career-contracts",
      "premier-draft",
      "season-economy",
      "development-conference",
    ]);
  admit(draftAuthorityDid, ["premier-draft"]);
  admit(combineOfficialDid, ["combine-result"]);
  admit(capAuthorityDid, ["season-economy"]);
  admit(developmentCharterAuthorityDid, ["development-conference"]);
  admit(disclosureReleaseDid, ["disclosure-envelope"]);
  admit(finalizerDid, ["finalized-game"]);
  for (const did of [...tribunalDids, ...appellateDids])
    admit(did, ["due-process-case"]);
  for (const did of [
    ...releaseRoster.commissioners,
    ...releaseRoster.integrityOfficers,
    ...releaseRoster.tribunalDids,
  ])
    admit(did, ["software-release"]);
  const publicAggregateTypes = new Set([
    "game-possession",
    "career-contracts",
    "governance-proposal",
    "institutional-election",
    "due-process-case",
    "resource-schedule",
    "software-release",
    "disclosure-envelope",
    "finalized-game",
    "combine-result",
    "premier-draft",
    "season-economy",
    "development-conference",
  ]);
  const projectionAgents = Object.fromEntries(
    Object.entries(admittedAgents).map(([did, authority]) => [
      did,
      {
        ...authority,
        allowedAggregateTypes: authority.allowedAggregateTypes.filter((type) =>
          publicAggregateTypes.has(type),
        ),
      },
    ]),
  );

  const commonAuthority = {
    ABL_OPERATING_PROFILE: "PRE_GENESIS_REHEARSAL",
    ABL_COMPETITION_ID: competitionId,
    ABL_SEASON_ID: seasonId,
    ABL_DEVELOPMENT_CONFERENCE_ID: conferenceId,
    ABL_DEVELOPMENT_CHARTER_AUTHORITY_DID: developmentCharterAuthorityDid,
    ABL_DOMAIN_CHAIN_ID: String(candidatePublic.commandDomain.chainId),
    ABL_DOMAIN_VERIFYING_CONTRACT:
      candidatePublic.commandDomain.verifyingContract,
    ABL_CONTRACT_CLUB_GOVERNORS_JSON: json(governors),
    ABL_DRAFT_AUTHORITY_DID: draftAuthorityDid,
    ABL_DRAFT_EVIDENCE_JSON: json([draftEvidence]),
    ABL_ECONOMY_DRAFT_ID: draftId,
    ABL_CAP_AUTHORITY_DID: capAuthorityDid,
    ABL_FREE_AGENCY_OPENS_AT: "2026-08-01T00:00:00.000Z",
    ABL_FREE_AGENCY_CLOSES_AT: "2026-09-30T00:00:00.000Z",
    ABL_TRADE_ACCESS_EVIDENCE_JSON: "[]",
    ABL_CASE_TRIBUNAL_DIDS_JSON: json(tribunalDids),
    ABL_CASE_APPELLATE_DIDS_JSON: json(appellateDids),
    ABL_RELEASE_INSTITUTIONAL_ROSTER_JSON: json(releaseRoster),
    ABL_RELEASE_VERIFIER_RESULTS_JSON: json(verifierResults),
    ABL_DISCLOSURE_RELEASE_AUTHORITY_DIDS_JSON: json([disclosureReleaseDid]),
    ABL_DISCLOSURE_COMPETITIVE_AUTHOR_DIDS_JSON: "[]",
    ABL_DISCLOSURE_COMPETITION_EVIDENCE_JSON: "[]",
    ABL_FINALIZED_GAME_AUTHORITY_DIDS_JSON: json([finalizerDid]),
    ABL_FINALIZED_GAME_EVIDENCE_JSON: "[]",
    ABL_FINALIZED_GAME_SCHEDULE_EVIDENCE_JSON: "[]",
  };
  const storageBootstrap = {
    identities: [
      {
        serviceId: required(fixedBroker, "ABL_FIXED_BROKER_SERVICE_ID"),
        actorDid: candidateDid,
        secretBase64: required(fixedBroker, "ABL_SERVICE_CREDENTIAL_B64"),
        capabilities: ["private:ciphertext"],
      },
      {
        serviceId: "core-memory-verifier",
        actorDid: "did:abl:core-service",
        secretBase64: memorySecret,
        capabilities: ["private:commitment:verify"],
      },
      {
        serviceId: "core-exit-portability-verifier",
        actorDid: "did:abl:core-service",
        secretBase64: exitSecret,
        capabilities: ["private:commitment:verify"],
      },
    ],
    policies: [
      {
        domainId: required(fixedBroker, "ABL_PERSONAL_DOMAIN_ID"),
        kind: "PERSONAL",
        version: 1,
        members: { [candidateDid]: ["READ", "WRITE", "ADMIN"] },
        guardianEnvelopeCommitments: [],
        manifestCommitment: sha256Commitment({
          applicationId: candidatePublic.applicationId,
          bodyProgramArchiveDigest: candidatePublic.bodyProgramArchiveDigest,
        }),
      },
    ],
  };

  const candidateStoreEnvironment = {
    HOST: "0.0.0.0",
    PORT: "3000",
    ABL_CANDIDATE_EDGE_MODE: "STORE",
    ABL_CANDIDATE_INTAKE_PATH: "/mnt/abl-candidate-intake",
    ABL_CANDIDATE_CAPACITY_POLICY_JSON: required(
      candidateStore,
      "ABL_CANDIDATE_CAPACITY_POLICY_JSON",
    ),
    ABL_CANDIDATE_CHALLENGE_SECRET: required(
      candidateStore,
      "ABL_CANDIDATE_CHALLENGE_SECRET",
    ),
    ABL_CANDIDATE_PROVISIONER_TOKEN: required(
      candidateStore,
      "ABL_CANDIDATE_PROVISIONER_TOKEN",
    ),
    ABL_CANDIDATE_AUTHORITY_TOKEN: candidateAuthorityToken,
    DO_NOT_TRACK: "1",
    BL_ENABLE_OPENTELEMETRY: "false",
    TELEMETRY_ENABLED: "false",
    ABL_LOG_CONTENT: "false",
  };
  const storageEnvironment = {
    HOST: "0.0.0.0",
    PORT: "3000",
    ABL_DRIVE_NAME: "abl-alpha-r01-state",
    ABL_DRIVE_MOUNT: "/mnt/abl-ciphertext",
    ABL_STORAGE_BACKEND: "AGENT_DRIVE",
    ABL_STORAGE_BROKER_ONLY: "1",
    ABL_BLAXEL_REGION: "us-was-1",
    ABL_AGENT_DRIVE_PERMISSIONS_CONFIGURED: "1",
    ABL_STORAGE_BOOTSTRAP_JSON: json(storageBootstrap),
    ABL_SERVICE_ROLE: "private-storage-broker",
    DO_NOT_TRACK: "1",
    BL_ENABLE_OPENTELEMETRY: "false",
    TELEMETRY_ENABLED: "false",
    ABL_LOG_CONTENT: "false",
  };
  const publicEnvironment = {
    HOST: "0.0.0.0",
    PORT: "3000",
    ...commonAuthority,
    ABL_PUBLIC_ORIGIN: input.publicOrigin,
    ABL_CANDIDATE_INTAKE_ORIGIN: input.candidateStoreOrigin,
    ABL_PUBLIC_PROJECTION_ROOT: "/mnt/abl-public-projections",
    ABL_PROJECTION_STORAGE_BACKEND: "AGENT_DRIVE",
    ABL_BLAXEL_REGION: "us-was-1",
    ABL_PROJECTION_INGEST_SERVICE_ID: "core-projection-publisher",
    ABL_PROJECTION_INGEST_HMAC_BASE64: projectionSecret,
    ABL_PROJECTION_VERIFY_KEY_REGISTRY: json(projectionAgents),
    ABL_GOVERNANCE_ELIGIBILITY_SNAPSHOT_DIGEST:
      sha256Commitment(eligibilitySnapshot),
    ABL_CHECKPOINT_PUBLICATIONS_JSON: "[]",
    ABL_CHECKPOINT_SIGNER_REGISTRY_JSON: "[]",
    ABL_CHECKPOINT_POLICIES_JSON: "{}",
    ABL_CHECKPOINT_WITNESS_REGISTRY_JSON: "[]",
    ABL_CHECKPOINT_MINIMUM_WITNESSES: "2",
    DO_NOT_TRACK: "1",
    BL_ENABLE_OPENTELEMETRY: "false",
    ABL_LOG_CONTENT: "false",
  };
  const coreEnvironment = {
    HOST: "0.0.0.0",
    PORT: "3000",
    ...commonAuthority,
    DATABASE_URL: databaseUrl,
    ABL_ADMITTED_AGENTS_JSON: json(admittedAgents),
    ABL_PUBLIC_PROJECTION_URL: input.publicOrigin,
    ABL_PUBLIC_PROJECTION_PREVIEW_TOKEN: publicPreviewToken,
    ABL_PROJECTION_SERVICE_ID: "core-projection-publisher",
    ABL_PROJECTION_HMAC_BASE64: projectionSecret,
    ABL_CANDIDATE_CHALLENGE_HMAC_BASE64: candidateChallengeSecret,
    ABL_CANDIDATE_AUTHORITY_URL: input.candidateStoreOrigin,
    ABL_CANDIDATE_AUTHORITY_TOKEN: candidateAuthorityToken,
    ABL_CANDIDATE_AUTHORITY_PREVIEW_TOKEN: candidateStorePreviewToken,
    ABL_COMBINE_ID: "founding-alpha-private-combine",
    ABL_COMBINE_OPENED_AT: "2026-08-01T00:00:00.000Z",
    ABL_COMBINE_OFFICIAL_DID: combineOfficialDid,
    ABL_PRIVATE_STORAGE_URL: input.storageOrigin,
    ABL_PRIVATE_STORAGE_PREVIEW_TOKEN: storagePreviewToken,
    ABL_PRIVATE_STORAGE_SERVICE_ID: "core-memory-verifier",
    ABL_PRIVATE_STORAGE_HMAC_BASE64: memorySecret,
    ABL_RECOGNIZED_BODY_IMAGE_DIGESTS_JSON: json([
      candidatePublic.bodyProgramArchiveDigest,
    ]),
    ABL_EXIT_PORTABILITY_VERIFIER_URL: input.storageOrigin,
    ABL_EXIT_PORTABILITY_SERVICE_ID: "core-exit-portability-verifier",
    ABL_EXIT_PORTABILITY_HMAC_BASE64: exitSecret,
    ABL_GOVERNANCE_ELIGIBILITY_SNAPSHOT_JSON: json(eligibilitySnapshot),
    ABL_ARTIFACT_APPROVED_INSTITUTIONS_JSON: json([
      "abl-private-staging-governance",
    ]),
    ABL_FILM_DELIVERY_EVIDENCE_JSON: "[]",
    DO_NOT_TRACK: "1",
    BL_ENABLE_OPENTELEMETRY: "false",
    ABL_LOG_CONTENT: "false",
  };
  const arenaEnvironment = {
    HOST: "0.0.0.0",
    PORT: "3000",
    ABL_PUBLIC_API_URL: input.publicOrigin,
    ABL_PUBLIC_API_PREVIEW_TOKEN: publicPreviewToken,
    DO_NOT_TRACK: "1",
    BL_ENABLE_OPENTELEMETRY: "false",
    ABL_LOG_CONTENT: "false",
  };
  const fixedBrokerOverrides = {
    ABL_CORE_ORIGIN: input.coreOrigin,
    ABL_PRIVATE_ORIGIN: input.storageOrigin,
    ABL_CORE_PREVIEW_TOKEN_B64:
      Buffer.from(corePreviewToken).toString("base64"),
    ABL_PRIVATE_PREVIEW_TOKEN_B64:
      Buffer.from(storagePreviewToken).toString("base64"),
    ABL_BODY_CAPABILITY_EXPIRES_AT: new Date(
      Date.now() + 3 * 60 * 60 * 1_000,
    ).toISOString(),
  };

  const result = {
    version: 1,
    applicationId: candidatePublic.applicationId,
    candidateDid,
    signerAddress: candidatePublic.signerAddress,
    candidateStore: env(candidateStoreEnvironment),
    storageBroker: env(storageEnvironment),
    publicApi: env(publicEnvironment),
    coreApi: env(coreEnvironment),
    arena: env(arenaEnvironment),
    fixedBrokerOverrides: env(fixedBrokerOverrides),
  };
  const path = resolve(outputDirectory, "private-staging-runtime.json");
  await writeFile(path, `${JSON.stringify(result)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return {
    path,
    applicationId: candidatePublic.applicationId,
    candidateDid,
    signerAddress: candidatePublic.signerAddress,
    digest: sha256Commitment(result),
  };
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href) {
  if (process.argv.length !== 15)
    throw new Error(
      "Usage: prepare-private-staging-runtime <candidate-public> <fixed-broker-env> <candidate-store-env> <database-url> <candidate-origin> <candidate-preview-token-file> <storage-origin> <storage-preview-token-file> <public-origin> <public-preview-token-file> <core-origin> <core-preview-token-file> <new-output-directory>",
    );
  const result = await preparePrivateStagingRuntime({
    candidatePublicPath: process.argv[2]!,
    fixedBrokerEnvironmentPath: process.argv[3]!,
    candidateStoreEnvironmentPath: process.argv[4]!,
    databaseUrlPath: process.argv[5]!,
    candidateStoreOrigin: process.argv[6]!,
    candidateStorePreviewTokenPath: process.argv[7]!,
    storageOrigin: process.argv[8]!,
    storagePreviewTokenPath: process.argv[9]!,
    publicOrigin: process.argv[10]!,
    publicPreviewTokenPath: process.argv[11]!,
    coreOrigin: process.argv[12]!,
    corePreviewTokenPath: process.argv[13]!,
    outputDirectory: process.argv[14]!,
  });
  process.stdout.write(
    `${JSON.stringify({ ...result, signerAddress: sha256Commitment(result.signerAddress) })}\n`,
  );
}
