import { createSigningIdentity } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  NEUTRAL_OFFICIAL_REGISTRY,
  assertNeutralOfficialSchedule,
} from "../src/neutral-official-registry.js";

function scheduledOfficials() {
  const participants = NEUTRAL_OFFICIAL_REGISTRY.map((official) => ({
    careerDid: official.careerDid,
    role: official.role,
    signerAddress: createSigningIdentity().address,
  }));
  const careerResources = Object.fromEntries(
    NEUTRAL_OFFICIAL_REGISTRY.map((official) => [
      official.careerDid,
      official.careerResourceName,
    ]),
  );
  return { participants, careerResources };
}

describe("neutral-official competition registry", () => {
  it("binds six referees and two replay careers to exact Blaxel Sandboxes", () => {
    expect(
      NEUTRAL_OFFICIAL_REGISTRY.filter(({ role }) => role === "REFEREE"),
    ).toHaveLength(6);
    expect(
      NEUTRAL_OFFICIAL_REGISTRY.filter(({ role }) => role === "REPLAY"),
    ).toHaveLength(2);
    expect(() =>
      assertNeutralOfficialSchedule(scheduledOfficials()),
    ).not.toThrow();
  });

  it("rejects a substituted official even when the role count is unchanged", () => {
    const scheduled = scheduledOfficials();
    scheduled.participants[0] = {
      ...scheduled.participants[0]!,
      careerDid: "did:abl:participant-operated-referee",
    };
    expect(() => assertNeutralOfficialSchedule(scheduled)).toThrow(
      "Blaxel-hosted neutral-official registry",
    );
  });

  it("rejects an official mapped to an unreviewed Sandbox", () => {
    const scheduled = scheduledOfficials();
    scheduled.careerResources[scheduled.participants[0]!.careerDid] =
      "abl-unreviewed-referee";
    expect(() => assertNeutralOfficialSchedule(scheduled)).toThrow(
      "Blaxel-hosted neutral-official registry",
    );
  });
});
