import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadStorageBootstrap } from "../src/bootstrap.js";

const bootstrapInput = {
  identities: [
    {
      serviceId: "stage-body-001",
      actorDid: "did:abl:stage-player-001",
      secretBase64: Buffer.alloc(32, 1).toString("base64"),
      capabilities: ["private:ciphertext"],
    },
  ],
  policies: [],
};
const bootstrap = JSON.stringify(bootstrapInput);

describe("storage bootstrap loading", () => {
  it("loads an environment-delivered secret without a filesystem prerequisite", async () => {
    await expect(
      loadStorageBootstrap({ ABL_STORAGE_BOOTSTRAP_JSON: bootstrap }),
    ).resolves.toMatchObject({
      identities: [{ serviceId: "stage-body-001" }],
    });
  });

  it("retains file loading and rejects absent or ambiguous sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-storage-bootstrap-"));
    const path = join(root, "bootstrap.json");
    await writeFile(path, bootstrap);
    await expect(
      loadStorageBootstrap({ ABL_STORAGE_BOOTSTRAP_FILE: path }),
    ).resolves.toMatchObject({ policies: [] });
    await expect(loadStorageBootstrap({})).rejects.toThrow("Exactly one");
    await expect(
      loadStorageBootstrap({
        ABL_STORAGE_BOOTSTRAP_FILE: path,
        ABL_STORAGE_BOOTSTRAP_JSON: bootstrap,
      }),
    ).rejects.toThrow("Exactly one");
  });

  it("rejects malformed service secrets and storage policies", async () => {
    await expect(
      loadStorageBootstrap({
        ABL_STORAGE_BOOTSTRAP_JSON: JSON.stringify({
          ...bootstrapInput,
          identities: [
            {
              ...bootstrapInput.identities[0],
              secretBase64: "not-base64",
            },
          ],
        }),
      }),
    ).rejects.toThrow();

    await expect(
      loadStorageBootstrap({
        ABL_STORAGE_BOOTSTRAP_JSON: JSON.stringify({
          ...bootstrapInput,
          policies: [
            {
              domainId: "personal-agent-a",
              kind: "PERSONAL",
              version: 1,
              members: { "did:abl:agent-a": ["READ"] },
              guardianEnvelopeCommitments: [],
              manifestCommitment: `0x${"a".repeat(64)}`,
            },
          ],
        }),
      }),
    ).rejects.toThrow("Storage policy requires an administrator");
  });
});
