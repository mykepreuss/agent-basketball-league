import { InMemoryCanonicalStore } from "@abl/database";
import { createSigningIdentity } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import { seedPersistentRecoveryProbe } from "../src/recovery-probe.js";

const domain = {
  name: "ABL Recognition",
  version: "1",
  chainId: 84_532,
  verifyingContract: "0x1111111111111111111111111111111111111111",
} as const;
const identity = createSigningIdentity(`0x${"1".repeat(64)}`);

describe("persistent recovery probe", () => {
  it("persists one signed private event and outbox record idempotently", async () => {
    const store = new InMemoryCanonicalStore();
    const input = {
      store,
      domain,
      identity,
      occurredAt: "2026-08-26T02:08:00.000Z",
    } as const;
    const first = await seedPersistentRecoveryProbe(input);
    const duplicate = await seedPersistentRecoveryProbe(input);

    expect(first).toMatchObject({
      evidenceClass: "PERSISTENT_RECOVERY_PROBE",
      classification: "PRE_GENESIS_EXPERIMENT",
      aggregateType: "recovery-probe",
      aggregateVersion: "1",
      duplicate: false,
      eventCount: 1,
      outboxCount: 1,
      outboxTopic: "private.recovery-probe",
      signatureVerified: true,
      canonicalHistoryClaim: false,
      genesis: false,
      secretValuesRecorded: false,
    });
    expect(duplicate).toMatchObject({ ...first, duplicate: true });
    expect(JSON.stringify(first)).not.toContain(identity.privateKey);
  });
});
