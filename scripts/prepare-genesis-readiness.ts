import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import {
  assessGenesisReadiness,
  buildPendingReleaseManifest,
  buildPublicArtifactIndex,
  compileOwnerlessDeploymentTemplate,
  createFoundingConventionPacket,
  createPendingCostEnvelope,
  prepareGenesisArtifactDigests,
} from "../packages/genesis/src/index.js";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function writeJson(path: string, value: unknown): Promise<void> {
  const output = await format(JSON.stringify(value), { parser: "json" });
  await writeFile(join(repositoryRoot, path), output, { mode: 0o600 });
}

async function main(): Promise<void> {
  const digests = await prepareGenesisArtifactDigests(repositoryRoot);
  const convention = createFoundingConventionPacket();
  const cost = createPendingCostEnvelope();
  const release = buildPendingReleaseManifest(digests);
  const contractSource = await readFile(
    join(repositoryRoot, "contracts/RecognitionRegistry.sol"),
    "utf8",
  );
  const deployment = compileOwnerlessDeploymentTemplate(contractSource);
  const publicIndex = await buildPublicArtifactIndex(repositoryRoot, digests);
  const readiness = assessGenesisReadiness({
    convention,
    release,
    deployment,
    cost,
  });
  await Promise.all([
    writeJson("docs/genesis/FOUNDING_CONVENTION_PACKET.json", convention),
    writeJson("docs/genesis/GENESIS_RELEASE_CANDIDATE.json", release),
    writeJson("docs/genesis/PUBLIC_ARTIFACT_INDEX.json", publicIndex),
    writeJson("docs/genesis/COST_ENVELOPE.json", cost),
    writeJson("contracts/recognition-deployment-template.json", deployment),
    writeJson("fixtures/genesis-readiness.json", {
      digests,
      convention,
      cost,
      release,
      deployment,
      publicIndex,
      readiness,
    }),
  ]);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
