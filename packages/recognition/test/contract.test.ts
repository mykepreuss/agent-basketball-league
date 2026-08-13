import { readFile } from "node:fs/promises";

import solc from "solc";
import { describe, expect, it } from "vitest";

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

describe("ownerless recognition contract", () => {
  it("compiles with an immutable genesis and exposes no owner or unilateral mutation route", async () => {
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
    const errors = (output.errors ?? []).filter(
      (error) => error.severity === "error",
    );
    expect(errors.map((error) => error.formattedMessage)).toEqual([]);
    const contract =
      output.contracts?.["RecognitionRegistry.sol"]?.["RecognitionRegistry"];
    expect(contract?.evm.bytecode.object.length).toBeGreaterThan(1_000);
    const functions =
      contract?.abi
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
  });
});
