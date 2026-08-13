import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { platform, release, arch } from "node:os";
import { fileURLToPath } from "node:url";

import { CORE_ROUTE_CATALOG } from "../apps/core-api/src/server.js";
import { PUBLIC_ROUTE_CATALOG } from "../apps/public-api/src/server.js";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ansiPattern = new RegExp("\\u001b\\[[0-9;]*m", "g");

interface SuiteResult {
  name: string;
  command: string;
  status: "PASS" | "FAIL";
  exitCode: number;
  assertions: number;
  testFiles: number;
  successfulTasks: number | null;
  totalTasks: number | null;
  outputSha256: string;
  outputTail: readonly string[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseCount(output: string, pattern: RegExp): number {
  return [...output.matchAll(pattern)].reduce(
    (total, match) => total + Number.parseInt(match[1] ?? "0", 10),
    0,
  );
}

async function runSuite(name: string, script: string): Promise<SuiteResult> {
  const output = await new Promise<{ code: number; text: string }>(
    (resolve, reject) => {
      const child = spawn("corepack", ["pnpm", script], {
        cwd: repositoryRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, text }));
    },
  );
  const clean = output.text.replace(ansiPattern, "");
  const taskMatch = clean.match(/Tasks:\s+(\d+) successful, (\d+) total/);
  return {
    name,
    command: `pnpm ${script}`,
    status: output.code === 0 ? "PASS" : "FAIL",
    exitCode: output.code,
    assertions: parseCount(clean, /Tests\s+(\d+) passed/g),
    testFiles: parseCount(clean, /Test Files\s+(\d+) passed/g),
    successfulTasks:
      taskMatch === null ? null : Number.parseInt(taskMatch[1] ?? "0", 10),
    totalTasks:
      taskMatch === null ? null : Number.parseInt(taskMatch[2] ?? "0", 10),
    outputSha256: sha256(clean),
    outputTail: clean.trim().split("\n").slice(-20),
  };
}

async function main(): Promise<void> {
  const routeCatalog = {
    version: "1.0.0-pre-genesis",
    state: "IMPLEMENTED_PRE_GENESIS_FAIL_CLOSED",
    routes: [
      ...PUBLIC_ROUTE_CATALOG.map((route) => ({
        ...route,
        service: "abl-public-api",
      })),
      ...CORE_ROUTE_CATALOG.map((route) => ({
        ...route,
        service: "abl-core-api",
      })),
      {
        method: "GET",
        path: "/arena",
        exposure: "PUBLIC_READ_ONLY",
        service: "abl-arena",
      },
    ].sort((left, right) =>
      `${left.path}:${left.method}`.localeCompare(
        `${right.path}:${right.method}`,
      ),
    ),
  };
  await writeFile(
    join(repositoryRoot, "docs/architecture/ROUTE_CATALOG.json"),
    `${JSON.stringify(routeCatalog, null, 2)}\n`,
    { mode: 0o600 },
  );

  const suiteSpecs = [
    ["format", "format:check"],
    ["typecheck", "check"],
    ["unit-integration-property-contract-migration-api", "test"],
    ["acceptance-replay-load-recovery", "test:acceptance"],
    ["adversarial-security", "test:adversarial"],
    ["production-build", "build"],
  ] as const;
  const suites: SuiteResult[] = [];
  for (const [name, script] of suiteSpecs) {
    process.stdout.write(`running ${name}\n`);
    const result = await runSuite(name, script);
    suites.push(result);
    process.stdout.write(`${name}: ${result.status}\n`);
    if (result.status === "FAIL") break;
  }
  const stableResult = {
    resultVersion: "1.0.0",
    suites: suites.map((suite) => ({
      name: suite.name,
      command: suite.command,
      status: suite.status,
      exitCode: suite.exitCode,
      assertions: suite.assertions,
      testFiles: suite.testFiles,
      successfulTasks: suite.successfulTasks,
      totalTasks: suite.totalTasks,
    })),
  };
  const stableResultDigest = `0x${sha256(JSON.stringify(stableResult))}`;
  const allPassed =
    suites.length === suiteSpecs.length &&
    suites.every((suite) => suite.status === "PASS");
  const report = {
    ...stableResult,
    recordedAt: new Date().toISOString(),
    environment: {
      platform: `${platform()} ${release()} ${arch()}`,
      node: process.version,
      pinnedNode: "24.18.0",
      pnpm: "11.21.0",
    },
    overall: allPassed ? "PASS_LOCAL_WITH_EXTERNAL_GATES" : "FAIL",
    stableResultDigest,
    routeCount: routeCatalog.routes.length,
    rawResults: suites,
    limitations: [
      "Docker sandbox escape execution is unavailable.",
      "Four target Blaxel workspaces and Agent Drive are unavailable.",
      "Neon PITR lacks project credentials.",
      "Base finality lacks a ratified deployment and credentials.",
      "Remote capacity reservations and provider costs were not requested.",
      "Founding-agent decisions and signatures do not exist.",
      "Hardware-backed non-exportable signing is not supported by the local fixture.",
    ],
  };
  await writeFile(
    join(repositoryRoot, "docs/evidence/final-local-results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  if (!allPassed) throw new Error("One or more final local suites failed");
  process.stdout.write(`stable result digest: ${stableResultDigest}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
