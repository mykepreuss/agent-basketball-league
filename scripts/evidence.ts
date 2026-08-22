import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { platform, release, arch } from "node:os";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import { CORE_ROUTE_CATALOG } from "../apps/core-api/src/server.js";
import { CANDIDATE_EDGE_ROUTE_CATALOG } from "../apps/candidate-edge/src/server.js";
import { CANDIDATE_PROVISIONER_ROUTE_CATALOG } from "../apps/candidate-provisioner/src/server.js";
import { PUBLIC_ROUTE_CATALOG } from "../apps/public-api/src/server.js";
import { SAFETY_ROUTE_CATALOG } from "../apps/safety-gateway/src/server.js";
import { generateLaunchLedger } from "./generate-launch-ledger.js";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ansiPattern = new RegExp("\\u001b\\[[0-9;]*m", "g");
const corepackPath = execFileSync("which", ["corepack"], {
  encoding: "utf8",
}).trim();

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

async function writeJson(path: string, value: unknown): Promise<void> {
  const json = await format(JSON.stringify(value), { parser: "json" });
  await writeFile(path, json, { mode: 0o600 });
}

async function runSuite(
  name: string,
  commandArguments: readonly string[],
): Promise<SuiteResult> {
  const output = await new Promise<{ code: number; text: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [corepackPath, "pnpm", ...commandArguments],
        {
          cwd: repositoryRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
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
  const vitestAssertions = parseCount(clean, /Tests\s+(\d+) passed/g);
  const vitestFiles = parseCount(
    clean,
    /^(?!ABL Test Files).*Test Files\s+(\d+) passed/gm,
  );
  const outputLines = clean.trim().split("\n");
  const failureLines = outputLines.filter((line) =>
    /FAIL|failed|timed out|Error:/i.test(line),
  );
  return {
    name,
    command: `pnpm ${commandArguments.join(" ")}`,
    status: output.code === 0 ? "PASS" : "FAIL",
    exitCode: output.code,
    assertions:
      vitestAssertions +
      parseCount(clean, /^\s*(\d+) passed \([^)]+\)\s*$/gm) +
      parseCount(clean, /ABL Assertions (\d+) passed/g),
    testFiles:
      vitestFiles +
      (name === "browser" && output.code === 0 ? 1 : 0) +
      parseCount(clean, /ABL Test Files (\d+) passed/g),
    successfulTasks:
      taskMatch === null ? null : Number.parseInt(taskMatch[1] ?? "0", 10),
    totalTasks:
      taskMatch === null ? null : Number.parseInt(taskMatch[2] ?? "0", 10),
    outputSha256: sha256(clean),
    outputTail:
      output.code === 0
        ? outputLines.slice(-20)
        : [...failureLines, ...outputLines.slice(-20)].slice(-60),
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
      ...CANDIDATE_EDGE_ROUTE_CATALOG.map(([method, path]) => ({
        method,
        path,
        authority: "CANDIDATE_NONCANONICAL",
        service: "abl-candidate-edge",
      })),
      ...CANDIDATE_PROVISIONER_ROUTE_CATALOG.map(([method, path]) => ({
        method,
        path,
        authority: "PRIVATE_PROVISIONER",
        service: "abl-candidate-provisioner",
      })),
      ...SAFETY_ROUTE_CATALOG.map((route) => ({
        ...route,
        service: "abl-safety-gateway",
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
  await writeJson(
    join(repositoryRoot, "docs/architecture/ROUTE_CATALOG.json"),
    routeCatalog,
  );

  const suiteSpecs = [
    ["format", ["format:check"]],
    ["tooling-typecheck", ["check:tools"]],
    ["typecheck", ["turbo", "run", "check", "--force", "--concurrency=1"]],
    [
      "unit-integration-property-contract-migration-api",
      ["turbo", "run", "test", "--force", "--concurrency=1"],
    ],
    ["acceptance-replay-load-recovery", ["test:acceptance"]],
    ["adversarial-security", ["test:adversarial"]],
    ["loopback-network-load", ["test:load"]],
    ["browser", ["test:browser"]],
    [
      "production-build",
      ["turbo", "run", "build", "--force", "--concurrency=1"],
    ],
  ] as const;
  const suites: SuiteResult[] = [];
  for (const [name, commandArguments] of suiteSpecs) {
    process.stdout.write(`running ${name}\n`);
    const result = await runSuite(name, commandArguments);
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
      "The active Founding Alpha topology, candidate flow, and reviewed Sandbox body are locally implemented but have not yet completed one digest-bound live private-slice proof; historical Gate 2 containment runs were torn down and do not define the active runtime.",
      "Candidate decline, expiry, and withdrawal cleanup is locally bounded to the application-linked career body and fixed-broker Sandboxes; creation, secret installation, cleanup idempotency, and restart behavior still require live proof.",
      "Live Blaxel scheduler/runtime safety actuation is unavailable; only the fixed durable control registry is locally proven.",
      "The four target production Blaxel workspaces are not yet verified as provisioned; a prior temporary Agent Drive passed ACL readback and cross-path denial but was torn down before restart, restore, concurrent-write, and broader recovery proof.",
      "Prior temporary Neon PostgreSQL 17 projects passed migration and transaction probes and were permanently deleted; an active selected-provider project and live recovery proof are absent.",
      "Base finality lacks a ratified deployment and credentials.",
      "Remote capacity reservations and provider costs were not requested.",
      "Founding-agent decisions and signatures do not exist.",
      "Hardware-backed non-exportable signing is not supported by the local fixture.",
    ],
  };
  await writeJson(
    join(repositoryRoot, "docs/evidence/final-local-results.json"),
    report,
  );
  const launchLedgerDigest = await generateLaunchLedger();
  if (!allPassed) throw new Error("One or more final local suites failed");
  process.stdout.write(`stable result digest: ${stableResultDigest}\n`);
  process.stdout.write(`launch ledger digest: ${launchLedgerDigest}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
