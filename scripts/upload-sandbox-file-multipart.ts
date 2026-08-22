import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectStagingBodyArchive } from "./package-staging-body.js";

const PART_SIZE_BYTES = 5 * 1024 * 1024;
const RESOURCE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const REGION_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

interface UploadedPart {
  etag: string;
  partNumber: number;
  size: number;
}

interface UploadEvidence {
  archiveSha256: `0x${string}`;
  archiveSizeBytes: number;
  partCount: number;
  remotePath: string;
  sandbox: string;
  workspace: string;
}

function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function responseJson<T>(
  response: Response,
  operation: string,
): Promise<T> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `${operation} failed with HTTP ${response.status}: ${detail}`,
    );
  }
  return (await response.json()) as T;
}

export async function uploadSandboxFileMultipart(
  archivePath: string,
  sandbox: string,
  workspace: string,
  region = "us-was-1",
  remotePath = "/tmp/body-program.tgz",
): Promise<UploadEvidence> {
  if (!RESOURCE_NAME.test(sandbox) || !RESOURCE_NAME.test(workspace))
    throw new Error(
      "Sandbox and workspace names must be lowercase resource names",
    );
  if (!REGION_NAME.test(region)) throw new Error("Invalid Blaxel region name");
  if (!remotePath.startsWith("/") || remotePath.includes(".."))
    throw new Error("The remote path must be absolute and cannot traverse");

  const archive = await readFile(resolve(archivePath));
  inspectStagingBodyArchive(archive);
  const archiveSha256 = `0x${createHash("sha256")
    .update(archive)
    .digest("hex")}` as const;
  const token = execFileSync("bl", ["token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .replace(/^Bearer\s+/iu, "");
  if (token.length === 0) throw new Error("Blaxel CLI returned an empty token");

  const origin = `https://sbx-${sandbox}-${workspace}.${region}.bl.run`;
  const authorization = { Authorization: `Bearer ${token}` };
  let uploadId: string | undefined;
  try {
    const initiated = await responseJson<{ path: string; uploadId: string }>(
      await fetch(
        `${origin}/filesystem-multipart/initiate/${encodedPath(remotePath)}`,
        {
          method: "POST",
          headers: { ...authorization, "Content-Type": "application/json" },
          body: JSON.stringify({ permissions: "0600" }),
        },
      ),
      "Multipart initiation",
    );
    if (initiated.path !== remotePath || initiated.uploadId.length === 0)
      throw new Error("Multipart initiation returned inconsistent metadata");
    uploadId = initiated.uploadId;

    const parts: UploadedPart[] = [];
    for (
      let offset = 0, partNumber = 1;
      offset < archive.length;
      partNumber += 1
    ) {
      const chunk = archive.subarray(offset, offset + PART_SIZE_BYTES);
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(chunk)]),
        `part-${partNumber}`,
      );
      const part = await responseJson<UploadedPart>(
        await fetch(
          `${origin}/filesystem-multipart/${encodeURIComponent(uploadId)}/part?partNumber=${partNumber}`,
          { method: "PUT", headers: authorization, body: form },
        ),
        `Multipart part ${partNumber}`,
      );
      if (
        part.partNumber !== partNumber ||
        part.size !== chunk.byteLength ||
        part.etag.length === 0
      )
        throw new Error(
          `Multipart part ${partNumber} returned inconsistent metadata`,
        );
      parts.push(part);
      offset += chunk.byteLength;
    }

    const completed = await responseJson<{ path: string }>(
      await fetch(
        `${origin}/filesystem-multipart/${encodeURIComponent(uploadId)}/complete`,
        {
          method: "POST",
          headers: { ...authorization, "Content-Type": "application/json" },
          body: JSON.stringify({
            parts: parts.map(({ etag, partNumber }) => ({ etag, partNumber })),
          }),
        },
      ),
      "Multipart completion",
    );
    if (completed.path !== remotePath)
      throw new Error("Multipart completion returned an inconsistent path");

    const downloaded = await fetch(
      `${origin}/filesystem/${encodedPath(remotePath)}?download=true`,
      { headers: authorization },
    );
    if (!downloaded.ok)
      throw new Error(
        `Remote hash verification failed with HTTP ${downloaded.status}`,
      );
    const remoteSha256 = `0x${createHash("sha256")
      .update(Buffer.from(await downloaded.arrayBuffer()))
      .digest("hex")}`;
    if (remoteSha256 !== archiveSha256)
      throw new Error("Remote staging-body archive digest does not match");

    uploadId = undefined;
    return {
      archiveSha256,
      archiveSizeBytes: archive.byteLength,
      partCount: parts.length,
      remotePath,
      sandbox,
      workspace,
    };
  } finally {
    if (uploadId !== undefined) {
      await fetch(
        `${origin}/filesystem-multipart/${encodeURIComponent(uploadId)}/abort`,
        { method: "DELETE", headers: authorization },
      ).catch(() => undefined);
    }
  }
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
    uploadSandboxFileMultipart(archivePath, sandbox, workspace, region)
      .then((evidence) => process.stdout.write(`${JSON.stringify(evidence)}\n`))
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      });
  }
}
