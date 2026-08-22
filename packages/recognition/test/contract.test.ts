import { readFile } from "node:fs/promises";

import ganache from "ganache";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
  parseEther,
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";

interface SolcOutput {
  contracts?: Record<
    string,
    Record<
      string,
      {
        abi: Array<{ name?: string; type: string }>;
        evm: { bytecode: { object: string } };
      }
    >
  >;
  errors?: Array<{ severity: string; formattedMessage: string }>;
}

interface CompiledContract {
  abi: Abi;
  bytecode: Hex;
}

interface Checkpoint {
  checkpointType: Hex;
  subjectId: Hex;
  root: Hex;
  previousRoot: Hex;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

interface Policy {
  commissioners: number;
  integrity: number;
  tribunal: number;
  officials: number;
}

const ZERO_HASH = `0x${"0".repeat(64)}` as const;
const KEY_REGISTRY = keccak256(toBytes("KEY_REGISTRY"));
const GAME = keccak256(toBytes("GAME"));
const RELEASE = keccak256(toBytes("RELEASE"));
const privateKeys = [
  `0x${"11".repeat(32)}`,
  `0x${"22".repeat(32)}`,
  `0x${"33".repeat(32)}`,
  `0x${"44".repeat(32)}`,
  `0x${"55".repeat(32)}`,
] as const satisfies readonly Hex[];

let compiled: CompiledContract;

async function compileContract(): Promise<{
  source: string;
  output: SolcOutput;
  contract: CompiledContract;
}> {
  const source = await readFile(
    new URL("../../../contracts/RecognitionRegistry.sol", import.meta.url),
    "utf8",
  );
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "RecognitionRegistry.sol": { content: source } },
        settings: {
          optimizer: { enabled: true, runs: 10_000 },
          outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
        },
      }),
    ),
  ) as SolcOutput;
  const contract =
    output.contracts?.["RecognitionRegistry.sol"]?.["RecognitionRegistry"];
  if (contract === undefined)
    throw new Error("Contract compiler output absent");
  return {
    source,
    output,
    contract: {
      abi: contract.abi as unknown as Abi,
      bytecode: `0x${contract.evm.bytecode.object}`,
    },
  };
}

function sortedRegistry(
  entries: readonly { account: PrivateKeyAccount; roles: number }[],
): { accounts: PrivateKeyAccount[]; addresses: Address[]; roles: number[] } {
  const sorted = [...entries].sort((left, right) =>
    left.account.address.toLowerCase().localeCompare(right.account.address),
  );
  return {
    accounts: sorted.map(({ account }) => account),
    addresses: sorted.map(({ account }) => getAddress(account.address)),
    roles: sorted.map(({ roles }) => roles),
  };
}

function sortedPolicies(
  entries: readonly { checkpointType: Hex; policy: Policy }[],
): { checkpointTypes: Hex[]; policies: Policy[] } {
  const sorted = [...entries].sort((left, right) =>
    left.checkpointType.localeCompare(right.checkpointType),
  );
  return {
    checkpointTypes: sorted.map(({ checkpointType }) => checkpointType),
    policies: sorted.map(({ policy }) => policy),
  };
}

function registryRoot(
  addresses: readonly Address[],
  roles: readonly number[],
  checkpointTypes: readonly Hex[],
  policies: readonly Policy[],
): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address[], uint8[], bytes32[], (uint8 commissioners, uint8 integrity, uint8 tribunal, uint8 officials)[]",
      ),
      [addresses, roles, checkpointTypes, policies],
    ),
  );
}

async function signCheckpoint(input: {
  account: PrivateKeyAccount;
  chainId: number;
  contract: Address;
  checkpoint: Checkpoint;
}): Promise<Hex> {
  return input.account.signTypedData({
    domain: {
      name: "ABL Recognition",
      version: "1",
      chainId: input.chainId,
      verifyingContract: input.contract,
    },
    types: {
      Checkpoint: [
        { name: "checkpointType", type: "bytes32" },
        { name: "subjectId", type: "bytes32" },
        { name: "root", type: "bytes32" },
        { name: "previousRoot", type: "bytes32" },
        { name: "validAfter", type: "uint64" },
        { name: "validBefore", type: "uint64" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "Checkpoint",
    message: input.checkpoint,
  });
}

beforeAll(async () => {
  compiled = (await compileContract()).contract;
}, 30_000);

describe("ownerless recognition contract", () => {
  it("compiles with an immutable genesis and exposes no owner or unilateral mutation route", async () => {
    const { source, output, contract } = await compileContract();
    const errors = (output.errors ?? []).filter(
      (error) => error.severity === "error",
    );
    expect(errors.map((error) => error.formattedMessage)).toEqual([]);
    expect(contract.bytecode.length).toBeGreaterThan(1_000);
    const functions =
      contract.abi
        .filter((entry) => entry.type === "function")
        .map((entry) => entry.name) ?? [];
    expect(functions).toEqual(
      expect.arrayContaining([
        "recognize",
        "rotateRegistry",
        "checkpointDigest",
      ]),
    );
    expect(functions).not.toEqual(
      expect.arrayContaining([
        "owner",
        "upgradeTo",
        "pause",
        "selfdestruct",
        "setRoot",
      ]),
    );
    expect(source).not.toMatch(
      /onlyOwner|tx\.origin|delegatecall|selfdestruct/,
    );
  }, 30_000);

  it("executes policy removal and signer rotation in a local EVM", async () => {
    const account0 = privateKeyToAccount(privateKeys[0]);
    const account1 = privateKeyToAccount(privateKeys[1]);
    const account2 = privateKeyToAccount(privateKeys[2]);
    const account3 = privateKeyToAccount(privateKeys[3]);
    const account4 = privateKeyToAccount(privateKeys[4]);
    const provider = ganache.provider({
      chain: { chainId: 31_337 },
      logging: { quiet: true },
      wallet: {
        accounts: privateKeys.map((secretKey) => ({
          secretKey,
          balance: toHex(parseEther("100")),
        })),
      },
    });
    const transport = custom(provider);
    const publicClient = createPublicClient({ transport });
    const walletClient = createWalletClient({
      account: account0,
      transport,
    });
    const initial = sortedRegistry([
      { account: account0, roles: 1 },
      { account: account1, roles: 2 },
      { account: account2, roles: 8 },
    ]);
    const initialPolicies = sortedPolicies([
      {
        checkpointType: KEY_REGISTRY,
        policy: { commissioners: 1, integrity: 1, tribunal: 0, officials: 0 },
      },
      {
        checkpointType: GAME,
        policy: { commissioners: 0, integrity: 0, tribunal: 0, officials: 1 },
      },
    ]);
    const deploymentHash = await walletClient.deployContract({
      abi: compiled.abi,
      bytecode: compiled.bytecode,
      args: [
        keccak256(toBytes("constitution")),
        keccak256(toBytes("verifier")),
        initial.addresses,
        initial.roles,
        initialPolicies.checkpointTypes,
        initialPolicies.policies,
      ],
      account: account0,
      chain: null,
    });
    const deployment = await publicClient.waitForTransactionReceipt({
      hash: deploymentHash,
    });
    const contract = deployment.contractAddress;
    if (contract === null || contract === undefined)
      throw new Error("Contract deployment failed");
    const chainId = await publicClient.getChainId();
    const block = await publicClient.getBlock();
    const gameCheckpoint: Checkpoint = {
      checkpointType: GAME,
      subjectId: keccak256(toBytes("game:1")),
      root: keccak256(toBytes("game-root:1")),
      previousRoot: ZERO_HASH,
      validAfter: block.timestamp - 1n,
      validBefore: block.timestamp + 3_600n,
      nonce: keccak256(toBytes("game-nonce:1")),
    };
    const officialSignature = await signCheckpoint({
      account: account2,
      chainId,
      contract,
      checkpoint: gameCheckpoint,
    });
    await publicClient.waitForTransactionReceipt({
      hash: await walletClient.writeContract({
        address: contract,
        abi: compiled.abi,
        functionName: "recognize",
        args: [gameCheckpoint, [officialSignature]],
        account: account0,
        chain: null,
      }),
    });
    await expect(
      walletClient.writeContract({
        address: contract,
        abi: compiled.abi,
        functionName: "recognize",
        args: [gameCheckpoint, [officialSignature]],
        account: account0,
        chain: null,
      }),
    ).rejects.toThrow(/nonce replay/);

    const rotated = sortedRegistry([
      { account: account3, roles: 1 },
      { account: account4, roles: 1 },
    ]);
    const rotatedPolicies = sortedPolicies([
      {
        checkpointType: KEY_REGISTRY,
        policy: { commissioners: 2, integrity: 0, tribunal: 0, officials: 0 },
      },
      {
        checkpointType: RELEASE,
        policy: { commissioners: 2, integrity: 0, tribunal: 0, officials: 0 },
      },
    ]);
    const rotation: Checkpoint = {
      checkpointType: KEY_REGISTRY,
      subjectId: keccak256(toBytes("registry")),
      root: registryRoot(
        rotated.addresses,
        rotated.roles,
        rotatedPolicies.checkpointTypes,
        rotatedPolicies.policies,
      ),
      previousRoot: ZERO_HASH,
      validAfter: block.timestamp - 1n,
      validBefore: block.timestamp + 3_600n,
      nonce: keccak256(toBytes("registry-nonce:1")),
    };
    const rotationSignatures = await Promise.all(
      [account0, account1].map(async (account) => ({
        address: account.address,
        signature: await signCheckpoint({
          account,
          chainId,
          contract,
          checkpoint: rotation,
        }),
      })),
    );
    rotationSignatures.sort((left, right) =>
      left.address.toLowerCase().localeCompare(right.address.toLowerCase()),
    );
    await publicClient.waitForTransactionReceipt({
      hash: await walletClient.writeContract({
        address: contract,
        abi: compiled.abi,
        functionName: "rotateRegistry",
        args: [
          rotation,
          rotationSignatures.map(({ signature }) => signature),
          rotated.addresses,
          rotated.roles,
          rotatedPolicies.checkpointTypes,
          rotatedPolicies.policies,
        ],
        account: account0,
        chain: null,
      }),
    });
    expect(
      await publicClient.readContract({
        address: contract,
        abi: compiled.abi,
        functionName: "policies",
        args: [GAME],
      }),
    ).toEqual([0, 0, 0, 0]);

    const releaseCheckpoint: Checkpoint = {
      checkpointType: RELEASE,
      subjectId: keccak256(toBytes("release:1")),
      root: keccak256(toBytes("release-root:1")),
      previousRoot: ZERO_HASH,
      validAfter: block.timestamp - 1n,
      validBefore: block.timestamp + 3_600n,
      nonce: keccak256(toBytes("release-nonce:1")),
    };
    const newSignatures = await Promise.all(
      rotated.accounts.map(async (account) => ({
        address: account.address,
        signature: await signCheckpoint({
          account,
          chainId,
          contract,
          checkpoint: releaseCheckpoint,
        }),
      })),
    );
    newSignatures.sort((left, right) =>
      left.address.toLowerCase().localeCompare(right.address.toLowerCase()),
    );
    const staleSignature = await signCheckpoint({
      account: account2,
      chainId,
      contract,
      checkpoint: releaseCheckpoint,
    });
    await expect(
      walletClient.writeContract({
        address: contract,
        abi: compiled.abi,
        functionName: "recognize",
        args: [releaseCheckpoint, [newSignatures[0]!.signature]],
        account: account0,
        chain: null,
      }),
    ).rejects.toThrow(/commission threshold/);
    await expect(
      walletClient.writeContract({
        address: contract,
        abi: compiled.abi,
        functionName: "recognize",
        args: [releaseCheckpoint, [staleSignature]],
        account: account0,
        chain: null,
      }),
    ).rejects.toThrow(/unrecognized signer/);
    await expect(
      walletClient.writeContract({
        address: contract,
        abi: compiled.abi,
        functionName: "recognize",
        args: [releaseCheckpoint, ["0x1234"]],
        account: account0,
        chain: null,
      }),
    ).rejects.toThrow(/invalid signature length/);
    await publicClient.waitForTransactionReceipt({
      hash: await walletClient.writeContract({
        address: contract,
        abi: compiled.abi,
        functionName: "recognize",
        args: [
          releaseCheckpoint,
          newSignatures.map(({ signature }) => signature),
        ],
        account: account0,
        chain: null,
      }),
    });
    await provider.disconnect();
  }, 30_000);
});
