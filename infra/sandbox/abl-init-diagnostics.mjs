import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const SERVICE = "abl-body-init-diagnostics";
const STATUS_ROUTE = "/abl-init-status";
const STATUS_FILE = process.env.ABL_INIT_STATUS_FILE ?? "/run/abl-init-status";
const PORT = Number(process.env.ABL_INIT_DIAGNOSTIC_PORT ?? "8080");
const DIAGNOSTIC_UID = Number(process.env.ABL_INIT_DIAGNOSTIC_UID ?? "10102");
const DIAGNOSTIC_GID = Number(process.env.ABL_INIT_DIAGNOSTIC_GID ?? "10102");
const STATUS_PATTERN =
  /^(?:STARTING_DIAGNOSTICS|VALIDATING_CONFIGURATION|RESOLVING_FILTERED_PROXY|HARDENING_PROVIDER_CREDENTIALS|PREPARING_AGENT_WORKSPACE|INSTALLING_UID_EGRESS_POLICY|INSTALLING_SHORT_LIVED_CAPABILITY|READY|FAILED:[A-Z0-9_]+:(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))$/;

if (
  !Number.isInteger(PORT) ||
  PORT < 1 ||
  PORT > 65_535 ||
  !Number.isInteger(DIAGNOSTIC_UID) ||
  DIAGNOSTIC_UID < 1 ||
  !Number.isInteger(DIAGNOSTIC_GID) ||
  DIAGNOSTIC_GID < 1
)
  throw new Error("Invalid body-init diagnostic configuration");

if (process.getuid?.() === 0) {
  process.setgroups?.([]);
  process.setgid?.(DIAGNOSTIC_GID);
  process.setuid?.(DIAGNOSTIC_UID);
  if (process.getuid?.() === 0)
    throw new Error("Body-init diagnostics refused to remain root");
}

for (const name of Object.keys(process.env)) delete process.env[name];

function writeJson(response, statusCode, payload, includeBody = true) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(includeBody ? body : undefined);
}

async function readStatus() {
  const status = (await readFile(STATUS_FILE, "utf8")).trim();
  if (!STATUS_PATTERN.test(status)) throw new Error("Invalid status marker");
  return status;
}

const server = createServer(async (request, response) => {
  const includeBody = request.method !== "HEAD";
  if (request.url !== STATUS_ROUTE) {
    writeJson(
      response,
      404,
      {
        service: SERVICE,
        status: "NOT_FOUND",
        ready: false,
        mutationSurface: false,
      },
      includeBody,
    );
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    writeJson(
      response,
      405,
      {
        service: SERVICE,
        status: "METHOD_NOT_ALLOWED",
        ready: false,
        mutationSurface: false,
      },
      includeBody,
    );
    return;
  }
  try {
    const status = await readStatus();
    writeJson(
      response,
      200,
      {
        service: SERVICE,
        status,
        ready: status === "READY",
        mutationSurface: false,
      },
      includeBody,
    );
  } catch {
    writeJson(
      response,
      500,
      {
        service: SERVICE,
        status: "INVALID_STATUS",
        ready: false,
        mutationSurface: false,
      },
      includeBody,
    );
  }
});

server.headersTimeout = 5_000;
server.requestTimeout = 5_000;
server.keepAliveTimeout = 1_000;
server.maxHeadersCount = 32;

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 2_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
server.listen(PORT, "0.0.0.0");
