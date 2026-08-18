import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkpointManifestDigest,
  createCheckpointManifest,
  sha256Commitment,
} from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  FileCheckpointPublicationQueue,
  type CheckpointPublication,
} from "../src/index.js";

function publication(): CheckpointPublication {
  const manifest = createCheckpointManifest({
    manifestId: "0198d000-0000-7000-8000-000000000901",
    checkpointType: "DAILY_ROOT",
    subjectId: "2026-08-18",
    eventHashes: [sha256Commitment("daily-event")],
    institutionalKeyRegistryDigest: sha256Commitment("registry"),
    verifierDigest: sha256Commitment("verifier"),
    previousManifestDigest: null,
    createdAt: "2026-08-18T09:00:00.000Z",
  });
  const manifestDigest = checkpointManifestDigest(manifest);
  return {
    manifest: { ...manifest, eventHashes: [...manifest.eventHashes] },
    checkpoint: {
      checkpointId: "0198d000-0000-7000-8000-000000000902",
      checkpointType: manifest.checkpointType,
      subjectId: manifest.subjectId,
      manifestDigest,
      root: manifest.merkleRoot,
      previousRoot: sha256Commitment("prior-daily-root"),
      nonce: manifestDigest,
      validAfter: "1777000000",
      validBefore: "1778000000",
      chainId: 84532,
      contractAddress: "0x1111111111111111111111111111111111111111",
      transactionHash: null,
      blockNumber: null,
      signatures: [`0x${"1".repeat(130)}`],
    },
  };
}

describe("deferred Base checkpoint queue", () => {
  it("persists a hash-chained, restart-verifiable submission artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-checkpoint-queue-"));
    try {
      const queue = new FileCheckpointPublicationQueue(root);
      await queue.initialize();
      const candidate = publication();
      const first = await queue.enqueue(
        candidate,
        new Date("2026-08-18T09:01:00.000Z"),
      );
      await expect(queue.enqueue(candidate)).resolves.toEqual(first);
      expect(queue.pending()).toHaveLength(1);

      const restarted = new FileCheckpointPublicationQueue(root);
      await restarted.initialize();
      expect(restarted.pending()).toEqual([first]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects submitted input and durable tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "abl-checkpoint-queue-"));
    try {
      const queue = new FileCheckpointPublicationQueue(root);
      await queue.initialize();
      const submitted = publication();
      submitted.checkpoint.transactionHash = sha256Commitment("submitted");
      await expect(queue.enqueue(submitted)).rejects.toThrow(
        "not ready for deferred Base submission",
      );

      await queue.enqueue(publication(), new Date("2026-08-18T09:01:00.000Z"));
      const path = join(
        root,
        "checkpoint-submission-queue",
        "000000000000.json",
      );
      const record = JSON.parse(await readFile(path, "utf8")) as {
        publicationDigest: string;
      };
      record.publicationDigest = sha256Commitment("tampered");
      await writeFile(path, `${JSON.stringify(record)}\n`, "utf8");
      await expect(
        new FileCheckpointPublicationQueue(root).initialize(),
      ).rejects.toThrow("queue is corrupt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
