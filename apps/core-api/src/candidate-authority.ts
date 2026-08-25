import { z } from "zod";

const OperationalAuthoritySchema = z.strictObject({
  operational: z.literal(true),
  applicationId: z.uuid(),
  candidateDid: z.string().startsWith("did:"),
  signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  roleClass: z.enum([
    "PLAYER",
    "COACH",
    "REFEREE",
    "REPLAY_OFFICIAL",
    "GOVERNOR",
    "COMMISSIONER",
    "TRIBUNAL",
    "INTEGRITY",
    "ADVOCATE",
    "BROADCASTER",
    "MEDIA",
  ]),
  sandboxResourceName: z.string().min(1).max(128),
});

export type CareerOperationalAuthority = z.infer<
  typeof OperationalAuthoritySchema
>;

export interface CareerOperationalVerifier {
  resolveOperational(
    candidateDid: string,
    signerAddress: string,
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
    candidateDid: string,
    signerAddress: string,
  ): Promise<CareerOperationalAuthority> {
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
        body: JSON.stringify({ candidateDid, signerAddress }),
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
      authority.candidateDid !== candidateDid ||
      authority.signerAddress.toLowerCase() !== signerAddress.toLowerCase()
    )
      throw new Error("Candidate-authority response does not match command");
    return authority;
  }
}
