import type { GenesisArtifactDigests, Sha256Digest } from "./digests.js";
import { digestPublicFile } from "./digests.js";

interface PublicArtifactEntry {
  name: string;
  path: string | null;
  digest: Sha256Digest | null;
  state: "PREPARED_LOCAL" | "PENDING_BUILD" | "PENDING_RATIFICATION";
}

export async function buildPublicArtifactIndex(
  repositoryRoot: string,
  digests: GenesisArtifactDigests,
) {
  const local = async (
    name: string,
    path: string,
  ): Promise<PublicArtifactEntry> => ({
    name,
    path,
    digest: await digestPublicFile(repositoryRoot, path),
    state: "PREPARED_LOCAL",
  });
  return {
    publicationState: "PREPARED_NOT_PUBLISHED" as const,
    publicExposureApproved: false as const,
    artifacts: [
      {
        name: "source tree",
        path: null,
        digest: digests.source.digest,
        state: "PREPARED_LOCAL" as const,
      },
      {
        name: "sandbox image",
        path: "infra/sandbox/Dockerfile",
        digest: null,
        state: "PENDING_BUILD" as const,
      },
      await local("constitution", "docs/governance/FOUNDING_CONSTITUTION.md"),
      await local("CBA mapping", "docs/rules/cba-mapping.json"),
      await local("NBA rules mapping", "docs/rules/nba-rule-mapping.json"),
      await local(
        "resource schedule proposal",
        "docs/genesis/proposals/resource-schedule.json",
      ),
      await local("threat model", "docs/architecture/THREAT_MODEL.md"),
      await local(
        "model registry proposal",
        "docs/genesis/proposals/model-registry.json",
      ),
      {
        name: "Blaxel deployment manifests",
        path: "infra/blaxel/",
        digest: digests.deploymentManifests.digest,
        state: "PREPARED_LOCAL" as const,
      },
      {
        name: "public projections",
        path: "apps/arena/app/",
        digest: digests.publicProjection.digest,
        state: "PREPARED_LOCAL" as const,
      },
      {
        name: "public verifier",
        path: "packages/recognition/src/verifier.ts",
        digest: digests.verifier.digest,
        state: "PREPARED_LOCAL" as const,
      },
      await local(
        "Base recognition contract",
        "contracts/RecognitionRegistry.sol",
      ),
      {
        name: "genesis release manifest",
        path: "docs/genesis/GENESIS_RELEASE_CANDIDATE.json",
        digest: null,
        state: "PENDING_RATIFICATION" as const,
      },
      {
        name: "genesis root",
        path: null,
        digest: null,
        state: "PENDING_RATIFICATION" as const,
      },
    ],
  };
}
