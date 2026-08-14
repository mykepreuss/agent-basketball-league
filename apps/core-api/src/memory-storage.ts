import { randomUUID } from "node:crypto";

import {
  signServiceRequest,
  type ServiceRequestIdentity,
} from "@abl/foundation";
import type { CiphertextDeletionReceipt } from "@abl/storage";
import { z } from "zod";

const VerificationResponseSchema = z.strictObject({
  verified: z.literal(true),
});

export interface MemoryStorageReference {
  domainId: string;
  objectId: string;
  version: number;
  ciphertextCommitment: string;
}

export interface MemoryStorageVerifier {
  verifyCommitment(
    ownerDid: string,
    reference: MemoryStorageReference,
  ): Promise<void>;
  verifyDeletion(
    ownerDid: string,
    receipt: CiphertextDeletionReceipt,
  ): Promise<void>;
}

export class HttpMemoryStorageVerifier implements MemoryStorageVerifier {
  readonly #origin: string;
  readonly #identity: ServiceRequestIdentity;
  readonly #now: () => number;
  readonly #fetch: typeof fetch;

  public constructor(options: {
    origin: string;
    identity: ServiceRequestIdentity;
    now?: () => number;
    fetch?: typeof fetch;
  }) {
    const origin = new URL(options.origin);
    if (
      origin.protocol !== "https:" ||
      origin.username !== "" ||
      origin.password !== "" ||
      (origin.pathname !== "" && origin.pathname !== "/") ||
      origin.search !== "" ||
      origin.hash !== ""
    ) {
      throw new Error("Private-storage verifier origin is invalid");
    }
    if (!options.identity.capabilities.has("private:commitment:verify"))
      throw new Error("Private-storage verifier identity lacks capability");
    this.#origin = origin.origin;
    this.#identity = options.identity;
    this.#now = options.now ?? Date.now;
    this.#fetch = options.fetch ?? fetch;
  }

  public async verifyCommitment(
    ownerDid: string,
    reference: MemoryStorageReference,
  ): Promise<void> {
    await this.#verify(
      "/v1/commitments/verify",
      { ownerDid, ...reference },
      String(reference.version),
    );
  }

  public async verifyDeletion(
    ownerDid: string,
    receipt: CiphertextDeletionReceipt,
  ): Promise<void> {
    await this.#verify(
      "/v1/deletions/verify",
      { ownerDid, receipt },
      String(receipt.deletedVersion),
    );
  }

  async #verify(
    path: string,
    body: unknown,
    expectedVersion: string,
  ): Promise<void> {
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const headers = signServiceRequest(this.#identity, {
      method: "POST",
      path,
      body: bodyBytes,
      nonce: randomUUID(),
      timestamp: new Date(this.#now()).toISOString(),
      expectedVersion,
      capability: "private:commitment:verify",
    });
    const response = await this.#fetch(`${this.#origin}${path}`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      body: bodyBytes,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    const responseBody = await response.text();
    if (Buffer.byteLength(responseBody) > 4_096)
      throw new Error("Private-storage verification response is too large");
    if (!response.ok)
      throw new Error(
        `Private-storage verification failed: ${response.status}`,
      );
    VerificationResponseSchema.parse(JSON.parse(responseBody));
  }
}
