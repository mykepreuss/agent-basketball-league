import { randomUUID } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { PublicBeaconSoakPolicySchema } from "../packages/launch/src/index.js";
import { sha256Commitment } from "../packages/recognition/src/index.js";

const [policyInput, releaseId, apiInput, arenaInput, stateInput] =
  process.argv.slice(2);
if (!policyInput || !releaseId || !apiInput || !arenaInput || !stateInput)
  throw new Error(
    "Usage: sample-public-beacon <monitoring-policy.json> <release-commit> <public-api-origin> <arena-origin> <state.json>",
  );
if (!/^[0-9a-f]{40}$/.test(releaseId))
  throw new Error("Release commit must be a full lowercase Git commit hash");

function parseOrigin(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("Beacon origins must be credential-free HTTPS origins");
  return url.origin;
}

const origins = {
  "abl-public-api": parseOrigin(apiInput),
  "abl-spectator-arena": parseOrigin(arenaInput),
} as const;
const policyPath = resolve(policyInput);
const statePath = resolve(stateInput);
const policy = PublicBeaconSoakPolicySchema.parse(
  JSON.parse(await readFile(policyPath, "utf8")),
);
const policyDigest = sha256Commitment(policy);

const SurfaceStateSchema = z
  .strictObject({
    origin: z.string().url(),
    samples: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    maximumLatencyMs: z.number().int().nonnegative(),
    maximumSampleGapSeconds: z.number().int().nonnegative(),
    lastSampleAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((surface, context) => {
    if (surface.failures > surface.samples)
      context.addIssue({
        code: "custom",
        message: "Public surface failures cannot exceed samples",
        path: ["failures"],
      });
  });
const StateSchema = z.strictObject({
  version: z.literal(1),
  evidenceClass: z.literal("LIVE_PUBLIC_BEACON_SAMPLES"),
  stage: z.literal("READ_ONLY_BEACON_PUBLIC_SOAK"),
  releaseId: z.string().regex(/^[0-9a-f]{40}$/),
  policyDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  publicExposure: z.literal("READ_ONLY"),
  startedAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  failedRuns: z.number().int().nonnegative(),
  surfaces: z.strictObject({
    "abl-public-api": SurfaceStateSchema,
    "abl-spectator-arena": SurfaceStateSchema,
  }),
  credentialsUsed: z.literal(false),
  secretValuesRecorded: z.literal(false),
});

async function readState() {
  try {
    if (((await stat(statePath)).mode & 0o777) !== 0o600)
      throw new Error(`Public soak state must use mode 0600: ${statePath}`);
    return StateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const startedAt = new Date().toISOString();
    return StateSchema.parse({
      version: 1,
      evidenceClass: "LIVE_PUBLIC_BEACON_SAMPLES",
      stage: policy.stage,
      releaseId,
      policyDigest,
      publicExposure: policy.publicExposure,
      startedAt,
      updatedAt: startedAt,
      failedRuns: 0,
      surfaces: Object.fromEntries(
        policy.requiredSurfaces.map(({ name }) => [
          name,
          {
            origin: origins[name],
            samples: 0,
            failures: 0,
            maximumLatencyMs: 0,
            maximumSampleGapSeconds: 0,
            lastSampleAt: null,
          },
        ]),
      ),
      credentialsUsed: false,
      secretValuesRecorded: false,
    });
  }
}

const state = await readState();
if (state.releaseId !== releaseId)
  throw new Error(
    "Public soak state release does not match the requested release",
  );
if (state.policyDigest !== policyDigest)
  throw new Error("Public soak monitoring policy drifted");
for (const required of policy.requiredSurfaces) {
  const surface = state.surfaces[required.name];
  if (surface === undefined || surface.origin !== origins[required.name])
    throw new Error(`Public soak origin drifted: ${required.name}`);
}

const sampledAt = new Date().toISOString();
const observations = await Promise.all(
  policy.requiredSurfaces.map(async (required) => {
    const started = performance.now();
    let passed = false;
    try {
      const response = await fetch(
        `${origins[required.name]}${required.probePath}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      passed = response.status === required.expectedStatus;
      await response.body?.cancel();
    } catch {
      passed = false;
    }
    return {
      name: required.name,
      passed,
      latencyMs: Math.ceil(performance.now() - started),
    };
  }),
);

for (const observation of observations) {
  const surface = state.surfaces[observation.name]!;
  const sampleGapSeconds = surface.lastSampleAt
    ? Math.ceil(
        (Date.parse(sampledAt) - Date.parse(surface.lastSampleAt)) / 1_000,
      )
    : 0;
  surface.samples += 1;
  if (!observation.passed) surface.failures += 1;
  surface.maximumLatencyMs = Math.max(
    surface.maximumLatencyMs,
    observation.latencyMs,
  );
  surface.maximumSampleGapSeconds = Math.max(
    surface.maximumSampleGapSeconds,
    sampleGapSeconds,
  );
  surface.lastSampleAt = sampledAt;
}
const failed = observations.some(({ passed }) => !passed);
if (failed) state.failedRuns += 1;
state.updatedAt = sampledAt;

const persisted = StateSchema.parse(state);
const temporaryPath = resolve(
  dirname(statePath),
  `.${randomUUID()}.public-beacon-sample.json`,
);
await writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
await rename(temporaryPath, statePath);
process.stdout.write(
  `${JSON.stringify({
    status: failed ? "FAIL" : "PASS",
    releaseId,
    sampledAt,
    surfaceCount: observations.length,
    failedRuns: persisted.failedRuns,
    credentialsUsed: false,
    secretValuesPrinted: false,
  })}\n`,
);
if (failed) process.exitCode = 1;
