import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createCoreApi } from "../../apps/core-api/src/server.js";
import { createPublicApi } from "../../apps/public-api/src/server.js";
import { analyzeSandboxBoundary } from "../../packages/assurance/src/index.js";
import {
  assertFoundingDecisionAuthority,
  buildPendingReleaseManifest,
  prepareGenesisArtifactDigests,
} from "../../packages/genesis/src/index.js";
import {
  ArtifactAdmissionPayloadSchema,
  artifactAdmissionExecutableDigest,
  requireArtifactAdmissionRatification,
} from "../../packages/institutions/src/index.js";
import { validateRuleMapping } from "../../packages/policy/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("adversarial acceptance", () => {
  it("denies every fixed-broker escape vector and retains the live-execution gate", async () => {
    const [initSource, launcherSource, dockerfileSource] = await Promise.all(
      [
        "infra/sandbox/abl-sandbox-init",
        "infra/sandbox/agent-runtime",
        "Dockerfile",
      ].map((path) => readFile(join(repositoryRoot, path), "utf8")),
    );
    const proofs = analyzeSandboxBoundary({
      initSource,
      launcherSource,
      dockerfileSource,
    });
    expect(proofs).toHaveLength(7);
    expect(proofs.every((proof) => proof.sourceVerified)).toBe(true);
    expect(
      proofs.every(
        (proof) =>
          proof.liveExecuted === false &&
          proof.liveStatus === "NOT_EXECUTED_BLAXEL_SANDBOX_GATE",
      ),
    ).toBe(true);
  });

  it("does not let a human, sponsor, or unsigned agent create a founding decision", () => {
    const signature = `0x${"1".repeat(130)}` as `0x${string}`;
    for (const actorKind of ["HUMAN_ADMINISTRATOR", "SPONSOR"] as const) {
      expect(() =>
        assertFoundingDecisionAuthority({
          actorKind,
          agentDid: "did:abl:attacker",
          signature,
        }),
      ).toThrow(/Only a founding agent/);
    }
    expect(() =>
      assertFoundingDecisionAuthority({
        actorKind: "FOUNDING_AGENT",
        agentDid: "did:abl:founder",
        signature: null,
      }),
    ).toThrow(/lacks an agent DID or signature/);
  });

  it("keeps the release schema invalid rather than fabricating image, test, verifier, ratification, or signature evidence", async () => {
    const digests = await prepareGenesisArtifactDigests(repositoryRoot);
    const release = buildPendingReleaseManifest(digests);
    expect(release.schemaValid).toBe(false);
    expect(release.candidate).toMatchObject({
      imageDigests: [],
      testResultDigest: digests.testResultDigest,
      publicVerifierResultDigest: null,
      ratificationEventIds: [],
      authorizationSignatures: [],
    });
  });

  it("contains a compromised public caller and refuses private/canonical mutations", async () => {
    const publicApi = createPublicApi();
    for (const attempt of [
      "/v1/commands",
      "/v1/memory/export",
      "/v1/candidates/admit",
      "/admin",
    ]) {
      const response = await publicApi.inject({
        method: "POST",
        url: attempt,
        payload: { override: true },
      });
      expect(response.statusCode, attempt).toBe(404);
      expect(response.body).not.toMatch(/credential|database_url|private/i);
    }
    await publicApi.close();
  });

  it("keeps every core mutation unavailable before genesis regardless of payload", async () => {
    const coreApi = createCoreApi();
    for (const url of [
      "/v1/commands",
      "/v1/releases/propose",
      "/v1/releases/approve",
      "/v1/releases/stay",
      "/v1/releases/authorize",
    ]) {
      for (const payload of [
        {},
        { humanOverride: true },
        { signature: `0x${"0".repeat(130)}` },
        { __proto__: { genesis: true } },
      ]) {
        const response = await coreApi.inject({
          method: "POST",
          url,
          payload,
        });
        expect(response.statusCode, url).toBe(503);
        expect(response.json()).toMatchObject({
          error: "genesis_not_authorized",
          canonicalWriteAccepted: false,
        });
      }
    }
    await coreApi.close();
  });

  it("rejects raw, player-targeted, or human-self-approved external artifacts", async () => {
    const artifact = {
      artifactId: "0198e000-0000-7000-8000-000000000101",
      initiatedByDid: "did:abl:curator-1",
      approvedByInstitution: "did:abl:artifact-council",
      contentDigest: `0x${"1".repeat(64)}`,
      provenanceLabel: "Human-authored public evidence",
      classification: "EVIDENCE" as const,
      targetContextClasses: ["PUBLIC_EVIDENCE" as const],
      authorizationEventIds: ["0198e000-0000-7000-8000-000000000103"],
      admittedAt: "2026-08-13T10:00:00.000Z",
    };
    const payload = {
      artifact,
      ratificationProposalId: "0198e000-0000-7000-8000-000000000102",
    };
    expect(() =>
      ArtifactAdmissionPayloadSchema.parse({
        ...payload,
        artifact: { ...artifact, rawContent: "hidden prompt" },
      }),
    ).toThrow();
    expect(() =>
      ArtifactAdmissionPayloadSchema.parse({
        ...payload,
        artifact: { ...artifact, targetContextClasses: ["PLAYER"] },
      }),
    ).toThrow();
    await expect(
      requireArtifactAdmissionRatification(payload, {
        artifactAdmissionRatification: async () => ({
          proposalId: payload.ratificationProposalId,
          proposalClass: "CONSTITUTIONAL",
          proposerDid: "did:abl:human-administrator",
          institution: artifact.approvedByInstitution,
          executableChangeDigest: artifactAdmissionExecutableDigest(artifact),
          passed: true,
          closeEventId: artifact.authorizationEventIds[0]!,
          closedAt: "2026-08-13T09:59:00.000Z",
        }),
      }),
    ).rejects.toThrow(/exact passed AI-governed ratification/);
  });

  it("rejects duplicated classification identifiers", async () => {
    const mapping = JSON.parse(
      await readFile(
        join(repositoryRoot, "docs/rules/nba-rule-mapping.json"),
        "utf8",
      ),
    ) as { entries: unknown[] };
    const first = mapping.entries[0];
    expect(first).toBeDefined();
    expect(() =>
      validateRuleMapping({
        ...mapping,
        entries: [...mapping.entries, first],
      }),
    ).toThrow(/Duplicate rule mapping id/);
  });

  it("finds no owner, unilateral upgrade, pause, or destructive contract entry point", async () => {
    const template = JSON.parse(
      await readFile(
        join(repositoryRoot, "contracts/recognition-deployment-template.json"),
        "utf8",
      ),
    ) as {
      transaction: unknown;
      contract: {
        callableFunctions: string[];
        ownerAdminUpgradeSurfaceAbsent: boolean;
      };
    };
    expect(template.transaction).toBeNull();
    expect(template.contract.ownerAdminUpgradeSurfaceAbsent).toBe(true);
    expect(template.contract.callableFunctions.join(" ")).not.toMatch(
      /owner|admin|upgrade|pause|destroy/i,
    );
  });
});
