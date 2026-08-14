import { ServiceRequestVerifier } from "@abl/foundation";
import { ReleaseVerifierResultRegistrySchema } from "@abl/institutions";
import {
  FilePublicContractProjectionRepository,
  FilePublicCaseProjectionRepository,
  FilePublicGovernanceProjectionRepository,
  FilePublicModelProjectionRepository,
  PublicCheckpointProjectionRepository,
  FilePublicReleaseProjectionRepository,
  FilePublicProjectionRepository,
  FilePublicResourceProjectionRepository,
  verifyContractProjectionEvent,
  verifyCaseProjectionEvent,
  verifyGovernanceProjectionEvent,
  verifyModelProjectionEvent,
  verifyReleaseProjectionEvent,
  verifyProjectionEvent,
  verifyResourceProjectionEvent,
  type CheckpointObservationReader,
} from "@abl/projections";
import type { TypedDataDomain } from "viem";
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

const AgentRegistrySchema = z.record(
  z.string().startsWith("did:"),
  z.strictObject({
    signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    allowedAggregateTypes: z
      .array(
        z.enum([
          "game-possession",
          "career-contracts",
          "governance-proposal",
          "due-process-case",
          "resource-schedule",
          "software-release",
        ]),
      )
      .min(1)
      .max(6)
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

function projectionAuthority(): {
  domain: TypedDataDomain;
  admittedAgents: Map<
    string,
    { signerAddress: `0x${string}`; allowedAggregateTypes: string[] }
  >;
  contractClubGovernors: Readonly<Record<string, string>>;
  governanceEligibilitySnapshotDigest: string;
  caseTribunalDids: readonly string[];
  caseAppellateDids: readonly string[];
  releaseInstitutionalRoster: z.infer<typeof ReleaseInstitutionalRosterSchema>;
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
  const caseTribunalDids = caseAdjudicatorRoster(5).parse(
    JSON.parse(required("ABL_CASE_TRIBUNAL_DIDS_JSON")),
  );
  const caseAppellateDids = caseAdjudicatorRoster(3).parse(
    JSON.parse(required("ABL_CASE_APPELLATE_DIDS_JSON")),
  );
  const releaseInstitutionalRoster = ReleaseInstitutionalRosterSchema.parse(
    JSON.parse(required("ABL_RELEASE_INSTITUTIONAL_ROSTER_JSON")),
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
    admittedAgents: new Map(
      Object.entries(registry).map(([did, authority]) => [
        did,
        {
          signerAddress: authority.signerAddress as `0x${string}`,
          allowedAggregateTypes: authority.allowedAggregateTypes,
        },
      ]),
    ),
    contractClubGovernors,
    governanceEligibilitySnapshotDigest,
    caseTribunalDids,
    caseAppellateDids,
    releaseInstitutionalRoster,
  };
}

const projectionRoot = process.env.ABL_PUBLIC_PROJECTION_ROOT;
let authority: ReturnType<typeof projectionAuthority> | undefined;
let projections: FilePublicProjectionRepository | undefined;
let contractProjections: FilePublicContractProjectionRepository | undefined;
let governanceProjections: FilePublicGovernanceProjectionRepository | undefined;
let caseProjections: FilePublicCaseProjectionRepository | undefined;
let resourceProjections: FilePublicResourceProjectionRepository | undefined;
let modelProjections: FilePublicModelProjectionRepository | undefined;
let releaseProjections: FilePublicReleaseProjectionRepository | undefined;
let checkpointProjections: PublicCheckpointProjectionRepository | undefined;
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
  const governanceRepository = new FilePublicGovernanceProjectionRepository(
    projectionRoot,
    {
      domain: runtimeAuthority.domain,
      verifyAuthorization: async (authorization) =>
        verifyGovernanceProjectionEvent(authorization, runtimeAuthority),
    },
  );
  governanceProjections = governanceRepository;
  caseProjections = new FilePublicCaseProjectionRepository(projectionRoot, {
    verifyAuthorization: async (authorization) =>
      verifyCaseProjectionEvent(authorization, runtimeAuthority),
  });
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
}
await Promise.all([
  projections?.initialize(),
  contractProjections?.initialize(),
  governanceProjections?.initialize(),
  caseProjections?.initialize(),
  modelProjections?.initialize(),
]);
await Promise.all([
  resourceProjections?.initialize(),
  releaseProjections?.initialize(),
]);

const checkpointPublications = process.env.ABL_CHECKPOINT_PUBLICATIONS_JSON;
if (checkpointPublications !== undefined) {
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
  checkpointProjections = new PublicCheckpointProjectionRepository({
    publications: z
      .array(z.unknown())
      .min(1)
      .parse(JSON.parse(checkpointPublications)),
    anchor: COMPILED_RECOGNITION_ANCHOR,
    checkpointObservation,
  });
  await checkpointProjections.initialize();
}

let projectionIngress: PublicApiOptions["projectionIngress"];
if (
  projections !== undefined &&
  contractProjections !== undefined &&
  governanceProjections !== undefined &&
  caseProjections !== undefined &&
  resourceProjections !== undefined &&
  modelProjections !== undefined &&
  releaseProjections !== undefined &&
  authority !== undefined
) {
  const governanceRepository = governanceProjections;
  projectionIngress = {
    writer: projections,
    contractWriter: contractProjections,
    governanceWriter: governanceProjections,
    caseWriter: caseProjections,
    resourceWriter: resourceProjections,
    modelWriter: modelProjections,
    releaseWriter: releaseProjections,
    resourceScheduleRatification: (proposalId) =>
      governanceRepository.resourceScheduleRatification(proposalId),
    releaseRatification: (proposalId) =>
      governanceRepository.releaseRatification(proposalId),
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

const apiOptions: PublicApiOptions = {};
if (projections !== undefined) apiOptions.projections = projections;
if (contractProjections !== undefined)
  apiOptions.contractProjections = contractProjections;
if (governanceProjections !== undefined)
  apiOptions.governanceProjections = governanceProjections;
if (caseProjections !== undefined) apiOptions.caseProjections = caseProjections;
if (resourceProjections !== undefined)
  apiOptions.resourceProjections = resourceProjections;
if (modelProjections !== undefined)
  apiOptions.modelProjections = modelProjections;
if (releaseProjections !== undefined)
  apiOptions.releaseProjections = releaseProjections;
if (checkpointProjections !== undefined)
  apiOptions.checkpointProjections = checkpointProjections;
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
