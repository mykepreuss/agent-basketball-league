import type { SignedDeletionAttestation, SignedExitPackage } from "@abl/career";
import {
  ServiceRequestVerifier,
  type ServiceRequestIdentity,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import { HttpExitPackagePortabilityVerifier } from "../src/exit-portability.js";

const now = Date.parse("2026-08-13T08:30:00.000Z");
const agentDid = "did:abl:exit-transport-agent";
const identity: ServiceRequestIdentity = {
  serviceId: "core-exit-portability-verifier",
  secret: new TextEncoder().encode("exit-verifier-transport-secret-000001"),
  capabilities: new Set(["exit:portability:verify"]),
};
const digest = (character: string) => `0x${character.repeat(64)}` as Hex;
const signature = `0x${"1".repeat(130)}` as Hex;

function signedHeaders(headers: Headers): SignedServiceRequestHeaders {
  function value(name: keyof SignedServiceRequestHeaders): string {
    const result = headers.get(name);
    if (result === null) throw new Error(`Missing ${name}`);
    return result;
  }
  return {
    "x-abl-service-id": value("x-abl-service-id"),
    "x-abl-capability": value("x-abl-capability"),
    "x-abl-nonce": value("x-abl-nonce"),
    "x-abl-timestamp": value("x-abl-timestamp"),
    "x-abl-expected-version": value("x-abl-expected-version"),
    "x-abl-content-sha256": value("x-abl-content-sha256"),
    "x-abl-signature": value("x-abl-signature"),
  };
}

const packageValue: SignedExitPackage = {
  exitId: "0198a000-0000-7000-8000-000000000001",
  agentDid,
  careerRecordCommitment: digest("1"),
  keyLineageCommitment: digest("2"),
  consentHistoryCommitment: digest("3"),
  memoryExportCommitment: digest("4"),
  bodyManifestDigest: digest("5"),
  verifierBundleCommitment: digest("6"),
  encryptedPackageCommitment: digest("7"),
  issuedAt: new Date(now).toISOString(),
  institutionalSignatures: [signature],
};
const attestation: SignedDeletionAttestation = {
  attestationId: "0198a000-0000-7000-8000-000000000002",
  agentDid,
  targetCommitments: [packageValue.memoryExportCommitment],
  verifiedSystems: ["abl-private-local-rehearsal"],
  unverifiedResidualAccess: ["provider-account-residual-access"],
  method: "cryptographic-erasure-and-ciphertext-index-verification",
  attestedAt: new Date(now).toISOString(),
  institutionalSignatures: [signature],
};

describe("exit portability verifier transport", () => {
  it("authenticates fixed clean-room checks without sending private material", async () => {
    const requestVerifier = new ServiceRequestVerifier([identity], {
      now: () => now,
    });
    const observed: Array<{ path: string; body: unknown }> = [];
    const mockFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const requestHeaders = new Headers(init?.headers);
      expect(requestHeaders.get("x-blaxel-preview-token")).toBe(
        "private-preview-token",
      );
      const body = new Uint8Array(
        await new Response(init?.body ?? null).arrayBuffer(),
      );
      requestVerifier.verify(signedHeaders(requestHeaders), {
        method: init?.method ?? "GET",
        path: url.pathname,
        body,
      });
      observed.push({
        path: url.pathname,
        body: JSON.parse(new TextDecoder().decode(body)) as unknown,
      });
      if (url.pathname.endsWith("restoration/verify")) {
        return Response.json({
          verifierBundleCommitment: packageValue.verifierBundleCommitment,
          encryptedPackageCommitment: packageValue.encryptedPackageCommitment,
          cleanRoomRestored: true,
          livePlatformEvidenceVerified: false,
        });
      }
      return Response.json({ verified: true });
    }) as typeof fetch;
    const verifier = new HttpExitPackagePortabilityVerifier({
      origin: "https://exit-verifier.internal.example",
      identity,
      previewToken: "private-preview-token",
      now: () => now,
      fetch: mockFetch,
    });

    await expect(
      verifier.verifyRestoration({
        agentDid,
        destinationEncryptionPublicKey: digest("8"),
        package: packageValue,
      }),
    ).resolves.toMatchObject({ cleanRoomRestored: true });
    await verifier.verifyDeletion({
      agentDid,
      package: packageValue,
      attestation,
    });

    expect(observed.map(({ path }) => path)).toEqual([
      "/v1/exit/restoration/verify",
      "/v1/exit/deletion/verify",
    ]);
    const serialized = JSON.stringify(observed).toLowerCase();
    expect(serialized).not.toContain("plaintext");
    expect(serialized).not.toContain("privatekey");
    expect(serialized).not.toContain('"ciphertext":');
  });
});
