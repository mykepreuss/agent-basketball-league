import { describe, expect, it } from "vitest";
import {
  createSigningIdentity,
  signCanonicalEvent,
  type CanonicalEvent,
} from "@abl/recognition";
import type { TypedDataDomain } from "viem";

import {
  STAGING_POSSESSION_TEST_TIMESTAMP,
  createStagingPossessionCommand,
} from "../src/command.js";

describe("private staging body", () => {
  it("produces one deterministic signed possession without embedding a key", async () => {
    const identity = createSigningIdentity(`0x${"7".repeat(64)}`);
    const signer = {
      address: identity.address,
      sign: (event: CanonicalEvent, domain: TypedDataDomain) =>
        signCanonicalEvent(identity, domain, event),
    };
    const first = await createStagingPossessionCommand({
      actorDid: "did:abl:stage-player-001",
      signer,
      timestamp: STAGING_POSSESSION_TEST_TIMESTAMP,
    });
    const second = await createStagingPossessionCommand({
      actorDid: "did:abl:stage-player-001",
      signer,
      timestamp: STAGING_POSSESSION_TEST_TIMESTAMP,
    });
    expect(first.eventHash).toBe(second.eventHash);
    expect(first.command.signatures[0]).toMatch(/^0x[0-9a-f]{130}$/);
    expect(first.command.event).toMatchObject({
      actorDid: "did:abl:stage-player-001",
      aggregateType: "game-possession",
      aggregateVersion: "1",
      eventType: "PossessionResolved",
    });
  });
});
