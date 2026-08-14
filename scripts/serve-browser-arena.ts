import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const corepackPath = execFileSync("which", ["corepack"], {
  encoding: "utf8",
}).trim();

function pnpm(args: readonly string[]): ChildProcess {
  return spawn(process.execPath, [corepackPath, "pnpm", ...args], {
    env: process.env,
    stdio: "inherit",
  });
}

function exitCode(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

const buildExitCode = await exitCode(pnpm(["--filter", "@abl/arena", "build"]));
if (buildExitCode !== 0)
  throw new Error(`Arena production build failed: ${buildExitCode}`);

const arenaRoot = fileURLToPath(new URL("../apps/arena/", import.meta.url));
const standaloneRoot = join(arenaRoot, ".next", "standalone", "apps", "arena");
await cp(
  join(arenaRoot, ".next", "static"),
  join(standaloneRoot, ".next", "static"),
  { recursive: true },
);
try {
  await cp(join(arenaRoot, "public"), join(standaloneRoot, "public"), {
    recursive: true,
  });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const server = spawn(process.execPath, [join(standaloneRoot, "server.js")], {
  cwd: standaloneRoot,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "34173" },
  stdio: "inherit",
});
function stop(): void {
  if (server.exitCode === null) server.kill("SIGTERM");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.exitCode = await exitCode(server);
