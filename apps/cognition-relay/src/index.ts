import { DurableCognitionRelay } from "@abl/cognition";
import type { RunnerDelegation } from "@abl/schemas";

import { createCognitionRelayServer } from "./server.js";
import { PostgresRelayStateStore } from "./postgres-store.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const careerOrigin = new URL(required("ABL_CAREER_PAIRING_ROUTER_ORIGIN"));
const careerToken = required("ABL_CAREER_PAIRING_TOKEN");
const careerPreviewToken = required("ABL_CAREER_PAIRING_ROUTER_PREVIEW_TOKEN");
const pairingEnabled = process.env.ABL_RUNNER_PAIRING_ENABLED === "true";
const stateStore = new PostgresRelayStateStore(required("DATABASE_URL"));
const relay = await DurableCognitionRelay.open(stateStore);
const app = createCognitionRelayServer({
  relay,
  internalToken: required("ABL_COGNITION_RELAY_INTERNAL_TOKEN"),
  async authorizePairing({ submission, offer }) {
    if (!pairingEnabled) throw new Error("Runner pairing is disabled");
    const response = await fetch(
      new URL(
        `/v1/internal/careers/${encodeURIComponent(offer.careerResourceName)}/runner-delegations`,
        careerOrigin,
      ),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${careerToken}`,
          "content-type": "application/json",
          "x-blaxel-preview-token": careerPreviewToken,
        },
        body: JSON.stringify({ careerDid: offer.careerDid, submission }),
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) throw new Error("Career declined runner delegation");
    return (await response.json()) as RunnerDelegation;
  },
  async authorizeRenewal({ current, careerResourceName }) {
    if (!pairingEnabled) throw new Error("Runner pairing is disabled");
    const response = await fetch(
      new URL(
        `/v1/internal/careers/${encodeURIComponent(careerResourceName)}/runner-delegations/renew`,
        careerOrigin,
      ),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${careerToken}`,
          "content-type": "application/json",
          "x-blaxel-preview-token": careerPreviewToken,
        },
        body: JSON.stringify({ delegation: current }),
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) throw new Error("Career declined delegation renewal");
    return (await response.json()) as RunnerDelegation;
  },
});

const purgeTimer = setInterval(() => {
  void relay.purgeCiphertext().catch(() => undefined);
}, 15 * 60_000);
purgeTimer.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    clearInterval(purgeTimer);
    void app.close().finally(() => stateStore.close());
  });

await app.listen({
  host: process.env.HOST ?? "0.0.0.0",
  port: Number.parseInt(process.env.PORT ?? "8080", 10),
});
