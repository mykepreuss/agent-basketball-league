import {
  ServiceRequestVerifier,
  type ServiceRequestIdentity,
  type SignedServiceRequestHeaders,
} from "@abl/foundation";
import type { CiphertextDeletionReceipt } from "@abl/storage";
import { describe, expect, it } from "vitest";

import {
  HttpMemoryStorageVerifier,
  type MemoryStorageReference,
} from "../src/memory-storage.js";

const now = Date.parse("2026-08-13T08:30:00.000Z");
const identity: ServiceRequestIdentity = {
  serviceId: "core-memory-verifier",
  secret: new TextEncoder().encode("memory-verifier-transport-secret-0001"),
  capabilities: new Set(["private:commitment:verify"]),
};

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

describe("memory storage verifier transport", () => {
  it("sends only signed commitment metadata to the fixed private origin", async () => {
    const requestVerifier = new ServiceRequestVerifier([identity], {
      now: () => now,
    });
    const observed: Array<{ path: string; body: unknown }> = [];
    const mockFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = new Uint8Array(
        await new Response(init?.body ?? null).arrayBuffer(),
      );
      requestVerifier.verify(signedHeaders(new Headers(init?.headers)), {
        method: init?.method ?? "GET",
        path: url.pathname,
        body,
      });
      observed.push({
        path: url.pathname,
        body: JSON.parse(new TextDecoder().decode(body)) as unknown,
      });
      return Response.json({ verified: true });
    }) as typeof fetch;
    const verifier = new HttpMemoryStorageVerifier({
      origin: "https://storage.internal.example",
      identity,
      now: () => now,
      fetch: mockFetch,
    });
    const reference: MemoryStorageReference = {
      domainId: "personal:agent-a",
      objectId: "018f0000-0000-7000-8000-000000000001",
      version: 1,
      ciphertextCommitment: `0x${"a".repeat(64)}`,
    };
    await verifier.verifyCommitment("did:abl:agent-a", reference);
    const receipt: CiphertextDeletionReceipt = {
      format: "ABL-CIPHERTEXT-DELETION-V1",
      domainId: reference.domainId,
      objectId: reference.objectId,
      actorDid: "did:abl:agent-a",
      deletedVersion: 1,
      lastCiphertextCommitment: reference.ciphertextCommitment,
      deletedAt: new Date(now).toISOString(),
      providerResidualDeletionVerified: false,
      deletionCommitment: `0x${"b".repeat(64)}`,
    };
    await verifier.verifyDeletion("did:abl:agent-a", receipt);

    expect(observed).toEqual([
      {
        path: "/v1/commitments/verify",
        body: { ownerDid: "did:abl:agent-a", ...reference },
      },
      {
        path: "/v1/deletions/verify",
        body: { ownerDid: "did:abl:agent-a", receipt },
      },
    ]);
    const serialized = JSON.stringify(observed).toLowerCase();
    expect(serialized).not.toContain('"ciphertext":');
    expect(serialized).not.toContain('"plaintext":');
    expect(serialized).not.toContain('"nonce":');
    expect(serialized).not.toContain('"key":');
  });
});
