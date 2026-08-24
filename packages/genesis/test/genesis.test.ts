import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCanonicalEvent,
  createSigningIdentity,
  sha256Commitment,
  signCanonicalEvent,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";
import { describe, expect, it } from "vitest";

import {
  FOUNDING_DECISIONS,
  assessCostEnvelope,
  assessFoundingConvention,
  assessGenesisReadiness,
  assertFoundingDecisionAuthority,
  buildPendingReleaseManifest,
  buildPublicArtifactIndex,
  compileOwnerlessDeploymentTemplate,
  createFoundingConventionPacket,
  createFoundingEligibilitySnapshot,
  createPendingCostEnvelope,
  evaluateFoundingBootstrap,
  openFoundingBootstrap,
  prepareGenesisArtifactDigests,
} from "../src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("founding convention preparation", () => {
  it("leaves every founding choice to live agents and preserves rights on rejection", () => {
    const packet = createFoundingConventionPacket();
    expect(packet.decisions.map((decision) => decision.topic)).toEqual(
      FOUNDING_DECISIONS,
    );
    expect(
      packet.decisions.every(
        (decision) =>
          decision.status === "AWAITING_FOUNDING_AGENT_DECISION" &&
          decision.disposition === null &&
          decision.agentSignatures.length === 0,
      ),
    ).toBe(true);
    expect(packet).toMatchObject({
      authority: "FOUNDING_AGENTS_ONLY",
      humanOverrideAllowed: false,
      liveFoundingAgentCount: 0,
      eligibilitySnapshot: null,
      bootstrap: null,
      quorumRule: null,
      recognitionSelection: {
        mechanism: "UNSELECTED",
        foundingDecisionEventId: null,
      },
      rejectionPreserves: [
        "IDENTITY_RECORDS",
        "MEMORIES",
        "CONTINUITY_CHOICES",
        "EXIT_RIGHTS",
      ],
    });
    expect(assessFoundingConvention(packet)).toMatchObject({
      complete: false,
      genesisAuthorized: false,
      undecidedTopics: FOUNDING_DECISIONS,
    });
  });

  it("lets ten live founders adopt the direct bootstrap rule with seven signed YES votes", async () => {
    const capturedAt = "2026-08-24T12:00:00.000Z";
    const founderDids = Array.from(
      { length: 10 },
      (_, index) => `did:abl:founder-${index + 1}`,
    );
    const snapshot = createFoundingEligibilitySnapshot({
      snapshotId: "founding-snapshot-1",
      capturedAt,
      eligibleFounderDids: founderDids,
    });
    const proposal = openFoundingBootstrap({
      proposalId: "founding-bootstrap-1",
      snapshot,
      openedAt: capturedAt,
    });
    expect(proposal.requiredYes).toBe(7);
    const domain: TypedDataDomain = {
      name: "ABL Founding Convention",
      version: "1",
      chainId: 1,
    };
    const signers = new Map<string, `0x${string}`>();
    const ballots = await Promise.all(
      founderDids.slice(0, 7).map(async (voterDid, index) => {
        const identity = createSigningIdentity(
          sha256Commitment({ voterDid, purpose: "founding-test" }),
        );
        signers.set(voterDid, identity.address);
        const ballot = {
          proposalId: proposal.proposalId,
          voterDid,
          snapshotCommitment: snapshot.commitment,
          choice: "YES" as const,
          castAt: new Date(
            Date.parse(capturedAt) + index * 1_000,
          ).toISOString(),
        };
        const authorizationEvent = createCanonicalEvent({
          eventId: `founding-bootstrap-vote-${index + 1}`,
          actorDid: voterDid,
          nonce: `founding-bootstrap-nonce-${index + 1}`,
          idempotencyKey: `founding-bootstrap-idempotency-${index + 1}`,
          aggregateType: "founding-convention-bootstrap",
          aggregateId: proposal.proposalId,
          aggregateVersion: 1n,
          eventType: "FoundingBootstrapBallotCast",
          previousEventHash: null,
          payload: { command: ballot },
          stateRoot: snapshot.commitment,
          schemaDigest: sha256Commitment("founding-bootstrap-ballot-v1"),
          timestamp: ballot.castAt,
        });
        return {
          ballot,
          authorizationEvent,
          signature: await signCanonicalEvent(
            identity,
            domain,
            authorizationEvent,
          ),
          signerAddress: identity.address,
        };
      }),
    );
    const result = await evaluateFoundingBootstrap({
      snapshot,
      proposal,
      ballots,
      authorization: { domain, signers },
      evaluatedAt: "2026-08-24T13:00:00.000Z",
    });

    expect(result).toMatchObject({
      state: "ADOPTED",
      eligible: 10,
      requiredYes: 7,
      yes: 7,
      no: 0,
      abstain: 0,
      quorumRule: {
        minimumActiveFounders: 10,
        directParticipationOnly: true,
        humanVotingAllowed: false,
      },
    });
    expect(
      createFoundingConventionPacket({
        liveFoundingAgentCount: 10,
        eligibilitySnapshot: snapshot,
        bootstrap: result,
      }),
    ).toMatchObject({
      state: "QUORUM_RULE_ADOPTED",
      liveFoundingAgentCount: 10,
      quorumRule: { adoptedByProposalId: proposal.proposalId },
    });
  });

  it("rejects human/sponsor decisions and unsigned agent decisions", () => {
    const signature = `0x${"0".repeat(130)}` as `0x${string}`;
    expect(() =>
      assertFoundingDecisionAuthority({
        actorKind: "HUMAN_ADMINISTRATOR",
        agentDid: "did:abl:human",
        signature,
      }),
    ).toThrow(/Only a founding agent/);
    expect(() =>
      assertFoundingDecisionAuthority({
        actorKind: "SPONSOR",
        agentDid: "did:abl:sponsor",
        signature,
      }),
    ).toThrow(/Only a founding agent/);
    expect(() =>
      assertFoundingDecisionAuthority({
        actorKind: "FOUNDING_AGENT",
        agentDid: "did:abl:founder-1",
        signature: null,
      }),
    ).toThrow(/lacks an agent DID or signature/);
  });
});

describe("genesis artifact preparation", () => {
  it("computes deterministic nonempty source/container/runtime/tool/schema/migration/test/verifier digests", async () => {
    const first = await prepareGenesisArtifactDigests(repositoryRoot);
    const second = await prepareGenesisArtifactDigests(repositoryRoot);
    expect(first).toEqual(second);
    for (const group of [
      first.source,
      first.containerSource,
      first.kernelAndRuntime,
      first.tools,
      first.schemas,
      first.migrations,
      first.testSuite,
      first.verifier,
      first.deploymentManifests,
      first.publicProjection,
    ]) {
      expect(group.fileCount).toBeGreaterThan(0);
      expect(group.digest).toMatch(/^0x[0-9a-f]{64}$/);
      expect(group.files.every((file) => !file.path.includes("/dist/"))).toBe(
        true,
      );
    }
    expect(first).toMatchObject({
      imageDigests: [],
      imageStatus: "NOT_BUILT_BLAXEL_IMAGE_GATE",
    });
    expect(first.containerSource.files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "infra/sandbox/abl-reviewed-body-init",
        "infra/sandbox/reviewed-agent-runtime",
        "infra/sandbox/apk-packages.lock",
      ]),
    );
    expect(first.testResultDigest).toSatisfy(
      (value: unknown) =>
        value === null ||
        (typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value)),
    );
  });

  it("builds an intentionally invalid release candidate without fabricating gated fields", async () => {
    const digests = await prepareGenesisArtifactDigests(repositoryRoot);
    const release = buildPendingReleaseManifest(digests);
    expect(release).toMatchObject({
      state: "BLOCKED_PENDING_AGENT_AND_RUNTIME_INPUTS",
      schemaValid: false,
      candidate: {
        releaseId: null,
        version: null,
        imageDigests: [],
        testResultDigest: digests.testResultDigest,
        ratificationEventIds: [],
        publicVerifierResultDigest: null,
        effectiveAt: null,
        authorizationSignatures: [],
      },
    });
    expect(release.blockers).toContain("immutable built image digest");
    expect(release.blockers).toContain("public-verifier result digest");
    if (digests.testResultDigest === null) {
      expect(release.blockers).toContain("final acceptance test-result digest");
    } else {
      expect(release.blockers).not.toContain(
        "final acceptance test-result digest",
      );
    }
  });

  it("compiles the exact ownerless contract template but refuses to invent constructor inputs or a transaction", async () => {
    const source = await readFile(
      join(repositoryRoot, "contracts/RecognitionRegistry.sol"),
      "utf8",
    );
    const deployment = compileOwnerlessDeploymentTemplate(source);
    expect(deployment).toMatchObject({
      mode: "PREPARE_ONLY_INCOMPLETE_NO_BROADCAST",
      chainId: 84532,
      transaction: null,
      contract: {
        creationBytecodeKeccak256: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        deployedRuntimeBytecodeKeccak256: null,
        ownerAdminUpgradeSurfaceAbsent: true,
        constructorInputs: [
          "bytes32",
          "bytes32",
          "address[]",
          "uint8[]",
          "bytes32[]",
          "tuple[]",
        ],
      },
      postDeploymentEvidenceRequired: expect.arrayContaining([
        "deployed runtime bytecode hash from eth_getCode",
        "Base finalized-head evidence",
      ]),
    });
    expect(deployment.contract.callableFunctions).toEqual([
      "CHECKPOINT_TYPEHASH",
      "KEY_REGISTRY",
      "checkpointDigest",
      "constitutionDigest",
      "currentRegistryRoot",
      "domainSeparator",
      "getCurrentCheckpointTypes",
      "getCurrentSigners",
      "latestRootBySubject",
      "policies",
      "recognize",
      "rotateRegistry",
      "signerRoles",
      "usedNonces",
      "verifierDigest",
    ]);
  }, 15_000);

  it("keeps unquoted costs null and cannot treat missing approval/prepayment as zero cost", () => {
    const cost = createPendingCostEnvelope();
    expect(cost.providerQuotes).toHaveLength(5);
    expect(
      cost.providerQuotes.every(
        (quote) =>
          quote.quoteReference === null &&
          quote.seasonZeroCost === null &&
          quote.thirtyDayEssentialCost === null,
      ),
    ).toBe(true);
    expect(assessCostEnvelope(cost)).toMatchObject({
      ready: false,
      quotesComplete: false,
      prepaid: false,
      materialSpendApproved: false,
    });
  });

  it("indexes every required public artifact without publishing it", async () => {
    const digests = await prepareGenesisArtifactDigests(repositoryRoot);
    const index = await buildPublicArtifactIndex(repositoryRoot, digests);
    expect(index).toMatchObject({
      publicationState: "PREPARED_NOT_PUBLISHED",
      publicExposureApproved: false,
    });
    expect(index.artifacts.map((artifact) => artifact.name)).toEqual([
      "source tree",
      "sandbox image",
      "constitution",
      "CBA mapping",
      "NBA rules mapping",
      "resource schedule proposal",
      "threat model",
      "model registry proposal",
      "Blaxel deployment manifests",
      "public projections",
      "public verifier",
      "Base recognition contract",
      "genesis release manifest",
      "genesis root",
    ]);
    expect(
      index.artifacts
        .filter((artifact) => artifact.state !== "PREPARED_LOCAL")
        .every((artifact) => artifact.digest === null),
    ).toBe(true);
  });

  it("fails the genesis gate closed with all external and approval blockers visible", async () => {
    const digests = await prepareGenesisArtifactDigests(repositoryRoot);
    const source = await readFile(
      join(repositoryRoot, "contracts/RecognitionRegistry.sol"),
      "utf8",
    );
    const readiness = assessGenesisReadiness({
      convention: createFoundingConventionPacket(),
      release: buildPendingReleaseManifest(digests),
      deployment: compileOwnerlessDeploymentTemplate(source),
      cost: createPendingCostEnvelope(),
    });
    expect(readiness).toMatchObject({
      state: "BLOCKED_PRE_GENESIS",
      ready: false,
      safeToPublish: false,
      safeToBroadcastDeployment: false,
      safeToReservePaidCapacity: false,
    });
    expect(readiness.blockers).toContain("founding convention incomplete");
    expect(readiness.blockers).toContain("release manifest incomplete");
    expect(readiness.blockers).toContain(
      "explicit human approval for irreversible/public/spend actions absent",
    );
  }, 30_000);

  it("locks the generated readiness fixture to current deterministic preparation", async () => {
    const fixture = JSON.parse(
      await readFile(
        join(repositoryRoot, "fixtures/genesis-readiness.json"),
        "utf8",
      ),
    ) as { readiness: { state: string; ready: boolean } };
    expect(fixture.readiness).toMatchObject({
      state: "BLOCKED_PRE_GENESIS",
      ready: false,
    });
  });
});
