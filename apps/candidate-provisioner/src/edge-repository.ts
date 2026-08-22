import {
  verifyCandidateIntakeRecord,
  type CandidateIntakeRecord,
  type CandidateProvisioningReceipt,
  type CandidateProvisioningRepository,
} from "@abl/launch";

interface CandidateEdgeRepositoryOptions {
  origin: string;
  authorizationToken: string;
  previewToken?: string;
  fetchImplementation?: typeof fetch;
  allowHttpForTest?: boolean;
}

function candidateEdgeOrigin(value: string, allowHttp: boolean): URL {
  const origin = new URL(value);
  if (
    origin.origin !== value ||
    origin.username !== "" ||
    origin.password !== "" ||
    (origin.protocol !== "https:" &&
      !(allowHttp && origin.protocol === "http:"))
  )
    throw new Error("Candidate edge must be a canonical HTTPS origin");
  return origin;
}

export class CandidateEdgeProvisioningRepository
  implements CandidateProvisioningRepository
{
  readonly #origin: URL;
  readonly #authorizationToken: string;
  readonly #previewToken: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: CandidateEdgeRepositoryOptions) {
    this.#origin = candidateEdgeOrigin(
      options.origin,
      options.allowHttpForTest ?? false,
    );
    if (
      Buffer.byteLength(options.authorizationToken) < 32 ||
      /[\r\n]/.test(options.authorizationToken)
    )
      throw new Error("Candidate edge authorization token is malformed");
    this.#authorizationToken = options.authorizationToken;
    this.#previewToken = options.previewToken;
    if (
      this.#previewToken !== undefined &&
      (this.#previewToken.length < 32 || /[\r\n]/.test(this.#previewToken))
    )
      throw new Error("Candidate store preview token is malformed");
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async #request(path: string, body: unknown): Promise<unknown> {
    const response = await this.#fetch(new URL(path, this.#origin), {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.#authorizationToken}`,
        ...(this.#previewToken === undefined
          ? {}
          : { "x-blaxel-preview-token": this.#previewToken }),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok)
      throw new Error(`Candidate edge request failed: ${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 8_000_000)
      throw new Error("Candidate edge response exceeds limit");
    return JSON.parse(text) as unknown;
  }

  async list(): Promise<readonly CandidateIntakeRecord[]> {
    const snapshot = (await this.#request(
      "/internal/v1/candidate-intake/snapshot",
      {},
    )) as { records?: unknown };
    if (!Array.isArray(snapshot.records))
      throw new Error("Candidate edge returned an invalid snapshot");
    return snapshot.records.map(verifyCandidateIntakeRecord);
  }

  async get(applicationId: string): Promise<CandidateIntakeRecord | null> {
    return (
      (await this.list()).find(
        (record) => record.application.applicationId === applicationId,
      ) ?? null
    );
  }

  async recordProvisioningReceipt(
    _applicationId: string,
    receipt: CandidateProvisioningReceipt,
  ): Promise<CandidateIntakeRecord> {
    return verifyCandidateIntakeRecord(
      await this.#request("/internal/v1/candidate-intake/receipt", receipt),
    );
  }
}
