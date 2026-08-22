import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkpointManifestDigest,
  createCheckpointManifest,
  createSigningIdentity,
  sha256Commitment,
  signCheckpointAuthorization,
} from "../packages/recognition/src/index.js";
import { CheckpointPublicationSchema } from "../packages/projections/src/index.js";
import { z } from "zod";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);
const InputSchema = z.strictObject({
  subjectId: z.string().min(1).max(200),
  eventHashes: z.array(hex32).min(1).max(10_000),
  createdAt: z.iso.datetime({ offset: true }),
  signerDid: z.string().startsWith("did:").max(500),
  signerPrivateKeyFile: z.string().min(1),
  verifierDigest: hex32,
  witnessesFile: z.string().min(1).optional(),
});

function outsideRepository(candidate: string, label: string): string {
  const path = resolve(candidate);
  const pathFromRepository = relative(repositoryRoot, path);
  const isOutside =
    pathFromRepository === ".." ||
    pathFromRepository.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRepository);
  if (!isOutside) {
    throw new Error(`${label} must be outside the repository`);
  }
  return path;
}

export async function prepareStagingCheckpoint(
  inputPath: string,
  outputDirectory: string,
) {
  const input = InputSchema.parse(
    JSON.parse(await readFile(resolve(inputPath), "utf8")),
  );
  const secretPath = outsideRepository(
    input.signerPrivateKeyFile,
    "Signer private-key file",
  );
  const outputPath = outsideRepository(outputDirectory, "Output directory");
  const privateKey = (await readFile(secretPath, "utf8")).trim();
  if (!/^0x[0-9a-f]{64}$/.test(privateKey))
    throw new Error("Staging checkpoint signer key is malformed");
  const identity = createSigningIdentity(privateKey as `0x${string}`);
  const createdAtMs = Date.parse(input.createdAt);
  const validAfter = BigInt(Math.floor(createdAtMs / 1_000) - 60);
  const validBefore = validAfter + 14_460n;
  const signerRegistry = [
    {
      address: identity.address,
      did: input.signerDid,
      role: "PROJECTOR" as const,
      validFrom: new Date(createdAtMs - 86_400_000).toISOString(),
      validUntil: new Date(createdAtMs + 86_400_000).toISOString(),
      revokedAt: null,
      purpose: "SIGNING" as const,
    },
  ];
  const manifest = createCheckpointManifest({
    manifestId: "0198f200-0000-7000-8000-000000000401",
    checkpointType: "GAME",
    subjectId: input.subjectId,
    eventHashes: input.eventHashes as readonly `0x${string}`[],
    institutionalKeyRegistryDigest: sha256Commitment(signerRegistry),
    verifierDigest: input.verifierDigest as `0x${string}`,
    previousManifestDigest: null,
    createdAt: input.createdAt,
  });
  const manifestDigest = checkpointManifestDigest(manifest);
  const claim = {
    checkpointType: "GAME" as const,
    subjectId: input.subjectId,
    root: manifest.merkleRoot,
    previousRoot: sha256Commitment("abl-stage-no-previous-game-root"),
    nonce: manifestDigest,
    validAfter,
    validBefore,
    chainId: 84_532,
    contractAddress: "0x1111111111111111111111111111111111111111" as const,
    transactionHash: null,
    blockNumber: null,
    signatures: [] as `0x${string}`[],
  };
  claim.signatures.push(await signCheckpointAuthorization(identity, claim));
  const witnesses =
    input.witnessesFile === undefined
      ? []
      : z
          .array(z.unknown())
          .max(16)
          .parse(
            JSON.parse(await readFile(resolve(input.witnessesFile), "utf8")),
          );
  const publication = CheckpointPublicationSchema.parse({
    manifest,
    checkpoint: {
      checkpointId: "0198f200-0000-7000-8000-000000000402",
      checkpointType: claim.checkpointType,
      subjectId: claim.subjectId,
      manifestDigest,
      root: claim.root,
      previousRoot: claim.previousRoot,
      nonce: claim.nonce,
      validAfter: claim.validAfter.toString(),
      validBefore: claim.validBefore.toString(),
      chainId: claim.chainId,
      contractAddress: claim.contractAddress,
      transactionHash: null,
      blockNumber: null,
      signatures: claim.signatures,
    },
    witnesses,
  });
  const policies = {
    GAME: {
      policyId: "PRIVATE_STAGING_GAME_PROJECTOR_1_OF_1",
      groups: [{ role: "PROJECTOR" as const, required: 1 }],
    },
  };
  await mkdir(outputPath, { recursive: false, mode: 0o700 });
  await Promise.all([
    writeFile(
      join(outputPath, "checkpoint-publications.json"),
      JSON.stringify([publication]),
      { flag: "wx", mode: 0o600 },
    ),
    writeFile(
      join(outputPath, "checkpoint-signer-registry.json"),
      JSON.stringify(signerRegistry),
      { flag: "wx", mode: 0o600 },
    ),
    writeFile(
      join(outputPath, "checkpoint-policies.json"),
      JSON.stringify(policies),
      { flag: "wx", mode: 0o600 },
    ),
  ]);
  return {
    outputPath,
    signerAddress: identity.address,
    manifestDigest,
    root: manifest.merkleRoot,
    witnessCount: witnesses.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputPath = process.argv[2];
  const outputDirectory = process.argv[3];
  if (inputPath === undefined || outputDirectory === undefined) {
    process.stderr.write(
      "Usage: prepare-staging-checkpoint <input.json> <new-output-directory>\n",
    );
    process.exitCode = 2;
  } else {
    prepareStagingCheckpoint(inputPath, outputDirectory)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      });
  }
}
