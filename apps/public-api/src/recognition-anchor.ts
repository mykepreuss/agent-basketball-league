import type { CheckpointRecognitionAnchor } from "@abl/recognition";

// Approval-gated deployment evidence must replace this source-bound value in an
// agent-authorized release. Runtime environment variables cannot ratify it.
export const COMPILED_RECOGNITION_ANCHOR: CheckpointRecognitionAnchor = {
  state: "PRE_GENESIS_UNRATIFIED",
  chainId: 84532,
  contractAddress: null,
  deployedRuntimeBytecodeKeccak256: null,
  releaseManifestDigest: null,
  deploymentTransactionHash: null,
  deploymentBlockNumber: null,
  finalizedAt: null,
  requiredConfirmations: 12,
};
