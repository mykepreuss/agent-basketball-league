import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const guard = fileURLToPath(
  new URL(
    "../../../infra/sandbox/abl-provider-credential-guard.mjs",
    import.meta.url,
  ),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function discover(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [guard, "discover"], {
    encoding: "utf8",
    env: environment,
  });
}

describe("provider credential guard", () => {
  it("accepts one exact production identity-token template", () => {
    const result = discover({
      HTTPS_PROXY:
        "http://none:{{file(/var/run/secrets/blaxel.ai/identity/token)}}@proxy.internal:8080",
    });
    expect(result).toMatchObject({
      status: 0,
      stdout: "/var/run/secrets/blaxel.ai/identity/token",
      stderr: "",
    });
  });

  it("reads an exact development template from the mounted environment file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abl-provider-guard-"));
    temporaryDirectories.push(directory);
    const envFile = join(directory, "environment");
    await writeFile(
      envFile,
      Buffer.from(
        "HTTPS_PROXY\0http://none:{{file(/var/run/secrets/blaxel.dev/identity/token)}}@proxy.internal:8080\0",
      ),
    );
    const result = discover({ BL_ENV_VAR_PATH: envFile });
    expect(result).toMatchObject({
      status: 0,
      stdout: "/var/run/secrets/blaxel.dev/identity/token",
      stderr: "",
    });
  });

  it("does not reload a proxy template over an explicitly empty variable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abl-provider-guard-"));
    temporaryDirectories.push(directory);
    const envFile = join(directory, "environment");
    await writeFile(
      envFile,
      Buffer.from(
        "HTTPS_PROXY\0http://none:{{file(/var/run/secrets/blaxel.ai/identity/token)}}@proxy.internal:8080\0",
      ),
    );
    const result = discover({
      ABL_HTTPS_PROXY_PRESENT: "x",
      BL_ENV_VAR_PATH: envFile,
      HTTPS_PROXY: "",
    });
    expect(result.status).toBe(78);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it.each([
    ["missing", {}],
    [
      "alternate path",
      {
        HTTPS_PROXY:
          "http://none:{{file(/tmp/attacker-token)}}@proxy.internal:8080",
      },
    ],
    [
      "two paths",
      {
        HTTP_PROXY:
          "http://none:{{file(/var/run/secrets/blaxel.ai/identity/token)}}@proxy.internal:8080",
        HTTPS_PROXY:
          "http://none:{{file(/var/run/secrets/blaxel.dev/identity/token)}}@proxy.internal:8080",
      },
    ],
    [
      "two directives",
      {
        HTTPS_PROXY:
          "http://{{file(/var/run/secrets/blaxel.ai/identity/token)}}:{{file(/var/run/secrets/blaxel.ai/identity/token)}}@proxy.internal:8080",
      },
    ],
  ])("fails closed for %s", (_name, environment) => {
    const result = discover(environment);
    expect(result.status).toBe(78);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
