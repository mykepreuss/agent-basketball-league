import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  lstat,
  lutimes,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface TarMember {
  linkPath: string | null;
  mode: number;
  path: string;
  type: string;
}

export interface StagingBodyArchiveEvidence {
  archivePath: string;
  archiveSha256: `0x${string}`;
  archiveSizeBytes: number;
  fileCount: number;
  memberCount: number;
}

interface ArchiveInput {
  absolutePath: string;
  path: string;
  symbolicLink: boolean;
}

function readField(buffer: Buffer, offset: number, length: number): string {
  const end = buffer.indexOf(0, offset);
  const fieldEnd = end === -1 || end > offset + length ? offset + length : end;
  return buffer.subarray(offset, fieldEnd).toString("utf8");
}

function readOctal(buffer: Buffer, offset: number, length: number): number {
  const value = readField(buffer, offset, length).trim();
  if (value.length === 0) return 0;
  if (!/^[0-7]+$/.test(value))
    throw new Error(`Unsupported tar numeric field: ${value}`);
  return Number.parseInt(value, 8);
}

function parsePaxAttributes(buffer: Buffer): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  let offset = 0;
  while (offset < buffer.length) {
    const separator = buffer.indexOf(0x20, offset);
    if (separator === -1) throw new Error("Malformed PAX record length");
    const length = Number.parseInt(
      buffer.subarray(offset, separator).toString("ascii"),
      10,
    );
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      offset + length > buffer.length
    )
      throw new Error("Malformed PAX record bounds");
    const record = buffer
      .subarray(separator + 1, offset + length - 1)
      .toString("utf8");
    const equals = record.indexOf("=");
    if (equals <= 0) throw new Error("Malformed PAX record value");
    attributes.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return attributes;
}

function validateMemberPath(path: string): string {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").includes("..")
  )
    throw new Error(`Unsafe staging-body archive path: ${path}`);
  const normalized = posix.normalize(path).replace(/\/$/, "");
  if (normalized.split("/").some((segment) => segment.startsWith("._")))
    throw new Error(`AppleDouble metadata is forbidden: ${path}`);
  if (normalized !== "agent" && !normalized.startsWith("agent/"))
    throw new Error(`Staging-body member is outside agent/: ${path}`);
  return normalized;
}

function validateLink(
  memberPath: string,
  linkPath: string,
  type: "1" | "2",
): void {
  if (isAbsolute(linkPath) || linkPath.includes("\\"))
    throw new Error(`Unsafe staging-body link: ${memberPath}`);
  const target = posix.normalize(
    type === "1" ? linkPath : posix.join(posix.dirname(memberPath), linkPath),
  );
  if (target !== "agent" && !target.startsWith("agent/"))
    throw new Error(`Staging-body link escapes agent/: ${memberPath}`);
}

export function inspectStagingBodyArchive(
  archive: Buffer,
): readonly TarMember[] {
  const tar = gunzipSync(archive);
  const members: TarMember[] = [];
  const memberPaths = new Set<string>();
  let nextPath: string | null = null;
  let nextLinkPath: string | null = null;
  let offset = 0;
  let zeroBlocks = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    zeroBlocks = 0;

    const name = readField(header, 0, 100);
    const prefix = readField(header, 345, 155);
    const headerPath = prefix.length > 0 ? `${prefix}/${name}` : name;
    const mode = readOctal(header, 100, 8);
    const size = readOctal(header, 124, 12);
    const typeByte = header[156];
    const type =
      typeByte === undefined || typeByte === 0
        ? "0"
        : String.fromCharCode(typeByte);
    const linkPath = readField(header, 157, 100);
    const body = tar.subarray(offset, offset + size);
    if (body.byteLength !== size)
      throw new Error("Staging-body tar member exceeds archive bounds");
    offset += Math.ceil(size / 512) * 512;

    if (type === "x") {
      const attributes = parsePaxAttributes(body);
      nextPath = attributes.get("path") ?? nextPath;
      nextLinkPath = attributes.get("linkpath") ?? nextLinkPath;
      continue;
    }
    if (type === "g")
      throw new Error(
        "Global PAX headers are forbidden in staging-body archives",
      );
    if (type === "L") {
      nextPath = readField(body, 0, body.length);
      continue;
    }
    if (type === "K") {
      nextLinkPath = readField(body, 0, body.length);
      continue;
    }
    if (!["0", "1", "2", "5", "7"].includes(type))
      throw new Error(`Unsupported staging-body tar member type: ${type}`);

    const path = nextPath ?? headerPath;
    const effectiveLinkPath =
      nextLinkPath ?? (linkPath.length > 0 ? linkPath : null);
    nextPath = null;
    nextLinkPath = null;
    const canonicalPath = validateMemberPath(path);
    if (memberPaths.has(canonicalPath))
      throw new Error(`Duplicate staging-body archive member: ${path}`);
    memberPaths.add(canonicalPath);
    if ((type === "1" || type === "2") && effectiveLinkPath !== null)
      validateLink(path, effectiveLinkPath, type);
    if ((mode & 0o6000) !== 0)
      throw new Error(`Set-ID staging-body member is forbidden: ${path}`);
    if (path.replace(/\/$/, "") === "agent/.env")
      throw new Error("A staging-body .env file is forbidden");
    members.push({ linkPath: effectiveLinkPath, mode, path, type });
  }

  if (zeroBlocks < 2) throw new Error("Staging-body tar terminator is missing");
  const main = members.find(
    ({ path, type }) => path === "agent/main.mjs" && ["0", "7"].includes(type),
  );
  if (main === undefined || main.mode !== 0o600)
    throw new Error("agent/main.mjs must be a mode-0600 regular file");
  return members;
}

export async function packageStagingBody(
  bodyProgramRoot: string,
  archivePath: string,
): Promise<StagingBodyArchiveEvidence> {
  const source = resolve(bodyProgramRoot);
  const destination = resolve(archivePath);
  const main = join(source, "agent/main.mjs");
  const mainInfo = await stat(main);
  if (!mainInfo.isFile() || (mainInfo.mode & 0o777) !== 0o600)
    throw new Error("The staging body entry point must be a mode-0600 file");
  await lstat(destination).then(
    () => {
      throw new Error(
        `Refusing to overwrite staging-body archive: ${destination}`,
      );
    },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const inputs: ArchiveInput[] = [];
  async function collect(path: string): Promise<void> {
    if (path.includes("\n"))
      throw new Error(`Newlines are forbidden in body paths: ${path}`);
    const absolutePath = join(source, path);
    const info = await lstat(absolutePath);
    if (!info.isDirectory() && !info.isFile() && !info.isSymbolicLink())
      throw new Error(`Unsupported staging-body input: ${path}`);
    inputs.push({ absolutePath, path, symbolicLink: info.isSymbolicLink() });
    if (info.isDirectory())
      for (const entry of (await readdir(absolutePath)).sort())
        await collect(join(path, entry));
  }
  await collect("agent");
  const epoch = new Date(0);
  for (const input of inputs.toReversed()) {
    if (input.symbolicLink) await lutimes(input.absolutePath, epoch, epoch);
    else await utimes(input.absolutePath, epoch, epoch);
  }
  const rawArchivePath = `${destination}.tar`;
  const memberListPath = `${destination}.members`;
  try {
    await writeFile(
      memberListPath,
      `${inputs.map(({ path }) => path).join("\n")}\n`,
      { mode: 0o600 },
    );
    execFileSync(
      "tar",
      [
        "-C",
        source,
        "-cf",
        rawArchivePath,
        "--format=ustar",
        "--no-recursion",
        "-T",
        memberListPath,
      ],
      {
        env: {
          ...process.env,
          COPYFILE_DISABLE: "1",
          COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
        },
        stdio: "pipe",
      },
    );
    await writeFile(destination, gzipSync(await readFile(rawArchivePath)), {
      mode: 0o600,
    });
  } finally {
    await Promise.all([
      rm(rawArchivePath, { force: true }),
      rm(memberListPath, { force: true }),
    ]);
  }
  const archive = await readFile(destination);
  const members = inspectStagingBodyArchive(archive);
  return {
    archivePath: destination,
    archiveSha256: `0x${createHash("sha256").update(archive).digest("hex")}`,
    archiveSizeBytes: archive.byteLength,
    fileCount: members.filter(({ type }) => ["0", "7"].includes(type)).length,
    memberCount: members.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bodyProgramRoot = process.argv[2];
  const archivePath = process.argv[3];
  if (bodyProgramRoot === undefined || archivePath === undefined) {
    process.stderr.write(
      "Usage: pnpm staging:package-body <body-program-root> <archive-path>\n",
    );
    process.exitCode = 64;
  } else {
    packageStagingBody(bodyProgramRoot, archivePath)
      .then((evidence) => process.stdout.write(`${JSON.stringify(evidence)}\n`))
      .catch((error: unknown) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      });
  }
}
