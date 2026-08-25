import {
  CandidateCareerBindingSchema,
  type CandidateCareerBinding,
} from "@abl/schemas";
import { z } from "zod";

const OperationalAuthoritySchema = CandidateCareerBindingSchema.extend({
  operational: z.literal(true),
  sandboxResourceName: z.string().min(1).max(160),
});

export type CareerOperationalAuthority = z.infer<
  typeof OperationalAuthoritySchema
>;

export interface CareerOperationalVerifier {
  resolveOperational(
    binding: CandidateCareerBinding,
  ): Promise<CareerOperationalAuthority>;
}

export class HttpCandidateOperationalVerifier
  implements CareerOperationalVerifier
{
  readonly #origin: string;
  readonly #authorityToken: string;
  readonly #previewToken: string | undefined;
  readonly #fetch: typeof fetch;

  public constructor(options: {
    origin: string;
    authorityToken: string;
    previewToken?: string;
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
    )
      throw new Error("Candidate-authority origin is invalid");
    if (Buffer.byteLength(options.authorityToken) < 32)
      throw new Error("Candidate-authority token is too short");
    this.#origin = origin.origin;
    this.#authorityToken = options.authorityToken;
    this.#previewToken = options.previewToken;
    this.#fetch = options.fetch ?? fetch;
  }

  public async resolveOperational(
    candidate: CandidateCareerBinding,
  ): Promise<CareerOperationalAuthority> {
    const binding = CandidateCareerBindingSchema.parse(candidate);
    const response = await this.#fetch(
      `${this.#origin}/internal/v1/candidate-intake/authority`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#authorityToken}`,
          "content-type": "application/json",
          ...(this.#previewToken === undefined
            ? {}
            : { "x-blaxel-preview-token": this.#previewToken }),
        },
        body: JSON.stringify(binding),
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
    const body = await response.text();
    if (Buffer.byteLength(body) > 8_192)
      throw new Error("Candidate-authority response is too large");
    if (!response.ok)
      throw new Error(`Candidate is not operational: ${response.status}`);
    const authority = OperationalAuthoritySchema.parse(JSON.parse(body));
    if (
      authority.applicationId !== binding.applicationId ||
      authority.candidateDid !== binding.candidateDid ||
      authority.signerAddress.toLowerCase() !==
        binding.signerAddress.toLowerCase() ||
      authority.roleClass !== binding.roleClass ||
      authority.capacityDecisionCommitment !==
        binding.capacityDecisionCommitment ||
      authority.opportunityResponseCommitment !==
        binding.opportunityResponseCommitment
    )
      throw new Error("Candidate-authority response does not match command");
    return authority;
  }
}
