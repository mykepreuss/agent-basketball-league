import { describe, expect, it } from "vitest";

import { prepareNeutralOfficialDeployment } from "../src/neutral-official-deployment.js";

function input() {
  return {
    version: 1,
    releaseCommit: "a".repeat(40),
    workspace: "agent-basketball-league",
    region: "us-was-1",
    modelGateway: {
      name: "abl-neutral-official-model",
      integrationConnection: "abl-neutral-official-openai",
      endpointName: "abl-neutral-official-model",
      providerType: "openai",
      providerOrganization: "abl",
      providerModel: "structured-official-model",
      sandbox: false,
    },
    images: {
      career: "sandbox/abl-stage-c-career-body-image:bq01vcz50may",
      fixedBroker: "sandbox/abl-stage-c-fixed-broker-image:jd4x4mu72sux",
    },
    privateStorage: {
      origin: "https://private.example.test",
      host: "private.example.test",
      serviceId: "abl-career-storage",
    },
    coordinator: {
      did: "did:abl:competition-director",
      signerAddress: `0x${"1".repeat(40)}`,
    },
    commandDomain: {
      name: "ABL Recognition",
      version: "1",
      chainId: 8453,
      verifyingContract: `0x${"2".repeat(40)}`,
    },
    modelServiceBuildDigest: `0x${"3".repeat(64)}`,
    modelAdapterBuildDigest: `0x${"4".repeat(64)}`,
  };
}

describe("neutral-official deployment preparation", () => {
  it("produces a deterministic exact-roster packet without secret values", () => {
    const first = prepareNeutralOfficialDeployment(input());
    const second = prepareNeutralOfficialDeployment(input());
    expect(first).toEqual(second);
    expect(first.officials).toHaveLength(8);
    expect(
      new Set(first.officials.map(({ applicationId }) => applicationId)).size,
    ).toBe(8);
    expect(
      new Set(first.officials.map(({ careerDid }) => careerDid)).size,
    ).toBe(8);
    expect(
      first.officials.filter(({ role }) => role === "REFEREE"),
    ).toHaveLength(6);
    expect(
      first.officials.filter(({ role }) => role === "REPLAY"),
    ).toHaveLength(2);
    expect(first.prohibitions).toContain("REUSE_SANDBOX_OPENAI");
    expect(JSON.stringify(first)).not.toMatch(/api[_-]?key|private[_-]?key/i);
    expect(first.packetDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects sandbox or unrelated model configuration", () => {
    const sandbox = input();
    sandbox.modelGateway.sandbox = true;
    expect(() => prepareNeutralOfficialDeployment(sandbox)).toThrow();

    const unrelated = input();
    unrelated.modelGateway.integrationConnection = "sandbox-openai";
    expect(() => prepareNeutralOfficialDeployment(unrelated)).toThrow();
  });

  it("rejects mutable image references and additional workspaces", () => {
    const mutable = input();
    mutable.images.career = "sandbox/abl-stage-c-career-body-image:latest";
    expect(() => prepareNeutralOfficialDeployment(mutable)).toThrow();

    const workspace = input();
    workspace.workspace = "abl-competition";
    expect(() => prepareNeutralOfficialDeployment(workspace)).toThrow();
  });
});
