import { ServiceRequestVerifier } from "@abl/foundation";
import {
  FilePublicContractProjectionRepository,
  FilePublicCaseProjectionRepository,
  FilePublicGovernanceProjectionRepository,
  FilePublicModelProjectionRepository,
  FilePublicProjectionRepository,
  FilePublicResourceProjectionRepository,
  verifyContractProjectionEvent,
  verifyCaseProjectionEvent,
  verifyGovernanceProjectionEvent,
  verifyModelProjectionEvent,
  verifyProjectionEvent,
  verifyResourceProjectionEvent,
} from "@abl/projections";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import { createPublicApi, type PublicApiOptions } from "./server.js";

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
        ]),
      )
      .min(1)
      .max(5)
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
if (projectionRoot !== undefined) {
  const runtimeAuthority = projectionAuthority();
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
}
await Promise.all([
  projections?.initialize(),
  contractProjections?.initialize(),
  governanceProjections?.initialize(),
  caseProjections?.initialize(),
  modelProjections?.initialize(),
]);
await resourceProjections?.initialize();

let projectionIngress: PublicApiOptions["projectionIngress"];
if (
  projections !== undefined &&
  contractProjections !== undefined &&
  governanceProjections !== undefined &&
  caseProjections !== undefined &&
  resourceProjections !== undefined &&
  modelProjections !== undefined &&
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
    resourceScheduleRatification: (proposalId) =>
      governanceRepository.resourceScheduleRatification(proposalId),
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
