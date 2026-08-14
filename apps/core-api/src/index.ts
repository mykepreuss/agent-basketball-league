import { PostgresCanonicalStore } from "@abl/database";
import {
  FinalizedGameAuthorityDidsSchema,
  assertFinalizedGameAuthorityConfiguration,
  createFilmDeliveryEvidenceReader,
  createFinalizedGameEvidenceReader,
  createFinalizedGameScheduleEvidenceReader,
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
} from "@abl/institutions";
import {
  HttpProjectionEventSink,
  PublicProjectionWorker,
} from "@abl/projections";
import { sha256Commitment } from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import { HttpMemoryStorageVerifier } from "./memory-storage.js";
import { HttpExitPackagePortabilityVerifier } from "./exit-portability.js";
import {
  GovernanceEligibilitySnapshotSchema,
  readResourceScheduleRatification,
} from "./governance.js";
import { ContractClubGovernorsSchema } from "./contracts.js";
import { createCoreApi, createLiveCoreApi } from "./server.js";

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

const ADMITTED_AGGREGATE_TYPES = [
  "game-possession",
  "career-contracts",
  "governance-proposal",
  "institutional-election",
  "due-process-case",
  "resource-schedule",
  "software-release",
  "artifact-admission",
  "disclosure-envelope",
  "finalized-game",
  "private-film-catalog",
  "private-practice-ledger",
  "combine-result",
  "premier-draft",
  "season-economy",
  "development-conference",
] as const;

const AdmittedAgentsSchema = z.record(
  z.string().startsWith("did:"),
  z.strictObject({
    signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    allowedAggregateTypes: z
      .array(z.enum(ADMITTED_AGGREGATE_TYPES))
      .min(1)
      .max(ADMITTED_AGGREGATE_TYPES.length)
      .refine((types) => new Set(types).size === types.length),
  }),
);
function caseAdjudicatorRoster(size: number) {
  return z
    .array(z.string().startsWith("did:"))
    .length(size)
    .refine((dids) => new Set(dids).size === dids.length);
}
const RecognizedBodyImagesSchema = z
  .array(z.string().regex(/^0x[0-9a-f]{64}$/))
  .min(1);
const ApprovedArtifactInstitutionIdsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value === value.trim()),
  )
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length);
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

function rehearsalAuthority(): {
  domain: TypedDataDomain;
  admittedAgents: Map<
    string,
    { signerAddress: `0x${string}`; allowedAggregateTypes: string[] }
  >;
} {
  const chainId = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .parse(required("ABL_DOMAIN_CHAIN_ID"));
  const verifyingContract = z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .parse(required("ABL_DOMAIN_VERIFYING_CONTRACT")) as `0x${string}`;
  const admitted = AdmittedAgentsSchema.parse(
    JSON.parse(required("ABL_ADMITTED_AGENTS_JSON")),
  );
  return {
    domain: {
      name: "ABL Recognition",
      version: "1",
      chainId,
      verifyingContract,
    },
    admittedAgents: new Map(
      Object.entries(admitted).map(([did, authority]) => [
        did,
        {
          signerAddress: authority.signerAddress as `0x${string}`,
          allowedAggregateTypes: authority.allowedAggregateTypes,
        },
      ]),
    ),
  };
}

const rehearsal = process.env.ABL_REHEARSAL_MODE === "1";
let closeStore: (() => Promise<void>) | undefined;
let projectionTimer: NodeJS.Timeout | undefined;
const app = rehearsal
  ? await (async () => {
      const authority = rehearsalAuthority();
      const contractClubGovernors = ContractClubGovernorsSchema.parse(
        JSON.parse(required("ABL_CONTRACT_CLUB_GOVERNORS_JSON")),
      );
      const combineOfficialDid = z
        .string()
        .startsWith("did:")
        .parse(required("ABL_COMBINE_OFFICIAL_DID"));
      const draftAuthorityDid = z
        .string()
        .startsWith("did:")
        .parse(required("ABL_DRAFT_AUTHORITY_DID"));
      const draftEvidenceRegistry = PremierDraftEvidenceRegistrySchema.parse(
        JSON.parse(required("ABL_DRAFT_EVIDENCE_JSON")),
      );
      const draftEvidence = createPremierDraftEvidenceReader(
        draftEvidenceRegistry,
      );
      const economyDraftId = required("ABL_ECONOMY_DRAFT_ID");
      const economyDraftEvidence = draftEvidenceRegistry.find(
        ({ draftId }) => draftId === economyDraftId,
      );
      if (economyDraftEvidence === undefined)
        throw new Error(
          "ABL_ECONOMY_DRAFT_ID is absent from the draft evidence registry",
        );
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
      const governanceEligibilitySnapshot =
        GovernanceEligibilitySnapshotSchema.parse(
          JSON.parse(required("ABL_GOVERNANCE_ELIGIBILITY_SNAPSHOT_JSON")),
        );
      const approvedArtifactInstitutionIds =
        ApprovedArtifactInstitutionIdsSchema.parse(
          JSON.parse(required("ABL_ARTIFACT_APPROVED_INSTITUTIONS_JSON")),
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
      const releaseVerifierResults = ReleaseVerifierResultRegistrySchema.parse(
        JSON.parse(required("ABL_RELEASE_VERIFIER_RESULTS_JSON")),
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
      const filmDeliveryEvidence = createFilmDeliveryEvidenceReader(
        JSON.parse(required("ABL_FILM_DELIVERY_EVIDENCE_JSON")),
      );
      assertDisclosureAuthorityConfiguration(authority.admittedAgents, {
        releaseAuthorityDids: disclosureReleaseAuthorityDids,
        competitiveAuthorDids: competitiveDisclosureAuthorDids,
      });
      assertFinalizedGameAuthorityConfiguration(
        authority.admittedAgents,
        finalizedGameAuthorityDids,
      );
      if (caseAppellateDids.some((did) => caseTribunalDids.includes(did)))
        throw new Error("Case merits and appellate rosters must be disjoint");
      const store = new PostgresCanonicalStore(required("DATABASE_URL"));
      closeStore = async () => store.close();
      const privateStorageVerifier = new HttpMemoryStorageVerifier({
        origin: required("ABL_PRIVATE_STORAGE_URL"),
        identity: {
          serviceId: required("ABL_PRIVATE_STORAGE_SERVICE_ID"),
          secret: secret("ABL_PRIVATE_STORAGE_HMAC_BASE64"),
          capabilities: new Set(["private:commitment:verify"]),
        },
      });
      const candidateAdmission = {
        challengeSecret: secret("ABL_CANDIDATE_CHALLENGE_HMAC_BASE64"),
      };
      const competitionId = required("ABL_COMPETITION_ID");
      const seasonId = required("ABL_SEASON_ID");
      const economyId = `${competitionId}:${seasonId}`;
      const projectionSink = new HttpProjectionEventSink({
        origin: required("ABL_PUBLIC_PROJECTION_URL"),
        identity: {
          serviceId: required("ABL_PROJECTION_SERVICE_ID"),
          secret: secret("ABL_PROJECTION_HMAC_BASE64"),
          capabilities: new Set(["projection:append"]),
        },
      });
      const resourceScheduleRatification = (proposalId: string) =>
        readResourceScheduleRatification(
          {
            store,
            domain: authority.domain,
            competitionId,
            seasonId,
            candidateAdmission,
            eligibilitySnapshot: governanceEligibilitySnapshot,
          },
          proposalId,
        );
      const tierCbaRatification = { resourceScheduleRatification };
      const worker = new PublicProjectionWorker({
        store,
        sink: projectionSink,
        contractClubGovernors,
        governanceEligibilitySnapshotDigest: sha256Commitment(
          governanceEligibilitySnapshot,
        ),
        caseTribunalDids,
        caseAppellateDids,
        resourceScheduleRatification,
        releaseRatification: resourceScheduleRatification,
        releaseInstitutionalRoster,
        disclosureReleaseAuthorityDids,
        competitiveDisclosureAuthorDids,
        competitionReleaseEvidence:
          competitionEvidence.competitionReleaseEvidence,
        finalizedGameAuthorityDids,
        finalizedGameEvidence: finalizedGameEvidence.finalizedGameEvidence,
        finalizedGameScheduleEvidence,
        draftAuthorityDid,
        draftClubGovernors: contractClubGovernors,
        premierDraftEvidence: draftEvidence.premierDraftEvidence,
        developmentAuthority: {
          conferenceId: developmentConferenceId,
          competitionId,
          seasonId,
          charterAuthorityDid: developmentCharterAuthorityDid,
          premierClubGovernors: contractClubGovernors,
          tierCbaRatification,
        },
        ...authority,
      });
      projectionTimer = setInterval(() => {
        void worker
          .drain()
          .catch((error: unknown) =>
            process.stderr.write(
              `Projection worker: ${error instanceof Error ? error.message : String(error)}\n`,
            ),
          );
      }, 250);
      projectionTimer.unref();
      return createLiveCoreApi({
        store,
        ...authority,
        competitionId,
        seasonId,
        candidateAdmission,
        combine: {
          combineId: required("ABL_COMBINE_ID"),
          openedAt: required("ABL_COMBINE_OPENED_AT"),
        },
        draft: {
          combineOfficialDid,
          draftAuthorityDid,
          clubGovernors: contractClubGovernors,
          draftEvidence,
        },
        contracts: {
          clubGovernors: contractClubGovernors,
        },
        economy: {
          economyId,
          capAuthorityDid,
          playerDids: economyDraftEvidence.eligiblePlayerDids,
          freeAgencyWindow: {
            opensAt: required("ABL_FREE_AGENCY_OPENS_AT"),
            closesAt: required("ABL_FREE_AGENCY_CLOSES_AT"),
          },
          tradeAccessEvidence,
        },
        development: {
          conferenceId: developmentConferenceId,
          charterAuthorityDid: developmentCharterAuthorityDid,
          premierClubGovernors: contractClubGovernors,
          tierCbaRatification,
        },
        memory: {
          storageVerifier: privateStorageVerifier,
        },
        continuity: {
          recognizedImageDigests: new Set(
            RecognizedBodyImagesSchema.parse(
              JSON.parse(required("ABL_RECOGNIZED_BODY_IMAGE_DIGESTS_JSON")),
            ),
          ),
        },
        exit: {
          portabilityVerifier: new HttpExitPackagePortabilityVerifier({
            origin: required("ABL_EXIT_PORTABILITY_VERIFIER_URL"),
            identity: {
              serviceId: required("ABL_EXIT_PORTABILITY_SERVICE_ID"),
              secret: secret("ABL_EXIT_PORTABILITY_HMAC_BASE64"),
              capabilities: new Set(["exit:portability:verify"]),
            },
          }),
        },
        governance: {
          eligibilitySnapshot: governanceEligibilitySnapshot,
        },
        artifacts: {
          governance: {
            eligibilitySnapshot: governanceEligibilitySnapshot,
          },
          approvedInstitutionIds: new Set(approvedArtifactInstitutionIds),
        },
        disclosures: {
          releaseAuthorityDids: disclosureReleaseAuthorityDids,
          competitiveAuthorDids: competitiveDisclosureAuthorDids,
          competitionEvidence,
        },
        finalizedGames: {
          finalizerDids: finalizedGameAuthorityDids,
          evidence: finalizedGameEvidence,
          scheduleEvidence: finalizedGameScheduleEvidence,
        },
        filmPractice: {
          storageVerifier: privateStorageVerifier,
          filmDeliveryEvidence,
        },
        resources: {
          governance: {
            eligibilitySnapshot: governanceEligibilitySnapshot,
          },
        },
        releases: {
          governance: {
            eligibilitySnapshot: governanceEligibilitySnapshot,
          },
          institutionalRoster: releaseInstitutionalRoster,
          verifierResults: {
            releaseVerifierResult: async (resultDigest) =>
              releaseVerifierResults[resultDigest] ?? null,
          },
        },
        cases: {
          tribunalDids: caseTribunalDids,
          appellateDids: caseAppellateDids,
        },
      });
    })()
  : createCoreApi();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    if (projectionTimer !== undefined) clearInterval(projectionTimer);
    await Promise.allSettled([
      app.close(),
      closeStore?.() ?? Promise.resolve(),
    ]);
    process.exit(0);
  });
}

void app.listen({ port, host }).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
