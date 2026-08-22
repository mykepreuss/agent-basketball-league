import {
  checkpointManifestDigest,
  checkpointSubjectId,
  checkpointTypeId,
  createCheckpointManifest,
  sha256Commitment,
  type CheckpointRecognitionAnchor,
} from "@abl/recognition";
import {
  PublicCheckpointProjectionRepository,
  type CheckpointPublication,
} from "@abl/projections";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  ViemBaseCheckpointObservationReader,
  recognitionCheckpointAbi,
  type BaseCheckpointRpc,
} from "../src/base-checkpoints.js";
import { createPublicApi } from "../src/server.js";

const contractAddress = "0x1111111111111111111111111111111111111111";
const signature = `0x${"1".repeat(130)}` as Hex;
const transactionHash = sha256Commitment("base-checkpoint-transaction");
const runtimeBytecode = "0x60016000";

function recognitionAnchor(): CheckpointRecognitionAnchor {
  return {
    state: "RATIFIED",
    chainId: 84532,
    contractAddress,
    deployedRuntimeBytecodeKeccak256: keccak256(runtimeBytecode),
    releaseManifestDigest: sha256Commitment("ratified-release"),
    deploymentTransactionHash: sha256Commitment("deployment-transaction"),
    deploymentBlockNumber: 10n,
    finalizedAt: "2026-08-13T08:00:00.000Z",
    requiredConfirmations: 12,
  };
}

function candidate(): CheckpointPublication {
  const manifest = createCheckpointManifest({
    manifestId: "0198d000-0000-7000-8000-000000000851",
    checkpointType: "RELEASE",
    subjectId: "0198d000-0000-7000-8000-000000000852",
    eventHashes: [sha256Commitment("release-authorized-event")],
    institutionalKeyRegistryDigest: sha256Commitment("registry"),
    verifierDigest: sha256Commitment("verifier"),
    previousManifestDigest: null,
    createdAt: "2026-08-13T09:00:00.000Z",
  });
  const manifestDigest = checkpointManifestDigest(manifest);
  return {
    manifest: { ...manifest, eventHashes: [...manifest.eventHashes] },
    checkpoint: {
      checkpointId: "0198d000-0000-7000-8000-000000000853",
      checkpointType: "RELEASE",
      subjectId: manifest.subjectId,
      manifestDigest,
      root: manifest.merkleRoot,
      previousRoot: sha256Commitment("previous-release-root"),
      nonce: manifestDigest,
      validAfter: "1786611599",
      validBefore: "1786615200",
      chainId: 84532,
      contractAddress,
      transactionHash,
      blockNumber: null,
      signatures: [signature],
    },
  };
}

function rpc(publication: CheckpointPublication): BaseCheckpointRpc {
  const command = {
    checkpointType: checkpointTypeId(publication.checkpoint.checkpointType),
    subjectId: checkpointSubjectId(publication.checkpoint.subjectId),
    root: publication.checkpoint.root as Hex,
    previousRoot: publication.checkpoint.previousRoot as Hex,
    validAfter: BigInt(publication.checkpoint.validAfter),
    validBefore: BigInt(publication.checkpoint.validBefore),
    nonce: publication.checkpoint.nonce as Hex,
  };
  const topics = encodeEventTopics({
    abi: recognitionCheckpointAbi,
    eventName: "CheckpointRecognized",
    args: {
      checkpointType: command.checkpointType,
      subjectId: command.subjectId,
      root: command.root,
    },
  }).filter((topic): topic is Hex => typeof topic === "string");
  return {
    chainId: async () => 84532,
    latestBlockNumber: async () => 111n,
    finalizedBlockNumber: async () => 100n,
    transaction: async () => ({
      to: contractAddress as Address,
      input: encodeFunctionData({
        abi: recognitionCheckpointAbi,
        functionName: "recognize",
        args: [command, [signature]],
      }),
    }),
    receipt: async () => ({
      status: "success",
      blockNumber: 100n,
      logs: [
        {
          address: contractAddress as Address,
          topics,
          data: encodeAbiParameters(
            [{ type: "bytes32" }, { type: "bytes32" }],
            [command.previousRoot, command.nonce],
          ),
        },
      ],
    }),
    block: async () => ({ timestamp: 1_786_611_600n }),
    bytecode: async () => runtimeBytecode,
  };
}

describe("Base-backed checkpoint API", () => {
  it("decodes the exact contract call and event before public recognition", async () => {
    const publication = candidate();
    const reader = new ViemBaseCheckpointObservationReader({
      contractAddress,
      rpc: rpc(publication),
      now: () => new Date("2026-08-13T09:10:00.000Z"),
    });
    const observation = await reader.checkpointObservation(publication);
    expect(observation).toMatchObject({
      receiptSucceeded: true,
      baseFinalized: true,
      confirmations: 12,
      transactionHash,
      blockNumber: 100n,
      signatures: [signature],
      runtimeBytecodeKeccak256: keccak256(runtimeBytecode),
    });

    const checkpoints = new PublicCheckpointProjectionRepository({
      publications: [publication],
      anchor: recognitionAnchor(),
      checkpointObservation: (input) => reader.checkpointObservation(input),
    });
    await checkpoints.initialize();
    const app = createPublicApi({
      checkpointProjections: checkpoints,
      operatingProfile: "PRODUCTION_V1_PRE_GENESIS",
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/checkpoints",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-abl-operating-profile"]).toBe(
      "PRODUCTION_V1_PRE_GENESIS",
    );
    expect(response.json()).toMatchObject({
      state: "PRODUCTION_V1_PRE_GENESIS",
      canonical: false,
      historyClassification: "PRE_GENESIS_EXPERIMENT",
      recognitionLevel: "ONCHAIN_FINALIZED",
      productionV1Ready: true,
      items: [
        {
          verification: "CANONICAL",
          recognized: true,
          recognitionLevel: "ONCHAIN_FINALIZED",
          confirmations: 12,
          observedBlockNumber: "100",
          checkpoint: { transactionHash },
        },
      ],
    });

    const mismatchedReader = new ViemBaseCheckpointObservationReader({
      contractAddress,
      rpc: { ...rpc(publication), bytecode: async () => "0x6002" },
    });
    const mismatched = new PublicCheckpointProjectionRepository({
      publications: [publication],
      anchor: recognitionAnchor(),
      checkpointObservation: (input) =>
        mismatchedReader.checkpointObservation(input),
    });
    await mismatched.initialize();
    expect(mismatched.checkpoints()[0]).toMatchObject({
      verification: "NONCANONICAL_FORK",
      recognized: false,
    });
    await app.close();
  });
});
