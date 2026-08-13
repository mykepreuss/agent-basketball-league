import { createHash } from "node:crypto";

import solc from "solc";
import { keccak256, type Abi, type Hex } from "viem";

export interface OwnerlessDeploymentTemplate {
  mode: "PREPARE_ONLY_INCOMPLETE_NO_BROADCAST";
  chainId: 84532;
  transaction: null;
  exactTransactionCommand: string;
  compiler: { version: string; inputSha256: string };
  contract: {
    sourceSha256: string;
    creationBytecodeSha256: string;
    bytecodeKeccak256: Hex;
    callableFunctions: readonly string[];
    constructorInputs: readonly string[];
    ownerAdminUpgradeSurfaceAbsent: boolean;
  };
  missingRatifiedInputs: readonly string[];
  irreversibleConsequences: readonly string[];
}

interface SolcOutput {
  contracts?: Record<
    string,
    Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>
  >;
  errors?: Array<{ severity: string; formattedMessage: string }>;
}

export function compileOwnerlessDeploymentTemplate(
  source: string,
): OwnerlessDeploymentTemplate {
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
  const callableFunctions = contract.abi
    .filter((item) => item.type === "function")
    .map((item) => item.name)
    .sort();
  const constructor = contract.abi.find((item) => item.type === "constructor");
  const forbiddenAdminNames = /owner|admin|upgrade|proxy|pause|destroy/i;
  return {
    mode: "PREPARE_ONLY_INCOMPLETE_NO_BROADCAST",
    chainId: 84532,
    transaction: null,
    exactTransactionCommand:
      "pnpm contract:prepare -- <ratified-genesis-config.json> <deployment-artifact.json>",
    compiler: {
      version: solc.version(),
      inputSha256: createHash("sha256").update(compilerInput).digest("hex"),
    },
    contract: {
      sourceSha256: createHash("sha256").update(source).digest("hex"),
      creationBytecodeSha256: createHash("sha256")
        .update(bytecode)
        .digest("hex"),
      bytecodeKeccak256: keccak256(bytecode),
      callableFunctions,
      constructorInputs: constructor?.inputs.map((input) => input.type) ?? [],
      ownerAdminUpgradeSurfaceAbsent: callableFunctions.every(
        (name) => !forbiddenAdminNames.test(name),
      ),
    },
    missingRatifiedInputs: [
      "constitution digest",
      "verifier digest",
      "institutional signer addresses",
      "role masks",
      "checkpoint policies",
    ],
    irreversibleConsequences: [
      "The constructor permanently fixes constitution and verifier digests.",
      "No owner, deployer, sponsor, proxy, pause, or upgrade authority exists.",
      "An incorrect genesis registry cannot be repaired by a human administrator.",
      "A replacement requires the recognized key-registry threshold or a separately labeled fork.",
    ],
  };
}
