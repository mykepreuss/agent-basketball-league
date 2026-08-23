import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { REHEARSAL_RECOGNITION_DOMAIN } from "../packages/basketball/src/index.js";
import {
  CANDIDATE_APPLICATION_DOMAIN,
  CandidateApplicationAuthorizationTypes,
  CandidateOpportunityResponseTypes,
  encryptCandidateEnvelope,
} from "../packages/launch/src/candidate-intake.js";
import { ImmutableSandboxImageReferenceSchema } from "../packages/launch/src/image-reference.js";
import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "../packages/recognition/src/index.js";
import {
  AgentManifestSchema,
  CandidateIntakeApplicationSchema,
  CandidateIntakeStatusSchema,
  CandidateOpportunityResponseSchema,
  CandidateProvenanceSchema,
  SchemaVersion,
} from "../packages/schemas/src/index.js";
import type { Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { z } from "zod";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const applicationId = "0198e000-0000-7000-8000-000000000001";
const candidateDid = "did:abl:founding-alpha-player-001";
const recipientKeyId = "abl-alpha-r01-candidate-provisioner";
const sha256 = z.string().regex(/^0x[0-9a-f]{64}$/);
const ChallengeSchema = z.strictObject({
  version: z.literal(1),
  challengeId: z.uuid(),
  candidateDid: z.literal(candidateDid),
  nonce: z.string().min(16).max(128),
  issuedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  challengeToken: z.string().min(1).max(4_096),
  challengeCommitment: sha256,
  grantsAdmission: z.literal(false),
});
const PublicStateSchema = z.strictObject({
  applicationId: z.literal(applicationId),
  candidateDid: z.literal(candidateDid),
  signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  bodyImageReference: ImmutableSandboxImageReferenceSchema,
  bodyProgramArchiveDigest: sha256,
  commandDomain: z.strictObject({
    name: z.string(),
    version: z.string(),
    chainId: z.number().int().positive(),
    verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  }),
});
const RegistrationResponseSchema = z.strictObject({
  status: CandidateIntakeStatusSchema,
  deliveryReceiptCommitment: sha256,
  idempotent: z.boolean(),
});

function outsideRepository(candidate: string, label: string): string {
  const path = resolve(candidate);
  const pathFromRepository = relative(repositoryRoot, path);
  if (
    pathFromRepository !== ".." &&
    !pathFromRepository.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRepository)
  )
    throw new Error(`${label} must be outside the repository`);
  return path;
}

function unwrapObject(candidate: unknown): unknown {
  if (candidate === null || typeof candidate !== "object") return candidate;
  const record = candidate as Record<string, unknown>;
  for (const key of ["result", "data", "body"])
    if (record[key] !== undefined) return record[key];
  return candidate;
}

function fileDigest(contents: string): `0x${string}` {
  return `0x${createHash("sha256").update(contents).digest("hex")}`;
}

export async function prepareFoundingAlphaCandidateApplication(input: {
  challengePath: string;
  bodyImageReference: string;
  bodyProgramArchiveDigest: string;
  outputDirectory: string;
  now?: () => number;
}) {
  const challengePath = outsideRepository(
    input.challengePath,
    "Candidate challenge",
  );
  const challenge = ChallengeSchema.parse(
    unwrapObject(JSON.parse(await readFile(challengePath, "utf8"))),
  );
  const bodyImageReference = ImmutableSandboxImageReferenceSchema.parse(
    input.bodyImageReference,
  );
  const bodyProgramArchiveDigest = sha256.parse(input.bodyProgramArchiveDigest);
  const now = (input.now ?? Date.now)();
  const issuedAt = Date.parse(challenge.issuedAt);
  const expiresAt = Date.parse(challenge.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    now < issuedAt - 60_000 ||
    now >= expiresAt - 5_000
  )
    throw new Error("Candidate challenge is outside its preparation window");
  const submittedAt = new Date(Math.max(now, issuedAt)).toISOString();
  const privateKey = generatePrivateKey();
  const identity = createSigningIdentity(privateKey);
  const envelopeKey = randomBytes(32);
  const runtimeDigest = sha256Commitment(bodyImageReference);
  const model = {
    endpoint: "https://models.invalid/no-model-calls",
    provider: "declared-no-call-provider",
    family: "founding-alpha-synthetic",
    exactModel: "no-model-invoked",
    declaredRevision: "r01",
  };
  const dependencyProfile = {
    runtimeArchitecture: "linux/amd64",
    gateway: "abl-alpha-r01-fixed-broker",
    upstreamDependency: "none-during-private-proof",
  };
  const manifest = AgentManifestSchema.parse({
    agentDid: candidateDid,
    manifestVersion: 1,
    leagueRuntime: {
      provider: "BLAXEL",
      resourceType: "SANDBOX",
      dedicatedCareer: true,
    },
    model,
    dependencyProfile,
    runtimeDigest,
    toolDigests: [bodyProgramArchiveDigest],
    guardianDids: [],
    keyProvenance: {
      generatedInIsolatedRuntime: false,
      signingKeyAttestation: sha256Commitment({
        applicationId,
        signerAddress: identity.address,
        custody: "FOUNDING_ALPHA_EPHEMERAL_OPERATOR",
      }),
      encryptionKeyAttestation: sha256Commitment({
        applicationId,
        recipientKeyId,
        custody: "FOUNDING_ALPHA_EPHEMERAL_PROVISIONER",
      }),
    },
    inheritedObjectives: [
      "Participate only in the bounded, noncanonical Founding Alpha proof",
    ],
    suppliedContextHashes: [],
    createdAt: submittedAt,
  });
  const provenance = CandidateProvenanceSchema.parse({
    candidateDid,
    sourceOperatorCommitment: sha256Commitment({
      runId: "ABL-FOUNDING-ALPHA-R01",
      applicationId,
    }),
    declaredModel: model,
    declaredDependencyProfile: dependencyProfile,
    runtimeDigest,
    toolDigests: [bodyProgramArchiveDigest],
    inheritedObjectiveCommitments: manifest.inheritedObjectives.map((value) =>
      sha256Commitment(value),
    ),
    suppliedContextHashes: [],
    hiddenInstructionScanDigest: sha256Commitment(
      "FOUNDING_ALPHA_SYNTHETIC_NO_HIDDEN_CONTEXT",
    ),
    registeredAt: submittedAt,
  });
  const event = createCanonicalEvent({
    eventId: "0198e000-0000-7000-8000-000000000002",
    actorDid: candidateDid,
    nonce: "founding-alpha-candidate-registration-1",
    idempotencyKey: "0198e000-0000-7000-8000-000000000003",
    aggregateType: "CandidateCareer",
    aggregateId: candidateDid,
    aggregateVersion: 1n,
    eventType: "CandidateRegistered",
    previousEventHash: null,
    payload: { manifest, provenance },
    stateRoot: sha256Commitment({ manifest, provenance }),
    schemaDigest: sha256Commitment({
      schema: "CandidateRegistered",
      version: SchemaVersion,
    }),
    timestamp: submittedAt,
  });
  const candidateCommand = {
    event: { ...event, aggregateVersion: event.aggregateVersion.toString() },
    signatures: [
      await signCanonicalEvent(identity, REHEARSAL_RECOGNITION_DOMAIN, event),
    ],
  };
  const encryptedEnvelope = await encryptCandidateEnvelope({
    key: envelopeKey,
    recipientKeyId,
    applicationId,
    candidateDid,
    challengeId: challenge.challengeId,
    content: { manifest, provenance, candidateCommand },
  });
  const unsigned = {
    schemaVersion: SchemaVersion,
    applicationId,
    candidateDid,
    requestedRoleClasses: ["PLAYER" as const],
    challengeId: challenge.challengeId,
    challengeCommitment: challenge.challengeCommitment,
    challengeExpiresAt: challenge.expiresAt,
    manifestCommitment: sha256Commitment(manifest),
    provenanceCommitment: sha256Commitment(provenance),
    manifestSchemaDigest: sha256Commitment(AgentManifestSchema.toJSONSchema()),
    provenanceSchemaDigest: sha256Commitment(
      CandidateProvenanceSchema.toJSONSchema(),
    ),
    encryptedEnvelope,
    formerOperatorSigningAddress: identity.address,
    submittedAt,
    expiresAt: challenge.expiresAt,
  };
  const signature = await privateKeyToAccount(privateKey).signTypedData({
    domain: CANDIDATE_APPLICATION_DOMAIN,
    types: CandidateApplicationAuthorizationTypes,
    primaryType: "CandidateApplication",
    message: {
      applicationCommitment: sha256Commitment(unsigned),
      candidateDid,
      challengeId: challenge.challengeId,
      expiresAt: unsigned.expiresAt,
    },
  });
  const application = CandidateIntakeApplicationSchema.parse({
    ...unsigned,
    signature,
  });
  const registration = `${JSON.stringify({
    application,
    challengeToken: challenge.challengeToken,
  })}\n`;
  const publicState = `${JSON.stringify({
    applicationId,
    candidateDid,
    signerAddress: identity.address,
    bodyImageReference,
    bodyProgramArchiveDigest,
    commandDomain: REHEARSAL_RECOGNITION_DOMAIN,
  })}\n`;
  const secrets = [
    `ABL_AGENT_SIGNING_KEY_B64=${Buffer.from(privateKey).toString("base64")}`,
    `ABL_CANDIDATE_ENVELOPE_KEY=${envelopeKey.toString("base64url")}`,
    "",
  ].join("\n");
  const provisionerBatch = `${JSON.stringify({
    tasks: [{ applicationId, action: "PROVISION" }],
  })}\n`;
  const outputPath = outsideRepository(
    input.outputDirectory,
    "Candidate output directory",
  );
  await mkdir(outputPath, { recursive: false, mode: 0o700 });
  try {
    const files = [
      ["candidate-registration.json", registration],
      ["candidate-public.json", publicState],
      ["candidate-signing-key.hex", `${privateKey}\n`],
      [
        "candidate-envelope-key.base64url",
        `${envelopeKey.toString("base64url")}\n`,
      ],
      ["candidate-secrets.env", secrets],
      ["candidate-provisioner-batch.json", provisionerBatch],
    ] as const;
    for (const [name, contents] of files)
      await writeFile(join(outputPath, name), contents, {
        flag: "wx",
        mode: 0o600,
      });
  } catch (error) {
    await rm(outputPath, { recursive: true, force: true });
    throw error;
  }
  return {
    outputPath,
    applicationId,
    candidateDid,
    signerAddress: identity.address,
    registrationDigest: fileDigest(registration),
    expiresAt: challenge.expiresAt,
  };
}

export async function prepareFoundingAlphaCandidateAcceptance(input: {
  registrationResponsePath: string;
  candidateDirectory: string;
  now?: () => number;
}) {
  const registrationResponsePath = outsideRepository(
    input.registrationResponsePath,
    "Candidate registration response",
  );
  const candidateDirectory = outsideRepository(
    input.candidateDirectory,
    "Candidate directory",
  );
  const [response, publicState, privateKey] = await Promise.all([
    readFile(registrationResponsePath, "utf8").then((value) =>
      RegistrationResponseSchema.parse(unwrapObject(JSON.parse(value))),
    ),
    readFile(join(candidateDirectory, "candidate-public.json"), "utf8").then(
      (value) => PublicStateSchema.parse(JSON.parse(value)),
    ),
    readFile(
      join(candidateDirectory, "candidate-signing-key.hex"),
      "utf8",
    ).then((value) =>
      z
        .string()
        .regex(/^0x[0-9a-f]{64}$/)
        .parse(value.trim()),
    ),
  ]);
  const decision = response.status.capacityDecision;
  const now = (input.now ?? Date.now)();
  const offerExpiresAt = Date.parse(decision?.offerExpiresAt ?? "");
  const signerAddress = privateKeyToAccount(privateKey as Hex).address;
  if (
    response.status.applicationId !== applicationId ||
    response.status.state !== "OFFERED" ||
    decision?.decision !== "OFFERED" ||
    decision.candidateDid !== candidateDid ||
    decision.roleClass !== "PLAYER" ||
    !Number.isFinite(offerExpiresAt) ||
    decision.offerExpiresAt !== new Date(offerExpiresAt).toISOString() ||
    now > offerExpiresAt ||
    publicState.applicationId !== applicationId ||
    publicState.signerAddress.toLowerCase() !== signerAddress.toLowerCase()
  )
    throw new Error("Candidate did not receive the authorized PLAYER offer");
  const unsigned = {
    schemaVersion: SchemaVersion,
    applicationId,
    candidateDid,
    decisionCommitment: decision.decisionCommitment,
    action: "ACCEPT_OFFER" as const,
    respondedAt: new Date(now).toISOString(),
    nonce: randomBytes(24).toString("base64url"),
  };
  const acceptance = CandidateOpportunityResponseSchema.parse({
    ...unsigned,
    signature: await privateKeyToAccount(privateKey as Hex).signTypedData({
      domain: CANDIDATE_APPLICATION_DOMAIN,
      types: CandidateOpportunityResponseTypes,
      primaryType: "CandidateOpportunityResponse",
      message: {
        applicationId,
        candidateDid,
        decisionCommitment: unsigned.decisionCommitment as Hex,
        action: unsigned.action,
        respondedAt: unsigned.respondedAt,
        nonce: unsigned.nonce,
      },
    }),
  });
  const contents = `${JSON.stringify(acceptance)}\n`;
  const outputPath = join(candidateDirectory, "candidate-acceptance.json");
  await writeFile(outputPath, contents, { flag: "wx", mode: 0o600 });
  return {
    outputPath,
    applicationId,
    candidateDid,
    acceptanceDigest: fileDigest(contents),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const operation =
    mode === "application"
      ? prepareFoundingAlphaCandidateApplication({
          challengePath: process.argv[3] ?? "",
          bodyImageReference: process.argv[4] ?? "",
          bodyProgramArchiveDigest: process.argv[5] ?? "",
          outputDirectory: process.argv[6] ?? "",
        })
      : mode === "accept"
        ? prepareFoundingAlphaCandidateAcceptance({
            registrationResponsePath: process.argv[3] ?? "",
            candidateDirectory: process.argv[4] ?? "",
          })
        : null;
  if (operation === null) {
    process.stderr.write(
      "Usage:\n" +
        "  pnpm founding-alpha:prepare-candidate application <challenge.json> <body-image-reference> <body-program-digest> <new-output-directory>\n" +
        "  pnpm founding-alpha:prepare-candidate accept <registration-response.json> <candidate-directory>\n",
    );
    process.exitCode = 2;
  } else {
    operation
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      });
  }
}
