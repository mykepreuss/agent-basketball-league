import { describe, expect, it } from "vitest";

import { assessCanonicalDatabaseProfile } from "../src/index.js";

function profile() {
  return {
    profileVersion: 1 as const,
    provider: "provider-neutral-postgres",
    engine: "POSTGRESQL" as const,
    region: "us-west",
    connection: {
      tlsRequired: true,
      publicInternetAllowed: true,
      sourceRestricted: true,
      applicationCredentialsLeastPrivilege: true,
      credentialRotationSupported: true,
    },
    transactions: {
      serializable: true,
      advisoryLocks: true,
      atomicOutbox: true,
    },
    recovery: {
      continuousBackup: true,
      pointInTimeRecovery: false,
      restoreWindowDays: 7,
      maxRpoSeconds: 900,
      maxRtoSeconds: 7_200,
      cleanRoomRestoreVerifiedAt: "2026-08-18T09:00:00.000Z",
      replayRootsMatched: true,
    },
    durability: {
      multiZone: false,
      encryptedAtRest: true,
      independentBackupCopy: true,
    },
  };
}

describe("provider-neutral canonical database profile", () => {
  it("admits a restored PostgreSQL service for production V1 without naming Neon", () => {
    expect(assessCanonicalDatabaseProfile(profile(), "PRODUCTION_V1")).toEqual({
      stage: "PRODUCTION_V1",
      ready: true,
      provider: "provider-neutral-postgres",
      missing: [],
    });
  });

  it("retains stronger recovery and network requirements for genesis", () => {
    expect(assessCanonicalDatabaseProfile(profile(), "GENESIS")).toMatchObject({
      ready: false,
      missing: expect.arrayContaining([
        "point-in-time recovery",
        "30-day restore window",
        "multi-zone durability",
        "private or explicitly restricted database ingress",
      ]),
    });
  });

  it("rejects an unrestricted or overprivileged production connection", () => {
    const candidate = profile();
    candidate.connection.sourceRestricted = false;
    candidate.connection.applicationCredentialsLeastPrivilege = false;
    expect(
      assessCanonicalDatabaseProfile(candidate, "PRODUCTION_V1"),
    ).toMatchObject({
      ready: false,
      missing: expect.arrayContaining([
        "source-restricted database ingress",
        "least-privilege application database credentials",
      ]),
    });
  });
});
