import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import {
  SandboxInstance,
  getImage,
  getSandbox,
  updateSandbox,
} from "@blaxel/core";
import { z } from "zod";

const workspace = "agent-basketball-league";
const region = "us-was-1";
const imageReference = /^sandbox\/[a-z0-9-]+:[a-z0-9]{12}$/;
const releaseCommit = /^[0-9a-f]{40}$/;
const exactRoles = z.enum(["REFEREE", "REPLAY"]);
const resourcePlanSchema = z
  .object({
    officialCareers: z
      .array(
        z.strictObject({
          careerId: z.string().min(1),
          careerResourceName: z.string().min(1),
          fixedBrokerResourceName: z.string().min(1),
          role: exactRoles,
          roleClass: z.enum(["REFEREE", "REPLAY_OFFICIAL"]),
        }),
      )
      .length(8),
  })
  .passthrough();
const identitySchema = z
  .strictObject({
    candidateDid: z.string().startsWith("did:abl:"),
    signingAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .passthrough();
const baselineEvidenceSchema = z.object({
  careers: z.array(
    z.object({
      careerId: z.string().min(1),
      careerDid: z.string().startsWith("did:abl:"),
      signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    }),
  ),
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

function assertRuntimeAncestry(runtimeRelease: string): string {
  if (!releaseCommit.test(runtimeRelease))
    throw new Error("ABL_RUNTIME_RELEASE must be a full Git commit");
  const deploymentToolCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", runtimeRelease, deploymentToolCommit],
    { stdio: "ignore" },
  );
  return deploymentToolCommit;
}

function sandboxImageName(reference: string): {
  imageName: string;
  revision: string;
} {
  if (!imageReference.test(reference))
    throw new Error("Runtime image must use an exact 12-character revision");
  const [repository, revision] = reference.slice("sandbox/".length).split(":");
  if (repository === undefined || revision === undefined)
    throw new Error("Malformed runtime image reference");
  return { imageName: repository, revision };
}

async function assertImage(reference: string): Promise<void> {
  const { imageName, revision } = sandboxImageName(reference);
  const image = (
    await getImage({
      path: { resourceType: "sandbox", imageName },
      throwOnError: true,
    })
  ).data;
  const tag = image.spec.tags?.find((candidate) => candidate.name === revision);
  if (
    image.metadata.status !== "BUILT" ||
    tag === undefined ||
    tag.size === undefined ||
    tag.size <= 0
  )
    throw new Error(`${reference} is not an attributable built image`);
}

async function waitForDeployment(name: string): Promise<SandboxInstance> {
  let current = await SandboxInstance.get(name);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (current.status === "DEPLOYED") return current;
    if (current.status === "FAILED")
      throw new Error(`${name} deployment failed`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    current = await SandboxInstance.get(name);
  }
  throw new Error(`${name} did not become DEPLOYED`);
}

async function waitForHealth(name: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const sandbox = await SandboxInstance.get(name);
      const response = await sandbox.fetch(3_000, "/health", {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
    } catch {
      // An immutable Sandbox update briefly closes the application port.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${name} did not become healthy`);
}

async function startProcess(
  sandbox: SandboxInstance,
  input: Parameters<SandboxInstance["process"]["exec"]>[0] & {
    name: string;
  },
): Promise<void> {
  const processes = await sandbox.process.list();
  if (
    processes.some(
      (candidate) =>
        candidate.name === input.name && candidate.status === "running",
    )
  )
    try {
      await sandbox.process.stop(input.name);
    } catch {
      // An immutable update can leave a stale process readback briefly visible.
    }
  await sandbox.process.exec(input);
}

async function publicIdentity(
  name: string,
  fallback?: z.infer<typeof identitySchema>,
) {
  let lastStatus = 0;
  const attempts = fallback === undefined ? 30 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const sandbox = await SandboxInstance.get(name);
      const response = await sandbox.fetch(3_000, "/v1/career/identity");
      lastStatus = response.status;
      if (response.ok) return identitySchema.parse(await response.json());
    } catch {
      // Provider routing can briefly lag a successful DEPLOYED readback.
    }
    if (attempt + 1 < attempts)
      await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} identity readback failed (last ${lastStatus})`);
}

function assertRevealedSecrets(name: string, sandbox: SandboxInstance): void {
  for (const entry of sandbox.spec.runtime?.envs ?? [])
    if (entry.secret === true && (entry.value === "" || entry.value === "****"))
      throw new Error(`${name} returned a masked secret during exact update`);
}

async function revealedSandbox(name: string): Promise<SandboxInstance> {
  const sandbox = new SandboxInstance(
    (
      await getSandbox({
        path: { sandboxName: name },
        query: { show_secrets: true },
        throwOnError: true,
      })
    ).data,
  );
  if (
    sandbox.metadata.name !== name ||
    sandbox.metadata.workspace !== workspace ||
    sandbox.spec.region !== region ||
    sandbox.spec.runtime === undefined
  )
    throw new Error(`${name} is outside the exact deployment boundary`);
  assertRevealedSecrets(name, sandbox);
  return sandbox;
}

function withEnvironmentValue(
  entries: NonNullable<SandboxInstance["spec"]["runtime"]>["envs"],
  name: string,
  value: string,
) {
  const current = entries ?? [];
  const found = current.some((entry) => entry.name === name);
  return found
    ? current.map((entry) =>
        entry.name === name ? { ...entry, value, secret: false } : entry,
      )
    : [...current, { name, value, secret: false }];
}

async function updateExactSandbox(input: {
  sandbox: SandboxInstance;
  image: string;
  runtimeRelease: string;
  envs: NonNullable<NonNullable<SandboxInstance["spec"]["runtime"]>["envs"]>;
}): Promise<SandboxInstance> {
  const current = input.sandbox;
  if (current.spec.runtime === undefined)
    throw new Error(`${current.metadata.name} has no runtime`);
  const updated = await updateSandbox({
    path: { sandboxName: current.metadata.name },
    body: {
      metadata: {
        name: current.metadata.name,
        ...(current.metadata.displayName === undefined
          ? {}
          : { displayName: current.metadata.displayName }),
        ...(current.metadata.externalId === undefined
          ? {}
          : { externalId: current.metadata.externalId }),
        labels: {
          ...current.metadata.labels,
          "abl-release": input.runtimeRelease,
        },
      },
      spec: {
        ...current.spec,
        runtime: {
          ...current.spec.runtime,
          image: input.image,
          envs: input.envs,
        },
      },
    },
    throwOnError: true,
  });
  return waitForDeployment(updated.data.metadata.name);
}

async function main() {
  const runtimeRelease = required("ABL_RUNTIME_RELEASE");
  const deploymentToolCommit = assertRuntimeAncestry(runtimeRelease);
  const careerImage = required("ABL_NEUTRAL_OFFICIAL_CAREER_IMAGE");
  const brokerImage = required("ABL_NEUTRAL_OFFICIAL_BROKER_IMAGE");
  const apply = process.argv.includes("--apply");
  await Promise.all([assertImage(careerImage), assertImage(brokerImage)]);
  const plan = resourcePlanSchema.parse(
    JSON.parse(
      await readFile(
        new URL(
          "../infra/blaxel/neutral-officials/resource-plan.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const baselineEvidencePath =
    process.env.ABL_NEUTRAL_OFFICIAL_BASELINE_EVIDENCE;
  const baselineIdentities = new Map<string, z.infer<typeof identitySchema>>();
  if (baselineEvidencePath !== undefined) {
    const baseline = baselineEvidenceSchema.parse(
      JSON.parse(await readFile(baselineEvidencePath, "utf8")),
    );
    for (const career of baseline.careers)
      baselineIdentities.set(career.careerId, {
        candidateDid: career.careerDid,
        signingAddress: career.signerAddress,
      });
  }
  const results = [];
  for (const official of plan.officialCareers) {
    const career = apply
      ? await revealedSandbox(official.careerResourceName)
      : await SandboxInstance.get(official.careerResourceName);
    const broker = apply
      ? await revealedSandbox(official.fixedBrokerResourceName)
      : await SandboxInstance.get(official.fixedBrokerResourceName);
    if (
      career.status !== "DEPLOYED" ||
      broker.status !== "DEPLOYED" ||
      career.metadata.labels?.["abl-official-role"] !==
        official.role.toLowerCase() ||
      broker.metadata.labels?.["abl-official-role"] !==
        official.role.toLowerCase() ||
      career.metadata.labels?.["abl-governance-authority"] !== "none"
    )
      throw new Error(`${official.careerId} runtime inventory drifted`);
    const identityBefore = await publicIdentity(
      official.careerResourceName,
      baselineIdentities.get(official.careerId),
    );
    if (apply) {
      const brokerEnvs = withEnvironmentValue(
        broker.spec.runtime?.envs,
        "ABL_OFFICIAL_MODEL_STATE_DIRECTORY",
        "/tmp/abl-official-model-state",
      );
      const deployedBroker = await updateExactSandbox({
        sandbox: broker,
        image: brokerImage,
        runtimeRelease,
        envs: brokerEnvs,
      });
      await startProcess(deployedBroker, {
        name: "abl-fixed-broker",
        command: "node dist/index.js",
        env: {
          HOST: "0.0.0.0",
          PORT: "3000",
          ABL_CAREER_CAPABILITY_RENEWAL_MODE: "ENABLED",
          ABL_CAREER_SIGNER_ADDRESS: identityBefore.signingAddress,
        },
        workingDir: "/opt/abl",
        waitForCompletion: false,
        keepAlive: true,
        timeout: 0,
        restartOnFailure: true,
        maxRestarts: -1,
      });
      await waitForHealth(official.fixedBrokerResourceName);

      const careerEnvs = withEnvironmentValue(
        career.spec.runtime?.envs,
        "ABL_RUNTIME_IMAGE_REFERENCE",
        careerImage,
      );
      const deployedCareer = await updateExactSandbox({
        sandbox: career,
        image: careerImage,
        runtimeRelease,
        envs: careerEnvs,
      });
      await startProcess(deployedCareer, {
        name: "abl-career-runtime",
        command: "node dist/index.js",
        env: { HOST: "0.0.0.0", PORT: "3000" },
        workingDir: "/opt/abl",
        waitForCompletion: false,
        keepAlive: true,
        timeout: 0,
        restartOnFailure: true,
        maxRestarts: -1,
      });
      await waitForHealth(official.careerResourceName);
    }
    const identityAfter = await publicIdentity(official.careerResourceName);
    const currentCareer = await SandboxInstance.get(
      official.careerResourceName,
    );
    const currentBroker = await SandboxInstance.get(
      official.fixedBrokerResourceName,
    );
    if (
      identityAfter.candidateDid !== identityBefore.candidateDid ||
      identityAfter.signingAddress.toLowerCase() !==
        identityBefore.signingAddress.toLowerCase() ||
      (apply &&
        (currentCareer.spec.runtime?.image !== careerImage ||
          currentBroker.spec.runtime?.image !== brokerImage ||
          currentCareer.metadata.labels?.["abl-release"] !== runtimeRelease ||
          currentBroker.metadata.labels?.["abl-release"] !== runtimeRelease))
    )
      throw new Error(`${official.careerId} immutable runtime update drifted`);
    results.push({
      careerId: official.careerId,
      role: official.role,
      careerStatus: currentCareer.status,
      brokerStatus: currentBroker.status,
      identityPreserved: true,
    });
  }
  process.stdout.write(
    `${JSON.stringify({
      status: apply ? "DEPLOYED" : "READ_ONLY_READY",
      workspace,
      region,
      runtimeRelease,
      deploymentToolCommit,
      careerImage,
      brokerImage,
      officialCount: results.length,
      results,
      secretValuesRecorded: false,
      genesis: false,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
