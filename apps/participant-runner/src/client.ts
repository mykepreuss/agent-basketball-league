import { signRunnerRequest } from "@abl/cognition";
import { sha256Commitment } from "@abl/recognition";
import {
  InferenceRequestSchema,
  RunnerDelegationSchema,
  type InferenceRequest,
  type RunnerDelegation,
  type RunnerHeartbeat,
} from "@abl/schemas";
import { v7 as uuidv7 } from "uuid";
import type { Hex } from "viem";

export class RelayClient {
  readonly #origin: URL;
  readonly #privateKey: Hex;
  readonly #delegation: RunnerDelegation;
  #nonce = 0n;

  public constructor(input: {
    origin: string;
    privateKey: Hex;
    delegation: RunnerDelegation;
  }) {
    this.#origin = new URL(input.origin);
    this.#privateKey = input.privateKey;
    this.#delegation = RunnerDelegationSchema.parse(input.delegation);
  }

  async #request(
    method: string,
    path: string,
    body: unknown,
  ): Promise<Response> {
    const timestamp = new Date().toISOString();
    const nonce = String(++this.#nonce);
    const idempotencyKey = uuidv7();
    const signature = await signRunnerRequest(this.#privateKey, {
      runnerId: this.#delegation.runnerId,
      careerDid: this.#delegation.careerDid,
      delegationId: this.#delegation.delegationId,
      method,
      path,
      bodyCommitment: sha256Commitment(body),
      nonce,
      idempotencyKey,
      timestamp,
    });
    return fetch(new URL(path, this.#origin), {
      method,
      headers: {
        "content-type": "application/json",
        "x-abl-runner-id": this.#delegation.runnerId,
        "x-abl-career-did": this.#delegation.careerDid,
        "x-abl-delegation-id": this.#delegation.delegationId,
        "x-abl-nonce": nonce,
        "x-abl-idempotency-key": idempotencyKey,
        "x-abl-timestamp": timestamp,
        "x-abl-signature": signature,
      },
      body: method === "GET" ? null : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  }

  public async heartbeat(heartbeat: RunnerHeartbeat): Promise<void> {
    const response = await this.#request(
      "POST",
      "/v1/runners/heartbeat",
      heartbeat,
    );
    if (!response.ok)
      throw new Error(`Relay heartbeat failed: ${response.status}`);
  }

  public async renew(): Promise<RunnerDelegation> {
    const response = await this.#request(
      "POST",
      "/v1/runners/delegation/renew",
      null,
    );
    if (!response.ok)
      throw new Error(`Relay delegation renewal failed: ${response.status}`);
    return RunnerDelegationSchema.parse(
      ((await response.json()) as { delegation: unknown }).delegation,
    );
  }

  public async nextActivation(): Promise<InferenceRequest | null> {
    const response = await this.#request(
      "GET",
      "/v1/runners/activations/next",
      null,
    );
    if (response.status === 204) return null;
    if (!response.ok)
      throw new Error(`Relay activation poll failed: ${response.status}`);
    return InferenceRequestSchema.parse(await response.json());
  }

  public async submitResult(
    activationId: string,
    result: unknown,
  ): Promise<void> {
    const response = await this.#request(
      "POST",
      `/v1/runners/activations/${encodeURIComponent(activationId)}/result`,
      result,
    );
    if (!response.ok)
      throw new Error(`Relay result submission failed: ${response.status}`);
  }

  public async status(): Promise<unknown> {
    const response = await this.#request("GET", "/v1/runners/status", null);
    if (!response.ok)
      throw new Error(`Relay status failed: ${response.status}`);
    return response.json();
  }

  public async unpair(): Promise<void> {
    const response = await this.#request("POST", "/v1/runners/unpair", null);
    if (!response.ok)
      throw new Error(`Relay unpair failed: ${response.status}`);
  }
}
