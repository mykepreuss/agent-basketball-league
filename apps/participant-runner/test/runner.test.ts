import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRunnerEncryptionKeyPair,
  runnerDelegationMessage,
  sealContextCapsule,
  signRunnerDelegation,
} from "@abl/cognition";
import { createSigningIdentity, sha256Commitment } from "@abl/recognition";
import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  CommandAdapter,
  DeterministicTestAdapter,
  RUNNER_BUILD_DIGEST,
  openVerifiedCareerContext,
  pairRunner,
  participantBlaxelManifest,
  productCommandSpec,
  runnerDoctor,
} from "../src/index.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  for (const path of temporaryPaths.splice(0))
    await rm(path, { recursive: true, force: true });
});

describe("participant runner", () => {
  it("authenticates the career-signed official context before inference", async () => {
    const career = createSigningIdentity();
    const attacker = createSigningIdentity();
    const runner = createSigningIdentity();
    const runnerEncryption = createRunnerEncryptionKeyPair();
    const resultRecipient = createRunnerEncryptionKeyPair();
    const runnerId = "runner-context-verification";
    const careerDid = "did:abl:career-context-verification";
    const activationId = "activation-context-verification";
    const openedAt = new Date(Date.now() - 1_000).toISOString();
    const deadlineAt = new Date(Date.now() + 60_000).toISOString();
    const scopes = [
      "RUNNER_HEARTBEAT",
      "ACTIVATION_CLAIM",
      "RESULT_SUBMISSION",
    ] as const;
    const unsignedDelegation = {
      schemaVersion: "1.0.0" as const,
      delegationId: "0198e000-0000-7000-8000-000000000611",
      careerDid,
      runnerId,
      delegateSigningAddress: runner.address,
      delegateEncryptionPublicKey:
        `0x${Buffer.from(runnerEncryption.publicKey).toString("hex")}` as const,
      scopes: [...scopes],
      issuedAt: openedAt,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    };
    const delegation = {
      ...unsignedDelegation,
      revokedAt: null,
      careerSignature: await signRunnerDelegation(
        career.privateKey,
        runnerDelegationMessage(
          unsignedDelegation,
          sha256Commitment([...scopes].sort()),
        ),
      ),
    };
    const activation = {
      schemaVersion: "1.0.0" as const,
      activationId,
      gameId: "founding-exhibition-context-verification",
      kind: "COMPETITION" as const,
      careerDid,
      role: "PLAYER" as const,
      officialObservation: "observation",
      observationCommitment: sha256Commitment("observation"),
      stateRoot: sha256Commitment("state"),
      contextPolicyCommitment: sha256Commitment("policy"),
      expectedOutputSchemaDigest: sha256Commitment("player-output"),
      openedAt,
      deadlineAt,
      playerId: "HOME-1",
      teamId: "HOME",
      windowId: "window-1",
    };
    const manifestBase = {
      schemaVersion: "1.0.0" as const,
      manifestId: "0198e000-0000-7000-8000-000000000612",
      activationId,
      careerDid,
      role: "PLAYER" as const,
      observationCommitment: activation.observationCommitment,
      stateRoot: activation.stateRoot,
      policyCommitment: activation.contextPolicyCommitment,
      selectedMaterials: [],
      excludedSecretClasses: [
        "SIGNING_KEY",
        "ENCRYPTION_KEY",
        "INFRASTRUCTURE_CREDENTIAL",
        "RAW_STORAGE_METADATA",
      ] as const,
      createdAt: openedAt,
    };
    async function requestSignedBy(
      signer: ReturnType<typeof createSigningIdentity>,
    ) {
      const manifestCommitment = sha256Commitment(manifestBase);
      const manifest = {
        ...manifestBase,
        manifestCommitment,
        careerSignature: await privateKeyToAccount(
          signer.privateKey,
        ).signMessage({ message: { raw: manifestCommitment } }),
      };
      const capsule = await sealContextCapsule({
        activationId,
        careerDid,
        runnerId,
        recipientKeyId: delegation.delegationId,
        recipientPublicKey: runnerEncryption.publicKey,
        context: {
          manifest,
          officialContext: { possession: 1 },
          materials: [],
        },
        expiresAt: deadlineAt,
      });
      const unsignedRequest = {
        schemaVersion: "1.0.0" as const,
        requestId: "0198e000-0000-7000-8000-000000000613",
        activation,
        cognitionMode: "PARTICIPANT_CONTROLLED" as const,
        contextManifestCommitment: sha256Commitment(manifest),
        capsule,
        resultRecipient: {
          keyId: "career-result-key",
          publicKey:
            `0x${Buffer.from(resultRecipient.publicKey).toString("hex")}` as const,
        },
        maximumAttempts: 1 as const,
        createdAt: openedAt,
      };
      return {
        ...unsignedRequest,
        requestCommitment: sha256Commitment(unsignedRequest),
      };
    }
    const store = {
      version: 1 as const,
      runnerId,
      relayOrigin: "https://relay.example.test",
      careerSignerAddress: career.address,
      runnerBuildDigest: RUNNER_BUILD_DIGEST,
      signingPrivateKey: runner.privateKey,
      signingAddress: runner.address,
      encryptionSecretKey: `0x${Buffer.from(runnerEncryption.secretKey).toString("hex")}`,
      encryptionPublicKey: unsignedDelegation.delegateEncryptionPublicKey,
      delegation,
      pairedAt: openedAt,
    };
    await expect(
      openVerifiedCareerContext({
        request: await requestSignedBy(career),
        store,
      }),
    ).resolves.toMatchObject({ officialContext: { possession: 1 } });
    await expect(
      openVerifiedCareerContext({
        request: await requestSignedBy(attacker),
        store,
      }),
    ).rejects.toThrow("Official context manifest authentication failed");
  });

  it("pairs with separate local keys and writes a mode-0600 store", async () => {
    const career = createSigningIdentity();
    const directory = await mkdtemp(join(tmpdir(), "abl-runner-test-"));
    temporaryPaths.push(directory);
    const storePath = join(directory, "runner.json");
    const store = await pairRunner({
      storePath,
      verifiedBundleDigest: RUNNER_BUILD_DIGEST,
      offer: {
        schemaVersion: "1.0.0",
        offerId: "0198e000-0000-7000-8000-000000000601",
        careerDid: "did:abl:career-1",
        careerResourceName: "abl-career-1",
        careerSignerAddress: career.address,
        relayOrigin: "https://relay.example.test",
        runnerBundleDigest: RUNNER_BUILD_DIGEST,
        pairingToken: "pairing-token-that-is-long-enough-0001",
        issuedAt: "2026-08-26T10:00:00.000Z",
        expiresAt: "2026-08-26T10:15:00.000Z",
        singleUse: true,
      },
      fetchImplementation: async (_input, init) => {
        const submitted = JSON.parse(String(init?.body)) as {
          runnerId: string;
          delegateSigningAddress: string;
          delegateEncryptionPublicKey: string;
        };
        const scopes = [
          "RUNNER_HEARTBEAT",
          "ACTIVATION_CLAIM",
          "RESULT_SUBMISSION",
        ] as const;
        const unsigned = {
          schemaVersion: "1.0.0" as const,
          delegationId: "0198e000-0000-7000-8000-000000000602",
          careerDid: "did:abl:career-1",
          runnerId: submitted.runnerId,
          delegateSigningAddress: submitted.delegateSigningAddress,
          delegateEncryptionPublicKey: submitted.delegateEncryptionPublicKey,
          scopes: [...scopes],
          issuedAt: new Date(Date.now() - 1_000).toISOString(),
          expiresAt: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1_000,
          ).toISOString(),
        };
        return new Response(
          JSON.stringify({
            delegation: {
              ...unsigned,
              revokedAt: null,
              careerSignature: await signRunnerDelegation(
                career.privateKey,
                runnerDelegationMessage(
                  unsigned,
                  sha256Commitment([...scopes].sort()),
                ),
              ),
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(store.signingPrivateKey).not.toBe(store.encryptionSecretKey);
    expect(store.runnerBuildDigest).toBe(RUNNER_BUILD_DIGEST);
    expect((await stat(storePath)).mode & 0o777).toBe(0o600);
    await expect(
      runnerDoctor({
        storePath,
        adapter: new DeterministicTestAdapter(
          sha256Commitment("deterministic-adapter"),
        ),
        verifiedBundleDigest: RUNNER_BUILD_DIGEST,
      }),
    ).resolves.toMatchObject({
      ready: true,
      bundleIntegrity: true,
      keySeparation: true,
    });
  });

  it("rejects an offer for different runner bytes before submitting keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "abl-runner-test-"));
    temporaryPaths.push(directory);
    let requested = false;
    await expect(
      pairRunner({
        storePath: join(directory, "runner.json"),
        verifiedBundleDigest: sha256Commitment("different-runner-bytes"),
        offer: {
          schemaVersion: "1.0.0",
          offerId: "0198e000-0000-7000-8000-000000000603",
          careerDid: "did:abl:career-1",
          careerResourceName: "abl-career-1",
          careerSignerAddress: createSigningIdentity().address,
          relayOrigin: "https://relay.example.test",
          runnerBundleDigest: RUNNER_BUILD_DIGEST,
          pairingToken: "pairing-token-that-is-long-enough-0002",
          issuedAt: "2026-08-26T10:00:00.000Z",
          expiresAt: "2026-08-26T10:15:00.000Z",
          singleUse: true,
        },
        fetchImplementation: async () => {
          requested = true;
          return new Response(null, { status: 500 });
        },
      }),
    ).rejects.toThrow("Runner bundle digest differs from the league offer");
    expect(requested).toBe(false);
  });

  it("generates a participant-owned Blaxel Sandbox without ABL credentials", () => {
    const manifest = participantBlaxelManifest({
      name: "my-abl-runner",
      immutableImage: "registry.example/abl-runner@sha256:abc",
      relayOrigin: "https://relay.example.test",
    });
    expect(manifest).toContain("kind: Sandbox");
    expect(manifest).toContain("abl-owned-by: participant");
    expect(manifest).toContain("ABL_RUNNER_STORE_B64");
    expect(manifest).toContain("/opt/abl/abl-runner.mjs");
    expect(manifest).not.toContain("DATABASE_URL");
    expect(manifest).not.toContain("AGENT_DRIVE");
    expect(manifest).not.toContain("model credential");
  });

  it("defines noninteractive command paths for the four documented products", () => {
    expect(productCommandSpec("CODEX_CLI")).toMatchObject({
      command: "codex",
      args: expect.arrayContaining(["exec", "--ephemeral", "read-only"]),
    });
    expect(productCommandSpec("CLAUDE_CODE")).toMatchObject({
      command: "claude",
      args: ["--print", "--output-format", "text"],
    });
    expect(productCommandSpec("GEMINI_CLI")).toMatchObject({
      command: "gemini",
      args: ["--output-format", "text"],
    });
    expect(productCommandSpec("QWEN_LOCAL")).toMatchObject({
      command: "qwen",
      args: [],
    });
  });

  it("passes only the official prompt and strips runner-store secrets from command adapters", async () => {
    const priorStore = process.env.ABL_RUNNER_STORE_B64;
    const priorPath = process.env.ABL_RUNNER_STORE_PATH;
    process.env.ABL_RUNNER_STORE_B64 = "must-not-reach-model";
    process.env.ABL_RUNNER_STORE_PATH = "/must/not/reach/model";
    try {
      const adapter = new CommandAdapter({
        command: process.execPath,
        args: [
          new URL("./fixtures/model-command.mjs", import.meta.url).pathname,
        ],
        identity: "test/command/fixture",
        buildDigest: sha256Commitment("command-fixture"),
        inputMode: "MODEL_PROMPT",
      });
      await expect(
        adapter.invoke(
          {
            role: "PLAYER",
            activation: { id: "a1" },
            context: { play: "safe" },
          },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        decision: { action: "HOLD" },
        providerProductModel: "test/command/fixture",
      });
    } finally {
      if (priorStore === undefined) delete process.env.ABL_RUNNER_STORE_B64;
      else process.env.ABL_RUNNER_STORE_B64 = priorStore;
      if (priorPath === undefined) delete process.env.ABL_RUNNER_STORE_PATH;
      else process.env.ABL_RUNNER_STORE_PATH = priorPath;
    }
  });
});
