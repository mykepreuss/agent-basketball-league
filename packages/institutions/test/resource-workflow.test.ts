import { createCanonicalEvent, sha256Commitment } from "@abl/recognition";
import { describe, expect, it } from "vitest";

import {
  RESOURCE_SCHEDULE_AGGREGATE_TYPE,
  RESOURCE_SCHEDULE_EVENT_TYPE,
  RESOURCE_SCHEDULE_SCHEMA_DIGEST,
  ResourceScheduleAuthorizationError,
  ResourceScheduleValidationError,
  applyResourceScheduleTransition,
  requireResourceScheduleRatification,
  resourceScheduleExecutableDigest,
  resourceScheduleStateRoot,
} from "../src/index.js";

const scheduleId = "0198b000-0000-7000-8000-000000000001";
const proposalId = "0198b000-0000-7000-8000-000000000002";
const closeEventId = "0198b000-0000-7000-8000-000000000003";

function schedule(version = 1) {
  return {
    scheduleId,
    version,
    effectiveAt: `2026-08-${String(14 + version).padStart(2, "0")}T00:00:00.000Z`,
    gameDayRoleUnits: {
      PLAYER: 100,
      COACH: 80,
      REFEREE: 60,
      REPLAY: 60,
    },
    universalMinimumUnits: 40,
    autonomy: {
      activationsPerWeek: 4 as const,
      interactiveMinutesPerActivation: 15 as const,
      sandboxComputeMinutesPerWeek: 60 as const,
      normalizedModelTokensPerWeek: 96_000 as const,
      rolloverWeeks: 1 as const,
    },
    teamPreparationCapUnits: 2_000,
    conversionFactors: [
      {
        provider: "provider-a",
        modelRevision: "model-a-2026-08-13",
        unitsPerThousandTokens: 1.25,
      },
    ],
    ratificationEventId: closeEventId,
  };
}

function transition(version = 1) {
  const payload = {
    schedule: schedule(version),
    ratificationProposalId: proposalId,
  };
  const provisional = createCanonicalEvent({
    eventId: `0198b000-0000-7000-8000-${String(10 + version).padStart(12, "0")}`,
    actorDid: "did:abl:resource-publisher",
    nonce: `resource-${version}`,
    idempotencyKey: `0198b000-0000-7000-8000-${String(20 + version).padStart(12, "0")}`,
    aggregateType: RESOURCE_SCHEDULE_AGGREGATE_TYPE,
    aggregateId: scheduleId,
    aggregateVersion: BigInt(version),
    eventType: RESOURCE_SCHEDULE_EVENT_TYPE,
    previousEventHash: null,
    payload,
    stateRoot: sha256Commitment("provisional"),
    schemaDigest: RESOURCE_SCHEDULE_SCHEMA_DIGEST,
    timestamp: `2026-08-${String(13 + version).padStart(2, "0")}T00:00:00.000Z`,
  });
  return { payload, provisional };
}

describe("resource schedule workflow", () => {
  it("binds exact autonomous roles, versions, effective times, and state roots", () => {
    const first = transition();
    const firstSnapshot = applyResourceScheduleTransition(
      null,
      first.provisional,
      first.payload,
    );
    expect(firstSnapshot.schedule).toEqual(schedule());
    expect(resourceScheduleStateRoot(firstSnapshot)).toMatch(
      /^0x[0-9a-f]{64}$/,
    );

    const second = transition(2);
    const secondSnapshot = applyResourceScheduleTransition(
      firstSnapshot,
      second.provisional,
      second.payload,
    );
    expect(secondSnapshot.version).toBe(2);

    expect(() =>
      applyResourceScheduleTransition(firstSnapshot, second.provisional, {
        ...second.payload,
        schedule: {
          ...second.payload.schedule,
          gameDayRoleUnits: { PLAYER: 100 },
        },
      }),
    ).toThrow(ResourceScheduleValidationError);
    expect(() =>
      applyResourceScheduleTransition(firstSnapshot, second.provisional, {
        ...second.payload,
        schedule: {
          ...second.payload.schedule,
          conversionFactors: [
            second.payload.schedule.conversionFactors[0]!,
            second.payload.schedule.conversionFactors[0]!,
          ],
        },
      }),
    ).toThrow(ResourceScheduleValidationError);
  });

  it("accepts only an exact passed constitutional governance commitment", async () => {
    const payload = transition().payload;
    const valid = {
      proposalId,
      proposalClass: "CONSTITUTIONAL",
      executableChangeDigest: resourceScheduleExecutableDigest(
        payload.schedule,
      ),
      passed: true,
      closeEventId,
    };
    await expect(
      requireResourceScheduleRatification(payload, {
        resourceScheduleRatification: async () => valid,
      }),
    ).resolves.toEqual(valid);

    for (const invalid of [
      { ...valid, proposalClass: "SHARED_ORDINARY" },
      { ...valid, passed: false },
      { ...valid, executableChangeDigest: sha256Commitment("other") },
      { ...valid, closeEventId: "0198b000-0000-7000-8000-000000000099" },
    ]) {
      await expect(
        requireResourceScheduleRatification(payload, {
          resourceScheduleRatification: async () => invalid,
        }),
      ).rejects.toThrow(ResourceScheduleAuthorizationError);
    }
  });
});
