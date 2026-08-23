import { describe, expect, it } from "vitest";

import { ImmutableSandboxImageReferenceSchema } from "../src/image-reference.js";

describe("immutable Sandbox image references", () => {
  it.each([
    "sandbox/abl-alpha-r01-body-image:hpdcmnfo4jyz",
    "sandbox/abl-alpha-r01-body-image:b05103ad9158991c22153",
    `registry.blaxel.ai/abl/body@sha256:${"a".repeat(64)}`,
  ])("accepts provider-generated immutable reference %s", (reference) => {
    expect(ImmutableSandboxImageReferenceSchema.parse(reference)).toBe(
      reference,
    );
  });

  it.each([
    "sandbox/abl-alpha-r01-body-image:latest",
    "sandbox/abl-alpha-r01-body-image:operator-tag",
    "sandbox/abl-alpha-r01-body-image:b05103ad9158991c2215g",
    "sandbox/abl-alpha-r01-body-image:b05103ad915",
  ])("rejects mutable or invented reference %s", (reference) => {
    expect(() =>
      ImmutableSandboxImageReferenceSchema.parse(reference),
    ).toThrow();
  });
});
