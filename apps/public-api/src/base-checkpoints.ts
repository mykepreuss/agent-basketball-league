import {
  checkpointSubjectId,
  checkpointTypeId,
  type CheckpointChainObservation,
} from "@abl/recognition";
import type { CheckpointPublication } from "@abl/projections";
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";

const checkpointComponents = [
  { name: "checkpointType", type: "bytes32" },
  { name: "subjectId", type: "bytes32" },
  { name: "root", type: "bytes32" },
  { name: "previousRoot", type: "bytes32" },
  { name: "validAfter", type: "uint64" },
  { name: "validBefore", type: "uint64" },
  { name: "nonce", type: "bytes32" },
] as const;

export const recognitionCheckpointAbi = [
  {
    type: "function",
    name: "recognize",
    stateMutability: "nonpayable",
    inputs: [
      { name: "checkpoint", type: "tuple", components: checkpointComponents },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "rotateRegistry",
    stateMutability: "nonpayable",
    inputs: [
      { name: "checkpoint", type: "tuple", components: checkpointComponents },
      { name: "signatures", type: "bytes[]" },
      { name: "newSigners", type: "address[]" },
      { name: "newRoleMasks", type: "uint8[]" },
      { name: "checkpointTypes", type: "bytes32[]" },
      {
        name: "newPolicies",
        type: "tuple[]",
        components: [
          { name: "commissioners", type: "uint8" },
          { name: "integrity", type: "uint8" },
          { name: "tribunal", type: "uint8" },
          { name: "officials", type: "uint8" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "CheckpointRecognized",
    anonymous: false,
    inputs: [
      { name: "checkpointType", type: "bytes32", indexed: true },
      { name: "subjectId", type: "bytes32", indexed: true },
      { name: "root", type: "bytes32", indexed: true },
      { name: "previousRoot", type: "bytes32", indexed: false },
      { name: "nonce", type: "bytes32", indexed: false },
    ],
  },
] as const;

interface DecodedCheckpoint {
  checkpointType: Hex;
  subjectId: Hex;
  root: Hex;
  previousRoot: Hex;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export interface BaseCheckpointRpc {
  chainId(): Promise<number>;
  latestBlockNumber(): Promise<bigint>;
  finalizedBlockNumber(): Promise<bigint>;
  transaction(hash: Hex): Promise<{ to: Address | null; input: Hex }>;
  receipt(hash: Hex): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    logs: readonly {
      address: Address;
      data: Hex;
      topics: readonly Hex[];
    }[];
  }>;
  block(blockNumber: bigint): Promise<{ timestamp: bigint }>;
  bytecode(blockNumber: bigint): Promise<Hex | null>;
}

export interface ViemBaseCheckpointObservationReaderOptions {
  contractAddress: Address;
  rpc: BaseCheckpointRpc;
  now?: () => Date;
}

function confirmationCount(latest: bigint, included: bigint): number {
  if (latest < included) return 0;
  const confirmations = latest - included + 1n;
  return confirmations > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(confirmations);
}

function decodedRecognition(input: Hex): {
  checkpoint: DecodedCheckpoint;
  signatures: readonly Hex[];
} {
  const decoded = decodeFunctionData({
    abi: recognitionCheckpointAbi,
    data: input,
  });
  if (
    (decoded.functionName !== "recognize" &&
      decoded.functionName !== "rotateRegistry") ||
    decoded.args === undefined
  )
    throw new Error("Checkpoint transaction does not call recognize");
  const [checkpoint, signatures] = decoded.args;
  return {
    checkpoint: checkpoint as DecodedCheckpoint,
    signatures: signatures as readonly Hex[],
  };
}

function recognizedEvent(
  logs: readonly {
    address: Address;
    data: Hex;
    topics: readonly Hex[];
  }[],
  contractAddress: Address,
): {
  checkpointType: Hex;
  subjectId: Hex;
  root: Hex;
  previousRoot: Hex;
  nonce: Hex;
} | null {
  for (const log of logs) {
    if (getAddress(log.address) !== contractAddress) continue;
    if (log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: recognitionCheckpointAbi,
        eventName: "CheckpointRecognized",
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
        strict: true,
      });
      return decoded.args;
    } catch {
      continue;
    }
  }
  return null;
}

export class ViemBaseCheckpointObservationReader {
  readonly #contractAddress: Address;
  readonly #rpc: BaseCheckpointRpc;
  readonly #now: () => Date;

  public constructor(options: ViemBaseCheckpointObservationReaderOptions) {
    this.#contractAddress = getAddress(options.contractAddress);
    this.#rpc = options.rpc;
    this.#now = options.now ?? (() => new Date());
  }

  public async checkpointObservation(
    publication: CheckpointPublication,
  ): Promise<CheckpointChainObservation | null> {
    const transactionHash = publication.checkpoint
      .transactionHash as Hex | null;
    if (transactionHash === null) return null;
    const [chainId, latestBlock, finalizedBlock, transaction, receipt] =
      await Promise.all([
        this.#rpc.chainId(),
        this.#rpc.latestBlockNumber(),
        this.#rpc.finalizedBlockNumber(),
        this.#rpc.transaction(transactionHash),
        this.#rpc.receipt(transactionHash),
      ]);
    const [block, bytecode] = await Promise.all([
      this.#rpc.block(receipt.blockNumber),
      this.#rpc.bytecode(receipt.blockNumber),
    ]);
    const recognized = recognizedEvent(receipt.logs, this.#contractAddress);
    let recognition: ReturnType<typeof decodedRecognition> | null = null;
    try {
      recognition = decodedRecognition(transaction.input);
    } catch {
      recognition = null;
    }
    const expectedCheckpointType = checkpointTypeId(
      publication.checkpoint.checkpointType,
    );
    const expectedSubjectId = checkpointSubjectId(
      publication.checkpoint.subjectId,
    );
    const checkpoint = recognition?.checkpoint;
    return {
      checkpointTypeId:
        recognized?.checkpointType ??
        checkpoint?.checkpointType ??
        expectedCheckpointType,
      subjectId:
        recognized?.subjectId ?? checkpoint?.subjectId ?? expectedSubjectId,
      root:
        recognized?.root ??
        checkpoint?.root ??
        (publication.checkpoint.root as Hex),
      previousRoot:
        recognized?.previousRoot ??
        checkpoint?.previousRoot ??
        (publication.checkpoint.previousRoot as Hex),
      nonce:
        recognized?.nonce ??
        checkpoint?.nonce ??
        (publication.checkpoint.nonce as Hex),
      validAfter:
        checkpoint?.validAfter ?? BigInt(publication.checkpoint.validAfter),
      validBefore:
        checkpoint?.validBefore ?? BigInt(publication.checkpoint.validBefore),
      chainId,
      contractAddress: this.#contractAddress,
      transactionHash,
      blockNumber: receipt.blockNumber,
      blockTimestamp: block.timestamp,
      confirmations: confirmationCount(latestBlock, receipt.blockNumber),
      baseFinalized: receipt.blockNumber <= finalizedBlock,
      receiptSucceeded:
        receipt.status === "success" &&
        transaction.to !== null &&
        getAddress(transaction.to) === this.#contractAddress &&
        recognition !== null &&
        recognized !== null,
      runtimeBytecodeKeccak256: bytecode === null ? null : keccak256(bytecode),
      signatures: recognition?.signatures ?? [],
      observedAt: this.#now().toISOString(),
    };
  }
}

export function createBaseCheckpointRpc(
  rpcUrl: string,
  contractAddress: Address,
): BaseCheckpointRpc {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    chainId: () => client.getChainId(),
    latestBlockNumber: () => client.getBlockNumber(),
    finalizedBlockNumber: async () => {
      const block = await client.getBlock({ blockTag: "finalized" });
      if (block.number === null)
        throw new Error("Base finalized block number is unavailable");
      return block.number;
    },
    transaction: async (hash) => {
      const transaction = await client.getTransaction({ hash });
      return { to: transaction.to, input: transaction.input };
    },
    receipt: async (hash) => {
      const receipt = await client.getTransactionReceipt({ hash });
      return {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        logs: receipt.logs,
      };
    },
    block: async (blockNumber) => {
      const block = await client.getBlock({ blockNumber });
      return { timestamp: block.timestamp };
    },
    bytecode: async (blockNumber) =>
      (await client.getCode({ address: contractAddress, blockNumber })) ?? null,
  };
}
