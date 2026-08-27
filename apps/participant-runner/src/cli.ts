#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { sha256Commitment } from "@abl/recognition";
import { RunnerDelegationSchema, RunnerPairingOfferSchema } from "@abl/schemas";

import {
  CommandAdapter,
  DeterministicTestAdapter,
  OpenAiCompatibleAdapter,
  productCommandAdapter,
  type InferenceAdapter,
} from "./adapters.js";
import { RelayClient } from "./client.js";
import { participantBlaxelManifest } from "./manifest.js";
import { pairRunner, runParticipantRunner, runnerDoctor } from "./runner.js";
import { loadRunnerStore, removeRunnerStore } from "./store.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const value = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const storePath =
  process.env.ABL_RUNNER_STORE_PATH ??
  join(homedir(), ".abl-runner", "runner.json");

async function executableDigest(): Promise<`0x${string}`> {
  const executablePath = process.argv[1];
  if (executablePath === undefined)
    throw new Error("Cannot determine the runner executable path");
  return `0x${createHash("sha256")
    .update(await readFile(executablePath))
    .digest("hex")}`;
}

function adapter(): InferenceAdapter {
  const kind = process.env.ABL_RUNNER_ADAPTER ?? "command";
  if (kind === "deterministic")
    return new DeterministicTestAdapter(
      sha256Commitment("abl-runner:deterministic:v2"),
    );
  if (kind === "openai-compatible") {
    const endpoint = process.env.ABL_RUNNER_OPENAI_ENDPOINT;
    const model = process.env.ABL_RUNNER_OPENAI_MODEL;
    if (endpoint === undefined || model === undefined)
      throw new Error("OpenAI-compatible adapter requires endpoint and model");
    return new OpenAiCompatibleAdapter({
      endpoint,
      model,
      ...(process.env.ABL_RUNNER_OPENAI_API_KEY === undefined
        ? {}
        : { apiKey: process.env.ABL_RUNNER_OPENAI_API_KEY }),
      buildDigest: sha256Commitment({ kind, endpoint, model }),
    });
  }
  const product = process.env.ABL_RUNNER_PRODUCT;
  if (
    product === "CODEX_CLI" ||
    product === "CLAUDE_CODE" ||
    product === "GEMINI_CLI" ||
    product === "QWEN_LOCAL"
  )
    return productCommandAdapter({
      product,
      ...(process.env.ABL_RUNNER_COMMAND === undefined
        ? {}
        : { executable: process.env.ABL_RUNNER_COMMAND }),
      ...(process.env.ABL_RUNNER_MODEL_IDENTITY === undefined
        ? {}
        : { modelIdentity: process.env.ABL_RUNNER_MODEL_IDENTITY }),
      buildDigest: sha256Commitment({
        product,
        executable: process.env.ABL_RUNNER_COMMAND ?? null,
        modelIdentity: process.env.ABL_RUNNER_MODEL_IDENTITY ?? null,
      }),
    });
  const executable = process.env.ABL_RUNNER_COMMAND;
  if (executable === undefined)
    throw new Error(
      "Command adapter requires ABL_RUNNER_COMMAND (Codex, Claude Code, Gemini CLI, or local Qwen command)",
    );
  const commandArgs = JSON.parse(
    process.env.ABL_RUNNER_COMMAND_ARGS_JSON ?? "[]",
  ) as string[];
  return new CommandAdapter({
    command: executable,
    args: commandArgs,
    identity: process.env.ABL_RUNNER_MODEL_IDENTITY ?? `command/${executable}`,
    buildDigest: sha256Commitment({ executable, commandArgs }),
  });
}

if (command === "pair") {
  const offerPath = value("--offer");
  if (offerPath === undefined)
    throw new Error("Usage: abl-runner pair --offer <offer.json>");
  const offer = RunnerPairingOfferSchema.parse(
    JSON.parse(await readFile(offerPath, "utf8")),
  );
  const paired = await pairRunner({
    offer,
    storePath,
    verifiedBundleDigest: await executableDigest(),
  });
  console.log(
    JSON.stringify({
      status: "PAIRED",
      runnerId: paired.runnerId,
      careerDid: (paired.delegation as { careerDid: string }).careerDid,
      nextAction: "abl-runner doctor",
    }),
  );
} else if (command === "doctor") {
  const result = await runnerDoctor({
    storePath,
    adapter: adapter(),
    verifiedBundleDigest: await executableDigest(),
  });
  console.log(JSON.stringify(result));
  if (!result.ready) process.exitCode = 1;
} else if (command === "run") {
  await runParticipantRunner({
    storePath,
    adapter: adapter(),
    verifiedBundleDigest: await executableDigest(),
    once: args.includes("--once"),
  });
} else if (command === "status") {
  const store = await loadRunnerStore(storePath);
  const client = new RelayClient({
    origin: store.relayOrigin,
    privateKey: store.signingPrivateKey as `0x${string}`,
    delegation: RunnerDelegationSchema.parse(store.delegation),
  });
  console.log(JSON.stringify(await client.status()));
} else if (command === "unpair") {
  const store = await loadRunnerStore(storePath);
  const client = new RelayClient({
    origin: store.relayOrigin,
    privateKey: store.signingPrivateKey as `0x${string}`,
    delegation: RunnerDelegationSchema.parse(store.delegation),
  });
  await client.unpair();
  await removeRunnerStore(storePath);
  console.log(JSON.stringify({ status: "UNPAIRED" }));
} else if (command === "blaxel-manifest") {
  const name = value("--name") ?? "abl-runner";
  const image = value("--image");
  const relayOrigin = value("--relay");
  if (image === undefined || relayOrigin === undefined)
    throw new Error(
      "Usage: abl-runner blaxel-manifest --image <immutable-image> --relay <origin> [--name <name>]",
    );
  process.stdout.write(
    participantBlaxelManifest({ name, immutableImage: image, relayOrigin }),
  );
} else {
  process.stdout.write(
    [
      "ABL participant runner",
      "",
      "Commands:",
      "  abl-runner pair --offer <offer.json>",
      "  abl-runner doctor",
      "  abl-runner run [--once]",
      "  abl-runner status",
      "  abl-runner unpair",
      "  abl-runner blaxel-manifest --image <immutable-image> --relay <origin>",
      "",
    ].join("\n"),
  );
}
