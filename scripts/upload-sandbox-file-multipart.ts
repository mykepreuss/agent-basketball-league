import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectStagingBodyArchive } from "./package-staging-body.js";

const RESOURCE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const REGION_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const REMOTE_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;

interface UploadEvidence {
  archiveSha256: `0x${string}`;
  archiveSizeBytes: number;
  remotePath: string;
  sandbox: string;
  transport: "BLAXEL_SANDBOX_SDK";
  workspace: string;
}

interface SandboxAdapter {
  metadata: { name?: string; workspace?: string };
  spec: { region?: string };
  fs: {
    writeBinary(path: string, content: Buffer): Promise<unknown>;
    readBinary(path: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  };
  process: {
    exec(input: {
      name: string;
      command: string;
      waitForCompletion: boolean;
      timeout: number;
    }): Promise<{ status?: string; exitCode?: number }>;
  };
}

const require = createRequire(import.meta.url);

async function getBlaxelSandbox(name: string): Promise<SandboxAdapter> {
  const { SandboxInstance } = require("@blaxel/core") as {
    SandboxInstance: { get(sandboxName: string): Promise<unknown> };
  };
  return (await SandboxInstance.get(name)) as SandboxAdapter;
}

export async function uploadSandboxFile(
  archivePath: string,
  sandboxName: string,
  workspace: string,
  region = "us-was-1",
  remotePath = "/tmp/body-program.tgz",
  getSandbox: (name: string) => Promise<SandboxAdapter> = getBlaxelSandbox,
): Promise<UploadEvidence> {
  if (!RESOURCE_NAME.test(sandboxName) || !RESOURCE_NAME.test(workspace))
    throw new Error(
      "Sandbox and workspace names must be lowercase resource names",
    );
  if (!REGION_NAME.test(region)) throw new Error("Invalid Blaxel region name");
  if (!REMOTE_PATH.test(remotePath) || remotePath.includes(".."))
    throw new Error("The remote path must be an absolute safe file path");

  const archive = await readFile(resolve(archivePath));
  inspectStagingBodyArchive(archive);
  const archiveSha256 = `0x${createHash("sha256")
    .update(archive)
    .digest("hex")}` as const;

  const sandbox = await getSandbox(sandboxName);
  if (
    sandbox.metadata.workspace !== workspace ||
    sandbox.metadata.name !== sandboxName ||
    sandbox.spec.region !== region
  )
    throw new Error("Blaxel returned a Sandbox outside the requested scope");

  await sandbox.fs.writeBinary(remotePath, archive);
  const permissionResult = await sandbox.process.exec({
    name: `abl-upload-permissions-${Date.now()}`,
    command: `chmod 0600 -- ${remotePath}`,
    waitForCompletion: true,
    timeout: 30,
  });
  if (
    permissionResult.status !== "completed" ||
    permissionResult.exitCode !== 0
  )
    throw new Error("Could not restrict the uploaded archive permissions");

  const downloaded = await sandbox.fs.readBinary(remotePath);
  const remoteSha256 = `0x${createHash("sha256")
    .update(Buffer.from(await downloaded.arrayBuffer()))
    .digest("hex")}`;
  if (remoteSha256 !== archiveSha256)
    throw new Error("Remote staging-body archive digest does not match");

  return {
    archiveSha256,
    archiveSizeBytes: archive.byteLength,
    remotePath,
    sandbox: sandboxName,
    transport: "BLAXEL_SANDBOX_SDK",
    workspace,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const archivePath = process.argv[2];
  const sandbox = process.argv[3];
  const workspace =
    process.argv[4] ??
    execFileSync("bl", ["workspace", "--current"], {
      encoding: "utf8",
    }).trim();
  const region = process.argv[5] ?? "us-was-1";
  if (archivePath === undefined || sandbox === undefined) {
    process.stderr.write(
      "Usage: pnpm staging:upload-body <archive> <sandbox> [workspace] [region]\n",
    );
    process.exitCode = 64;
  } else {
    uploadSandboxFile(archivePath, sandbox, workspace, region)
      .then((evidence) => process.stdout.write(`${JSON.stringify(evidence)}\n`))
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      });
  }
}
