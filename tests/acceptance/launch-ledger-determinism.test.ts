import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { directoryDigest } from "../../scripts/generate-launch-ledger.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe("launch-ledger directory evidence", () => {
  it("ignores local build, test, dependency, and operating-system artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-ledger-digest-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n");

    const expected = await directoryDigest(root);

    for (const directory of [
      ".next",
      ".turbo",
      "coverage",
      "dist",
      "node_modules",
      "playwright-report",
      "test-results",
    ]) {
      await mkdir(join(root, directory));
      await writeFile(join(root, directory, "generated.txt"), directory);
    }
    await writeFile(join(root, ".DS_Store"), "local metadata");

    expect(await directoryDigest(root)).toBe(expected);
  });
});
