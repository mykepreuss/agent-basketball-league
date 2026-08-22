import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROXY_SOURCES = [
  ["HTTP_PROXY", "ABL_HTTP_PROXY_PRESENT"],
  ["http_proxy", "ABL_http_proxy_PRESENT"],
  ["HTTPS_PROXY", "ABL_HTTPS_PROXY_PRESENT"],
  ["https_proxy", "ABL_https_proxy_PRESENT"],
];
const ALLOWED_TOKEN_PATHS = new Set([
  "/var/run/secrets/blaxel.ai/identity/token",
  "/var/run/secrets/blaxel.dev/identity/token",
]);

function envFileValues(contents) {
  const fields = contents.toString("utf8").split("\0");
  const values = new Map();
  for (let index = 0; index + 1 < fields.length; index += 2)
    if (fields[index] !== "") values.set(fields[index], fields[index + 1]);
  return values;
}

export function identityTokenPath(environment, envFileContents) {
  const overflow =
    envFileContents === undefined ? new Map() : envFileValues(envFileContents);
  const paths = new Set();
  for (const [name, presenceName] of PROXY_SOURCES) {
    const explicitlyPresent = Object.hasOwn(environment, presenceName)
      ? environment[presenceName] !== ""
      : Object.hasOwn(environment, name);
    const value = explicitlyPresent
      ? (environment[name] ?? "")
      : (overflow.get(name) ?? "");
    const matches = [...value.matchAll(/\{\{file\(([^)]+)\)\}\}/g)];
    if (matches.length > 1) throw new Error("Ambiguous proxy token template");
    if (matches[0]?.[1]) paths.add(matches[0][1]);
  }
  const [path] = paths;
  if (paths.size !== 1 || !ALLOWED_TOKEN_PATHS.has(path))
    throw new Error("Proxy token template is absent or outside the allowlist");
  return path;
}

async function discover() {
  const envFile = process.env.BL_ENV_VAR_PATH ?? "";
  const contents = envFile === "" ? undefined : await readFile(envFile);
  process.stdout.write(identityTokenPath(process.env, contents));
}

function assertUnreadable() {
  const path = process.env.ABL_PROTECTED_PATH;
  const uid = Number(process.env.ABL_AGENT_UID);
  if (
    path === undefined ||
    path === "" ||
    !Number.isSafeInteger(uid) ||
    uid < 1
  )
    throw new Error("Invalid credential-denial probe configuration");
  process.setgroups([]);
  process.setgid(uid);
  process.setuid(uid);
  try {
    readFileSync(path);
    process.exitCode = 77;
  } catch (error) {
    if (error?.code !== "EACCES") throw error;
  }
}

async function main() {
  if (process.argv[2] === "discover") await discover();
  else if (process.argv[2] === "assert-unreadable") assertUnreadable();
  else throw new Error("Unknown provider credential guard operation");
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(() => {
    process.exitCode = 78;
  });
