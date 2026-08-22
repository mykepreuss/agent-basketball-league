import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const diagnosticsScript = fileURLToPath(
  new URL("../../../infra/sandbox/abl-init-diagnostics.mjs", import.meta.url),
);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Failed to reserve a diagnostic test port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForResponse(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

describe("body-init diagnostic server", () => {
  it("exposes only the bounded status route before the Sandbox API handoff", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abl-init-diagnostics-"));
    const statusFile = join(directory, "status");
    await chmod(directory, 0o755);
    await writeFile(statusFile, "STARTING_DIAGNOSTICS\n", { mode: 0o444 });
    const setStatus = async (status: string) => {
      await chmod(statusFile, 0o644);
      await writeFile(statusFile, `${status}\n`);
      await chmod(statusFile, 0o444);
    };
    const port = await availablePort();
    const diagnosticUid = (process.getuid?.() ?? 10102) || 10102;
    const diagnosticGid = (process.getgid?.() ?? 10102) || 10102;
    const child = spawn(
      process.execPath,
      ["--disable-proto=throw", "--frozen-intrinsics", diagnosticsScript],
      {
        env: {
          ABL_INIT_DIAGNOSTIC_GID: String(diagnosticGid),
          ABL_INIT_DIAGNOSTIC_PORT: String(port),
          ABL_INIT_DIAGNOSTIC_UID: String(diagnosticUid),
          ABL_INIT_STATUS_FILE: statusFile,
          ABL_TEST_FORBIDDEN_SECRET: "must-never-appear",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const origin = `http://127.0.0.1:${port}`;
    try {
      const response = await waitForResponse(`${origin}/abl-init-status`);
      expect(response.status, stderr).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.json()).toEqual({
        service: "abl-body-init-diagnostics",
        status: "STARTING_DIAGNOSTICS",
        ready: false,
        mutationSurface: false,
      });

      for (const route of [
        "/process",
        "/filesystem//etc/passwd",
        "/abl-init-status?unexpected=true",
      ]) {
        const denied = await fetch(`${origin}${route}`);
        expect(denied.status, route).toBe(404);
        expect(await denied.text()).not.toContain("must-never-appear");
      }

      const post = await fetch(`${origin}/abl-init-status`, {
        method: "POST",
      });
      expect(post.status).toBe(405);
      expect(post.headers.get("allow")).toBe("GET, HEAD");
      expect(await post.json()).toMatchObject({
        status: "METHOD_NOT_ALLOWED",
        mutationSurface: false,
      });

      const head = await fetch(`${origin}/abl-init-status`, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");

      await setStatus("HARDENING_PROVIDER_CREDENTIALS");
      const hardening = await fetch(`${origin}/abl-init-status`);
      expect(await hardening.json()).toMatchObject({
        status: "HARDENING_PROVIDER_CREDENTIALS",
        ready: false,
        mutationSurface: false,
      });

      await setStatus("FAILED:INSTALLING_UID_EGRESS_POLICY:3");
      const failed = await fetch(`${origin}/abl-init-status`);
      expect(await failed.json()).toMatchObject({
        status: "FAILED:INSTALLING_UID_EGRESS_POLICY:3",
        ready: false,
        mutationSurface: false,
      });

      await setStatus("secret=must-never-appear");
      const invalid = await fetch(`${origin}/abl-init-status`);
      expect(invalid.status).toBe(500);
      expect(await invalid.text()).toBe(
        JSON.stringify({
          service: "abl-body-init-diagnostics",
          status: "INVALID_STATUS",
          ready: false,
          mutationSurface: false,
        }),
      );
    } finally {
      child.kill("SIGTERM");
      await once(child, "exit");
      await rm(directory, { recursive: true, force: true });
    }
  });
});
