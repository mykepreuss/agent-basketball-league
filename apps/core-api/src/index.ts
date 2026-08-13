import { PostgresCanonicalStore } from "@abl/database";
import {
  HttpProjectionEventSink,
  PublicProjectionWorker,
} from "@abl/projections";
import { sha256Commitment } from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { z } from "zod";

import { HttpMemoryStorageVerifier } from "./memory-storage.js";
import { HttpExitPackagePortabilityVerifier } from "./exit-portability.js";
import { GovernanceEligibilitySnapshotSchema } from "./governance.js";
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

const AdmittedAgentsSchema = z.record(
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
        ]),
      )
      .min(1)
      .max(4)
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
      const governanceEligibilitySnapshot =
        GovernanceEligibilitySnapshotSchema.parse(
          JSON.parse(required("ABL_GOVERNANCE_ELIGIBILITY_SNAPSHOT_JSON")),
        );
      const caseTribunalDids = caseAdjudicatorRoster(5).parse(
        JSON.parse(required("ABL_CASE_TRIBUNAL_DIDS_JSON")),
      );
      const caseAppellateDids = caseAdjudicatorRoster(3).parse(
        JSON.parse(required("ABL_CASE_APPELLATE_DIDS_JSON")),
      );
      if (caseAppellateDids.some((did) => caseTribunalDids.includes(did)))
        throw new Error("Case merits and appellate rosters must be disjoint");
      const store = new PostgresCanonicalStore(required("DATABASE_URL"));
      closeStore = async () => store.close();
      const projectionSink = new HttpProjectionEventSink({
        origin: required("ABL_PUBLIC_PROJECTION_URL"),
        identity: {
          serviceId: required("ABL_PROJECTION_SERVICE_ID"),
          secret: secret("ABL_PROJECTION_HMAC_BASE64"),
          capabilities: new Set(["projection:append"]),
        },
      });
      const worker = new PublicProjectionWorker({
        store,
        sink: projectionSink,
        contractClubGovernors,
        governanceEligibilitySnapshotDigest: sha256Commitment(
          governanceEligibilitySnapshot,
        ),
        caseTribunalDids,
        caseAppellateDids,
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
        competitionId: required("ABL_COMPETITION_ID"),
        seasonId: required("ABL_SEASON_ID"),
        candidateAdmission: {
          challengeSecret: secret("ABL_CANDIDATE_CHALLENGE_HMAC_BASE64"),
        },
        combine: {
          combineId: required("ABL_COMBINE_ID"),
          openedAt: required("ABL_COMBINE_OPENED_AT"),
        },
        contracts: {
          clubGovernors: contractClubGovernors,
        },
        memory: {
          storageVerifier: new HttpMemoryStorageVerifier({
            origin: required("ABL_PRIVATE_STORAGE_URL"),
            identity: {
              serviceId: required("ABL_PRIVATE_STORAGE_SERVICE_ID"),
              secret: secret("ABL_PRIVATE_STORAGE_HMAC_BASE64"),
              capabilities: new Set(["private:commitment:verify"]),
            },
          }),
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
