import { describe, expect, it } from "vitest";

import {
  assertDistinctRecoveryTargets,
  assessRecovery,
  createDatabaseSnapshot,
} from "../src/recovery.js";

const sourceRows = {
  aggregate_heads: ['{"aggregate_type":"game","version":1}'],
  canonical_outbox: ['{"outbox_id":1,"event_id":"event-1"}'],
  recognized_events: ['{"event_id":"event-1","state_root":"0x01"}'],
};

describe("clean-room recovery verifier", () => {
  it("accepts an exact PostgreSQL 17 restore", () => {
    const source = createDatabaseSnapshot(170_011, sourceRows);
    const restored = createDatabaseSnapshot(170_012, {
      recognized_events: [...sourceRows.recognized_events],
      aggregate_heads: [...sourceRows.aggregate_heads],
      canonical_outbox: [...sourceRows.canonical_outbox],
    });

    expect(assessRecovery(source, restored, 3, 17)).toMatchObject({
      status: "PASS",
      blockers: [],
      sourceEventCount: 1,
      restoredEventCount: 1,
      sourceOutboxCount: 1,
      restoredOutboxCount: 1,
      sourceStateRoot: source.databaseStateRoot,
      restoredStateRoot: source.databaseStateRoot,
      resultDigest: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
  });

  it("fails only the mismatched recovery criteria", () => {
    const source = createDatabaseSnapshot(170_011, sourceRows, ["catalog-a"]);
    const restored = createDatabaseSnapshot(
      180_001,
      {
        ...sourceRows,
        recognized_events: ['{"event_id":"event-1","state_root":"0x02"}'],
      },
      ["catalog-b"],
    );
    const assessment = assessRecovery(source, restored, 4, 17);

    expect(assessment.status).toBe("FAIL");
    expect(assessment.blockers).toEqual([
      "restored PostgreSQL major version differs from policy",
      "source public table count differs from migration contract",
      "restored public table count differs from migration contract",
      "restored table contents differ from source",
      "restored schema, index, constraint, or sequence catalog differs",
      "clean-room restore did not reproduce the database state root",
    ]);
  });

  it("requires distinct direct TLS database targets", () => {
    const source =
      "postgresql://role:secret@source.example/neondb?sslmode=require";
    expect(() => assertDistinctRecoveryTargets(source, source)).toThrow(
      "Source and restored databases must be distinct targets",
    );
    expect(() =>
      assertDistinctRecoveryTargets(
        "postgresql://role:secret@source-pooler.example/neondb?sslmode=require",
        "postgresql://role:secret@restore.example/neondb?sslmode=require",
      ),
    ).toThrow("Recovery verification requires a direct connection");
    expect(() =>
      assertDistinctRecoveryTargets(
        "postgresql://role:secret@source.example/neondb",
        "postgresql://role:secret@restore.example/neondb?sslmode=require",
      ),
    ).toThrow("Recovery database URL must require TLS");
  });
});
