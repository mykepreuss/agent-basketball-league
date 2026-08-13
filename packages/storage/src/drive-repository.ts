import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  CiphertextBrokerState,
  CiphertextDeletionReceipt,
  StorageDomainPolicy,
} from "./broker.js";
import type { EncryptedBlob, GuardianWrappedKey } from "./crypto.js";

function segment(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertInside(root: string, path: string): void {
  if (!path.startsWith(`${root}/`))
    throw new Error("Resolved ciphertext path escaped repository root");
}

async function writeImmutableJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined = await open(
    temporaryPath,
    "wx",
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function entries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readJson<T>(path: string): Promise<T> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Durable storage record is not an object: ${path}`);
  return value as T;
}

export class DriveCiphertextRepository {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = resolve(root);
  }

  public async initialize(): Promise<void> {
    await mkdir(join(this.#root, "domains"), { recursive: true, mode: 0o700 });
  }

  public async putPolicy(policy: StorageDomainPolicy): Promise<void> {
    const directory = join(
      this.#root,
      "domains",
      segment(policy.domainId),
      "policies",
    );
    assertInside(this.#root, directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeImmutableJson(join(directory, `${policy.version}.json`), policy);
  }

  public async putCiphertext(blob: EncryptedBlob): Promise<void> {
    const directory = join(
      this.#root,
      "domains",
      segment(blob.domainId),
      "objects",
      segment(blob.objectId),
    );
    assertInside(this.#root, directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeImmutableJson(join(directory, `${blob.version}.json`), blob);
  }

  public async putGuardianEnvelope(
    envelope: GuardianWrappedKey,
  ): Promise<void> {
    const directory = join(
      this.#root,
      "domains",
      segment(envelope.domainId),
      "guardians",
      segment(envelope.guardianDid),
    );
    assertInside(this.#root, directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeImmutableJson(
      join(directory, `${envelope.commitment.slice(2)}.json`),
      envelope,
    );
  }

  public async putDeletion(receipt: CiphertextDeletionReceipt): Promise<void> {
    const directory = join(
      this.#root,
      "domains",
      segment(receipt.domainId),
      "deletions",
    );
    assertInside(this.#root, directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeImmutableJson(
      join(directory, `${segment(receipt.objectId)}.json`),
      receipt,
    );
  }

  public async getDeletion(
    domainId: string,
    objectId: string,
  ): Promise<CiphertextDeletionReceipt> {
    const path = join(
      this.#root,
      "domains",
      segment(domainId),
      "deletions",
      `${segment(objectId)}.json`,
    );
    assertInside(this.#root, path);
    return readJson<CiphertextDeletionReceipt>(path);
  }

  public async eraseCiphertext(
    domainId: string,
    objectId: string,
  ): Promise<void> {
    const directory = join(
      this.#root,
      "domains",
      segment(domainId),
      "objects",
      segment(objectId),
    );
    assertInside(this.#root, directory);
    await rm(directory, { recursive: true, force: true });
    const parent = await open(dirname(directory), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }

  public async getCiphertext(
    domainId: string,
    objectId: string,
    version: number,
  ): Promise<EncryptedBlob> {
    const path = join(
      this.#root,
      "domains",
      segment(domainId),
      "objects",
      segment(objectId),
      `${version}.json`,
    );
    assertInside(this.#root, path);
    return JSON.parse(await readFile(path, "utf8")) as EncryptedBlob;
  }

  public async loadState(): Promise<CiphertextBrokerState> {
    const policies: StorageDomainPolicy[] = [];
    const objects: EncryptedBlob[] = [];
    const guardianEnvelopes: GuardianWrappedKey[] = [];
    const deletions: CiphertextDeletionReceipt[] = [];
    const domainsRoot = join(this.#root, "domains");
    for (const domainEntry of (await entries(domainsRoot)).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (
        !domainEntry.isDirectory() ||
        !/^[0-9a-f]{64}$/.test(domainEntry.name)
      )
        throw new Error("Durable storage contains an invalid domain path");
      const domainRoot = join(domainsRoot, domainEntry.name);
      for (const policyEntry of (
        await entries(join(domainRoot, "policies"))
      ).sort((left, right) => left.name.localeCompare(right.name))) {
        if (!policyEntry.isFile() || !/^\d+\.json$/.test(policyEntry.name))
          throw new Error("Durable storage contains an invalid policy path");
        const policy = await readJson<StorageDomainPolicy>(
          join(domainRoot, "policies", policyEntry.name),
        );
        if (
          segment(policy.domainId) !== domainEntry.name ||
          `${policy.version}.json` !== policyEntry.name
        ) {
          throw new Error("Durable policy path does not match its metadata");
        }
        policies.push(policy);
      }
      for (const objectEntry of (
        await entries(join(domainRoot, "objects"))
      ).sort((left, right) => left.name.localeCompare(right.name))) {
        if (
          !objectEntry.isDirectory() ||
          !/^[0-9a-f]{64}$/.test(objectEntry.name)
        )
          throw new Error("Durable storage contains an invalid object path");
        const objectRoot = join(domainRoot, "objects", objectEntry.name);
        for (const versionEntry of (await entries(objectRoot)).sort(
          (left, right) => left.name.localeCompare(right.name),
        )) {
          if (!versionEntry.isFile() || !/^\d+\.json$/.test(versionEntry.name))
            throw new Error("Durable storage contains an invalid version path");
          const blob = await readJson<EncryptedBlob>(
            join(objectRoot, versionEntry.name),
          );
          if (
            segment(blob.domainId) !== domainEntry.name ||
            segment(blob.objectId) !== objectEntry.name ||
            `${blob.version}.json` !== versionEntry.name
          ) {
            throw new Error(
              "Durable ciphertext path does not match its metadata",
            );
          }
          objects.push(blob);
        }
      }
      for (const guardianEntry of (
        await entries(join(domainRoot, "guardians"))
      ).sort((left, right) => left.name.localeCompare(right.name))) {
        if (
          !guardianEntry.isDirectory() ||
          !/^[0-9a-f]{64}$/.test(guardianEntry.name)
        )
          throw new Error("Durable storage contains an invalid guardian path");
        const guardianRoot = join(domainRoot, "guardians", guardianEntry.name);
        for (const envelopeEntry of (await entries(guardianRoot)).sort(
          (left, right) => left.name.localeCompare(right.name),
        )) {
          if (
            !envelopeEntry.isFile() ||
            !/^[0-9a-f]{64}\.json$/.test(envelopeEntry.name)
          ) {
            throw new Error(
              "Durable storage contains an invalid envelope path",
            );
          }
          const envelope = await readJson<GuardianWrappedKey>(
            join(guardianRoot, envelopeEntry.name),
          );
          if (
            segment(envelope.domainId) !== domainEntry.name ||
            segment(envelope.guardianDid) !== guardianEntry.name ||
            `${envelope.commitment.slice(2)}.json` !== envelopeEntry.name
          ) {
            throw new Error(
              "Durable guardian path does not match its metadata",
            );
          }
          guardianEnvelopes.push(envelope);
        }
      }
      for (const deletionEntry of (
        await entries(join(domainRoot, "deletions"))
      ).sort((left, right) => left.name.localeCompare(right.name))) {
        if (
          !deletionEntry.isFile() ||
          !/^[0-9a-f]{64}\.json$/.test(deletionEntry.name)
        ) {
          throw new Error("Durable storage contains an invalid deletion path");
        }
        const receipt = await readJson<CiphertextDeletionReceipt>(
          join(domainRoot, "deletions", deletionEntry.name),
        );
        if (
          segment(receipt.domainId) !== domainEntry.name ||
          `${segment(receipt.objectId)}.json` !== deletionEntry.name
        ) {
          throw new Error("Durable deletion path does not match its metadata");
        }
        deletions.push(receipt);
      }
    }
    return { policies, objects, guardianEnvelopes, deletions };
  }
}
