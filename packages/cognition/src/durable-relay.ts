import type {
  InferenceRequest,
  InferenceResult,
  RunnerHeartbeat,
  RunnerPairingOffer,
} from "@abl/schemas";

import {
  CognitionRelay,
  type PairingSubmission,
  type RelayDurableState,
  type RunnerAuthenticatedRequest,
} from "./relay.js";

export interface RelayStateStore {
  load(): Promise<RelayDurableState | null>;
  save(state: RelayDurableState): Promise<void>;
}

export class DurableCognitionRelay {
  #relay: CognitionRelay;
  readonly #store: RelayStateStore;
  #tail: Promise<void> = Promise.resolve();

  private constructor(store: RelayStateStore, relay: CognitionRelay) {
    this.#store = store;
    this.#relay = relay;
  }

  public static async open(
    store: RelayStateStore,
  ): Promise<DurableCognitionRelay> {
    const state = await store.load();
    return new DurableCognitionRelay(
      store,
      state === null ? new CognitionRelay() : CognitionRelay.fromState(state),
    );
  }

  async #mutate<T>(
    operation: (relay: CognitionRelay) => Promise<T> | T,
  ): Promise<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((resultResolve, resultReject) => {
      resolve = resultResolve;
      reject = resultReject;
    });
    this.#tail = this.#tail.then(async () => {
      const candidate = CognitionRelay.fromState(this.#relay.exportState());
      try {
        const value = await operation(candidate);
        await this.#store.save(candidate.exportState());
        this.#relay = candidate;
        resolve(value);
      } catch (error) {
        reject(error);
      }
    });
    await this.#tail;
    return result;
  }

  public registerPairingOffer(offer: RunnerPairingOffer) {
    return this.#mutate((relay) => relay.registerPairingOffer(offer));
  }

  public pair(
    submission: PairingSubmission,
    authorize: Parameters<CognitionRelay["pair"]>[1],
    now?: string,
  ) {
    return this.#mutate((relay) => relay.pair(submission, authorize, now));
  }

  public renew(
    auth: RunnerAuthenticatedRequest,
    authorize: Parameters<CognitionRelay["renew"]>[1],
    now?: string,
  ) {
    return this.#mutate((relay) => relay.renew(auth, authorize, now));
  }

  public authenticate(
    auth: RunnerAuthenticatedRequest,
    now?: string,
    requiredScope?: Parameters<CognitionRelay["authenticate"]>[2],
  ) {
    return this.#mutate((relay) =>
      relay.authenticate(auth, now, requiredScope),
    );
  }

  public heartbeat(
    auth: RunnerAuthenticatedRequest,
    heartbeat: RunnerHeartbeat,
    now?: string,
  ) {
    return this.#mutate((relay) => relay.heartbeat(auth, heartbeat, now));
  }

  public enqueue(request: InferenceRequest) {
    return this.#mutate((relay) => relay.enqueue(request));
  }

  public transitionActivation(
    state: Parameters<CognitionRelay["transitionActivation"]>[0],
  ) {
    return this.#mutate((relay) => relay.transitionActivation(state));
  }

  public activationState(activationId: string) {
    return this.#relay.activationState(activationId);
  }

  public nextActivation(runnerId: string, now?: string) {
    return this.#relay.nextActivation(runnerId, now);
  }

  public submitResult(
    result: InferenceResult,
    delegation: Parameters<CognitionRelay["submitResult"]>[1],
    now?: string,
  ) {
    return this.#mutate((relay) => relay.submitResult(result, delegation, now));
  }

  public result(activationId: string, acknowledgeAt?: string) {
    if (acknowledgeAt === undefined) return this.#relay.result(activationId);
    return this.#mutate((relay) => relay.result(activationId, acknowledgeAt));
  }

  public revoke(delegationId: string, revokedAt: string) {
    return this.#mutate((relay) => relay.revoke(delegationId, revokedAt));
  }

  public runnerStatus(runnerId: string) {
    return this.#relay.runnerStatus(runnerId);
  }

  public careerRunnerStatus(careerDid: string) {
    return this.#relay.careerRunnerStatus(careerDid);
  }

  public unpair(runnerId: string, revokedAt: string) {
    return this.#mutate((relay) => relay.unpair(runnerId, revokedAt));
  }

  public purgeCiphertext(now?: string) {
    return this.#mutate((relay) => relay.purgeCiphertext(now));
  }

  public snapshot() {
    return this.#relay.snapshot();
  }
}
