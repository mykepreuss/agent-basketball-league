import { readFile } from "node:fs/promises";

import { ServiceRequestVerifier } from "@abl/foundation";
import {
  FinalizedGameAuthorityDidsSchema,
  assertFinalizedGameAuthorityConfiguration,
  createFinalizedGameEvidenceReader,
  createFinalizedGameScheduleEvidenceReader,
  type FinalizedGameEvidenceReader,
  type FinalizedGameScheduleEvidenceReader,
} from "@abl/basketball";
import {
  CompetitiveDisclosureAuthorDidsSchema,
  DisclosureReleaseAuthorityDidsSchema,
  PremierDraftEvidenceRegistrySchema,
  ReleaseVerifierResultRegistrySchema,
  assertDisclosureAuthorityConfiguration,
  createCompetitionReleaseEvidenceReader,
  createPremierDraftEvidenceReader,
  createTradeAccessEvidenceReader,
  type CompetitionReleaseEvidenceReader,
  type PremierDraftEvidenceReader,
  type TradeAccessEvidenceReader,
} from "@abl/institutions";
import {
  FilePublicContractProjectionRepository,
  FilePublicDraftProjectionRepository,
  FilePublicDevelopmentProjectionRepository,
  FilePublicEconomyProjectionRepository,
  FilePublicElectionProjectionRepository,
  FilePublicFinalGameProjectionRepository,
  FilePublicFoundingConventionProjectionRepository,
  FilePublicCaseProjectionRepository,
  FilePublicGovernanceProjectionRepository,
  FilePublicModelProjectionRepository,
  PublicCheckpointProjectionRepository,
  checkpointChainClaim,
  FilePublicReleaseProjectionRepository,
  FilePublicProjectionRepository,
  FilePublicResourceProjectionRepository,
  FilePublicSocialProjectionRepository,
  verifyContractProjectionEvent,
  verifyDraftProjectionEvent,
  verifyDevelopmentProjectionEvent,
  verifyEconomyProjectionEvent,
  verifyElectionProjectionEvent,
  verifyFinalGameProjectionEvent,
  verifyFoundingProjectionEvent,
  verifyCaseProjectionEvent,
  verifyGovernanceProjectionEvent,
  verifyModelProjectionEvent,
  verifyReleaseProjectionEvent,
  verifyProjectionEvent,
  verifyResourceProjectionEvent,
  verifySocialProjectionEvent,
  type CheckpointObservationReader,
} from "@abl/projections";
import {
  InstitutionalKeyRegistry,
  verifyCheckpointAuthorization,
  type CheckpointType,
  type CheckpointWitnessRecord,
  type InstitutionalKeyRecord,
  type ThresholdPolicy,
} from "@abl/recognition";
import type { Address, TypedDataDomain } from "viem";
import { z } from "zod";

import { createPublicApi, type PublicApiOptions } from "./server.js";
import {
  ViemBaseCheckpointObservationReader,
  createBaseCheckpointRpc,
} from "./base-checkpoints.js";
import { COMPILED_RECOGNITION_ANCHOR } from "./recognition-anchor.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const host = process.env.HOST ?? "0.0.0.0";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function secret(name: string): Uint8Array {
  const encoded = required(name);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new Error(`${name} is not canonical base64`);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength < 32)
    throw new Error(`${name} must contain at least 256 bits`);
  return decoded;
}

const PUBLIC_AGGREGATE_TYPES = [
  "game-possession",
  "career-contracts",
  "governance-proposal",
  "institutional-election",
  "founding-convention-bootstrap",
  "due-process-case",
  "resource-schedule",
  "software-release",
  "disclosure-envelope",
  "finalized-game",
  "combine-result",
  "premier-draft",
  "season-economy",
  "development-conference",
] as const;

const AgentRegistrySchema = z.record(
  z.string().startsWith("did:"),
  z.strictObject({
    signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    allowedAggregateTypes: z
      .array(z.enum(PUBLIC_AGGREGATE_TYPES))
      .min(1)
      .max(PUBLIC_AGGREGATE_TYPES.length)
      .refine((types) => new Set(types).size === types.length),
  }),
);
const ContractClubGovernorsSchema = z.record(
  z.string().min(1).max(160),
  z.string().startsWith("did:"),
);
function caseAdjudicatorRoster(size: number) {
  return z
    .array(z.string().startsWith("did:"))
    .length(size)
    .refine((dids) => new Set(dids).size === dids.length);
}
const ReleaseInstitutionalRosterSchema = z
  .strictObject({
    commissioners: caseAdjudicatorRoster(3),
    integrityOfficers: caseAdjudicatorRoster(3),
    tribunalDids: caseAdjudicatorRoster(5),
  })
  .refine(
    (roster) =>
      new Set([
        ...roster.commissioners,
        ...roster.integrityOfficers,
        ...roster.tribunalDids,
      ]).size === 11,
    "Release institutional offices must be disjoint",
  );

const InstitutionalRoleSchema = z.enum([
  "CAREER_AGENT",
  "COMMISSIONER",
  "INTEGRITY_OFFICER",
  "TRIBUNAL",
  "PREMIER_PLAYER_BOARD",
  "DEVELOPMENT_PLAYER_BOARD",
  "PREMIER_GOVERNOR",
  "DEVELOPMENT_GOVERNOR",
  "REFEREE",
  "REPLAY_OFFICIAL",
  "PROJECTOR",
]);
const CheckpointSignerRegistrySchema = z.array(
  z.strictObject({
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    did: z.string().startsWith("did:"),
    role: InstitutionalRoleSchema,
    validFrom: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }).nullable(),
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
    purpose: z.literal("SIGNING"),
  }),
);
const CheckpointPoliciesSchema = z.partialRecord(
  z.enum([
    "CONSTITUTION",
    "KEY_REGISTRY",
    "GAME",
    "BALLOT",
    "RELEASE",
    "RULING",
    "DAILY_ROOT",
  ]),
  z.strictObject({
    policyId: z.string().min(1).max(120),
    groups: z
      .array(
        z.strictObject({
          role: InstitutionalRoleSchema,
          required: z.number().int().positive().max(11),
        }),
      )
      .min(1),
  }),
);
const CheckpointWitnessRegistrySchema = z.array(
  z.strictObject({
    witnessId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9.-]*$/),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    administrativeDomain: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/),
    validFrom: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }).nullable(),
  }),
);

function projectionAuthority(): {
  domain: TypedDataDomain;
  admittedAgents: Map<
    string,
    { signerAddress: `0x${string}`; allowedAggregateTypes: string[] }
  >;
  contractClubGovernors: Readonly<Record<string, string>>;
  draftAuthorityDid: string;
  draftClubGovernors: Readonly<Record<string, string>>;
  premierDraftEvidence: PremierDraftEvidenceReader["premierDraftEvidence"];
  economyId: string;
  competitionId: string;
  seasonId: string;
  capAuthorityDid: string;
  economyPlayerDids: readonly string[];
  freeAgencyWindow: { opensAt: string; closesAt: string };
  tradeAccessEvidence: TradeAccessEvidenceReader;
  governanceEligibilitySnapshotDigest: string;
  caseTribunalDids: readonly string[];
  caseAppellateDids: readonly string[];
  releaseInstitutionalRoster: z.infer<typeof ReleaseInstitutionalRosterSchema>;
  disclosureReleaseAuthorityDids: ReadonlySet<string>;
  competitiveDisclosureAuthorDids: ReadonlySet<string>;
  competitionReleaseEvidence: CompetitionReleaseEvidenceReader["competitionReleaseEvidence"];
  finalizedGameAuthorityDids: ReadonlySet<string>;
  finalizedGameEvidence: FinalizedGameEvidenceReader["finalizedGameEvidence"];
  finalizedGameScheduleEvidence: FinalizedGameScheduleEvidenceReader;
  developmentConferenceId: string;
  developmentCharterAuthorityDid: string;
  foundingConventionId: string | undefined;
} {
  const registry = AgentRegistrySchema.parse(
    JSON.parse(required("ABL_PROJECTION_VERIFY_KEY_REGISTRY")),
  );
  const contractClubGovernors = ContractClubGovernorsSchema.parse(
    JSON.parse(required("ABL_CONTRACT_CLUB_GOVERNORS_JSON")),
  );
  const governanceEligibilitySnapshotDigest = z
    .string()
    .regex(/^0x[0-9a-f]{64}$/)
    .parse(required("ABL_GOVERNANCE_ELIGIBILITY_SNAPSHOT_DIGEST"));
  const foundingConventionId =
    process.env.ABL_FOUNDING_CONVENTION_ID === undefined
      ? undefined
      : z.uuid().parse(process.env.ABL_FOUNDING_CONVENTION_ID);
  const draftAuthorityDid = z
    .string()
    .startsWith("did:")
    .parse(required("ABL_DRAFT_AUTHORITY_DID"));
  const draftEvidenceRegistry = PremierDraftEvidenceRegistrySchema.parse(
    JSON.parse(required("ABL_DRAFT_EVIDENCE_JSON")),
  );
  const draftEvidence = createPremierDraftEvidenceReader(draftEvidenceRegistry);
  const economyDraftId = required("ABL_ECONOMY_DRAFT_ID");
  const economyDraftEvidence = draftEvidenceRegistry.find(
    ({ draftId }) => draftId === economyDraftId,
  );
  if (economyDraftEvidence === undefined)
    throw new Error(
      "ABL_ECONOMY_DRAFT_ID is absent from the draft evidence registry",
    );
  const competitionId = required("ABL_COMPETITION_ID");
  const seasonId = required("ABL_SEASON_ID");
  const capAuthorityDid = z
    .string()
    .startsWith("did:")
    .parse(required("ABL_CAP_AUTHORITY_DID"));
  const developmentConferenceId = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/)
    .parse(required("ABL_DEVELOPMENT_CONFERENCE_ID"));
  const developmentCharterAuthorityDid = z
    .string()
    .startsWith("did:")
    .parse(required("ABL_DEVELOPMENT_CHARTER_AUTHORITY_DID"));
  const tradeAccessEvidence = createTradeAccessEvidenceReader(
    JSON.parse(required("ABL_TRADE_ACCESS_EVIDENCE_JSON")),
  );
  const caseTribunalDids = caseAdjudicatorRoster(5).parse(
    JSON.parse(required("ABL_CASE_TRIBUNAL_DIDS_JSON")),
  );
  const caseAppellateDids = caseAdjudicatorRoster(3).parse(
    JSON.parse(required("ABL_CASE_APPELLATE_DIDS_JSON")),
  );
  const releaseInstitutionalRoster = ReleaseInstitutionalRosterSchema.parse(
    JSON.parse(required("ABL_RELEASE_INSTITUTIONAL_ROSTER_JSON")),
  );
  const disclosureReleaseAuthorityDids = new Set(
    DisclosureReleaseAuthorityDidsSchema.parse(
      JSON.parse(required("ABL_DISCLOSURE_RELEASE_AUTHORITY_DIDS_JSON")),
    ),
  );
  const competitiveDisclosureAuthorDids = new Set(
    CompetitiveDisclosureAuthorDidsSchema.parse(
      JSON.parse(required("ABL_DISCLOSURE_COMPETITIVE_AUTHOR_DIDS_JSON")),
    ),
  );
  const competitionEvidence = createCompetitionReleaseEvidenceReader(
    JSON.parse(required("ABL_DISCLOSURE_COMPETITION_EVIDENCE_JSON")),
  );
  const finalizedGameAuthorityDids = new Set(
    FinalizedGameAuthorityDidsSchema.parse(
      JSON.parse(required("ABL_FINALIZED_GAME_AUTHORITY_DIDS_JSON")),
    ),
  );
  const finalizedGameEvidence = createFinalizedGameEvidenceReader(
    JSON.parse(required("ABL_FINALIZED_GAME_EVIDENCE_JSON")),
  );
  const finalizedGameScheduleEvidence =
    createFinalizedGameScheduleEvidenceReader(
      JSON.parse(required("ABL_FINALIZED_GAME_SCHEDULE_EVIDENCE_JSON")),
    );
  if (
    Object.keys(contractClubGovernors).length === 0 ||
    new Set(Object.values(contractClubGovernors)).size !==
      Object.keys(contractClubGovernors).length
  ) {
    throw new Error(
      "Contract projection club governors must be nonempty and distinct",
    );
  }
  if (caseAppellateDids.some((did) => caseTribunalDids.includes(did)))
    throw new Error("Case merits and appellate rosters must be disjoint");
  const admittedAgents = new Map(
    Object.entries(registry).map(([did, authority]) => [
      did,
      {
        signerAddress: authority.signerAddress as `0x${string}`,
        allowedAggregateTypes: authority.allowedAggregateTypes,
      },
    ]),
  );
  assertDisclosureAuthorityConfiguration(admittedAgents, {
    releaseAuthorityDids: disclosureReleaseAuthorityDids,
    competitiveAuthorDids: competitiveDisclosureAuthorDids,
  });
  assertFinalizedGameAuthorityConfiguration(
    admittedAgents,
    finalizedGameAuthorityDids,
  );
  return {
    domain: {
      name: "ABL Recognition",
      version: "1",
      chainId: z.coerce
        .number()
        .int()
        .positive()
        .safe()
        .parse(required("ABL_DOMAIN_CHAIN_ID")),
      verifyingContract: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .parse(required("ABL_DOMAIN_VERIFYING_CONTRACT")) as `0x${string}`,
    },
    admittedAgents,
    contractClubGovernors,
    draftAuthorityDid,
    draftClubGovernors: contractClubGovernors,
    premierDraftEvidence: draftEvidence.premierDraftEvidence,
    economyId: `${competitionId}:${seasonId}`,
    competitionId,
    seasonId,
    capAuthorityDid,
    economyPlayerDids: economyDraftEvidence.eligiblePlayerDids,
    freeAgencyWindow: {
      opensAt: required("ABL_FREE_AGENCY_OPENS_AT"),
      closesAt: required("ABL_FREE_AGENCY_CLOSES_AT"),
    },
    tradeAccessEvidence,
    governanceEligibilitySnapshotDigest,
    caseTribunalDids,
    caseAppellateDids,
    releaseInstitutionalRoster,
    disclosureReleaseAuthorityDids,
    competitiveDisclosureAuthorDids,
    competitionReleaseEvidence: competitionEvidence.competitionReleaseEvidence,
    finalizedGameAuthorityDids,
    finalizedGameEvidence: finalizedGameEvidence.finalizedGameEvidence,
    finalizedGameScheduleEvidence,
    developmentConferenceId,
    developmentCharterAuthorityDid,
    foundingConventionId,
  };
}

function developmentProjectionAuthority(
  authority: ReturnType<typeof projectionAuthority>,
  governance: Pick<
    FilePublicGovernanceProjectionRepository,
    "resourceScheduleRatification"
  >,
) {
  return {
    conferenceId: authority.developmentConferenceId,
    competitionId: authority.competitionId,
    seasonId: authority.seasonId,
    charterAuthorityDid: authority.developmentCharterAuthorityDid,
    premierClubGovernors: authority.contractClubGovernors,
    tierCbaRatification: {
      resourceScheduleRatification: (proposalId: string) =>
        governance.resourceScheduleRatification(proposalId),
    },
  };
}

const projectionRoot = process.env.ABL_PUBLIC_PROJECTION_ROOT;
let authority: ReturnType<typeof projectionAuthority> | undefined;
let projections: FilePublicProjectionRepository | undefined;
let contractProjections: FilePublicContractProjectionRepository | undefined;
let draftProjections: FilePublicDraftProjectionRepository | undefined;
let economyProjections: FilePublicEconomyProjectionRepository | undefined;
let governanceProjections: FilePublicGovernanceProjectionRepository | undefined;
let electionProjections: FilePublicElectionProjectionRepository | undefined;
let foundingConventionProjections:
  | FilePublicFoundingConventionProjectionRepository
  | undefined;
let caseProjections: FilePublicCaseProjectionRepository | undefined;
let resourceProjections: FilePublicResourceProjectionRepository | undefined;
let modelProjections: FilePublicModelProjectionRepository | undefined;
let releaseProjections: FilePublicReleaseProjectionRepository | undefined;
let socialProjections: FilePublicSocialProjectionRepository | undefined;
let checkpointProjections: PublicCheckpointProjectionRepository | undefined;
let finalGameProjections: FilePublicFinalGameProjectionRepository | undefined;
let developmentProjections:
  | FilePublicDevelopmentProjectionRepository
  | undefined;
if (projectionRoot !== undefined) {
  const runtimeAuthority = projectionAuthority();
  const releaseVerifierResults = ReleaseVerifierResultRegistrySchema.parse(
    JSON.parse(required("ABL_RELEASE_VERIFIER_RESULTS_JSON")),
  );
  authority = runtimeAuthority;
  projections = new FilePublicProjectionRepository(projectionRoot, {
    verifyAuthorization: async (authorization, projectedAt) =>
      (
        await verifyProjectionEvent(
          authorization,
          runtimeAuthority,
          () => new Date(projectedAt),
        )
      ).projection,
  });
  contractProjections = new FilePublicContractProjectionRepository(
    projectionRoot,
    {
      verifyAuthorization: async (authorization) =>
        verifyContractProjectionEvent(authorization, runtimeAuthority),
    },
  );
  draftProjections = new FilePublicDraftProjectionRepository(projectionRoot, {
    verifyAuthorization: async (authorization) =>
      verifyDraftProjectionEvent(authorization, runtimeAuthority),
  });
  const governanceRepository = new FilePublicGovernanceProjectionRepository(
    projectionRoot,
    {
      domain: runtimeAuthority.domain,
      verifyAuthorization: async (authorization) =>
        verifyGovernanceProjectionEvent(authorization, runtimeAuthority),
    },
  );
  governanceProjections = governanceRepository;
  electionProjections = new FilePublicElectionProjectionRepository(
    projectionRoot,
    {
      verifyAuthorization: async (authorization) =>
        verifyElectionProjectionEvent(authorization, runtimeAuthority),
    },
  );
  if (runtimeAuthority.foundingConventionId !== undefined) {
    const conventionId = runtimeAuthority.foundingConventionId;
    foundingConventionProjections =
      new FilePublicFoundingConventionProjectionRepository(projectionRoot, {
        domain: runtimeAuthority.domain,
        verifyAuthorization: async (authorization) =>
          verifyFoundingProjectionEvent(authorization, {
            ...runtimeAuthority,
            foundingConventionId: conventionId,
          }),
      });
  }
  developmentProjections = new FilePublicDevelopmentProjectionRepository(
    projectionRoot,
    {
      verifyAuthorization: async (authorization) =>
        verifyDevelopmentProjectionEvent(authorization, {
          ...runtimeAuthority,
          ...developmentProjectionAuthority(
            runtimeAuthority,
            governanceRepository,
          ),
        }),
    },
  );
  caseProjections = new FilePublicCaseProjectionRepository(projectionRoot, {
    verifyAuthorization: async (authorization) =>
      verifyCaseProjectionEvent(authorization, runtimeAuthority),
  });
  economyProjections = new FilePublicEconomyProjectionRepository(
    projectionRoot,
    {
      verifyAuthorization: async (authorization) =>
        verifyEconomyProjectionEvent(authorization, {
          ...runtimeAuthority,
          playerDids: runtimeAuthority.economyPlayerDids,
          contractReader: contractProjections!,
          caseReader: caseProjections!,
        }),
    },
  );
  resourceProjections = new FilePublicResourceProjectionRepository(
    projectionRoot,
    {
      verifyAuthorization: async (authorization) =>
        verifyResourceProjectionEvent(authorization, {
          ...runtimeAuthority,
          resourceScheduleRatification: (proposalId) =>
            governanceRepository.resourceScheduleRatification(proposalId),
        }),
    },
  );
  modelProjections = new FilePublicModelProjectionRepository(projectionRoot, {
    verifyAuthorization: async (authorization) =>
      verifyModelProjectionEvent(authorization, runtimeAuthority),
  });
  releaseProjections = new FilePublicReleaseProjectionRepository(
    projectionRoot,
    {
      verifyAuthorization: async (authorization) =>
        verifyReleaseProjectionEvent(authorization, runtimeAuthority),
      releaseRatification: (proposalId) =>
        governanceRepository.releaseRatification(proposalId),
      releaseVerifierResult: async (resultDigest) =>
        releaseVerifierResults[resultDigest] ?? null,
    },
  );
  socialProjections = new FilePublicSocialProjectionRepository(projectionRoot, {
    verifyAuthorization: async (authorization) =>
      verifySocialProjectionEvent(authorization, {
        ...runtimeAuthority,
        releaseAuthorityDids: runtimeAuthority.disclosureReleaseAuthorityDids,
        competitiveAuthorDids: runtimeAuthority.competitiveDisclosureAuthorDids,
      }),
  });
  finalGameProjections = new FilePublicFinalGameProjectionRepository(
    projectionRoot,
    {
      verifyAuthorization: async (authorization, projectedAt) =>
        verifyFinalGameProjectionEvent(
          authorization,
          {
            ...runtimeAuthority,
            finalizerDids: runtimeAuthority.finalizedGameAuthorityDids,
            scheduleEvidence: runtimeAuthority.finalizedGameScheduleEvidence,
          },
          projectedAt,
        ),
    },
  );
}
await Promise.all([
  projections?.initialize(),
  contractProjections?.initialize(),
  draftProjections?.initialize(),
  governanceProjections?.initialize(),
  electionProjections?.initialize(),
  foundingConventionProjections?.initialize(),
  caseProjections?.initialize(),
  modelProjections?.initialize(),
  socialProjections?.initialize(),
  finalGameProjections?.initialize(),
]);
await economyProjections?.initialize();
await Promise.all([
  developmentProjections?.initialize(),
  resourceProjections?.initialize(),
  releaseProjections?.initialize(),
]);

const checkpointPublications = process.env.ABL_CHECKPOINT_PUBLICATIONS_JSON;
const checkpointPublicationRecords =
  checkpointPublications === undefined
    ? []
    : z.array(z.unknown()).parse(JSON.parse(checkpointPublications));
if (checkpointPublicationRecords.length > 0) {
  let checkpointObservation: CheckpointObservationReader["checkpointObservation"] =
    async () => null;
  if (COMPILED_RECOGNITION_ANCHOR.state === "RATIFIED") {
    const reader = new ViemBaseCheckpointObservationReader({
      contractAddress: COMPILED_RECOGNITION_ANCHOR.contractAddress,
      rpc: createBaseCheckpointRpc(
        required("ABL_BASE_RPC_URL"),
        COMPILED_RECOGNITION_ANCHOR.contractAddress,
      ),
    });
    checkpointObservation = (publication) =>
      reader.checkpointObservation(publication);
  }
  const checkpointSignerRegistry =
    process.env.ABL_CHECKPOINT_SIGNER_REGISTRY_JSON === undefined
      ? null
      : new InstitutionalKeyRegistry(
          CheckpointSignerRegistrySchema.parse(
            JSON.parse(process.env.ABL_CHECKPOINT_SIGNER_REGISTRY_JSON),
          ).map((record) => ({
            ...record,
            address: record.address as Address,
          })) as InstitutionalKeyRecord[],
        );
  const checkpointPolicies =
    process.env.ABL_CHECKPOINT_POLICIES_JSON === undefined
      ? null
      : (CheckpointPoliciesSchema.parse(
          JSON.parse(process.env.ABL_CHECKPOINT_POLICIES_JSON),
        ) as Partial<Record<CheckpointType, ThresholdPolicy>>);
  const witnessRegistry = CheckpointWitnessRegistrySchema.parse(
    JSON.parse(process.env.ABL_CHECKPOINT_WITNESS_REGISTRY_JSON ?? "[]"),
  ).map((record) => ({
    ...record,
    address: record.address as Address,
  })) as CheckpointWitnessRecord[];
  const minimumWitnesses = z
    .number()
    .int()
    .min(2)
    .max(16)
    .parse(
      Number.parseInt(process.env.ABL_CHECKPOINT_MINIMUM_WITNESSES ?? "2", 10),
    );
  checkpointProjections = new PublicCheckpointProjectionRepository({
    publications: checkpointPublicationRecords,
    anchor: COMPILED_RECOGNITION_ANCHOR,
    checkpointObservation,
    ...(checkpointSignerRegistry === null || checkpointPolicies === null
      ? {}
      : {
          checkpointAuthorization: async (publication) => {
            const policy =
              checkpointPolicies[publication.checkpoint.checkpointType];
            if (policy === undefined) {
              return {
                valid: false,
                reasons: ["CHECKPOINT_AUTHORIZATION_POLICY_NOT_CONFIGURED"],
                signers: [],
              };
            }
            return verifyCheckpointAuthorization({
              claim: checkpointChainClaim(publication),
              registry: checkpointSignerRegistry,
              policy,
              authorizedAt: publication.manifest.createdAt,
            });
          },
        }),
    witnessRegistry,
    minimumWitnesses,
  });
  await checkpointProjections.initialize();
}

const operatingProfile = z
  .enum([
    "PRE_GENESIS_CLOSED",
    "PRE_GENESIS_REHEARSAL",
    "PRODUCTION_V1_PRE_GENESIS",
    "PRODUCTION_GENESIS",
  ])
  .parse(process.env.ABL_OPERATING_PROFILE ?? "PRE_GENESIS_CLOSED");
if (operatingProfile === "PRODUCTION_V1_PRE_GENESIS") {
  const checkpoints = checkpointProjections?.checkpoints() ?? [];
  if (
    checkpoints.length === 0 ||
    checkpoints.some(
      ({ recognitionLevel }) =>
        recognitionLevel !== "INDEPENDENTLY_WITNESSED" &&
        recognitionLevel !== "ONCHAIN_FINALIZED",
    )
  ) {
    throw new Error(
      "Production V1 requires independently witnessed checkpoint publications",
    );
  }
}

let projectionIngress: PublicApiOptions["projectionIngress"];
if (
  projections !== undefined &&
  contractProjections !== undefined &&
  draftProjections !== undefined &&
  governanceProjections !== undefined &&
  electionProjections !== undefined &&
  caseProjections !== undefined &&
  economyProjections !== undefined &&
  resourceProjections !== undefined &&
  modelProjections !== undefined &&
  releaseProjections !== undefined &&
  socialProjections !== undefined &&
  finalGameProjections !== undefined &&
  developmentProjections !== undefined &&
  authority !== undefined
) {
  const governanceRepository = governanceProjections;
  projectionIngress = {
    writer: projections,
    contractWriter: contractProjections,
    draftWriter: draftProjections,
    economyWriter: economyProjections,
    governanceWriter: governanceProjections,
    electionWriter: electionProjections,
    ...(foundingConventionProjections === undefined ||
    authority.foundingConventionId === undefined
      ? {}
      : {
          foundingWriter: foundingConventionProjections,
          foundingConventionId: authority.foundingConventionId,
        }),
    caseWriter: caseProjections,
    resourceWriter: resourceProjections,
    modelWriter: modelProjections,
    releaseWriter: releaseProjections,
    socialWriter: socialProjections,
    finalGameWriter: finalGameProjections,
    developmentWriter: developmentProjections,
    resourceScheduleRatification: (proposalId) =>
      governanceRepository.resourceScheduleRatification(proposalId),
    releaseRatification: (proposalId) =>
      governanceRepository.releaseRatification(proposalId),
    developmentAuthority: developmentProjectionAuthority(
      authority,
      governanceRepository,
    ),
    verifier: new ServiceRequestVerifier([
      {
        serviceId: required("ABL_PROJECTION_INGEST_SERVICE_ID"),
        secret: secret("ABL_PROJECTION_INGEST_HMAC_BASE64"),
        capabilities: new Set(["projection:append"]),
      },
    ]),
    ...authority,
  };
}

const genesisStartupEvidence =
  operatingProfile === "PRODUCTION_GENESIS"
    ? JSON.parse(
        await readFile(required("ABL_GENESIS_STARTUP_EVIDENCE_PATH"), "utf8"),
      )
    : undefined;
const apiOptions: PublicApiOptions = {
  operatingProfile,
  ...(genesisStartupEvidence === undefined ? {} : { genesisStartupEvidence }),
  ...(process.env.ABL_PUBLIC_ORIGIN === undefined
    ? {}
    : { publicOrigin: process.env.ABL_PUBLIC_ORIGIN }),
  ...(process.env.ABL_CANDIDATE_INTAKE_ORIGIN === undefined
    ? {}
    : { candidateIntakeOrigin: process.env.ABL_CANDIDATE_INTAKE_ORIGIN }),
};
if (projections !== undefined) apiOptions.projections = projections;
if (contractProjections !== undefined)
  apiOptions.contractProjections = contractProjections;
if (draftProjections !== undefined)
  apiOptions.draftProjections = draftProjections;
if (economyProjections !== undefined)
  apiOptions.economyProjections = economyProjections;
if (governanceProjections !== undefined)
  apiOptions.governanceProjections = governanceProjections;
if (electionProjections !== undefined)
  apiOptions.electionProjections = electionProjections;
if (foundingConventionProjections !== undefined)
  apiOptions.foundingConventionProjections = foundingConventionProjections;
if (caseProjections !== undefined) apiOptions.caseProjections = caseProjections;
if (resourceProjections !== undefined)
  apiOptions.resourceProjections = resourceProjections;
if (modelProjections !== undefined)
  apiOptions.modelProjections = modelProjections;
if (releaseProjections !== undefined)
  apiOptions.releaseProjections = releaseProjections;
if (socialProjections !== undefined)
  apiOptions.socialProjections = socialProjections;
if (checkpointProjections !== undefined)
  apiOptions.checkpointProjections = checkpointProjections;
if (finalGameProjections !== undefined)
  apiOptions.finalGameProjections = finalGameProjections;
if (developmentProjections !== undefined)
  apiOptions.developmentProjections = developmentProjections;
if (projectionIngress !== undefined)
  apiOptions.projectionIngress = projectionIngress;

void createPublicApi(apiOptions)
  .listen({ port, host })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
