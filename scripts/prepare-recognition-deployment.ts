import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import solc from "solc";
import { encodeDeployData, keccak256, type Abi, type Hex } from "viem";

interface GenesisConfig {
  chainId: number;
  constitutionDigest: Hex;
  verifierDigest: Hex;
  signers: Hex[];
  roleMasks: number[];
  checkpointTypes: Hex[];
  policies: Array<{
    commissioners: number;
    integrity: number;
    tribunal: number;
    officials: number;
  }>;
}

interface SolcOutput {
  contracts?: Record<
    string,
    Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>
  >;
  errors?: Array<{ severity: string; formattedMessage: string }>;
}

async function main(): Promise<void> {
  const [configArgument, outputArgument] = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  if (configArgument === undefined || outputArgument === undefined) {
    throw new Error(
      "Usage: pnpm contract:prepare -- <config.json> <output.json>",
    );
  }
  const configPath = resolve(configArgument);
  const outputPath = resolve(outputArgument);
  const config = JSON.parse(
    await readFile(configPath, "utf8"),
  ) as GenesisConfig;
  if (config.chainId !== 84532)
    throw new Error(
      "Preparation workflow is restricted to Base Sepolia chain 84532",
    );
  const bytes32Pattern = /^0x[0-9a-f]{64}$/;
  const addressPattern = /^0x[0-9a-f]{40}$/;
  const zeroBytes32 = `0x${"0".repeat(64)}`;
  if (
    !bytes32Pattern.test(config.constitutionDigest) ||
    !bytes32Pattern.test(config.verifierDigest) ||
    config.constitutionDigest === zeroBytes32 ||
    config.verifierDigest === zeroBytes32 ||
    config.signers.length === 0 ||
    config.checkpointTypes.length === 0 ||
    config.signers.some((signer) => !addressPattern.test(signer)) ||
    config.roleMasks.some(
      (roleMask) =>
        !Number.isInteger(roleMask) || roleMask < 1 || roleMask > 0x0f,
    ) ||
    config.checkpointTypes.some(
      (checkpointType) => !bytes32Pattern.test(checkpointType),
    ) ||
    config.policies.some((policy) => {
      const thresholds = [
        policy.commissioners,
        policy.integrity,
        policy.tribunal,
        policy.officials,
      ];
      return (
        thresholds.some(
          (threshold) =>
            !Number.isInteger(threshold) || threshold < 0 || threshold > 255,
        ) || thresholds.every((threshold) => threshold === 0)
      );
    })
  ) {
    throw new Error(
      "Genesis config contains pending or invalid digests, signers, roles, checkpoint types, or policies",
    );
  }
  if (
    config.signers.length !== config.roleMasks.length ||
    config.checkpointTypes.length !== config.policies.length
  ) {
    throw new Error("Genesis signer/policy array lengths do not match");
  }
  if (
    [...config.signers]
      .sort((left, right) =>
        left.toLowerCase().localeCompare(right.toLowerCase()),
      )
      .join() !== config.signers.join()
  ) {
    throw new Error("Genesis signers must be strictly sorted");
  }

  const source = await readFile(
    new URL("../contracts/RecognitionRegistry.sol", import.meta.url),
    "utf8",
  );
  const compilerInput = JSON.stringify({
    language: "Solidity",
    sources: { "RecognitionRegistry.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 10_000 },
      metadata: { bytecodeHash: "ipfs" },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
    },
  });
  const compiled = JSON.parse(solc.compile(compilerInput)) as SolcOutput;
  const errors = (compiled.errors ?? []).filter(
    (error) => error.severity === "error",
  );
  if (errors.length > 0)
    throw new Error(errors.map((error) => error.formattedMessage).join("\n"));
  const contract =
    compiled.contracts?.["RecognitionRegistry.sol"]?.["RecognitionRegistry"];
  if (contract === undefined)
    throw new Error("RecognitionRegistry compiler output is missing");
  const bytecode = `0x${contract.evm.bytecode.object}` as Hex;
  const data = encodeDeployData({
    abi: contract.abi,
    bytecode,
    args: [
      config.constitutionDigest,
      config.verifierDigest,
      config.signers,
      config.roleMasks,
      config.checkpointTypes,
      config.policies.map((policy) => [
        policy.commissioners,
        policy.integrity,
        policy.tribunal,
        policy.officials,
      ]),
    ],
  });
  const artifact = {
    mode: "PREPARE_ONLY_NO_BROADCAST",
    chainId: config.chainId,
    transaction: { to: null, value: "0", data },
    compiler: {
      version: solc.version(),
      inputSha256: createHash("sha256").update(compilerInput).digest("hex"),
    },
    contract: {
      creationBytecodeKeccak256: keccak256(bytecode),
      deployedRuntimeBytecodeKeccak256: null,
      deployedRuntimeVerification: "POST_DEPLOYMENT_REQUIRED_VIA_ETH_GETCODE",
      abi: contract.abi,
    },
    configSha256: createHash("sha256")
      .update(await readFile(configPath))
      .digest("hex"),
  };
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
