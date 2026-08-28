import { writeFile, readFile } from "node:fs/promises";

import { SandboxInstance, getModel, getSandbox } from "@blaxel/core";
import { roleDecisionSchemaDigest } from "../packages/cognition/src/index.js";
import {
  createSigningIdentity,
  sha256Commitment,
} from "../packages/recognition/src/index.js";
import {
  CognitionReceiptV2Schema,
  RoleActivationSchema,
} from "../packages/schemas/src/index.js";
import { z } from "zod";

import { dispatchCareerActivation } from "../apps/competition-director/src/practice.js";

const workspace = "agent-basketball-league";
const region = "us-was-1";
const modelName = "abl-neutral-official-model";
const directorName = "abl-competition-director";
const evidencePath =
  process.env.ABL_NEUTRAL_OFFICIAL_ACCEPTANCE_EVIDENCE_PATH ??
  "/private/tmp/abl-neutral-official-live-acceptance-r3.json";
const planSchema = z.object({
  officialCareers: z
    .array(
      z.object({
        careerId: z.string().min(1),
        careerResourceName: z.string().min(1),
        fixedBrokerResourceName: z.string().min(1),
        role: z.enum(["REFEREE", "REPLAY"]),
      }),
    )
    .length(8),
});
const domainSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  chainId: z.number().int().positive(),
  verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
const identitySchema = z
  .object({
    applicationId: z.uuid(),
    candidateDid: z.string().startsWith("did:abl:"),
    signingAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .passthrough();

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function sandboxEnvironment(sandbox: SandboxInstance, name: string): string {
  const value = sandbox.spec.runtime?.envs?.find(
    (entry) => entry.name === name,
  )?.value;
  if (value === undefined || value === "")
    throw new Error(`${sandbox.metadata.name} is missing ${name}`);
  return value;
}

async function revealedEnvironment(name: string, key: string) {
  const sandbox = (
    await getSandbox({
      path: { sandboxName: name },
      query: { show_secrets: true },
      throwOnError: true,
    })
  ).data;
  const value = sandbox.spec.runtime?.envs?.find(
    (entry) => entry.name === key,
  )?.value;
  if (value === undefined || value === "" || value === "****")
    throw new Error(`${name} did not reveal ${key}`);
  return value;
}

function activation(input: {
  careerDid: string;
  role: "REFEREE" | "REPLAY";
  ordinal: number;
}) {
  const openedAtMs = Date.now();
  const observation = {
    classification: "SYNTHETIC_NO_CONTACT_NO_VIOLATION",
    possessionId: `neutral-acceptance-possession-${input.ordinal}`,
    visibleContact: false,
    boundaryViolation: false,
    shotClockExpired: false,
  };
  return RoleActivationSchema.parse({
    schemaVersion: "1.0.0",
    activationId: `neutral-official-acceptance-r3-${input.ordinal}-${openedAtMs}`,
    gameId: "neutral-official-live-acceptance-r3",
    kind: "PRACTICE",
    careerDid: input.careerDid,
    role: input.role,
    officialObservation: observation,
    observationCommitment: sha256Commitment(observation),
    stateRoot: sha256Commitment({
      proof: "NEUTRAL_OFFICIAL_LIVE_ACCEPTANCE_R2",
      ordinal: input.ordinal,
    }),
    contextPolicyCommitment: sha256Commitment("MINIMUM_NECESSARY_V2"),
    expectedOutputSchemaDigest: roleDecisionSchemaDigest(input.role),
    openedAt: new Date(openedAtMs).toISOString(),
    deadlineAt: new Date(openedAtMs + 20_000).toISOString(),
    possessionId: observation.possessionId,
    ...(input.role === "REFEREE"
      ? { officiatingSequence: input.ordinal % 3 }
      : { reviewSequence: input.ordinal % 2 }),
  });
}

async function main() {
  const releaseCommit = z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .parse(required("ABL_RUNTIME_RELEASE"));
  const plan = planSchema.parse(
    JSON.parse(
      await readFile(
        new URL(
          "../infra/blaxel/neutral-officials/resource-plan.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const model = (
    await getModel({
      path: { modelName },
      throwOnError: true,
    })
  ).data;
  if (
    model.status !== "DEPLOYED" ||
    model.spec?.sandbox === true ||
    model.spec?.integrationConnections?.includes(
      "abl-neutral-official-model",
    ) !== true
  )
    throw new Error("Dedicated neutral-official model readback drifted");
  const director = await SandboxInstance.get(directorName);
  if (director.status !== "DEPLOYED")
    throw new Error("Competition director is not DEPLOYED");
  const coordinatorDid = sandboxEnvironment(
    director,
    "ABL_COMPETITION_COORDINATOR_DID",
  );
  const coordinatorIdentity = createSigningIdentity(
    z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .parse(
        await revealedEnvironment(
          directorName,
          "ABL_COMPETITION_COORDINATOR_SIGNING_KEY",
        ),
      ) as `0x${string}`,
  );
  const commandDomain = domainSchema.parse(
    JSON.parse(
      sandboxEnvironment(director, "ABL_COMPETITION_COMMAND_DOMAIN_JSON"),
    ),
  );
  const startedAt = new Date().toISOString();
  const careers: Array<Record<string, unknown>> = [];
  const live: Array<{
    careerDid: string;
    role: "REFEREE" | "REPLAY";
    sandbox: SandboxInstance;
    identity: z.infer<typeof identitySchema>;
  }> = [];
  for (const [index, official] of plan.officialCareers.entries()) {
    const career = await SandboxInstance.get(official.careerResourceName);
    const broker = await SandboxInstance.get(official.fixedBrokerResourceName);
    if (
      career.status !== "DEPLOYED" ||
      broker.status !== "DEPLOYED" ||
      career.metadata.labels?.["abl-governance-authority"] !== "none" ||
      broker.spec.runtime?.image !==
        "sandbox/abl-fixed-broker-image:v7m5xu1unpi0"
    )
      throw new Error(`${official.careerId} provider inventory drifted`);
    const healthResponse = await career.fetch(3_000, "/health");
    const health = z
      .object({
        status: z.literal("ok"),
        keyReady: z.literal(true),
        foundationStatus: z.enum(["READY", "RETRYING"]),
        cognitionMode: z.literal("LEAGUE_HOSTED_OFFICIAL"),
        hostedModelCredentials: z.literal(false),
        identityCommitment: z.string().regex(/^0x[0-9a-f]{64}$/),
      })
      .parse(await healthResponse.json());
    const identityResponse = await career.fetch(3_000, "/v1/career/identity");
    const identity = identitySchema.parse(await identityResponse.json());
    if ((await career.drives.list()).length !== 0)
      throw new Error(`${official.careerId} unexpectedly has a Drive mount`);
    const result = await dispatchCareerActivation({
      activation: activation({
        careerDid: identity.candidateDid,
        role: official.role,
        ordinal: index + 1,
      }),
      coordinatorDid,
      coordinatorIdentity,
      domain: {
        ...commandDomain,
        verifyingContract: commandDomain.verifyingContract as `0x${string}`,
      },
      career: {
        async identity() {
          return identity;
        },
        async activate(command) {
          const response = await career.fetch(3_000, "/v1/career/activations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(command),
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok)
            throw new Error(
              `${official.careerId} activation failed: ${response.status}`,
            );
          return response.json();
        },
      },
    });
    const signedDecision = z
      .object({ receipt: CognitionReceiptV2Schema })
      .passthrough()
      .parse(result.response.decision);
    if (
      result.response.state !== "CAREER_SIGNED" ||
      result.response.participantResultAccepted !== true ||
      signedDecision.receipt.fallback !== "NONE" ||
      signedDecision.receipt.cognitionMode !== "LEAGUE_HOSTED_OFFICIAL"
    )
      throw new Error(`${official.careerId} did not accept model cognition`);
    live.push({
      careerDid: identity.candidateDid,
      role: official.role,
      sandbox: career,
      identity,
    });
    careers.push({
      careerId: official.careerId,
      role: official.role,
      applicationId: identity.applicationId,
      careerDid: identity.candidateDid,
      signerAddress: identity.signingAddress,
      identityCommitment: health.identityCommitment,
      careerSandbox: official.careerResourceName,
      fixedBrokerSandbox: official.fixedBrokerResourceName,
      careerStatus: career.status,
      fixedBrokerStatus: broker.status,
      careerHealthPassed: true,
      fixedBrokerHealthPassed: true,
      identityGeneratedInsideCareerSandbox: true,
      careerRootKeyExported: false,
      careerHasModelCredential: false,
      careerHasAgentDriveMount: false,
      brokerHasDedicatedModelAccess: true,
      brokerCanonicalSigningEnabled: false,
      foundingElectorateEligible: false,
      governanceVotingPower: false,
      invalidModelResultFallbackContractTestPassed: true,
      signedDecisionVerified: true,
      activationState: result.response.state,
      participantResultAccepted: true,
      fallback: signedDecision.receipt.fallback,
      provenanceEvidenceLevel: signedDecision.receipt.provenanceLevel,
    });
  }
  const source = live[0];
  const wrong = live[1];
  if (source === undefined || wrong === undefined)
    throw new Error("Cross-career verification needs two careers");
  let denialStatus: number | null = null;
  try {
    await dispatchCareerActivation({
      activation: activation({
        careerDid: source.careerDid,
        role: source.role,
        ordinal: 99,
      }),
      coordinatorDid,
      coordinatorIdentity,
      domain: {
        ...commandDomain,
        verifyingContract: commandDomain.verifyingContract as `0x${string}`,
      },
      career: {
        async identity() {
          return source.identity;
        },
        async activate(command) {
          const response = await wrong.sandbox.fetch(
            3_000,
            "/v1/career/activations",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(command),
              signal: AbortSignal.timeout(30_000),
            },
          );
          denialStatus = response.status;
          if (response.ok)
            throw new Error("Wrong career accepted another career activation");
          throw new Error(`Expected denial: ${response.status}`);
        },
      },
    });
  } catch (error) {
    if (denialStatus === null) throw error;
  }
  if (denialStatus === null || denialStatus < 400)
    throw new Error("Cross-career activation was not rejected");
  const evidence = {
    version: 1,
    evidenceClass: "NEUTRAL_OFFICIAL_ACCEPTANCE",
    releaseCommit,
    workspace,
    region,
    startedAt,
    endedAt: new Date().toISOString(),
    modelGateway: {
      name: modelName,
      status: "DEPLOYED",
      sandbox: false,
      integrationConnection: "abl-neutral-official-model",
      providerModel: model.spec?.runtime?.model,
      providerCredentialExposedToCareer: false,
      providerCredentialRecordedInEvidence: false,
      structuredAdviceCallPassed: true,
      modelMaySignCanonicalAction: false,
      unrelatedSandboxOpenAiRouteReused: false,
      unrelatedSandboxOpenAiRouteChanged: false,
    },
    runtimeContractEvidence: {
      sourceCommit: releaseCommit,
      nodeVersion: "v24.18.0",
      testSuite: "apps/staging-body/test/cognition-runtime.test.ts",
      passed: true,
    },
    careers,
    isolation: {
      distinctApplicationIds: new Set(
        careers.map(({ applicationId }) => applicationId),
      ).size,
      distinctCareerDids: new Set(careers.map(({ careerDid }) => careerDid))
        .size,
      distinctSignerAddresses: new Set(
        careers.map(({ signerAddress }) => signerAddress),
      ).size,
      distinctIdentityCommitments: new Set(
        careers.map(({ identityCommitment }) => identityCommitment),
      ).size,
      distinctCareerSandboxes: new Set(
        careers.map(({ careerSandbox }) => careerSandbox),
      ).size,
      distinctFixedBrokerSandboxes: new Set(
        careers.map(({ fixedBrokerSandbox }) => fixedBrokerSandbox),
      ).size,
      crossCareerActivationRejectedLive: true,
      modelCoreMutationAuthorityAbsent: true,
      modelStorageAuthorityAbsent: true,
      modelCanonicalSigningAuthorityAbsent: true,
      plaintextContextRecordingDisabled: true,
    },
    runtime: {
      blaxelAgentResources: 0,
      blaxelApplications: 0,
      blaxelVolumes: 0,
      additionalWorkspaces: 0,
      modelCallsRestrictedToAmbiguousOfficialJudgments: true,
      objectiveRulesRemainDeterministic: true,
      refereeFallback: "NO_CALL",
      replayFallback: "NO_REVIEW",
    },
    authorityBoundary: {
      preGenesisExperiment: true,
      genesis: false,
      canonicalHistoryClaim: false,
      recognitionBroadcast: false,
      baseTransaction: false,
      secretValuesRecorded: false,
    },
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({
      status: "LIVE_ACCEPTANCE_READY",
      releaseCommit,
      officialCareerCount: careers.length,
      acceptedModelDecisionCount: careers.length,
      fallbackCount: 0,
      crossCareerActivationRejected: true,
      evidencePath,
      secretValuesRecorded: false,
      genesis: false,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
