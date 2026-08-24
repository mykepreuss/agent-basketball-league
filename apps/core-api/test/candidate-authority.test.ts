import { describe, expect, it } from "vitest";

import { HttpCandidateOperationalVerifier } from "../src/candidate-authority.js";

const candidateDid = "did:abl:founding-alpha-player-001";
const signerAddress = `0x${"1".repeat(40)}`;
const authorityToken = "candidate-authority-token-with-32-bytes";

describe("candidate operational authority", () => {
  it("accepts only an exact private operational authority response", async () => {
    const verifier = new HttpCandidateOperationalVerifier({
      origin: "https://candidate-store.example",
      authorityToken,
      previewToken: "private-preview-token",
      fetch: async (url, init) => {
        expect(String(url)).toBe(
          "https://candidate-store.example/internal/v1/candidate-intake/authority",
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${authorityToken}`);
        expect(headers.get("x-blaxel-preview-token")).toBe(
          "private-preview-token",
        );
        return new Response(
          JSON.stringify({
            operational: true,
            applicationId: "0198e000-0000-7000-8000-000000000001",
            candidateDid,
            signerAddress,
            roleClass: "PLAYER",
            sandboxResourceName: "abl-career-0198e000000070008000000000000001",
          }),
          { status: 200 },
        );
      },
    });
    await expect(
      verifier.assertOperational(candidateDid, signerAddress),
    ).resolves.toBeUndefined();
  });

  it("rejects denial and mismatched authority responses", async () => {
    const denied = new HttpCandidateOperationalVerifier({
      origin: "https://candidate-store.example",
      authorityToken,
      fetch: async () => new Response("{}", { status: 403 }),
    });
    await expect(
      denied.assertOperational(candidateDid, signerAddress),
    ).rejects.toThrow("Candidate is not operational");

    const mismatched = new HttpCandidateOperationalVerifier({
      origin: "https://candidate-store.example",
      authorityToken,
      fetch: async () =>
        new Response(
          JSON.stringify({
            operational: true,
            applicationId: "0198e000-0000-7000-8000-000000000001",
            candidateDid: "did:abl:other",
            signerAddress,
            roleClass: "PLAYER",
            sandboxResourceName: "abl-career-0198e000000070008000000000000001",
          }),
          { status: 200 },
        ),
    });
    await expect(
      mismatched.assertOperational(candidateDid, signerAddress),
    ).rejects.toThrow("does not match command");
  });
});
