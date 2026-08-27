import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const RunnerStoreSchema = z.strictObject({
  version: z.literal(1),
  runnerId: z.string().min(1).max(160),
  relayOrigin: z.url(),
  careerSignerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  runnerBuildDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  signingPrivateKey: z.string().regex(/^0x[0-9a-f]{64}$/),
  signingAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  encryptionSecretKey: z.string().regex(/^0x[0-9a-f]{64}$/),
  encryptionPublicKey: z.string().regex(/^0x[0-9a-f]{64}$/),
  delegation: z.unknown(),
  pairedAt: z.iso.datetime({ offset: true }),
});
export type RunnerStore = z.infer<typeof RunnerStoreSchema>;

export async function loadRunnerStore(path: string): Promise<RunnerStore> {
  try {
    return RunnerStoreSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    const encoded = process.env.ABL_RUNNER_STORE_B64;
    if (encoded === undefined) throw error;
    return RunnerStoreSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64").toString("utf8")),
    );
  }
}

export async function saveRunnerStore(
  path: string,
  value: RunnerStore,
): Promise<void> {
  const parsed = RunnerStoreSchema.parse(value);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.new`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "w",
  });
  await rename(temporary, path);
}

export async function removeRunnerStore(path: string): Promise<void> {
  await rm(path, { force: true });
}
