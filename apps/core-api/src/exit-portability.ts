import { randomUUID } from "node:crypto";

import type { SignedDeletionAttestation, SignedExitPackage } from "@abl/career";
import {
  signServiceRequest,
  type ServiceRequestIdentity,
} from "@abl/foundation";
import type { Hex } from "viem";
import { z } from "zod";

export interface ExitRestorationEvidence {
  verifierBundleCommitment: Hex;
  encryptedPackageCommitment: Hex;
  cleanRoomRestored: true;
  livePlatformEvidenceVerified: boolean;
}

export interface ExitPackagePortabilityVerifier {
  verifyRestoration(input: {
    agentDid: string;
    destinationEncryptionPublicKey: Hex;
    package: SignedExitPackage;
  }): Promise<ExitRestorationEvidence>;
  verifyDeletion(input: {
    agentDid: string;
    package: SignedExitPackage;
    attestation: SignedDeletionAttestation;
  }): Promise<void>;
}

const HexCommitmentSchema = z.string().regex(/^0x[0-9a-f]{64}$/);
const RestorationResponseSchema = z.strictObject({
  verifierBundleCommitment: HexCommitmentSchema,
  encryptedPackageCommitment: HexCommitmentSchema,
  cleanRoomRestored: z.literal(true),
  livePlatformEvidenceVerified: z.boolean(),
});
const DeletionResponseSchema = z.strictObject({ verified: z.literal(true) });

export class HttpExitPackagePortabilityVerifier
  implements ExitPackagePortabilityVerifier
{
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
      throw new Error("Exit portability verifier origin is invalid");
    }
    if (!options.identity.capabilities.has("exit:portability:verify"))
      throw new Error("Exit portability verifier identity lacks capability");
    this.#origin = origin.origin;
    this.#identity = options.identity;
    this.#now = options.now ?? Date.now;
    this.#fetch = options.fetch ?? fetch;
  }

  public async verifyRestoration(input: {
    agentDid: string;
    destinationEncryptionPublicKey: Hex;
    package: SignedExitPackage;
  }): Promise<ExitRestorationEvidence> {
    return RestorationResponseSchema.parse(
      await this.#request("/v1/exit/restoration/verify", input),
    ) as ExitRestorationEvidence;
  }

  public async verifyDeletion(input: {
    agentDid: string;
    package: SignedExitPackage;
    attestation: SignedDeletionAttestation;
  }): Promise<void> {
    DeletionResponseSchema.parse(
      await this.#request("/v1/exit/deletion/verify", input),
    );
  }

  async #request(path: string, body: unknown): Promise<unknown> {
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
    const headers = signServiceRequest(this.#identity, {
      method: "POST",
      path,
      body: bodyBytes,
      nonce: randomUUID(),
      timestamp: new Date(this.#now()).toISOString(),
      expectedVersion: "0",
      capability: "exit:portability:verify",
    });
    const response = await this.#fetch(`${this.#origin}${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: bodyBytes,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const responseBody = await response.text();
    if (Buffer.byteLength(responseBody) > 16_384)
      throw new Error("Exit portability response is too large");
    if (!response.ok)
      throw new Error(
        `Exit portability verification failed: ${response.status}`,
      );
    return JSON.parse(responseBody) as unknown;
  }
}
