import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { StorageDomainPolicy } from "./broker.js";
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
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
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
}
