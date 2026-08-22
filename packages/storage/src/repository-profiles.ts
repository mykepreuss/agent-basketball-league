import {
  FilesystemCiphertextRepository,
  type CiphertextRepository,
} from "./drive-repository.js";

export type StorageBackendProfile =
  | "LOCAL_REHEARSAL"
  | "BLAXEL_VOLUME_V1"
  | "AGENT_DRIVE";

export interface StorageRepositoryProfile {
  backend: StorageBackendProfile;
  root: string;
  brokerOnly: boolean;
  region: string | null;
  permissionsConfigured: boolean;
  liveProof: "NOT_APPLICABLE" | "LIVE_PROOF_REQUIRED";
}

export class BlaxelVolumeCiphertextRepository extends FilesystemCiphertextRepository {
  readonly backend = "BLAXEL_VOLUME_V1" as const;
}

export class AgentDriveCiphertextRepository extends FilesystemCiphertextRepository {
  readonly backend = "AGENT_DRIVE" as const;
}

export function createCiphertextRepository(
  candidate: StorageRepositoryProfile,
): CiphertextRepository {
  if (candidate.root.trim() === "")
    throw new Error("Storage repository root is required");
  if (candidate.backend === "LOCAL_REHEARSAL") {
    if (candidate.liveProof !== "NOT_APPLICABLE")
      throw new Error("Local rehearsal cannot assert live proof");
    return new FilesystemCiphertextRepository(candidate.root);
  }
  if (!candidate.brokerOnly)
    throw new Error("Private storage backend must be broker-only");
  if (candidate.liveProof !== "LIVE_PROOF_REQUIRED")
    throw new Error("Blaxel storage requires honest live-proof labeling");
  if (candidate.backend === "BLAXEL_VOLUME_V1")
    return new BlaxelVolumeCiphertextRepository(candidate.root);
  if (candidate.region !== "us-was-1")
    throw new Error("Agent Drive is currently restricted to us-was-1");
  if (!candidate.permissionsConfigured)
    throw new Error("Agent Drive requires explicit workload permissions");
  return new AgentDriveCiphertextRepository(candidate.root);
}
